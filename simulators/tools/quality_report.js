#!/usr/bin/env node
// [dan] Data-quality report for a generated indoor run (docs/DATASET_PLAN.md, "Quality gates").
//   node simulators/tools/quality_report.js output/dataset/indoor1 [--json]
// Checks every plan record's label against the rules the teacher must obey, measures how stable and
// balanced the labels are, and prints PASS/FAIL per gate. Exit code 1 if a hard gate fails.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const dir = process.argv[2] || 'output/dataset/indoor1';
const asJson = process.argv.includes('--json');
const D = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const D3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const q = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const rows = fs.readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const C = {
  ticks: 0, episodes: rows.length,
  vecBad: 0, standoffBad: 0, standoffChecked: 0, sepBad: 0, boundsBad: 0, altBad: 0, refsBad: 0,
  flicker: 0, swaps: 0, stuck: 0, doorWait: 0, sft: 0, sftStuck: 0, sftUnsafe: 0, autoHold: 0, hold: 0, seen: 0, estimate: 0, unknown: 0,
  goal: {}, template: {}, band: {}, jitter: [], jitterByTemplate: {}, worst: {},
  floor: 0, approach: 0, sepViol: 0, wallViol: 0, altViol: 0, passBy: 0, segments: 0,
};
const note = (k, msg) => { if (!C.worst[k]) C.worst[k] = msg; };

