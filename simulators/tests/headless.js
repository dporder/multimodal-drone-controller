#!/usr/bin/env node
// Headless smoke test: loads the <script id="sim-core"> block of each simulator (no DOM, no THREE)
// and runs it for a fixed number of simulated seconds, printing the outcome metrics.
//   node simulators/tests/headless.js            # all three
//   node simulators/tests/headless.js mind 180   # one simulator, custom duration
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCore(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('sim-core script not found in ' + file);
  const ctx = { module: { exports: {} }, Math, console, Infinity, NaN, Array, Set, Map, Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Object, parseInt, parseFloat, isFinite, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx, { filename: path.basename(file) });
  return ctx.module.exports;
}
const root = path.join(__dirname, '..');
const secs = parseInt(process.argv[3] || '150', 10);
const which = process.argv[2] || 'all';

function run(sim, secs, setup) {
  const { world, metrics, simT } = sim;
  world.reset(); if (setup) setup(sim);
  for (let i = 0; i < secs * 60; i++) world.step(1 / 60);
  return { t: simT(), metrics };
}

if (which === 'all' || which === 'guard') {
  const sim = loadCore(path.join(root, 'swarm-guard', 'index.html'));
  const r = run(sim, secs, s => s.world.reset('both'));
  console.log(`swarm-guard  ${r.t.toFixed(0)} s  intruders ${r.metrics.intruders} deterred ${r.metrics.deterred} breached ${r.metrics.breached}  asset found ${r.metrics.foundAt !== null ? r.metrics.foundAt.toFixed(1) + ' s' : 'no'}  conflicts ${r.metrics.conflicts}`);
}
if (which === 'all' || which === 'seek') {
  const sim = loadCore(path.join(root, 'swarm-seek', 'index.html'));
  const r = run(sim, secs, s => s.world.reset('alarm8'));
  console.log(`swarm-seek   ${r.t.toFixed(0)} s  intruders ${r.metrics.intruders} deterred ${r.metrics.deterred} breached ${r.metrics.breached}  sight times ${r.metrics.sightTimes.map(t => t.toFixed(0)).join('/') || '—'} s  conflicts ${r.metrics.conflicts}`);
}
if (which === 'all' || which === 'mind') {
  const sim = loadCore(path.join(root, 'swarm-mind', 'index.html'));
  const r = run(sim, secs, s => { s.brain.autopilot = true; s.mission.goal = 'keepout'; s.mission.narrate = 'change'; });
  const cov = r.metrics.totT ? Math.round(100 * r.metrics.seenT / r.metrics.totT) : 0;
  console.log(`swarm-mind   ${r.t.toFixed(0)} s  keep-out: breaches ${r.metrics.breaches} deterred ${r.metrics.deterred}  in view ${cov}%  radio drops ${r.metrics.rdrop || 0}`);
  for (const l of sim.talk.filter(l => l.who !== 'motor').slice(0, 12)) console.log('   ', l.t.toFixed(1).padStart(6), l.who.padEnd(8), l.text.slice(0, 120));
}
