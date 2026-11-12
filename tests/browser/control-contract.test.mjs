import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation} from '../../swarm_lab/browser/sim/simulation.js';
const spec=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/models/world.json',import.meta.url)));
const make=()=>new Simulation(spec,{scene:'amsterdam',controller:'python'});
function reply(s){const modules=s.modules.snapshot(s);return {protocol_version:2,version:s.version,control_revision:s.controlRevision,time:s.time,valid_until:s.time+.05,controller:'python',rotor_commands:s.physics.drones.map(d=>[...d.forces]),accelerations:[[0,0,0],[0,0,0],[0,0,0]],goals:s.positions(),trajectories:modules.drones.map(d=>d.trajectory),modules,tactics:{reason:'Test hold',orders:[0,1,2].map(drone=>({drone,role:'Hold'}))},exit_route:[],inner_loop:{kind:'onboard_attitude',rate_hz:240,rotor_residuals:Array.from({length:3},()=>[0,0,0,0])}};}
const world=s=>JSON.stringify({time:s.time,positions:s.positions(),person:s.actor.snapshot(),samples:s.model.metrics().samples});
test('bad replies are rejected atomically before physics, actor motion or learning',()=>{
 for(const corrupt of [r=>r.accelerations[0][0]=NaN,r=>r.trajectories[1].points[5].position[0]+=2,r=>r.modules.master_frame.world_origin[2]+=1,r=>r.tactics.orders.pop(),r=>r.inner_loop.rotor_residuals[0][0]=1,r=>delete r.trajectories[0].generated_at,r=>delete r.trajectories[0].points[0].t,r=>r.modules.master_frame.trajectories[0].points[2].position[0]+=2]){
   const s=make(),r=structuredClone(reply(s)),before=world(s);corrupt(r);assert.throws(()=>s.stepExternal(r));assert.equal(world(s),before);assert.equal(s.diagnostics.rejected,1);
 }
});
test('a command issued while Python is planning invalidates the earlier reply',()=>{
 const s=make(),old=reply(s);s.command({command:'hold'});const before=world(s);assert.equal(s.stepExternal(old),false);assert.equal(world(s),before);
});
test('onboard attitude feedback responds to a perturbation within a single Python interval',()=>{
 const s=make(),r=reply(s);s.physics.drones[0].body.angularVelocity.set(1,0,0);assert.ok(s.stepExternal(r));
 assert.ok(Math.abs(s.time-.05)<1e-9);assert.equal(s.diagnostics.inner_loop_hz,240);
 assert.ok(new Set(s.physics.drones[0].motorCommand.map(v=>v.toFixed(4))).size>1);
 assert.ok(Math.abs(s.physics.drones[0].body.angularVelocity.x)<1);
});
test('person sensing requires camera FOV and cannot use an out-of-view current position',()=>{
 const s=make(),frames=[0,1,2].map(drone=>({pose:{drone,time:0,position:s.positions()[drone],direction:[0,1,-.3],up:[0,0,1],fov:80,width:256,height:144}}));
 s.observeCameras(frames);assert.deepEqual(s.visible,[false,false,false]);assert.equal(s.lastSeen,null);
 frames.forEach(f=>f.pose.direction=[0,-1,-.4]);s.observeCameras(frames);assert.ok(s.visible.some(Boolean));const seen=structuredClone(s.lastSeen);
 s.actor.position=[0,6,0];s.physics.syncPerson(s.actor);s.observeCameras(frames);assert.ok(!s.visible.some(Boolean));assert.deepEqual(s.lastSeen,seen);
});
test('sensor noise is seeded and does not consume the physics random stream',()=>{
 const a=make(),b=make();const frames=s=>[0,1,2].map(drone=>({pose:{drone,time:0,position:s.positions()[drone],direction:[1,0,-.3],up:[0,0,1],fov:80,width:256,height:144}}));
 a.observeCameras(frames(a));b.observeCameras(frames(b));assert.deepEqual(a.observedMap.snapshot(0),b.observedMap.snapshot(0));
 const state=a.rng.state;a.time=.2;const f=frames(a);f.forEach(x=>x.pose.time=.2);a.observeCameras(f);assert.equal(a.rng.state,state);
 assert.ok(a.observedMap.snapshot(.2).objects.some(o=>o.uncertainty_m>0));
});
