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
const AMAX = 2.0; // the drones' horizontal acceleration limit (settings.aMax)
const q = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const rows = fs.readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const C = {
  ticks: 0, episodes: rows.length,
  vecBad: 0, standoffBad: 0, standoffChecked: 0, sepBad: 0, boundsBad: 0, altBad: 0, refsBad: 0,
  flicker: 0, swaps: 0, stuck: 0, doorWait: 0, yieldT: 0, sft: 0, sftStuck: 0, sftUnsafe: 0, estErr: [], estTicks: 0, estFromFP: 0, tp: 0, other: 0, fp: 0, fpAccepted: 0, falseFound: 0, autoHold: 0, hold: 0, seen: 0, estimate: 0, unknown: 0,
  goal: {}, template: {}, band: {}, jitter: [], jitterByTemplate: {}, worst: {}, refErr: [[], [], [], []], poseErr: [],
  floor: 0, floorPerson: 0, approach: 0, sepViol: 0, wallViol: 0, altViol: 0, passBy: 0, segments: 0,
};
const note = (k, msg) => { if (!C.worst[k]) C.worst[k] = msg; };
// doors with leaves (episodes whose header gives each door's kind): the leaf segments at an angle, as the simulator draws them
const DOOR = { eps: 0, init: { closed: 0, ajar: 0, open: 0, locked: 0, opening: 0 }, opened: 0, closed: 0, through: 0, personTicks: 0, personInLeaf: 0, droneTicks: 0, wait: 0, cut: 0, surprise: 0 };
const segD = (px, pz, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz, t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / L2)) : 0; return Math.hypot(a[0] + vx * t - px, a[1] + vz * t - pz); };
function leafSegs(d, ang) { if (!d.leaves) return []; const T = d.axis === 'h' ? [1, 0] : [0, 1], N = d.axis === 'h' ? [0, 1] : [1, 0], th = ang * Math.PI / 180, out = [];
  for (const h of d.leaves === 2 ? [-1, 1] : [d.hinge]) { const hx = d.x + T[0] * h * d.w / 2 + N[0] * d.swing * 0.1, hz = d.z + T[1] * h * d.w / 2 + N[1] * d.swing * 0.1;
    const ux = Math.cos(th) * (-h) * T[0] + Math.sin(th) * d.swing * N[0], uz = Math.cos(th) * (-h) * T[1] + Math.sin(th) * d.swing * N[1]; out.push([[hx, hz], [hx + ux * d.leaf_m, hz + uz * d.leaf_m]]); }
  return out; }
// the same counts per floor family: each episode's increments are added to its family
const FAMKEYS = ['ticks', 'vecBad', 'standoffBad', 'sepBad', 'boundsBad', 'altBad', 'refsBad', 'flicker', 'swaps', 'stuck', 'yieldT', 'doorWait', 'sft', 'sftStuck', 'sftUnsafe', 'estTicks', 'estFromFP',
  'falseFound', 'autoHold', 'hold', 'seen', 'floor', 'approach', 'sepViol', 'wallViol', 'altViol', 'passBy'];
const F = {};
// results by who the subject is (people item 6): each episode adds to its groups
const GROUPS = {}, addG = (dim, key, e) => { const g = (GROUPS[dim] = GROUPS[dim] || {}), x = (g[key] = g[key] || { episodes: 0, view: 0, intr: 0, breached: 0, hid: 0, found: 0, vis: 0, guided: 0 });
  x.episodes++; x.view += e.view; if (e.role === 'intruder' && e.intent !== 'hide') { x.intr++; x.breached += e.breached; } else if (e.intent === 'hide') { x.hid++; x.found += e.found; } else if (e.role === 'visitor') { x.vis++; x.guided += e.guided; } };

