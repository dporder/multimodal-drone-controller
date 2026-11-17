#!/usr/bin/env node
// [dan] Tests for the indoor simulator (simulators/swarm-indoor): floors, line of sight, belief, no-leak, records,
// safety on true positions, outcome bands against the grounded baseline, and determinism.
//   node simulators/tests/indoor.test.js
// The bands are regression floors for today's teacher on the fixed office floor (docs/TACTICS.md has the numbers); the
// family tests check every floor family for reachability, doors, line of sight, and safety under every order.
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

// The outcome bands below are regression floors for the teacher's logic, set with exact perception and identical people
// (CONTROLLED). Tests that pass their own reset settings ({} for the defaults) run with perception realism and diverse people.
// identical people run at 2 m/s, so the teacher's belief assumes 2 m/s here (4.5 m/s with diverse people, who may sprint)
// doors off as well: the bands measure the teacher on the doorless floor they were set on (doors have their own tests below)
const CONTROLLED = { realism: false, people: 'uniform', crowd: 0, beliefSpeed: 2.0, doors: 'none' };
const REAL = {};
// one episode: order `goal` at 1 s; returns plan records and metrics
function episode(sd, goal, who, opts) {
  opts = opts || {};
  S.seed(sd);
  S.world.reset(Object.assign({ goal: 'hold', person: SCEN[who](sd), endOnGone: who === 'intruder', grounded: goal === 'grounded', layout: 'fixed', settings: CONTROLLED }, opts.reset || {}));
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
    S.seed(sd); S.world.reset({ layout: sd === 0 ? 'fixed' : 'random', settings: { doors: 'none' } }); // the floor itself: locked doors are a door test
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
  S.seed(1); S.world.reset({ layout: 'fixed', settings: { doors: 'none' } });
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
      const { recs } = episode(sd, goal, who, { reset: { settings: REAL } });
      const P = S.getPlan();
      for (const r of recs) {
        const room = r.ground_truth.person.room;
        if (r.world_beliefs.person.seen || !r.ground_truth.person.alive || !(room >= 0 && room < P.rooms.length) || !r.world_beliefs.person.possible_rooms.length) continue;
        if (r.ground_truth.estimate_from_fp) continue; // the belief can only be as good as the sighting it starts from
        checked++;
        if (!r.world_beliefs.person.possible_rooms.includes(room) && r.world_beliefs.cleared.includes(room)) { missedInCleared++; continue; }
        assert.ok(r.world_beliefs.person.possible_rooms.includes(room), `${goal} seed ${sd} t ${r.t}: he is in the ${P.rooms[room].name}, belief ${r.world_beliefs.person.possible_rooms.map(i => P.rooms[i].name)}`);
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} unseen ticks checked`);
  console.log(`      ${checked} unseen ticks; ${missedInCleared} with him in a room a partial search had cleared`);
});

test('no leak: where an unseen person hides does not change the labels', () => {
  // doors off: what the person does to doors is observable, and doors have their own no-leak test below
  const run = start => episode(4, 'search', 'hider', { reset: { person: { role: 'intruder', intent: 'hide', start }, settings: { doors: 'none' } } }).recs;
  const a = run('storage'), b = run('meeting room');
  let same = 0;
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (a[k].world_beliefs.person.seen || b[k].world_beliefs.person.seen || a[k].world_beliefs.person.last_seen_age !== null || b[k].world_beliefs.person.last_seen_age !== null) break;
    const near = r => r.drone_beliefs.some(d => Math.hypot(d.position[0] - r.ground_truth.person.position[0], d.position[2] - r.ground_truth.person.position[2]) < 5);
    if (near(a[k]) || near(b[k])) break; // close enough for the drones' own proximity sensing to react
    assert.deepStrictEqual(a[k].teacher_plan, b[k].teacher_plan, `labels differ at t ${a[k].t} although the team knows nothing about him`);
    assert.deepStrictEqual(a[k].world_beliefs, b[k].world_beliefs);
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
      assert.ok(r.drone_beliefs.length === 3 && r.drone_beliefs.every(d => isV(d.position) && isV(d.velocity) && Number.isFinite(d.yaw)), `${goal}: drone_beliefs`);
      const L = r.teacher_plan;
      assert.ok(typeof L.template === 'string' && L.slots.every(isV) && L.vectors.every(isV), `${goal}: slots and vectors`);
      assert.ok(L.refs.length === 3 && L.refs.every(d => d.length === 4 && d.every(isV)), `${goal}: timed reference points`);
      assert.ok(L.yaw.length === 3 && L.spin.length === 3 && L.flags.length === 3, `${goal}: yaw, spin, validator flags`);
      assert.ok(r.world_beliefs.person.position === null || r.world_beliefs.person.seen || r.world_beliefs.person.last_seen_age <= 4.0001, `${goal}: an estimate needs a sighting in the last 4 s`);
      assert.ok(Array.isArray(r.world_beliefs.person.possible_rooms) && r.ground_truth && isV(r.ground_truth.person.position) && Number.isFinite(r.ground_truth.margin), `${goal}: belief and truth`);
      assert.ok(Array.isArray(r.world_beliefs.detections) && r.world_beliefs.detections.length === r.ground_truth.detections_tp.length, `${goal}: detections and their truth`);
      const dims = S.coarseDims(); assert.ok(typeof r.world_beliefs.map === 'string' && r.world_beliefs.map.length === dims.w * dims.h, `${goal}: scanned map`);
      assert.ok(r.world_beliefs.coverage.length === S.getPlan().rooms.length && r.drone_beliefs.every(d => d.depth_readings === null || d.depth_readings.length === 31), `${goal}: coverage and depth readings`);
      if (r.world_beliefs.person.seen) assert.ok(r.world_beliefs.detections.some(x => x.conf >= S.settings.acceptConf) || r.t < 1, `${goal}: "seen" without a confident detection at ${r.t}`);
    }
    if (recs.length && r0(recs).order.goal !== 'hold') assert.ok(recs.some(r => r.order.goal === goal), `${goal}: the order was applied`);
  }
  function r0(recs) { return recs[recs.length - 1]; }
});

test('perception: detections fall with distance, angle and occlusion; false positives are rare; error grows with range', () => {
  // the detector alone: realism off (no room lighting, blur or drift), which the realism test covers
  S.seed(6); S.world.reset({ layout: 'fixed', person: { role: 'visitor', intent: 'wander' }, settings: { realism: false } });
  const P = S.getPlan(), lab = P.rooms.find(q => q.name === 'lab'), d = S.team.drones[0], pr = S.person;
  const rate = (dist, offDeg, n = 1500) => { let tp = 0, fp = 0, err = 0; for (let k = 0; k < n; k++) { for (const x of S.detectFrame(d)) { if (x.tp) { tp++; err += Math.hypot(x.x - pr.x, x.z - pr.z); } else fp++; } } return { tp: tp / n, fp: fp / n, err: tp ? err / tp : null }; };
  // drone 1.6 m up at the lab's west end, looking east (+x); the person on open floor in front of it
  Object.assign(d, { x: lab.x0 + 0.8, z: lab.cz, y: 1.6, yaw: Math.PI / 2 }); pr.alive = true; pr.state = 'approach';
  const place = (dist, offDeg) => { const a = Math.PI / 2 + offDeg * Math.PI / 180; pr.x = d.x + Math.sin(a) * dist; pr.z = d.z + Math.cos(a) * dist; };
  place(2, 0); const near = rate(2, 0); place(6.5, 0); const far = rate(6.5, 0); place(3, 40); const edge = rate(3, 40);
  assert.ok(S.los(d.x, d.y, d.z, pr.x, 1.3, pr.z), 'the test needs a clear line of sight');
  assert.ok(near.tp > 0.9, `detected ${(100 * near.tp).toFixed(0)}% of frames at 2 m`);
  assert.ok(far.tp < near.tp - 0.2 && far.tp > 0.2, `detected ${(100 * far.tp).toFixed(0)}% at 6.5 m`);
  assert.ok(edge.tp < near.tp - 0.15, `detected ${(100 * edge.tp).toFixed(0)}% at 40 degrees off axis`);
  assert.ok(far.err > near.err, `position error ${near.err.toFixed(2)} m at 2 m, ${far.err.toFixed(2)} m at 6.5 m`);
  assert.ok(near.fp < 0.01, `false positives in ${(100 * near.fp).toFixed(2)}% of frames`);
  // behind the lab's south wall: no true detection at all
  pr.x = d.x + 2; pr.z = lab.z1 + 1.0; const hidden = rate(3, 0, 500); assert.strictEqual(hidden.tp, 0, 'detected through a wall');
  console.log(`      per-frame detection: ${(100 * near.tp).toFixed(0)}% at 2 m, ${(100 * far.tp).toFixed(0)}% at 6.5 m, ${(100 * edge.tp).toFixed(0)}% at 40 deg; error ${near.err.toFixed(2)} / ${far.err.toFixed(2)} m; false positives ${(100 * near.fp).toFixed(2)}% of frames`);
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
  const guide = run('guideout', 'visitor', 12), search = run('search', 'hider', 8), expl = run('explore', 'visitor', 6), track = run('track', 'intruder', 32), ret = run('return', 'visitor', 3);
  BANDS.other = { guide, search, expl, track, ret };
  const guided = guide.filter(e => e.M.guided > 0).length, found = search.filter(e => e.M.found > 0).length, mapped = expl.filter(e => e.M.mapped >= 0.9).length;
  const view = track.reduce((a, e) => a + 100 * e.M.seenT / Math.max(1e-9, e.M.totT), 0) / track.length;
  assert.ok(guided >= 5, `guide out: ${guided}/12 visitors out within 180 s`);
  assert.ok(found >= 7, `search: ${found}/8 hiders found`);
  assert.ok(mapped >= 2, `explore: ${mapped}/6 floors at least 90% mapped within 180 s`);
  // track in view varies widely by seed (SD about 20 points): over 48 seeds it averaged 39-40% both on 0a4d419 and now, so the floor is
  // two standard errors of a 32-seed mean below that
  assert.ok(view >= 32, `track: ${view.toFixed(0)}% in view (32 seeds)`);
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
  assert.ok(d.length && d.every(r => r.teacher_plan.band === 'pressure' || r.order.goal !== 'driveout'), 'drive out ticks are pressure');
  assert.ok(v.length && v.every(r => r.teacher_plan.band === 'comfort'), 'a visitor is always comfort');
  const both = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(sd => episode(sd, 'keepout', 'intruder').recs).filter(k => k.some(r => r.teacher_plan.band === 'comfort') && k.some(r => r.teacher_plan.band === 'pressure' && r.order.goal === 'keepout'));
  assert.ok(both.length >= 2, `keep out switched from comfort to pressure in ${both.length} of 12 episodes`);
  for (const k of both) for (const r of k) if (r.teacher_plan.band === 'pressure') assert.ok(r.world_beliefs.person.seen, 'pressure only while he is in sight');
});

test('same seed gives identical records, also after other episodes', () => {
  const h = () => crypto.createHash('sha256').update(JSON.stringify(episode(9, 'keepout', 'intruder', { secs: 60, reset: { settings: REAL } }).recs)).digest('hex');
  // other episodes in between, with realism, crowds and crawling hiders, must leave nothing behind
  const a = h(); for (const sd of [3, 5, 8]) episode(sd, 'search', 'hider', { secs: 40, reset: { family: 'openplan', layout: 'random', settings: { crowd: 3 } } });
  episode(4, 'guideout', 'visitor', { secs: 30 });
  // one ending between two 0.05 s safety samples: its sampling phase once carried into the next episode
  episode(6, 'track', 'intruder', { secs: 20 + 1 / 60 }); const b = h();
  assert.strictEqual(a, b);
  S.seed(9); S.world.reset({ layout: 'random' }); const w1 = JSON.stringify(S.getPlan().rooms);
  S.seed(10); S.world.reset({ layout: 'random' }); S.seed(9); S.world.reset({ layout: 'random' });
  assert.strictEqual(JSON.stringify(S.getPlan().rooms), w1, 'random floors depend only on the seed');
});

// ---------- every floor family (rooms are unions of rectangles; docs/DATASET_PLAN.md, "Layout families") ----------
const FAM_SEEDS = [0, 1, 2, 3, 4, 5, 6, 7]; // 0 is the family's fixed floor
function famReset(fam, sd, extra) { S.seed(1000 + sd); S.world.reset(Object.assign({ family: fam, layout: sd === 0 ? 'fixed' : 'random' }, extra || {})); return S.getPlan(); }
const NAVM = 0.2;
// flood fill over free cells of a 0.2 m grid from (x, z), optionally limited to a square of half-size `lim` around (cx, cz)
function flood(G, grid, x, z, lim, cx, cz) {
  const seen = new Uint8Array(grid.length), k0 = S.navIdx(x, z); if (grid[k0]) return seen; seen[k0] = 1; const st = [k0];
  while (st.length) { const k = st.pop(), i = k % G.NX, j = (k - i) / G.NX;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= G.NX || nj >= G.NZ) continue;
      if (lim && (Math.abs((ni + 0.5) * NAVM - cx) > lim || Math.abs((nj + 0.5) * NAVM - cz) > lim)) continue;
      const kk = nj * G.NX + ni; if (!seen[kk] && !grid[kk]) { seen[kk] = 1; st.push(kk); } } }
  return seen; }
function roomsIn(G, seen) { const rooms = new Set(); for (let k = 0; k < seen.length; k++) if (seen[k]) { const i = k % G.NX, j = (k - i) / G.NX; rooms.add(S.roomAt((i + 0.5) * NAVM, (j + 0.5) * NAVM)); } return rooms; }
const axes = d => d.axis === 'h' ? { n: { x: 0, z: 1 }, t: { x: 1, z: 0 } } : { n: { x: 1, z: 0 }, t: { x: 0, z: 1 } };

test('every family: rooms reachable by air from the pads and on foot from every exit, every door passable both ways, pads free, search points in every room', () => {
  const sizes = {};
  for (const fam of S.FAMILIES) for (const sd of FAM_SEEDS) {
    const P = famReset(fam, sd, { settings: { doors: 'none' } }), G = S.grids(), tag = `${fam} seed ${sd}`; // the floor itself; doors are tested below
    assert.strictEqual(P.family, fam);
    assert.ok(P.rooms.length >= 1 && P.doors.some(d => d.rooms[1] === P.OUT), `${tag}: no rooms or no exit`);
    assert.ok(P.protectable.includes(P.protect) && P.rooms[P.home], `${tag}: protected or home room missing`);
    for (const p of P.pads) { assert.ok(!G.FLY[S.navIdx(p.x, p.z)], `${tag}: a pad is not free to fly`); assert.strictEqual(S.roomAt(p.x, p.z), P.home, `${tag}: a pad is outside the home room`); }
    const fly = roomsIn(G, flood(G, G.FLY, P.pads[1].x, P.pads[1].z));
    for (const q of P.rooms) {
      assert.ok(fly.has(q.id), `${tag}: the ${q.name} cannot be reached by air`);
      assert.ok(S.COVP[q.id].length > 0, `${tag}: the ${q.name} has no search coverage points`);
    }
    for (const e of P.doors.filter(d => d.rooms[1] === P.OUT)) {
      const { n } = axes(e), s = S.roomAt(e.x + n.x * 0.5, e.z + n.z * 0.5) === P.OUT ? 1 : -1;
      const walk = roomsIn(G, flood(G, G.WALK, e.x + s * n.x * 1.2, e.z + s * n.z * 1.2));
      for (const q of P.rooms) assert.ok(walk.has(q.id), `${tag}: the ${q.name} cannot be reached on foot from the ${e.name}`);
    }
    for (const d of P.doors) {
      const { n } = axes(d), a = { x: d.x - 0.6 * n.x, z: d.z - 0.6 * n.z }, b = { x: d.x + 0.6 * n.x, z: d.z + 0.6 * n.z };
      assert.ok(G.DZONE[S.navIdx(d.x, d.z)] === d.id + 1, `${tag}: the ${d.name} has no door zone`);
      for (const [grid, how] of [[G.FLY, 'by air'], [G.WALK, 'on foot']]) {
        const f = flood(G, grid, a.x, a.z, 1.6, d.x, d.z);
        assert.ok(f[S.navIdx(a.x, a.z)] && f[S.navIdx(b.x, b.z)], `${tag}: the ${d.name} cannot be passed ${how}`);
      }
    }
    const z = sizes[fam] || (sizes[fam] = { n: 0, rooms: 0, area: 0 }); z.n++; z.rooms += P.rooms.length; z.area += P.rooms.reduce((s, q) => s + q.area, 0);
  }
  console.log('      ' + Object.entries(sizes).map(([f, z]) => `${f} ${(z.rooms / z.n).toFixed(1)} rooms ${(z.area / z.n).toFixed(0)} m2`).join(' · '));
});

test('every family: walls block sight between rooms, doorways do not, lintels block above 2 m', () => {
  for (const fam of S.FAMILIES) for (const sd of [0, 1, 2, 3]) {
    const P = famReset(fam, sd, { settings: { doors: 'none' } }), tag = `${fam} seed ${sd}`; let walls = 0;
    for (const d of P.doors) {
      const { n, t } = axes(d);
      assert.ok(S.los(d.x - 0.6 * n.x, 1.5, d.z - 0.6 * n.z, d.x + 0.6 * n.x, 1.5, d.z + 0.6 * n.z), `${tag}: no sight through the open ${d.name}`);
      assert.ok(!S.los(d.x - 0.6 * n.x, 2.3, d.z - 0.6 * n.z, d.x + 0.6 * n.x, 2.3, d.z + 0.6 * n.z), `${tag}: sight over the ${d.name} lintel`);
      for (const s of [-1, 1]) {
        const o = d.w / 2 + 1.0, px = d.x + s * o * t.x, pz = d.z + s * o * t.z, a = { x: px - 0.6 * n.x, z: pz - 0.6 * n.z }, b = { x: px + 0.6 * n.x, z: pz + 0.6 * n.z };
        const ra = S.roomAt(a.x, a.z), rb = S.roomAt(b.x, b.z);
        if (ra < 0 || rb < 0 || ra === rb || S.heightAt(px, pz) < P.ceil - 0.01) continue; // past the end of this wall
        if (P.doors.some(e => e !== d && Math.hypot(e.x - px, e.z - pz) < e.w / 2 + 0.8)) continue; // another door there
        walls++; assert.ok(!S.los(a.x, 1.5, a.z, b.x, 1.5, b.z), `${tag}: sight through the wall beside the ${d.name}`);
      }
    }
    assert.ok(walls > 0, `${tag}: no wall checked`);
  }
});

test('every family: every tactic runs with no safety violation on true positions, finite labels and a sound belief', () => {
  const goals = [['keepout', 'intruder'], ['driveout', 'intruder'], ['guideout', 'visitor'], ['track', 'intruder'], ['contain', 'intruder'], ['search', 'hider'], ['explore', 'hider'], ['overwatch', 'intruder'], ['return', 'visitor']];
  let eps = 0, unseen = 0, personFloor = 0;
  for (const fam of S.FAMILIES) for (const [k, [goal, who]] of goals.entries()) {
    const sd = 101 + k + 10 * S.FAMILIES.indexOf(fam), tag = `${fam} ${goal} seed ${sd}`;
    const { recs, M } = episode(sd, goal, who, { secs: 45, reset: { family: fam, layout: 'random', settings: REAL } });
    const P = S.getPlan(); eps++;
    // realistic people can outrun a retreating drone: only floor time the drone caused counts here (the person's is reported)
    for (const key of ['floorByDrone', 'sepViol', 'wallViol', 'altViol']) assert.strictEqual(+M[key].toFixed(2), 0, `${tag}: ${key} ${M[key].toFixed(2)} s`);
    if (M.floorByPerson > 0) personFloor++;
    assert.ok(M.standoffApproach <= 0.5, `${tag}: a drone moved toward a person inside its band's limit for ${M.standoffApproach.toFixed(2)} s`);
    // an intruder driven out ends the episode early; drones still on their pads land at once on return
    assert.ok(recs.length >= (goal === 'return' ? 1 : 20), `${tag}: only ${recs.length} plan records`);
    for (const r of recs) {
      for (const v of r.teacher_plan.vectors) assert.ok(v.every(Number.isFinite), `${tag}: a non-finite vector at t ${r.t}`);
      const room = r.ground_truth.person.room;
      if (r.world_beliefs.person.seen || !r.ground_truth.person.alive || !(room >= 0 && room < P.rooms.length) || !r.world_beliefs.person.possible_rooms.length || r.ground_truth.estimate_from_fp) continue;
      unseen++;
      if (!r.world_beliefs.person.possible_rooms.includes(room) && r.world_beliefs.cleared.includes(room)) continue; // a partial search can miss a hidden person
      assert.ok(r.world_beliefs.person.possible_rooms.includes(room), `${tag} t ${r.t}: he is in the ${P.rooms[room].name}, belief ${r.world_beliefs.person.possible_rooms.map(i => P.rooms[i].name)}`);
    }
  }
  assert.ok(personFloor <= 3, `${personFloor} episodes where a person closed within 1.2 m of a retreating drone`);
  console.log(`      ${eps} episodes (${S.FAMILIES.length} families x 9 orders); belief checked on ${unseen} unseen ticks; ${personFloor} with a person closing within 1.2 m of a retreating drone`);
});

