#!/usr/bin/env node
// [dan] Batch episode generator (docs/DATASET_PLAN.md).
// Runs a simulator's sim-core headless for every episode in an orders file written by voice/sampler.py, and writes
// one gzipped JSON-lines file per episode in contract v0 (header, order events and plan ticks in time order,
// outcome) plus a manifest and a summary. The teacher executes the sampler's intended order, never the parser's.
//
//   node simulators/tools/generate.js --orders output/dataset/run1/orders.jsonl [--workers 7] [--baseline]
//   node simulators/tools/generate.js --sim indoor --orders output/dataset/indoor1/orders.jsonl --baseline
//
// --baseline also runs every seed with the drones on their pads and no orders, for paired comparisons.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const os = require('os');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SIMS = { mind: path.join(__dirname, '..', 'swarm-mind', 'index.html'), indoor: path.join(__dirname, '..', 'swarm-indoor', 'index.html') };

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

// ---------- swarm-indoor ----------
function indoorSituation(S) {
  const P = S.getPlan(), r = S.team.lkpRoom;
  return { role: S.person.role, seen: !!S.team.seen, known_room: r != null && r >= 0 && r < P.rooms.length ? P.rooms[r].name : (r === P.OUT ? 'outside' : null),
    goal: S.mission.goal, version: S.mission.version, queued: S.mission.queued ? S.mission.queued.goal : null };
}

function applyIndoorOrder(S, o, t) {
  const it = o.intended, before = indoorSituation(S);
  let applied = false, reason = null;
  if (it.action === 'accept' && it.goal) {
    const P = S.getPlan(), prot = it.params && it.params.room != null ? S.roomByName(it.params.room) : S.world.scenario.protectedRoom;
    if (it.goal === 'keepout' && S.team.lkpT >= 0 && S.team.lkpRoom === prot) reason = 'context: he is already in the ' + P.rooms[prot].name + ', so this order is a question';
    else {
      if (S.mission.queued && S.mission.queued.goal === it.goal) S.mission.queued = null;
      applied = S.world.order(it.goal, o.text, 'sampler', it.params || {});
      if (applied && it.queued) S.world.queue(it.queued, null, it.queued_params || {});
    }
  } else reason = it.action; // refuse or query: the goal does not change
  return { type: 'order', t: +t.toFixed(3), text: o.text, template: o.template, style: o.style, held_out: o.held_out, context_dependent: o.context_dependent,
    intended: it, parser: o.parser, mismatch: o.mismatch, applied, reason, situation: before };
}

function indoorOutcome(S, t, ended) {
  const m = S.metrics, pp = S.person.params;
  return { type: 'outcome', t_end: +t.toFixed(2), end: ended ? 'gone' : 'timeout', role: S.person.role, breaches: m.breaches, left: m.left,
    left_without_breach: m.left > 0 && m.breaches === 0, guided: m.guided, found: m.found, t_found: m.tFound, mapped: m.mapped,
    in_view_pct: m.totT ? +(100 * m.seenT / m.totT).toFixed(1) : 0, min_standoff: Number.isFinite(m.minStandoff) ? +m.minStandoff.toFixed(2) : null,
    min_separation: Number.isFinite(m.minSep) ? +m.minSep.toFixed(2) : null, min_wall: Number.isFinite(m.minWall) ? +m.minWall.toFixed(2) : null,
    standoff_viol_s: +m.standoffViol.toFixed(2), standoff_approach_s: +m.standoffApproach.toFixed(2), floor_viol_s: +m.floorViol.toFixed(2),
    band_s: { pressure: +m.bandT.pressure.toFixed(1), comfort: +m.bandT.comfort.toFixed(1) }, band_viol_s: { pressure: +m.bandViol.pressure.toFixed(2), comfort: +m.bandViol.comfort.toFixed(2) },
    min_pressure: Number.isFinite(m.minPressure) ? +m.minPressure.toFixed(2) : null, min_comfort: Number.isFinite(m.minComfort) ? +m.minComfort.toFixed(2) : null, sep_viol_s: +m.sepViol.toFixed(2),
    wall_viol_s: +m.wallViol.toFixed(2), alt_viol_s: +m.altViol.toFixed(2), radio_drops: m.radioDrops, link_holds: m.linkHolds, orders: m.orders,
    max_margin: +m.maxMargin.toFixed(3), deterrable: pp.kFear * 3 * Math.max(0, pp.Rreact / 3.0 - 1) >= 1, final_goal: S.mission.goal, final_status: S.mission.status };
}

