import * as C from '../vendor/cannon-es.js';
import {SingleSimulation} from './simulation.js';
import {ObservedMap,cameraBasis} from '../sim/observed-map.js';
import {add,sub,scale,unit,norm,dot,distance,clamp} from '../sim/math.js';

export const DRONE_IDS=['master','slave1','slave2'];
export const DRONE_COLORS=[0x39b8a3,0xe6ae54,0x779df2];
// A stored task field gives each aircraft a different survey corridor. These
// are bay navigation priors, not undiscovered target coordinates.
export const SEARCH_FIELDS=[
 [[0,-5,2.4],[3,-4,2.4],[7,1,2.4],[3,6.5,2.4],[-3,6.5,2.4]],
 [[-3,-5,3.2],[-7,-3,3.2],[-6,1,3.2],[-3,6.5,3.2],[3,6.5,3.2]],
 [[3,-6,4.2],[7,-4,4.2],[7,3,4.2],[3,6.5,4.2],[-3,6.5,4.2]]
];
const DT=1/240,V=a=>new C.Vec3(...a),A=v=>[v.x,v.y,v.z];
const limited=(v,max)=>norm(v)>max?scale(v,max/norm(v)):v;

export function evaluateCurve(plan,age){
 const t=clamp(age/plan.duration,0,1),u=1-t,[a,b,c,d]=plan.controls;
 return {position:a.map((v,k)=>u**3*v+3*u*u*t*b[k]+3*u*t*t*c[k]+t**3*d[k]),
  velocity:a.map((v,k)=>3*(u*u*(b[k]-v)+2*u*t*(c[k]-b[k])+t*t*(d[k]-c[k]))/plan.duration)};
}

/** Three independent rigid bodies/controllers, one world integration per tick.
 * NN1 is an explicit heuristic fusion/planning interface. It does not infer
 * geometry from RGB; the simulated RGB-D sensor supplies first surface hits.
 */