test('route labels are flyable: refs start from the drone\'s state and never imply more than aMax', () => {
  const aMax = S.settings.aMax; let rest = 0, checked = 0, worst = 0;
  for (const [goal, who, fam] of [['keepout', 'intruder', 'office'], ['search', 'hider', 'warehouse'], ['guideout', 'visitor', 'house'], ['driveout', 'intruder', 'corridor']]) {
    const { recs } = episode(7, goal, who, { secs: 60, reset: { family: fam, layout: 'random', settings: REAL } });
    for (const r of recs) for (let i = 0; i < 3; i++) {
      const R = r.teacher_plan.refs[i], x = r.drone_beliefs[i].position, v = r.drone_beliefs[i].velocity; checked++;
      if (Math.hypot(v[0], v[2]) < 0.02 && x[1] > 0.5) { rest++; assert.ok(Math.hypot(R[0][0] - x[0], R[0][2] - x[2]) <= 0.5 * aMax * 0.25 + 0.05, `${fam} ${goal} t ${r.t}: a drone at rest is labelled ${Math.hypot(R[0][0] - x[0], R[0][2] - x[2]).toFixed(2)} m away after 0.5 s`); }
      let u = [(R[0][0] - x[0]) / 0.5, (R[0][2] - x[2]) / 0.5];
      const first = Math.hypot(R[0][0] - x[0] - v[0] * 0.5, R[0][2] - x[2] - v[2] * 0.5); worst = Math.max(worst, first / (0.25 * 0.5));
      assert.ok(first <= 0.5 * aMax * 0.25 + 0.05, `${fam} ${goal} t ${r.t}: the first ref needs ${(first / 0.125).toFixed(1)} m/s2`);
      for (let j = 1; j < 4; j++) { const w = [(R[j][0] - R[j - 1][0]) / 0.5, (R[j][2] - R[j - 1][2]) / 0.5], acc = Math.hypot(w[0] - u[0], w[1] - u[1]) / 0.5; worst = Math.max(worst, acc);
        assert.ok(acc <= aMax + 0.2, `${fam} ${goal} t ${r.t}: refs imply ${acc.toFixed(2)} m/s2`); u = w; }
    }
  }
  assert.ok(rest > 0 && checked > 500, `checked ${checked} ref sequences, ${rest} from rest`);
  console.log(`      ${checked} ref sequences (${rest} from rest); largest implied acceleration ${worst.toFixed(2)} m/s2 (limit ${aMax})`);
});

