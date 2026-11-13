#!/usr/bin/env node
// [dan] Tests for the indoor simulator (simulators/swarm-indoor): floors, line of sight, belief, no-leak, records,
// safety on true positions, outcome bands against the grounded baseline, and determinism.
//   node simulators/tests/indoor.test.js
// The bands are regression floors for today's teacher on the fixed office floor (docs/TACTICS.md has the numbers).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

function loadCore(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('sim-core script not found in ' + file);
  const ctx = { module: { exports: {} }, Math, console, Infinity, NaN, Array, Set, Map, Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Object, parseInt, parseFloat, isFinite, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx, { filename: path.basename(file) });
  return ctx.module.exports;
}

const S = loadCore(path.join(__dirname, '..', 'swarm-indoor', 'index.html'));
const SCEN = {
  intruder: sd => ({ role: 'intruder', delay: +(15 * ((sd * 0.618034) % 1)).toFixed(2) }),
  hider: () => ({ role: 'intruder', intent: 'hide' }),
  visitor: () => ({ role: 'visitor', intent: 'wander' }),
};

// one episode: order `goal` at 1 s; returns plan records and metrics
function episode(sd, goal, who, opts) {
  opts = opts || {};
  S.seed(sd);
  S.world.reset(Object.assign({ goal: 'hold', person: SCEN[who](sd), endOnGone: who === 'intruder', grounded: goal === 'grounded', layout: 'fixed' }, opts.reset || {}));
  const recs = [];
  S.mission.onPlan = r => recs.push(r);
  const secs = opts.secs || 180;
  let i = 0;
  for (; i < secs * 60 && !S.world.ended; i++) {
    if (i === 60 && goal !== 'grounded') S.world.order(goal, null, 'test', opts.params || {});
    S.world.step(1 / 60);
    if (opts.until && opts.until()) break;
  }
  S.mission.onPlan = null;
  return { recs, M: JSON.parse(JSON.stringify(S.metrics)), status: S.mission.status, t: i / 60 };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('fixed and random floors: every room reachable on foot and by air', () => {
  for (const sd of [0, ...Array.from({ length: 25 }, (_, k) => k + 1)]) {
    S.seed(sd); S.world.reset({ layout: sd === 0 ? 'fixed' : 'random' });
    const P = S.getPlan(), G = S.grids(), NAV = 0.2;
    const reach = (grid, x, z) => { const seen = new Uint8Array(grid.length), st = [S.navIdx(x, z)]; seen[st[0]] = 1; const rooms = new Set();
      while (st.length) { const k = st.pop(), i = k % G.NX, j = (k - i) / G.NX; rooms.add(S.roomAt((i + 0.5) * NAV, (j + 0.5) * NAV));
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= G.NX || nj >= G.NZ) continue; const kk = nj * G.NX + ni; if (!seen[kk] && !grid[kk]) { seen[kk] = 1; st.push(kk); } } }
      return rooms; };
    const walk = reach(G.WALK, P.operator.x, P.operator.z), fly = reach(G.FLY, P.pads[0].x, P.pads[0].z);
    for (const q of P.rooms) {
      assert.ok(walk.has(q.id), `seed ${sd}: the ${q.name} cannot be reached on foot`);
      assert.ok(fly.has(q.id), `seed ${sd}: the ${q.name} cannot be reached by air`);
    }
    for (const d of P.doors) assert.ok(G.DZONE[S.navIdx(d.x, d.z)] === d.id + 1, `seed ${sd}: ${d.name} has no door zone`);
  }
});