function runIndoorEpisode(S, sha, ep, baseline) {
  const sc = ep.scenario, secs = sc.secs || 180, dt = 1 / 60;
  S.seed(ep.seed);
  S.world.reset({ layout: sc.layout, protect: sc.protect, person: sc.person, goal: 'hold', settings: sc.settings, endOnGone: !!sc.endOnGone, grounded: baseline });
  const out = [];
  if (!baseline) {
    const P = S.getPlan(), r2 = v => +v.toFixed(2);
    out.push({ type: 'header', schema: 'dmc.contract.v0', sim: 'swarm-indoor', core_sha: sha, seed: ep.seed, episode: ep.episode, split: ep.split,
      frame: `x east, z south, y up, metres; floor ${r2(P.W)} x ${r2(P.D)} m, ceiling ${P.ceil} m`,
      floor: { W: r2(P.W), D: r2(P.D), ceil: P.ceil, lintel: S.settings.lintel, rooms: P.rooms.map(q => ({ id: q.id, name: q.name, x0: r2(q.x0), z0: r2(q.z0), x1: r2(q.x1), z1: r2(q.z1) })),
        furniture: P.furn.map(f => ({ x0: r2(f.x0), z0: r2(f.z0), x1: r2(f.x1), z1: r2(f.z1), h: f.h, kind: f.kind })), pads: P.pads.map(p => [r2(p.x), 0, r2(p.z)]), operator: [r2(P.operator.x), 0, r2(P.operator.z)] },
      doors: P.doors.map(d => ({ id: d.id, name: d.name, x: d.x, z: d.z, w: d.w, axis: d.axis, rooms: d.rooms.map(r => r < P.rooms.length ? r : 'outside') })),
      protected_room: S.world.scenario.protectedRoom, scenario: sc, person: S.world.scenario.person, orders: ep.orders });
    S.mission.onPlan = r => out.push(r);
  }
  const queue = baseline ? [] : ep.orders.slice();
  let t = 0, i = 0, autoVer = -1, autoSince = null, trimmed = null;
  for (; i < secs * 60 && !S.world.ended; i++) {
    // an operator who sees an order finish gives the next one within a few seconds; with none left the episode
    // ends 5 s later, so finished orders do not leave long stretches of automatic hold in the labels
    if (!baseline) {
      const o = S.mission.order;
      if (o && o.src === 'auto' && S.mission.version !== autoVer) { autoVer = S.mission.version; autoSince = t; }
      if (o && o.src !== 'auto') autoSince = null;
      if (autoSince !== null) {
        const soon = autoSince + 3 + 2 * ((ep.seed * 0.618034 + autoVer * 0.414214) % 1);
        if (queue.length && queue[0].t > soon) queue[0] = Object.assign({}, queue[0], { t: soon, scheduled_t: queue[0].t });
        if (!queue.length && t - autoSince > 5) { trimmed = 'finished'; break; }
      }
      if (S.mission.status === 'landed' && !queue.length) { trimmed = 'landed'; break; }
    }
    while (queue.length && queue[0].t <= t + 1e-9) { const o = queue.shift(), ev = applyIndoorOrder(S, o, t); if (o.scheduled_t != null) ev.scheduled_t = o.scheduled_t; out.push(ev); }
    S.world.step(dt); t += dt;
  }
  S.mission.onPlan = null;
  const outcome = indoorOutcome(S, t, S.world.ended);
  outcome.trimmed = trimmed;
  if (!baseline) { outcome.segments = segmentsOf(out, S); out.push(outcome); }
  return { out, outcome };
}