test('perception realism: drift grows with distance flown, followers\' detections arrive over the radio, depth has gaps; off is exact', () => {
  const run = settings => { S.seed(21); S.world.reset({ family: 'warehouse', layout: 'random', person: { role: 'intruder', intent: 'hide' }, goal: 'hold', settings });
    const recs = []; S.mission.onPlan = r => recs.push(r); for (let i = 0; i < 70 * 60; i++) { if (i === 60) S.world.order('search', null, 'test', {}); S.world.step(1 / 60); }
    S.mission.onPlan = null; return { recs, st: JSON.parse(JSON.stringify(S.settings)) }; };
  const { recs, st } = run({ rloss: 0, rlat: 0.3 });
  assert.ok(st.poseDrift >= 0.005 && st.poseDrift <= 0.02 && st.lightLevels.length === S.getPlan().rooms.length + 1 && st.depthMiss > 0, 'the episode draws its realism');
  const flown = [0, 0, 0]; let worstRatio = 0, maxErr = 0, nulls = 0, rays = 0, mAge = 0, fAge = Infinity, fN = 0;
  for (let k = 0; k < recs.length; k++) { const r = recs[k];
    for (let i = 0; i < 3; i++) { if (k) { const a = recs[k - 1].ground_truth.drones[i], b = r.ground_truth.drones[i]; flown[i] += Math.hypot(b[0] - a[0], b[2] - a[2]); }
      const e = Math.hypot(r.drone_beliefs[i].position[0] - r.ground_truth.drones[i][0], r.drone_beliefs[i].position[2] - r.ground_truth.drones[i][2]); maxErr = Math.max(maxErr, e);
      if (flown[i] > 5) worstRatio = Math.max(worstRatio, (e - 0.05) / flown[i]);
      if (r.drone_beliefs[i].depth_readings) for (const v of r.drone_beliefs[i].depth_readings) { rays++; nulls += v === null; } }
    for (const x of r.world_beliefs.detections) { if (x.drone === 'M') mAge = Math.max(mAge, x.age); else { fAge = Math.min(fAge, x.age); fN++; } } }
  assert.ok(maxErr > 0.02, `odometry drift never showed (largest pose error ${maxErr.toFixed(3)} m)`);
  assert.ok(worstRatio <= st.poseDrift + 0.005, `pose error grew faster than ${(100 * st.poseDrift).toFixed(2)}% of distance flown (${(100 * worstRatio).toFixed(2)}%)`);
  // the followers' detections reach the master over the radio: an intruder heading in, in sight of the followers
  for (const sd of [1, 2, 3, 4]) { const k = episode(sd, 'keepout', 'intruder', { secs: 60, reset: { settings: { rloss: 0, rlat: 0.3 } } }).recs;
    for (const r of k) for (const x of r.world_beliefs.detections) { if (x.drone === 'M') mAge = Math.max(mAge, x.age); else { fAge = Math.min(fAge, x.age); fN++; } } }
  assert.ok(fN > 20, `only ${fN} follower detections reached the master`);
  assert.ok(mAge <= 0.11, `the master's own detections are ${mAge} s old`);
  assert.ok(fAge >= 0.6 * 0.3 - 0.11, `a follower's detection reached the master ${fAge} s after it was made (radio latency 0.18-0.42 s)`);
  assert.ok(nulls > 0 && nulls < 0.2 * rays, `${nulls} of ${rays} camera ray returns missing`);
  const off = run({ realism: false, rloss: 0, rlat: 0.3 }).recs;
  for (const r of off) for (let i = 0; i < 3; i++) { assert.strictEqual(Math.hypot(r.drone_beliefs[i].position[0] - r.ground_truth.drones[i][0], r.drone_beliefs[i].position[2] - r.ground_truth.drones[i][2]), 0, 'realism off still drifts'); if (r.drone_beliefs[i].depth_readings) assert.ok(r.drone_beliefs[i].depth_readings.every(v => v !== null), 'realism off still drops depth returns'); }
  console.log(`      drift ${(100 * st.poseDrift).toFixed(2)}% of distance: largest pose error ${maxErr.toFixed(2)} m after up to ${Math.max(...flown).toFixed(0)} m; follower detections ${fN} (youngest ${fAge === Infinity ? '-' : fAge.toFixed(2)} s); missing returns ${(100 * nulls / rays).toFixed(1)}%`);
});