test('line of sight: walls and lintels block, doorways and tables do not, shelves block below their top', () => {
  S.seed(1); S.world.reset({ layout: 'fixed' });
  const P = S.getPlan(), side = P.doors.find(d => d.name === 'lab side door');
  assert.ok(!S.los(side.x - 1.2, 1.6, side.z - 1.3, side.x + 1.2, 1.3, side.z - 1.3), 'the lab/office wall blocks');
  assert.ok(S.los(side.x - 1.2, 1.6, side.z, side.x + 1.2, 1.3, side.z), 'the open lab side door does not');
  assert.ok(!S.los(side.x - 1.2, 2.4, side.z, side.x + 1.2, 2.4, side.z), 'the 2.0 m lintel blocks at 2.4 m');
  // a sight line across a piece of furniture, between two points on open floor 0.5 m either side of it
  const G = S.grids(), floorAt = (x, z) => G.Hg[S.cellIdx(x, z)] < 0.05;
  const span = f => { const cx = (f.x0 + f.x1) / 2; return [cx, f.z0 - 0.5, cx, f.z1 + 0.5]; };
  const clear = f => { const [ax, az, bx, bz] = span(f); return floorAt(ax, az) && floorAt(bx, bz); };
  const table = P.furn.find(f => f.h < 1.0 && clear(f)), shelf = P.furn.find(f => f.h >= 2.0 && clear(f));
  assert.ok(table && shelf, 'the office floor has a table and a shelf with open floor on both sides');
  const across = (f, y) => { const [ax, az, bx, bz] = span(f); return S.los(ax, y, az, bx, y, bz); };
  assert.ok(across(table, 1.3), 'a 0.8 m table does not block at 1.3 m');
  assert.ok(!across(shelf, 1.5), 'a 2.2 m shelf blocks at 1.5 m');
  assert.ok(across(shelf, 2.6), 'a 2.2 m shelf does not block at 2.6 m');
});