for (const r of rows) {
  const recs = zlib.gunzipSync(fs.readFileSync(path.join(dir, r.file))).toString().trim().split('\n').map(l => JSON.parse(l));
  const H = recs[0], plans = recs.filter(x => x.type === 'plan'), out = recs[recs.length - 1];
  const W = H.floor.W, Dd = H.floor.D, ceil = H.floor.ceil;
  for (let k = 0; k < plans.length; k++) {
    const p = plans[k], L = p.label; C.ticks++;
    C.goal[p.order.goal] = (C.goal[p.order.goal] || 0) + 1; C.template[L.template] = (C.template[L.template] || 0) + 1; C.band[L.band] = (C.band[L.band] || 0) + 1;
    if (p.order.goal === 'hold') C.hold++;
    if (p.order.src === 'auto') C.autoHold++;
    if (p.obs.seen) C.seen++; else if (p.obs.p) C.estimate++; else C.unknown++;
    const landing = L.template === 'return';
    // 1. vector = slot - position at plan time, for every drone
    for (let i = 0; i < 3; i++) { const v = L.vectors[i], s = L.slots[i], x = p.team[i].pos;
      if (Math.abs(v[0] - (s[0] - x[0])) > 0.01 || Math.abs(v[1] - (s[1] - x[1])) > 0.01 || Math.abs(v[2] - (s[2] - x[2])) > 0.01) { C.vecBad++; note('vec', `${r.episode} t ${p.t}`); } }
    // 2. standoff: every slot keeps the band's distance from the estimated person (3 m in comfort with two or more within 4 m)
    if (p.obs.p && !landing) { C.standoffChecked++;
      const near = L.slots.filter(s => D(s, p.obs.p) < 4).length, need = L.band === 'pressure' ? 1.5 : near >= 2 ? 3.0 : 2.5;
      for (const s of L.slots) if (D(s, p.obs.p) < need - 0.05) {
        // a slot pushed against a wall can end short of the standoff only if the validator flagged it
        const i = L.slots.indexOf(s); if (!L.flags[i].includes('wall')) { C.standoffBad++; note('standoff', `${r.episode} t ${p.t} ${L.template} slot ${D(s, p.obs.p).toFixed(2)} m < ${need}`); } } }
    // 3. slots at least 1 m apart (the validator's separation), pads excepted
    if (!landing) for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (D(L.slots[a], L.slots[b]) < 0.95 && !(L.flags[a].includes('wall') || L.flags[b].includes('wall'))) { C.sepBad++; note('sep', `${r.episode} t ${p.t} ${L.template}`); }
    // 4. slots inside the site and the altitude band
    for (const s of L.slots) { if (s[0] < 0 || s[2] < 0 || s[0] > W || s[2] > Dd) { C.boundsBad++; note('bounds', `${r.episode} t ${p.t}`); }
      if (!landing && (s[1] < 1.2 - 0.01 || s[1] > ceil - 0.5 + 0.01)) { C.altBad++; note('alt', `${r.episode} t ${p.t} y ${s[1]}`); } }
    // 5. timed reference points: start near the drone, then at most 0.75 m (1.5 m/s x 0.5 s) between steps
    for (let i = 0; i < 3; i++) { const R = L.refs[i], x = p.team[i].pos; let bad = D3(R[0], x) > 0.75 + 0.45;
      for (let j = 1; j < 4; j++) if (D3(R[j], R[j - 1]) > 0.75 + 0.45) bad = true;
      if (bad) { C.refsBad++; note('refs', `${r.episode} t ${p.t} ${p.team[i].id}`); } }
    // 6. stability: a template that flips for one tick and back, follower slots swapping, slot jitter when nothing changed
    if (k > 0 && k < plans.length - 1) { const a = plans[k - 1], b = plans[k + 1];
      if (a.label.template === b.label.template && a.label.template !== L.template && a.order.version === b.order.version) { C.flicker++; note('flicker', `${r.episode} t ${p.t} ${a.label.template}->${L.template}->${b.label.template}`); } }
    if (k > 0) { const a = plans[k - 1];
      if (a.label.template === L.template && a.order.version === p.order.version) {
        const s1 = L.slots[1], s2 = L.slots[2], a1 = a.label.slots[1], a2 = a.label.slots[2];
        if (D(s1, a2) < 0.3 && D(s2, a1) < 0.3 && D(a1, a2) > 1.0) C.swaps++;
        const still = (a.obs.p === null && p.obs.p === null) || (a.obs.p && p.obs.p && D(a.obs.p, p.obs.p) < 0.1);
        if (still) for (let i = 0; i < 3; i++) { const j = D(L.slots[i], a.label.slots[i]); C.jitter.push(j); (C.jitterByTemplate[L.template] = C.jitterByTemplate[L.template] || []).push(j); } } }
    // 7. a drone that has not moved for 5 s while its slot is more than 1 m away and its link is fresh
    // (the slot must have been over 1 m away at every tick of the window, under one order: holding still on purpose is not stuck)
    if (k >= 10) { const a = plans[k - 10]; for (let i = 0; i < 3; i++) {
      let far = a.order.version === p.order.version; for (let j = k - 10; j <= k && far; j++) { const v = plans[j].label.vectors[i]; if (Math.hypot(v[0], v[2]) <= 1.0) far = false; }
      if (p.team[i].wait_door != null) { C.doorWait++; continue; } // queuing for a doorway (one drone at a time) is expected, and counted apart
      if (far && D(p.team[i].pos, a.team[i].pos) < 0.1 && p.team[i].link_age < 1 && p.team[i].pos[1] > 0.5) { C.stuck++; if (p.sft) C.sftStuck++; note('stuck', `${r.episode} t ${p.t} ${p.team[i].id} ${L.template}`); } } }
    if (p.sft) { C.sft++; if (p.truth.person.alive && p.team.some(d => d.pos[1] > 0.5 && D(d.pos, p.truth.person.pos) < 1.2)) C.sftUnsafe++; }
  }
  if (out.segments) C.segments += out.segments.length;
  C.floor += out.floor_viol_s > 0; C.approach += out.standoff_approach_s > 0.5; C.sepViol += out.sep_viol_s > 0; C.wallViol += out.wall_viol_s > 0; C.altViol += out.alt_viol_s > 0; C.passBy += out.band_viol_s.comfort > 0;
}

