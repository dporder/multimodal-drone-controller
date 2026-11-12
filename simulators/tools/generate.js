#!/usr/bin/env node
// [dan] Batch episode generator (docs/DATASET_PLAN.md).
// Runs Swarm Mind's sim-core headless for every episode in an orders file written by voice/sampler.py, and writes
// one gzipped JSON-lines file per episode in contract v0 (header, order events and plan ticks in time order,
// outcome) plus a manifest and a summary. The teacher executes the sampler's intended order, never the parser's.
//
//   node simulators/tools/generate.js --orders output/dataset/run1/orders.jsonl [--workers 7] [--baseline]
//
// --baseline also runs every seed with the drones holding on their pads and no orders, for paired comparisons.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const os = require('os');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SIMS = { mind: path.join(__dirname, '..', 'swarm-mind', 'index.html') };

function loadCore(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('sim-core script not found in ' + file);
  const ctx = { module: { exports: {} }, Math, console, Infinity, NaN, Array, Set, Map, Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Object, parseInt, parseFloat, isFinite, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx, { filename: path.basename(file) });
  return { S: ctx.module.exports, sha: crypto.createHash('sha256').update(m[1]).digest('hex').slice(0, 16) };
}

function situation(S) {
  return { inside: !!S.intruder.inside, seen: !!S.intruder.seen, alive: !!S.intruder.alive, state: S.intruder.state, goal: S.mission.goal, version: S.mission.version };
}

function applyOrder(S, o, t) {
  const it = o.intended, before = situation(S);
  let applied = false, reason = null;
  if (it.action === 'accept' && it.goal) {
    if (o.context_dependent && S.intruder.inside) reason = 'context: he is inside, so this order is a question';
    else applied = S.world.order(it.goal, o.text, 'sampler');
  } else if (it.action === 'accept' && it.turn) { S.brain.issue(it.turn, 'sampler'); applied = true; }
  else reason = it.action; // refuse or query: the goal does not change
  return { type: 'order', t: +t.toFixed(3), text: o.text, template: o.template, style: o.style, held_out: o.held_out,
    intended: it, parser: o.parser, mismatch: o.mismatch, applied, reason, situation: before };
}

function outcomeOf(S, t, ended) {
  const m = S.metrics;
  return { type: 'outcome', t_end: +t.toFixed(2), end: ended ? 'gone' : 'timeout', breaches: m.breaches, deterred: m.deterred,
    left_without_breach: m.deterred > 0 && m.breaches === 0, in_view_pct: m.totT ? +(100 * m.seenT / m.totT).toFixed(1) : 0,
    radio_drops: m.rdrop || 0, pushes: S.intruder.pushes || 0, turn_cmds: m.cmds };
}

function runEpisode(S, sha, ep, baseline) {
  const secs = ep.scenario.secs || 180, dt = 1 / 60;
  const g0 = baseline ? 'hold' : ((ep.orders[0] && ep.orders[0].intended.goal) || 'hold');
  S.seed(ep.seed);
  S.world.reset({ settings: ep.scenario.settings, mode: ep.scenario.mode || 'mind', goal: g0, endOnGone: true });
  const out = [];
  if (!baseline) {
    out.push({ type: 'header', schema: 'dmc.contract.v0', sim: 'swarm-mind', core_sha: sha, seed: ep.seed, episode: ep.episode, split: ep.split,
      frame: 'x east, z south, y up, metres; site 48 x 44 m', doors: S.DOORS.map((d, i) => ({ id: i, name: d.name, x: d.x, z: d.z })),
      scenario: ep.scenario, orders: ep.orders });
    S.mission.onPlan = r => out.push(r);
  }
  const queue = baseline ? [] : ep.orders.slice();
  let t = 0, i = 0;
  for (; i < secs * 60 && !S.world.ended; i++) {
    while (queue.length && queue[0].t <= t + 1e-9) out.push(applyOrder(S, queue.shift(), t));
    S.world.step(dt); t += dt;
  }
  S.mission.onPlan = null;
  const outcome = outcomeOf(S, t, S.world.ended);
  if (!baseline) out.push(outcome);
  return { out, outcome };
}