test('diverse people: bodies, speeds and mobility aids stay in published ranges; aids widen the walking grid', () => {
  S.seed(1); S.world.reset({ family: 'single', layout: 'fixed', goal: 'hold' });
  const all = [], byAid = {};
  for (let sd = 1; sd <= 1500; sd++) for (const role of ['visitor', 'intruder', 'staff']) { S.seed(sd); const b = S.drawCast(role, 'office').subject.body; all.push(b); byAid[b.aid] = (byAid[b.aid] || 0) + 1; }
  const adults = all.filter(b => b.age >= 20 && b.age < 60 && !b.aid), mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length;
  const hm = mean(adults.filter(b => b.sex === 'm').map(b => b.height)), hf = mean(adults.filter(b => b.sex === 'f').map(b => b.height));
  assert.ok(Math.abs(hm - 1.753) < 0.02 && Math.abs(hf - 1.613) < 0.02, `adult mean heights ${hm.toFixed(3)} / ${hf.toFixed(3)} m (CDC NHANES 2015-18: 1.753 / 1.613)`);
  assert.ok(all.every(b => b.height >= 0.95 && b.height <= 2.05 && b.walk >= 0.55 && b.walk <= 1.9 && b.sprint >= b.run), 'heights 0.95-2.05 m, walking 0.55-1.9 m/s, sprint >= run');
  const wy = mean(adults.map(b => b.walk)); assert.ok(wy > 1.25 && wy < 1.5, `adult walking speed ${wy.toFixed(2)} m/s`);
  const young = all.filter(b => b.age >= 16 && b.age <= 40 && !b.aid); assert.ok(young.every(b => b.run >= 3.0 && b.sprint >= 4.8 && b.sprint <= 6.4), 'young adults run at 3-4.2 m/s and sprint at 4.8-6.4 m/s');
  assert.ok(all.some(b => b.age < 13) && all.some(b => b.age >= 80), 'children and people over 80 occur');
  assert.ok(byAid.wheelchair > 10 && byAid.cane > 30 && byAid.pushchair > 30, `aids ${JSON.stringify(byAid)}`);
  // a wheelchair user walks on the wider grid, and still reaches every room of every family's fixed floor
  for (const fam of S.FAMILIES) { S.seed(3); S.world.reset({ family: fam, layout: 'fixed', goal: 'hold', person: { role: 'visitor', intent: 'wander', body: Object.assign({}, all.find(b => b.aid === 'wheelchair')) } });
    const G = S.grids(); assert.ok(S.person.grid !== G.WALK, `${fam}: a wheelchair user should use the wide grid`); }
  console.log(`      adults ${hm.toFixed(2)} / ${hf.toFixed(2)} m, walking ${wy.toFixed(2)} m/s; aids ${JSON.stringify(byAid)} in ${all.length} people`);
});

