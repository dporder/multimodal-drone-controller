import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation} from '../../swarm_lab/browser/sim/simulation.js';
import {Physics,C,arr} from '../../swarm_lab/browser/sim/physics.js';
import {Person} from '../../swarm_lab/browser/sim/person.js';
import {Navigator} from '../../swarm_lab/browser/sim/navigation.js';
import {Random,distance,norm} from '../../swarm_lab/browser/sim/math.js';

const spec=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/models/world.json',import.meta.url)));
const actorSpec=spec.object_types.find(t=>t.id==='person');
const run=(s,seconds)=>{for(let i=0;i<seconds*30&&!s.finished;i++)s.step();return s.snapshot({predictions:false});};
const sim=(extra={})=>new Simulation(spec,{wind:0,randomize:false,sensor_noise:0,...extra});

test('configuration and every reset enforce exactly three aircraft',()=>{
  assert.throws(()=>sim({drones:4}),/three/);const s=sim();
  for(const c of [{command:'reset',drones:2},{command:'reset',seed:-1},{command:'reset',wind:NaN},{command:'goal',position:[0,NaN,3]},{command:'actor',action:'input',value:[Infinity,0]},{command:'guidance',compliance:2}])assert.throws(()=>s.command(c));
  assert.equal(s.physics.drones.length,3);assert.equal(s.config.drones,3);
});

test('Cannon integrates analytic free fall and resolves floor contact',()=>{
  const p=new Physics([],new Random(1),false),b=p.drones[0].body;
  b.position.set(0,0,5);for(let i=0;i<120;i++)p.world.step(1/240);
  assert.ok(Math.abs(b.velocity.z+9.81*.5)<1e-8);
  assert.ok(Math.abs(b.position.z-(5-.5*9.81*.5**2))<.011);
  for(let i=0;i<300;i++)p.world.step(1/240);
  assert.ok(p.drones[0].hit);assert.ok(b.position.z>=.07);assert.ok(b.position.z<.2);
});

test('hover uses force integration, unit attitude, motor lag and individual rotor moments',()=>{
  const p=new Physics([],new Random(1),false),d=p.drones[0];
  for(let i=0;i<240;i++)p.step([[0,0,0],[0,0,0],[0,0,0]],[0,0,0]);
  assert.ok(Math.abs(d.body.position.z-3.2)<.002);
  assert.ok(Math.abs(norm(d.body.quaternion.toArray())-1)<1e-12);
  const before=d.motorSpeed[0];p.motors(d,[0,0,4],1/240);const target=Math.sqrt(1.2*13.81/4/(.85+.15*d.battery)**2/1.1e-5);
  assert.ok(Math.abs(d.motorSpeed[0]-(before+(target-before)*(1-Math.exp(-(1/240)/.035))))<.01);
  d.forces=[4,0,0,0];d.body.force.setZero();d.body.torque.setZero();p.applyRotors(d);
  assert.ok(d.body.torque.x>.7);assert.ok(d.body.torque.y<-.7);assert.ok(d.body.torque.z>.07);
});

test('A* routes and every smoothed segment clear inflated obstacles',()=>{
  const obstacle={kind:'box',position:[0,0,1],size:[2,6,2]},n=new Navigator([obstacle]);const route=n.path([-5,0],[5,0]);
  assert.ok(route.length>1);let prev=[-5,0];for(const p of route){assert.ok(n.segmentClear(prev,p));prev=p;}
  assert.deepEqual(n.path([-5,0],[0,0]),[]);assert.ok(n.clear(n.nearestClear([0,0])));
  const low=new Navigator([{kind:'box',position:[0,0,.2],size:[2,2,.4]}],.42,.9,.9);assert.equal(low.clear([0,0]),false);
});