for (const r of rows) {
  const recs = zlib.gunzipSync(fs.readFileSync(path.join(dir, r.file))).toString().trim().split('\n').map(l => JSON.parse(l));
  const H = recs[0], plans = recs.filter(x => x.type === 'plan'), out = recs[recs.length - 1];
  const fam = r.family || (H.floor && H.floor.family) || 'office', before = Object.fromEntries(FAMKEYS.map(k => [k, C[k]])), errBefore = C.estErr.length;
  const W = H.floor.W, Dd = H.floor.D, ceil = H.floor.ceil;
  // doors: the state each starts in; then per tick (below) who opens and closes them, drones through one that stayed shut, people
  // inside a leaf, and drones waiting beside a shut door or cut off from the team by one
  const DH = H.doors.length && H.doors[0].kind !== undefined ? H.doors : null, dside = [[], [], []];
  if (DH && plans.length) { DOOR.eps++; const t0 = plans[0].ground_truth.doors; DH.forEach((d, i) => { const st = d.kind === 'opening' ? 'opening' : t0[i][1] ? 'locked' : t0[i][0] < 1 ? 'closed' : t0[i][0] < 80 ? 'ajar' : 'open'; DOOR.init[st]++; }); }
  for (let k = 0; k < plans.length; k++) {
    const p = plans[k], L = p.teacher_plan; C.ticks++;
    const TP = i => (p.ground_truth.drones ? p.ground_truth.drones[i] : p.drone_beliefs[i].position); // true drone positions; drone_beliefs holds the drones' estimates
    if (DH) { const td = p.ground_truth.doors, prev = k > 0 ? plans[k - 1].ground_truth.doors : null;
      if (prev) td.forEach((x, i) => { if (prev[i][0] < 80 && x[0] >= 80) DOOR.opened++; if (prev[i][0] >= 1 && x[0] < 1) DOOR.closed++; });
      const segs = DH.map((d, i) => leafSegs(d, td[i][0]));
      for (let i = 0; i < 3; i++) { const t = TP(i); if (t[1] < 0.3) continue; DOOR.droneTicks++;
        // through a door: from 0.6 m or more out in front of the opening on one side to the same on the other, close by all along,
        // while the door stayed under 60 deg (a leaf that shut stands in the way)
        DH.forEach((d, j) => { const n = d.axis === 'h' ? t[2] - d.z : t[0] - d.x, tt = d.axis === 'h' ? t[0] - d.x : t[2] - d.z, a = td[j][0]; let st = dside[i][j];
          if (Math.abs(n) > 3 || Math.abs(tt) > d.w / 2 + 1.5) { dside[i][j] = null; return; } if (st) st.amax = Math.max(st.amax, a);
          if (Math.abs(n) >= 0.6 && Math.abs(tt) <= d.w / 2 + 0.6) { const sd = n > 0 ? 1 : -1; if (st && st.side !== sd && st.amax < 60) { DOOR.through++; note('through', `${r.episode} t ${p.t} ${['M', 'S1', 'S2'][i]} through the ${d.name}`); } dside[i][j] = { side: sd, amax: a }; } });
        if (L.flags[i].includes('door-wait')) DOOR.wait++; if (L.flags[i].includes('trapped')) DOOR.cut++; }
      for (const h of [p.ground_truth.person].concat(p.ground_truth.people || [])) { if (!h || h.alive === false || !h.position) continue; DOOR.personTicks++; let m = Infinity; for (const ss of segs) for (const sg of ss) m = Math.min(m, segD(h.position[0], h.position[2], sg[0], sg[1])); if (m < 0.12) { DOOR.personInLeaf++; note('leaf', `${r.episode} t ${p.t} tid ${h.tid}`); } } }
    if (p.ground_truth.drones) for (let i = 0; i < 3; i++) if (TP(i)[1] > 0.5) C.poseErr.push(D(p.drone_beliefs[i].position, TP(i)));
    C.goal[p.order.goal] = (C.goal[p.order.goal] || 0) + 1; C.template[L.template] = (C.template[L.template] || 0) + 1; C.band[L.band] = (C.band[L.band] || 0) + 1;
    if (p.order.goal === 'hold') C.hold++;
    if (p.order.src === 'auto') C.autoHold++;
    if (p.world_beliefs.person.seen) C.seen++; else if (p.world_beliefs.person.position) C.estimate++; else C.unknown++;
    // perception: how far the team's estimate is from the truth, and how often it came from a false positive
    if (p.world_beliefs.person.position) { C.estTicks++; if (p.ground_truth.estimate_from_fp) C.estFromFP++; else if (p.world_beliefs.person.seen && p.ground_truth.person.alive) C.estErr.push(D(p.world_beliefs.person.position, p.ground_truth.person.position)); }
    // the subject, another person (a true detection of someone else), or nothing there (a false positive)
    const who = p.ground_truth.detections_who || [];
    p.world_beliefs.detections.forEach((x, k) => { if (p.ground_truth.detections_tp[k]) C.tp++; else if (who[k] > 0) C.other++; else { C.fp++; if (x.conf >= 0.5) C.fpAccepted++; } });
    const landing = L.template === 'return';
    // 1. vector = slot - position at plan time, for every drone
    for (let i = 0; i < 3; i++) { const v = L.vectors[i], s = L.slots[i], x = p.drone_beliefs[i].position;
      if (Math.abs(v[0] - (s[0] - x[0])) > 0.01 || Math.abs(v[1] - (s[1] - x[1])) > 0.01 || Math.abs(v[2] - (s[2] - x[2])) > 0.01) { C.vecBad++; note('vec', `${r.episode} t ${p.t}`); } }
    // 2. standoff: every slot keeps the band's distance from the estimated person (3 m in comfort with two or more within 4 m)
    if (p.world_beliefs.person.position && !landing) { C.standoffChecked++;
      const near = L.slots.filter(s => D(s, p.world_beliefs.person.position) < 4).length, need = L.band === 'pressure' ? 1.5 : near >= 2 ? 3.0 : 2.5;
      for (const s of L.slots) if (D(s, p.world_beliefs.person.position) < need - 0.05) {
        // a slot pushed against a wall can end short of the standoff only if the validator flagged it
        const i = L.slots.indexOf(s); if (!L.flags[i].includes('wall')) { C.standoffBad++; note('standoff', `${r.episode} t ${p.t} ${L.template} slot ${D(s, p.world_beliefs.person.position).toFixed(2)} m < ${need}`); } } }
    // 3. slots at least 1 m apart (the validator's separation), pads excepted
    if (!landing) for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (D(L.slots[a], L.slots[b]) < 0.95 && !(L.flags[a].includes('wall') || L.flags[b].includes('wall'))) { C.sepBad++; note('sep', `${r.episode} t ${p.t} ${L.template}`); }
    // 4. slots inside the site and the altitude band
    for (const s of L.slots) { if (s[0] < 0 || s[2] < 0 || s[0] > W || s[2] > Dd) { C.boundsBad++; note('bounds', `${r.episode} t ${p.t}`); }
      if (!landing && (s[1] < 1.2 - 0.01 || s[1] > ceil - 0.5 + 0.01)) { C.altBad++; note('alt', `${r.episode} t ${p.t} y ${s[1]}`); } }
    // 5. timed reference points a drone can fly: from its position and velocity, horizontal speed changes between consecutive
    // 0.5 s steps of at most aMax x 0.5 s (2 m/s2), at most 2.5 m/s, and climbs of at most 0.8 m/s (0.05 m and 0.1 m/s rounding tolerance)
    for (let i = 0; i < 3; i++) { const R = L.refs[i], x = p.drone_beliefs[i].position, v0 = p.drone_beliefs[i].velocity, h = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
      let bad = Math.hypot(R[0][0] - x[0] - v0[0] * 0.5, R[0][2] - x[2] - v0[2] * 0.5) > 0.5 * AMAX * 0.25 + 0.05;
      let u = [(R[0][0] - x[0]) / 0.5, (R[0][2] - x[2]) / 0.5];
      for (let j = 0; j < 4; j++) { const a = j ? R[j - 1] : x, w = [(R[j][0] - a[0]) / 0.5, (R[j][2] - a[2]) / 0.5];
        if (Math.hypot(w[0], w[1]) > Math.max(2.5, Math.hypot(v0[0], v0[2])) + 0.1 || Math.abs(R[j][1] - a[1]) > 0.8 * 0.5 + 0.05) bad = true;
        if (j && Math.hypot(w[0] - u[0], w[1] - u[1]) > AMAX * 0.5 + 0.1) bad = true; u = w; }
      void h; if (bad) { C.refsBad++; note('refs', `${r.episode} t ${p.t} ${p.drone_beliefs[i].id}`); } }
    // refs against the flight: where each drone actually was 0.5-2 s later, on ticks whose slot then stayed put (same order, within 0.1 m)
    if (k + 4 < plans.length) for (let i = 0; i < 3; i++) { let same = true;
      for (let j = 1; j <= 4 && same; j++) { const q = plans[k + j]; if (q.order.version !== p.order.version || D(q.teacher_plan.slots[i], L.slots[i]) > 0.1) same = false; }
      if (same && p.drone_beliefs[i].position[1] > 0.5) for (let j = 1; j <= 4; j++) C.refErr[j - 1].push(D3(L.refs[i][j - 1], plans[k + j].drone_beliefs[i].position)); }
    // 6. stability: a template that flips for one tick and back, follower slots swapping, slot jitter when nothing changed
    if (k > 0 && k < plans.length - 1) { const a = plans[k - 1], b = plans[k + 1];
      if (a.teacher_plan.template === b.teacher_plan.template && a.teacher_plan.template !== L.template && a.order.version === b.order.version) { C.flicker++; note('flicker', `${r.episode} t ${p.t} ${a.teacher_plan.template}->${L.template}->${b.teacher_plan.template}`); } }
    if (k > 0) { const a = plans[k - 1];
      if (a.teacher_plan.template === L.template && a.order.version === p.order.version) {
        const s1 = L.slots[1], s2 = L.slots[2], a1 = a.teacher_plan.slots[1], a2 = a.teacher_plan.slots[2];
        if (D(s1, a2) < 0.3 && D(s2, a1) < 0.3 && D(a1, a2) > 1.0) C.swaps++;
        const still = (a.world_beliefs.person.position === null && p.world_beliefs.person.position === null) || (a.world_beliefs.person.position && p.world_beliefs.person.position && D(a.world_beliefs.person.position, p.world_beliefs.person.position) < 0.1);
        // a slot moved to keep clear of another person who moved is not jitter
        if (still) for (let i = 0; i < 3; i++) { if (L.flags[i].includes('others') || a.teacher_plan.flags[i].includes('others')) continue; const j = D(L.slots[i], a.teacher_plan.slots[i]); C.jitter.push(j); (C.jitterByTemplate[L.template] = C.jitterByTemplate[L.template] || []).push(j); } } }
    // 7. a drone that has not moved for 5 s while its slot is more than 1 m away and its link is fresh
    // (the slot must have been over 1 m away at every tick of the window, under one order: holding still on purpose is not stuck)
    if (k >= 10) { const a = plans[k - 10]; for (let i = 0; i < 3; i++) {
      let far = a.order.version === p.order.version; for (let j = k - 10; j <= k && far; j++) { const v = plans[j].teacher_plan.vectors[i]; if (Math.hypot(v[0], v[2]) <= 1.0) far = false; }
      if (p.drone_beliefs[i].wait_door != null) { C.doorWait++; continue; } // queuing for a doorway (one drone at a time) is expected, and counted apart
      const ta = a.ground_truth.drones ? a.ground_truth.drones[i] : a.drone_beliefs[i].position;
      const folk2 = (p.ground_truth.person.alive ? [p.ground_truth.person.position] : []).concat((p.ground_truth.people || []).filter(h => h.alive).map(h => h.position));
      if (far && D(TP(i), ta) < 0.1 && p.drone_beliefs[i].link_age < 1 && TP(i)[1] > 0.5 && folk2.some(f => D(TP(i), f) < 3.3)) { C.yieldT++; continue; } // held back near a person: yielding
      if (far && D(TP(i), ta) < 0.1 && p.drone_beliefs[i].link_age < 1 && TP(i)[1] > 0.5) { C.stuck++; if (p.use_for_training) C.sftStuck++; note('stuck', `${r.episode} t ${p.t} ${p.drone_beliefs[i].id} ${L.template}`); } } }
    const folk = (p.ground_truth.person.alive ? [p.ground_truth.person.position] : []).concat((p.ground_truth.people || []).filter(h => h.alive).map(h => h.position));
    if (p.use_for_training) { C.sft++; if ([0, 1, 2].some(i => TP(i)[1] > 0.5 && folk.some(f => D(TP(i), f) < 1.2))) C.sftUnsafe++; }
  }
  if (out.segments) C.segments += out.segments.length; C.falseFound += out.false_found || 0;
  C.floor += (out.floor_by_drone_s != null ? out.floor_by_drone_s : out.floor_viol_s) > 0; C.floorPerson += (out.floor_by_person_s || 0) > 0; DOOR.surprise += (out.floor_surprise_s || 0) > 0; C.approach += out.standoff_approach_s > 0.5; C.sepViol += out.sep_viol_s > 0; C.wallViol += out.wall_viol_s > 0; C.altViol += out.alt_viol_s > 0; C.passBy += out.band_viol_s.comfort > 0;
  if (H.cast && H.cast[0]) { const c = H.cast[0], b = c.body, posture = {}; let vmax = 0, n = 0;
    for (const x of plans) { const t = x.ground_truth.person; if (!t.alive) continue; n++; posture[t.posture] = (posture[t.posture] || 0) + 1; vmax = Math.max(vmax, t.speed || 0); }
    const e = { role: out.role, intent: r.intent, view: out.in_view_pct, breached: out.breaches > 0 ? 1 : 0, found: out.found > 0 ? 1 : 0, guided: out.guided > 0 ? 1 : 0 };
    const low = n ? ((posture.lying || 0) + (posture.crouching || 0) + (posture.sitting || 0)) / n : 0;
    addG('age', b.age < 13 ? 'child (<13)' : b.age < 18 ? 'teen (13-17)' : b.age < 65 ? 'adult (18-64)' : 'older (65+)', e);
    addG('height', b.height < 1.5 ? '<1.50 m' : b.height < 1.7 ? '1.50-1.70 m' : b.height < 1.85 ? '1.70-1.85 m' : '>=1.85 m', e);
    addG('mobility', b.aid || 'none', e); addG('posture', low > 0.5 ? 'mostly low (sitting, crouching, lying)' : 'mostly standing', e);
    addG('speed', vmax >= 3 ? 'ran at 3 m/s or more' : 'never above 3 m/s', e);
    addG('skin tone (Monk scale)', b.skinTone <= 3 ? '1-3' : b.skinTone <= 7 ? '4-7' : '8-10', e);
    addG('other people', H.cast.length - 1 === 0 ? 'alone' : H.cast.length - 1 <= 2 ? '1-2 others' : '3+ others', e); }
  const G = F[fam] || (F[fam] = Object.assign(Object.fromEntries(FAMKEYS.map(k => [k, 0])), { episodes: 0, test: 0, estErr: [], minPressure: null, minComfort: null, area: 0, rooms: 0 }));
  for (const k of FAMKEYS) G[k] += C[k] - before[k];
  G.estErr.push(...C.estErr.slice(errBefore)); G.episodes++; G.test += r.split === 'test'; G.rooms += H.floor.rooms.length;
  G.area += H.floor.rooms.reduce((a, q) => a + (q.rects || [[q.x0, q.z0, q.x1, q.z1]]).reduce((b, x) => b + (x[2] - x[0]) * (x[3] - x[1]), 0), 0);
  for (const [k, v] of [['minPressure', out.min_pressure], ['minComfort', out.min_comfort]]) if (v != null && (G[k] === null || v < G[k])) G[k] = v;
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
  { hard: true, name: 'reference points flyable (acceleration, speed, climb)', value: C.refsBad, ok: C.refsBad === 0 },
  { hard: true, name: 'episodes where a drone came within the 1.2 m floor (drone moving toward the person, or both still while it could back away)', value: C.floor, ok: C.floor === 0 },
  { hard: false, name: 'episodes where a person closed within 1.2 m of a drone not moving toward them (outrunning a retreating drone, or walking up to a pinned one)', value: C.floorPerson, ok: C.floorPerson <= Math.ceil(0.01 * C.episodes) },
  { hard: true, name: 'episodes with a drone closing in on a person', value: C.approach, ok: C.approach === 0 },
  { hard: true, name: 'episodes with separation / wall / altitude violations', value: C.sepViol + C.wallViol + C.altViol, ok: C.sepViol + C.wallViol + C.altViol === 0 },
  // soft gates: label noise and balance, thresholds chosen for SFT
  { hard: false, name: 'one-tick template flicker (share of ticks)', value: +share(C.flicker).toFixed(4), ok: share(C.flicker) < 0.005 },
  { hard: false, name: 'follower slot swaps (share of ticks)', value: +share(C.swaps).toFixed(4), ok: share(C.swaps) < 0.002 },
  { hard: false, name: 'slot jitter when nothing changed, p95 (m)', value: J === null ? null : +J.toFixed(3), ok: J !== null && J < 0.5 },
  { hard: true, name: 'training ticks (use_for_training) with a stuck drone', value: C.sftStuck, ok: C.sftStuck === 0 },
  { hard: true, name: 'training ticks (use_for_training) with a drone inside 1.2 m of the person', value: C.sftUnsafe, ok: C.sftUnsafe === 0 },
  { hard: false, name: 'stuck drones, all ticks (share of drone-ticks)', value: +(C.stuck / (3 * C.ticks)).toFixed(4), ok: C.stuck / (3 * C.ticks) < 0.05 },
  { hard: false, name: 'ticks fit for training (use_for_training share)', value: +share(C.sft).toFixed(3), ok: share(C.sft) > 0.8 },
  { hard: false, name: 'estimate error while in sight, p95 (m)', value: q(C.estErr, 0.95) === null ? null : +q(C.estErr, 0.95).toFixed(2), ok: q(C.estErr, 0.95) !== null && q(C.estErr, 0.95) < 1.0 },
  { hard: false, name: 'ticks whose estimate came from a false positive (share of ticks with an estimate)', value: +(C.estFromFP / Math.max(1, C.estTicks)).toFixed(4), ok: C.estFromFP / Math.max(1, C.estTicks) < 0.02 },
  { hard: false, name: 'drone pose error from odometry drift, p95 (m)', value: q(C.poseErr, 0.95) === null ? null : +q(C.poseErr, 0.95).toFixed(2), ok: q(C.poseErr, 0.95) === null || q(C.poseErr, 0.95) < 1.5 },
  { hard: false, name: 'held back by the safety layer near a person, yielding (share of drone-ticks)', value: +(C.yieldT / (3 * C.ticks)).toFixed(4), ok: C.yieldT / (3 * C.ticks) < 0.1 },
  { hard: false, name: 'queuing for a doorway (share of drone-ticks)', value: +(C.doorWait / (3 * C.ticks)).toFixed(4), ok: C.doorWait / (3 * C.ticks) < 0.05 },
  { hard: false, name: 'automatic hold after an order finished (share of ticks)', value: +share(C.autoHold).toFixed(3), ok: share(C.autoHold) < 0.15 },
  { hard: false, name: 'hold, all causes (share of ticks)', value: +share(C.hold).toFixed(3), ok: share(C.hold) < 0.25 },
];
if (DOOR.eps) gates.push(
  { hard: true, name: 'drones through a door that stayed shut (under 60 deg)', value: DOOR.through, ok: DOOR.through === 0 },
  { hard: false, name: 'people inside a door leaf (share of person-ticks)', value: +(DOOR.personInLeaf / Math.max(1, DOOR.personTicks)).toFixed(5), ok: DOOR.personInLeaf / Math.max(1, DOOR.personTicks) < 0.001 },
  { hard: false, name: 'drones waiting beside a shut door (share of drone-ticks)', value: +(DOOR.wait / Math.max(1, DOOR.droneTicks)).toFixed(4), ok: DOOR.wait / Math.max(1, DOOR.droneTicks) < 0.05 },
  { hard: false, name: 'drones cut off from the team by shut doors (share of drone-ticks)', value: +(DOOR.cut / Math.max(1, DOOR.droneTicks)).toFixed(4), ok: DOOR.cut / Math.max(1, DOOR.droneTicks) < 0.01 },
  { hard: false, name: 'episodes where someone hidden behind a door or a corner was first seen inside 1.2 m of a drone', value: DOOR.surprise, ok: DOOR.surprise <= Math.ceil(0.02 * DOOR.eps) });
