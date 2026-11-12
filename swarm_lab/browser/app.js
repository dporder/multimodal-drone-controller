import * as THREE from 'three';
import {OrbitControls} from '../web/vendor/OrbitControls.js';
import {RGBELoader} from '../web/vendor/RGBELoader.js';
import {GLTFLoader} from '../web/vendor/GLTFLoader.js';
import {createRuntime} from './runtime.js';
import {cityGraphics} from './city-graphics.js';
import {createRouteEditor} from './route-editor.js';
import {createDecisionView} from './decision-view.js';
import {createDroneDashboard} from './drone-dashboard.js';

const $=id=>document.getElementById(id);
const decisionView=createDecisionView();
THREE.Object3D.DEFAULT_UP.set(0,0,1);
const scene=new THREE.Scene();
scene.background=new THREE.Color('#cad3cc');scene.fog=new THREE.FogExp2('#cad3cc',.007);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
$('viewport').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(43,1,.05,500);camera.position.set(19,-29,20);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,2);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.48;controls.minDistance=1;controls.maxDistance=110;controls.enabled=false;
const hemi=new THREE.HemisphereLight('#e7f3ff','#9f9778',1.4);scene.add(hemi);
const sun=new THREE.DirectionalLight('#ffdfae',3.8);sun.position.set(-22,-18,32);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-28,right:28,top:28,bottom:-28,near:1,far:120});sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;sun.shadow.radius=3;scene.add(sun);
const fill=new THREE.DirectionalLight('#c4e8ff',.6);fill.position.set(10,15,20);scene.add(fill);
const world=new THREE.Group();scene.add(world);
const pmrem=new THREE.PMREMGenerator(renderer);
new RGBELoader().load('../web/assets/industrial_sunset_02_1k.hdr',hdr=>{
 hdr.mapping=THREE.EquirectangularReflectionMapping;
 scene.environment=pmrem.fromEquirectangular(hdr).texture;
 scene.environmentRotation.x=Math.PI/2;
 scene.backgroundBlurriness=.03;scene.environmentIntensity=.65;scene.backgroundIntensity=.8;
});
const textureLoader=new THREE.TextureLoader();
const pavement={map:textureLoader.load('../web/assets/asphalt_diff.jpg'),normalMap:textureLoader.load('../web/assets/asphalt_normal.jpg'),roughnessMap:textureLoader.load('../web/assets/asphalt_rough.jpg')};
for(const [name,texture] of Object.entries(pavement)){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(170/30,170/30);texture.anisotropy=8;if(name==='map')texture.colorSpace=THREE.SRGBColorSpace;}
let personGroup=null,destinationGroup=null,personMixer=null,personAnimation=null,personAvatar=null;let destinationPlacement=false;
const routeLineMaterial=new THREE.LineDashedMaterial({color:'#36d8dc',depthTest:false,dashSize:.4,gapSize:.24,transparent:true,opacity:.75});let routeLine=null;