test('manual walk/run, stop, crouch and ballistic jump are independent actor motion',()=>{
  const p=new Person([],actorSpec),rng=new Random(2);p.command('manual');p.command('input',[1,0]);
  for(let i=0;i<60;i++)p.step(1/30,i/30,rng);const walkSpeed=p.velocity[0];assert.ok(Math.abs(walkSpeed-1.15)<.01);
  p.command('run');for(let i=0;i<60;i++)p.step(1/30,2+i/30,rng);assert.ok(p.velocity[0]>walkSpeed*2);
  p.command('input',[0,0]);for(let i=0;i<60;i++)p.step(1/30,4+i/30,rng);assert.equal(p.velocity[0],0);
  p.command('crouch');assert.equal(p.height,1.1);p.command('jump');let apex=0;
  for(let i=0;i<40;i++){p.step(1/30,6+i/30,rng);apex=Math.max(apex,p.position[2]);}assert.ok(apex>.35&&apex<.5);assert.equal(p.position[2],0);
});

test('cover and low-table climbing have physical support and reachable preconditions',()=>{
  const s=sim({scene:'office'});s.command({command:'actor',action:'hide'});run(s,20);assert.equal(s.actor.status,'at cover');assert.equal(s.actor.posture,'crouching');
  s.command({command:'person',position:[-4.3,3,0]});s.command({command:'actor',action:'climb'});run(s,6);
  assert.equal(s.actor.status,'standing on surface');assert.equal(s.actor.position[2],.85);assert.equal(s.actor.support,'Coffee table');
  s.command({command:'actor',action:'input',value:[1,0]});run(s,8);assert.equal(s.actor.position[2],0);
  assert.throws(()=>s.command({command:'actor',action:'climb'}),/within 1 m/);
});

test('manual override cancels the scheduled offer and stop input brakes motion',()=>{
  const s=sim();s.command({command:'actor',action:'manual'});s.command({command:'actor',action:'input',value:[1,0]});run(s,6);
  assert.equal(s.actor.mode,'manual');assert.equal(s.actor.guidance,false);assert.ok(s.actor.position[0]>5);
  s.command({command:'actor',action:'input',value:[0,0]});run(s,1);assert.equal(s.actor.velocity[0],0);
});

test('acceptance is voluntary and refusal leaves actor independent while drones hold',()=>{
  const s=sim();s.command({command:'guidance',compliance:0});run(s,1);const goals=structuredClone(s.goals);assert.equal(s.mode,'hold');assert.equal(s.actor.refused,true);assert.equal(s.actor.intention,'inspect site');
  run(s,4);assert.deepEqual(s.goals,goals);assert.ok(s.actor.position[0]>4);
  s.command({command:'guidance',compliance:1});const out=run(s,20);assert.equal(out.person.status,'at destination');assert.equal(out.metrics.collisions,0);
  const p=new Person([],actorSpec),q=new Person([],actorSpec);p.requestGuidance(0,.5);q.requestGuidance(0,.5);const a=new Random(44),b=new Random(44);for(let i=0;i<60;i++){p.step(1/30,i/30,a);q.step(1/30,i/30,b);}assert.deepEqual(p.snapshot(),q.snapshot());
});

test('solid box and trunk rays occlude, and hidden observations retain their timestamp',()=>{
  const p=new Physics([{kind:'box',position:[0,0,1.5],size:[1,4,3]}],new Random(1),false);const actor=new Person([],actorSpec);actor.position=[2,0,0];p.syncPerson(actor);
  assert.equal(p.ray([-2,0,1],[2,0,1],true).person,false);
  const trunk=new Physics([{kind:'cylinder',position:[0,0,2],size:[.6,4]}],new Random(1),false);assert.ok(trunk.ray([-2,0,3],[2,0,3]));assert.equal(trunk.ray([-2,1,3],[2,1,3]),null);
  const s=sim();const before=structuredClone(s.lastSeen);s.actor.position=[24,24,0];s.physics.syncPerson(s.actor);s.time=3;s.observe();assert.deepEqual(s.visible,[false,false,false]);assert.deepEqual(s.lastSeen,before);
  s.actor.intention='leave via destination';s.mission();const goals=structuredClone(s.goals);s.actor.position=[25,26,0];s.mission();assert.deepEqual(s.goals,goals);
  const graph=s.graph();assert.equal(graph.edges.filter(e=>e.relation==='OBSERVES').length,0);assert.ok(graph.edges.some(e=>e.relation==='LAST_OBSERVED'));
});

