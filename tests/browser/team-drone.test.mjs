import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TeamSimulation,evaluateCurve,DRONE_IDS} from '../../swarm_lab/browser/single/team.js';
import {ObservedMap} from '../../swarm_lab/browser/sim/observed-map.js';
const weights=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/browser/single/flight-policy.json',import.meta.url)));
const make=config=>new TeamSimulation(weights,config);
function run(s,seconds,stop=false){for(let i=0;i<seconds*240;i++){s.step();if(stop&&['success','fault'].includes(s.state))break;}return s.snapshot();}
test('three independent quadcopters share one world and one 240 Hz integration',()=>{
 const s=make({wind:0});assert.equal(s.world.bodies.filter(b=>b.mass>0).length,3);assert.ok(s.agents.every(a=>a.world===s.world));
 const state=run(s,3);assert.ok(Math.abs(state.time-3)<1e-9);assert.equal(state.drones.length,3);assert.equal(state.drones.flatMap(a=>a.rotors).length,12);
 state.drones.forEach((a,i)=>{assert.equal(a.id,DRONE_IDS[i]);assert.equal(a.time,state.time);assert.ok(Math.abs(a.position[2]-[2.4,3.2,4.2][i])<.02);});
 assert.equal(new Set(s.agents.map(a=>a.policy)).size,3);assert.equal(new Set(s.agents.map(a=>a.body)).size,3);
});
test('camera cones include peers and peer bodies occlude other first-hit observations',()=>{
 const s=make({wind:0,camera_pitch:0});s.agents[1].body.position.set(0,-3,2.4);s.agents[1].body.aabbNeedsUpdate=true;s.world.broadphase.dirty=true;s.agents[0].sense();
 assert.ok(s.agents[0].visible.includes('slave1'));assert.equal(s.visionRay(0,s.lead.cameraPose().position,[0,2,2.4]).id,'slave1');
 s.lead.setCamera({camera_yaw:180});assert.equal(s.lead.visible.includes('slave1'),false);
 assert.notDeepEqual(s.agents[0].cameraPose(),s.agents[1].cameraPose());
});
test('partial reconstruction contains only camera surface samples, no hidden complete meshes',()=>{
 const s=make({wind:0});s.map=new ObservedMap(s.origin);s.shared={};
 s.agents.forEach(a=>{a.setCamera({camera_yaw:180,camera_pitch:40});});s.observe();
 assert.equal(s.map.objects.size,0);assert.deepEqual(s.shared,{});
 s.lead.setCamera({camera_yaw:0,camera_pitch:-8});s.map=new ObservedMap(s.origin);s.observe();
 const map=s.map.snapshot(s.time);assert.ok(map.point_count>0);assert.ok(map.objects.every(o=>o.seen_by.every(i=>i===0)));assert.ok(map.objects.every(o=>o.geometry==='observed surface extent; incomplete'));
 for(const o of map.objects)for(const p of o.points){const world=p.map((v,i)=>v+s.origin[i]);assert.ok(s.lead.inView(world,s.lead.cameraPose()));const hit=s.visionRay(0,s.lead.cameraPose().position,world.map((v,i)=>v+(v-s.lead.cameraPose().position[i])*.0001));assert.equal(hit?.id,o.id);}
});
test('fixed origin never follows the master; pairwise offsets are antisymmetric',()=>{
 const s=make({wind:0}),origin=[...s.origin];s.setManual(true);s.manual=[1,0,0,0];const snap=run(s,3);
 assert.deepEqual(snap.origin,origin);assert.ok(snap.drones[0].absolute[1]>.8);assert.deepEqual(snap.drones[0].relative_to_master,[0,0,0]);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)assert.ok(Math.abs(snap.relative[i][j][k]+snap.relative[j][i][k])<1e-9);
 s.setActiveDrone(2);s.setManual(true);s.manual=[0,0,.4,0];run(s,2);assert.ok(s.agents[2].position()[2]>4.5);assert.ok(s.lead.manual.every(v=>v===0));
 s.hold();assert.ok(s.agents.every(a=>!a.manualMode&&a.manual.every(v=>v===0)));
 const episode=s.episode,time=s.time;assert.throws(()=>s.reset({wind:-1}),/Invalid wind/);assert.equal(s.episode,episode);assert.equal(s.time,time);assert.equal(s.agents.length,3);
});
test('NN1 emits exactly three curved one-second references; controllers actually follow them',()=>{
 const s=make();s.start('Inspect the orange panel');const before=s.planRevision;run(s,.9);assert.equal(s.planRevision,before);run(s,.2);assert.equal(s.planRevision,before+1);
 const state=run(s,8);assert.equal(state.plans.length,3);
 state.plans.forEach(p=>{assert.equal(p.duration,1);assert.equal(p.controls.length,4);assert.equal(p.points.length,21);assert.deepEqual(evaluateCurve(p,0).position,p.controls[0]);assert.deepEqual(evaluateCurve(p,1).position,p.controls[3]);assert.ok(state.time-p.generated_at<1.01);});
 assert.ok(s.agents.every(a=>a.policy.calls>5&&a.telemetry.actions>10));assert.ok(state.drones.every(a=>Math.hypot(...a.velocity)>.05));
 assert.ok(state.plans.some(p=>{const a=p.controls[0],b=p.controls[3],m=evaluateCurve(p,.5).position;return Math.hypot(...m.map((v,k)=>v-(a[k]+b[k])/2))>.0001;}));
});
test('hidden targets trigger independent stored search fields before localization',()=>{
 const s=make({camera_yaw:180});s.start('Inspect the orange panel');assert.equal(s.state,'search');assert.equal(new Set(s.goals.map(p=>JSON.stringify(p))).size,3);assert.equal(s.shared['orange-panel'],undefined);
 run(s,20);assert.ok(s.shared['orange-panel']);assert.notEqual(s.state,'fault');
});
for(const color of ['orange','blue','green','red'])test(`three-view ${color} inspection completes with physical separation`,()=>{
 const s=make();s.start(`Inspect the ${color} object`);let min=Infinity;
 for(let n=0;n<240*100;n++){s.step();for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)min=Math.min(min,Math.hypot(...s.agents[i].position().map((v,k)=>v-s.agents[j].position()[k])));if(['success','fault'].includes(s.state))break;}
 assert.equal(s.state,'success',s.status);assert.ok(min>1.6,`minimum separation ${min}`);assert.ok(s.agents.every(a=>a.telemetry.collisions===0&&a.visible.includes(s.selected)));assert.ok(s.agents.every(a=>a.config.fov===55));
});
test('only the master performs physical contact while partners observe from stand-off',()=>{
 const s=make();s.start('Touch the orange panel');run(s,90,true);assert.equal(s.state,'success');assert.ok(s.lead.telemetry.contact_speed!==null&&s.lead.telemetry.contact_speed<=.25);
 assert.ok(s.agents.slice(1).every(a=>a.telemetry.contact_speed===null&&a.telemetry.collisions===0));
});
test('pause and single-step keep all clocks aligned; hold invalidates every pending plan action',()=>{
 const s=make();s.start('Inspect the orange panel');run(s,2);s.running=false;const t=s.time;assert.equal(s.step(),false);assert.equal(s.time,t);for(let n=0;n<12;n++)s.step(true);assert.ok(Math.abs(s.time-t-.05)<1e-8);assert.ok(s.agents.every(a=>a.time===s.time));
 s.hold();s.running=true;run(s,3);assert.equal(s.task,null);assert.ok(s.agents.every(a=>!a.pending&&!a.task&&Math.hypot(...a.velocity())<.15));
 const slow=make({inference_ms:1000});slow.start('Inspect the orange panel');run(slow,4);assert.ok(slow.agents.every(a=>a.telemetry.rejected>0&&a.telemetry.actions===0));
});