const aircraftGroup=new THREE.Group();scene.add(aircraftGroup);
let drones=[],goalMarkers=[],trailLines=[],forecastLines=[],sensorLines=[],contactMeshes=[],obstacleVisuals=[];
let state=null,version=-1,selected=0,cameraMode='action',lastPoll=performance.now();
const droneDashboard=createDroneDashboard({renderer,scene,getDrones:()=>drones,getOverlays:()=>[...goalMarkers,routeLine,destinationGroup],onFrames:(frames,s)=>runtime.controlFrame(frames,s)});
let chart=[],toastTimer,frameTime=performance.now(),fleetCount=0;let routeEditor=null,drawingPath=false;
const exitGuideLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#f1c75a',dashSize:.4,gapSize:.2,depthTest:false}));exitGuideLine.renderOrder=10;scene.add(exitGuideLine);
const palette=['#5dd6bf','#e6b36c','#90b1e2','#c695cf','#98bc62','#dc9275','#6fc9df','#cfca78'];
const mat=(color,roughness=.7,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const metal=mat('#455254',.38,.65),carbon=mat('#263235',.65,.3),rubber=mat('#191f20',.9),silver=mat('#b0b9b6',.3,.8);
function mesh(geometry,material,parent,position){const m=new THREE.Mesh(geometry,material);if(position)m.position.set(...position);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
function box(parent,size,pos,material){return mesh(new THREE.BoxGeometry(...size),material,parent,pos);}
function cylinder(parent,r,h,pos,material){const m=mesh(new THREE.CylinderGeometry(r,r,h,16),material,parent,pos);m.rotation.x=Math.PI/2;return m;}
function line(points,color,parent=scene,opacity=1){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(350*3),3));points.forEach((p,i)=>geometry.attributes.position.setXYZ(i,...p));geometry.setDrawRange(0,points.length);const l=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity}));l.frustumCulled=false;parent.add(l);return l;}
function setLinePoints(object,points){const a=object.geometry.attributes.position;points.forEach((p,i)=>a.setXYZ(i,p.x,p.y,p.z));a.needsUpdate=true;object.geometry.setDrawRange(0,points.length);}
function clearGroup(group){while(group.children.length){const object=group.children[0];group.remove(object);object.traverse(o=>{o.geometry?.dispose();if(o.material&&!Array.isArray(o.material)&&![metal,carbon,rubber,silver].includes(o.material)){if(o.material.map&&!Object.values(pavement).includes(o.material.map))o.material.map.dispose();o.material.dispose();}});}}
function seeded(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function groundTexture(seed){const rand=seeded(seed),canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');c.fillStyle='#999d91';c.fillRect(0,0,512,512);for(let i=0;i<35000;i++){const v=110+Math.floor(rand()*55);c.fillStyle=`rgba(${v},${v+2},${v-3},.35)`;c.fillRect(rand()*512,rand()*512,rand()*2+1,rand()*2+1);}for(let i=0;i<12;i++){let x=rand()*512,y=rand()*512;c.beginPath();c.moveTo(x,y);for(let j=0;j<5;j++){x+=(rand()-.5)*90;y+=rand()*30;c.lineTo(x,y);}c.strokeStyle='#6e746522';c.lineWidth=.8;c.stroke();}const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(10,10);texture.anisotropy=8;return texture;}
function label(text,color='#e4e9d8'){const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='rgba(24,39,42,.78)';ctx.roundRect(5,24,246,78,12);ctx.fill();ctx.fillStyle=color;ctx.font='500 60px monospace';ctx.textAlign='center';ctx.fillText(text,128,83);const t=new THREE.CanvasTexture(c);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,opacity:.8,depthTest:true}));sprite.scale.set(1.2,.6,1);return sprite;}
function buildWorld(snapshot){clearGroup(world);contactMeshes=[];obstacleVisuals=[];const rand=seeded(snapshot.seed+23),kind=snapshot.config.scene;const city=kind==='amsterdam'?cityGraphics({world,box,cylinder,mesh,mat,label}):null;
 const ground=mesh(new THREE.PlaneGeometry(170,170),new THREE.MeshStandardMaterial((kind==='forest'||kind==='office'||kind==='amsterdam')?{map:groundTexture(snapshot.seed),color:kind==='forest'?'#8a9875':kind==='amsterdam'?'#a8aaa0':'#b5b9b3',roughness:kind==='forest'?.98:.72}:{...pavement,normalScale:new THREE.Vector2(.6,.6),roughness:1,color:'#ffffff'}),world,[0,0,-.005]);ground.receiveShadow=true;ground.castShadow=false;
 // Painted safety lines and takeoff pads have no height and no contact geometry.
 if(kind!=='amsterdam')for(let x=-15;x<=15;x+=5){box(world,[.045,30,.002],[x,0,.006],mat('#dddac0'));}
 if(kind!=='amsterdam')for(let y=-15;y<=15;y+=5){box(world,[30,.045,.002],[0,y,.007],mat('#cccbb7'));}
 if(kind==='yard')for(let y=-14;y<14;y+=2){box(world,[.12,.85,.003],[2.9,y,.009],mat('#d2ba70'));}
 for(let i=0;i<snapshot.drones.length;i++){
  const p=snapshot.drones[i].position;const ring=mesh(new THREE.RingGeometry(.48,.5,64),mat('#e7e6cb'),world,[p[0],p[1],.012]);ring.castShadow=false;
  const pad=label(String(i+1).padStart(2,'0'),'#d4d8be');pad.material.rotation=0;pad.position.set(p[0],p[1],.02);pad.scale.set(.42,.21,1);world.add(pad);
 }
 for(const obstacle of snapshot.obstacles){const first=world.children.length;const {position:p,size:s,color,kind:k}=obstacle;let solid;
  if(k==='box'){
   solid=city&&obstacle.semantic==='building'?city.building(obstacle):city&&obstacle.semantic==='canal'?city.water(obstacle):city&&obstacle.semantic==='bridge'?city.bridge(obstacle):box(world,s,p,mat(color,.77,.15));
   if(obstacle.semantic==='sofa'){
    solid.material.visible=false;const upholstery=mat(color,.95);
    box(world,[s[0],s[1],.28],[p[0],p[1],.2],upholstery);
    box(world,[s[0],.2,.55],[p[0],p[1]+s[1]/2-.1,.625],upholstery);
    for(const side of [-1,1])box(world,[.22,s[1],.62],[p[0]+side*(s[0]/2-.11),p[1],.5],upholstery);
    for(let i=0;i<3;i++)box(world,[(s[0]-.5)/3-.02,s[1]-.25,.18],[p[0]+(i-1)*(s[0]-.5)/3,p[1]-.08,.43],mat('#6c8890',.95));
   }else if(obstacle.semantic==='table'){
    solid.material.visible=false;const wood=mat(color,.65);const top=p[2]+s[2]/2;
    box(world,[s[0],s[1],.07],[p[0],p[1],top-.035],wood);
    for(const x of [-1,1])for(const y of [-1,1])box(world,[.07,.07,top-.07],[p[0]+x*(s[0]/2-.08),p[1]+y*(s[1]/2-.08),(top-.07)/2],metal);
   }else if(obstacle.semantic==='tv'){
    box(world,[s[0]-.08,.015,s[2]-.08],[p[0],p[1]-s[1]/2-.01,p[2]],mat('#0b1820',.15,.25));
    const led=mesh(new THREE.SphereGeometry(.018,8,8),new THREE.MeshBasicMaterial({color:'#5fdfb5'}),world,[p[0]+s[0]/2-.1,p[1]-s[1]/2-.02,p[2]-s[2]/2+.04]);led.castShadow=false;
   }

   if(obstacle.ceiling){solid.visible=false;solid.userData.ceiling=true;}else if((kind==='warehouse'||kind==='office')&&(s[0]>10||s[1]>10)){solid.material.transparent=true;solid.material.opacity=.07;solid.material.depthWrite=false;solid.castShadow=false;}
   else if(kind==='yard'&&s[0]>4&&s[2]<3){
    for(let x=-s[0]/2+.12;x<s[0]/2;x+=.21){for(const side of [-1,1])box(world,[.055,.045,s[2]-.08],[p[0]+x,p[1]+side*(s[1]/2+.015),p[2]],mat(color,.72,.3));}
    for(const y of [-s[1]/2+.12,s[1]/2-.12])box(world,[.055,.06,s[2]-.1],[p[0]+s[0]/2+.015,p[1]+y,p[2]],silver);
    for(const z of [-s[2]/2+.08,s[2]/2-.08])box(world,[s[0],.05,.08],[p[0],p[1]-s[1]/2-.015,p[2]+z],mat('#6b7770',.6,.3));
   }else if(kind==='warehouse'&&s[0]<3){
    for(let z=.4;z<s[2];z+=1.4){box(world,[s[0]+.08,s[1]+.08,.08],[p[0],p[1],z],mat('#b2bdab',.65,.4));}
    for(const x of [-s[0]/2,s[0]/2])for(const y of [-s[1]/2,s[1]/2])box(world,[.06,.06,s[2]],[p[0]+x,p[1]+y,p[2]],mat('#b5945e',.55,.3));
   }
  }else{solid=cylinder(world,s[0],s[1],p,mat('#6d6e53',.95));
   // Foliage is decorative. Exact trunk collision geometry is available as an overlay.
   for(let j=0;j<3;j++){const foliage=mesh(new THREE.IcosahedronGeometry(1.6+rand()*.6,1),mat(['#6d8058','#7b8e61','#87976d'][j],1),world,[p[0]+(rand()-.5)*.7,p[1]+(rand()-.5)*.7,p[2]+s[1]/2-1+j*.6]);foliage.scale.z=.85;}
  }
  if(!obstacle.ceiling&&obstacle.solid!==false){const visuals=[];world.children.slice(first).forEach(root=>root.traverse(m=>{if(m.material)visuals.push(m);}));for(const m of visuals){if(m.material){m.material=m.material.clone();m.userData.baseOpacity=m.material.opacity;m.userData.baseShadow=m.castShadow;}}const size=k==='box'?new THREE.Vector3(...s):new THREE.Vector3(s[0]*2+4,s[0]*2+4,s[1]+3);obstacleVisuals.push({visuals,bounds:new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...p),size)});}
  const wire=new THREE.LineSegments(new THREE.EdgesGeometry(solid.geometry),new THREE.LineBasicMaterial({color:'#e6b859',transparent:true,opacity:.75}));wire.position.copy(solid.position);wire.rotation.copy(solid.rotation);wire.visible=false;world.add(wire);contactMeshes.push(wire);
 }
 if(city)city.scenery();
 if(kind==='yard'){
  for(let x=-18;x<=18;x+=3)cylinder(world,.035,2,[x,18,1],silver);
  for(let z=.4;z<2;z+=.4)box(world,[36,.018,.018],[0,18,z],silver);
  for(let x=-18;x<=18;x+=.35)box(world,[.012,.01,1.7],[x,18,1],silver);
 }
}
function makeDrone(i,coordinated=false){const group=new THREE.Group(),col=palette[i%palette.length];aircraftGroup.add(group);
 const body=box(group,[.28,.22,.105],[0,0,0],carbon);body.userData.drone=i;
 box(group,[.19,.16,.045],[0,0,.075],mat('#586166',.42,.5));box(group,[.14,.125,.04],[-.02,0,.115],mat('#243036',.75));
 const propellers=[];
 for(let k=0;k<4;k++){const x=[.19,-.19,-.19,.19][k],y=[.19,.19,-.19,-.19][k];
  const arm=box(group,[Math.hypot(x,y),.035,.035],[x/2,y/2,0],carbon);arm.rotation.z=Math.atan2(y,x);
  cylinder(group,.039,.057,[x,y,.019],metal);cylinder(group,.029,.01,[x,y,.052],silver);
  const prop=new THREE.Group();prop.position.set(x,y,.063);group.add(prop);
  box(prop,[.19,.022,.004],[0,0,0],mat('#263436',.4,.25));cylinder(prop,.014,.012,[0,0,.005],metal);propellers.push(prop);
  const blur=mesh(new THREE.CircleGeometry(.095,32),new THREE.MeshBasicMaterial({color:'#697677',transparent:true,opacity:.14,side:THREE.DoubleSide,depthWrite:false}),group,[x,y,.061]);blur.castShadow=false;
  const led=mesh(new THREE.SphereGeometry(.013,8,6),new THREE.MeshBasicMaterial({color:k<2?col:'#e8886b'}),group,[x,y,-.018]);led.castShadow=false;
 }
 for(let y of [-.11,.11]){box(group,[.2,.018,.018],[0,y,-.115],rubber);for(let x of [-.07,.07])box(group,[.012,.012,.08],[x,y,-.07],metal);}
 const gimbal=mesh(new THREE.SphereGeometry(.039,16,12),metal,group,[.137,0,-.04]);gimbal.userData.drone=i;
 const lens=cylinder(group,.022,.014,[.17,0,-.04],mat('#112632',.12,.7));lens.rotation.set(0,0,Math.PI/2);
 const pick=mesh(new THREE.SphereGeometry(.35,12,8),new THREE.MeshBasicMaterial({visible:false}),group);pick.userData.drone=i;
 const tag=label(coordinated?['D1 · LEADER','D2 · LEFT','D3 · RIGHT'][i]:`D${String(i+1).padStart(2,'0')}`,col);tag.position.set(0,0,.55);tag.scale.set(coordinated?1.5:.65,.325,1);group.add(tag);
 const marker=mesh(new THREE.RingGeometry(.27,.3,48),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.5,side:THREE.DoubleSide}),scene);marker.castShadow=false;goalMarkers.push(marker);
 const trace=line([[0,0,0],[0,0,0]],col);trace.userData.points=[];trailLines.push(trace);
 forecastLines.push(line([[0,0,0],[0,0,0]],col,scene,.55));sensorLines.push(new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:col,transparent:true,opacity:.25})));scene.add(sensorLines.at(-1));
 return {group,propellers,tag,target:new THREE.Vector3(),quat:new THREE.Quaternion()};
}
function rebuild(snapshot){for(const objects of [goalMarkers,trailLines,forecastLines,sensorLines])for(const o of objects){scene.remove(o);o.geometry.dispose();o.material.dispose();}goalMarkers=[];trailLines=[];forecastLines=[];sensorLines=[];clearGroup(aircraftGroup);drones=[];buildWorld(snapshot);for(let i=0;i<snapshot.drones.length;i++)drones.push(makeDrone(i,snapshot.continuous_guidance));selected=Math.min(selected,drones.length-1);chart=[];fleetCount=0;version=snapshot.version;
 $('speed').disabled=snapshot.controller==='python';$('speed').title=snapshot.controller==='python'?'Fixed 50 ms Python feedback loop':'Simulation speed';$('scene').value=snapshot.config.scene;$('drones').value='3 · fixed swarm';$('wind').value=snapshot.config.wind;$('wind-value').textContent=snapshot.config.wind.toFixed(1);$('seed').value=snapshot.seed;
 $('scene-name').textContent={yard:'Industrial yard',warehouse:'Indoor warehouse',forest:'Woodland corridor',office:'Furnished interior',amsterdam:'Amsterdam · canal block'}[snapshot.config.scene];$('scene-subtitle').textContent=snapshot.config.scene==='amsterdam'?'Draw a route. Explore alleys, stairs and cover.':`${snapshot.drones.length} aircraft. One shared airspace.`;$('seed-label').textContent=`SEED ${String(snapshot.seed).padStart(3,'0')}`;
 snapshot.drones.forEach((d,i)=>{drones[i].group.position.fromArray(d.position);});buildPerson(snapshot);document.querySelector('#rotor-readout').innerHTML=[1,2,3,4].map(i=>`<div><b>M${i}</b><i></i><span>—</span></div>`).join('');
}