// one segment per order version: how it ended, how close any drone came to the person, how long a drone was stuck,
// and a default training flag (false for an unsafe or a stuck segment; failed orders stay, since the person may have
// been impossible to stop: the trainer can filter on `end` and `deterrable` as well)
function segmentsOf(out, S) {
  const plans = out.filter(r => r.type === 'plan'), ends = S.mission.ends, segs = [];
  for (let k = 0; k < plans.length; k++) {
    const p = plans[k]; let g = segs[segs.length - 1];
    if (!g || g.version !== p.order.version) { g = { version: p.order.version, goal: p.order.goal, src: p.order.src, t0: p.t, t1: p.t, ticks: 0, min_dist: null, stuck_ticks: 0, band_ticks: { pressure: 0, comfort: 0 } }; segs.push(g); }
    g.t1 = p.t; g.ticks++; g.band_ticks[p.label.band]++;
    if (p.truth.person.alive) for (const d of p.team) if (d.pos[1] > 0.5) { const dd = Math.hypot(d.pos[0] - p.truth.person.pos[0], d.pos[2] - p.truth.person.pos[2]); if (g.min_dist === null || dd < g.min_dist) g.min_dist = +dd.toFixed(2); }
    if (k >= 10 && plans[k - 10].order.version === p.order.version) for (let i = 0; i < 3; i++) {
      let far = true; for (let j = k - 10; j <= k && far; j++) { const v = plans[j].label.vectors[i]; if (Math.hypot(v[0], v[2]) <= 1.0) far = false; }
      const a = plans[k - 10].team[i].pos, b = p.team[i].pos; if (far && p.team[i].wait_door == null && Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.1 && p.team[i].link_age < 1 && b[1] > 0.5) { g.stuck_ticks++; break; } }
  }
  for (let k = 0; k < segs.length; k++) {
    const g = segs[k], e = ends.find(x => x.version === g.version);
    g.end = e ? e.status : k < segs.length - 1 ? 'replaced' : 'episode_end'; g.reason = e ? e.reason : null;
    g.success = e ? e.status !== 'failed' : null;
    g.sft = !(g.min_dist !== null && g.min_dist < 1.2) && g.stuck_ticks <= 0.2 * g.ticks && !(g.src === 'auto' && g.t1 - g.t0 > 6);
  }
  // each plan record says whether to train on it: its segment is fit for training, no drone is stuck at that tick,
  // and it is not more than 5 s into an automatic hold after an order finished
  for (let k = 0; k < plans.length; k++) {
    const p = plans[k], g = segs.find(x => x.version === p.order.version); let stuck = false;
    if (k >= 10 && plans[k - 10].order.version === p.order.version) for (let i = 0; i < 3 && !stuck; i++) {
      let far = true; for (let j = k - 10; j <= k && far; j++) { const v = plans[j].label.vectors[i]; if (Math.hypot(v[0], v[2]) <= 1.0) far = false; }
      const a = plans[k - 10].team[i].pos, b = p.team[i].pos; if (far && p.team[i].wait_door == null && Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.1 && p.team[i].link_age < 1 && b[1] > 0.5) stuck = true; }
    p.sft = !!(g && g.sft) && !stuck && !(p.order.src === 'auto' && p.t - g.t0 > 5);
  }
  return segs;
}

function dominantGoal(out) {
  const dur = {}; let last = null;
  for (const r of out) if (r.type === 'plan') { if (last) dur[last.goal] = (dur[last.goal] || 0) + (r.t - last.t); last = { goal: r.order.goal, t: r.t }; }
  return Object.keys(dur).sort((a, b) => dur[b] - dur[a])[0] || 'hold';
}

