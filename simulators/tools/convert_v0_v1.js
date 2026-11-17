#!/usr/bin/env node
// [dan] Converts a run from contract v0 to v1 in place (docs/DATASET_PLAN.md, "Record format"):
//
//   node simulators/tools/convert_v0_v1.js output/dataset/indoor3
//
// v1 renames the plan line's keys so they say what they hold (Dan, 17 November 2026):
//   obs   -> world_beliefs  the person's keys grouped under person (p -> position, v -> velocity, belief_rooms -> possible_rooms);
//                           detections[].p and people[].p -> position
//   team  -> drone_beliefs  pos -> position, vel -> velocity, cam -> depth_readings
//   label -> teacher_plan
//   truth -> ground_truth   person, intruder and people[]: pos -> position
//   sft   -> use_for_training, also in the outcome's segments
// Nothing else changes: values, key order within each object and the other line types stay as they were. Every episode file and
// the manifest (with each file's new sha256) are rewritten; run check_dataset.js and quality_report.js again afterwards.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const rename = (o, map) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return o; const r = {}; for (const [k, v] of Object.entries(o)) r[map[k] || k] = v; return r; };
const PERSON = { seen: 'seen', p: 'position', v: 'velocity', last_seen_age: 'last_seen_age', room: 'room', belief_rooms: 'possible_rooms' };

function worldBeliefs(o) {
  const person = {}, rest = {};
  for (const [k, v] of Object.entries(o)) {
    if (k in PERSON) person[PERSON[k]] = v;
    else rest[k] = (k === 'detections' || k === 'people') && Array.isArray(v) ? v.map(x => rename(x, { p: 'position' })) : v;
  }
  return Object.assign({ person }, rest);
}
function groundTruth(t) {
  const r = {};
  for (const [k, v] of Object.entries(t)) r[k] = k === 'person' || k === 'intruder' ? rename(v, { pos: 'position' }) : k === 'people' && Array.isArray(v) ? v.map(h => rename(h, { pos: 'position' })) : v;
  return r;
}
function planLine(p) {
  const r = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'obs') r.world_beliefs = worldBeliefs(v);
    else if (k === 'team') r.drone_beliefs = v.map(d => rename(d, { pos: 'position', vel: 'velocity', cam: 'depth_readings' }));
    else if (k === 'label') r.teacher_plan = v;
    else if (k === 'truth') r.ground_truth = groundTruth(v);
    else if (k === 'sft') r.use_for_training = v;
    else r[k] = v;
  }
  return r;
}
const outcome = o => o && Array.isArray(o.segments) ? Object.assign({}, o, { segments: o.segments.map(s => rename(s, { sft: 'use_for_training' })) }) : o;
function convert(r) {
  if (r.type === 'header') return Object.assign({}, r, { schema: 'dmc.contract.v1' });
  if (r.type === 'plan') return planLine(r);
  if (r.type === 'outcome') return outcome(r);
  return r;
}
module.exports = { convert, outcome };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node simulators/tools/convert_v0_v1.js <run folder>'); process.exit(2); }
  const manFile = path.join(dir, 'manifest.jsonl');
  const man = fs.readFileSync(manFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  let done = 0, already = 0;
  for (const row of man) {
    const f = path.join(dir, row.file);
    const recs = zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l));
    if (recs[0].type !== 'header' || recs[0].schema !== 'dmc.contract.v0') { already++; continue; }
    const body = recs.map(r => JSON.stringify(convert(r))).join('\n') + '\n';
    fs.writeFileSync(f + '.tmp', zlib.gzipSync(body, { level: 6 })); fs.renameSync(f + '.tmp', f);
    row.sha256 = crypto.createHash('sha256').update(body).digest('hex'); row.outcome = outcome(row.outcome); if (row.baseline) row.baseline = outcome(row.baseline);
    done++;
  }
  fs.writeFileSync(manFile + '.tmp', man.map(r => JSON.stringify(r)).join('\n') + '\n'); fs.renameSync(manFile + '.tmp', manFile);
  console.log(`${dir}: ${done} episodes converted to contract v1${already ? `, ${already} were not v0` : ''}; run check_dataset.js and quality_report.js again`);
}
