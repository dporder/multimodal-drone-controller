import * as THREE from 'three';
import {OrbitControls} from '../../web/vendor/OrbitControls.js';
import {DRONE_COLORS,evaluateCurve} from './team.js';
import {TARGETS} from './config.js';

const vec=p=>new THREE.Vector3(...p);
function setPoints(object,points){object.geometry.dispose();object.geometry=new THREE.BufferGeometry().setFromPoints(points.map(vec));}
function line(color,segments=false,opacity=1){return new (segments?THREE.LineSegments:THREE.Line)(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color,transparent:true,opacity}));}
export function conePoints(pose,length=2.7){
 const p=vec(pose.position),f=vec(pose.direction).normalize(),right=f.clone().cross(vec(pose.up)).normalize(),up=right.clone().cross(f),h=Math.tan(pose.fov*Math.PI/360)*length;
 const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>p.clone().addScaledVector(f,length).addScaledVector(right,x*h*16/9).addScaledVector(up,y*h));
 return corners.flatMap((c,i)=>[p.toArray(),c.toArray(),c.toArray(),corners[(i+1)%4].toArray()]);
}
function visionCone(color){
 const group=new THREE.Group(),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(36),3));
 const fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.085,side:THREE.DoubleSide,depthWrite:false}));
 const edges=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,6),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85,depthWrite:false}),8);
 edges.frustumCulled=false;fill.frustumCulled=false;group.add(fill,edges);group.userData={fill,edges};return group;
}
function updateVisionCone(group,pose){
 const points=conePoints(pose),{fill,edges}=group.userData,positions=fill.geometry.attributes.position,transform=new THREE.Object3D(),axis=new THREE.Vector3(0,1,0);
 for(let i=0;i<4;i++)for(let j=0;j<3;j++){const p=points[i*4+[0,1,3][j]];positions.setXYZ(i*3+j,...p);}positions.needsUpdate=true;
 for(let i=0;i<8;i++){const a=vec(points[2*i]),b=vec(points[2*i+1]),delta=b.clone().sub(a);transform.position.copy(a).add(b).multiplyScalar(.5);transform.quaternion.setFromUnitVectors(axis,delta.clone().normalize());transform.scale.set(.014,delta.length(),.014);transform.updateMatrix();edges.setMatrixAt(i,transform.matrix);}
 edges.instanceMatrix.needsUpdate=true;
}
export class TeamView {
 constructor(world,element){
  this.element=element;this.overlay=new THREE.Group();world.add(this.overlay);
  this.worldCones=DRONE_COLORS.map(c=>{const cone=visionCone(c);this.overlay.add(cone);return cone;});
  this.worldPlans=DRONE_COLORS.map(c=>{const l=line(c);this.overlay.add(l);return l;});
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#152b30');
  this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));element.append(this.renderer.domElement);
  this.camera=new THREE.PerspectiveCamera(46,1,.1,100);this.camera.up.set(0,0,1);this.camera.position.set(11,-7,10);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,5,-.5);this.controls.enableDamping=true;this.controls.minDistance=3;this.controls.maxDistance=45;
  this.scene.add(new THREE.AmbientLight(0xffffff,2));this.scene.add(new THREE.AxesHelper(2));
  for(const [label,color,position]of [['X','#ef9c80',[2.4,0,0]],['Y','#a2db89',[0,2.4,0]],['Z','#87b3fc',[0,0,2.4]],['0, 0, 0','#b6cccf',[-.8,0,-.4]]]){
   const canvas=document.createElement('canvas');canvas.width=128;canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.font='24px system-ui';ctx.textAlign='center';ctx.fillText(label,64,31);
   const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));sprite.position.set(...position);sprite.scale.set(1.5,.56,1);this.scene.add(sprite);
  }
  this.grid=new THREE.GridHelper(22,22,0x3c6064,0x25444a);this.grid.rotation.x=Math.PI/2;this.scene.add(this.grid);
  this.cloud=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:.14,vertexColors:true,sizeAttenuation:true}));this.scene.add(this.cloud);
  this.droneMarkers=DRONE_COLORS.map(color=>{
   const g=new THREE.Group(),m=new THREE.MeshBasicMaterial({color});
   for(const angle of [-Math.PI/4,Math.PI/4]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.85,.06,.05),m);arm.rotation.z=angle;g.add(arm);}
   const body=new THREE.Mesh(new THREE.ConeGeometry(.16,.5,4),m);body.rotation.z=-Math.PI/2;g.add(body);this.scene.add(g);return g;
  });
  this.cones=DRONE_COLORS.map(c=>{const l=line(c,true,.3);this.scene.add(l);return l;});
  this.paths=DRONE_COLORS.map(c=>{const l=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:c}));this.scene.add(l);return l;});
  this.tracers=DRONE_COLORS.map(c=>Array.from({length:4},()=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.10,8,6),new THREE.MeshBasicMaterial({color:c}));this.scene.add(m);return m;}));
  this.revision=-1;new ResizeObserver(()=>this.resize()).observe(element);this.resize();
 }
 resize(){
  const {width,height}=this.element.getBoundingClientRect();if(width<=0||height<=0)return;
  this.renderer.setSize(width,height,false);this.camera.aspect=width/height;
  const fit=Math.max(1,1/this.camera.aspect),offset=this.camera.position.clone().sub(this.controls.target);
  this.camera.position.copy(this.controls.target).add(offset.multiplyScalar(fit/(this.fitScale||1)));this.fitScale=fit;this.camera.updateProjectionMatrix();
 }
 update(state){
  if(!state.drones)return;this.state=state;this.grid.position.z=-state.origin[2];
  state.drones.forEach((a,i)=>{
   this.droneMarkers[i].position.fromArray(a.absolute);this.droneMarkers[i].quaternion.fromArray(a.quaternion);
   updateVisionCone(this.worldCones[i],a.camera);setPoints(this.cones[i],conePoints({...a.camera,position:a.camera.position.map((v,k)=>v-state.origin[k])}));
   if(this.planRevision!==state.plan_revision||this.episode!==state.episode){
    setPoints(this.worldPlans[i],state.plans[i].points);
    const points=state.plans[i].points.map(p=>vec(p.map((v,k)=>v-state.origin[k]))),length=points.reduce((n,p,k)=>n+(k?p.distanceTo(points[k-1]):0),0);
    this.paths[i].geometry.dispose();this.paths[i].geometry=length>.002?new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.035,6,false):new THREE.BufferGeometry();
   }
  });
  this.planRevision=state.plan_revision;
  if(this.episode!==state.episode||this.revision!==state.reconstruction.revision){
   this.episode=state.episode;this.revision=state.reconstruction.revision;const positions=[],colors=[];
   for(const o of state.reconstruction.objects){const color=new THREE.Color(TARGETS.find(t=>t.id===o.id)?.color??(o.semantic==='ground'?0x466970:0xa6b7ba));if(o.status==='remembered')color.multiplyScalar(.5);
    for(const p of o.points){positions.push(...p);colors.push(color.r,color.g,color.b);}}
   this.cloud.geometry.dispose();this.cloud.geometry=new THREE.BufferGeometry();this.cloud.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));this.cloud.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
   this.element.dataset.points=String(positions.length/3);
  }
  this.element.dataset.revision=String(state.plan_revision);this.element.dataset.time=String(state.time);
 }
 render(){
  if(!this.state)return;const s=this.state;
  s.plans.forEach((plan,i)=>this.tracers[i].forEach((m,k)=>{const phase=(Math.max(0,s.time-plan.generated_at)+k*.25)%1,p=evaluateCurve(plan,phase).position;m.position.set(...p.map((v,j)=>v-s.origin[j]));m.scale.setScalar(.5+k*.25);}));
  this.controls.update();this.renderer.render(this.scene,this.camera);
 }
}
