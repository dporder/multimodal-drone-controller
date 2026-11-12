import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ObservedMap,cameraSurfaceObservations} from '../../swarm_lab/browser/sim/observed-map.js';
import {Physics} from '../../swarm_lab/browser/sim/physics.js';
import {Random} from '../../swarm_lab/browser/sim/math.js';
import {Simulation} from '../../swarm_lab/browser/sim/simulation.js';
const spec=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/models/world.json',import.meta.url)));
const obstacles=[
 {kind:'box',semantic:'building',label:'Visible facade',position:[0,5,2],size:[6,1,4]},
 {kind:'box',semantic:'stairs',label:'Hidden stairs',position:[0,9,1],size:[1,1,2]},
 {kind:'cylinder',semantic:'tree',label:'Outside view',position:[10,2,2],size:[.3,4]},
];
const pose={drone:0,time:0,position:[0,0,2],direction:[0,1,0],up:[0,0,1],fov:60,width:128,height:72};
test('camera map observes first visible surfaces only; occluded and out-of-FOV objects stay absent',()=>{
 const physics=new Physics(obstacles,new Random(7),false),map=new ObservedMap([0,0,2]);
 assert.equal(map.snapshot(0).objects.length,0);
 const observation=cameraSurfaceObservations(pose,physics,obstacles);assert.ok(observation.hits.length);
 assert.ok(observation.hits.every(h=>h.id==='object:0'));
 map.ingest(observation);const before=map.snapshot(0);assert.equal(before.objects.length,1);
 assert.ok(before.objects[0].bounds.max[1]<=4.5+1e-6,'Must not infer hidden rear wall from a front surface');
 const later={...pose,time:1,position:[0,12,2],direction:[0,-1,0]};map.ingest(cameraSurfaceObservations(later,physics,obstacles));
 assert.ok(map.snapshot(1).objects.some(o=>o.id==='object:1'));
 assert.deepEqual(map.snapshot(1).world_origin,[0,0,2]);assert.ok(map.snapshot(1).point_count>=before.point_count);
});
test('three views fuse the same landmark without duplicating it; unseen objects are remembered',()=>{
 const map=new ObservedMap([3,4,1]);
 for(let drone=0;drone<3;drone++)map.ingest({drone,time:drone,pose:{...pose,drone,time:drone,position:[drone,0,2]},hits:[{id:'tree:1',semantic:'tree',label:'Tree',camera_point:[-drone,0,5]}]});
 const objects=map.snapshot(10).objects;assert.equal(objects.length,1);assert.equal(objects[0].sample_count,1);assert.deepEqual(objects[0].seen_by,[0,1,2]);assert.deepEqual(objects[0].points[0],[-3,1,1]);assert.equal(objects[0].status,'remembered');
 assert.equal(map.ingest({drone:2,time:1,pose:{...pose,drone:2,time:1},hits:[]}),false);
 assert.deepEqual(map.snapshot(10).objects,objects);
});
test('episode origin persists across motion, maps enrich the three-layer graph, and reset clears evidence',()=>{
 const s=new Simulation(spec,{scene:'amsterdam'}),origin=[...s.referenceOrigin];s.observeNativeCameras();assert.ok(s.observedMap.snapshot(0).objects.length);
 for(let i=0;i<60;i++)s.step();s.observeNativeCameras();assert.deepEqual(s.referenceOrigin,origin);
 const graph=s.graph(),ids=new Set(graph.nodes.map(n=>n.id));assert.ok(graph.nodes.some(n=>n.id.startsWith('observed:')));assert.ok(graph.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
 s.command({command:'reset'});assert.deepEqual(s.referenceOrigin,origin);assert.equal(s.observedMap.snapshot(0).objects.length,0);assert.equal(s.observedMap.snapshot(0).trails.flat().length,0);
});
