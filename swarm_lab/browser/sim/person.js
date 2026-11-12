import {Navigator} from './navigation.js';
import {distance,norm,scale,sub,vector,clamp} from './math.js';

// Independent kinematic actor: no aircraft position enters a behavior decision.
export class Person {
  constructor(obstacles,spec) {
    this.spec=spec;this.navigator=new Navigator(obstacles,.42,.9,.9,true);
    Object.assign(this,{position:[0,1,0],velocity:[0,0,0],heading:0,mode:'autonomous',movement:'walk',posture:'standing',height:spec.standing_height,manual_input:[0,0],jumpVelocity:0,climbTarget:null,crouchOnArrival:false,support:'ground',intention:'inspect site',status:'walking independently',compliance:.85,guidance:false,decisionAt:null,refused:false,destination:[11,1,0],route:[],events:[]});
    this.inspectionGoal=this.navigator.nearestClear([8,-2]);this.setGoal(this.inspectionGoal);
    this.drawnPath=[];this.endpointAction='wait';this.routePriority=false;this.patrolPoints=[];this.patrolIndex=0;this.patrolAt=0;this.hideTarget=null;
  }
  event(t,text) { this.events.push({time:t,text});if(this.events.length>30)this.events.shift(); }
  setGoal(p) { this.goal=[p[0],p[1],0];this.route=this.navigator.path(this.position,p);this.status=this.route.length?'walking independently':'route unavailable'; }
  setDrawnRoute(points,{endAction='wait',pace='walk',allowGuidance=false}={}) {
    if(!Array.isArray(points)||points.length<1||points.length>256)throw Error('Draw a route with 1 to 256 points');
    if(!['wait','hide','jump','climb'].includes(endAction)||!['walk','run'].includes(pace))throw Error('Invalid route action');
    const raw=points.map(p=>vector(p,2)),samples=raw.filter((p,i)=>{
      if(i===0||i===raw.length-1)return true;
      const a=sub(p,raw[i-1]),b=sub(raw[i+1],p);
      return Math.abs(a[0]*b[1]-a[1]*b[0])>.02*norm(a)*norm(b)||a[0]*b[0]+a[1]*b[1]<=0;
    });
    const nav=new Navigator(this.navigator.obstacles,.42,this.height/2,this.height/2,true);
    const endpoint=samples.at(-1);if(!nav.clear(endpoint))throw Error('End the path on a street, bridge or stair, outside buildings and canals');
    let from=this.position.slice(0,2),route=[];
    for(const p of samples){if(!nav.clear(p))continue;if(distance(from,p)<.15)continue;const leg=nav.path(from,p);if(!leg.length)throw Error('That part of the route is unreachable; use an alley, bridge or stairs');route.push(...leg);from=p;}
    if(!route.length)throw Error('Drag farther to draw a movement path');
    // Commit only after the whole request has validated.
    this.route=route;this.drawnPath=route.map(p=>[...p]);this.goal=[...endpoint,nav.surfaceHeight(endpoint)];this.hideTarget=null;
    this.mode='autonomous';this.intention='follow drawn route';this.status='following your drawn route';this.endpointAction=endAction;this.routePriority=!allowGuidance;
    this.movement=pace;this.posture='standing';this.height=this.spec.standing_height;this.crouchOnArrival=false;this.guidance=false;this.refused=false;this.decisionAt=null;this.climbTarget=null;this.manual_input=[0,0];
  }
  requestGuidance(t,probability=.85) {
    if(!Number.isFinite(probability)||probability<0||probability>1)throw Error('Response probability must be in [0, 1]');
    this.compliance=probability;this.mode='autonomous';this.guidance=true;this.refused=false;this.decisionAt=t+.5;
    this.event(t,'Route guidance offered; awaiting independent response.');
  }
  command(action,value) {
    if(action==='input'){const p=vector(value,2);this.manual_input=scale(p,1/Math.max(1,norm(p)));}
    else if(action==='manual'||action==='autonomous') {
      this.mode=action;this.guidance=false;this.decisionAt=null;this.manual_input=[0,0];this.climbTarget=null;this.crouchOnArrival=false;this.routePriority=false;this.drawnPath=[];
      this.intention=action==='manual'?'operator controlled':'inspect site';
      if(action==='autonomous')this.setGoal(this.inspectionGoal);else this.status='operator control';
    } else if(action==='walk'||action==='run')this.movement=action;
    else if(action==='crouch') {
      const h=this.posture==='crouching'?this.spec.standing_height:this.spec.crouch_height;
      const clearance=new Navigator(this.navigator.obstacles,.28,this.position[2]+h/2,h/2);
      if(!clearance.clear(this.position))throw Error('Not enough headroom to change posture');
      this.posture=h===this.spec.standing_height?'standing':'crouching';this.height=h;
    } else if(action==='jump') {
      if(Math.abs(this.jumpVelocity)<.01&&!this.climbTarget){this.jumpVelocity=this.spec.jump_speed;this.movement='jump';}
    } else if(action==='climb') {
      const choices=this.navigator.obstacles.filter(o=>o.climbable&&o.position[2]+o.size[2]/2<=1.1).sort((a,b)=>distance(a.position,this.position)-distance(b.position,this.position));
      const o=choices.find(o=>Math.hypot(...[0,1].map(i=>Math.max(0,Math.abs(this.position[i]-o.position[i])-o.size[i]/2)))<1);
      if(!o)throw Error('Move within 1 m of a marked low table or crate to climb');
      // Rise beside the table before crossing its edge, then land on its top.
      const top=o.position[2]+o.size[2]/2;
      this.climbTarget={stages:[[this.position[0],this.position[1],top+.04],[o.position[0],o.position[1],top+.04],[o.position[0],o.position[1],top]],label:o.label};
      this.mode='manual';this.manual_input=[0,0];this.guidance=false;this.decisionAt=null;this.status='climbing low surface';
    } else if(action==='hide') {
      // H is relative to the next target of an assigned path, rather than
      // discarding that path and searching around the actor's current position.
      const reference=this.drawnPath.length?(this.route[0]||this.drawnPath.at(-1)):this.position.slice(0,2);
      const choices=[];
      for(const o of this.navigator.obstacles)if(o.cover&&!o.ceiling){const extent=o.kind==='box'?o.size.slice(0,2).map(x=>x/2):[o.size[0],o.size[0]];for(const axis of [[1,0],[-1,0],[0,1],[0,-1]]){const p=axis.map((v,i)=>o.position[i]+v*(extent[i]+.65));if(this.navigator.clear(p))choices.push({point:p,label:o.label});}}
      choices.sort((a,b)=>distance(a.point,reference)-distance(b.point,reference));
      const prefix=distance(this.position.slice(0,2),reference)<.08?[]:this.navigator.path(this.position,reference);
      if(!prefix.length&&distance(this.position.slice(0,2),reference)>=.08)throw Error('The selected route target is unreachable');
      let choice=null,tail=[];
      for(const candidate of choices){const path=this.navigator.path(reference,candidate.point);if(path.length){choice=candidate;tail=path;break;}}
      if(!choice)throw Error('No reachable cover near this route target');
      this.route=[...prefix,...tail];this.goal=[...choice.point,this.navigator.surfaceHeight(choice.point)];
      this.hideTarget={reference:[...reference],position:[...this.goal],object:choice.label};
      this.mode='autonomous';this.intention='seek cover';this.guidance=false;this.decisionAt=null;this.endpointAction='wait';this.routePriority=true;this.crouchOnArrival=true;this.status=this.drawnPath.length?'following route to nearby cover':'moving to cover';
    } else throw Error('Unknown person action');
  }
  step(dt,t,rng) {
    if(this.climbTarget) {
      const target=this.climbTarget.stages[0],delta=sub(target,this.position),d=norm(delta);
      this.velocity=scale(delta,.65/Math.max(d,1e-9));this.position=this.position.map((x,i)=>x+delta[i]*Math.min(1,.65*dt/Math.max(d,1e-9)));
      if(d<.03){this.position=[...target];this.climbTarget.stages.shift();if(!this.climbTarget.stages.length){this.support=this.climbTarget.label;this.climbTarget=null;this.velocity=[0,0,0];this.status='standing on surface';}}
      return;
    }
    let floor=this.navigator.surfaceHeight(this.position);this.support=floor?'stairs / terrace':'ground';
    for(const o of this.navigator.obstacles)if(o.climbable){const top=o.position[2]+o.size[2]/2;const edgeDistance=Math.hypot(...[0,1].map(i=>Math.max(0,Math.abs(this.position[i]-o.position[i])-o.size[i]/2)));if(edgeDistance<this.navigator.radius&&this.position[2]>=top-.04){floor=Math.max(floor,top);this.support=o.label;}}
    if(this.jumpVelocity>0||this.position[2]>floor+.001){this.jumpVelocity-=9.81*dt;this.position[2]+=this.jumpVelocity*dt;if(this.position[2]<=floor){this.position[2]=floor;this.jumpVelocity=0;this.movement='walk';if(this.mode==='manual')this.status=floor?'standing on surface':'operator control';}}
    this.velocity[2]=this.jumpVelocity;this.navigator.z=this.position[2]+this.height/2;this.navigator.halfHeight=this.height/2;this.navigator.grounded=Math.abs(this.jumpVelocity)<.01&&this.position[2]<=this.navigator.surfaceHeight(this.position)+.04;
    if(this.decisionAt!==null&&t>=this.decisionAt){this.decisionAt=null;if(rng.random()<this.compliance){this.intention='leave via destination';this.routePriority=false;this.crouchOnArrival=false;this.posture='standing';this.height=this.spec.standing_height;this.navigator.halfHeight=this.height/2;this.navigator.z=this.position[2]+this.height/2;this.setGoal(this.destination);this.status=this.route.length?'following route voluntarily':'route unavailable';this.event(t,'Person chooses to follow the indicated route.');}else{this.refused=true;this.status='guidance ignored · operator alert';this.event(t,this.continuousGuidance?'Person ignores guidance. Drones continue indicating the bridge route.':'Person ignores guidance. Operator attention required; drones hold position.');}}
    const speed=(this.movement==='run'?this.spec.max_run_speed:this.spec.max_walk_speed)*(this.posture==='crouching'?.45:1);
    let desired;
    if(this.mode==='manual')desired=scale(this.manual_input,speed);
    else {if(!this.route.length){this.velocity[0]=this.velocity[1]=0;if(this.intention==='inspect site'&&this.patrolPoints.length&&t>=this.patrolAt){this.setGoal(this.patrolPoints[this.patrolIndex++%this.patrolPoints.length]);this.patrolAt=t+1;}return;}const delta=sub(this.route[0],this.position.slice(0,2)),d=norm(delta);desired=scale(delta,Math.min(speed,Math.sqrt(2*1.8*Math.max(0,d-.04)),d/dt)/Math.max(d,1e-9));}
    const dv=sub(desired,this.velocity.slice(0,2)),factor=Math.min(1,1.8*dt/Math.max(norm(dv),1e-9));
    for(let i=0;i<2;i++)this.velocity[i]+=dv[i]*factor;
    const candidate=this.position.slice(0,2).map((x,i)=>x+this.velocity[i]*dt);
    if(this.navigator.segmentClear(this.position,candidate)){this.position[0]=candidate[0];this.position[1]=candidate[1];if(this.navigator.grounded){this.position[2]=this.navigator.surfaceHeight(candidate);this.support=this.position[2]?'stairs / terrace':'ground';}if(norm(this.velocity.slice(0,2))>.05)this.heading=Math.atan2(this.velocity[1],this.velocity[0]);}
    else {this.velocity[0]=this.velocity[1]=0;if(this.mode!=='manual'&&this.route.length){const leg=this.navigator.path(this.position,this.route[0]);if(leg.length)this.route=[...leg,...this.route.slice(1)];}}
    if(this.mode!=='manual'&&this.route.length&&distance(this.position.slice(0,2),this.route[0])<.08){this.route.shift();this.velocity[0]=this.velocity[1]=0;if(!this.route.length){this.status=this.intention==='leave via destination'?'at destination':this.intention==='seek cover'?'at cover':this.intention==='follow drawn route'?'at path endpoint':'inspecting site';if(this.crouchOnArrival){this.posture='crouching';this.height=this.spec.crouch_height;this.crouchOnArrival=false;}this.event(t,this.intention==='leave via destination'?'Person reached the chosen exit.':this.intention==='seek cover'?'Person reached cover.':this.intention==='follow drawn route'?'Person reached the drawn path endpoint.':'Person reached a patrol waypoint; continuing independent exploration.');
      if(this.intention==='follow drawn route'){
        const action=this.endpointAction;this.endpointAction='wait';
        if(action==='hide'){this.posture='crouching';this.height=this.spec.crouch_height;this.intention='hide at endpoint';this.status='hiding at path endpoint';this.guidance=false;this.decisionAt=null;this.event(t,'Crouching at your endpoint; actual cover depends on sensor rays.');}
        else if(action==='climb'){try{this.command('climb');}catch(e){this.status='climb unavailable at endpoint';this.event(t,e.message);}}
        else if(action==='jump')this.command('jump');
      }
    }}
  }
  snapshot() {return {position:[...this.position],velocity:[...this.velocity],heading:this.heading,mode:this.mode,movement:this.movement,posture:this.posture,height:this.height,radius:.28,intention:this.intention,status:this.status,support:this.support,guidance:this.guidance,refused:this.refused,compliance:this.compliance,goal:[...this.goal],route:this.route.map(p=>[...p]),drawn_path:this.drawnPath,endpoint_action:this.endpointAction,hide_target:this.hideTarget?structuredClone(this.hideTarget):null,route_priority:this.routePriority,events:this.events.slice(-8),manual_input:[...this.manual_input],vertical_velocity:this.jumpVelocity};}
}
