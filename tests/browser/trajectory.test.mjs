import test from 'node:test';
import assert from 'node:assert/strict';
import {curveFromControls,evaluateTrajectory} from '../../swarm_lab/browser/sim/trajectory.js';
import {masterReferenceFrame} from '../../swarm_lab/browser/sim/master-frame.js';
import {master_drone} from '../../swarm_lab/browser/sim/drone-functions.js';

const curve=curveFromControls([[0,2,0],[1,3,0],[-1,4,1],[0,5,1]],()=>true);Object.assign(curve,{drone:0,generated_at:0});
const close=(a,b)=>a.forEach((x,k)=>assert.ok(Math.abs(x-b[k])<1e-7));

test('timed curve supplies positions, analytic derivatives and next 50 ms displacements',()=>{
  assert.equal(curve.points.length,21);assert.equal(curve.points.at(-1).t,1);
  const t=.37,h=1e-5,a=evaluateTrajectory(curve,t-h),b=evaluateTrajectory(curve,t),c=evaluateTrajectory(curve,t+h);
  close(c.position.map((v,k)=>(v-a.position[k])/(2*h)),b.velocity);
  close(c.velocity.map((v,k)=>(v-a.velocity[k])/(2*h)),b.acceleration);
  curve.points.slice(0,-1).forEach((p,i)=>close(p.delta_position,curve.points[i+1].position.map((v,k)=>v-p.position[k])));
});
test('rotor flight input tracks the interior of a spline even with the same endpoint',()=>{
  const run=y=>{const trajectory=curveFromControls([[0,0,3],[.4,y,3],[.7,y,3],[1,0,3]],()=>true),ref=evaluateTrajectory(trajectory,.25),o=Array(32).fill(0);o.splice(0,3,...ref.position.map((v,k)=>v-[0,0,3][k]));o.fill(12,16,28);o[15]=5;return master_drone({observation:o,trajectory}).acceleration;};
  assert.notDeepEqual(run(.4),run(-.4));
});
test('one shared master frame starts at zero and preserves slave separation and derivatives',()=>{
  const offsets=[[10,20,5],[12,24,2],[7,18,6]],curves=offsets.map((offset,drone)=>{
    const controls=curve.control_points.map(p=>p.map((v,k)=>v+offset[k]));
    return {...curveFromControls(controls,()=>true),drone,generated_at:12};
  }),before=JSON.stringify(curves),frame=masterReferenceFrame(curves,curves[0].control_points[0]);
  assert.deepEqual(frame.master_position,[0,0,0]);assert.deepEqual(frame.trajectories[0].control_points[0],[0,0,0]);
  assert.deepEqual(frame.axes,[[1,0,0],[0,1,0],[0,0,1]]);assert.equal(frame.generated_at,12);
  frame.trajectories.forEach((local,i)=>{
    close(local.control_points[0],offsets[i].map((v,k)=>v-offsets[0][k]));
    for(let t=0;t<=1;t+=.05){const a=evaluateTrajectory(local,t),b=evaluateTrajectory(curves[i],t);close(a.position.map((v,k)=>v+frame.world_origin[k]),b.position);close(a.velocity,b.velocity);close(a.acceleration,b.acceleration);}
  });
  assert.equal(JSON.stringify(curves),before);
});
test('translating the entire world and its episode origin preserves relative coordinates',()=>{
  const curves=[0,1,2].map(drone=>({...curve,drone})),a=masterReferenceFrame(curves,curves[0].control_points[0]),shift=[100,-50,9];
  const translated=curves.map(c=>({...c,control_points:c.control_points.map(p=>p.map((v,k)=>v+shift[k])),target:c.target.map((v,k)=>v+shift[k]),points:c.points.map(p=>({...p,position:p.position.map((v,k)=>v+shift[k])}))}));
  const b=masterReferenceFrame(translated,translated[0].control_points[0]);close(b.world_origin,a.world_origin.map((v,k)=>v+shift[k]));
  b.trajectories.forEach((t,i)=>t.points.forEach((p,j)=>close(p.position,a.trajectories[i].points[j].position)));
  assert.throws(()=>masterReferenceFrame(curves.slice(1)),/master and two slave/);
});

test('moving master does not move the episode origin or stationary map coordinates',()=>{
  const origin=[10,20,5],curves=[0,1,2].map(drone=>({...curve,drone}));
  const before=masterReferenceFrame(curves,origin);
  const moved=curves.map(t=>({...t,control_points:t.control_points.map(p=>p.map((v,k)=>v+(k===0?3:0))),target:t.target.map((v,k)=>v+(k===0?3:0)),points:t.points.map(p=>({...p,position:p.position.map((v,k)=>v+(k===0?3:0))}))}));
  const after=masterReferenceFrame(moved,origin);assert.deepEqual(after.world_origin,before.world_origin);assert.equal(after.master_position[0]-before.master_position[0],3);
  assert.equal(after.origin_at,'episode_start');assert.throws(()=>masterReferenceFrame(curves),/Fixed episode origin/);
});
