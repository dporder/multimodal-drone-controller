import {add,sub,scale,dot,cross,unit,norm} from './math.js';

export function cameraBasis(pose){const forward=unit(pose.direction),right=unit(cross(forward,pose.up));return {forward,right,up:cross(right,forward)};}
export const SENSOR_PROFILES={ideal:{depth_sigma:0,pose_sigma:0,dropout:0},nominal:{depth_sigma:.02,pose_sigma:.015,dropout:.05},stress:{depth_sigma:.08,pose_sigma:.06,dropout:.2}};
export function pointInCamera(point,pose,maxRange=24){const b=cameraBasis(pose),d=sub(point,pose.position),z=dot(d,b.forward),tan=Math.tan(pose.fov*Math.PI/360);return z>.05&&norm(d)<=maxRange&&Math.abs(dot(d,b.right))<=z*tan*pose.width/pose.height&&Math.abs(dot(d,b.up))<=z*tan;}

// Simulated RGB-D/semantic sensor: only first visible surface hits are returned.
// Labels are supplied by the simulator, not inferred by an RGB neural detector.
export function cameraSurfaceObservations(pose,physics,obstacles,{profile='ideal',rng=null,probes=false}={}){
  const noise=SENSOR_PROFILES[profile];
  const {forward,right,up}=cameraBasis(pose),tan=Math.tan(pose.fov*Math.PI/360),aspect=pose.width/pose.height,maxRange=24,hits=[];
  function cast(direction){
    const ray=unit(direction),hit=physics.ray(pose.position,add(pose.position,scale(ray,maxRange)));
    if(!hit)return;
    if(rng&&rng.random()<noise.dropout)return;
    let index=hit.obstacle;
    if(index===undefined)index=obstacles.findIndex(o=>o.semantic==='canal'&&[0,1].every(k=>Math.abs(hit.point[k]-o.position[k])<=o.size[k]/2));
    if(index===undefined||index<0)return;
    const o=obstacles[index],delta=sub(hit.point,pose.position);
    const depth=dot(delta,forward),measured=Math.max(.05,depth+(rng?rng.normal()*noise.depth_sigma:0)),factor=measured/Math.max(.05,depth);
    hits.push({id:`object:${index}`,semantic:o.semantic,label:o.label,
      camera_point:[dot(delta,right)*factor,dot(delta,up)*factor,measured],depth_sigma:noise.depth_sigma});
  }
  for(let y=0;y<10;y++)for(let x=0;x<16;x++)cast(add(forward,add(scale(right,((x+.5)/16*2-1)*tan*aspect),scale(up,(1-(y+.5)/10*2)*tan))));
  // Small trunks / stair treads need more than a coarse depth grid. Probe their
  // projected surfaces, still respecting FOV, range and first-hit occlusion.
  for(const o of probes?obstacles:[]){
    const heights=o.kind==='box'?[0,o.size[2]*.45]:[-o.size[1]*.35,0,o.size[1]*.35];
    for(const dz of heights){const delta=sub(add(o.position,[0,0,dz]),pose.position),z=dot(delta,forward);
      if(z>.05&&norm(delta)<=maxRange&&Math.abs(dot(delta,right))<z*tan*aspect&&Math.abs(dot(delta,up))<z*tan)cast(delta);}
  }
  const reported=structuredClone(pose);reported.position=reported.position.map(v=>v+(rng?rng.normal()*noise.pose_sigma:0));
  return {drone:pose.drone,time:pose.time,pose:reported,hits,profile,pose_sigma:noise.pose_sigma,source:'simulated depth + semantic labels'};
}

export class ObservedMap {
  constructor(origin){this.origin=Object.freeze([...origin]);this.objects=new Map();this.views=[null,null,null];this.revision=0;this.lastTimes=[-Infinity,-Infinity,-Infinity];this.trails=[[],[],[]];this.keyframes=[];this.lastKeyframe=[-Infinity,-Infinity,-Infinity];}
  ingest(observation){
    const {drone,time,pose,hits}=observation;
    if(time<=this.lastTimes[drone]||pose.time!==time||pose.drone!==drone)return false;
    this.lastTimes[drone]=time;const basis=cameraBasis(pose);
    const localPose={...pose,position:sub(pose.position,this.origin),frame:'mission_origin'};this.views[drone]=localPose;
    for(const hit of hits){
      const [x,y,z]=hit.camera_point;if(![x,y,z].every(Number.isFinite)||z<=0)continue;
      const world=add(pose.position,add(scale(basis.right,x),add(scale(basis.up,y),scale(basis.forward,z)))),position=sub(world,this.origin);
      let object=this.objects.get(hit.id);
      if(!object){object={id:hit.id,semantic:hit.semantic,label:hit.label,first_seen:time,last_seen:time,seen_by:new Set(),views:0,voxels:new Map()};this.objects.set(hit.id,object);}
      object.last_seen=time;object.seen_by.add(drone);object.views++;object.pose_sigma=observation.pose_sigma||0;
      const key=position.map(v=>Math.round(v/.3)).join(',');
      const previous=object.voxels.get(key);
      if(previous){previous.count++;const delta=sub(position,previous.mean);previous.mean=add(previous.mean,scale(delta,1/previous.count));previous.m2=add(previous.m2,delta.map((v,k)=>v*(position[k]-previous.mean[k])));}
      else if(object.voxels.size<600)object.voxels.set(key,{mean:position,count:1,m2:[0,0,0]});
    }
    if(time-this.lastKeyframe[drone]>=1-1e-6){this.lastKeyframe[drone]=time;this.keyframes.push({drone,time,pose:localPose});if(this.keyframes.length>90)this.keyframes.shift();}
    this.revision++;return true;
  }
  track(positions,time){positions.forEach((p,i)=>{const trail=this.trails[i];if(!trail.length||time-trail.at(-1).time>=.2-1e-6){trail.push({time,position:sub(p,this.origin)});if(trail.length>1500)trail.shift();}});}
  snapshot(time){
    const objects=[...this.objects.values()].map(o=>{
      const voxels=[...o.voxels.values()],points=voxels.map(v=>v.mean),lo=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));
      const spread=voxels.reduce((sum,v)=>sum+v.m2.reduce((a,b)=>a+b,0)/Math.max(1,v.count-1),0)/Math.max(1,voxels.length);
      return {id:o.id,semantic:o.semantic,label:o.label,first_seen:o.first_seen,last_seen:o.last_seen,seen_by:[...o.seen_by].sort(),sample_count:points.length,
        status:time-o.last_seen<.5?'observed':'remembered',uncertainty_m:Math.sqrt(spread+(o.pose_sigma||0)**2),points,bounds:{min:lo,max:hi},geometry:'observed surface extent; incomplete'};
    });
    return {frame:'mission_origin',world_origin:[...this.origin],revision:this.revision,time,source:'simulated depth + semantic labels',localization:'reported camera pose; profile noise; no SLAM',
      objects,views:structuredClone(this.views),keyframes:structuredClone(this.keyframes),trails:structuredClone(this.trails),point_count:objects.reduce((n,o)=>n+o.sample_count,0)};
  }
}