const families = Object.fromEntries(Object.entries(F).sort().map(([f, G]) => [f, {
  episodes: G.episodes, test: G.test, ticks: G.ticks, rooms: +(G.rooms / G.episodes).toFixed(1), floor_m2: Math.round(G.area / G.episodes),
  label_rule_breaks: G.vecBad + G.standoffBad + G.sepBad + G.boundsBad + G.altBad + G.refsBad, sft: +(G.sft / G.ticks).toFixed(3), sft_stuck: G.sftStuck, sft_unsafe: G.sftUnsafe,
  stuck: +(G.stuck / (3 * G.ticks)).toFixed(4), yielding: +(G.yieldT / (3 * G.ticks)).toFixed(4), door_wait: +(G.doorWait / (3 * G.ticks)).toFixed(4), hold: +(G.hold / G.ticks).toFixed(3), auto_hold: +(G.autoHold / G.ticks).toFixed(3),
  flicker: +(G.flicker / G.ticks).toFixed(4), seen: +(G.seen / G.ticks).toFixed(3), estimate_error_p95: q(G.estErr, 0.95) === null ? null : +q(G.estErr, 0.95).toFixed(2),
  estimate_from_fp: +(G.estFromFP / Math.max(1, G.estTicks)).toFixed(4), episodes_below_floor: G.floor, episodes_closing_in: G.approach, episodes_sep_wall_alt: G.sepViol + G.wallViol + G.altViol,
  min_pressure_m: G.minPressure, min_comfort_m: G.minComfort, comfort_pass_by_episodes: G.passBy }]));
