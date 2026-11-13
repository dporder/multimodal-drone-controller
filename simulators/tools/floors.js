#!/usr/bin/env node
// [dan] The names on each episode's floor, straight from the simulator, so voice/sampler.py can phrase orders for it.
// Reads a JSON list of {family, seed, layout} on stdin and writes one JSON list back, in the same order:
//   {family, seed, layout, rooms: [names], doors: [{name, rooms: [names | 'outside']}], exits: [names], protectable: [names],
//    protect, home, source, licence}
// A floor depends only on (family, seed, layout), exactly as world.reset() builds it after seed(seed).
//   echo '[{"family":"house","seed":7,"layout":"random"}]' | node simulators/tools/floors.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'swarm-indoor', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script id="sim-core">([\s\S]*?)<\/script>/);
if (!m) throw new Error('sim-core script not found in ' + file);
const ctx = { module: { exports: {} }, Math, console, Infinity, NaN, Array, Set, Map, Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Object, parseInt, parseFloat, isFinite, String, JSON };
vm.createContext(ctx);
vm.runInContext(m[1], ctx, { filename: path.basename(file) });
const S = ctx.module.exports;

const specs = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = specs.map(sp => {
  S.seed(sp.seed);
  const P = S.makeFloor(sp.family || 'office', sp.layout === 'random' ? S.rng : null);
  const name = r => (r < P.rooms.length ? P.rooms[r].name : 'outside');
  return {
    family: P.family, seed: sp.seed, layout: sp.layout || 'fixed', rooms: P.rooms.map(q => q.name),
    doors: P.doors.map(d => ({ name: d.name, rooms: d.rooms.map(name) })), exits: P.doors.filter(d => d.rooms[1] === P.OUT).map(d => d.name),
    protectable: P.protectable.map(name), protect: name(P.protect), home: name(P.home), source: P.source, licence: P.licence,
  };
});
process.stdout.write(JSON.stringify(out) + '\n');