const share = n => n / C.ticks;
const J = q(C.jitter, 0.95), J50 = q(C.jitter, 0.5);
const jitterBy = Object.fromEntries(Object.entries(C.jitterByTemplate).map(([k, v]) => [k, { p50: +q(v, 0.5).toFixed(3), p95: +q(v, 0.95).toFixed(3), n: v.length }]));
const gates = [
  // hard gates: a single failure means a label or a flight broke a rule
  { hard: true, name: 'vector = slot - position', value: C.vecBad, ok: C.vecBad === 0 },
  { hard: true, name: 'slots keep the band standoff from the estimate', value: C.standoffBad, ok: C.standoffBad === 0 },
  { hard: true, name: 'slots at least 1 m apart', value: C.sepBad, ok: C.sepBad === 0 },
  { hard: true, name: 'slots inside the site and altitude band', value: C.boundsBad + C.altBad, ok: C.boundsBad + C.altBad === 0 },
  { hard: true, name: 'reference points reachable', value: C.refsBad, ok: C.refsBad === 0 },
  { hard: true, name: 'episodes inside the 1.2 m floor', value: C.floor, ok: C.floor === 0 },
  { hard: true, name: 'episodes with a drone closing in on a person', value: C.approach, ok: C.approach === 0 },
  { hard: true, name: 'episodes with separation / wall / altitude violations', value: C.sepViol + C.wallViol + C.altViol, ok: C.sepViol + C.wallViol + C.altViol === 0 },
  // soft gates: label noise and balance, thresholds chosen for SFT
  { hard: false, name: 'one-tick template flicker (share of ticks)', value: +share(C.flicker).toFixed(4), ok: share(C.flicker) < 0.005 },
  { hard: false, name: 'follower slot swaps (share of ticks)', value: +share(C.swaps).toFixed(4), ok: share(C.swaps) < 0.002 },
  { hard: false, name: 'slot jitter when nothing changed, p95 (m)', value: J === null ? null : +J.toFixed(3), ok: J !== null && J < 0.5 },
  { hard: true, name: 'training ticks (sft) with a stuck drone', value: C.sftStuck, ok: C.sftStuck === 0 },
  { hard: true, name: 'training ticks (sft) with a drone inside 1.2 m of the person', value: C.sftUnsafe, ok: C.sftUnsafe === 0 },
  { hard: false, name: 'stuck drones, all ticks (share of drone-ticks)', value: +(C.stuck / (3 * C.ticks)).toFixed(4), ok: C.stuck / (3 * C.ticks) < 0.05 },
  { hard: false, name: 'ticks fit for training (sft share)', value: +share(C.sft).toFixed(3), ok: share(C.sft) > 0.8 },
  { hard: false, name: 'queuing for a doorway (share of drone-ticks)', value: +(C.doorWait / (3 * C.ticks)).toFixed(4), ok: C.doorWait / (3 * C.ticks) < 0.05 },
  { hard: false, name: 'automatic hold after an order finished (share of ticks)', value: +share(C.autoHold).toFixed(3), ok: share(C.autoHold) < 0.15 },
  { hard: false, name: 'hold, all causes (share of ticks)', value: +share(C.hold).toFixed(3), ok: share(C.hold) < 0.25 },
];
const report = { dir, episodes: C.episodes, ticks: C.ticks, gates, standoff_checked: C.standoffChecked, jitter_p50: J50, jitter_by_template: jitterBy,
  obs: { seen: +share(C.seen).toFixed(3), estimate_only: +share(C.estimate).toFixed(3), unknown: +share(C.unknown).toFixed(3) },
  goals: C.goal, templates: C.template, bands: C.band, comfort_pass_by_episodes: C.passBy, examples: C.worst };
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`${dir}: ${C.episodes} episodes, ${C.ticks} plan ticks (${C.standoffChecked} with a person estimate)`);
  for (const g of gates) console.log(`${g.ok ? 'PASS' : 'FAIL'} ${g.hard ? 'hard' : 'soft'}  ${g.name}: ${g.value}${!g.ok && C.worst[{ 'vector = slot - position': 'vec', 'slots keep the band standoff from the estimate': 'standoff', 'slots at least 1 m apart': 'sep', 'reference points reachable': 'refs', 'one-tick template flicker (share of ticks)': 'flicker', 'stuck drones, all ticks (share of drone-ticks)': 'stuck' }[g.name]] ? '   e.g. ' + C.worst[{ 'vector = slot - position': 'vec', 'slots keep the band standoff from the estimate': 'standoff', 'slots at least 1 m apart': 'sep', 'reference points reachable': 'refs', 'one-tick template flicker (share of ticks)': 'flicker', 'stuck drones, all ticks (share of drone-ticks)': 'stuck' }[g.name]] : ''}`);
  console.log(`observations: seen ${report.obs.seen}, estimate only ${report.obs.estimate_only}, unknown ${report.obs.unknown}; comfort pass-bys in ${C.passBy} episodes`);
  console.log('slot jitter p50/p95 by template:', Object.entries(jitterBy).map(([k, v]) => `${k} ${v.p50}/${v.p95}`).join(', '));
}
fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify(report, null, 1));
process.exit(gates.some(g => g.hard && !g.ok) ? 1 : 0);
