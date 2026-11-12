import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation} from '../../swarm_lab/browser/sim/simulation.js';
import {NeuralNetwork} from '../../swarm_lab/browser/sim/neural.js';
import {localCurve} from '../../swarm_lab/browser/sim/drone-functions.js';
import {cameraPose} from '../../swarm_lab/browser/sim/camera-pose.js';
const spec=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/models/world.json',import.meta.url)));
test('neural training learns; inference and telemetry do not mutate weights',()=>{
 const net=new NeuralNetwork(3,2,7),x=[.2,-.5,.7],target=[.3,-.2];
 for(let i=0;i<300;i++)net.train(x,target);
 assert.ok(net.predict(x).every((v,i)=>Math.abs(v-target[i])<.003));const before=net.export();net.predict(x);net.metrics();assert.deepEqual(net.export(),before);
});
test('curved local paths validate all segments and hold when no safe segment exists',()=>{
 const a=localCurve([0,0,3],[0,2,0],[2,0,3],(a,b)=>a[1]<.1&&b[1]<.1);assert.equal(a.kind,'straight');
 const b=localCurve([0,0,3],[0,0,0],[2,0,3],()=>false);assert.equal(b.kind,'hold');assert.ok(b.points.every(p=>p.position[0]===0));assert.equal(b.validated,false);
});
test('three module trajectories update at exact 50 ms physics intervals',()=>{
 const s=new Simulation(spec,{scene:'amsterdam'});for(let i=0;i<90;i++)s.step();
 const m=s.snapshot().drone_modules;assert.equal(m.drones.length,3);assert.equal(m.rotor_networks.length,3);assert.equal(m.sequence,61);
 m.tick_times.slice(1).forEach((t,i)=>assert.ok(Math.abs(t-m.tick_times[i]-.05)<1e-9));
 assert.equal(m.drones.flatMap(d=>d.rotors).length,12);assert.ok(m.drones.every(d=>d.trajectory.points.length===21));
});
test('onboard cameras are attached to separate drone poses and never use hidden person position',()=>{
 const s=new Simulation(spec,{scene:'amsterdam'}).snapshot(),poses=[0,1,2].map(i=>cameraPose(s,i));
 assert.equal(new Set(poses.map(p=>p.position.join(','))).size,3);s.person.position=[99,99,99];assert.deepEqual(cameraPose(s,0),poses[0]);
});
