import {Random,clamp,vector,sub,scale,norm,unit,dot,distance,add} from './math.js';
import {makeScene} from './scene.js';
import {Navigator} from './navigation.js';
import {Person} from './person.js';
import {Physics,arr,vec} from './physics.js';
import {WorldModel} from './world-model.js';
import {browserSpec,graph} from './graph.js';
import {cityGuidance} from './city-guidance.js';
import {evaluateTrajectory} from './trajectory.js';
import {ObservedMap,cameraSurfaceObservations,pointInCamera,SENSOR_PROFILES} from './observed-map.js';
import {validateControlReply} from './control-contract.js';
import {cameraPose} from './camera-pose.js';
import {DroneModules,master_drone,slave1_drone,slave2_drone} from './drone-functions.js';

const RAYS=Array.from({length:12},(_,i)=>[Math.cos(i*Math.PI/6),Math.sin(i*Math.PI/6),0]);
export class Simulation {
  constructor(spec,config={}) {this.spec=browserSpec(spec);this.version=0;this.speed=1;this.config={drones:3,map_source:'known',sensor_profile:'nominal',controller:'browser',scene:'yard',wind:2,seed:7,seconds:300,randomize:true,sensor_noise:.015,radio_loss:.05,radio_delay:2,physics_hz:240,control_hz:30,...config};this.validate(this.config);this.reset();}
  validate(c) {
    if(!['known','observed'].includes(c.map_source)||!(c.sensor_profile in SENSOR_PROFILES))throw Error('Unknown map/sensor mode');
    if(!['browser','python'].includes(c.controller))throw Error('Unknown controller');
    if(c.drones!==3)throw Error('Exactly three drones are required');
    if(!['yard','warehouse','forest','office','amsterdam'].includes(c.scene))throw Error('Unknown scene');
    if(!Number.isInteger(c.seed)||c.seed<0||c.seed>0xffffffff)throw Error('Seed must be an unsigned 32-bit integer');
    for(const [key,lo,hi] of [['wind',0,12],['seconds',1,3600],['sensor_noise',0,1],['radio_loss',0,1],['radio_delay',0,30]])if(!Number.isFinite(c[key])||c[key]<lo||c[key]>hi)throw Error(`Invalid ${key}`);
    if(!Number.isInteger(c.radio_delay))throw Error('Radio delay must be an integer');
    if(c.physics_hz!==240||c.control_hz!==30)throw Error('This runtime uses fixed 240 Hz physics / 30 Hz control');
  }
  reset() {
    this.externalControl=null;this.externalStepPending=false;this.controlRevision=0;this.diagnostics={accepted:0,rejected:0,tracking_sum_sq:0,tracking_count:0,tracking_rms_m:0,min_pair_distance:null,inner_loop_hz:240};this.rng=new Random(this.config.seed);this.obstacles=makeScene(this.config.scene,this.rng);this.physics=new Physics(this.obstacles,this.rng,this.config.randomize,this.config.scene==='amsterdam');
    this.referenceOrigin=Object.freeze([...this.positions()[0]]);this.observedMap=new ObservedMap(this.referenceOrigin);this.nextMappingAt=0;this.sensorRng=new Random(this.config.seed^0x51A7);
    this.actor=new Person(this.obstacles,this.spec.object_types.find(t=>t.id==='person'));
    this.continuousGuidance=this.config.scene==='amsterdam';
    this.destinationLabel=this.continuousGuidance?'South-east bridge':'Exit';
    if(this.config.scene==='amsterdam'){
      this.actor.position=[0,-7,0];this.actor.destination=[12.15,-10,.05];this.actor.inspectionGoal=[0,3];this.actor.patrolPoints=[[0,8.5],[1,-6],[0,3]];this.actor.setGoal(this.actor.inspectionGoal);this.actor.continuousGuidance=true;
    }
    // Forest seeds can place a trunk at the original destination.
    this.actor.destination=[...this.actor.navigator.nearestClear(this.actor.destination),this.actor.navigator.surfaceHeight(this.actor.destination)];
    this.physics.syncPerson(this.actor);this.goals=this.positions();this.goalVelocity=Array.from({length:3},()=>[0,0,0]);this.routes=[[],[],[]];this.routeBlocked=[false,false,false];this.mode='guidance';this.replanAt=0;this.autoOfferAt=4;
    this.airNav=new Navigator(this.obstacles,this.continuousGuidance?1.4:.65,3.8,.35);this.visible=[false,false,false];this.lastSeen=null;this.occluded=false;
    this.exitRoute=[];this.guidanceStatus='Observing';this.pathOfferPending=false;this.droneRoles=['Observe','Observe','Observe'];this.cityOfferAt=0;this.cityRestSince=null;this.tactics=null;this.reacquiredUntil=0;this.droneSpeedLimits=[1.8,1.8,1.8];
    if(this.config.scene==='amsterdam')this.autoOfferAt=null;
    this.steps=0;this.time=0;this.reason='flying';this.finished=false;this.running=true;this.interventions=[];this.lastAction=Array.from({length:3},()=>[0,0,0]);
    const angle=this.rng.uniform(0,Math.PI*2);this.windBase=[Math.cos(angle)*this.config.wind,Math.sin(angle)*this.config.wind,.03*this.config.wind];this.wind=[...this.windBase];this.gust=[0,0,0];
    this.modules=new DroneModules(this.config.seed);this.radioTimes=[0,0,0];this.history=Array.from({length:this.config.radio_delay+1},()=>this.positions());this.radio=this.positions();this.radioDrops=0;this.version++;this.model=new WorldModel(this.config.seed,this.config.controller==='python'?.05:1/30);this.observe();this.modules.tick(this);
  }
  positions(){return this.physics.drones.map(d=>arr(d.body.position));}
  observeCameras(frames){
    if(frames.length!==3||frames.some((f,i)=>f.pose.drone!==i||Math.abs(f.pose.time-this.time)>1e-6))return;
    this.visible=frames.map(f=>[.3,.6,.9].some(h=>{const target=add(this.actor.position,[0,0,this.actor.height*h]);return pointInCamera(target,f.pose,16)&&this.physics.ray(f.pose.position,target,true)?.person===true;}));
    if(this.visible.some(Boolean))this.lastSeen={time:this.time,position:[...this.actor.position],velocity:[...this.actor.velocity],height:this.actor.height,source:'camera FOV + occlusion; simulated semantic detection'};
    if(this.time+1e-6<this.nextMappingAt)return;
    for(const frame of frames)this.observedMap.ingest(cameraSurfaceObservations(frame.pose,this.physics,this.obstacles,{profile:this.config.sensor_profile,rng:this.sensorRng}));
    this.observedMap.track(this.positions(),this.time);this.nextMappingAt=this.time+.2;
  }
  observeNativeCameras(){
    const snapshot={time:this.time,perception:{last_seen:this.lastSeen},drones:this.physics.drones.map((d,i)=>({position:arr(d.body.position),velocity:arr(d.body.velocity),goal:this.goals[i],quaternion:[d.body.quaternion.w,d.body.quaternion.x,d.body.quaternion.y,d.body.quaternion.z]}))};
    this.observeCameras([0,1,2].map(i=>({pose:cameraPose(snapshot,i)})));
  }
  hold(){this.mode='hold';this.goals=this.positions();this.goalVelocity=Array.from({length:3},()=>[0,0,0]);this.routes=[[],[],[]];}
  observe() {
    const positions=this.positions();this.ranges=[];
    if(this.config.controller!=='python')this.visible=positions.map(p=>[.3,.6,.9].some(h=>{const target=add(this.actor.position,[0,0,this.actor.height*h]);if(distance(p,target)>16)return false;const hit=this.physics.ray(p,target,true);return hit?.person===true;}));
    if(this.config.controller!=='python'&&this.visible.some(Boolean))this.lastSeen={time:this.time,position:[...this.actor.position],velocity:[...this.actor.velocity],height:this.actor.height};
    this.observations=positions.map((p,i)=>{
      const d=this.physics.drones[i],noisy=p.map(x=>x+this.rng.normal()*this.config.sensor_noise),velocity=arr(d.body.velocity).map(x=>x+this.rng.normal()*this.config.sensor_noise*.5);
      const ranges=RAYS.map(ray=>clamp((this.physics.ray(p,add(p,scale(ray,12)),true)?.distance??12)+this.rng.normal()*this.config.sensor_noise,0,12));this.ranges.push(ranges);
      let peer=null,dist=Infinity;for(let j=0;j<3;j++)if(i!==j){const v=sub(this.radio[j],noisy),r=norm(v);if(r<dist){peer=v;dist=r;}}
      return [...sub(this.goals[i],noisy),...sub(velocity,this.goalVelocity[i]),...this.physics.rotation(d.body)[2],...arr(d.body.vectorToLocalFrame(d.body.angularVelocity)),...peer,dist,...ranges,d.battery,...this.lastAction[i]];
    });
  }
  policy() {
    return [master_drone,slave1_drone,slave2_drone].map((controller,i)=>{
      const trajectory=this.modules.trajectories[i],trajectoryTime=.25+Math.max(0,this.time-(trajectory?.generated_at??this.time)),observation=[...this.observations[i]];
      if(trajectory){const ref=evaluateTrajectory(trajectory,trajectoryTime),p=this.positions()[i],v=arr(this.physics.drones[i].body.velocity);for(let k=0;k<3;k++){observation[k]=ref.position[k]-p[k];observation[k+3]=v[k];}}
      return controller({observation,speed:this.continuousGuidance?this.droneSpeedLimits[i]:2,trajectory,trajectoryTime}).acceleration;
    });
  }
  mission() {
    const pos=this.positions();this.goalVelocity=Array.from({length:3},()=>[0,0,0]);
    if(this.mode==='guidance') {
      if(this.continuousGuidance){cityGuidance(this);return;}
      if(this.actor.refused&&!this.continuousGuidance){this.guidanceStatus='Offer declined · holding';this.hold();return;}
      if(!this.continuousGuidance&&!['leave via destination','follow drawn route','hide at endpoint'].includes(this.actor.intention))return;
      if(!this.visible.some(Boolean)&&!this.continuousGuidance){this.guidanceStatus='Sight lost · holding last observation';if(!this.occluded){this.goals=pos;this.routes=[[],[],[]];this.occluded=true;}return;}
      if(!this.lastSeen){this.guidanceStatus='Bridge guidance · awaiting first observation';return;}
      if(this.occluded){this.replanAt=0;this.occluded=false;}
      // The mission uses the latest ray observation, never hidden actor coordinates.
      const person=this.lastSeen.position,delta=sub(this.actor.destination.slice(0,2),person.slice(0,2));
      if(this.time>=this.replanAt){const walkNav=new Navigator(this.obstacles,.42,.9,.9,true);this.exitRoute=walkNav.path(person,this.actor.destination);}
      let direction=unit(sub(this.exitRoute[0]||this.actor.destination.slice(0,2),person.slice(0,2)));if(norm(direction)<.1)direction=[0,1];const lateral=[-direction[1],direction[0]];
      this.guidanceStatus=this.actor.intention==='leave via destination'?'Marking accepted exit route':this.actor.routePriority?'Planning exit · drawn route has priority':'Planning a voluntary exit offer';
      if(this.continuousGuidance)this.guidanceStatus=this.visible.some(Boolean)?'Guiding toward bridge · person keeps own route':'Bridge guidance · using last observed position';
      if(this.time>=this.replanAt){this.replanAt=this.time+1;
        // A planning exclusion zone keeps the route indicators to one side of
        // the person. It is not a collider and never constrains person movement.
        const routeNav=new Navigator([...this.obstacles,{kind:'cylinder',position:[person[0],person[1],3.8],size:[2.4,12]}],this.airNav.radius,3.8,.35);
        for(let i=0;i<3;i++){
        let anchor=person.slice(0,2).map((x,k)=>x+direction[k]*(2+2*i)+lateral[k]*3.5);
        if(norm(delta)<2)anchor=this.actor.destination.slice(0,2).map((x,k)=>x+direction[k]*(i-1)*1.8+lateral[k]*3.5);
        anchor=routeNav.nearestClear(anchor.map(x=>clamp(x,-12,12)));
        this.routes[i]=routeNav.path(pos[i],anchor);
        if(!this.routes[i].length&&!this.routeBlocked[i]){this.goals[i]=[...pos[i]];this.routeBlocked[i]=true;}
      }}
      for(let i=0;i<3;i++){
        const route=this.routes[i];if(!route.length)continue;
        // Preserve validated corners. Pushing a waypoint radially away from
        // the person can turn a clear A* route into a segment through a tree.
        if(distance(pos[i].slice(0,2),route[0])<.3&&route.length>1&&this.airNav.segmentClear(pos[i],route[1]))route.shift();
        const goal=[...route[0],3.8];if(this.airNav.clear(goal)&&this.airNav.segmentClear(pos[i],goal)){this.goals[i]=goal;this.routeBlocked[i]=false;}
        else {if(!this.routeBlocked[i])this.goals[i]=[...pos[i]];this.routeBlocked[i]=true;this.replanAt=0;}
      }
      if(this.routes.every(r=>!r.length))this.guidanceStatus=this.continuousGuidance?'Bridge route active · aircraft waiting for clearance':'Narrow / blocked approach · holding clear';
    } else if(this.mode==='formation') {
      const t=this.time;this.goals=pos.map((_,i)=>[(i-1)*1.7+1.8*Math.sin(.15*t),-3+1.8*Math.sin(.1*t),3.2+.3*Math.sin(.2*t)]);this.goalVelocity=pos.map(()=>[.27*Math.cos(.15*t),.18*Math.cos(.1*t),.06*Math.cos(.2*t)]);
    } else if(this.mode==='waypoint') {
      for(let i=0;i<3;i++){const route=this.routes[i];if(route.length){if(distance(pos[i].slice(0,2),route[0])<.4&&route.length>1)route.shift();this.goals[i]=[...route[0],this.commandAltitude];}}
    }
  }
  step() {
    if(this.finished)return false;
    const dt=1/30,before=this.physics.dynamicsState();
    // Reacquiring someone in cover makes a new voluntary offer possible. An
    // explicit path/H command has priority until its endpoint and a short rest.
    if(this.actor.route.length||this.actor.climbTarget)this.cityRestSince=null;else this.cityRestSince??=this.time;
    if(this.continuousGuidance&&this.mode==='guidance'&&this.actor.mode==='autonomous'&&(this.actor.drawnPath.length||this.actor.intention==='seek cover')&&!this.actor.route.length&&!this.actor.climbTarget&&this.actor.intention!=='leave via destination'&&this.actor.decisionAt===null&&this.visible.some(Boolean)&&this.cityRestSince!==null&&this.time>=Math.max(this.cityOfferAt,this.cityRestSince+6)){
      this.actor.requestGuidance(this.time,this.actor.compliance);this.cityOfferAt=this.time+15;this.pathOfferPending=false;this.autoOfferAt=null;
    }
    if(this.pathOfferPending&&this.actor.mode==='autonomous'&&!this.actor.climbTarget&&(!this.actor.routePriority||!this.actor.route.length)&&!this.actor.intention.includes('hide')&&this.visible.some(Boolean)){
      this.pathOfferPending=false;this.autoOfferAt=this.time+2;
    }
    if(this.autoOfferAt!==null&&this.time>=this.autoOfferAt){if(this.visible.some(Boolean))this.actor.requestGuidance(this.time,this.actor.compliance);this.autoOfferAt=null;}
    this.actor.step(dt,this.time+dt,this.rng);this.physics.syncPerson(this.actor);
    this.observe();this.mission(); // refresh observations for changed waypoints
    this.observations.forEach((o,i)=>{for(let k=0;k<3;k++)o[k]=(this.continuousGuidance&&this.modules.trajectories[i]?.kind!=='hold'?this.modules.trajectories[i]?.target?.[k]??this.goals[i][k]:this.goals[i][k])-this.physics.drones[i].body.position[['x','y','z'][k]]+this.rng.normal()*this.config.sensor_noise;});
    const acc=this.policy();
    // Consider every delayed peer report, not only the nearest neighbor. Two
    // routes can merge while a third aircraft is the nearest reported peer.
    this.physics.drones.forEach((d,i)=>{
      for(let j=0;j<3;j++)if(i!==j){
        const delta=sub(arr(d.body.position),this.radio[j]),away=[delta[0],delta[1],0],dist=norm(away);
        // Resolve merging routes laterally. An upward avoidance command in an
        // indoor room could trade a peer collision for a ceiling collision.
        if(dist<2.4&&Math.abs(delta[2])<1.1){const direction=dist>.01?unit(away):[i<j?-1:1,0,0],closing=-dot(arr(d.body.velocity),direction);
          const minimum=2.5*(1.8-dist)+2.4*Math.max(0,closing),current=dot(acc[i],direction);
          if(current<minimum)acc[i]=add(acc[i],scale(direction,minimum-current));
        }
      }
      acc[i]=acc[i].map(x=>clamp(x,-4,4));
    });
    // A physical clearance supervisor changes only drone acceleration.
    this.physics.drones.forEach((d,i)=>{const p=arr(d.body.position),nearest=add(this.actor.position,[0,0,clamp(p[2]-this.actor.position[2],.28,this.actor.height-.28)]),away=sub(p,nearest),dist=norm(away);if(dist<1.8){const direction=unit(away),relative=dot(sub(arr(d.body.velocity),this.actor.velocity),direction),minimum=Math.max(0,3*(1.6-dist)-2*relative),current=dot(acc[i],direction);if(current<minimum)acc[i]=add(acc[i],scale(direction,minimum-current)).map(x=>clamp(x,-4,4));}});
    // Continuous city guidance can merge aircraft routes near facades. Apply a
    // final known-map clearance constraint after peer avoidance, so separating
    // from another drone cannot override braking at a wall. Only forces change.
    if(this.continuousGuidance)this.physics.drones.forEach((d,i)=>{
      const p=arr(d.body.position),v=arr(d.body.velocity);
      for(const o of this.obstacles){
        if(o.solid===false)continue;
        const h=o.kind==='box'?o.size[2]:o.size[1];
        if(3.8-.35>o.position[2]+h/2||p[2]+.35<o.position[2]-h/2)continue;
        let away=[p[0]-o.position[0],p[1]-o.position[1],0],clearance;
        if(o.kind==='box'){away=[p[0]-clamp(p[0],o.position[0]-o.size[0]/2,o.position[0]+o.size[0]/2),p[1]-clamp(p[1],o.position[1]-o.size[1]/2,o.position[1]+o.size[1]/2),0];clearance=norm(away);}
        else clearance=norm(away)-o.size[0];
        if(clearance<1.8&&norm(away)>.001){const direction=unit(away),minimum=4*(.9-clearance)-3*dot(v,direction),current=dot(acc[i],direction);if(current<minimum)acc[i]=add(acc[i],scale(direction,minimum-current));}
      }
      acc[i]=acc[i].map(x=>clamp(x,-4,4));
    });
    this.gust=this.gust.map(x=>x-.7*x*dt+this.rng.normal()*this.config.wind*.16*Math.sqrt(dt));this.wind=add(this.windBase,this.gust);
    for(let n=0;n<8;n++){this.physics.step(acc,this.wind);if(this.physics.world.stepnumber%12===0)this.modules.tick(this);if(this.physics.drones.some(d=>d.hit))break;}
    this.steps++;this.time=this.physics.world.time;this.lastAction=acc.map(a=>scale(a,.25));
    const positions=this.positions();this.history.push(positions);this.history.shift();for(let i=0;i<3;i++){if(this.rng.random()>=this.config.radio_loss){this.radio[i]=[...this.history[0][i]];this.radioTimes[i]=Math.max(0,this.time-this.config.radio_delay/30);}else this.radioDrops++;}
    const contact=this.physics.drones.some(d=>d.hit),out=positions.some(p=>Math.abs(p[0])>22||Math.abs(p[1])>22||p[2]<0||p[2]>12),unstable=this.physics.drones.some(d=>![...arr(d.body.position),...arr(d.body.velocity),...d.body.quaternion.toArray()].every(Number.isFinite)),battery=this.physics.drones.some(d=>d.battery<=0);
    this.reason=contact?'contact':unstable?'unstable':out?'bounds':battery?'battery':this.steps>=this.config.seconds*30?'time_limit':'flying';this.finished=this.reason!=='flying';if(this.finished)this.running=false;
    if(!contact&&!unstable)this.model.update(before,this.lastAction,this.physics.dynamicsState());this.observe();return true;
  }
  stepExternal(reply) {
    if(this.config.controller!=='python'||this.finished||(!this.running&&!this.externalStepPending))return false;
    if(reply.version!==this.version||Math.abs(reply.time-this.time)>1e-6||reply.control_revision!==this.controlRevision){this.diagnostics.rejected++;return false;}
    try{validateControlReply(reply,this);}catch(error){this.diagnostics.rejected++;throw error;}
    const before=this.physics.dynamicsState(),dt=.05;
    this.externalStepPending=false;this.goals=reply.goals.map(g=>[...g]);this.externalControl={...reply,connected:true};
    this.tactics=reply.tactics;this.exitRoute=reply.exit_route;this.guidanceStatus=reply.tactics.reason;
    this.droneRoles=reply.tactics.orders.map(o=>o.role);
    if(reply.offer_guidance&&this.actor.mode==='autonomous')this.actor.requestGuidance(this.time,this.actor.compliance);
    this.actor.step(dt,this.time+dt,this.rng);this.physics.syncPerson(this.actor);
    this.gust=this.gust.map(x=>x-.7*x*dt+this.rng.normal()*this.config.wind*.16*Math.sqrt(dt));this.wind=add(this.windBase,this.gust);
    for(let n=0;n<12;n++){this.physics.step(reply.accelerations,this.wind,1/240,{rotor_residuals:reply.inner_loop.rotor_residuals});if(this.physics.drones.some(d=>d.hit))break;}
    this.diagnostics.accepted++;
    this.positions().forEach((p,i)=>{const expected=evaluateTrajectory(reply.trajectories[i],.05).position;this.diagnostics.tracking_sum_sq+=distance(p,expected)**2;this.diagnostics.tracking_count++;});
    this.diagnostics.tracking_rms_m=Math.sqrt(this.diagnostics.tracking_sum_sq/Math.max(1,this.diagnostics.tracking_count));
    const points=this.positions(),gap=Math.min(distance(points[0],points[1]),distance(points[0],points[2]),distance(points[1],points[2]));this.diagnostics.min_pair_distance=Math.min(this.diagnostics.min_pair_distance??Infinity,gap);
    this.steps++;this.time=this.physics.world.time;this.lastAction=reply.accelerations.map(a=>scale(a,.25));
    const positions=this.positions();this.history.push(positions);this.history.shift();
    for(let i=0;i<3;i++){if(this.rng.random()>=this.config.radio_loss){this.radio[i]=[...this.history[0][i]];this.radioTimes[i]=Math.max(0,this.time-this.config.radio_delay*.05);}else this.radioDrops++;}
    const contact=this.physics.drones.some(d=>d.hit),out=positions.some(p=>p.some(x=>!Number.isFinite(x))||Math.abs(p[0])>22||Math.abs(p[1])>22||p[2]<0||p[2]>12);
    this.reason=contact?'contact':out?'bounds':this.time>=this.config.seconds?'time_limit':'flying';this.finished=this.reason!=='flying';if(this.finished)this.running=false;
    if(!contact&&!out)this.model.update(before,this.lastAction,this.physics.dynamicsState());this.observe();return true;
  }
  moduleSnapshot(){
    if(!this.externalControl)return this.modules.snapshot(this);
    const m=structuredClone(this.externalControl.modules),positions=this.positions(),master=positions[0];
    m.master_absolute=master;m.time=this.time;
    m.slaves_relative=[1,2].map(i=>({drone:i,position:sub(this.radio[i],master),source:'delayed radio',frame:'world axes relative to master',age:Math.max(0,this.time-this.radioTimes[i])}));
    m.drones.forEach((d,i)=>{d.position=positions[i];d.velocity=arr(this.physics.drones[i].body.velocity);d.rotors=[...this.physics.drones[i].forces];d.planner_command=d.command;d.command=[...this.physics.drones[i].motorCommand];});return m;
  }
  command(c) {
    const name=c.command;
    if(name==='reset'){const proposed={...this.config,...Object.fromEntries(['scene','seed','wind','drones'].filter(k=>k in c).map(k=>[k,c[k]]))};this.validate(proposed);this.config=proposed;this.reset();}
    else if(name==='pause')this.running=false;
    else if(name==='play'){if(this.finished)this.reset();this.running=true;}
    else if(name==='step'){this.running=false;if(this.config.controller==='python')this.externalStepPending=true;else this.step();}
    else if(name==='speed'){if(this.config.controller==='python'&&c.value!==1)throw Error('Python feedback uses fixed 50 ms steps');if(![.25,.5,1,2].includes(c.value))throw Error('Unsupported playback speed');this.speed=c.value;}
    else if(name==='actor'){this.actor.command(c.action,c.value);if(c.action!=='input')this.actor.event(this.time,'Operator selected '+c.action+'.');if(['manual','autonomous','hide','climb'].includes(c.action)){this.autoOfferAt=null;this.pathOfferPending=false;this.cityOfferAt=this.time+6;if(this.continuousGuidance){this.mode='guidance';this.replanAt=0;}else this.hold();}this.physics.syncPerson(this.actor);}
    else if(name==='actor_path'){
      if(this.finished)throw Error('Reset the ended episode before drawing a new route');
      const compliance=c.compliance??this.actor.compliance;if(!Number.isFinite(compliance)||compliance<0||compliance>1)throw Error('Response probability must be in [0, 1]');
      this.actor.setDrawnRoute(c.points,{endAction:c.endAction,pace:c.pace,allowGuidance:c.allowGuidance});
      this.actor.compliance=compliance;
      this.actor.event(this.time,'Operator drew a route; endpoint action: '+this.actor.endpointAction+'.');
      this.autoOfferAt=null;this.pathOfferPending=true;this.cityOfferAt=this.time+6;this.mode='guidance';this.replanAt=0;this.running=true;this.routeBlocked=[false,false,false];
      this.physics.syncPerson(this.actor);
    }
    else if(name==='guidance'){this.actor.routePriority=false;this.actor.requestGuidance(this.time,c.compliance??.85);this.autoOfferAt=null;this.pathOfferPending=false;this.mode='guidance';this.replanAt=0;}
    else if(name==='formation'){this.autoOfferAt=null;this.mode='formation';}
    else if(name==='hold'){this.autoOfferAt=null;this.hold();}
    else if(name==='goal'){
      const p=vector(c.position);if(p[2]<1||p[2]>6)throw Error('Altitude must be between 1 and 6 m');
      const nav=new Navigator(this.obstacles,.65,p[2],.35),goals=[-1.7,0,1.7].map(x=>[p[0]+x,p[1],p[2]]),positions=this.positions(),routes=goals.map((g,i)=>nav.path(positions[i],g));
      if(routes.some(r=>!r.length))throw Error('Choose a reachable, clear formation destination');
      this.autoOfferAt=null;this.mode='waypoint';this.commandAltitude=p[2];this.routes=routes;this.mission();
    } else if(name==='destination'||name==='person'){
      let p=vector(c.position);p[2]=0;
      if(name==='destination'&&this.continuousGuidance){
        if(p.slice(0,2).some(x=>Math.abs(x)>14))throw Error('Choose a bridge inside the block');
        const bridge=this.obstacles.filter(o=>o.semantic==='bridge').sort((a,b)=>distance(a.position.slice(0,2),p.slice(0,2))-distance(b.position.slice(0,2),p.slice(0,2)))[0];
        p=[...bridge.position];this.destinationLabel=`${p[1]<0?'South':'North'}-${p[0]<0?'west':'east'} bridge`;
      }
      const nav=new Navigator(this.obstacles,.42,.9,.9,true);if(!nav.clear(p))throw Error('Choose clear ground inside the site');p[2]=nav.surfaceHeight(p);
      if(name==='destination'){this.actor.destination=p;if(this.actor.intention==='leave via destination')this.actor.setGoal(p);this.replanAt=0;}
      else{if(this.positions().some(q=>distance(q,add(p,[0,0,.9]))<1.2))throw Error('Place the person clear of aircraft');this.actor.position=p;this.actor.velocity=[0,0,0];this.actor.jumpVelocity=0;this.actor.climbTarget=null;this.actor.support='ground';this.actor.navigator.z=this.actor.height/2;this.actor.setGoal(this.actor.goal);this.physics.syncPerson(this.actor);}
    } else throw Error('Unknown command');
    this.controlRevision++;this.observe();this.interventions.push({time:this.time,...structuredClone(c)});if(this.interventions.length>30)this.interventions.shift();
  }
  snapshot({predictions=true}={}) {
    const positions=this.positions();let separation=Infinity;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)separation=Math.min(separation,distance(positions[i],positions[j]));
    return {control_revision:this.controlRevision,diagnostics:{...this.diagnostics},reference_origin:[...this.referenceOrigin],observed_map:this.observedMap.snapshot(this.time),controller:this.config.controller,external_control:this.externalControl?{connected:true,sequence:this.externalControl.sequence,processing_ms:this.externalControl.processing_ms,round_trip_ms:this.externalControl.round_trip_ms,loop_interval_ms:this.externalControl.loop_interval_ms}:null,step_pending:this.externalStepPending,config:{...this.config},seed:this.config.seed,version:this.version,time:this.time,running:this.running,finished:this.finished,reason:this.reason,mode:this.mode,speed:this.speed,real_time_factor:this.config.controller==='python'?Math.min(1,50/(this.externalControl?.loop_interval_ms||50)):this.speed,obstacles:this.obstacles,destination:[...this.actor.destination],destination_label:this.destinationLabel,continuous_guidance:this.continuousGuidance,wind:[...this.wind],person:{...this.actor.snapshot(),observed_by:this.visible.flatMap((v,i)=>v?[i+1]:[])},perception:{visible:[...this.visible],last_seen:structuredClone(this.lastSeen)},drones:this.physics.drones.map((d,i)=>({id:i,role:this.droneRoles[i],position:positions[i],quaternion:[d.body.quaternion.w,d.body.quaternion.x,d.body.quaternion.y,d.body.quaternion.z],velocity:arr(d.body.velocity),angular_velocity:arr(d.body.vectorToLocalFrame(d.body.angularVelocity)),angular_velocity_frame:'body',motors:[...d.forces],motor_speeds:[...d.motorSpeed],battery:d.battery,mass:d.mass,hit:d.hit,goal:[...this.goals[i]],ranges:[...this.ranges[i]]})),metrics:{formation_error:positions.reduce((s,p,i)=>s+distance(p,this.goals[i]),0)/3,min_separation:separation,collisions:this.physics.drones.filter(d=>d.hit).length,energy_wh:this.physics.drones.reduce((s,d)=>s+d.energy,0),radio_drops:this.radioDrops},world_model:this.model.metrics(),...(predictions?this.model.rollout(positions,this.physics.dynamicsState(),this.lastAction):{predictions:[],uncertainty:[]}),interventions:structuredClone(this.interventions),runtime:this.spec.runtime,exit_route:this.exitRoute.map(p=>[...p]),guidance_status:this.guidanceStatus,drone_modules:this.moduleSnapshot(),tactics:this.continuousGuidance?structuredClone(this.tactics):null};
  }
  graph(){return graph(this.spec,this.snapshot({predictions:false}));}
}
