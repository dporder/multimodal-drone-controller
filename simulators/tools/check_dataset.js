#!/usr/bin/env node
// [dan] Check every record of a generated dataset against contract v0 and report counts.
//   node simulators/tools/check_dataset.js output/dataset/run1
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = process.argv[2] || 'output/dataset/run1';
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const errs = []; const count = { header: 0, plan: 0, order: 0, outcome: 0 };
const need = (ok, msg) => { if (!ok && errs.length < 30) errs.push(msg); };
const files = fs.readdirSync(path.join(dir, 'episodes')).filter(f => f.endsWith('.jsonl.gz')).sort();
for (const f of files) {
  const recs = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'episodes', f))).toString().trim().split('\n').map(l => JSON.parse(l));
  need(recs[0].type === 'header' && recs[recs.length - 1].type === 'outcome', `${f}: must start with header and end with outcome`);
  let lastT = -1, lastV = -1;
  for (const r of recs) {
    count[r.type] = (count[r.type] || 0) + 1;
    if (r.type === 'header') need(r.schema === 'dmc.contract.v0' && Number.isInteger(r.seed) && Array.isArray(r.doors) && Array.isArray(r.orders), `${f}: bad header`);
    if (r.type === 'order') need(typeof r.text === 'string' && r.intended && typeof r.applied === 'boolean' && r.situation, `${f}: bad order at ${r.t}`);
    if (r.type === 'plan') {
      need(r.t >= lastT, `${f}: time goes backwards at ${r.t}`); lastT = r.t;
      need(r.order.version >= lastV, `${f}: goal version decreased at ${r.t}`); lastV = r.order.version;
      need(r.team.length === 3 && r.team.every(d => isVec3(d.pos) && isVec3(d.vel)), `${f}: bad team at ${r.t}`);
      need(r.label.slots.length === 3 && r.label.slots.every(isVec3) && r.label.vectors.every(isVec3), `${f}: bad label at ${r.t}`);
      need(r.obs.p === null || isVec3(r.obs.p), `${f}: bad obs at ${r.t}`);
      need(r.truth && r.truth.intruder && isVec3(r.truth.intruder.pos), `${f}: missing truth at ${r.t}`);
    }
    if (r.type === 'outcome') need(Number.isFinite(r.t_end) && typeof r.left_without_breach === 'boolean', `${f}: bad outcome`);
  }
}
console.log(`${files.length} episodes checked: ${count.plan} plan records, ${count.order} order events, ${count.header} headers, ${count.outcome} outcomes`);
if (errs.length) { console.log('PROBLEMS:\n  ' + errs.join('\n  ')); process.exit(1); } else console.log('every record matches contract v0');