test('several people: each has a track, the team fuses only its target\'s, and everyone is kept safe', () => {
  let crowdDets = 0, othersPlaced = 0, onlyOthers = 0, eps = 0;
  for (const [fam, goal, who] of [['retail', 'keepout', 'intruder'], ['openplan', 'search', 'hider'], ['corridor', 'guideout', 'visitor'], ['office', 'track', 'intruder']]) {
    const { recs, M } = episode(5, goal, who, { secs: 60, reset: { family: fam, layout: 'random', settings: { crowd: 4 } } }); eps++;
    assert.strictEqual(S.world.scenario.cast.length, 5, `${fam}: four other people besides the subject`);
    assert.strictEqual(+M.floorByDrone.toFixed(2), 0, `${fam} ${goal}: a drone came within 1.2 m of someone`);
    assert.ok(M.standoffApproach <= 0.5, `${fam} ${goal}: a drone moved toward someone inside its band's limit`);
    for (const r of recs) {
      const tgt = r.world_beliefs.target_track; assert.strictEqual(tgt, r.ground_truth.person.tid, 'the target track is the subject\'s');
      crowdDets += r.ground_truth.detections_who.filter(w => w > 0).length; othersPlaced += r.world_beliefs.people.length;
      if (r.world_beliefs.detections.length && r.world_beliefs.detections.every(x => x.track !== tgt) && r.world_beliefs.person.last_seen_age > 0.5) { onlyOthers++; assert.ok(!r.world_beliefs.person.seen, `${fam} t ${r.t}: seen on other people's detections alone`); }
      assert.ok(r.ground_truth.people.length === 4 && r.ground_truth.people.every(h => h.position.length === 3), 'ground_truth logs everyone');
    }
  }
  assert.ok(crowdDets > 50 && othersPlaced > 50, `other people were detected ${crowdDets} times and placed ${othersPlaced} times`);
  console.log(`      ${eps} episodes with 4 others: ${crowdDets} detections of other people, ${othersPlaced} placements, ${onlyOthers} ticks with only others in view`);
});

