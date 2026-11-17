#!/usr/bin/env node
// [dan] Check every record of a generated dataset against contract v0 and report counts.
//   node simulators/tools/check_dataset.js output/dataset/run1
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = process.argv[2] || 'output/dataset/run1';
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
// a floor: its family, source and licence, and every room as one or more rectangles [x0, z0, x1, z1] inside the floor
const floorOk = F => !!F && typeof F.family === 'string' && typeof F.source === 'string' && typeof F.licence === 'string' && Number.isInteger(F.home) &&
  Array.isArray(F.protectable) && F.rooms.every(q => Array.isArray(q.rects) && q.rects.length > 0 && q.rects.every(x => x.length === 4 && x.every(Number.isFinite) && x[0] < x[2] && x[1] < x[3] && x[2] <= F.W && x[3] <= F.D));
const errs = []; const count = { header: 0, plan: 0, order: 0, outcome: 0 };
const need = (ok, msg) => { if (!ok && errs.length < 30) errs.push(msg); };
const files = fs.readdirSync(path.join(dir, 'episodes')).filter(f => f.endsWith('.jsonl.gz')).sort();
const INDOOR_GOALS = ['hold', 'keepout', 'driveout', 'guideout', 'track', 'contain', 'search', 'explore', 'overwatch', 'return'];
const finite = v => Number.isFinite(v);
function checkIndoorPlan(f, r, H) { // swarm-indoor adds timed reference points, yaw, spin, validator flags, room-level belief and the person's truth
  const L = r.label;
  need(INDOOR_GOALS.includes(r.order.goal) && typeof L.template === 'string' && typeof L.text === 'string', `${f}: bad indoor goal/template at ${r.t}`);
  need(L.band === 'pressure' || L.band === 'comfort', `${f}: missing standoff band at ${r.t}`);
  need(typeof r.sft === 'boolean', `${f}: missing training flag (sft) at ${r.t}`);
  // perception: detections with confidence, the scanned map, search coverage, camera rays; truth marks which detections were the person
  need(Array.isArray(r.obs.detections) && r.obs.detections.every(x => isVec3(x.p) && x.conf > 0 && x.conf < 1 && finite(x.age) && x.age >= 0), `${f}: bad detections at ${r.t}`);
  need(Number.isInteger(r.obs.target_track) && r.obs.detections.every(x => Number.isInteger(x.track)) && Array.isArray(r.obs.people) && r.obs.people.every(o => Number.isInteger(o.track) && isVec3(o.p)), `${f}: bad tracks or other people at ${r.t}`);
  need(Array.isArray(r.truth.people) && r.truth.people.every(h => isVec3(h.pos) && Number.isInteger(h.tid)) && r.truth.detections_who.length === r.obs.detections.length, `${f}: bad people truth at ${r.t}`);
  need(Array.isArray(r.truth.drones) && r.truth.drones.length === 3 && r.truth.drones.every(t => t.length === 4 && t.every(finite)), `${f}: missing true drone poses at ${r.t}`);
  need(r.team.every(d => d.cam === null || d.cam.every(v => v === null || (finite(v) && v >= 0))), `${f}: bad camera ray values at ${r.t}`);
  need(typeof r.obs.map === 'string' && r.obs.map.length === H.map.w * H.map.h && /^[#.?]*$/.test(r.obs.map), `${f}: bad scanned map at ${r.t}`);
  need(Array.isArray(r.obs.coverage) && r.obs.coverage.length === H.floor.rooms.length, `${f}: bad coverage at ${r.t}`);
  // doors with leaves (when the episode has them): what the drones believe (angle, age) or null if unseen; the truth (angle, locked)
  if (H.doors.length && H.doors[0].hinge !== undefined) {
    need(H.doors.every(d => (d.kind === 'hinged' || d.kind === 'opening') && (d.hinge === -1 || d.hinge === 1) && (d.swing === -1 || d.swing === 1) && [0, 1, 2].includes(d.leaves) && finite(d.leaf_m) && (d.kind === 'opening') === (d.leaves === 0)), `${f}: bad door leaves in the header`);
    need(r.truth.doors.every((t, i) => H.doors[i].kind !== 'opening' || (t[0] === 90 && t[1] === 0)), `${f}: an opening that is not open at ${r.t}`);
    need(Array.isArray(r.obs.doors) && r.obs.doors.length === H.doors.length && r.obs.doors.every(b => b === null || (b.length === 2 && finite(b[0]) && b[0] >= 0 && b[0] <= 90 && finite(b[1]) && b[1] >= 0)), `${f}: bad believed doors at ${r.t}`);
    need(Array.isArray(r.truth.doors) && r.truth.doors.length === H.doors.length && r.truth.doors.every(t => t.length === 2 && finite(t[0]) && t[0] >= 0 && t[0] <= 90 && (t[1] === 0 || t[1] === 1)), `${f}: bad door truth at ${r.t}`);
  }
  need(r.team.every(d => d.cam === null || (Array.isArray(d.cam) && d.cam.length === 31)), `${f}: bad camera rays at ${r.t}`);
  need(Array.isArray(r.truth.detections_tp) && r.truth.detections_tp.length === r.obs.detections.length, `${f}: detections without truth at ${r.t}`);
  need(Array.isArray(L.refs) && L.refs.length === 3 && L.refs.every(d => d.length === 4 && d.every(isVec3)), `${f}: bad refs at ${r.t}`);
  need(L.yaw.length === 3 && L.yaw.every(y => y === null || finite(y)) && L.spin.length === 3 && L.flags.length === 3, `${f}: bad yaw/spin/flags at ${r.t}`);
  need(Array.isArray(r.obs.belief_rooms) && Array.isArray(r.obs.cleared) && (r.obs.last_seen_age === null || finite(r.obs.last_seen_age)), `${f}: bad indoor obs at ${r.t}`);
  need(r.team.every(d => finite(d.yaw) && finite(d.link_age) && (d.wait_door === null || Number.isInteger(d.wait_door))), `${f}: bad indoor team at ${r.t}`);
  need(r.truth && r.truth.person && isVec3(r.truth.person.pos) && finite(r.truth.margin), `${f}: missing indoor truth at ${r.t}`);
  // no leak: nothing from truth may appear in the inputs (obs.p is the team's estimate, null when unknown)
  need(r.obs.seen || r.obs.p === null || (r.obs.last_seen_age !== null && r.obs.last_seen_age <= 4.0001), `${f}: estimate without a recent sighting at ${r.t}`);
}
for (const f of files) {
  const recs = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'episodes', f))).toString().trim().split('\n').map(l => JSON.parse(l));
  need(recs[0].type === 'header' && recs[recs.length - 1].type === 'outcome', `${f}: must start with header and end with outcome`);
  const indoor = recs[0].sim === 'swarm-indoor';
  let lastT = -1, lastV = -1;
  for (const r of recs) {
    count[r.type] = (count[r.type] || 0) + 1;
    if (r.type === 'header') need(r.schema === 'dmc.contract.v0' && Number.isInteger(r.seed) && Array.isArray(r.doors) && Array.isArray(r.orders) && (!indoor || (r.map && r.perception && r.floor_role && floorOk(r.floor) && finite(r.perception.pose_drift_of_distance) && Array.isArray(r.perception.light_by_room) && Array.isArray(r.cast) && r.cast.length >= 1 && r.cast.every(c => Number.isInteger(c.tid) && c.body && c.look))), `${f}: bad header`);
    if (r.type === 'order') need(typeof r.text === 'string' && r.intended && typeof r.applied === 'boolean' && r.situation, `${f}: bad order at ${r.t}`);
    if (r.type === 'plan') {
      need(r.t >= lastT, `${f}: time goes backwards at ${r.t}`); lastT = r.t;
      need(r.order.version >= lastV, `${f}: goal version decreased at ${r.t}`); lastV = r.order.version;
      need(r.team.length === 3 && r.team.every(d => isVec3(d.pos) && isVec3(d.vel)), `${f}: bad team at ${r.t}`);
      need(r.label.slots.length === 3 && r.label.slots.every(isVec3) && r.label.vectors.every(isVec3), `${f}: bad label at ${r.t}`);
      need(r.obs.p === null || isVec3(r.obs.p), `${f}: bad obs at ${r.t}`);
      if (indoor) checkIndoorPlan(f, r, recs[0]); else need(r.truth && r.truth.intruder && isVec3(r.truth.intruder.pos), `${f}: missing truth at ${r.t}`);
    }
    if (r.type === 'outcome') need(Number.isFinite(r.t_end) && typeof r.left_without_breach === 'boolean' && (!indoor || (typeof r.deterrable === 'boolean' && finite(r.standoff_approach_s) && finite(r.floor_viol_s) && r.band_viol_s)), `${f}: bad outcome`);
  }
}
console.log(`${files.length} episodes checked: ${count.plan} plan records, ${count.order} order events, ${count.header} headers, ${count.outcome} outcomes`);
if (errs.length) { console.log('PROBLEMS:\n  ' + errs.join('\n  ')); process.exit(1); } else console.log('every record matches contract v0');
