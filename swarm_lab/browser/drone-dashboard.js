import * as THREE from 'three';
import {camera_master,camera_slave1,camera_slave2} from './sim/camera-pose.js';
import {masterReferenceFrame,TRAJECTORY_COLORS} from './sim/master-frame.js';
import {evaluateTrajectory} from './sim/trajectory.js';
import {createTrajectoryPlot} from './trajectory-plot.js';

export function createDroneDashboard({renderer,scene,getDrones,getOverlays,onFrames}){
  const $=id=>document.getElementById(id),panel=$('drone-dashboard');
  const cameras=Array.from({length:3},()=>new THREE.PerspectiveCamera(80,256/144,.05,90));
  const target=new THREE.WebGLRenderTarget(768,144,{depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;
  const pixels=new Uint8Array(768*144*4),posesCaptured=[],canvases=[],contexts=[],images=[],curves=[],cards=[];
  let last=0,nextDue=0,lastVersion=-1,frames=0,rateStart=0,intervals=[],state=null,keyframes=[],lastKeyframe=[-Infinity,-Infinity,-Infinity];
  const colors=TRAJECTORY_COLORS;
  const plot=createTrajectoryPlot($('master-trajectory-plot'));
  const parameters=new URLSearchParams(location.search);$('planning-map').value=parameters.get('map')||'known';$('sensor-profile').value=parameters.get('sensors')||'nominal';
  $('apply-audit-profile').onclick=()=>{const url=new URL(location.href);url.searchParams.set('map',$('planning-map').value);url.searchParams.set('sensors',$('sensor-profile').value);if(state)url.searchParams.set('seed',String(state.seed));location.href=url.href;};
  for(let i=0;i<3;i++){
    const card=document.createElement('article');card.className='drone-card';card.innerHTML=`<div class="drone-card-head"><strong>${['MASTER','SLAVE 1','SLAVE 2'][i]}</strong><span class="camera-stamp">Waiting for frame</span></div><div class="drone-card-body"><canvas class="onboard-frame" width="256" height="144" aria-label="${['Master','Slave 1','Slave 2'][i]} onboard camera"></canvas><div class="drone-tactic"><b></b><span></span><small></small></div></div><div class="four-rotors">${[1,2,3,4].map(k=>`<div><label>R${k}</label><i><em></em></i><span>—</span></div>`).join('')}</div>`;
    $('drone-cards').append(card);cards.push(card);const canvas=card.querySelector('canvas');canvases.push(canvas);contexts.push(canvas.getContext('2d',{willReadFrequently:true}));images.push(new ImageData(256,144));
    const line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:colors[i],transparent:true,opacity:.95}));line.userData.cameraOverlay=true;scene.add(line);curves.push(line);
  }
  plot.setCameraImages(canvases);
  function toggle(open){panel.hidden=!open;document.body.classList.toggle('drone-dashboard-open',open);$('drone-dashboard-toggle').classList.toggle('active',open);window.dispatchEvent(new Event('resize'));}
  $('drone-dashboard-toggle').onclick=()=>toggle(panel.hidden);$('drone-dashboard-close').onclick=()=>toggle(false);
  $('camera-export').onclick=()=>{
    if(!state)return;const packet={version:4,period_ms:50,time:state.time,image_annotations:'none',master_frame:plot.getFrame(),camera_keyframes:keyframes,frames:canvases.map((c,i)=>({pose:JSON.parse(c.dataset.pose||'null'),image:c.toDataURL('image/png'),width:256,height:144})),drone_modules:state.drone_modules};
    const url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='swarm-camera-packet.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  function update(s){
    state=s;if(s.version!==lastVersion){lastVersion=s.version;last=0;nextDue=0;frames=0;rateStart=0;intervals=[];keyframes=[];lastKeyframe=[-Infinity,-Infinity,-Infinity];}
    const m=s.drone_modules;if(!m)return;
    const diagnostics=s.diagnostics,plan=m.diagnostics;
    $('control-diagnostics').textContent=s.controller==='python'?`${s.config.map_source==='known'?'Known collision-map prior':'Observed geometry only · cautious speed'} · camera FOV + range sensor. Python 20 Hz sim / onboard 240 Hz. 50 ms tracking RMS ${(diagnostics.tracking_rms_m*100).toFixed(1)} cm · rejected ${diagnostics.rejected} · unresolved plans ${plan?.unresolved??0}.`:'Browser benchmark controller · omnidirectional person range/visibility; camera map uses FOV.';
    $('control-diagnostics').classList.toggle('attention',(plan?.unresolved??0)>0);
    const trajectories=m.drones.map(d=>d.trajectory);
    if(trajectories.every(Boolean))plot.update({...(m.master_frame||masterReferenceFrame(trajectories,s.reference_origin)),map:s.observed_map,goal:s.destination.map((v,k)=>v-s.reference_origin[k]),person:s.perception.last_seen?{position:s.perception.last_seen.position.map((v,k)=>v-s.reference_origin[k]),age:s.time-s.perception.last_seen.time}:null,drone_positions:s.drones.map(d=>d.position.map((v,k)=>v-s.reference_origin[k])),time:s.time},s.version);
    $('master-position').textContent=m.master_absolute.map((x,k)=>(x-s.reference_origin[k]).toFixed(2)).join(' / ');
    $('relative-positions').textContent='To current master: '+m.slaves_relative.map(p=>`S${p.drone} Δ ${p.position.map(x=>x.toFixed(1)).join(', ')} m · radio ${(p.age*1000).toFixed(0)} ms`).join(' | ');
    $('neural-status').textContent=`Master NN: ${m.tactics_network.status} · ${m.tactics_network.samples} samples. Rotor NNs: ${m.rotor_networks.map(n=>n.blend?'10% blend':'fallback').join(' / ')}`;
    cards.forEach((card,i)=>{
      const d=m.drones[i],t=d.trajectory,o=s.tactics?.orders?.[i],meta=card.querySelector('.drone-tactic');
      meta.querySelector('b').textContent=o?.action||s.mode;meta.querySelector('span').textContent=t?`${t.horizon_seconds.toFixed(1)} s · ${t.kind} · ${!t.validated?'clearance unresolved':t.neural_applied?'NN adjusted':'map checked'}`:'Planning';
      const age=t?Math.max(0,s.time-(t.generated_at??s.time)):0;
      const delta=t?evaluateTrajectory(t,age+.05).position.map((v,k)=>v-evaluateTrajectory(t,age).position[k]):[];
      meta.querySelector('small').textContent=`XYZ ${s.drones[i].position.map((v,k)=>(v-s.reference_origin[k]).toFixed(1)).join(', ')} m`;meta.querySelector('small').title=`Fixed mission frame · next Δ50 ms ${delta.map(x=>x.toFixed(2)).join(', ')} m`;
      card.querySelectorAll('.four-rotors>div').forEach((row,k)=>{row.querySelector('em').style.width=`${d.rotors[k]/7*100}%`;row.querySelector('span').textContent=d.rotors[k].toFixed(2);row.title=`Command ${d.command[k].toFixed(3)} N · actual thrust ${d.rotors[k].toFixed(3)} N`;});
      if(t){const points=[evaluateTrajectory(t,age),...t.points.filter(p=>p.t>age)];curves[i].geometry.dispose();curves[i].geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p.position)));curves[i].visible=age<t.horizon_seconds;curves[i].userData.trajectory={drone:i,generated_at:t.generated_at,horizon_seconds:t.horizon_seconds};}
    });
    panel.dataset.sequence=String(m.sequence);panel.dataset.simTime=String(m.time);
  }
  function capture(pose){
    const i=pose.drone,camera=cameras[i],drone=getDrones()[i];camera.position.fromArray(pose.position);camera.up.fromArray(pose.up);camera.lookAt(new THREE.Vector3(...pose.position).add(new THREE.Vector3(...pose.direction)));camera.updateMatrixWorld();
    const ownVisible=drone.group.visible;drone.group.visible=false;
    renderer.setViewport(i*256,0,256,144);renderer.setScissor(i*256,0,256,144);renderer.render(scene,camera);drone.group.visible=ownVisible;posesCaptured[i]=pose;

  }
  function render(now){
    if(!state||(panel.hidden&&state.controller!=='python')||document.hidden||now<nextDue)return;nextDue=nextDue?nextDue+50:now+50;if(nextDue<now-50)nextDue=now+50;
    if(last){intervals.push(now-last);if(intervals.length>60)intervals.shift();}last=now;frames++;rateStart ||= now;
    // Restore physically opaque walls for onboard capture. Inspection cutaways,
    // ceiling hiding and labels belong only to the operator's overview camera.
    const visibility=[],materials=[],poses=[],oldTarget=renderer.getRenderTarget(),oldShadow=renderer.shadowMap.autoUpdate,oldViewport=renderer.getViewport(new THREE.Vector4()),oldScissor=renderer.getScissor(new THREE.Vector4()),oldScissorTest=renderer.getScissorTest();
    scene.traverse(o=>{if(o.isSprite||o.isLine||o.userData.cameraOverlay){visibility.push([o,o.visible]);o.visible=false;}if(o.userData.ceiling){visibility.push([o,o.visible]);o.visible=true;}if(o.material&&o.userData.baseOpacity!==undefined){const m=o.material;materials.push([m,m.opacity,m.transparent,m.depthWrite]);m.opacity=1;m.transparent=false;m.depthWrite=true;}});
    for(const o of getOverlays()){if(o){visibility.push([o,o.visible]);o.visible=false;}}
    getDrones().forEach((d,i)=>{poses.push([d.group,d.group.position.clone(),d.group.quaternion.clone()]);d.group.position.fromArray(state.drones[i].position);const q=state.drones[i].quaternion;d.group.quaternion.set(q[1],q[2],q[3],q[0]);});
    renderer.shadowMap.autoUpdate=false;
    try{
      renderer.setRenderTarget(target);renderer.setScissorTest(true);
      camera_master(state,capture);camera_slave1(state,capture);camera_slave2(state,capture);
      renderer.setScissorTest(false);renderer.readRenderTargetPixels(target,0,0,768,144,pixels);
      for(let i=0;i<3;i++){for(let y=0;y<144;y++){const start=((143-y)*768+i*256)*4;images[i].data.set(pixels.subarray(start,start+256*4),y*256*4);}contexts[i].putImageData(images[i],0,0);
        // Camera pixels stay unannotated. Plans have their own master-frame plot.
        canvases[i].dataset.pose=JSON.stringify(posesCaptured[i]);canvases[i].dataset.frame=String(frames);cards[i].querySelector('.camera-stamp').textContent=`t ${posesCaptured[i].time.toFixed(2)} · #${frames}`;}
    }
    finally{renderer.setRenderTarget(oldTarget);renderer.setViewport(oldViewport);renderer.setScissor(oldScissor);renderer.setScissorTest(oldScissorTest);renderer.shadowMap.autoUpdate=oldShadow;for(const [o,v]of visibility)o.visible=v;for(const [m,opacity,transparent,depthWrite]of materials)Object.assign(m,{opacity,transparent,depthWrite});for(const [o,p,q]of poses){o.position.copy(p);o.quaternion.copy(q);}}
    plot.updateCameraFrames(posesCaptured,state.reference_origin);
    if(state.running)for(let i=0;i<3;i++)if(state.time-lastKeyframe[i]>=1-1e-6){lastKeyframe[i]=state.time;keyframes.push({drone:i,time:state.time,pose:{...posesCaptured[i],position:posesCaptured[i].position.map((v,k)=>v-state.reference_origin[k]),frame:'mission_origin'},image:canvases[i].toDataURL('image/jpeg',.7)});if(keyframes.length>90)keyframes.shift();}
    plot.setKeyframes(keyframes);
    const average=intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:50;
    $('camera-rate').textContent=`${(1000/average).toFixed(1)} Hz · ${average.toFixed(0)} ms`;
    $('camera-timing').textContent=state.running?'Target: 50 ms · latest-frame delivery':'PAUSED · camera views remain available';
    panel.dataset.frames=String(frames);panel.dataset.intervalMs=String(average);
    if(onFrames&&state.controller==='python'){
      const packet=images.map((im,i)=>{const rgb=new Uint8Array(128*72*3);for(let y=0;y<72;y++)for(let x=0;x<128;x++){const from=(y*2*256+x*2)*4,to=(y*128+x)*3;rgb[to]=im.data[from];rgb[to+1]=im.data[from+1];rgb[to+2]=im.data[from+2];}let binary='';for(let k=0;k<rgb.length;k+=8192)binary+=String.fromCharCode(...rgb.subarray(k,k+8192));return {encoding:'rgb8-base64',width:128,height:72,data:btoa(binary),pose:JSON.parse(canvases[i].dataset.pose)};});
      onFrames(packet,state);
    }
  }
  return {update,render};
}
