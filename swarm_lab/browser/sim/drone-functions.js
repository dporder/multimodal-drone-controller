import {NeuralNetwork} from './neural.js';
import {curveFromControls,evaluateTrajectory} from './trajectory.js';
import {Navigator} from './navigation.js';
import {masterReferenceFrame} from './master-frame.js';
import {add,sub,scale,norm,unit,dot,clamp} from './math.js';

export function localCurve(position,velocity,target,clear,horizon=1){
  const delta=sub(target,position),span=norm(delta),tangent=scale(velocity,Math.min(horizon/3,span/Math.max(norm(velocity),.01)/3));
  return curveFromControls([position,add(position,tangent),sub(target,scale(unit(delta),span/3)),target],clear,horizon);
}

export function neuralnetwork_tactics_from_master(network,contexts,clear){
  if(contexts.length!==3)throw Error('Exactly three drone contexts required');
  const input=contexts.flatMap(c=>[...sub(c.goal,c.position).map(x=>x/10),...c.velocity.map(x=>x/4),c.speed/3,c.seenAge/10]);
  const controls=contexts.map(c=>{
    const delta=sub(c.goal,c.position),desired=scale(unit(delta),Math.min(.82*norm(delta),c.speed));desired[2]=clamp(.82*delta[2],-1.5,1.5);
    const change=sub(desired,c.velocity),v1=add(c.velocity,scale(unit(change),Math.min(norm(change),2.5))),end=add(c.position,scale(add(c.velocity,v1),.5));
    return [c.position,add(c.position,scale(c.velocity,1/3)),sub(end,scale(v1,1/3)),end];
  });
  const teacher=controls.flatMap((cp,i)=>cp.slice(1).flatMap(p=>sub(p,contexts[i].position).map(x=>x/4))),prediction=network.predict(input),ready=network.samples>=100&&network.mae<.06;
  network.train(input,teacher);
  return contexts.map((c,i)=>{
    let cp=controls[i],accepted=false;
    if(ready){
      const proposed=cp.map((p,j)=>j<2?[...p]:p.map((v,k)=>v+clamp((prediction[i*9+(j-1)*3+k]*4-(v-c.position[k]))*.15,-.04,.04)));
      const candidate=curveFromControls(proposed,(a,b)=>clear(a,b,i));
      if(candidate.kind==='cubic'&&candidate.points.every(p=>norm(p.velocity)<=Math.max(c.speed,norm(c.velocity))+.4&&norm(p.acceleration)<=4)){cp=proposed;accepted=true;}
    }
    return {...curveFromControls(cp,(a,b)=>clear(a,b,i)),drone:i,neural_applied:accepted};
  });
}

const RAYS=Array.from({length:12},(_,i)=>[Math.cos(i*Math.PI/6),Math.sin(i*Math.PI/6),0]);
function drone(i,{observation:o,speed=2,trajectory=null,trajectoryTime=.25}){
  if(o.length!==32||!o.every(Number.isFinite))throw Error('Expected a finite 32-value drone observation');
  const error=o.slice(0,2),desired=scale(unit(error),Math.min(speed,.82*norm(error)));
  const reference=trajectory?evaluateTrajectory(trajectory,trajectoryTime):null;
  const acc=reference?reference.acceleration.map((v,k)=>v+.8*(o[k]-o[k+3]*reference.t)+2.2*(reference.velocity[k]-o[k+3])):[2.2*(desired[0]-o[3]),2.2*(desired[1]-o[4]),1.8*o[2]-2.2*o[5]];
  for(let r=0;r<12;r++){const range=o[16+r],closing=dot(o.slice(3,6),RAYS[r]);const repulsion=1.8*Math.max(0,1/Math.max(range-.25,.15)-1/2.5),braking=3*Math.max(0,closing-Math.sqrt(2*2.5*Math.max(0,range-.75)));for(let k=0;k<3;k++)acc[k]-=(repulsion+braking)*RAYS[r][k];}
  for(let k=0;k<3;k++)acc[k]-=2*o[12+k]/Math.max(o[15],.15)*Math.max(0,1.8-o[15]);
  return {id:i,acceleration:acc.map(x=>clamp(x,-4,4)),reference};
}
export const master_drone=c=>drone(0,c);
export const slave1_drone=c=>drone(1,c);
export const slave2_drone=c=>drone(2,c);

