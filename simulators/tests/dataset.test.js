#!/usr/bin/env node
// [dan] Tests for the dataset hooks added to Swarm Mind's core (docs/DATASET_PLAN.md):
// determinism, record schema, the drive-out push, spoken orders and batch-episode options.
//   node simulators/tests/dataset.test.js
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

const MIND = path.join(__dirname, '..', 'swarm-mind', 'index.html');
const S = loadCore(MIND);

// one episode: seed, reset, optional scripted orders [{t, goal, text}], collect plan records
function episode(seedN, opts, secs, orders) {
  S.seed(seedN);
  S.world.reset(Object.assign({ endOnGone: true, mode: 'mind' }, opts));
  const recs = [];
  S.mission.onPlan = r => recs.push(r);
  const queue = (orders || []).slice();
  let t = 0;
  for (let i = 0; i < secs * 60 && !S.world.ended; i++) {
    while (queue.length && queue[0].t <= t) { const o = queue.shift(); S.world.order(o.goal, o.text, 'test'); }
    S.world.step(1 / 60); t += 1 / 60;
  }
  S.mission.onPlan = null;
  return { recs, metrics: Object.assign({}, S.metrics), ended: S.world.ended, intruder: S.intruder.state };
}
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('same seed gives identical records', () => {
  const a = episode(7, { goal: 'driveout' }, 120).recs, b = episode(7, { goal: 'driveout' }, 120).recs;
  assert.ok(a.length > 50, 'expected a plan record every 0.5 s, got ' + a.length);
  assert.strictEqual(sha(a), sha(b));
  const c = episode(8, { goal: 'driveout' }, 120).recs;
  assert.notStrictEqual(sha(a), sha(c), 'different seeds should differ');
});

test('every plan record matches contract v0', () => {
  const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  for (const goal of ['keepout', 'driveout', 'track', 'hold']) {
    const { recs } = episode(3, { goal }, 60);
    for (const r of recs) {
      assert.strictEqual(r.type, 'plan');
      assert.ok(Number.isFinite(r.t) && Number.isInteger(r.tick));
      assert.ok(r.order && r.order.goal === goal && Number.isInteger(r.order.version));
      assert.ok(typeof r.obs.seen === 'boolean');
      assert.ok(r.obs.p === null || isVec3(r.obs.p));
      assert.ok(r.obs.last_seen_age === null || Number.isFinite(r.obs.last_seen_age));
      assert.strictEqual(r.team.length, 3);
      for (const d of r.team) assert.ok(['M', 'S1', 'S2'].includes(d.id) && isVec3(d.pos) && isVec3(d.vel));
      assert.ok(['hold', 'search', 'barrier', 'push', 'track'].includes(r.label.template), r.label.template);
      assert.strictEqual(r.label.slots.length, 3); assert.strictEqual(r.label.vectors.length, 3);
      r.label.slots.forEach(isVec3); r.label.vectors.forEach(v => assert.ok(isVec3(v)));
      // vector = slot − position at plan time
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++)
        assert.ok(Math.abs(r.label.slots[i][k] - r.team[i].pos[k] - r.label.vectors[i][k]) < 0.01, 'vector must equal slot − position');
      assert.strictEqual(r.radio.length, 2);
      assert.ok(r.truth && isVec3(r.truth.intruder.pos), 'truth is logged for metrics');
      // the observation never contains the person's position when nothing has seen him recently
      if (!r.obs.seen && r.obs.p) assert.ok(r.obs.last_seen_age <= 4, 'stale sighting used: ' + r.obs.last_seen_age);
    }
  }
});

test('drive out pushes from behind, toward the exit', () => {
  let behind = 0, n = 0;
  for (let sd = 1; sd <= 10; sd++) {
    for (const r of episode(sd, { goal: 'driveout' }, 120).recs) {
      if (r.label.template !== 'push' || !r.obs.p) continue;
      const p = r.obs.p, e = r.label.exit; assert.ok(e && /fence/.test(e.name));
      const gx = e.x - p[0], gz = e.z - p[2];
      for (const k of [1, 2]) { n++; const s = r.label.slots[k]; if ((s[0] - p[0]) * gx + (s[2] - p[2]) * gz < 0) behind++; }
    }
  }
  assert.ok(n > 100, 'expected push records');
  assert.ok(behind / n >= 0.8, 'slaves behind him in ' + (100 * behind / n).toFixed(0) + '% of push slots (want ≥ 80%)');
});

test('drive out and keep out beat the hold baseline (breaches per episode)', () => {
  const rate = goal => { let br = 0; for (let sd = 1; sd <= 10; sd++) if (episode(sd, { goal }, 180).metrics.breaches > 0) br++; return br / 10; };
  const hold = rate('hold'), drive = rate('driveout'), keep = rate('keepout');
  assert.ok(hold - drive >= 0.5, `hold ${hold} vs driveout ${drive}`);
  assert.ok(hold - keep >= 0.5, `hold ${hold} vs keepout ${keep}`);
});

test('spoken orders change the goal, raise the version and carry their words', () => {
  const { recs } = episode(5, { goal: 'hold' }, 40, [
    { t: 5, goal: 'driveout', text: 'drive him out of the yard' },
    { t: 20, goal: 'track', text: 'follow him' },
  ]);
  const at = t => recs.find(r => r.t >= t);
  assert.strictEqual(at(1).order.version, 0);
  assert.strictEqual(at(6).order.goal, 'driveout'); assert.strictEqual(at(6).order.version, 1); assert.strictEqual(at(6).order.text, 'drive him out of the yard');
  assert.strictEqual(at(21).order.goal, 'track'); assert.strictEqual(at(21).order.version, 2);
  assert.strictEqual(S.world.order('fly to the moon', 'nonsense', 'test'), false, 'unknown goals are rejected');
  const said = S.talk.filter(l => l.who === 'master' && /Order v\d accepted/.test(l.text));
  assert.ok(said.length >= 2, 'the master acknowledges each accepted order');
});

test('reset options: fixed crossing point and episode end', () => {
  S.seed(1); S.world.reset({ goal: 'keepout', spawn: { side: 'S', c: 30 }, endOnGone: true });
  assert.ok(Math.abs(S.intruder.sx - 30) < 3.5 && S.intruder.sz > 40, `spawned at (${S.intruder.sx.toFixed(1)}, ${S.intruder.sz.toFixed(1)})`);
  const r = episode(2, { goal: 'keepout' }, 400);
  assert.ok(r.ended, 'episode ends once the intruder has left');
  S.world.reset(); // back to Prat's defaults (endOnGone off)
  assert.strictEqual(S.world.endOnGone, false);
});

let failed = 0;
for (const t of tests) {
  const t0 = Date.now();
  try { t.fn(); console.log('ok   ', t.name, `(${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log('FAIL ', t.name, '\n      ', e.message); }
}
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