test('contact terminates the episode without automatic reset; explicit play restarts',()=>{
  const s=sim();s.physics.drones[0].body.position.z=.03;s.step();assert.equal(s.reason,'contact');assert.equal(s.running,false);const time=s.time;assert.equal(s.step(),false);assert.equal(s.time,time);s.command({command:'play'});assert.equal(s.version,2);assert.equal(s.time,0);assert.equal(s.running,true);
});

test('pause/single-step, speed, destination and waypoint commands preserve runtime state',()=>{
  const s=sim();s.command({command:'pause'});assert.equal(s.running,false);s.command({command:'step'});assert.ok(Math.abs(s.time-1/30)<1e-10);assert.equal(s.running,false);s.command({command:'speed',value:2});assert.equal(s.speed,2);
  s.command({command:'destination',position:[10,2,0]});assert.deepEqual(s.actor.destination,[10,2,0]);s.command({command:'goal',position:[0,-2,4]});run(s,8);assert.ok(s.positions().every(p=>Math.abs(p[2]-4)<.1));assert.ok(s.interventions.length>=5);
  assert.throws(()=>s.command({command:'destination',position:[0,-11,0]}),/clear ground/);
});

test('three-layer graph keeps three aircraft, twelve rotors and valid typed edges',()=>{
  const s=sim({scene:'office'}),g=s.graph(),ids=new Set(g.nodes.map(n=>n.id));assert.equal(g.nodes.filter(n=>n.kind==='layer').length,3);assert.equal(g.nodes.filter(n=>/^drone:\d$/.test(n.id)).length,3);assert.equal(g.nodes.filter(n=>n.kind==='actuator').length,12);assert.ok(g.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));assert.equal(g.runtime.engine,'Cannon ES 0.20.0');assert.ok(g.nodes.some(n=>n.id==='door:1'));
});

test('same seed reproduces physics despite snapshot/graph reads; different seeds diverge',()=>{
  const a=sim({wind:2,randomize:true,seed:11}),b=sim({wind:2,randomize:true,seed:11}),c=sim({wind:2,randomize:true,seed:12});
  for(let i=0;i<300;i++){a.step();a.snapshot();if(i%30===0)a.graph();b.step();c.step();}
  assert.deepEqual(a.snapshot(),b.snapshot());assert.notDeepEqual(a.positions(),c.positions());assert.ok(a.radioDrops>0);
  assert.equal(a.model.metrics().ready,true);assert.ok(Number.isFinite(a.model.metrics().velocity_rmse));const forecast=a.snapshot().predictions;assert.equal(forecast.length,16);assert.ok(forecast.flat(2).every(Number.isFinite));
});

for(const scene of ['yard','warehouse','forest','office'])test(`${scene}: 60-second voluntary guidance episode without contact`,()=>{
  const s=new Simulation(spec,{scene,seed:7,wind:2});s.command({command:'guidance',compliance:1});const out=run(s,60);
  assert.equal(out.reason,'flying');assert.equal(out.metrics.collisions,0);assert.equal(out.person.status,'at destination');assert.equal(out.drones.length,3);assert.ok(out.metrics.min_separation>1);assert.ok(out.drones.every(d=>norm(d.quaternion)>.99999));
});

for(const scene of ['forest','office'])test(`${scene}: delayed default guidance respects obstacles and ceiling`,()=>{
  const s=new Simulation(spec,{scene,seed:7,wind:2});const out=run(s,30);
  assert.equal(out.reason,'flying');assert.equal(out.metrics.collisions,0);assert.equal(out.person.status,'at destination');
});