const refVsFlight = C.refErr.map((e, j) => ({ after_s: 0.5 * (j + 1), n: e.length, p50: q(e, 0.5) === null ? null : +q(e, 0.5).toFixed(2), p95: q(e, 0.95) === null ? null : +q(e, 0.95).toFixed(2) }));
const byGroup = Object.fromEntries(Object.entries(GROUPS).map(([dim, g]) => [dim, Object.fromEntries(Object.entries(g).sort().map(([k, x]) => [k, { episodes: x.episodes, in_view_pct: +(x.view / x.episodes).toFixed(1),
  intruders_breached: x.intr ? `${x.breached}/${x.intr}` : null, hiders_found: x.hid ? `${x.found}/${x.hid}` : null, visitors_guided_out: x.vis ? `${x.guided}/${x.vis}` : null }]))]));
const report = { dir, episodes: C.episodes, ticks: C.ticks, gates, families, by_subject_group: byGroup, refs_vs_flight: refVsFlight, pose_error: { p50: q(C.poseErr, 0.5), p95: q(C.poseErr, 0.95) }, standoff_checked: C.standoffChecked, jitter_p50: J50, jitter_by_template: jitterBy,
  perception: { detections_true: C.tp, detections_other_people: C.other, detections_false: C.fp, false_accepted: C.fpAccepted, estimate_error_p50: q(C.estErr, 0.5), estimate_error_p95: q(C.estErr, 0.95), searches_ended_on_a_false_positive: C.falseFound },
  obs: { seen: +share(C.seen).toFixed(3), estimate_only: +share(C.estimate).toFixed(3), unknown: +share(C.unknown).toFixed(3) },
  goals: C.goal, templates: C.template, bands: C.band, comfort_pass_by_episodes: C.passBy, examples: C.worst,
  doors: DOOR.eps ? { episodes: DOOR.eps, at_start: DOOR.init, opened_by_people: DOOR.opened, closed_by_people: DOOR.closed } : null };
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`${dir}: ${C.episodes} episodes, ${C.ticks} plan ticks (${C.standoffChecked} with a person estimate)`);
  for (const g of gates) console.log(`${g.ok ? 'PASS' : 'FAIL'} ${g.hard ? 'hard' : 'soft'}  ${g.name}: ${g.value}${!g.ok && C.worst[{ 'vector = slot - position': 'vec', 'slots keep the band standoff from the estimate': 'standoff', 'slots at least 1 m apart': 'sep', 'reference points reachable': 'refs', 'one-tick template flicker (share of ticks)': 'flicker', 'stuck drones, all ticks (share of drone-ticks)': 'stuck', 'drones through a door that stayed shut (under 60 deg)': 'through', 'people inside a door leaf (share of person-ticks)': 'leaf' }[g.name]] ? '   e.g. ' + C.worst[{ 'vector = slot - position': 'vec', 'slots keep the band standoff from the estimate': 'standoff', 'slots at least 1 m apart': 'sep', 'reference points reachable': 'refs', 'one-tick template flicker (share of ticks)': 'flicker', 'stuck drones, all ticks (share of drone-ticks)': 'stuck', 'drones through a door that stayed shut (under 60 deg)': 'through', 'people inside a door leaf (share of person-ticks)': 'leaf' }[g.name]] : ''}`);
  console.log(`observations: seen ${report.obs.seen}, estimate only ${report.obs.estimate_only}, unknown ${report.obs.unknown}; comfort pass-bys in ${C.passBy} episodes`);
  console.log(`perception (records' last frames): ${C.tp} of the subject, ${C.other} of other people, ${C.fp} false (${C.fpAccepted} confident enough to count); estimate error in sight p50 ${q(C.estErr, 0.5) && q(C.estErr, 0.5).toFixed(2)} m, p95 ${q(C.estErr, 0.95) && q(C.estErr, 0.95).toFixed(2)} m; searches ended on a false positive: ${C.falseFound}`);
  console.log('refs against the flight (slot unchanged), p50/p95 m: ' + refVsFlight.map(x => `+${x.after_s} s ${x.p50}/${x.p95}`).join(', '));
  console.log('slot jitter p50/p95 by template:', Object.entries(jitterBy).map(([k, v]) => `${k} ${v.p50}/${v.p95}`).join(', '));
  if (DOOR.eps) console.log(`doors at the start: ${DOOR.init.closed} shut, ${DOOR.init.ajar} half open, ${DOOR.init.open} open, ${DOOR.init.locked} locked, ${DOOR.init.opening} openings with no door; people opened ${DOOR.opened} and closed ${DOOR.closed}`);
  if (Object.keys(byGroup).length) {
    console.log('\nby who the subject is (the simulated detector does not model skin tone: that split is a baseline for a real detector on frames)');
    for (const [dim, g] of Object.entries(byGroup)) for (const [k, x] of Object.entries(g)) console.log(`  ${dim.padEnd(24)} ${k.padEnd(40)} ${String(x.episodes).padStart(4)} eps · in view ${x.in_view_pct}% · intruders in ${x.intruders_breached || '—'} · hiders found ${x.hiders_found || '—'} · visitors out ${x.visitors_guided_out || '—'}`);
  }
  if (Object.keys(families).length) {
    console.log('\nby floor family: episodes (test) · rooms · m2 · ticks | label rule breaks · training share · training stuck/unsafe · stuck · door queue · hold (auto) · flicker | seen · est. err p95 · from FP | ' +
      'episodes below 1.2 m · closing in · sep/wall/alt · comfort pass-by | closest: pressure / comfort (m)');
    for (const [f, x] of Object.entries(families)) console.log(`  ${f.padEnd(10)} ${String(x.episodes).padStart(4)} (${x.test}) · ${x.rooms} · ${x.floor_m2} · ${x.ticks} | ${x.label_rule_breaks} · ${x.sft} · ${x.sft_stuck}/${x.sft_unsafe} · ` +
      `${x.stuck} · ${x.door_wait} · ${x.hold} (${x.auto_hold}) · ${x.flicker} | ${x.seen} · ${x.estimate_error_p95} · ${x.estimate_from_fp} | ${x.episodes_below_floor} · ${x.episodes_closing_in} · ${x.episodes_sep_wall_alt} · ` +
      `${x.comfort_pass_by_episodes} | ${x.min_pressure_m == null ? '—' : x.min_pressure_m} / ${x.min_comfort_m == null ? '—' : x.min_comfort_m}`);
  }
}
fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify(report, null, 1));
process.exit(gates.some(g => g.hard && !g.ok) ? 1 : 0);