export class TeamSimulation {
 constructor(weights,config={}){this.weights=weights;this.config=config;this.episode=0;this.reset();}
 get lead(){return this.agents[0];}
 get time(){return this.world.time;}
 get running(){return this._running;}
 set running(value){this._running=value;this.agents?.forEach(a=>a.running=value);}
 get manual(){return this.agents[this.activeDrone].manual;}
 set manual(value){this.agents[this.activeDrone].manual=value;}
 reset(config={}){
  const next={...this.config,...config},agents=DRONE_IDS.map(()=>new SingleSimulation(this.weights,next));
  this.config=next;this.episode++;this.activeDrone=0;this.tick=0;this.task=null;this.state='ready';this.status='Three aircraft ready · select a visual task';this.selected=null;this.dwell=0;this.autoAim=true;
  this.agents=agents;this.world=this.lead.world;
  this.agents.forEach((a,i)=>{
   if(i){a.world.removeBody(a.body);a.world=this.world;this.world.addBody(a.body);a.staticBodies=this.lead.staticBodies;}
   a.body.objectId=DRONE_IDS[i];a.body.objectType='drone';a.body.collisionFilterGroup=2<<i;
   const start=[[0,-6,2.4],[-3,-6,3.2],[3,-6,4.2]][i];a.body.position.set(...start);a.holdPoint=[...start];a.searchIndex=0;a.episode=this.episode;
   a.visionRay=(from,to)=>this.visionRay(i,from,to);
   // Perception includes occlusion by other aircraft; navigation ranges remain
   // static rays plus a separate inter-aircraft separation supervisor.
   a.sense=()=>this.senseDrone(i);
   a.localPlan=()=>this.followPlan(i);
   a.coordinateVelocity=v=>this.separate(i,v);
   a.taskGoal=()=>this.goals[i]||a.holdPoint;
   a.events=[];a.report('ready',`${DRONE_IDS[i]} · four independently driven rotors · shared three-aircraft world`);
  });
  this.origin=[...this.lead.position()];this.map=new ObservedMap(this.origin);this.shared={};this.plans=[];this.planRevision=0;this.goals=this.agents.map(a=>a.position());this.surveyIndices=[0,0,0];this.sensorFrames=[0,0,0];this.lastMapSnapshot=null;this._running=true;this.agents.forEach(a=>a.sense());this.observe();this.plan();
 }
 visionRay(i,from,to){const r=new C.RaycastResult();this.world.raycastClosest(V(from),V(to),{collisionFilterMask:15^(2<<i),skipBackfaces:true},r);return r.hasHit?{id:r.body.objectId,point:A(r.hitPointWorld),distance:r.distance}:null;}
 senseDrone(i){
  const a=this.agents[i],pose=a.cameraPose();a.visible=[];
  const objects=[...a.sceneObjects,...this.agents.filter((_,j)=>j!==i).map(b=>({id:b.body.objectId,name:b.body.objectId,type:'drone',position:b.position(),size:[.65,.65,.3]}))];
  for(const o of objects){
   const points=[o.position,...[0,1,2].flatMap(k=>[-1,1].map(sign=>o.position.map((v,j)=>v+(j===k?o.size[k]*.45*sign:0))))];
   if(points.some(p=>a.inView(p,pose)&&this.visionRay(i,pose.position,p)?.id===o.id)){
    a.visible.push(o.id);a.observed[o.id]={id:o.id,name:o.name,type:o.type,position:[...o.position],size:[...o.size],last_seen:this.time,source:'simulated depth + semantics',confidence:.98};
   }
  }
  a.ranges=a.ranges.map((_,k)=>{const angle=k*Math.PI/8;return a.ray(a.position(),add(a.position(),[12*Math.cos(angle),12*Math.sin(angle),0]))?.distance??12;});a.lastSensorTime=this.time;
 }
 observe(){
  this.agents.forEach((a,i)=>{
   for(const id of a.visible){const o=a.observed[id];if(o.type!=='drone')this.shared[id]={...o,seen_by:[...new Set([...(this.shared[id]?.seen_by||[]),i])]};}
   if(this.task&&a.visible.includes(this.task.target_id))a.telemetry.inspected_frames++;
   const pose={...a.cameraPose(),drone:i},b=cameraBasis(pose),tan=Math.tan(pose.fov*Math.PI/360),hits=[];
   // A uniform depth image: never seed the reconstruction with complete meshes.
   for(let y=0;y<14;y++)for(let x=0;x<24;x++){
    const direction=unit(add(b.forward,add(scale(b.right,((x+.5)/24*2-1)*tan*16/9),scale(b.up,(1-(y+.5)/14*2)*tan))));
    const hit=this.visionRay(i,pose.position,add(pose.position,scale(direction,16)));
    if(!hit||DRONE_IDS.includes(hit.id))continue; // Dynamic aircraft are live poses, not static map ghosts.
    if(hit.id==='ground'&&(Math.abs(hit.point[0])>11.5||Math.abs(hit.point[1])>9.5))continue; // Rendered floor extent.
    const d=sub(hit.point,pose.position),o=a.sceneObjects.find(o=>o.id===hit.id);
    hits.push({id:hit.id,semantic:o?.type||'ground',label:o?.name||'Observed floor',camera_point:[dot(d,b.right),dot(d,b.up),dot(d,b.forward)]});
   }
   this.map.ingest({drone:i,time:this.time,pose,hits,pose_sigma:0,source:'simulated RGB-D'});this.sensorFrames[i]++;
  });
  this.map.track(this.agents.map(a=>a.position()),this.time);this.lastMapSnapshot=null;
 }
 select(id,reference){this.agents.forEach(a=>a.select(id,reference));this.selected=id;}
 start(instruction){
  // Validate before changing any aircraft; all share the same hardware profile.
  this.lead.start(instruction);this.task={...this.lead.task};this.selected=this.task.target_id;
  for(let i=1;i<3;i++)this.agents[i].start(instruction);
  this.state='search';this.dwell=0;this.surveyIndices=[0,0,0];this.plans=[];this.running=true;this.updateMission();this.plan();
 }
 hold(reason='All aircraft holding position'){this.agents.forEach(a=>{a.manualMode=false;a.manual=[0,0,0,0];a.hold(reason);});this.task=null;this.state='hold';this.status=reason;this.plan();}
 setManual(enabled){this.hold();this.agents[this.activeDrone].setManual(enabled);this.state=enabled?'manual':'hold';this.status=enabled?`Manual flight · ${DRONE_IDS[this.activeDrone]}`:'All aircraft holding position';}
 setActiveDrone(i){if(!Number.isInteger(i)||i<0||i>2)throw Error('Unknown drone');this.agents[this.activeDrone].manual=[0,0,0,0];this.activeDrone=i;}
 setCamera(settings,i=this.activeDrone){this.agents[i].setCamera(settings);}
 setPolicyMode(mode){this.hold('Policy changed · issue a new mission');this.lead.setPolicyMode(mode);}
 externalObservation(){return this.lead.externalObservation();}
 acceptExternal(reply){this.lead.acceptExternal(reply);}
 failExternal(message){this.lead.failExternal(message);}
 finish(message){this.task=null;this.state='success';this.status=message;this.agents.forEach(a=>{a.finish(message);});}
 viewpoint(i,seen){
  const a=this.agents[i],preferred=[-.75,-2.4][i-1],radius=3.5;
  for(const offset of [0,.35,-.35,.7,-.7,1.2,-1.2]){
   const angle=preferred+offset,p=add(seen.position,[Math.cos(angle)*radius,Math.sin(angle)*radius,[0,1.1,2][i]]);
   p[2]=Math.min(4.5,p[2]);if(a.clearPoint(p,1.25))return p;
  }
  return a.holdPoint;
 }
 updateMission(){
  if(!this.task)return;
  if(this.lead.state==='success'&&this.task.mode==='touch'){this.finish('Master probe contact confirmed · supporting aircraft holding');return;}
  const seen=this.shared[this.task.target_id],fresh=seen&&this.time-seen.last_seen<2,visible=this.agents.some(a=>a.visible.includes(this.task.target_id));
  if(!fresh){
   this.state='search';this.status=seen?'Target lost · distributed reacquisition':'Searching three stored viewpoint fields · target position unknown';this.dwell=0;
   this.agents.forEach((a,i)=>{a.state='search';a.status=this.status;const field=SEARCH_FIELDS[i];let goal=field[this.surveyIndices[i]%field.length];if(distance(a.position(),goal)<.55){this.surveyIndices[i]++;goal=field[this.surveyIndices[i]%field.length];}this.goals[i]=goal;a.desiredYaw+=.022;});return;
  }
  if(this.task.mode==='find'){
   this.dwell=visible?this.dwell+.05:0;this.state='localize';this.status='Localizing from shared camera observations';
   this.goals=this.agents.map(a=>a.position());if(this.dwell>=.65){this.finish(`Object localized · ${seen.seen_by.length} camera source(s) · fixed mission frame`);return;}
  }else{
   this.state='approach';this.status='Target localized · master approaches; partners acquire separate close views';
   const face=add(seen.position,[0,-seen.size[1]/2,0]);this.goals[0]=add(face,[0,-2.1,0]);
   if(this.lead.state==='contact'){this.goals[0]=add(face,[0,-.87,0]);this.state='contact';this.status='Master gentle probe approach · partners maintain stand-off';}
   this.goals[1]=this.viewpoint(1,seen);this.goals[2]=this.viewpoint(2,seen);
   const aligned=distance(this.lead.position(),this.goals[0])<.25&&norm(this.lead.velocity())<.2&&this.lead.visible.includes(seen.id);
   if(this.task.mode==='touch'&&aligned&&this.lead.state!=='contact'){this.lead.state='contact';this.lead.report('contact','Master aligned · beginning gentle probe approach');this.plans=[];}
   if(this.task.mode==='inspect'){
    const ready=this.agents.every((a,i)=>distance(a.position(),this.goals[i])<.4&&norm(a.velocity())<.25&&a.visible.includes(seen.id));
    this.dwell=ready?this.dwell+.05:0;if(this.dwell>=1.5){this.finish('Three-view inspection complete · all aircraft at separate stand-offs');return;}
   }
  }
  this.agents.forEach((a,i)=>{
   if(a.state!=='contact')a.state=i?'viewpoint':this.state;
   a.status=i?'Acquiring an independent close view':this.status;
   const d=sub(seen.position,a.cameraPose().position);a.desiredYaw=Math.atan2(d[1],d[0]);
   if(this.autoAim){a.config.camera_yaw=0;a.config.camera_pitch=clamp(Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,-75,30);a.config.fov=norm(d)<5?55:78;}
  });
 }
 separate(i,velocity){
  let v=[...velocity];const a=this.agents[i];
  for(let j=0;j<3;j++){if(j===i)continue;const delta=sub(this.agents[j].position(),a.position()),d=norm(delta),dir=unit(delta);if(d>3.2)continue;
   // Symmetric reciprocal separation; never accelerate into a neighbour.
   const closing=dot(sub(v,this.agents[j].velocity()),dir),allowed=Math.max(-.5,(d-1.85)*.65);
   if(closing>allowed)v=sub(v,scale(dir,(closing-allowed)*.65));
  }
  return limited(v,a.state==='contact'?.12:1.1);
 }
 plan(){
  const plans=[];
  this.agents.forEach((a,i)=>{
   const start=a.position(),v0=limited(a.velocity(),1.1),contact=a.state==='contact';
   let route=this.task?(contact?[this.goals[i]]:a.route(start,this.goals[i])):[];
   while(route.length>1&&distance(start,route[0])<.4)route.shift();a.path=route;
   const speed=contact?.12:.85,goal=route[0]||a.holdPoint;
   let v1=this.task?this.separate(i,a.policy.predict(sub(goal,start),a.velocity(),speed,true)):limited(scale(sub(a.holdPoint,start),.8),.5);
   let plan;
   for(let attempt=0;attempt<5;attempt++){
    const end=add(start,scale(add(v0,v1),.5));
    plan={drone:i,id:DRONE_IDS[i],frame:'world_xyz_z_up',generated_at:this.time,duration:1,revision:this.planRevision+1,controls:[start,add(start,scale(v0,1/3)),sub(end,scale(v1,1/3)),end],goal:[...goal],mode:a.state,valid:true};
    plan.points=Array.from({length:21},(_,k)=>evaluateCurve(plan,k/20).position);
    const clearance=p=>Math.min(...a.sceneObjects.map(o=>Math.hypot(...p.map((v,k)=>Math.max(0,Math.abs(v-o.position[k])-o.size[k]/2)))));
    const obstacleSafe=plan.points.every(p=>Math.abs(p[0])<9.3&&Math.abs(p[1])<7.6&&p[2]>.65&&p[2]<5&&clearance(p)>=Math.min(clearance(start)-.01,contact?.65:.9));
    const teamSafe=plans.every(other=>plan.points.every((p,k)=>distance(p,other.points[k])>=1.65));
    if(obstacleSafe&&teamSafe)break;
    v1=scale(v1,.3);plan.valid=false;
   }
   if(!plan.valid){plan.controls=Array.from({length:4},()=>[...start]);plan.points=Array.from({length:21},()=>[...start]);plan.mode='blocked · hold';}
   plans.push(plan);
  });
  this.plans=plans;this.planRevision++;this.lastPlanTime=this.time;
 }
 followPlan(i){
  const a=this.agents[i],plan=this.plans[i];if(!a.task||!plan)return;
  const age=this.time-plan.generated_at;if(age>1.1){a.actionUntil=0;return;}
  const desired=evaluateCurve(plan,age+.12),feedback=scale(sub(desired.position,a.position()),.85);
  const action=limited(add(desired.velocity,feedback),a.state==='contact'?.12:1.05);
  a.pending={episode:a.episode,mission:a.missionId,ready:this.time+a.config.inference_ms/1000,fresh_until:this.time+.75,velocity:action,expires:Math.min(this.time+a.config.inference_ms/1000+.55,plan.generated_at+1.15)};
 }
 step(force=false){
  if(!this.running&&!force)return false;if(this.state==='fault')return false;
  if(this.tick%12===0){this.agents.forEach(a=>a.sense());this.observe();this.updateMission();}
  if(this.time-this.lastPlanTime>=1-1e-8||this.plans.length!==3)this.plan();
  this.agents.forEach(a=>a.beforePhysics(force));this.world.step(DT);this.agents.forEach(a=>a.afterPhysics());this.tick++;
  const fault=this.agents.find(a=>a.state==='fault');if(fault){this.running=false;this.state='fault';this.status=fault.status;}
  return true;
 }
 snapshot(){
  if(!this.lastMapSnapshot)this.lastMapSnapshot=this.map.snapshot(this.time);
  const drones=this.agents.map((a,i)=>({...a.snapshot(),id:DRONE_IDS[i],index:i,color:DRONE_COLORS[i],absolute:sub(a.position(),this.origin),relative_to_master:sub(a.position(),this.lead.position()),camera:{...a.cameraPose(),drone:i},sensor_frames:this.sensorFrames[i]}));
  return {...drones[0],manual:drones[this.activeDrone].manual,episode:this.episode,time:this.time,state:this.state,status:this.status,running:this.running,task:this.task,selected:this.selected,active_drone:this.activeDrone,drones,
   origin:[...this.origin],relative:drones.map(a=>drones.map(b=>sub(b.position,a.position))),plans:structuredClone(this.plans),plan_revision:this.planRevision,plan_time:this.lastPlanTime,
   reconstruction:this.lastMapSnapshot,shared:structuredClone(this.shared),coordinator:{type:'heuristic',name:'NN1 interface · heuristic fusion + cubic trajectory planner',horizon_s:1,replan_hz:1,sensors_hz:20,auto_aim:this.autoAim,search_fields:SEARCH_FIELDS,phase:this.state,navigation_prior:'Known static test-bay geometry; object discovery and reconstruction use camera observations',localization:'Exact simulated poses; fixed origin at master initial position, axes never rotate'}};
 }
}
