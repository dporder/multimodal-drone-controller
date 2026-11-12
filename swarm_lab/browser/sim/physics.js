import * as C from '../vendor/cannon-es.js';
import {NeuralNetwork,neuralnetwork_rotor_master,neuralnetwork_rotor_slave1,neuralnetwork_rotor_slave2} from './neural.js';
import {clamp,unit,cross,dot,scale,norm,sub} from './math.js';
export {C};
export const ROTORS=[[.19,.19,0],[-.19,.19,0],[-.19,-.19,0],[.19,-.19,0]],SPINS=[1,-1,1,-1];
export const vec=a=>new C.Vec3(...a);
export const arr=v=>[v.x,v.y,v.z];

export class Physics {
  constructor(obstacles,rng,randomize=true,neuralControl=false) {
    this.neuralControl=neuralControl;
    this.world=new C.World({gravity:new C.Vec3(0,0,-9.81),allowSleep:false});
    this.world.broadphase=new C.SAPBroadphase(this.world);this.world.solver.iterations=20;
    this.world.defaultContactMaterial.friction=.7;this.world.defaultContactMaterial.restitution=0;
    this.world.quatNormalizeSkip=0;this.world.quatNormalizeFast=false;
    const ground=new C.Body({mass:0,collisionFilterGroup:1});ground.addShape(new C.Plane());this.world.addBody(ground);
    this.staticBodies=[ground];
    for(const [obstacleIndex,o] of obstacles.entries()){if(o.solid===false)continue;const body=new C.Body({mass:0,position:vec(o.position),collisionFilterGroup:1});if(o.kind==='box')body.addShape(new C.Box(vec(o.size.map(x=>x/2))));else{const q=new C.Quaternion();q.setFromEuler(Math.PI/2,0,0);body.addShape(new C.Cylinder(o.size[0],o.size[0],o.size[1],24),new C.Vec3(),q);}body.obstacleIndex=obstacleIndex;this.world.addBody(body);this.staticBodies.push(body);}
    this.person=new C.Body({type:C.Body.KINEMATIC,collisionFilterGroup:2});this.world.addBody(this.person);this.personHeight=0;
    this.drones=Array.from({length:3},(_,i)=>{
      const mass=1.2*(randomize?rng.uniform(.9,1.1):1),body=new C.Body({mass,position:new C.Vec3((i-1)*1.7,-3,3.2),linearDamping:0,angularDamping:0,collisionFilterGroup:4});
      body.addShape(new C.Box(new C.Vec3(.14,.11,.06)));
      for(const p of ROTORS){body.addShape(new C.Sphere(.095),vec(p));const q=new C.Quaternion();q.setFromEuler(0,0,Math.atan2(p[1],p[0]));body.addShape(new C.Box(new C.Vec3(Math.hypot(p[0],p[1])/2,.025,.025)),vec(p.map(x=>x/2)),q);}
      const inertiaScale=(randomize?rng.uniform(.9,1.1):1)*mass/1.2;body.inertia.set(.018*inertiaScale,.018*inertiaScale,.032*inertiaScale);body.invInertia.set(1/body.inertia.x,1/body.inertia.y,1/body.inertia.z);body.updateInertiaWorld(true);
      this.world.addBody(body);
      const d={body,mass,rotorNetwork:new NeuralNetwork(8,4,470+i),id:i,motorTau:ROTORS.map(()=>.035*(randomize?rng.uniform(.8,1.2):1)),drag:.12*(randomize?rng.uniform(.8,1.2):1),battery:randomize?rng.uniform(.9,1):1,motorSpeed:Array(4).fill(Math.sqrt(mass*9.81/4/1.1e-5)),forces:Array(4).fill(mass*9.81/4),energy:0,hit:false};
      body.addEventListener('collide',()=>{d.hit=true;});return d;
    });
  }
  syncPerson(actor) {
    if(this.personHeight!==actor.height){while(this.person.shapes.length)this.person.removeShape(this.person.shapes[0]);const half=actor.height/2-.28,q=new C.Quaternion();q.setFromEuler(Math.PI/2,0,0);this.person.addShape(new C.Cylinder(.28,.28,half*2,16),new C.Vec3(0,0,actor.height/2),q);for(const z of [.28,actor.height-.28])this.person.addShape(new C.Sphere(.28),new C.Vec3(0,0,z));this.personHeight=actor.height;}
    this.person.position.copy(vec(actor.position));this.person.velocity.set(0,0,0);this.person.aabbNeedsUpdate=true;
  }
  rotation(body) {return [[1,0,0],[0,1,0],[0,0,1]].map(a=>arr(body.quaternion.vmult(vec(a))));}
  motors(d,acc,dt,residual=null) {
    const b=d.body,R=this.rotation(b),force=scale([acc[0],acc[1],acc[2]+9.81],1.2),z=unit(force),y=unit(cross(z,[1,0,0])),desired=[cross(y,z),y,z];
    // Geometric attitude error in body coordinates: vee(Rd^T R - R^T Rd)/2.
    const e=[(dot(desired[2],R[1])-dot(R[2],desired[1]))/2,(dot(desired[0],R[2])-dot(R[0],desired[2]))/2,(dot(desired[1],R[0])-dot(R[1],desired[0]))/2];
    const omega=arr(b.vectorToLocalFrame(b.angularVelocity)),torque=e.map((v,i)=>-[.65,.65,.35][i]*v-[.14,.14,.12][i]*omega[i]);
    const thrust=Math.max(0,dot(force,R[2])),voltage=.85+.15*d.battery;
    const teacher=ROTORS.map(([x,y],k)=>clamp((thrust/4+y*torque[0]/(4*.19**2)-x*torque[1]/(4*.19**2)+SPINS[k]*torque[2]/(4*.018))/voltage**2,0,7));
    const input=[thrust/28,torque[0]/.3,torque[1]/.3,torque[2]/.1,...omega.map(x=>x/5),d.battery];
    if(residual){d.motorCommand=teacher.map((v,k)=>clamp(v+residual[k],0,7));}
    else{const output=[neuralnetwork_rotor_master,neuralnetwork_rotor_slave1,neuralnetwork_rotor_slave2][d.id](d.rotorNetwork,input,teacher,this.world.stepnumber%12===0);
      d.motorCommand=this.neuralControl?output.applied:teacher;d.neuralPrediction=output.prediction;d.neuralBlend=this.neuralControl?output.blend:0;}
    for(let k=0;k<4;k++){const speed=Math.sqrt(d.motorCommand[k]/1.1e-5);d.motorSpeed[k]+=(speed-d.motorSpeed[k])*(1-Math.exp(-dt/d.motorTau[k]));d.forces[k]=1.1e-5*d.motorSpeed[k]**2*voltage**2;}

  }
  applyRotors(d) {
    for(let k=0;k<4;k++){d.body.applyLocalForce(new C.Vec3(0,0,d.forces[k]),vec(ROTORS[k]));d.body.applyTorque(d.body.vectorToWorldFrame(new C.Vec3(0,0,SPINS[k]*.018*d.forces[k])));}
  }
  step(accelerations,wind,dt=1/240,commands=null) {
    for(let i=0;i<3;i++){const d=this.drones[i],b=d.body;if(commands?.rotor_residuals){this.motors(d,accelerations[i],dt,commands.rotor_residuals[i]);}else if(commands){d.motorCommand=[...commands[i]];const voltage=.85+.15*d.battery;for(let k=0;k<4;k++){const speed=Math.sqrt(d.motorCommand[k]/1.1e-5);d.motorSpeed[k]+=(speed-d.motorSpeed[k])*(1-Math.exp(-dt/d.motorTau[k]));d.forces[k]=1.1e-5*d.motorSpeed[k]**2*voltage**2;}}else this.motors(d,accelerations[i],dt);this.applyRotors(d);const relative=sub(arr(b.velocity),wind);b.applyForce(vec(scale(relative,-d.drag*norm(relative))));b.applyTorque(b.angularVelocity.scale(-.015));
      for(let j=0;j<3;j++)if(i!==j){const above=this.drones[j],p=sub(arr(above.body.position),arr(b.position));if(p[2]>.25&&p[2]<4)b.force.z-=.12*above.forces.reduce((a,b)=>a+b,0)*Math.exp(-(p[0]**2+p[1]**2)/.45)/(1+p[2]**2);}
      const energy=(10+10*d.forces.reduce((sum,f)=>sum+f**1.5,0))*dt/3600;d.energy+=energy;d.battery=Math.max(0,d.battery-energy/45);
    }
    this.world.step(dt);
  }
  ray(from,to,includePerson=false) {
    const result=new C.RaycastResult();this.world.raycastClosest(vec(from),vec(to),{collisionFilterMask:includePerson?3:1,skipBackfaces:true},result);
    return result.hasHit?{distance:result.distance,person:result.body===this.person,obstacle:result.body.obstacleIndex,point:arr(result.hitPointWorld)}:null;
  }
  dynamicsState() {return this.drones.map(d=>[...arr(d.body.velocity),...this.rotation(d.body)[2],...arr(d.body.vectorToLocalFrame(d.body.angularVelocity)),...d.forces]);}
}