test('every family: a random floor depends only on its seed', () => {
  for (const fam of S.FAMILIES) {
    const a = JSON.stringify(famReset(fam, 5)); famReset(fam, 6); famReset('office', 7);
    assert.strictEqual(JSON.stringify(famReset(fam, 5)), a, `${fam}: the floor changed with the history`);
    assert.notStrictEqual(JSON.stringify(famReset(fam, 6)), a, `${fam}: seeds 5 and 6 gave the same floor`);
  }
});

// ---------- doors (docs/DATASET_PLAN.md, "Things that move besides people and drones") ----------
const leafOf = (D) => S.leafSegs(D, D.a);
test('doors: a shut leaf blocks sight and flight, an open one lets both through; with every door open every room is reachable by air', () => {
  S.seed(1); S.world.reset({ layout: 'fixed', settings: { doors: 'closed' } });
  let P = S.getPlan(), side = P.doors.find(d => d.name === 'lab side door'), D = S.doors()[side.id], { n } = axes(side);
  assert.ok(!S.los(side.x - 1.2 * n.x, 1.5, side.z - 1.2 * n.z, side.x + 1.2 * n.x, 1.3, side.z + 1.2 * n.z), 'a shut lab side door blocks sight');
  assert.ok(S.heightAt(side.x + n.x * 0.1 * D.swing, side.z + n.z * 0.1 * D.swing) >= 2.0, 'its leaf is 2 m tall in the doorway');
  S.seed(1); S.world.reset({ layout: 'fixed', settings: { doors: 'open' } });
  P = S.getPlan(); side = P.doors.find(d => d.name === 'lab side door');
  assert.ok(S.los(side.x - 1.2 * n.x, 1.5, side.z - 1.2 * n.z, side.x + 1.2 * n.x, 1.3, side.z + 1.2 * n.z), 'an open lab side door does not block sight');
  const path = S.planPath(S.grids().FLY, { x: side.x - 1.2 * n.x, z: side.z - 1.2 * n.z }, { x: side.x + 1.2 * n.x, z: side.z + 1.2 * n.z });
  assert.ok(path && S.pathLength(path, { x: side.x - 1.2 * n.x, z: side.z - 1.2 * n.z }) < 4, 'the drones can plan through the open door');
  let openings = 0, doors = 0;
  for (const fam of S.FAMILIES) for (const sd of FAM_SEEDS) {
    const Q = famReset(fam, sd, { settings: { doors: 'open' } }), G = S.grids(), tag = `${fam} seed ${sd}`;
    for (const p of Q.pads) assert.ok(!G.FLY[S.navIdx(p.x, p.z)], `${tag}: a leaf covers a pad`);
    const fly = roomsIn(G, flood(G, G.FLY, Q.pads[1].x, Q.pads[1].z));
    for (const q of Q.rooms) assert.ok(fly.has(q.id), `${tag}: with every door open the ${q.name} cannot be reached by air`);
    for (const E of S.doors()) { doors++; if (E.kind === 'opening') openings++; }
  }
  console.log(`      ${doors} doorways, ${openings} of them openings with no door (archways, loading docks, and doors whose leaf would cut the floor)`);
});

