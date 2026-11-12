import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation} from '../../swarm_lab/browser/sim/simulation.js';
import {Navigator} from '../../swarm_lab/browser/sim/navigation.js';
const spec=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/models/world.json',import.meta.url)));
const make=()=>new Simulation(spec,{scene:'amsterdam',seed:7});
const run=(s,seconds)=>{for(let i=0;i<seconds*30&&!s.finished;i++)s.step();};

test('canals block walking; bridges cross water; narrow alleys exclude aircraft',()=>{
  const s=make(),walk=new Navigator(s.obstacles,.42,.9,.9,true),air=s.airNav;
  assert.equal(walk.clear([12,0]),false);assert.equal(walk.clear([12,10]),true);assert.equal(air.clear([12,0]),true);
  assert.equal(walk.clear([-6,1.8]),true);assert.equal(air.clear([-6,1.8]),false);
  assert.ok(walk.path([0,1.8],[-9.7,1.8]).length);assert.equal(air.segmentClear([0,1.8],[-9.7,1.8]),false);assert.ok(air.path([0,1.8],[-10.5,1.8]).length>1);
  const graph=s.graph(),ids=new Set(graph.nodes.map(n=>n.id));assert.ok(graph.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
});

test('drawn path validation is atomic and respects route priorities',()=>{
  const s=make(),before=s.actor.snapshot();
  assert.throws(()=>s.command({command:'actor_path',points:[[0,0],[12,0]],endAction:'hide'}),/canals/);assert.deepEqual(s.actor.snapshot(),before);
  s.command({command:'actor_path',points:[[0,-5],[0,-3],[0,-1]],pace:'run',endAction:'hide'});
  assert.equal(s.actor.routePriority,true);assert.equal(s.actor.drawnPath.length,2);run(s,10);
  assert.equal(s.actor.status,'hiding at path endpoint');assert.equal(s.actor.posture,'crouching');assert.equal(s.actor.refused,false);
  assert.ok(s.actor.position[1]>-1.1);assert.equal(s.actor.guidance,false);assert.equal(s.physics.drones.length,3);
});

test('lost sight triggers leader ascent and split search without hidden-position tracking',()=>{
  const s=make();s.command({command:'actor_path',points:[[0,-4.4],[-5,-4.4],[-9.7,-4.4],[-9.7,1.8],[-9.7,3.1]],pace:'run',endAction:'hide',compliance:1});
  for(let i=0;i<900&&!s.finished&&s.tactics?.state!=='search_cover';i++)s.step();
  assert.equal(s.reason,'flying');assert.equal(s.tactics.state,'search_cover');assert.ok(s.lastSeen.time<s.time);
  assert.ok(s.tactics.leader_altitude>=8.2);assert.ok(s.tactics.active.includes('split'));assert.equal(s.tactics.orders.length,3);
  assert.ok(Math.hypot(...s.routes[1].at(-1).map((v,i)=>v-s.routes[2].at(-1)[i]))>2.4);assert.ok(Math.abs(s.goals[1][2]-s.goals[2][2])>1.3);
  s.replanAt=0;s.mission();const seen=structuredClone(s.lastSeen),route=structuredClone(s.exitRoute),orders=structuredClone(s.tactics.orders),truth=[...s.actor.position];
  s.actor.position=[0,0,0];s.replanAt=0;s.mission();assert.deepEqual(s.exitRoute,route);assert.deepEqual(s.lastSeen,seen);assert.deepEqual(s.tactics.orders,orders);s.actor.position=truth;
  assert.ok(s.exitRoute.length);assert.deepEqual(s.exitRoute.at(-1),s.actor.destination.slice(0,2));
});

test('stairs raise the actor 1.2 m; a hide endpoint keeps the terrace position',()=>{
  const s=make();s.command({command:'actor_path',points:[[0,0],[-1.85,3.7],[-1.85,6.75]],pace:'walk',endAction:'hide',compliance:0});run(s,25);
  assert.equal(s.reason,'flying');assert.equal(s.actor.intention,'hide at endpoint');assert.ok(Math.abs(s.actor.position[2]-1.2)<1e-6);assert.equal(s.actor.support,'stairs / terrace');
  assert.equal(s.physics.person.position.z,s.actor.position[2]);
});

test('drawing after arrival moves again; endpoint jump and climb are actual actions',()=>{
  const s=make();s.command({command:'actor_path',points:[[0,-6]],endAction:'hide'});run(s,3);assert.equal(s.actor.posture,'crouching');
  s.command({command:'actor_path',points:[[0,-4]],endAction:'jump'});let apex=0;for(let i=0;i<150&&!s.finished;i++){s.step();apex=Math.max(apex,s.actor.position[2]);}assert.ok(apex>.35);assert.equal(s.actor.posture,'standing');
  s.command({command:'person',position:[1.9,5.8,0]});s.command({command:'actor_path',points:[[1.9,6]],endAction:'climb'});run(s,6);
  assert.equal(s.actor.status,'standing on surface');assert.ok(Math.abs(s.actor.position[2]-.9)<1e-6);assert.match(s.actor.support,/crate/);
});

test('city independently patrols until given a route, without an immediate exit reset',()=>{
  const s=make();run(s,40);assert.equal(s.actor.intention,'inspect site');assert.ok(s.actor.events.length>=2);assert.equal(s.actor.guidance,false);assert.equal(s.finished,false);
});

test('early autonomous offers honor the response preference and never force a route',()=>{
  for(const probability of [0,1]){
    const s=make();s.command({command:'actor_path',points:[[0,-4],[0,0],[0,3]],endAction:'hide',allowGuidance:true,compliance:probability});run(s,4);
    assert.equal(s.actor.refused,probability===0);
    assert.equal(s.actor.intention,probability?'leave via destination':'follow drawn route');
    if(!probability)assert.equal(s.mode,'guidance');
  }
});

test('H uses the next drawn target, keeps that waypoint, and leaves bridge guidance active',()=>{
  const s=make();s.command({command:'actor_path',points:[[0,3],[-9.7,1.8]],pace:'run',compliance:0});
  const target=[...s.actor.route[0]];s.command({command:'actor',action:'hide'});
  assert.deepEqual(s.actor.hideTarget.reference,target);assert.deepEqual(s.actor.route[0],target);
  assert.ok(s.actor.hideTarget.position[1]>0);assert.equal(s.mode,'guidance');assert.equal(s.pathOfferPending,false);
  assert.deepEqual(s.actor.destination,[12.15,-10,.05]);run(s,40);
  assert.equal(s.reason,'flying');assert.equal(s.actor.intention,'seek cover');assert.equal(s.actor.posture,'crouching');assert.equal(s.mode,'guidance');assert.ok(s.exitRoute.length);assert.equal(s.actor.refused,true);
});

test('leader and two wings reacquire, offer, and physically escort to the bridge',()=>{
  const s=make(),initial=s.positions(),states=new Set();let peakAltitude=0,fast=false,hidden=false;
  s.command({command:'actor_path',points:[[0,-4.4],[-5,-4.4],[-9.7,-4.4],[-9.7,1.8],[-9.7,3.1]],pace:'run',endAction:'hide',compliance:1});
  for(let i=0;i<2400&&!s.finished;i++){
    s.step();states.add(s.tactics.state);peakAltitude=Math.max(peakAltitude,s.positions()[0][2]);fast ||= s.tactics.orders.some(o=>o.speed_limit===3);hidden ||= !s.visible.some(Boolean);
  }
  assert.equal(s.reason,'flying');assert.equal(s.actor.status,'at destination');assert.equal(s.actor.posture,'standing');
  assert.ok(hidden&&states.has('search_cover')&&states.has('reacquired')&&states.has('escort')&&states.has('bridge_reached'));
  assert.ok(peakAltitude>7.8);assert.ok(fast);
  s.positions().forEach((p,i)=>{assert.ok(Math.hypot(p[0]-initial[i][0],p[1]-initial[i][1])>5);assert.ok(Math.hypot(p[0]-s.actor.destination[0],p[1]-s.actor.destination[1])<9);});
  const g=s.graph(),ids=new Set(g.nodes.map(n=>n.id));assert.ok(g.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
  assert.equal(g.nodes.filter(n=>n.kind==='decision').length,19);assert.equal(g.nodes.filter(n=>n.kind==='order').length,3);assert.equal(g.edges.filter(e=>e.relation==='COORDINATES').length,2);
});

test('a trunk occluding the last sighting orders leader ascent and two blind-spot searches',()=>{
  const s=make();s.physics.drones[0].body.position.set(8.1,-13.5,3.8);
  s.lastSeen={position:[8.1,-10.7,0],velocity:[0,0,0],height:1.1,time:0};s.time=1;s.visible=[false,false,false];s.replanAt=0;s.mission();
  assert.equal(s.tactics.cover.kind,'tree');assert.equal(s.tactics.state,'search_cover');
  assert.ok(s.goals[0][2]>s.tactics.cover.top+1);assert.equal(s.tactics.orders[0].action,'Ascend and scan');
  assert.match(s.tactics.orders[1].role,/Left wing/);assert.match(s.tactics.orders[2].role,/Right wing/);
});
