import * as THREE from 'three';

export function createRouteEditor({renderer,camera,scene,getState,command,toast,onDrawing}) {
  const canvas=renderer.domElement,ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
  const material=new THREE.LineBasicMaterial({color:'#36d8dc',depthTest:false,transparent:true,opacity:.95});
  const preview=new THREE.Line(new THREE.BufferGeometry(),material);preview.renderOrder=20;scene.add(preview);
  let enabled=true,drawing=false,points=[],pointerId=null,resume=false,suppressClick=false;canvas.tabIndex=0;
  const $=id=>document.getElementById(id);
  function ground(e){const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(pointer,camera);const hit=new THREE.Vector3();return ray.ray.intersectPlane(plane,hit)?[hit.x,hit.y]:null;}
  function append(e){const p=ground(e);if(!p||Math.abs(p[0])>14||Math.abs(p[1])>14)return;if(!points.length||Math.hypot(p[0]-points.at(-1)[0],p[1]-points.at(-1)[1])>.3){points.push(p);if(points.length>256)points=points.filter((_,i)=>i%2===0);preview.geometry.dispose();preview.geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p,.08)));}}
  function setEnabled(value){enabled=value;$('draw-route').classList.toggle('active',value);canvas.style.cursor=value?'crosshair':'';$('route-help').textContent=value?'Draw a path, then press H for cover near the next waypoint. Cyan = your route; gold = drone guidance.':'Choose Draw path to control the person. Orbit lets you rotate the camera.';}
  canvas.addEventListener('pointerdown',e=>{
    if(!enabled||e.button!==0||e.altKey||e.shiftKey||!getState())return;
    if(getState().finished){toast('Reset the ended episode before drawing a route');return;}
    e.preventDefault();e.stopImmediatePropagation();canvas.focus({preventScroll:true});drawing=true;suppressClick=true;pointerId=e.pointerId;canvas.setPointerCapture(pointerId);resume=getState().running;points=[];onDrawing(true);command('pause');append(e);
  },true);
  canvas.addEventListener('pointermove',e=>{if(drawing){e.preventDefault();append(e);}},true);
  function finish(e,cancel=false){if(!drawing)return;drawing=false;append(e);if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);onDrawing(false);preview.geometry.dispose();preview.geometry=new THREE.BufferGeometry();
    suppressClick=!cancel&&points.length>=2;
    if(!cancel&&points.length>=2){command('actor_path',{points,endAction:$('path-end').value,pace:$('path-pace').value,allowGuidance:$('allow-guidance').checked,compliance:Number($('response').value)});if(resume)command('play');$('route-help').textContent='Path sent. The person follows it; drone exit guidance replans from visible observations.';}
    else if(resume)command('play');
    setTimeout(()=>{suppressClick=false;},0);
  }
  canvas.addEventListener('pointerup',e=>finish(e),true);canvas.addEventListener('pointercancel',e=>finish(e,true),true);
  canvas.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  $('draw-route').onclick=()=>setEnabled(!enabled);setEnabled(true);
  return {setEnabled,get drawing(){return drawing;}};
}