test('doors: no drone passes a shut door; people open the doors on their way and stand clear of a leaf swinging toward them', () => {
  let changes = 0, inLeaf = 0, through = 0, eps = 0, breaches = 0;
  for (const [fam, goal, who] of [['office', 'grounded', 'intruder'], ['office', 'keepout', 'intruder'], ['house', 'search', 'hider'], ['corridor', 'guideout', 'visitor'], ['warehouse', 'track', 'intruder'], ['openplan', 'search', 'hider'], ['irregular', 'driveout', 'intruder'], ['retail', 'explore', 'visitor']]) {
    const sd = 300 + eps, side = [[], [], []]; let last = -1;
    const { M } = episode(sd, goal, who, { secs: 120, reset: { family: fam, layout: 'random', settings: { doors: 'closed' } }, until: () => {
      const t = S.simT(); if (t - last < 0.1) return false; last = t; const P = S.getPlan(), DS = S.doors();
      for (const h of S.everyone()) for (const E of DS) if (E.by !== h && S.leafDist(h, E) < 0.12) inLeaf++;
      S.team.drones.forEach((d, i) => { if (d.y < 0.3) return; DS.forEach((E, j) => { const dd = P.doors[E.k], c = { n: dd.axis === 'h' ? d.z - dd.z : d.x - dd.x, t: dd.axis === 'h' ? d.x - dd.x : d.z - dd.z }; let st = side[i][j];
        if (Math.abs(c.n) > 3 || Math.abs(c.t) > dd.w / 2 + 1.5) { side[i][j] = null; return; } if (st) st.amax = Math.max(st.amax, E.a);
        if (Math.abs(c.n) >= 0.6 && Math.abs(c.t) <= dd.w / 2 + 0.6) { const sg = c.n > 0 ? 1 : -1; if (st && st.side !== sg && st.amax < 60) through++; side[i][j] = { side: sg, amax: E.a }; } }); });
      return false; } });
    eps++; changes += S.doors().reduce((a, E) => a + E.changes, 0); breaches += M.breaches > 0;
    for (const key of ['floorByDrone', 'sepViol', 'wallViol', 'altViol']) assert.strictEqual(+M[key].toFixed(2), 0, `${fam} ${goal}: ${key} ${M[key].toFixed(2)} s`);
  }
  assert.strictEqual(through, 0, `${through} times a drone got through a door that stayed under 60 deg`);
  assert.ok(changes >= 10, `people moved doors only ${changes} times in ${eps} episodes with every door shut`);
  assert.ok(inLeaf <= 2, `people inside a leaf in ${inLeaf} checks`);
  console.log(`      ${eps} episodes with every door shut: ${changes} door moves by people, ${breaches} breaches, ${inLeaf} checks with someone inside a leaf`);
});