function buildPerson(s){
 personGroup=new THREE.Group();personGroup.position.fromArray(s.person.position);world.add(personGroup);
 personMixer=null;personAvatar=null;
 const avatarRoot=new THREE.Group();personGroup.add(avatarRoot);
 const fallback=mesh(new THREE.CapsuleGeometry(.2,1.1,6,12),mat('#477482'),avatarRoot,[0,0,.88]);fallback.rotation.x=Math.PI/2;
 const owner=personGroup;
 new GLTFLoader().load('../web/assets/person.glb',gltf=>{
  if(personGroup!==owner)return;
  avatarRoot.remove(fallback);fallback.geometry.dispose();fallback.material.dispose();
  const model=gltf.scene;model.rotation.x=Math.PI/2;
  const turn=new THREE.Group();turn.rotation.z=Math.PI/2;turn.add(model);avatarRoot.add(turn);
  model.updateMatrixWorld(true);turn.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(turn),height=bounds.max.z-bounds.min.z;
  turn.scale.setScalar(1.78/height);turn.position.z=-bounds.min.z*(1.78/height);
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  personAvatar=avatarRoot;personMixer=new THREE.AnimationMixer(model);
  if(gltf.animations.length){personAnimation=personMixer.clipAction(gltf.animations[0]);personAnimation.play();}
 });
 const tag=label('PERSON','#5bd1d5');tag.position.set(0,0,2);tag.scale.set(1,.5,1);personGroup.add(tag);
 const ring=mesh(new THREE.RingGeometry(.43,.47,48),new THREE.MeshBasicMaterial({color:'#51c3c5',transparent:true,opacity:.8,side:THREE.DoubleSide}),personGroup,[0,0,.013]);ring.castShadow=false;
 destinationGroup=new THREE.Group();destinationGroup.position.fromArray(s.destination);world.add(destinationGroup);
 mesh(new THREE.RingGeometry(.65,.72,64),new THREE.MeshBasicMaterial({color:'#e2ac50',side:THREE.DoubleSide}),destinationGroup,[0,0,.016]);
 cylinder(destinationGroup,.025,2,[0,0,1],mat('#d4a852',.5,.4));box(destinationGroup,[.62,.025,.34],[.31,0,1.83],mat('#d5ab58',.6));
 const dest=label(s.continuous_guidance?'BRIDGE':'EXIT','#f3ce8c');dest.position.set(0,0,2.5);dest.scale.set(2,1,1);destinationGroup.add(dest);if(routeLine){scene.remove(routeLine);routeLine.geometry.dispose();}routeLine=new THREE.Line(new THREE.BufferGeometry(),routeLineMaterial);scene.add(routeLine);
}

