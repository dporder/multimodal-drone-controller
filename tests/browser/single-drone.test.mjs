import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SingleSimulation} from '../../swarm_lab/browser/single/simulation.js';
import {hardwareBudget,DEFAULTS,parseInstruction,TARGETS} from '../../swarm_lab/browser/single/config.js';
import {FlightPolicy,validateAction} from '../../swarm_lab/browser/single/policy.js';
const weights=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/browser/single/flight-policy.json',import.meta.url)));
const make=config=>new SingleSimulation(weights,config);
function run(s,seconds,stop=false){for(let n=0;n<240*seconds;n++){s.step();if(stop&&['success','fault'].includes(s.state))break;}return s.snapshot();}
test('single lab creates one physical drone, four rotors, and stable force-driven hover',()=>{
 const s=make({wind:0});assert.equal(s.world.bodies.filter(b=>b.mass>0).length,1);assert.equal(s.rotors.length,4);
 const state=run(s,8);assert.equal(state.state,'ready');assert.ok(Math.abs(state.position[2]-2.4)<.02);assert.ok(state.rotors.every(r=>Math.abs(r.thrust-s.budget.mass_kg*9.81/4)<.05));assert.ok(Math.abs(Math.hypot(s.body.quaternion.w,s.body.quaternion.x,s.body.quaternion.y,s.body.quaternion.z)-1)<1e-6);
 const before=s.position()[2];s.body.velocity.z=-1;s.step();assert.ok(s.position()[2]<before);assert.ok(s.thrust.every(Number.isFinite));
});
test('payload and compute affect physical mass, hover thrust and electrical consumption',()=>{
 const a=make({compute:'nx16',wind:0}),b=make({compute:'agx64',wind:0});run(a,3);run(b,3);
 assert.ok(b.body.mass>a.body.mass);assert.ok(b.thrust[0]>a.thrust[0]);assert.ok(b.energyWh>a.energyWh);
 const heavy=make({airframe:'compact',compute:'thor128'});assert.equal(heavy.budget.payload_ok,false);assert.throws(()=>heavy.start('Find the red box'),/Payload/);
 assert.equal(hardwareBudget({...DEFAULTS,model:'openvla'}).memory_ok,false);assert.equal(hardwareBudget({...DEFAULTS,model:'openvla',compute:'agx64'}).memory_ok,true);
});
test('local language boundary validates goals and visual selection does not reveal hidden positions',()=>{
 assert.equal(parseInstruction('Touch this object','blue-box').target_id,'blue-box');assert.throws(()=>parseInstruction('Find the red and blue boxes'),/one object/);assert.throws(()=>parseInstruction('Fly somewhere'),/Use/);
 const s=make({camera_yaw:180});s.select('orange-panel');s.sense();assert.equal(s.observed['orange-panel'],undefined);s.start('Find the orange panel');run(s,1);assert.notEqual(s.state,'success');assert.equal(s.observed['orange-panel'],undefined);
 s.setCamera({camera_yaw:0});run(s,5,true);assert.equal(s.state,'success');
});
test('camera mounts change extrinsics and field of view; geometry occludes sensing',()=>{
 const s=make(),front=s.cameraPose();s.setCamera({mount:'underslung',camera_pitch:-90});const bottom=s.cameraPose();assert.notDeepEqual(front.position,bottom.position);assert.ok(bottom.direction[2]<-.99);s.sense();assert.equal(s.visible.includes('orange-panel'),false);
 s.setCamera({mount:'front',camera_pitch:0});const target=s.sceneObjects.find(o=>o.id==='green-panel');target.position=[0,5,1.7];s.staticBodies.find(b=>b.objectId===target.id).position.set(...target.position);s.sense();assert.equal(s.visible.includes(target.id),false);
});
test('learned flight network is loaded, executes inference and exports no fake foundation model',()=>{
 const policy=new FlightPolicy(weights);assert.equal(weights.samples,45000);assert.ok(weights.validation_mae<.15);const a=policy.predict([3,0,0],[0,0,0],1),b=policy.predict([-3,0,0],[0,0,0],1);assert.ok(a[0]>.5);assert.ok(b[0]<-.5);assert.deepEqual(policy.predict([0,0,0],[0,0,0],1),[0,0,0]);assert.equal(policy.calls,3);
});
test('find and inspect have distinct camera-confirmation and stand-off success conditions',()=>{
 const find=make();find.start('Find the orange panel');run(find,8,true);assert.equal(find.state,'success');assert.ok(find.time<5);assert.ok(Math.hypot(...find.position().map((v,i)=>v-[0,-6,2.4][i]))<.1);
 const inspect=make();inspect.start('Inspect the green panel');run(inspect,80,true);assert.equal(inspect.state,'success');assert.ok(inspect.policy.calls>50);assert.equal(inspect.telemetry.contact_speed,null);assert.equal(inspect.telemetry.collisions,0);assert.ok(inspect.position()[1]>2);
});
for(const target of TARGETS)test(`${target.name}: autonomous NN approach completes gentle physical probe contact`,()=>{
 const s=make();s.start(`Touch the ${target.color_word} object`);run(s,110,true);assert.equal(s.state,'success',s.status);assert.ok(s.telemetry.contact_speed!==null&&s.telemetry.contact_speed<=.25);assert.equal(s.telemetry.collisions,0);assert.ok(s.events.some(e=>e.type==='contact'));assert.ok(s.telemetry.actions>30);assert.equal(s.world.bodies.filter(b=>b.mass>0).length,1);
});
test('contact with the wrong fixture is a fault, not mission success',()=>{
 const s=make({wind:0});s.start('Touch the orange panel');s.state='contact';s.body.position.set(-5,2.49,1.6);run(s,.2,true);assert.equal(s.state,'fault');assert.equal(s.telemetry.contact_speed,null);assert.ok(s.telemetry.collisions>0);
});
test('hold invalidates pending neural actions; slow inference brakes while physics continues',()=>{
 const s=make({inference_ms:350});s.start('Inspect the orange panel');run(s,.1);assert.ok(s.pending);s.hold();const mission=s.missionId;run(s,2);assert.equal(s.missionId,mission);assert.equal(s.state,'hold');assert.deepEqual(s.action,[0,0,0]);
 const slow=make({inference_ms:1000});slow.start('Inspect the orange panel');run(slow,4);assert.ok(slow.time>3.9);assert.ok(slow.telemetry.rejected>0);assert.equal(slow.telemetry.actions,0);assert.ok(Math.hypot(...slow.velocity())<.1);
});
test('external VLA interface rejects unsafe, stale and frame-mismatched actions atomically',()=>{
 const s=make();s.setPolicyMode('external');s.start('Inspect the orange panel');s.sense();const request=s.externalObservation(),valid={version:1,episode:s.episode,mission:s.missionId,sequence:request.sequence,frame:'body_flu',velocity_mps:[.3,0,0],yaw_rate_rps:0,duration_s:.2};
 for(const edit of [r=>r.velocity_mps=[NaN,0,0],r=>r.velocity_mps=[3,0,0],r=>r.frame='arm_joints',r=>r.mission--,r=>r.duration_s=3]){const bad=structuredClone(valid);edit(bad);assert.throws(()=>validateAction(bad,request,s.time));}
 s.acceptExternal(valid);assert.ok(Math.abs(s.action[0])<1e-8);assert.ok(s.action[1]>.29);run(s,1);assert.ok(s.stale);assert.ok(s.time>.99);
 const old=s.externalObservation();run(s,1);assert.throws(()=>s.acceptExternal({...valid,sequence:old.sequence}),/expired/);assert.ok(s.telemetry.rejected>0);
});
test('manual input moves the single drone and pause/single step preserve exact integration',()=>{
 const s=make({wind:0});s.setManual(true);s.manual=[1,0,.4,0];run(s,2);assert.ok(s.position()[1]>-5);assert.ok(s.position()[2]>2.8);s.running=false;const t=s.time;assert.equal(s.step(),false);assert.equal(s.time,t);for(let n=0;n<12;n++)s.step(true);assert.ok(Math.abs(s.time-t-.05)<1e-8);
});