if (!isMainThread) {
  const { file, episodes, outDir, baseline, sim } = workerData;
  const { S, sha } = loadCore(file);
  const run = sim === 'indoor' ? runIndoorEpisode : runEpisode;
  for (const ep of episodes) {
    const { out, outcome } = run(S, sha, ep, false);
    const body = out.map(r => JSON.stringify(r)).join('\n') + '\n';
    const name = path.join('episodes', ep.episode + '.jsonl.gz');
    fs.writeFileSync(path.join(outDir, name), zlib.gzipSync(body, { level: 6 }));
    const row = { episode: ep.episode, seed: ep.seed, split: ep.split, file: name, sha256: crypto.createHash('sha256').update(body).digest('hex'),
      plan_records: out.filter(r => r.type === 'plan').length, orders: out.filter(r => r.type === 'order').length,
      goal: dominantGoal(out), intent: ep.scenario && ep.scenario.person ? ep.scenario.person.intent : undefined,
      first_goal: ep.orders.length && ep.orders[0].intended.goal ? ep.orders[0].intended.goal : undefined, scheduled_orders: ep.orders.length, outcome };
    if (baseline) row.baseline = run(S, sha, ep, true).outcome;
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
    const w = new Worker(__filename, { workerData: { file: SIMS[sim], episodes, outDir, baseline, sim } });
    w.on('message', row => {
      if (row === null) { if (--live === 0) finish(); return; }
      rows.push(row); done++;
      if (done % 25 === 0 || done === eps.length) process.stdout.write(`  ${done}/${eps.length} episodes\r`);
    });
    w.on('error', e => { console.error(e); process.exit(1); });
  }
  function finish() {
    rows.sort((a, b) => a.episode.localeCompare(b.episode));
    if (sim === 'indoor') return finishIndoor(rows);
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
  function finishIndoor(rows) {
    fs.writeFileSync(path.join(outDir, 'manifest.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '—';
    const by = {};
    for (const r of rows) {
      const key = r.first_goal || 'none', g = by[key] || (by[key] = { n: 0, br: 0, clean: 0, left: 0, guided: 0, found: 0, mapped: 0, view: 0, intr: 0, vis: 0, hid: 0, b: { br: 0, guided: 0, found: 0, view: 0, left: 0 }, fl: 0, sa: 0, pb: 0, sp: 0, wl: 0, det: 0, detClean: 0, pressS: 0 });
      const o = r.outcome, b = r.baseline || {}; g.n++; g.view += o.in_view_pct; g.fl += o.floor_viol_s > 0; g.sa += o.standoff_approach_s > 0.5; g.pb += o.band_viol_s.comfort > 0; g.sp += o.sep_viol_s > 0; g.wl += o.wall_viol_s > 0; g.pressS += o.band_s.pressure;
      if (o.role === 'visitor') { g.vis++; g.guided += o.guided > 0; g.b.guided += (b.guided || 0) > 0; }
      else if (r.intent === 'hide') { g.hid++; g.found += o.found > 0; g.b.found += (b.found || 0) > 0; }
      else { g.intr++; g.br += o.breaches > 0; g.clean += o.left_without_breach; g.left += o.left > 0; g.b.br += (b.breaches || 0) > 0; g.b.left += (b.left || 0) > 0; if (o.deterrable) { g.det++; g.detClean += o.breaches === 0; } }
      g.mapped += o.mapped >= 0.9; g.b.view += b.in_view_pct || 0;
    }
    const lines = [`${rows.length} indoor episodes, ${rows.reduce((a, r) => a + r.plan_records, 0)} plan records, ${rows.reduce((a, r) => a + r.orders, 0)} order events, ` +
      `${rows.filter(r => r.split === 'test').length} test episodes, ${((Date.now() - t0) / 1000).toFixed(1)} s on ${chunks.length} workers`,
      'Paired baseline: the same seeds with the drones on their pads and no orders.', '',
      'first order            eps | intruders entering: breached (baseline) · no breach if deterrable | hiders found (baseline) | visitors guided out (baseline) | in view (baseline) | mapped>=90% | pressure band s/ep | episodes with: below 1.2 m · drone closing in · comfort pass-by · separation · wall'];
    for (const [g, s] of Object.entries(by).sort()) lines.push(`${g.padEnd(22)} ${String(s.n).padStart(4)} | ${s.intr ? pct(s.br, s.intr) + ' (' + pct(s.b.br, s.intr) + ') · ' + pct(s.detClean, s.det) + ' of ' + s.det : '—'} | ` +
      `${s.hid ? pct(s.found, s.hid) + ' (' + pct(s.b.found, s.hid) + ')' : '—'} | ${s.vis ? pct(s.guided, s.vis) + ' (' + pct(s.b.guided, s.vis) + ')' : '—'} | ` +
      `${(s.view / s.n).toFixed(0)}% (${(s.b.view / s.n).toFixed(0)}%) | ${pct(s.mapped, s.n)} | ${(s.pressS / s.n).toFixed(0)} | ${s.fl} · ${s.sa} · ${s.pb} · ${s.sp} · ${s.wl}`);
    // the first order is often replaced 10-35 s later, so the table above mixes tactics; this one keeps only episodes whose schedule
    // had a single order (not episodes that merely ended before the next order, which would favour quick breaches)
    const one = rows.filter(r => r.scheduled_orders === 1), by1 = {};
    for (const r of one) { const g = by1[r.first_goal] || (by1[r.first_goal] = { n: 0, intr: 0, br: 0, bBr: 0, hid: 0, found: 0, vis: 0, guided: 0, view: 0 }); const o = r.outcome, b = r.baseline || {};
      g.n++; g.view += o.in_view_pct;
      if (o.role === 'visitor') { g.vis++; g.guided += o.guided > 0; } else if (r.intent === 'hide') { g.hid++; g.found += o.found > 0; } else { g.intr++; g.br += o.breaches > 0; g.bBr += (b.breaches || 0) > 0; } }
    lines.push('', `Episodes scheduled with a single order (${one.length}): the first order stays in force`, 'order        eps | intruders breached (baseline) | hiders found | visitors guided out | in view');
    for (const [g, s] of Object.entries(by1).sort()) lines.push(`${g.padEnd(12)} ${String(s.n).padStart(3)} | ${s.intr ? s.br + '/' + s.intr + ' (' + s.bBr + '/' + s.intr + ')' : '—'} | ${s.hid ? s.found + '/' + s.hid : '—'} | ${s.vis ? s.guided + '/' + s.vis : '—'} | ${(s.view / s.n).toFixed(0)}%`);
    fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    console.log(`wrote ${outDir}/episodes/*.jsonl.gz, manifest.jsonl, summary.txt`);
  }
}