function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function command(command,extra={}){runtime.command({command,...extra});}
function timeLabel(t,tenths=false){const m=Math.floor(t/60).toString().padStart(2,'0'),s=Math.floor(t%60).toString().padStart(2,'0');return `${m}:${s}${tenths?'.'+Math.floor(t%1*10):''}`;}
function updateTelemetry(s){$('visibility-status').textContent=s.person.observed_by.length?`Observed by D${s.person.observed_by.join(', D')}`:'Occluded · last observation retained';$('actor-auto').classList.toggle('active',s.person.mode==='autonomous');$('actor-manual').classList.toggle('active',s.person.mode==='manual');$('person-status').textContent=s.continuous_guidance&&s.person.status==='at destination'?'at bridge':s.person.status;$('route-status').textContent=s.guidance_status||'Observing';$('scenario-event').textContent=s.person.events.at(-1)?.text||'Person is pursuing an independent objective.';$('distance-to-exit').textContent=`${Math.hypot(s.person.position[0]-s.destination[0],s.person.position[1]-s.destination[1]).toFixed(1)} m to ${s.continuous_guidance?'bridge':'exit'}`;$('mission-state').textContent=s.continuous_guidance&&s.mode==='guidance'?'BRIDGE GUIDANCE':s.person.refused?'OPERATOR ALERT':s.person.status==='at destination'?'COMPLETE':s.mode==='guidance'&&s.person.intention==='leave via destination'?'ROUTE GUIDANCE':s.person.guidance?'AWAITING RESPONSE':'OBSERVING';$('connection').textContent=s.controller==='python'?(s.external_control?.connected?'Python controller · JS physics':'Waiting for Python controller'):'Browser simulation';$('connection-dot').style.background='#4e976a';$('formation-error').innerHTML=`${s.metrics.formation_error.toFixed(2)}<small>m</small>`;$('separation').innerHTML=s.drones.length>1?`${s.metrics.min_separation.toFixed(2)}<small>m</small>`:'—';$('flight-time').textContent=timeLabel(s.time);$('contacts').textContent=s.metrics.collisions;$('contacts').style.color=s.metrics.collisions?'#b76b45':'';$('flight-status').textContent=s.finished?s.reason.replace('_',' ').toUpperCase():s.running?'FLYING':'PAUSED';$('play').textContent=s.running?'Ⅱ':'▶';$('clock').textContent=timeLabel(s.time,true);$('duration').textContent=timeLabel(s.config.seconds);$('time-progress').style.width=`${s.time/s.config.seconds*100}%`;$('live-wind').textContent=Math.hypot(...s.wind).toFixed(1);$('realtime').textContent=`${s.real_time_factor.toFixed(1)}× realtime`;$('samples').textContent=s.world_model.samples.toLocaleString();$('model-status').textContent=s.world_model.ready?'LEARNING':'COLLECTING';$('model-error').textContent=s.world_model.velocity_rmse===null?'—':`${s.world_model.velocity_rmse.toFixed(3)} m/s`;$('learning-progress').style.width=`${Math.min(s.world_model.samples/240,1)*100}%`;
 $('guidance').classList.toggle('active',s.mode==='guidance');$('formation').classList.toggle('active',s.mode==='formation');$('hold').classList.toggle('active',s.mode==='hold'||s.mode==='waypoint');
 if(fleetCount!==s.drones.length){$('fleet').innerHTML=s.drones.map(d=>`<button class="fleet-item" data-id="${d.id}"><i style="background:${palette[d.id%palette.length]}"></i><div><b>DRONE ${String(d.id+1).padStart(2,'0')}</b><em></em></div><div class="alt"></div></button>`).join('');fleetCount=s.drones.length;$('fleet').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.id);});}
 $('fleet').querySelectorAll('button').forEach((b,i)=>{const d=s.drones[i];b.classList.toggle('selected',selected===i);b.querySelector('em').textContent=`${d.role} · ${Math.hypot(...d.velocity).toFixed(1)} m/s · ${(d.battery*100).toFixed(0)}% battery`;b.querySelector('.alt').textContent=d.hit?'CONTACT':`${d.position[2].toFixed(2)} m`;});
 document.querySelectorAll('#rotor-readout>div').forEach((b,k)=>{const force=s.drones[selected].motors[k];b.querySelector('i').style.height=`${force/7*100}%`;b.querySelector('span').textContent=force.toFixed(2);});
 if(!chart.length||s.time!==chart.at(-1)[0])chart.push([s.time,s.metrics.formation_error]);chart=chart.filter(p=>p[0]>=s.time-20);drawChart();if(s.error)toast(s.error);
}
function drawChart(){const c=$('chart'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(chart.length<2)return;const max=Math.max(1,...chart.map(p=>p[1])),end=chart.at(-1)[0];ctx.strokeStyle='#718b50';ctx.lineWidth=2;ctx.beginPath();chart.forEach(([t,v],i)=>{const x=(t-end+20)/20*c.width,y=c.height-8-v/max*(c.height-18);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.lineTo(c.width,c.height);ctx.lineTo(Math.max(0,(chart[0][0]-end+20)/20*c.width),c.height);ctx.closePath();const g=ctx.createLinearGradient(0,0,0,c.height);g.addColorStop(0,'#9cad7335');g.addColorStop(1,'#9cad7300');ctx.fillStyle=g;ctx.fill();}
function receiveState(next){try{const isNew=next.version!==version;if(isNew){rebuild(next);if(next.config.scene==='amsterdam')setCamera('city');}state=next;exitGuideLine.geometry.dispose();exitGuideLine.geometry=new THREE.BufferGeometry().setFromPoints((next.exit_route||[]).map(p=>new THREE.Vector3(p[0],p[1],.08)));exitGuideLine.computeLineDistances();if(personGroup){personGroup.position.fromArray(next.person.position);personGroup.rotation.z=next.person.heading||0;destinationGroup.position.fromArray(next.destination);const surface=(p)=>Math.max(0,...next.obstacles.filter(o=>o.walkable&&o.kind==='box'&&[0,1].every(i=>Math.abs(p[i]-o.position[i])<=o.size[i]/2)).map(o=>o.position[2]+o.size[2]/2));const route=[next.person.position,...next.person.route.map(p=>[p[0],p[1],surface(p)+.06])];if(routeLine){routeLine.geometry.dispose();routeLine.geometry=new THREE.BufferGeometry().setFromPoints(route.map(p=>new THREE.Vector3(p[0],p[1],Math.max(.06,p[2]))));routeLine.computeLineDistances();}}lastPoll=performance.now();updateTelemetry(next);decisionView.update(next);droneDashboard.update(next);
 next.drones.forEach((d,i)=>{const drone=drones[i];drone.target.fromArray(d.position);drone.quat.set(d.quaternion[1],d.quaternion[2],d.quaternion[3],d.quaternion[0]);goalMarkers[i].position.fromArray(d.goal);goalMarkers[i].rotation.set(0,0,0);
  const pts=trailLines[i].userData.points;if(!pts.length||pts.at(-1).distanceTo(drone.target)>.035)pts.push(drone.target.clone());if(pts.length>350)pts.shift();if(pts.length>1){setLinePoints(trailLines[i],pts);trailLines[i].geometry.setDrawRange(0,pts.length);}
  if(next.predictions.length){setLinePoints(forecastLines[i],next.predictions.map(frame=>new THREE.Vector3(...frame[i])));forecastLines[i].geometry.setDrawRange(0,next.predictions.length);}
  const vertices=[];for(let j=0;j<12;j++){const a=j*Math.PI/6;vertices.push(...d.position,d.position[0]+Math.cos(a)*d.ranges[j],d.position[1]+Math.sin(a)*d.ranges[j],d.position[2]);}const geometry=sensorLines[i].geometry;if(!geometry.attributes.position)geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));else{geometry.attributes.position.array.set(vertices);geometry.attributes.position.needsUpdate=true;}sensorLines[i].frustumCulled=false;
 });
 }catch(error){$('connection').textContent='Viewer error';$('connection-dot').style.background='#ba7555';if(window.lastViewerError!==error.message){console.error(error);window.lastViewerError=error.message;toast(error.message);}}
}

const explain={model:`<h2>A physical world with explicit state.</h2><p>Three aircraft, one person, a destination, obstacles and an atmosphere. Each has a state; gravity, forces, contact and control determine the next state.</p><code>S(t + Δt) = F(S(t), rotor commands, wind, interventions)</code><p>The seed fixes geometry, initial uncertainty and the random-number stream. Radio delivery uses Bernoulli trials; gusts follow an Ornstein–Uhlenbeck process. Operator commands are timestamped in the exported state.</p><h2>Optional learned predictor</h2><p>Five bootstrapped residual models learn how velocity, attitude, angular rates and rotor forces evolve under a control command.</p><code>next state = Newton prior + learned residual</code><p>The ghost paths predict the next 0.5 seconds with the current command held constant. Ensemble disagreement estimates model uncertainty; it is not a calibrated safety bound.</p><p>The error shown is measured before each transition is used for learning. This local model uses simulator state. It is not a camera-based model of the world.</p>`,physics:`<h2>Every aircraft is a rigid body.</h2><code>m dv/dt = R · ΣFrotor + Fdrag + Fwash − mg\nI dω/dt = τ − ω × Iω\nFrotor = kf ωrotor²\ndωrotor/dt = (ωcommand − ωrotor) / τmotor</code><p>Cannon ES solves rigid-body dynamics and contacts at 240 Hz inside a browser worker. A geometric attitude controller mixes torque into four independent motors. Policies receive noisy measurements at 30 Hz.</p><p>Wind gusts, drag, radio delay and loss, motor lag, and empirical battery discharge are simulated. Downwash is an approximate force model. Foliage, painted details and distant scenery are visual decoration.</p><p>Calibration to a specific aircraft is needed for predictive real-world accuracy.</p>`};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));const key=b.dataset.view;$('explain').hidden=key==='flight';$('explain').innerHTML=explain[key]||'';if(key==='model')$('predictions').checked=true;});
function setCamera(mode){cameraMode=mode;if(mode==='orbit')routeEditor?.setEnabled(false);else routeEditor?.setEnabled(true);controls.enabled=mode==='orbit';document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera===mode));if(mode==='orbit')controls.target.copy(drones[selected]?.group.position||new THREE.Vector3(0,0,2));}
document.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>setCamera(b.dataset.camera));
$('focus-scene').onclick=()=>{document.body.classList.toggle('focus-scene');$('focus-scene').textContent=document.body.classList.contains('focus-scene')?'Show panels':'Focus scene';resize();};
$('city-scene').onclick=()=>{command('reset',{scene:'amsterdam'});setCamera('city');};
$('route-jump').onclick=()=>command('actor',{action:'jump'});$('route-hide').onclick=()=>command('actor',{action:'hide'});$('route-climb').onclick=()=>command('actor',{action:'climb'});
$('home-camera').onclick=()=>{setCamera('orbit');camera.position.set(19,-29,20);controls.target.set(0,0,2);};
$('play').onclick=()=>command(state?.running?'pause':'play');$('step').onclick=()=>command('step');$('reset').onclick=()=>command('reset');$('apply').onclick=()=>command('reset',{scene:$('scene').value,seed:Number($('seed').value),wind:Number($('wind').value)});
$('wind').oninput=()=>{$('wind-value').textContent=Number($('wind').value).toFixed(1);};$('speed').onchange=()=>command('speed',{value:Number($('speed').value)});
$('actor-auto').onclick=()=>command('actor',{action:'autonomous'});$('actor-manual').onclick=()=>{command('actor',{action:'manual'});toast('WASD to move · J jump · X crouch · H cover · C climb');};document.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>command('actor',{action:b.dataset.person}));
$('guidance').onclick=()=>command('guidance',{compliance:Number($('response').value)});$('set-destination').onclick=()=>{routeEditor?.setEnabled(false);destinationPlacement=true;toast('Click clear ground to place the exit marker');};$('formation').onclick=()=>command('formation');function hold(){if(!state)return;const center=[0,0,0];state.drones.forEach(d=>d.position.forEach((v,j)=>center[j]+=v/state.drones.length));center[2]=Number($('altitude').value);command('goal',{position:center});}$('hold').onclick=()=>command('hold');$('altitude').oninput=()=>{$('altitude-value').textContent=Number($('altitude').value).toFixed(1);};$('altitude').onchange=hold;
$('golden').onchange=()=>{const warm=$('golden').checked;sun.color.set(warm?'#ffdfae':'#f4f7ff');sun.position.set(-22,-18,warm?32:60);sun.intensity=warm?3.8:3.1;};
$('export').onclick=()=>{if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`swarm-state-${state.seed}-${Math.floor(state.time)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const heldKeys=new Set();function sendMovement(){const x=(heldKeys.has('d')||heldKeys.has('arrowright')?1:0)-(heldKeys.has('a')||heldKeys.has('arrowleft')?1:0),y=(heldKeys.has('w')||heldKeys.has('arrowup')?1:0)-(heldKeys.has('s')||heldKeys.has('arrowdown')?1:0);command('actor',{action:'input',value:[x,y]});}window.addEventListener('keyup',e=>{if(heldKeys.delete(e.key.toLowerCase()))sendMovement();});window.addEventListener('blur',()=>{heldKeys.clear();if(state?.person.mode==='manual')sendMovement();});
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;const key=e.key.toLowerCase();if(state?.person.mode==='manual'&&['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){e.preventDefault();if(!heldKeys.has(key)){heldKeys.add(key);sendMovement();}return;}if(!e.repeat&&['j','x','h','c'].includes(key)){command('actor',{action:{j:'jump',x:'crouch',h:'hide',c:'climb'}[key]});return;}if(e.code==='Space'){e.preventDefault();$('play').click();}if(e.key.toLowerCase()==='r')$('reset').click();if(e.key.toLowerCase()==='p')$('predictions').checked=!$('predictions').checked;});
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),groundPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
renderer.domElement.addEventListener('click',e=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);if(destinationPlacement){const hit=new THREE.Vector3();if(raycaster.ray.intersectPlane(groundPlane,hit)){command('destination',{position:[hit.x,hit.y,0]});destinationPlacement=false;}}else if(e.altKey){const hit=new THREE.Vector3();if(raycaster.ray.intersectPlane(groundPlane,hit)){command('person',{position:[hit.x,hit.y,0]});}}else if(e.shiftKey){const hit=new THREE.Vector3();if(raycaster.ray.intersectPlane(groundPlane,hit)){command('goal',{position:[hit.x,hit.y,Number($('altitude').value)]});toast('Formation destination updated');}}else{for(const hit of raycaster.intersectObjects(aircraftGroup.children,true)){if(hit.object.userData.drone!==undefined){selected=hit.object.userData.drone;break;}}}});

// Inspection cutaways only affect rendering. Physics and visibility keep the
// original solid geometry, including hidden ceilings and faded foreground props.
const sightRay=new THREE.Ray(),sightHit=new THREE.Vector3();
function updateCutaway(){
 if(!personGroup)return;
 const targets=[personGroup.position.clone().add(new THREE.Vector3(0,0,1)),...drones.map(d=>d.group.position)];
 for(const {visuals,bounds} of obstacleVisuals){
  const blocking=(drawingPath&&visuals.some(m=>m.position.z>2))||targets.some(target=>{const delta=target.clone().sub(camera.position);const length=delta.length();sightRay.set(camera.position,delta.normalize());return sightRay.intersectBox(bounds,sightHit)&&sightHit.distanceTo(camera.position)<length-.6;});
  for(const m of visuals){if(!m.material)continue;const opacity=blocking?Math.min(.12,m.userData.baseOpacity):m.userData.baseOpacity;m.material.transparent=opacity<1;m.material.opacity=opacity;m.material.depthWrite=opacity>=1;m.castShadow=!blocking&&m.userData.baseShadow;}
 }
}

function resize(){const r=$('viewport').getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}window.addEventListener('resize',resize);new ResizeObserver(resize).observe($('viewport'));resize();
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-frameTime)/1000,.1);frameTime=now;if(personAvatar&&state){personAvatar.scale.z=state.person.posture==='crouching'?.62:1;}if(personMixer&&state){const speed=Math.hypot(...(state.person.velocity||[0,0,0]));personMixer.timeScale=state.running?speed/.9:0;personMixer.update(dt);}drones.forEach((d,i)=>{d.group.position.lerp(d.target,1-Math.exp(-25*dt));d.group.quaternion.slerp(d.quat,1-Math.exp(-25*dt));d.propellers.forEach((p,k)=>{if(state?.running)p.rotation.z+=(k%2?-1:1)*Math.sqrt((state.drones[i]?.motors[k]||0)/1.1e-5)*dt;});d.tag.visible=cameraMode!=='fpv';goalMarkers[i].visible=cameraMode!=='fpv';trailLines[i].visible=$('trails').checked;forecastLines[i].visible=$('predictions').checked&&!!state?.world_model.ready;sensorLines[i].visible=$('sensors').checked&&selected===i;});contactMeshes.forEach(o=>o.visible=$('colliders').checked);
 if(!drawingPath&&drones[selected]&&cameraMode!=='orbit'){const d=drones[selected].group,p=d.position;const look=p.clone();let desired;if(cameraMode==='action'){const points=[...drones.map(a=>a.group.position),personGroup.position,destinationGroup.position];const bounds=new THREE.Box3().setFromPoints(points);const center=bounds.getCenter(new THREE.Vector3());center.z=1.7;const span=bounds.getSize(new THREE.Vector3());const distance=Math.max(12,span.x*1.15,span.y*1.15,Math.hypot(span.x,span.y)/Math.max(.7,camera.aspect)*.95);desired=center.clone().add(new THREE.Vector3(.65*distance,-distance,.72*distance));look.copy(center);}else if(cameraMode==='city'){desired=new THREE.Vector3(17,-24,24);look.set(0,0,2.2);}else if(cameraMode==='person'){const person=personGroup.position;desired=person.clone().add(new THREE.Vector3(5,-9,4));look.copy(person).add(new THREE.Vector3(0,0,1.3));}else if(cameraMode==='follow')desired=p.clone().add(new THREE.Vector3(-3,-5,2));else if(cameraMode==='top'){desired=new THREE.Vector3(0,-.01,38);look.set(0,0,0);}else{desired=new THREE.Vector3(.19,0,-.025).applyQuaternion(d.quaternion).add(p);look.add(new THREE.Vector3(3,0,-.1).applyQuaternion(d.quaternion));}camera.position.lerp(desired,cameraMode==='fpv'?1:1-Math.exp(-4*dt));camera.lookAt(look);}else controls.update();updateCutaway();renderer.render(scene,camera);droneDashboard.render(now);
 if(now-lastPoll>3000){$('connection').textContent=document.hidden?'Tab suspended':'Waiting for browser worker';$('connection-dot').style.background='#b99754';}}
const runtime=createRuntime(receiveState,message=>{console.error(message);toast(message);$('connection').textContent='Simulation error';$('connection-dot').style.background='#ba7555';});
routeEditor=createRouteEditor({renderer,camera,scene,getState:()=>state,command,toast,onDrawing:value=>{drawingPath=value;controls.enabled=!value&&cameraMode==='orbit';}});
requestAnimationFrame(animate);