export class DroneModules {
  constructor(seed){this.masterNetwork=new NeuralNetwork(24,27,seed^991,24);this.sequence=0;this.time=0;this.trajectories=[];this.tickTimes=[];}
  tick(s){
    const positions=s.positions();
    this.recoveryNav??=new Navigator(s.obstacles,.55,3.8,.35);
    const contexts=positions.map((position,i)=>({position,velocity:s.physics.drones[i].body.velocity.toArray(),goal:s.goals[i],speed:s.droneSpeedLimits[i],seenAge:s.lastSeen?s.physics.world.time-s.lastSeen.time:10}));
    const clear=(a,b)=>{
      // Use the conservative street envelope as well as actual 3D rays.
      if(s.continuousGuidance&&!(s.airNav.clear(a)?s.airNav:this.recoveryNav).segmentClear(a,b))return false;
      return !s.physics.ray(a,b)&&b[2]>=1.5&&b[2]<=10.8;
    };
    this.trajectories=neuralnetwork_tactics_from_master(this.masterNetwork,contexts,clear).map((t,i)=>{
      if(t.kind==='hold'){
        // A blocked horizontal route still needs altitude regulation. Repeatedly
        // anchoring a hold at the measured Z lets mass error accumulate as drift.
        const c=contexts[i],p=c.position,v0=c.velocity[2],v1=clamp(.82*(c.goal[2]-p[2]),-1.5,1.5),end=p[2]+(v0+v1)/2;
        const controls=[p,[p[0],p[1],p[2]+v0/3],[p[0],p[1],end-v1/3],[p[0],p[1],end]];
        const verticalClear=(a,b)=>b[2]>=1.5&&b[2]<=10.8&&[[0,0,0],[.35,0,0],[-.35,0,0],[0,.35,0],[0,-.35,0]].every(offset=>!s.physics.ray(add(a,offset),add(b,offset)));
        t={...curveFromControls(controls,verticalClear),drone:i,neural_applied:false};
      }
      return {...t,generated_at:s.physics.world.time};
    });
    this.sequence++;this.time=s.physics.world.time;this.tickTimes.push(this.time);if(this.tickTimes.length>21)this.tickTimes.shift();
  }
  snapshot(s){
    const positions=s.positions(),reported=s.radio,master=positions[0],body=s.physics.drones[0].body;
    const drones=s.physics.drones.map((d,i)=>({id:i,name:['master_drone','slave1_drone','slave2_drone'][i],position:positions[i],velocity:d.body.velocity.toArray(),trajectory:this.trajectories[i]||null,rotors:[...d.forces],command:[...(d.motorCommand||d.forces)]}));
    return {sequence:this.sequence,time:this.time,period_ms:50,tick_times:[...this.tickTimes],horizon_seconds:1,master_absolute:[...master],master_frame:masterReferenceFrame(this.trajectories,s.referenceOrigin),
      slaves_relative:[1,2].map(i=>({drone:i,frame:'world axes relative to master',position:sub(reported[i],master),body_frame:body.vectorToLocalFrame(body.position.clone().set(...sub(reported[i],master))).toArray(),source:'delayed radio',age:Math.max(0,s.time-(s.radioTimes?.[i]??s.time))})),
      drones,tactics_network:this.masterNetwork.metrics(),rotor_networks:s.physics.drones.map(d=>({...d.rotorNetwork.metrics(),blend:d.neuralBlend||0,predicted_command:d.neuralPrediction||null})),controller:'online imitation with bounded contributions; geometric fallback'};
  }
}
