import * as THREE from 'three';
import {OrbitControls} from '../web/vendor/OrbitControls.js';
import {TRAJECTORY_COLORS} from './sim/master-frame.js';
import {evaluateTrajectory} from './sim/trajectory.js';
import {cameraBasis} from './sim/observed-map.js';

export function createTrajectoryPlot(element){
  const canvas=element.querySelector('canvas'),scene=new THREE.Scene();scene.background=new THREE.Color('#142e32');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const camera=new THREE.OrthographicCamera(-8,8,8,-8,.01,200);camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,canvas);controls.enablePan=true;controls.minZoom=.4;controls.maxZoom=8;
  const axes=new THREE.Group(),plans=new THREE.Group(),surfaces=new THREE.Group(),trails=new THREE.Group(),cameraViews=new THREE.Group(),historicView=new THREE.Group();scene.add(axes,plans,surfaces,trails,cameraViews,historicView);
  const labels=[],coordinateRows=element.querySelector('.trajectory-coordinates');
  let extent=0,frame=null,version=null,mapRevision=-1,cameraTextures=[],keyframes=[],lastKeyframeTime=-1;
  const draw=()=>{renderer.render(scene,camera);canvas.dataset.view=camera.position.toArray().map(v=>v.toFixed(3)).join(',');};
  const resize=()=>{const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);const height=(extent||6)*1.05;camera.top=height;camera.bottom=-height;camera.left=-height*r.width/r.height;camera.right=height*r.width/r.height;camera.updateProjectionMatrix();draw();};
  function clear(group){for(const o of [...group.children]){group.remove(o);o.traverse(child=>{child.geometry?.dispose();if(child.material){child.material.map?.dispose();child.material.dispose();}});}}
  function text(label,color='#d2e3e4'){
    const c=document.createElement('canvas');c.width=256;c.height=48;const ctx=c.getContext('2d');ctx.font='500 25px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(label,128,33);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));sprite.scale.set(extent*.62,extent*.116,1);return sprite;
  }
  function line(points,color,opacity=1){const g=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));return new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity}));}
  function rebuildAxes(size){
    clear(axes);extent=size;
    const step=extent<=6?1:extent<=12?2:5;
    for(let i=-extent;i<=extent;i+=step){if(i===0)continue;axes.add(line([[i,-extent,0],[i,extent,0]],'#547073',.32),line([[-extent,i,0],[extent,i,0]],'#547073',.32));}
    const colors=['#f28c83','#a9cc8d','#93bdea'];
    for(let k=0;k<3;k++){
      const a=[0,0,0],b=[0,0,0];a[k]=-extent;b[k]=extent;axes.add(line([a,b],colors[k],.7));
      const arrow=new THREE.ArrowHelper(new THREE.Vector3(...b).normalize(),new THREE.Vector3(),extent,colors[k],extent*.09,extent*.045);axes.add(arrow);
      const label=text(['+X (m)','+Y (m)','+Z up (m)'][k],colors[k]);label.position.fromArray(b.map(v=>v*1.15));axes.add(label);
      for(let n=-extent;n<=extent;n+=step){if(!n||Math.abs(n)===extent||n% (step*2))continue;const tick=text(String(n),'#92aaad');tick.scale.multiplyScalar(.6);tick.position.set(k===0?n:extent*.1,k===1?n:-extent*.1,k===2?n:0);axes.add(tick);}
    }
    const origin=text('START · (0, 0, 0)');origin.position.set(0,0,extent*.19);axes.add(origin);
    element.querySelector('.trajectory-scale').textContent=`Grid ${step} m · equal XYZ scale`;
    resize();
  }
  function home(){camera.position.set(45,-65,45);camera.zoom=1;controls.target.set(0,0,0);controls.update();camera.updateProjectionMatrix();draw();}
  controls.addEventListener('change',draw);
  element.querySelector('[data-plot-reset]').onclick=home;
  const expand=element.querySelector('[data-plot-expand]');
  function setExpanded(value){element.classList.toggle('expanded',value);expand.textContent=value?'Close large view':'Enlarge';expand.setAttribute('aria-expanded',String(value));resize();}
  expand.onclick=()=>setExpanded(!element.classList.contains('expanded'));
  element.addEventListener('keydown',e=>{if(e.key==='Escape')setExpanded(false);});
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  for(const [selector,group]of [['[data-map-surfaces]',surfaces],['[data-map-images]',cameraViews],['[data-map-trails]',trails]])element.querySelector(selector).onchange=e=>{group.visible=e.target.checked;draw();};
  function addView(pose,texture,group,color){
    const basis=cameraBasis(pose),p=new THREE.Vector3(...pose.position),f=new THREE.Vector3(...basis.forward),r=new THREE.Vector3(...basis.right),u=new THREE.Vector3(...basis.up);
    const distance=1.6,h=distance*Math.tan(pose.fov*Math.PI/360),w=h*pose.width/pose.height,center=p.clone().addScaledVector(f,distance);
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>center.clone().addScaledVector(r,x*w).addScaledVector(u,y*h));
    for(let i=0;i<4;i++){group.add(line([p.toArray(),corners[i].toArray()],color,.5));group.add(line([corners[i].toArray(),corners[(i+1)%4].toArray()],color,.7));}
    if(texture){const plane=new THREE.Mesh(new THREE.PlaneGeometry(2*w,2*h),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));plane.position.copy(center);plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r,u,f.clone().negate()));plane.userData.sharedTexture=true;group.add(plane);}
  }
  function clearViews(group){for(const o of group.children)if(o.userData.sharedTexture)o.material.map=null;clear(group);}
  function setCameraImages(canvases){cameraTextures=canvases.map(c=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;});}
  function updateCameraFrames(poses,origin){
    if(!origin)return;clearViews(cameraViews);
    poses.forEach((p,i)=>{if(!p)return;cameraTextures[i].needsUpdate=true;addView({...p,position:p.position.map((v,k)=>v-origin[k])},cameraTextures[i],cameraViews,TRAJECTORY_COLORS[i]);});draw();
  }
  const keyframeSelect=element.querySelector('.map-keyframe-select');
  function setKeyframes(next){
    if(next.length===keyframes.length&&next.at(-1)?.time===lastKeyframeTime)return;
    keyframes=[...next];lastKeyframeTime=next.at(-1)?.time??-1;const selected=keyframeSelect.value;
    keyframeSelect.replaceChildren(new Option('Saved camera views · select to locate',''),...keyframes.map((k,i)=>new Option(`D${k.drone+1} · t ${k.time.toFixed(2)} s`,`${k.drone}@${k.time}`)));keyframeSelect.value=selected;
  }
  keyframeSelect.onchange=()=>{
    clear(historicView);const detail=element.querySelector('.map-keyframe-detail'),k=keyframeSelect.value===''?null:keyframes.find(k=>`${k.drone}@${k.time}`===keyframeSelect.value);detail.hidden=!k;
    if(k){detail.querySelector('img').src=k.image;detail.querySelector('p').textContent=`D${k.drone+1} · t ${k.time.toFixed(2)} s · XYZ ${k.pose.position.map(v=>v.toFixed(2)).join(' / ')} m`;
      const texture=new THREE.TextureLoader().load(k.image,()=>draw());texture.colorSpace=THREE.SRGBColorSpace;addView(k.pose,texture,historicView,'#ffffff');for(const o of historicView.children)o.userData.sharedTexture=false;draw();}
  };
  function updateMap(map){
    if(!map||map.revision===mapRevision)return;mapRevision=map.revision;clear(surfaces);clear(trails);
    const palette={building:'#a99580',tree:'#7aa985',stairs:'#c5bda3',terrace:'#bdbaa6',bridge:'#d9c596',canal:'#579eae',wall:'#a39287'};
    for(const object of map.objects){
      const color=palette[object.semantic]||'#9eada6',positions=object.points.flat(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      surfaces.add(new THREE.Points(geometry,new THREE.PointsMaterial({color,size:1.6,sizeAttenuation:false,transparent:true,opacity:.65,depthWrite:false})));
      const {min,max}=object.bounds,size=max.map((v,k)=>Math.max(.06,v-min[k])),center=max.map((v,k)=>(v+min[k])/2);
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.12,depthWrite:false}));mesh.position.fromArray(center);surfaces.add(mesh);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity:.28}));edge.position.copy(mesh.position);surfaces.add(edge);
    }
    map.trails.forEach((trail,i)=>{if(trail.length>1)trails.add(line(trail.map(p=>p.position),TRAJECTORY_COLORS[i],.4));});
    element.querySelector('.map-status').textContent=`${map.objects.length} objects · ${map.point_count} surface samples · ${map.objects.filter(o=>o.seen_by.length>1).length} shared sightings`;
    const list=element.querySelector('.map-objects');list.replaceChildren(...map.objects.map(o=>{const row=document.createElement('div');row.textContent=`${o.label} · D${o.seen_by.map(i=>i+1).join('/D')} · last ${o.last_seen.toFixed(1)} s`;return row;}));
  }
  home();rebuildAxes(6);
  function update(next,episode){
    if(!next)return;
    if(version===episode&&frame?.time===next.time&&mapRevision===next.map?.revision)return;
    if(version!==episode){version=episode;mapRevision=-1;clear(surfaces);clear(trails);clear(historicView);keyframes=[];lastKeyframeTime=-1;element.querySelector('.map-keyframe-detail').hidden=true;home();rebuildAxes(6);}frame=next;
    const maximum=Math.max(3,...frame.goal.map(Math.abs),...frame.trajectories.flatMap(t=>t.points.flatMap(p=>p.position.map(Math.abs))),...(frame.map?.objects||[]).flatMap(o=>[...o.bounds.min,...o.bounds.max].map(Math.abs)));
    const size=Math.max(4,Math.ceil((maximum+.6)/2)*2);
    // Quantized extent keeps scale stable between small 50 ms plan updates.
    if(size>extent)rebuildAxes(size);
    updateMap(frame.map);
    clear(plans);labels.length=0;
    for(const t of frame.trajectories){
      const color=TRAJECTORY_COLORS[t.drone],material=new THREE.MeshBasicMaterial({color});
      const points=t.control_points.map(p=>new THREE.Vector3(...p));
      if(t.points.some(p=>new THREE.Vector3(...p.position).distanceTo(points[0])>1e-5)){
        const path=new THREE.CubicBezierCurve3(...points);
        plans.add(new THREE.Mesh(new THREE.TubeGeometry(path,40,extent*.005,5,false),material.clone()));
      }
      const current=frame.drone_positions?.[t.drone]||t.control_points[0];
      const start=new THREE.Mesh(new THREE.SphereGeometry(extent*.014,10,8),material.clone());start.position.fromArray(current);plans.add(start);
      const label=text(['MASTER','SLAVE 1','SLAVE 2'][t.drone],color);label.position.fromArray(current).add(new THREE.Vector3(0,0,-extent*.12));plans.add(label);
      const end=new THREE.Mesh(new THREE.OctahedronGeometry(extent*.025),material.clone());end.position.copy(points[3]);plans.add(end);
      for(const time of [.25,.5,.75]){const tick=new THREE.Mesh(new THREE.SphereGeometry(extent*.009,6,4),material.clone());tick.position.fromArray(evaluateTrajectory(t,time).position);plans.add(tick);}
      material.dispose();
    }
    const goalMarker=new THREE.Mesh(new THREE.OctahedronGeometry(extent*.025),new THREE.MeshBasicMaterial({color:'#f2cc79'}));goalMarker.position.fromArray(frame.goal);plans.add(goalMarker);
    const goalLabel=text('BRIDGE GOAL','#f2cc79');goalLabel.position.copy(goalMarker.position).add(new THREE.Vector3(0,0,extent*.15));plans.add(goalLabel);
    if(frame.person){const seen=new THREE.Mesh(new THREE.BoxGeometry(.45,.45,1.5),new THREE.MeshBasicMaterial({color:frame.person.age<.5?'#f4ce7d':'#7c8a8d',transparent:true,opacity:.75}));seen.position.fromArray(frame.person.position);seen.position.z+=.75;plans.add(seen);}
    coordinateRows.replaceChildren(...frame.trajectories.map(t=>{const row=document.createElement('div');row.style.color=TRAJECTORY_COLORS[t.drone];const name=document.createElement('b'),values=document.createElement('span');name.textContent=['M','S1','S2'][t.drone];values.textContent=t.target.map(v=>(Math.abs(v)<.005?0:v).toFixed(2)).join(' / ');row.append(name,values);return row;}));
    element.querySelector('.trajectory-stamp').textContent=`Plan t ${frame.generated_at.toFixed(2)} s · next 1.00 s · origin fixed`;
    canvas.dataset.frame=JSON.stringify(frame);canvas.dataset.paths=String(frame.trajectories.length);draw();
  }
  window.addEventListener('pagehide',()=>{observer.disconnect();controls.dispose();clear(axes);clear(plans);clear(surfaces);clear(trails);clearViews(cameraViews);clear(historicView);cameraTextures.forEach(t=>t.dispose());renderer.dispose();},{once:true});
  return {update,setCameraImages,updateCameraFrames,setKeyframes,getFrame:()=>frame};
}