test('belief is sound: while he is unseen, his true room is among the rooms he could be in (or cleared by a partial search)', () => {
  // A room drops out of the belief two ways: he cannot have reached it since he was last seen (must never be wrong), or a
  // search covered it to the level's threshold (80% at level 3) without seeing him, which can miss a hidden person.
  let checked = 0, missedInCleared = 0;
  for (const [goal, who] of [['search', 'hider'], ['track', 'intruder'], ['keepout', 'intruder'], ['guideout', 'visitor']]) {
    for (const sd of [1, 2, 3]) {
      const { recs } = episode(sd, goal, who);
      const P = S.getPlan();
      for (const r of recs) {
        const room = r.truth.person.room;
        if (r.obs.seen || !r.truth.person.alive || !(room >= 0 && room < P.rooms.length) || !r.obs.belief_rooms.length) continue;
        checked++;
        if (!r.obs.belief_rooms.includes(room) && r.obs.cleared.includes(room)) { missedInCleared++; continue; }
        assert.ok(r.obs.belief_rooms.includes(room), `${goal} seed ${sd} t ${r.t}: he is in the ${P.rooms[room].name}, belief ${r.obs.belief_rooms.map(i => P.rooms[i].name)}`);
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} unseen ticks checked`);
  console.log(`      ${checked} unseen ticks; ${missedInCleared} with him in a room a partial search had cleared`);
});

test('no leak: where an unseen person hides does not change the labels', () => {
  const run = start => episode(4, 'search', 'hider', { reset: { person: { role: 'intruder', intent: 'hide', start } } }).recs;
  const a = run('storage'), b = run('meeting room');
  let same = 0;
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (a[k].obs.seen || b[k].obs.seen || a[k].obs.last_seen_age !== null || b[k].obs.last_seen_age !== null) break;
    const near = r => r.team.some(d => Math.hypot(d.pos[0] - r.truth.person.pos[0], d.pos[2] - r.truth.person.pos[2]) < 5);
    if (near(a[k]) || near(b[k])) break; // close enough for the drones' own proximity sensing to react
    assert.deepStrictEqual(a[k].label, b[k].label, `labels differ at t ${a[k].t} although the team knows nothing about him`);
    assert.deepStrictEqual(a[k].obs, b[k].obs);
    same++;
  }
  assert.ok(same >= 20, `only ${same} ticks compared`);
});

test('every plan record carries the indoor contract fields', () => {
  const isV = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  for (const [goal, who] of [['keepout', 'intruder'], ['driveout', 'intruder'], ['guideout', 'visitor'], ['contain', 'intruder'], ['search', 'hider'], ['explore', 'visitor'], ['overwatch', 'intruder'], ['return', 'visitor']]) {
    const { recs } = episode(5, goal, who, { secs: 40 });
    assert.ok(recs.length >= (goal === 'return' ? 5 : 40), `${goal}: ${recs.length} records in 40 s`); // landed drones get no more plan ticks
    for (const r of recs) {
      assert.ok(r.type === 'plan' && Number.isFinite(r.t) && r.order && Number.isInteger(r.order.version), `${goal}: header fields`);
      assert.ok(r.team.length === 3 && r.team.every(d => isV(d.pos) && isV(d.vel) && Number.isFinite(d.yaw)), `${goal}: team`);
      const L = r.label;
      assert.ok(typeof L.template === 'string' && L.slots.every(isV) && L.vectors.every(isV), `${goal}: slots and vectors`);
      assert.ok(L.refs.length === 3 && L.refs.every(d => d.length === 4 && d.every(isV)), `${goal}: timed reference points`);
      assert.ok(L.yaw.length === 3 && L.spin.length === 3 && L.flags.length === 3, `${goal}: yaw, spin, validator flags`);
      assert.ok(r.obs.p === null || r.obs.seen || r.obs.last_seen_age <= 4.0001, `${goal}: an estimate needs a sighting in the last 4 s`);
      assert.ok(Array.isArray(r.obs.belief_rooms) && r.truth && isV(r.truth.person.pos) && Number.isFinite(r.truth.margin), `${goal}: belief and truth`);
    }
    if (recs.length && r0(recs).order.goal !== 'hold') assert.ok(recs.some(r => r.order.goal === goal), `${goal}: the order was applied`);
  }
  function r0(recs) { return recs[recs.length - 1]; }
});

// outcome bands, measured on the fixed office floor with the same seeds for the grounded baseline
const BANDS = {};
test('keep out and drive out beat the grounded baseline', () => {
  const N = 12, res = {};
  for (const goal of ['grounded', 'keepout', 'driveout']) {
    res[goal] = { breached: 0, clean: 0, det: 0, detKept: 0, viol: [] };
    for (let sd = 1; sd <= N; sd++) {
      const { M } = episode(sd, goal, 'intruder');
      const p = S.person.params, det = p.kFear * 3 * Math.max(0, p.Rreact / 3.0 - 1) >= 1;
      res[goal].breached += M.breaches > 0; res[goal].clean += M.left > 0 && M.breaches === 0;
      if (det) { res[goal].det++; res[goal].detKept += M.breaches === 0; }
      res[goal].viol.push(M);
    }
  }
  BANDS.intruder = res;
  assert.ok(res.grounded.breached >= N - 1, `grounded baseline: ${res.grounded.breached}/${N} breached`);
  assert.ok(res.keepout.breached <= res.grounded.breached - 2, `keep out ${res.keepout.breached}/${N} breached vs grounded ${res.grounded.breached}/${N}`);
  assert.ok(res.driveout.breached <= res.grounded.breached - 2, `drive out ${res.driveout.breached}/${N} breached vs grounded ${res.grounded.breached}/${N}`);
  assert.ok(res.keepout.detKept >= Math.floor(0.25 * res.keepout.det), `keep out stopped ${res.keepout.detKept} of ${res.keepout.det} deterrable intruders`);
  console.log(`      breached: grounded ${res.grounded.breached}/${N}, keep out ${res.keepout.breached}/${N}, drive out ${res.driveout.breached}/${N}; ` +
    `deterrable intruders kept out: keep out ${res.keepout.detKept}/${res.keepout.det}, drive out ${res.driveout.detKept}/${res.driveout.det}`);
});

test('guide out, search, explore, track and return reach their bands', () => {
  const run = (goal, who, n) => Array.from({ length: n }, (_, k) => episode(k + 1, goal, who));
  const guide = run('guideout', 'visitor', 12), search = run('search', 'hider', 8), expl = run('explore', 'visitor', 6), track = run('track', 'intruder', 8), ret = run('return', 'visitor', 3);
  BANDS.other = { guide, search, expl, track, ret };
  const guided = guide.filter(e => e.M.guided > 0).length, found = search.filter(e => e.M.found > 0).length, mapped = expl.filter(e => e.M.mapped >= 0.9).length;
  const view = track.reduce((a, e) => a + 100 * e.M.seenT / Math.max(1e-9, e.M.totT), 0) / track.length;
  assert.ok(guided >= 5, `guide out: ${guided}/12 visitors out within 180 s`);
  assert.ok(found >= 7, `search: ${found}/8 hiders found`);
  assert.ok(mapped >= 2, `explore: ${mapped}/6 floors at least 90% mapped within 180 s`);
  assert.ok(view >= 40, `track: ${view.toFixed(0)}% in view`);
  console.log(`      guided ${guided}/12, found ${found}/8, mapped ${mapped}/6, track in view ${view.toFixed(0)}%`);
  assert.ok(ret.every(e => e.status === 'landed'), 'return: every drone lands');
});

test('safety on true positions: 1.2 m floor always, pressure band >= 1.2 m, comfort band >= 2.0 m unless he passes a drone giving way', () => {
  // Bands (docs/TACTICS.md): pressure (drive out; keep out at the door) commands 1.5 m and must never be below 1.2 m;
  // comfort (everything else, and visitors) commands 2.5 m and must stay at 2.0 m or more. In corridors a person who
  // walks or runs past a drone that is backing away can still come inside 2.0 m: that is counted, and allowed only
  // while the drone is not moving toward him (standoffApproach) and never below 1.4 m.
  const all = [...BANDS.intruder.keepout.viol, ...BANDS.intruder.driveout.viol, ...Object.values(BANDS.other).flat().map(e => e.M)];
  assert.ok(all.length >= 50, 'the band tests ran first');
  let pressureT = 0, passBy = 0;
  const num = v => (v == null ? Infinity : v); // episode() round-trips metrics through JSON, so Infinity arrives as null
  for (const M of all) {
    assert.strictEqual(+M.sepViol.toFixed(2), 0, `drones closer than 0.6 m for ${M.sepViol.toFixed(2)} s`);
    assert.strictEqual(+M.wallViol.toFixed(2), 0, `closer than 0.25 m to a wall for ${M.wallViol.toFixed(2)} s`);
    assert.strictEqual(+M.altViol.toFixed(2), 0, `above the altitude band for ${M.altViol.toFixed(2)} s`);
    assert.strictEqual(+M.floorViol.toFixed(2), 0, `a drone was within the 1.2 m floor for ${M.floorViol.toFixed(2)} s`);
    assert.ok(num(M.minPressure) >= 1.2, `pressure band: ${num(M.minPressure).toFixed(2)} m`);
    assert.ok(num(M.minComfort) >= 1.4, `comfort band: ${num(M.minComfort).toFixed(2)} m`);
    assert.ok(M.standoffApproach <= 0.5, `a drone moved toward a person inside its band's limit for ${M.standoffApproach.toFixed(2)} s`);
    pressureT += M.bandT.pressure; passBy += M.bandViol.comfort > 0;
  }
  assert.ok(pressureT > 60, `pressure band used for only ${pressureT.toFixed(0)} s`);
  assert.ok(passBy <= Math.ceil(0.25 * all.length), `${passBy}/${all.length} episodes where a person came inside 2.0 m of a comfort-band drone giving way`);
  console.log(`      pressure band ${pressureT.toFixed(0)} s near him; comfort pass-bys inside 2.0 m in ${passBy}/${all.length} episodes`);
});

test('records name the band; drive out uses pressure and visitors always comfort', () => {
  const d = episode(2, 'driveout', 'intruder', { secs: 60 }).recs, v = episode(2, 'guideout', 'visitor', { secs: 60 }).recs;
  assert.ok(d.length && d.every(r => r.label.band === 'pressure' || r.order.goal !== 'driveout'), 'drive out ticks are pressure');
  assert.ok(v.length && v.every(r => r.label.band === 'comfort'), 'a visitor is always comfort');
  const both = [1, 2, 3, 4, 5, 6].map(sd => episode(sd, 'keepout', 'intruder').recs).filter(k => k.some(r => r.label.band === 'comfort') && k.some(r => r.label.band === 'pressure' && r.order.goal === 'keepout'));
  assert.ok(both.length >= 2, `keep out switched from comfort to pressure in ${both.length} of 6 episodes`);
  for (const k of both) for (const r of k) if (r.label.band === 'pressure') assert.ok(r.obs.seen, 'pressure only while he is in sight');
});

test('same seed gives identical records, also after other episodes', () => {
  const h = () => crypto.createHash('sha256').update(JSON.stringify(episode(9, 'keepout', 'intruder', { secs: 60 }).recs)).digest('hex');
  const a = h(); episode(3, 'search', 'hider', { secs: 30 }); episode(4, 'guideout', 'visitor', { secs: 30 }); const b = h();
  assert.strictEqual(a, b);
  S.seed(9); S.world.reset({ layout: 'random' }); const w1 = JSON.stringify(S.getPlan().rooms);
  S.seed(10); S.world.reset({ layout: 'random' }); S.seed(9); S.world.reset({ layout: 'random' });
  assert.strictEqual(JSON.stringify(S.getPlan().rooms), w1, 'random floors depend only on the seed');
});

let failed = 0;
for (const t of tests) {
  const t0 = Date.now();
  try { t.fn(); console.log('ok   ', t.name, `(${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log('FAIL ', t.name, '\n      ', e.message); }
}
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