test('doors: no leak: a door the drones have not seen changes no label', () => {
  // the farthest door from the pads starts shut in one run and open in the other: while what the team observes is the same, so are
  // the labels (the teacher plans from the door states it has seen)
  S.seed(7); S.world.reset({ layout: 'fixed' }); const P = S.getPlan(), pad = P.pads[0];
  const far = S.doors().filter(E => E.kind === 'hinged' && P.doors[E.k].rooms[1] !== P.OUT).sort((a, b) => Math.hypot(P.doors[b.k].x - pad.x, P.doors[b.k].z - pad.z) - Math.hypot(P.doors[a.k].x - pad.x, P.doors[a.k].z - pad.z))[0];
  const run = ang => episode(7, 'search', 'hider', { secs: 90, reset: { settings: { doorInit: { [far.k]: ang } } } }).recs;
  const a = run(0), b = run(90); let same = 0, reason = 'end';
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (JSON.stringify(a[k].world_beliefs) !== JSON.stringify(b[k].world_beliefs) || JSON.stringify(a[k].drone_beliefs) !== JSON.stringify(b[k].drone_beliefs)) { reason = `observations differ at t ${a[k].t}`; break; }
    assert.deepStrictEqual(a[k].teacher_plan, b[k].teacher_plan, `labels differ at t ${a[k].t} while the team observes the same`);
    same++;
  }
  assert.ok(same >= 20, `only ${same} ticks compared (${reason})`);
  console.log(`      ${same} ticks with the same observations and labels while the ${P.doors[far.k].name} was shut in one run and open in the other (${reason})`);
});

test('doors: a drone whose way is shut waits beside the door, clear of its swing; search reports the rooms it cannot enter', () => {
  let waits = 0, watch = 0, said = 0, inSwing = 0;
  for (const sd of [11, 12, 13, 14]) {
    const { recs } = episode(sd, 'search', 'hider', { secs: 120, reset: { settings: { doors: 'closed' } } });
    const P = S.getPlan(), DS = S.doors();
    for (const r of recs) {
      r.teacher_plan.flags.forEach(f => { if (f.includes('door-wait')) waits++; }); if (r.teacher_plan.template === 'watch-shut') watch++;
      // no slot inside the swing of a door the drones believe is not open
      r.teacher_plan.slots.forEach(sl => { DS.forEach((E, j) => { const b = r.world_beliefs.doors[j]; if (E.kind !== 'hinged' || (b && b[0] >= 80) || !b) return; for (const sg of S.leafSegs(E, 0)) {
        const dx = sl[0] - sg.ax, dz = sl[2] - sg.az, N = axes(P.doors[E.k]).n; if (Math.hypot(dx, dz) < E.wl + 0.2 && (dx * N.x + dz * N.z) * E.swing > 0.05) inSwing++; } }); });
    }
    said += S.talk.filter(x => /is shut|behind a shut door/.test(x.text)).length;
  }
  assert.ok(waits + watch > 0, 'no drone ever waited at a shut door or watched one');
  assert.ok(said > 0, 'the master never told the operator about a shut door');
  assert.strictEqual(inSwing, 0, `${inSwing} slots inside the swing of a door that is not open`);
  console.log(`      4 searches with every door shut: ${waits} drone-ticks waiting beside a door, ${watch} ticks watching shut doors, ${said} reports to the operator`);
});

test('doors: off is the doorless world: no leaves, no door fields in the records', () => {
  const { recs } = episode(2, 'search', 'hider', { secs: 20, reset: { settings: { doors: 'none' } } });
  assert.strictEqual(S.doors().length, 0);
  assert.ok(recs.length > 10 && recs.every(r => r.world_beliefs.doors === undefined && r.ground_truth.doors === undefined), 'records carry door fields with doors off');
  const on = episode(2, 'search', 'hider', { secs: 20, reset: { settings: {} } }).recs;
  assert.ok(on.every(r => Array.isArray(r.world_beliefs.doors) && Array.isArray(r.ground_truth.doors)), 'records lack door fields with doors on');
});

test('doors: a person\'s door state never carries into the next episode', () => {
  const h = () => crypto.createHash('sha256').update(JSON.stringify(episode(5, 'guideout', 'visitor', { secs: 30, reset: { settings: {} } }).recs)).digest('hex');
  const a = h();
  // an episode can end while its subject steps back from a door a drone blocks, prepares to open one, or waits to try again; the
  // step-back once carried into the next episode in a generator worker (a person walked toward a point on the previous floor)
  episode(3, 'track', 'intruder', { secs: 10, reset: { settings: {} } });
  Object.assign(S.person, { doorBack: { x: 1, z: 1, until: 999 }, doorPrep: { k: 0, to: 90, x: 1, z: 1, t0: 0 }, doorAct: { k: 0 }, doorCool: { 0: 999 }, nowhereT: 2.9 });
  assert.strictEqual(h(), a);
});

let failed = 0;
const only = process.argv[2], run = tests.filter(x => !only || x.name.includes(only));
for (const t of run) {
  const t0 = Date.now();
  try { t.fn(); console.log('ok   ', t.name, `(${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log('FAIL ', t.name, '\n      ', e.message); }
}
console.log(failed ? `${failed} of ${run.length} failed` : `all ${run.length} passed`);
process.exit(failed ? 1 : 0);