function dominantGoal(out) {
  const dur = {}; let last = null;
  for (const r of out) if (r.type === 'plan') { if (last) dur[last.goal] = (dur[last.goal] || 0) + (r.t - last.t); last = { goal: r.order.goal, t: r.t }; }
  return Object.keys(dur).sort((a, b) => dur[b] - dur[a])[0] || 'hold';
}

if (!isMainThread) {
  const { file, episodes, outDir, baseline } = workerData;
  const { S, sha } = loadCore(file);
  for (const ep of episodes) {
    const { out, outcome } = runEpisode(S, sha, ep, false);
    const body = out.map(r => JSON.stringify(r)).join('\n') + '\n';
    const name = path.join('episodes', ep.episode + '.jsonl.gz');
    fs.writeFileSync(path.join(outDir, name), zlib.gzipSync(body, { level: 6 }));
    const row = { episode: ep.episode, seed: ep.seed, split: ep.split, file: name, sha256: crypto.createHash('sha256').update(body).digest('hex'),
      plan_records: out.filter(r => r.type === 'plan').length, orders: out.filter(r => r.type === 'order').length,
      goal: dominantGoal(out), outcome };
    if (baseline) row.baseline = runEpisode(S, sha, ep, true).outcome;
    parentPort.postMessage(row);
  }
  parentPort.postMessage(null);
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const ordersFile = arg('orders', 'output/dataset/run1/orders.jsonl');
  const outDir = arg('out', path.dirname(ordersFile));
  const nWorkers = Math.max(1, parseInt(arg('workers', String(Math.max(1, os.cpus().length - 1))), 10));
  const baseline = process.argv.includes('--baseline');
  const sim = arg('sim', 'mind');
  const eps = fs.readFileSync(ordersFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  fs.mkdirSync(path.join(outDir, 'episodes'), { recursive: true });
  const t0 = Date.now(); const rows = []; let done = 0;
  const chunks = Array.from({ length: nWorkers }, (_, k) => eps.filter((_, i) => i % nWorkers === k)).filter(c => c.length);
  let live = chunks.length;
  for (const episodes of chunks) {
    const w = new Worker(__filename, { workerData: { file: SIMS[sim], episodes, outDir, baseline } });
    w.on('message', row => {
      if (row === null) { if (--live === 0) finish(); return; }
      rows.push(row); done++;
      if (done % 25 === 0 || done === eps.length) process.stdout.write(`  ${done}/${eps.length} episodes\r`);
    });
    w.on('error', e => { console.error(e); process.exit(1); });
  }
  function finish() {
    rows.sort((a, b) => a.episode.localeCompare(b.episode));
    fs.writeFileSync(path.join(outDir, 'manifest.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const by = {};
    for (const r of rows) {
      const g = by[r.goal] || (by[r.goal] = { n: 0, breach: 0, clean: 0, view: 0, bBreach: 0, bN: 0 });
      g.n++; g.breach += r.outcome.breaches > 0; g.clean += r.outcome.left_without_breach; g.view += r.outcome.in_view_pct;
      if (r.baseline) { g.bN++; g.bBreach += r.baseline.breaches > 0; }
    }
    const lines = [`${rows.length} episodes, ${rows.reduce((a, r) => a + r.plan_records, 0)} plan records, ${rows.reduce((a, r) => a + r.orders, 0)} order events, ` +
      `${rows.filter(r => r.split === 'test').length} test episodes, ${((Date.now() - t0) / 1000).toFixed(1)} s on ${chunks.length} workers`,
      'goal (longest active)  episodes  breached  left without breach  in view' + (baseline ? '  | hold baseline breached (same seeds)' : '')];
    for (const [g, s] of Object.entries(by).sort()) lines.push(`${g.padEnd(22)} ${String(s.n).padStart(8)}  ${(100 * s.breach / s.n).toFixed(0).padStart(7)}%  ${(100 * s.clean / s.n).toFixed(0).padStart(18)}%  ${(s.view / s.n).toFixed(0).padStart(6)}%` +
      (baseline ? `  | ${(100 * s.bBreach / s.bN).toFixed(0)}%` : ''));
    const mis = rows.length ? null : 0;
    fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    console.log(`wrote ${outDir}/episodes/*.jsonl.gz, manifest.jsonl, summary.txt`);
    void mis;
  }
}
