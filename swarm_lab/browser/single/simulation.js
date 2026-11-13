import * as C from '../vendor/cannon-es.js';
import {Random,add,sub,scale,unit,norm,dot,cross,clamp,distance,vector} from '../sim/math.js';
import {AIRFRAMES,DEFAULTS,TARGETS,OBSTACLES,hardwareBudget,parseInstruction} from './config.js';
import {FlightPolicy,validateAction} from './policy.js';
const V=a=>new C.Vec3(...a),A=v=>[v.x,v.y,v.z],DT=1/240,wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
const rotate=(v,q)=>A(q.vmult(V(v)));

export class SingleSimulation {
 constructor(weights,config={}){this.weights=weights;this.config={...DEFAULTS,...config};this.episode=0;this.reset();}
 reset(config={}){
  const next={...this.config,...config};if(!['front','underslung'].includes(next.mount))throw Error('Invalid camera mount');
  for(const [key,lo,hi]of [['wind',0,5],['inference_ms',0,1500],['camera_pitch',-90,45],['camera_yaw',-180,180],['fov',30,110]])if(!Number.isFinite(next[key])||next[key]<lo||next[key]>hi)throw Error(`Invalid ${key}`);
  const budget=hardwareBudget(next);this.config=next;this.budget=budget;this.air=AIRFRAMES[next.airframe];this.episode++;this.missionId=0;this.time=0;this.decisionAt=0;this.running=true;this.stepCount=0;this.state='ready';this.status='Choose an object and a task. The drone is holding position.';this.selected=null;this.task=null;this.completedContactId=null;this.contacts=[];this.events=[];this.observed={};this.path=[];this.trail=[];this.action=[0,0,0];this.actionUntil=0;this.pending=null;this.policyTime=0;this.policy=new FlightPolicy(this.weights);this.policySequence=0;this.externalRequest=null;this.policyMode='local';this.policyError=null;this.manual=[0,0,0,0];this.manualMode=false;this.reference=null;this.telemetry={rejected:0,actions:0,collisions:0,contact_speed:null,estimated_impact_ns:null,inspected_frames:0};this.energyWh=0;this.charge=1;this.seenTime=-Infinity;this.dwell=0;this.stale=false;this.searchIndex=0;this.integral=[0,0,0];this.desiredYaw=Math.PI/2;this.attitudeYaw=this.desiredYaw;this.lastSensorTime=-Infinity;this.lastRouteTime=-Infinity;this.holdPoint=[0,-6,2.4];this.selectedMode='find';this.abortReason=null;
  this.sceneObjects=[...OBSTACLES.map(o=>({...o,type:'obstacle'})),...TARGETS.map(o=>({...o,type:'target'}))];
  this.world=new C.World({gravity:new C.Vec3(0,0,-9.81),allowSleep:false});this.world.broadphase=new C.SAPBroadphase(this.world);this.world.solver.iterations=20;this.world.defaultContactMaterial.friction=.6;this.world.defaultContactMaterial.restitution=0;
  const ground=new C.Body({mass:0,collisionFilterGroup:1});ground.addShape(new C.Plane());ground.objectId='ground';this.world.addBody(ground);
  this.staticBodies=this.sceneObjects.map(o=>{const b=new C.Body({mass:0,position:V(o.position),collisionFilterGroup:1});b.addShape(new C.Box(V(o.size.map(x=>x/2))));b.objectId=o.id;b.objectType=o.type;this.world.addBody(b);return b;});
  this.body=new C.Body({mass:budget.mass_kg,position:V(this.holdPoint),linearDamping:0,angularDamping:0,collisionFilterGroup:2});this.body.quaternion.setFromEuler(0,0,this.desiredYaw);
  this.body.addShape(new C.Box(new C.Vec3(.19,.15,.09)));const arm=this.air.arm;this.rotors=[[arm,arm,0],[-arm,arm,0],[-arm,-arm,0],[arm,-arm,0]];this.spins=[1,-1,1,-1];
  this.rotors.forEach(p=>this.body.addShape(new C.Sphere(this.air.rotor_radius),V(p)));
  this.probe=new C.Sphere(.065);this.body.addShape(this.probe,new C.Vec3(.85,0,0));
  const ratio=budget.mass_kg/3.2;this.body.inertia.copy(V(this.air.inertia.map(x=>x*ratio)));this.body.invInertia.set(1/this.body.inertia.x,1/this.body.inertia.y,1/this.body.inertia.z);this.body.updateInertiaWorld(true);this.world.addBody(this.body);
  this.body.addEventListener('collide',event=>this.onContact(event));this.commands=Array(4).fill(budget.mass_kg*9.81/4);this.thrust=[...this.commands];this.motorSpeed=this.thrust.map(f=>Math.sqrt(f/1.1e-5));this.ranges=Array(16).fill(12);this.acceleration=[0,0,0];this.gust=[0,0,0];this.rng=new Random(next.seed);this.report('ready','One drone · four independently driven rotors.');
 }
 report(type,message){this.events.push({time:this.time,type,message});if(this.events.length>50)this.events.shift();}
 position(){return A(this.body.position);}
 velocity(){return A(this.body.velocity);}
 yaw(){const f=rotate([1,0,0],this.body.quaternion);return Math.atan2(f[1],f[0]);}
 cameraPose(){
  const offset=this.config.mount==='underslung'?[.05,0,-.25]:[.37,0,-.035],pitch=this.config.camera_pitch*Math.PI/180,yaw=this.config.camera_yaw*Math.PI/180;
  const direction=rotate([Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch)],this.body.quaternion);
  const up=rotate([-Math.cos(yaw)*Math.sin(pitch),-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch)],this.body.quaternion);
  return {position:add(this.position(),rotate(offset,this.body.quaternion)),direction,up,fov:this.config.fov,width:480,height:270,time:this.time,frame:'world',mount:this.config.mount};
 }
 ray(from,to){const r=new C.RaycastResult();this.world.raycastClosest(V(from),V(to),{collisionFilterMask:1,skipBackfaces:true},r);return r.hasHit?{id:r.body.objectId,point:A(r.hitPointWorld),distance:r.distance}:null;}
 inView(point,pose){const d=sub(point,pose.position),z=dot(d,pose.direction),right=unit(cross(pose.direction,pose.up)),up=cross(right,pose.direction),tan=Math.tan(pose.fov*Math.PI/360);return z>.08&&norm(d)<16&&Math.abs(dot(d,right))<z*tan*16/9&&Math.abs(dot(d,up))<z*tan;}
 sense(){
  const pose=this.cameraPose();this.visible=[];
  for(const object of this.sceneObjects){
   const center=object.position,points=[center,...[0,1,2].flatMap(k=>[-1,1].map(sign=>center.map((v,j)=>v+(j===k?object.size[k]*.45*sign:0))))];
   const hit=points.find(p=>this.inView(p,pose)&&this.ray(pose.position,p)?.id===object.id);
   if(hit){this.observed[object.id]={id:object.id,name:object.name,type:object.type,position:[...center],size:[...object.size],last_seen:this.time,source:'simulated RGB-D semantics',confidence:.98};this.visible.push(object.id);}
  }
  this.ranges=this.ranges.map((_,i)=>{const a=i*Math.PI/8,end=add(this.position(),[12*Math.cos(a),12*Math.sin(a),0]);return this.ray(this.position(),end)?.distance??12;});this.lastSensorTime=this.time;
 }
 setCamera(settings){const c={...this.config,...settings};if(!['front','underslung'].includes(c.mount)||!Number.isFinite(c.camera_pitch)||c.camera_pitch< -90||c.camera_pitch>45||!Number.isFinite(c.camera_yaw)||Math.abs(c.camera_yaw)>180||!Number.isFinite(c.fov)||c.fov<30||c.fov>110)throw Error('Invalid camera configuration');for(const k of ['mount','camera_pitch','camera_yaw','fov'])if(k in settings)this.config[k]=settings[k];this.sense();}
 select(id,reference=null){if(!TARGETS.some(o=>o.id===id))throw Error('Select a task object.');this.selected=id;this.reference=reference;this.report('selection',`Visual cue selected: ${TARGETS.find(o=>o.id===id).name}.`);}
 start(instruction,modeOverride=null){
  const task=parseInstruction(instruction,this.selected);if(modeOverride)task.mode=modeOverride;if(!['find','inspect','touch'].includes(task.mode))throw Error('Unknown mission');
  if(!this.budget.payload_ok)throw Error('Payload exceeds this airframe profile. Choose a larger airframe or lighter compute.');
  if(this.budget.thrust_weight<1.5)throw Error('Insufficient thrust reserve for this payload.');
  this.task=task;this.decisionAt=this.time;this.selected=task.target_id;this.missionId++;this.manualMode=false;this.state='search';this.pending=null;this.externalRequest=null;this.action=[0,0,0];this.actionUntil=this.time;this.policyTime=0;this.dwell=0;this.path=[];this.lastRouteTime=-Infinity;this.searchIndex=0;this.abortReason=null;this.telemetry.contact_speed=null;this.report('mission',instruction);this.running=true;
 }
 hold(reason='Hold commanded'){this.task=null;this.missionId++;this.pending=null;this.externalRequest=null;this.holdPoint=this.position();this.state='hold';this.status=reason;this.action=[0,0,0];this.actionUntil=0;this.path=[];this.integral=[0,0,0];this.report('hold',reason);}
 setManual(enabled){this.hold(enabled?'Manual control · W A S D / Q E / arrows':'Holding position');this.manualMode=enabled;this.state=enabled?'manual':'hold';this.manual=[0,0,0,0];}
 setPolicyMode(mode){if(!['local','external'].includes(mode))throw Error('Unknown policy mode');this.hold('Policy changed · issue a new mission');this.policyMode=mode;this.policyError=null;}
 clearPoint(p,margin=1.1){return Math.abs(p[0])<=9.2&&Math.abs(p[1])<=7.5&&this.sceneObjects.every(o=>Math.hypot(Math.max(0,Math.abs(p[0]-o.position[0])-o.size[0]/2),Math.max(0,Math.abs(p[1]-o.position[1])-o.size[1]/2))>margin);}
 segment(a,b,margin=1.1){const n=Math.max(1,Math.ceil(distance(a.slice(0,2),b.slice(0,2))/.18));for(let i=0;i<=n;i++)if(!this.clearPoint([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n],margin))return false;return true;}
 route(start,goal){
  if(!this.clearPoint(start)){const candidates=[];for(let x=-9;x<=9;x+=.5)for(let y=-7;y<=7;y+=.5){const p=[x,y,goal[2]];if(this.clearPoint(p,1.25)&&this.segment(start,p,.48))candidates.push(p);}candidates.sort((a,b)=>distance(a,start)-distance(b,start));return candidates.length?[candidates[0]]:[];}
  if(this.segment(start,goal))return [[...goal]];const size=39,cell=p=>[clamp(Math.round((p[0]+9.5)/.5),0,38),clamp(Math.round((p[1]+9.5)/.5),0,38)],key=([x,y])=>x+y*size,point=k=>[(k%size)*.5-9.5,Math.floor(k/size)*.5-9.5,goal[2]];
  const nearest=p=>{const [x,y]=cell(p),candidates=[];for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const k=key([x+dx,y+dy]);if(x+dx>=0&&x+dx<size&&y+dy>=0&&y+dy<size&&this.segment(p,point(k)))candidates.push(k);}return candidates.sort((a,b)=>distance(point(a),p)-distance(point(b),p))[0];};
  const first=nearest(start),end=nearest(goal);if(first===undefined||end===undefined)return [];const open=[first],cost=new Map([[first,0]]),parent=new Map(),closed=new Set();
  while(open.length){open.sort((a,b)=>(cost.get(a)+distance(point(a),goal))-(cost.get(b)+distance(point(b),goal)));const current=open.shift();if(closed.has(current))continue;closed.add(current);
   if(current===end){let k=current,points=[[...goal]];while(parent.has(k)){points.push(point(k));k=parent.get(k);}points.reverse();const smooth=[];let p=start;while(points.length){let j=points.length-1;while(j>0&&!this.segment(p,points[j]))j--;if(!this.segment(p,points[j]))return [];p=points[j];smooth.push(p);points.splice(0,j+1);}return smooth;}
   const x=current%size,y=Math.floor(current/size);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=size||ny>=size)continue;const next=nx+ny*size;if(closed.has(next)||!this.segment(point(current),point(next)))continue;const value=cost.get(current)+Math.hypot(dx,dy)*.5;if(value<(cost.get(next)??Infinity)){cost.set(next,value);parent.set(next,current);open.push(next);}}
  }return [];
 }
 taskGoal(){
  if(!this.task)return this.holdPoint;
  const elapsed=this.time-(this.decisionAt??this.time);this.decisionAt=this.time;
  const seen=this.observed[this.task.target_id],visible=this.visible.includes(this.task.target_id),age=seen?this.time-seen.last_seen:Infinity;
  if(visible){this.seenTime=this.time;this.telemetry.inspected_frames++;}
  if(!seen||age>2){this.state='search';this.status=seen?'Target lost · reacquiring from camera observations':'Searching · target coordinates remain unknown';this.desiredYaw+=.015;
   const stations=[[0,-4,2.8],[-3,-3,2.8],[-3,3,2.8],[3,3,2.8],[6,0,2.8],[0,-5,2.8]],goal=stations[this.searchIndex%stations.length];if(distance(this.position(),goal)<.5)this.searchIndex++;return goal;
  }
  if(this.task.mode==='find'){
   this.dwell=visible?this.dwell+elapsed:0;if(this.dwell>.6){this.finish('Object found and confirmed in the onboard camera.');return this.holdPoint;}
   this.state='confirm';this.status='Confirming the visual observation';return this.position();
  }
  const face=[seen.position[0],seen.position[1]-seen.size[1]/2,seen.position[2]],approach=add(face,[0,-2.1,0]),delta=sub(face,this.position());this.desiredYaw=Math.atan2(delta[1],delta[0]);
  if(this.state==='contact'){this.status='Touch approach · ≤ 0.12 m/s · contact probe active';return add(face,[0,-.87,0]);}
  if(this.state==='retreat')return add(face,[0,-2.1,0]);
  if(distance(this.position(),approach)<.24&&norm(this.velocity())<.18&&visible){
   if(this.task.mode==='touch'){this.state='contact';this.path=[];this.lastRouteTime=-Infinity;this.report('contact','Aligned with fixture. Beginning low-speed probe approach.');return add(face,[0,-.87,0]);}
   this.dwell+=elapsed;if(this.dwell>1.5){this.finish('Inspection complete · target held in view at stand-off.');return this.holdPoint;}
   this.state='inspect';this.status='Inspecting at a two-metre stand-off';
  }else{this.state='approach';this.status='Approaching the observed object through clear space';this.dwell=0;}
  return approach;
 }
 finish(message){this.holdPoint=this.position();this.task=null;this.state='success';this.status=message;this.action=[0,0,0];this.pending=null;this.externalRequest=null;this.path=[];this.report('success',message);}
 localPlan(){
  if(!this.task)return;
  const goal=this.taskGoal();if(!this.task)return;
  if(this.state==='confirm'){this.action=[0,0,0];this.actionUntil=this.time+.5;return;}
  const precise=this.state==='contact',speed=precise?.12:this.state==='inspect'?.25:1.1;
  if(precise){this.path=[goal];}
  else if(this.time-this.lastRouteTime>.75||!this.path.length){this.path=this.route(this.position(),goal);this.lastRouteTime=this.time;}
  while(this.path.length>1&&distance(this.position(),this.path[0])<.45)this.path.shift();
  if(!this.path.length){this.action=[0,0,0];this.status='No clear route · holding and observing';return;}
  const waypoint=this.path[0],action=this.policy.predict(sub(waypoint,this.position()),this.velocity(),speed,precise);
  this.pending={episode:this.episode,mission:this.missionId,ready:this.time+this.config.inference_ms/1000,fresh_until:this.time+.75,velocity:action,expires:this.time+this.config.inference_ms/1000+.55};
 }
 externalObservation(){
  if(this.policyMode!=='external'||!this.task||this.externalRequest)return null;
  const request={version:1,episode:this.episode,mission:this.missionId,sequence:++this.policySequence,simulation_time:this.time,instruction:this.task.instruction,task:this.task.mode,target_id:this.task.target_id,reference:this.reference,
   camera:this.cameraPose(),state:{frame:'world_xyz_z_up',quaternion_order:'wxyz',angular_velocity_frame:'body_flu',position:this.position(),velocity:this.velocity(),quaternion:[this.body.quaternion.w,this.body.quaternion.x,this.body.quaternion.y,this.body.quaternion.z],angular_velocity_body:A(this.body.vectorToLocalFrame(this.body.angularVelocity)),ranges_m:[...this.ranges],mass_kg:this.budget.mass_kg},observations:this.visible.map(id=>this.observed[id]),action_contract:{frame:'body_flu',max_speed_mps:1.5,max_yaw_rate_rps:1,max_duration_s:.5},source:'RGB image plus explicitly simulated depth/semantic observations; perfect flight pose'};
  this.externalRequest=request;return structuredClone(request);
 }
 acceptExternal(reply){try{if(!this.externalRequest)throw Error('No outstanding VLA request');const action=validateAction(reply,this.externalRequest,this.time);this.action=rotate(action.velocity_mps,this.body.quaternion);this.desiredYaw=wrap(this.yaw()+action.yaw_rate_rps*action.duration_s);this.actionUntil=this.time+action.duration_s;this.telemetry.actions++;this.policyError=null;this.externalRequest=null;}catch(error){this.telemetry.rejected++;this.externalRequest=null;this.policyError=error.message;throw error;}}
 failExternal(message){this.externalRequest=null;this.policyError=message;this.actionUntil=0;}
 onContact(event){
  if(this.state==='fault')return;
  const c=event.contact,other=event.body,probe=c.si===this.probe||c.sj===this.probe,speed=Math.abs(c.getImpactVelocityAlongNormal());
  if(this.state==='success'&&probe&&other.objectId===this.completedContactId&&speed<=.25)return;
  if(probe&&this.task?.mode==='touch'&&this.state==='contact'&&other.objectId===this.task.target_id&&speed<=.25){this.completedContactId=other.objectId;this.telemetry.contact_speed=speed;this.telemetry.estimated_impact_ns=this.budget.mass_kg*speed;this.finish(`Gentle contact confirmed · ${(speed*100).toFixed(1)} cm/s closing speed.`);this.holdPoint=add(this.position(),[0,-.2,0]);return;}
  this.telemetry.collisions++;this.state='fault';this.status=`Unexpected contact with ${other.objectId||'geometry'} · episode stopped`;this.running=false;this.task=null;this.action=[0,0,0];this.report('fault',this.status);
 }
 control(){
  if(this.time-this.lastSensorTime>=.05-1e-8)this.sense();
  if(this.task&&this.policyMode==='external')this.taskGoal();
  if(this.pending&&this.pending.ready<=this.time){if(this.pending.episode===this.episode&&this.pending.mission===this.missionId&&this.time<=this.pending.fresh_until){this.action=this.pending.velocity;this.actionUntil=this.pending.expires;this.telemetry.actions++;}else{this.telemetry.rejected++;this.actionUntil=0;this.status='Inference exceeded freshness window · onboard braking';}this.pending=null;}
  if(this.task&&this.policyMode==='local'&&!this.pending&&this.time>=this.policyTime){this.localPlan();this.policyTime=this.time+.2;}
  let desired=[0,0,0];
  if(this.manualMode){const yaw=this.yaw(),[forward,left,up,turn]=this.manual;desired=[Math.cos(yaw)*forward-Math.sin(yaw)*left,Math.sin(yaw)*forward+Math.cos(yaw)*left,up];this.desiredYaw=wrap(this.desiredYaw+turn*.05);this.holdPoint=this.position();}
  else if(this.task){this.stale=this.time>this.actionUntil;desired=this.stale?[0,0,0]:[...this.action];if(this.stale&&this.policyMode==='external')this.status='Waiting for a fresh VLA action · onboard velocity braking';}
  else{desired=scale(sub(this.holdPoint,this.position()),.8);if(norm(desired)>.5)desired=scale(desired,.5/norm(desired));}
  if(this.coordinateVelocity)desired=this.coordinateVelocity(desired);
  const precise=this.state==='contact';if(precise&&norm(desired)>.12)desired=scale(desired,.12/norm(desired));
  // Range braking applies to every controller, including external policies.
  for(let i=0;i<16;i++){const a=i*Math.PI/8,dir=[Math.cos(a),Math.sin(a),0],toward=dot(desired,dir),range=this.ranges[i],margin=precise?.70:1.02,allowed=Math.sqrt(2*1.2*Math.max(0,range-margin));if(toward>allowed)desired=sub(desired,scale(dir,toward-allowed));}
  if(this.position()[2]<.7)desired[2]=Math.max(desired[2],.4);if(this.position()[2]>5)desired[2]=Math.min(desired[2],-.4);
  this.lastDesiredVelocity=desired;const error=sub(desired,this.velocity());this.integral=this.integral.map((v,i)=>clamp(v+error[i]*.05*.5,-.7,.7));this.acceleration=error.map((v,i)=>clamp(v*2.7+this.integral[i],-2.8,2.8));
 }
 motors(){
  this.attitudeYaw=wrap(this.attitudeYaw+clamp(wrap(this.desiredYaw-this.attitudeYaw),-.7*DT,.7*DT));
  const body=this.body,R=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(v,body.quaternion)),force=scale(add(this.acceleration,[0,0,9.81]),this.budget.mass_kg),z=unit(force),heading=[Math.cos(this.attitudeYaw),Math.sin(this.attitudeYaw),0],y=unit(cross(z,heading)),desired=[cross(y,z),y,z];
  const e=[(dot(desired[2],R[1])-dot(R[2],desired[1]))/2,(dot(desired[0],R[2])-dot(R[0],desired[2]))/2,(dot(desired[1],R[0])-dot(R[1],desired[0]))/2],omega=A(body.vectorToLocalFrame(body.angularVelocity)),inertia=A(body.inertia),torque=e.map((v,i)=>-inertia[i]*(18*v+7*omega[i]));
  const thrust=Math.max(0,dot(force,R[2])),arm=this.air.arm,voltage=.85+.15*this.charge;
  this.commands=this.rotors.map(([x,y],k)=>clamp((thrust/4+y*torque[0]/(4*arm**2)-x*torque[1]/(4*arm**2)+this.spins[k]*torque[2]/(4*.025))/voltage**2,0,this.air.max_rotor_n));
  for(let k=0;k<4;k++){const target=Math.sqrt(this.commands[k]/1.1e-5);this.motorSpeed[k]+=(target-this.motorSpeed[k])*(1-Math.exp(-DT/.035));this.thrust[k]=1.1e-5*this.motorSpeed[k]**2*voltage**2;body.applyLocalForce(new C.Vec3(0,0,this.thrust[k]),V(this.rotors[k]));body.applyTorque(body.vectorToWorldFrame(new C.Vec3(0,0,this.spins[k]*.025*this.thrust[k])));}
 }
 beforePhysics(force=false){
  if((!this.running&&!force)||this.state==='fault')return false;if(this.stepCount%12===0)this.control();this.motors();
  this.gust=[this.config.wind*(.8+.15*Math.sin(this.time*.7)),this.config.wind*.15*Math.cos(this.time*.5),0];const relative=sub(this.velocity(),this.gust);this.body.applyForce(V(scale(relative,-.16*norm(relative))));this.body.applyTorque(this.body.angularVelocity.scale(-.015));return true;
 }
 afterPhysics(){
  this.time=this.world.time;this.stepCount++;
  this.powerW=12+4*this.thrust.reduce((s,f)=>s+f**1.5,0)+this.budget.compute_w;this.energyWh+=this.powerW*DT/3600;this.charge=clamp(1-this.energyWh/this.air.battery_wh,0,1);
  if(this.stepCount%24===0){this.trail.push(this.position());if(this.trail.length>900)this.trail.shift();}
  if(this.position().some(v=>!Number.isFinite(v))||Math.abs(this.position()[0])>11||Math.abs(this.position()[1])>9||this.position()[2]>7||this.charge<.05){this.state='fault';this.status='Flight envelope or battery limit reached · episode stopped';this.running=false;}
  return true;
 }
 step(force=false){if(!this.beforePhysics(force))return false;this.world.step(DT);return this.afterPhysics();}
 snapshot(){return {episode:this.episode,mission:this.missionId,time:this.time,running:this.running,state:this.state,status:this.status,selected:this.selected,task:this.task?{...this.task}:null,config:{...this.config},budget:{...this.budget},position:this.position(),velocity:this.velocity(),quaternion:[this.body.quaternion.x,this.body.quaternion.y,this.body.quaternion.z,this.body.quaternion.w],angular_velocity:A(this.body.vectorToLocalFrame(this.body.angularVelocity)),heading:this.yaw(),rotors:this.thrust.map((thrust,i)=>({thrust,command:this.commands[i],rpm:this.motorSpeed[i]*60/(2*Math.PI)})),camera:this.cameraPose(),visible:[...(this.visible||[])],observed:structuredClone(this.observed),path:this.path.map(p=>[...p]),trail:this.trail.map(p=>[...p]),policy:{mode:this.policyMode,calls:this.policy.calls,parameters:387,samples:this.policy.net.samples,validation_mae:this.policy.validation_mae,action:[...this.action],desired_velocity:this.lastDesiredVelocity||[0,0,0],expires:this.actionUntil,stale:this.stale,pending:!!this.pending,error:this.policyError},telemetry:{...this.telemetry},events:this.events.map(e=>({...e})),energy_wh:this.energyWh,battery:this.charge,power_w:this.powerW||0,manual:this.manualMode};}
}
