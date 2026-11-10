core = open(__import__('os').path.join(__import__('os').path.dirname(__file__),'core.html')).read()

HEAD = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Swarm Mind — brain-steered 3-drone swarm tracking a mouse-driven intruder</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--bg:#05080e;--panel:#0a0f17;--glass:rgba(8,12,20,.72);--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.12);--text:#e6edf3;--muted:#7d8a99;--dim:#4b5563;
        --m:#22d3ee;--s1:#a3e635;--s2:#f472b6;--intr:#fb7185;--vec:#fbbf24;--site:#34d399;--you:#67e8f9}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:12.5px;-webkit-font-smoothing:antialiased}
  #app{display:grid;grid-template-columns:1fr 404px;height:100%}
  #view{position:relative;overflow:hidden;min-height:320px}
  #view canvas{display:block;width:100%;height:100%;cursor:crosshair}
  .mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
  .glass{background:var(--glass);border:1px solid var(--line);border-radius:12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  #bar{position:absolute;top:12px;left:12px;right:12px;display:flex;align-items:center;gap:8px;padding:7px 10px;pointer-events:auto;z-index:3;flex-wrap:wrap}
  .brand{display:flex;flex-direction:column;line-height:1.1;margin-right:6px}
  .brand b{font-size:14px;letter-spacing:.01em}
  .brand span{font-size:10px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-top:3px}
  .seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden;background:rgba(255,255,255,.02)}
  .seg button{border:0;border-right:1px solid var(--line);background:transparent;color:var(--text);padding:6px 9px;font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
  .seg button:last-child{border-right:0}
  .seg button:hover{background:rgba(255,255,255,.05)}
  .seg button.on{background:rgba(34,211,238,.16);color:#bff6ff;box-shadow:inset 0 0 0 1px rgba(34,211,238,.35)}
  .seg.goal button.on{background:rgba(251,191,36,.16);color:#ffe9a8;box-shadow:inset 0 0 0 1px rgba(251,191,36,.4)}
  .btn{border:1px solid var(--line2);background:rgba(255,255,255,.02);color:var(--text);padding:6px 9px;border-radius:9px;font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
  .btn:hover{background:rgba(255,255,255,.05)}
  .btn.on{background:rgba(52,211,153,.16);color:#bbf7d0;box-shadow:inset 0 0 0 1px rgba(52,211,153,.4)}
  .btn.danger.on{background:rgba(251,113,133,.16);color:#fecdd3;box-shadow:inset 0 0 0 1px rgba(251,113,133,.4)}
  .spacer{flex:1}
  .k{font-size:10px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
  #hud{position:absolute;top:66px;left:12px;padding:10px 12px;display:flex;gap:14px;align-items:center;pointer-events:none;z-index:2;max-width:min(640px,72%)}
  #cmd{width:58px;height:58px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;background:rgba(255,255,255,.03);border:1px solid var(--line2);transition:all .15s;color:var(--muted)}
  #cmd.L{color:var(--you);border-color:var(--you);transform:rotate(-8deg);box-shadow:0 0 24px rgba(103,232,249,.25)}
  #cmd.R{color:var(--vec);border-color:var(--vec);transform:rotate(8deg);box-shadow:0 0 24px rgba(251,191,36,.25)}
  #cmd.wrong{color:var(--intr);border-color:var(--intr)}
  #hudinfo{font-size:12px;line-height:1.5}
  #hudinfo b{font-size:13px;font-weight:600}
  #status{position:absolute;left:12px;bottom:12px;padding:9px 12px;font-size:12px;line-height:1.5;pointer-events:none;max-width:min(680px,74%)}
  #hint{position:absolute;right:12px;bottom:12px;padding:6px 10px;font-size:10.5px;color:var(--muted);pointer-events:none}
  #panel{border-left:1px solid var(--line);overflow:auto;padding:12px;display:flex;flex-direction:column;gap:14px;background:var(--panel)}
  h3{margin:0 0 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:8px}
  h3:after{content:"";flex:1;height:1px;background:var(--line)}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .tile{background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:9px;padding:7px 9px}
  .tile b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em}
  .tile span{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .card{border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:7px;background:rgba(255,255,255,.02);position:relative;overflow:hidden}
  .card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c)}
  .ch{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .ch b{font-size:13px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c)}
  .chip{margin-left:auto;font-size:9.5px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .chip.ok{background:rgba(52,211,153,.14);color:#86efac}
  .vec{display:grid;grid-template-columns:auto 1fr 1fr 1fr auto;gap:4px 10px;align-items:baseline;font-size:11.5px}
  .vec .l{color:var(--muted);font-size:10.5px}
  .vec .n{text-align:right}
  .vec .n.x{color:#fda4af}.vec .n.y{color:#86efac}.vec .n.z{color:#93c5fd}
  .row2{display:flex;gap:10px;margin-top:7px;align-items:flex-end}
  .gauge{flex:1}
  .gauge .k{margin-bottom:3px}
  .track{position:relative;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden}
  .track i{position:absolute;top:0;bottom:0;background:var(--c);border-radius:3px}
  .track.mid i{left:50%}
  .rotors{display:flex;gap:4px;align-items:flex-end;height:34px}
  .rotors div{flex:1;background:rgba(255,255,255,.06);border-radius:3px 3px 0 0;position:relative}
  .rotors div i{position:absolute;left:0;right:0;bottom:0;background:var(--c);border-radius:3px 3px 0 0;opacity:.85}
  .rotors div span{position:absolute;left:0;right:0;bottom:-13px;text-align:center;font-size:9px;color:var(--muted)}
  .sub{font-size:10.5px;color:var(--muted);margin-top:14px}
  #talk{max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:rgba(0,0,0,.25);font-size:11.5px;line-height:1.4}
  #talk div{margin:3px 0;display:flex;gap:8px;align-items:flex-start}
  #talk .t{color:var(--dim);font-size:10px;width:40px;flex:none;padding-top:2px}
  #talk .p{flex:none;font-size:9.5px;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}
  #talk .you .p{background:rgba(103,232,249,.15);color:var(--you)} #talk .you .x{color:#d9fbff;font-weight:600}
  #talk .intruder .p{background:rgba(251,113,133,.15);color:var(--intr)} #talk .intruder .x{color:#fecdd3}
  #talk .master .p{background:rgba(251,191,36,.15);color:var(--vec)} #talk .master .x{color:#fde68a}
  #talk .motor .p{background:rgba(255,255,255,.06);color:var(--muted)} #talk .motor .x{color:#8b96a5;font-size:10.5px}
  #talk .site .p{background:rgba(52,211,153,.15);color:var(--site)} #talk .site .x{color:#bbf7d0}
  canvas.chart{width:100%;height:auto;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25)}
  .law{border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin-bottom:7px;background:rgba(255,255,255,.02)}
  .law b{display:block;font-size:12px;margin-bottom:3px}
  .law .f{font-size:10.5px;color:#c7d2fe;margin:3px 0;white-space:pre-wrap}
  .law p{margin:3px 0;font-size:11px;color:var(--muted);line-height:1.45}
  .row{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px}
  .row span:first-child{width:64px;color:var(--text)}
  .row input[type=range]{flex:1;min-width:60px;accent-color:#22d3ee}
  .row .v{width:66px;text-align:right;font-size:10.5px}
  textarea,input[type=text]{width:100%;background:rgba(0,0,0,.3);color:var(--text);border:1px solid var(--line2);border-radius:9px;font:11px "JetBrains Mono",ui-monospace,monospace;padding:7px}
  textarea{height:64px}
  .src{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
  .small{font-size:11px;color:var(--muted);line-height:1.45}
  details{border:1px solid var(--line);border-radius:10px;padding:7px 11px;font-size:12px;line-height:1.5}
  summary{cursor:pointer;font-weight:600;font-size:12px}
  details p{margin:6px 0;color:#b8c2cc}
  .log{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;line-height:1.45;max-height:160px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px 8px;background:rgba(0,0,0,.25)}
  .log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .log .t{color:var(--dim);margin-right:6px}
  .log .alert{color:var(--intr)} .log .good{color:var(--site)} .log .warn{color:var(--vec)} .log .cmd{color:#c7d2fe}
  .err{padding:20px;color:var(--intr)}
  @media (max-width:980px){
    #app{grid-template-columns:1fr;grid-template-rows:58vh 1fr}
    #panel{border-left:none;border-top:1px solid var(--line)}
    #bar{flex-wrap:wrap;gap:6px;padding:6px}
    #hud{top:auto;bottom:64px;max-width:90%}
    #status{max-width:92%}
    #hint{display:none}
  }
</style>
</head>
<body>
<div id="app">
  <div id="view">
    <div id="bar" class="glass">
      <div class="brand"><b>Swarm Mind</b><span>master · 2 slaves</span></div>
      <div class="seg goal" id="goalseg"><button data-goal="keepout" class="on">Keep him out</button><button data-goal="driveout">Drive him out</button><button data-goal="track">Track him</button><button data-goal="hold">Hold</button></div>
      <div class="seg" id="srcseg"><button data-src="keys" class="on">Keys</button><button data-src="sim">Sim BCI</button><button data-src="replay">Log</button><button data-src="live">Live</button></div>
      <button class="btn" id="voice">Voice off</button>
      <div class="spacer"></div>
      <div class="seg" id="modeseg"><button data-mode="mind" class="on">Mind</button><button data-mode="mouse">Mouse</button><button data-mode="wander">Wander</button></div>
      <button class="btn" id="auto">Pulses off</button>
      <button class="btn" id="play">Pause</button>
      <button class="btn" id="reset">Reset</button>
      <div class="seg" id="speed"><button data-s="1" class="on">1×</button><button data-s="2">2×</button></div>
      <div class="seg"><button id="orbit" class="on">Orbit</button><button id="top">Top</button><button id="chase">Chase</button></div>
    </div>
    <div id="hud" class="glass"><div id="cmd">·</div><div id="hudinfo"></div></div>
    <div id="status" class="glass"></div>
    <div id="hint" class="glass">1 2 3 4 goals · ← → rotate formation · click ground: move him · c chase · p pause · r reset</div>
  </div>
  <aside id="panel">
    <section><div class="tiles" id="metrics"></div></section>
    <section><h3>Conversation <button class="btn" id="narrate" style="padding:2px 8px;font-size:10px">every tick</button></h3><div id="talk"></div></section>
    <section><h3>Drones · vector from master → rotor layer</h3><div id="cards"></div></section>
    <section><h3>Map</h3><canvas id="mini" class="chart" width="480" height="440"></canvas></section>
    <section>
      <h3>Brain link</h3>
      <div id="srcbox" class="small"></div>
      <div id="replaybox" style="display:none"><textarea id="replaytxt" placeholder="t_seconds,cmd  (cmd = L | R | N)&#10;0.0,N&#10;1.2,L&#10;2.4,L&#10;4.0,R"></textarea><div class="src"><input type="file" id="replayfile" accept=".csv,.txt,.log" style="width:auto"><button class="btn" id="replayload">Load and play</button></div></div>
      <div id="livebox" style="display:none"><div class="src"><input type="text" id="wsurl" value="ws://localhost:8765" style="flex:1"><button class="btn" id="wsconnect">Connect</button></div><div class="small">1 text frame per decision: <code>L</code>, <code>R</code> or <code>N</code>, or JSON <code>{"cmd":"L"}</code>. The hosted page cannot open sockets; open the page from a local file for a live run.</div></div>
      <canvas id="tl" class="chart" width="480" height="70" style="margin-top:8px"></canvas>
    </section>
    <section><h3>Surprise budget sweep <button class="btn" id="sweepbtn" style="padding:2px 8px;font-size:10px">run</button></h3><canvas id="sweepc" class="chart" width="480" height="150"></canvas><div class="small" id="sweepinfo" style="margin-top:6px">In-view % against budget B, 4 seeds × 60 s, autopilot (solid) and simulated BCI (dashed). Press run.</div></section>
    <section><h3>The laws</h3><div id="laws"></div></section>
    <details><summary>Radio log</summary><div id="log" class="log" style="margin-top:6px"></div></details>
    <details>
      <summary>How it works</summary>
      <p><b>The loop.</b> You speak a goal (buttons, keys 1 to 4; ← → rotate the formation by 15°). The intruder has its own mind: picks the closest door, hides under trees when a drone comes near, backs off when pressed, gives up after 3 pushes or 6 s of challenge, goes inside on a breach and comes out again.</p>
      <p><b>The split.</b> Every 0.5 s the master picks a template for the goal, computes 3 points, assigns them and issues 3 full 3-D vectors. It keeps 1 and radios 2 to the slaves, with latency and packet loss (law L4m).</p>
      <p><b>The rotor layer.</b> A slave never plans. It sets target = own position + received vector and runs a quadrotor controller: thrust, roll and pitch with an attitude time constant, then a 4-rotor mixer. The arrows in the scene are those vectors, with 1 m ticks. The master runs the same loop on its own vector.</p>
      <p><b>Test bench.</b> Keys stand in for your 2 EEG classes, Sim BCI is a classifier with accuracy and latency, Replay takes a timestamped log, Live takes a websocket. Sweep finds the surprise budget that maximises time in view.</p>
    </details>
  </aside>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
'''

UI = r'''
<script id="app-ui">
(function(){
'use strict';
const $=s=>document.querySelector(s);
const view=$('#view');
if(typeof THREE==='undefined'){ view.innerHTML='<div class="err">The 3D library did not load. Please reload the page.</div>'; return; }
let running=true,speed=1;
const C={m:0x22d3ee,s1:0xa3e635,s2:0xf472b6,intr:0xfb7185,vec:0xfbbf24,site:0x34d399};
const CSS=['#22d3ee','#a3e635','#f472b6'];

// ---------- renderer / camera ----------
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputEncoding=THREE.sRGBEncoding; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
view.appendChild(renderer.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x05080e).convertSRGBToLinear(); scene.fog=new THREE.Fog(new THREE.Color(0x05080e).convertSRGBToLinear(),120,260);
const camera=new THREE.PerspectiveCamera(46,1,0.1,600);
const HOME={theta:0.42,phi:0.98,r:62,tx:24,ty:0,tz:24};
const cam=Object.assign({},HOME);
function applyCam(){ camera.position.set(cam.tx+cam.r*Math.sin(cam.phi)*Math.sin(cam.theta),cam.ty+cam.r*Math.cos(cam.phi),cam.tz+cam.r*Math.sin(cam.phi)*Math.cos(cam.theta)); camera.lookAt(cam.tx,cam.ty,cam.tz); }
function resize(){ const w=view.clientWidth||800,h=view.clientHeight||500; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); const bar=$('#bar'); if(bar&&window.innerWidth>980)$('#hud').style.top=(bar.offsetTop+bar.offsetHeight+10)+'px'; }
window.addEventListener('resize',resize); resize(); applyCam(); setTimeout(resize,50);
const ptrs=new Map(); let lastPinch=0, lastPtr=null;
renderer.domElement.addEventListener('pointerdown',e=>{ ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,b:e.button,sx:e.clientX,sy:e.clientY}); renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId); if(!p)return;
  if(ptrs.size===2){ const a=Array.from(ptrs.values()); const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); if(lastPinch)cam.r=clamp(cam.r*lastPinch/d,12,140); lastPinch=d; p.x=e.clientX;p.y=e.clientY; applyCam(); return; }
  const dx=e.clientX-p.x,dy=e.clientY-p.y; p.x=e.clientX;p.y=e.clientY;
  if(p.b===2||e.shiftKey){ const s=cam.r*0.0015; const fx=Math.sin(cam.theta),fz=Math.cos(cam.theta); cam.tx+=(dx*fz-dy*fx)*s; cam.tz+=(dx*fx+dy*fz)*s; cam.tx=clamp(cam.tx,0,W); cam.tz=clamp(cam.tz,0,H); }
  else{ cam.theta-=dx*0.005; cam.phi=clamp(cam.phi-dy*0.005,0.08,1.5); }
  applyCam();
});
const endPtr=e=>{ const p=ptrs.get(e.pointerId); lastPtr=p||null; ptrs.delete(e.pointerId); if(ptrs.size<2)lastPinch=0; };
renderer.domElement.addEventListener('pointerup',e=>{ endPtr(e); const p=lastPtr; if(p&&p.b===0&&Math.hypot(e.clientX-p.sx,e.clientY-p.sy)<6)clickGround(e); });
renderer.domElement.addEventListener('pointercancel',endPtr);
renderer.domElement.addEventListener('wheel',e=>{ e.preventDefault(); cam.r=clamp(cam.r*(1+e.deltaY*0.001),12,140); applyCam(); },{passive:false});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0x9fb8d8,0x0b1220,0.55));
const key=new THREE.DirectionalLight(0xffffff,1.0); key.position.set(38,70,46); key.target.position.set(24,0,22); scene.add(key.target); key.castShadow=true;
key.shadow.mapSize.set(window.innerWidth<980?1024:2048,window.innerWidth<980?1024:2048); const sc=key.shadow.camera; sc.left=-50;sc.right=50;sc.top=50;sc.bottom=-50;sc.near=1;sc.far=200; key.shadow.bias=-0.0004; scene.add(key);
const rim=new THREE.DirectionalLight(0x3fc7ff,0.35); rim.position.set(-40,30,-30); scene.add(rim);

// ---------- helpers ----------
const col=c=>new THREE.Color(c).convertSRGBToLinear();
const M=(c,o)=>{ const m=new THREE.MeshStandardMaterial(Object.assign({color:col(c),roughness:0.85},o||{})); if(o&&o.emissive!==undefined)m.emissive=col(o.emissive); return m; };
const B=(c,o)=>new THREE.MeshBasicMaterial(Object.assign({color:col(c)},o||{}));
function box(sx,sy,sz,x,y,z,mat,shadow){ const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat); m.position.set(x,y,z); if(shadow!==false){m.castShadow=true;m.receiveShadow=true;} scene.add(m); return m; }
function edges(sx,sy,sz,x,y,z,color,op){ const e=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sx,sy,sz)),new THREE.LineBasicMaterial({color:col(color),transparent:true,opacity:op||0.3})); e.position.set(x,y,z); scene.add(e); return e; }
function glowTex(){ const c=document.createElement('canvas'); c.width=c.height=64; const g=c.getContext('2d'); const r=g.createRadialGradient(32,32,2,32,32,30); r.addColorStop(0,'rgba(255,255,255,1)'); r.addColorStop(0.3,'rgba(255,255,255,.45)'); r.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=r; g.fillRect(0,0,64,64); const t=new THREE.CanvasTexture(c); return t; }
const GLOW=glowTex();
function glow(color,size){ const s=new THREE.Sprite(new THREE.SpriteMaterial({map:GLOW,color:col(color),transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending})); s.scale.set(size,size,1); scene.add(s); return s; }
function makeLabel(scale,px){ const c=document.createElement('canvas'); c.width=640; c.height=96; const tex=new THREE.CanvasTexture(c); tex.minFilter=THREE.LinearFilter; const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false})); sp.scale.set(scale,scale*96/640,1); scene.add(sp); return {sprite:sp,canvas:c,tex,text:'',px:px||36}; }
function setLabel(l,text,color,bg){ if(l.text===text)return; l.text=text; const ctx=l.canvas.getContext('2d'); ctx.clearRect(0,0,640,96); ctx.font='600 '+l.px+'px "JetBrains Mono", ui-monospace, monospace'; const w=Math.min(630,ctx.measureText(text).width+36); const x=(640-w)/2; ctx.fillStyle=bg||'rgba(5,8,14,0.82)'; ctx.beginPath(); ctx.moveTo(x+12,16); ctx.arcTo(x+w,16,x+w,80,12); ctx.arcTo(x+w,80,x,80,12); ctx.arcTo(x,80,x,16,12); ctx.arcTo(x,16,x+w,16,12); ctx.closePath(); ctx.fill(); ctx.strokeStyle=color; ctx.globalAlpha=0.5; ctx.lineWidth=2; ctx.stroke(); ctx.globalAlpha=1; ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text,320,48,610); l.tex.needsUpdate=true; }
function line2(color,n,op){ const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3)); geo.setDrawRange(0,0); const l=new THREE.Line(geo,new THREE.LineBasicMaterial({color:col(color),transparent:true,opacity:op||0.8})); l.frustumCulled=false; scene.add(l); return l; }
function setLine(l,pts){ const a=l.geometry.attributes.position; const n=Math.min(pts.length,a.count); for(let i=0;i<n;i++)a.setXYZ(i,pts[i].x,pts[i].y,pts[i].z); a.needsUpdate=true; l.geometry.setDrawRange(0,n); l.visible=n>1; }

// ---------- static scene ----------
const ground=new THREE.Mesh(new THREE.PlaneGeometry(600,600),M(0x070b12,{roughness:1})); ground.rotation.x=-Math.PI/2; ground.position.set(24,-0.03,22); ground.receiveShadow=true; scene.add(ground);
const floorCanvas=document.createElement('canvas'); floorCanvas.width=W*24; floorCanvas.height=H*24; const floorCtx=floorCanvas.getContext('2d');
const floorTex=new THREE.CanvasTexture(floorCanvas); floorTex.anisotropy=renderer.capabilities.getMaxAnisotropy(); floorTex.encoding=THREE.sRGBEncoding;
const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,H),M(0xffffff,{map:floorTex,roughness:0.95})); floor.rotation.x=-Math.PI/2; floor.position.set(W/2,0,H/2); floor.receiveShadow=true; scene.add(floor);
const clickables=[floor];
// site edge glow
{ const pts=[[0,0],[W,0],[W,H],[0,H],[0,0]].map(p=>({x:p[0],y:0.05,z:p[1]})); const l=line2(C.m,5,0.5); setLine(l,pts); }
// fence
const fenceMat=new THREE.MeshStandardMaterial({color:col(0x8fa3bf),transparent:true,opacity:0.1,roughness:0.5,metalness:0.2,side:THREE.DoubleSide,depthWrite:false});
const postMat=M(0x334155,{metalness:0.4,roughness:0.5});
box(W,1.6,0.04,W/2,0.8,0.3,fenceMat,false); box(W,1.6,0.04,W/2,0.8,H-0.3,fenceMat,false); box(0.04,1.6,H,0.3,0.8,H/2,fenceMat,false); box(0.04,1.6,H,W-0.3,0.8,H/2,fenceMat,false);
for(let x=0.3;x<=W-0.3;x+=4)for(const z of [0.3,H-0.3]){ const p=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,1.7,6),postMat); p.position.set(x,0.85,z); scene.add(p); }
for(let z=0.3;z<=H-0.3;z+=4)for(const x of [0.3,W-0.3]){ const p=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,1.7,6),postMat); p.position.set(x,0.85,z); scene.add(p); }
// building
const wallMat=M(0x1b2634,{roughness:0.6,metalness:0.3}); const wallTop=M(0x2a3647,{metalness:0.4,roughness:0.5});
const glassMat=new THREE.MeshStandardMaterial({color:col(0x67e8f9),transparent:true,opacity:0.22,roughness:0.08,metalness:0.6,emissive:col(0x1aa3c7),emissiveIntensity:0.35,side:THREE.DoubleSide,depthWrite:false});
const frameMat=M(0x0b1220,{metalness:0.5,roughness:0.4});
const doorMat=new THREE.MeshStandardMaterial({color:col(0x34d399),emissive:col(0x34d399),emissiveIntensity:0.9,roughness:0.4});
function wallPiece(w,c0,c1,y0,y1,mat){ const len=c1-c0; if(len<=0.01)return; const h=y1-y0; const mid=(c0+c1)/2, y=(y0+y1)/2; if(w.side==='S'||w.side==='N')box(len,h,WALL_T,mid,y,w.z,mat); else box(WALL_T,h,len,w.x,y,mid,mat); }
function buildWall(w){
  const horiz=w.side==='S'||w.side==='N'; const a0=horiz?w.x0:w.z0, a1=horiz?w.x1:w.z1; const ops=[];
  for(const d of DOORS)if(d.side===w.side)ops.push({c:horiz?d.x:d.z,w:d.w,y0:d.h,y1:d.h+2.5,type:'door',door:d});
  for(const win of WINDOWS)if(win.side===w.side)ops.push({c:win.c,w:win.w,y0:1.2,y1:2.8,type:'win'});
  ops.sort((p,q)=>p.c-q.c); let cur=a0;
  for(const o of ops){ const c0=o.c-o.w/2,c1=o.c+o.w/2; wallPiece(w,cur,c0,0,WALL_H,wallMat); if(o.y0>0)wallPiece(w,c0,c1,0,o.y0,wallMat); wallPiece(w,c0,c1,o.y1,WALL_H,wallMat);
    if(o.type==='win'){ const len=c1-c0,h=o.y1-o.y0,mid=(c0+c1)/2,y=(o.y0+o.y1)/2; const g=horiz?box(len,h,0.04,mid,y,w.z,glassMat,false):box(0.04,h,len,w.x,y,mid,glassMat,false); g.castShadow=false;
      if(horiz){ box(len+0.1,0.07,0.12,mid,o.y0,w.z,frameMat);box(len+0.1,0.07,0.12,mid,o.y1,w.z,frameMat);box(0.07,h,0.12,c0,y,w.z,frameMat);box(0.07,h,0.12,c1,y,w.z,frameMat); }
      else{ box(0.12,0.07,len+0.1,w.x,o.y0,mid,frameMat);box(0.12,0.07,len+0.1,w.x,o.y1,mid,frameMat);box(0.12,h,0.07,w.x,y,c0,frameMat);box(0.12,h,0.07,w.x,y,c1,frameMat); } }
    else{ const h=o.y1-o.y0,y=(o.y0+o.y1)/2; if(horiz){ box(0.2,h,0.36,c0,y,w.z,doorMat); box(0.2,h,0.36,c1,y,w.z,doorMat); box(o.w+0.2,0.2,0.36,o.c,o.y1,w.z,doorMat); } else{ box(0.36,h,0.2,w.x,y,c0,doorMat); box(0.36,h,0.2,w.x,y,c1,doorMat); box(0.36,0.2,o.w+0.2,w.x,o.y1,o.c,doorMat); }
      const pad=new THREE.Mesh(new THREE.PlaneGeometry(horiz?o.w+0.4:2.6,horiz?2.6:o.w+0.4),B(0x34d399,{transparent:true,opacity:0.18,depthWrite:false})); pad.rotation.x=-Math.PI/2; pad.position.set(o.door.x,o.door.h+0.03,o.door.z); scene.add(pad); }
    cur=c1; }
  wallPiece(w,cur,a1,0,WALL_H,wallMat);
  if(horiz)box(a1-a0+WALL_T,0.08,WALL_T+0.1,(a0+a1)/2,WALL_H,w.z,wallTop); else box(WALL_T+0.1,0.08,a1-a0+WALL_T,w.x,WALL_H,(a0+a1)/2,wallTop);
}
for(const w of WALLS)buildWall(w);
for(const [x,z] of [[6,3],[42,3],[6,19],[42,19]])box(0.5,WALL_H+0.1,0.5,x,(WALL_H+0.1)/2,z,M(0x0f172a,{metalness:0.5}));
{ const roof=box(BLD.x1-BLD.x0,0.1,BLD.z1-BLD.z0,(BLD.x0+BLD.x1)/2,WALL_H+0.05,(BLD.z0+BLD.z1)/2,new THREE.MeshStandardMaterial({color:col(0x111827),transparent:true,opacity:0.5,roughness:0.9,side:THREE.DoubleSide}),false); roof.receiveShadow=true;
  edges(BLD.x1-BLD.x0,WALL_H,BLD.z1-BLD.z0,(BLD.x0+BLD.x1)/2,WALL_H/2,(BLD.z0+BLD.z1)/2,C.m,0.22); }
const rackMat=M(0x6b3a1a,{roughness:0.75,metalness:0.15}); const shelfMat=M(0x3b4453,{roughness:0.6,metalness:0.4});
for(const r of racks){ const sx=r.x1-r.x0,sz=r.z1-r.z0,cx=(r.x0+r.x1)/2,cz=(r.z0+r.z1)/2; box(sx,RACK_H,sz,cx,RACK_H/2,cz,rackMat); for(const y of [0.6,1.2,RACK_H])box(sx+0.08,0.05,sz+0.08,cx,y,cz,shelfMat); edges(sx,RACK_H,sz,cx,RACK_H/2,cz,0xd6a26a,0.18); }
const concrete=M(0x222b38,{roughness:0.95}); const concTop=M(0x2e3948,{roughness:0.9});
for(const p of PLATFORMS){ const sx=p.x1-p.x0,sz=p.z1-p.z0; clickables.push(box(sx,PLAT_H,sz,(p.x0+p.x1)/2,PLAT_H/2,(p.z0+p.z1)/2,concrete)); box(sx,0.05,sz,(p.x0+p.x1)/2,PLAT_H,(p.z0+p.z1)/2,concTop); }
for(const s of STAIRS){ const n=7; for(let k=1;k<=n;k++){ const hgt=PLAT_H*(n+1-k)/n; if(s.axis==='z'){ const z0=s.hi+(k-1)*(s.lo-s.hi)/n, z1=s.hi+k*(s.lo-s.hi)/n; clickables.push(box(s.x1-s.x0,hgt,Math.abs(z1-z0),(s.x0+s.x1)/2,hgt/2,(z0+z1)/2,k%2?concrete:concTop)); } else { const x0=s.hi+(k-1)*(s.lo-s.hi)/n, x1=s.hi+k*(s.lo-s.hi)/n; clickables.push(box(Math.abs(x1-x0),hgt,s.z1-s.z0,(x0+x1)/2,hgt/2,(s.z0+s.z1)/2,k%2?concrete:concTop)); } } }
const railMat=M(0x94a3b8,{metalness:0.7,roughness:0.35});
function railing(x0,z0,x1,z1,y){ const L=Math.hypot(x1-x0,z1-z0); const mid={x:(x0+x1)/2,z:(z0+z1)/2}; const ang=Math.atan2(-(z1-z0),x1-x0);
  for(const yy of [y+0.5,y+1.0]){ const r=new THREE.Mesh(new THREE.BoxGeometry(L,0.04,0.04),railMat); r.position.set(mid.x,yy,mid.z); r.rotation.y=ang; scene.add(r); }
  const n=Math.max(1,Math.round(L/1.5)); for(let k=0;k<=n;k++){ const t=k/n; const p=new THREE.Mesh(new THREE.BoxGeometry(0.05,1.05,0.05),railMat); p.position.set(x0+(x1-x0)*t,y+0.52,z0+(z1-z0)*t); scene.add(p); } }
railing(6,15,16,15,PLAT_H); railing(16,15,16,16,PLAT_H); railing(6,19,6,24,PLAT_H); railing(6,24,8,24,PLAT_H); railing(12,24,16,24,PLAT_H); railing(16,19,16,20,PLAT_H); railing(16,23,16,24,PLAT_H);
railing(8,24,8,27,0.7); railing(12,24,12,27,0.7); railing(16,20,19,20,0.7); railing(16,23,19,23,0.7); railing(16,16,19,16,0.7);
const trunkMat=M(0x2b1d12,{roughness:0.95}); const leafA=M(0x0e3b2e,{roughness:1,flatShading:true}); const leafB=M(0x124a39,{roughness:1,flatShading:true});
for(const t of TREES){ const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.3,2.6,7),trunkMat); tr.position.set(t.x,1.3,t.z); tr.castShadow=true; scene.add(tr);
  const c1=new THREE.Mesh(new THREE.IcosahedronGeometry(TREE_R*0.95,1),leafA); c1.position.set(t.x,3.8,t.z); c1.castShadow=true; scene.add(c1);
  const c2=new THREE.Mesh(new THREE.IcosahedronGeometry(TREE_R*0.65,1),leafB); c2.position.set(t.x+0.8,4.8,t.z-0.4); c2.castShadow=true; scene.add(c2);
  const c3=new THREE.Mesh(new THREE.IcosahedronGeometry(TREE_R*0.55,1),leafB); c3.position.set(t.x-0.9,4.5,t.z+0.6); c3.castShadow=true; scene.add(c3); }
const contMats=[M(0x7a2e12,{roughness:0.6,metalness:0.35}),M(0x1f3a8a,{roughness:0.6,metalness:0.35})];
for(const c of CONTAINERS){ const sx=c.x1-c.x0,sz=c.z1-c.z0,cx=(c.x0+c.x1)/2,cz=(c.z0+c.z1)/2; box(sx,2.6,sz,cx,1.3,cz,contMats[c.c]); edges(sx,2.6,sz,cx,1.3,cz,0xffffff,0.12); }
for(const d of DOCK){ const m=new THREE.Mesh(new THREE.RingGeometry(0.55,0.68,32),B(0x334155,{transparent:true,opacity:0.7,side:THREE.DoubleSide})); m.rotation.x=-Math.PI/2; m.position.set(d.x,0.02,d.z); scene.add(m); }

// ---------- drones ----------
function buildDrone(color,isLeader){
  const g=new THREE.Group(); const sc=isLeader?1.3:1;
  const body=new THREE.Mesh(new THREE.BoxGeometry(0.56*sc,0.14*sc,0.56*sc),M(0x0f172a,{roughness:0.35,metalness:0.6})); body.castShadow=true; g.add(body);
  const strip=new THREE.Mesh(new THREE.BoxGeometry(0.58*sc,0.04,0.12*sc),new THREE.MeshBasicMaterial({color:col(color)})); strip.position.set(0,0.06,0); g.add(strip);
  const armMat=M(0x1f2937,{metalness:0.5,roughness:0.5});
  for(const a of [Math.PI/4,-Math.PI/4]){ const arm=new THREE.Mesh(new THREE.BoxGeometry(1.3*sc,0.05,0.07),armMat); arm.rotation.y=a; arm.castShadow=true; g.add(arm); }
  const blades=[]; const discMat=new THREE.MeshBasicMaterial({color:col(color),transparent:true,opacity:0.18,side:THREE.DoubleSide,depthWrite:false});
  for(const s of [[1,1],[1,-1],[-1,1],[-1,-1]]){ const hub=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.1,8),armMat); hub.position.set(s[0]*0.46*sc,0.07,s[1]*0.46*sc); g.add(hub);
    const disc=new THREE.Mesh(new THREE.CircleGeometry(0.32*sc,24),discMat); disc.rotation.x=-Math.PI/2; disc.position.set(s[0]*0.46*sc,0.12,s[1]*0.46*sc); g.add(disc);
    const blade=new THREE.Mesh(new THREE.BoxGeometry(0.62*sc,0.012,0.06),B(0xcbd5e1)); blade.position.set(s[0]*0.46*sc,0.13,s[1]*0.46*sc); g.add(blade); blades.push(blade); }
  if(isLeader){ const nose=new THREE.Mesh(new THREE.ConeGeometry(0.14,0.5,10),B(color)); nose.rotation.x=Math.PI/2; nose.position.set(0,0,0.62); g.add(nose); }
  const led=new THREE.Mesh(new THREE.SphereGeometry(0.07,10,10),B(color)); led.position.set(0,-0.1,0); g.add(led);
  const light=new THREE.PointLight(color,0.6,8); light.position.set(0,-0.4,0); g.add(light);
  scene.add(g);
  const halo=glow(color,isLeader?2.6:2.0);
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.985,1,96),B(color,{transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false})); ring.rotation.x=-Math.PI/2; scene.add(ring);
  const fill=new THREE.Mesh(new THREE.CircleGeometry(1,96),B(color,{transparent:true,opacity:0.05,side:THREE.DoubleSide,depthWrite:false})); fill.rotation.x=-Math.PI/2; scene.add(fill);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(0.02,1,1,40,1,true),B(color,{transparent:true,opacity:0.035,side:THREE.DoubleSide,depthWrite:false})); scene.add(beam);
  // vector arrow: shaft + head + ticks + label; slot ring + plumb line
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,1,10),B(color)); scene.add(shaft);
  const head=new THREE.Mesh(new THREE.ConeGeometry(0.2,0.55,14),B(color)); scene.add(head);
  const ticks=[]; for(let k=0;k<24;k++){ const t=new THREE.Mesh(new THREE.TorusGeometry(0.16,0.022,6,20),B(color,{transparent:true,opacity:0.9})); t.visible=false; scene.add(t); ticks.push(t); }
  const vlabel=makeLabel(6.8,34);
  const slot=new THREE.Mesh(new THREE.RingGeometry(0.42,0.52,40),B(color,{transparent:true,opacity:0.85,side:THREE.DoubleSide,depthWrite:false})); slot.rotation.x=-Math.PI/2; scene.add(slot);
  const plumb=line2(color,2,0.25);
  const label=makeLabel(5.4,34);
  return {group:g,blades,halo,ring,fill,beam,shaft,head,ticks,vlabel,slot,plumb,label,ringMat:ring.material,fillMat:fill.material};
}
const views=[buildDrone(C.m,true),buildDrone(C.s1,false),buildDrone(C.s2,false)];
const UP=new THREE.Vector3(0,1,0);
function placeArrow(v,from,to){
  const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z; const L=Math.hypot(dx,dy,dz);
  if(L<0.35){ v.shaft.visible=false; v.head.visible=false; for(const t of v.ticks)t.visible=false; v.vlabel.sprite.visible=false; return; }
  const dir=new THREE.Vector3(dx/L,dy/L,dz/L); const q=new THREE.Quaternion().setFromUnitVectors(UP,dir);
  const sL=Math.max(0.05,L-0.5); v.shaft.visible=true; v.shaft.scale.set(1,sL,1); v.shaft.position.set(from.x+dir.x*sL/2,from.y+dir.y*sL/2,from.z+dir.z*sL/2); v.shaft.quaternion.copy(q);
  v.head.visible=true; v.head.position.set(from.x+dir.x*(L-0.27),from.y+dir.y*(L-0.27),from.z+dir.z*(L-0.27)); v.head.quaternion.copy(q);
  const n=Math.min(v.ticks.length,Math.floor(L-0.3)); for(let k=0;k<v.ticks.length;k++){ const t=v.ticks[k]; if(k<n){ t.visible=true; const d=k+1; t.position.set(from.x+dir.x*d,from.y+dir.y*d,from.z+dir.z*d); t.quaternion.copy(q); t.rotation.x+=Math.PI/2; t.scale.setScalar(d%5===0?1.5:1); } else t.visible=false; }
  v.vlabel.sprite.visible=true; v.vlabel.sprite.position.set(to.x,to.y+0.75,to.z);
}
const tetherMats=[0,1].map(()=>new THREE.LineBasicMaterial({color:col(0x94a3b8),transparent:true,opacity:0.9}));
const tethers=tetherMats.map(mt=>{ const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(16*3),3)); const l=new THREE.Line(geo,mt); l.frustumCulled=false; scene.add(l); return l; });
const radioLines=[0,1].map(()=>{ const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(2*3),3)); const l=new THREE.Line(geo,new THREE.LineDashedMaterial({color:col(C.m),dashSize:0.5,gapSize:0.35,transparent:true,opacity:0.35})); l.frustumCulled=false; scene.add(l); return l; });
const packets=[0,1].map(()=>glow(C.m,0.9));
// intruder
const intrG=new THREE.Group();
const intrBody=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.26,1.1,14),M(0x1f2937,{roughness:0.6,metalness:0.2})); intrBody.position.y=0.75; intrBody.castShadow=true; intrG.add(intrBody);
const intrHead=new THREE.Mesh(new THREE.SphereGeometry(0.17,14,14),M(0xf1d3c0,{roughness:0.7})); intrHead.position.y=1.5; intrHead.castShadow=true; intrG.add(intrHead);
const intrRing=new THREE.Mesh(new THREE.RingGeometry(0.5,0.62,40),B(C.intr,{transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false})); intrRing.rotation.x=-Math.PI/2; intrRing.position.y=0.03; intrG.add(intrRing);
scene.add(intrG); const intrHalo=glow(C.intr,2.2);
const intrLabel=makeLabel(7,34);
const moveMarker=new THREE.Mesh(new THREE.RingGeometry(0.5,0.66,40),B(C.vec,{transparent:true,opacity:0.9,side:THREE.DoubleSide,depthWrite:false})); moveMarker.rotation.x=-Math.PI/2; moveMarker.visible=false; scene.add(moveMarker);
const movePath=line2(C.vec,64,0.8);
const ray=new THREE.Raycaster(); const ndc=new THREE.Vector2();
function clickGround(e){ const r=renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1); ray.setFromCamera(ndc,camera); const hits=ray.intersectObjects(clickables,false); if(!hits.length)return; const h=hits[0].point; if(h.x<0.5||h.x>W-0.5||h.z<0.5||h.z>H-0.5)return; if(intruder.mode!=='mouse')setMode('mouse'); intruder.goTo(h.x,h.z); say('intruder','(you move me) going to ('+h.x.toFixed(0)+', '+h.z.toFixed(0)+').'); }

// ---------- map (floor texture + minimap) ----------
function drawMap(ctx,s,entities){
  ctx.fillStyle='#0b1019'; ctx.fillRect(0,0,W*s,H*s);
  ctx.fillStyle='#111926'; ctx.fillRect(BLD.x0*s,BLD.z0*s,(BLD.x1-BLD.x0)*s,(BLD.z1-BLD.z0)*s);
  for(const p of PLATFORMS){ ctx.fillStyle='#172031'; ctx.fillRect(p.x0*s,p.z0*s,(p.x1-p.x0)*s,(p.z1-p.z0)*s); }
  for(const st of STAIRS){ ctx.fillStyle='#1c2638'; ctx.fillRect(st.x0*s,st.z0*s,(st.x1-st.x0)*s,(st.z1-st.z0)*s); }
  if(settings.mode>=1){ let pmax=1e-9; for(let k=0;k<NC;k++)if(S[k]>pmax)pmax=S[k]; for(let k=0;k<NC;k++){ if(!wk[k]||insideCell[k])continue; const a=Math.sqrt(S[k]/pmax); if(a<0.08)continue; const cx=k%CX,cz=(k-cx)/CX; ctx.fillStyle='rgba(251,191,36,'+(0.22*a).toFixed(3)+')'; ctx.fillRect(cx*COV*s+1,cz*COV*s+1,COV*s-2,COV*s-2); } }
  ctx.strokeStyle='rgba(34,211,238,0.07)'; ctx.lineWidth=1; ctx.beginPath(); for(let x=0;x<=W;x+=2){ctx.moveTo(x*s,0);ctx.lineTo(x*s,H*s);} for(let z=0;z<=H;z+=2){ctx.moveTo(0,z*s);ctx.lineTo(W*s,z*s);} ctx.stroke();
  ctx.strokeStyle='rgba(34,211,238,0.16)'; ctx.beginPath(); for(let x=0;x<=W;x+=10){ctx.moveTo(x*s,0);ctx.lineTo(x*s,H*s);} for(let z=0;z<=H;z+=10){ctx.moveTo(0,z*s);ctx.lineTo(W*s,z*s);} ctx.stroke();
  ctx.strokeStyle='rgba(148,163,184,0.5)'; ctx.lineWidth=Math.max(1,0.25*s); ctx.strokeRect(BLD.x0*s,BLD.z0*s,(BLD.x1-BLD.x0)*s,(BLD.z1-BLD.z0)*s);
  for(const d of DOORS){ ctx.fillStyle='rgba(52,211,153,0.4)'; if(d.side==='S'||d.side==='N')ctx.fillRect((d.x-d.w/2)*s,(d.z-1.2)*s,d.w*s,2.4*s); else ctx.fillRect((d.x-1.2)*s,(d.z-d.w/2)*s,2.4*s,d.w*s); }
  if(entities){
    ctx.fillStyle='#4a2a14'; for(const r of racks)ctx.fillRect(r.x0*s,r.z0*s,(r.x1-r.x0)*s,(r.z1-r.z0)*s);
    for(const c of CONTAINERS){ ctx.fillStyle=c.c?'#1f3a8a':'#7a2e12'; ctx.fillRect(c.x0*s,c.z0*s,(c.x1-c.x0)*s,(c.z1-c.z0)*s); }
    for(const t of TREES){ ctx.fillStyle='rgba(18,74,57,0.8)'; ctx.beginPath(); ctx.arc(t.x*s,t.z*s,TREE_R*s,0,Math.PI*2); ctx.fill(); }
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='500 '+Math.round(1.0*s)+'px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign='left'; for(let x=0;x<W;x+=10)ctx.fillText(x+'',x*s+2,H*s-3); for(let z=10;z<H;z+=10)ctx.fillText(z+'',2,z*s-2);
    if(intruder.alive&&intruder.path.length){ ctx.strokeStyle='rgba(251,191,36,0.7)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(intruder.x*s,intruder.z*s); for(const p of intruder.path)ctx.lineTo(p.x*s,p.z*s); ctx.stroke(); }
    const ds=swarm.all();
    ds.forEach((d,i)=>{ if(d.footR>0){ ctx.strokeStyle=d.sees?CSS[i]:'rgba(148,163,184,0.45)'; ctx.lineWidth=d.sees?2:1; ctx.beginPath(); ctx.arc(d.x*s,d.z*s,d.footR*s,0,Math.PI*2); ctx.stroke(); }
      ctx.strokeStyle=CSS[i]; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(d.x*s,d.z*s); ctx.lineTo(d.target.x*s,d.target.z*s); ctx.stroke(); ctx.beginPath(); ctx.arc(d.target.x*s,d.target.z*s,0.45*s,0,Math.PI*2); ctx.stroke(); });
    ds.forEach((d,i)=>{ ctx.fillStyle=CSS[i]; ctx.beginPath(); ctx.arc(d.x*s,d.z*s,(i===0?0.8:0.65)*s,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#05080e'; ctx.font='700 '+Math.round(1.0*s)+'px Inter, system-ui, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(i===0?'M':String(i),d.x*s,d.z*s+0.05*s); });
    if(intruder.alive){ ctx.strokeStyle=intruder.seen?'#fb7185':'#7f1d1d'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(intruder.x*s,intruder.z*s,0.55*s,0,Math.PI*2); ctx.stroke(); }
  }
}
let floorT=0; function updateFloor(dt){ floorT-=dt; if(floorT>0)return; floorT=0.3; drawMap(floorCtx,24,false); floorTex.needsUpdate=true; }
drawMap(floorCtx,24,false); floorTex.needsUpdate=true;

// ---------- render ----------
const fmtV3=v=>'('+(v.x>=0?'+':'')+v.x.toFixed(1)+' '+(v.y>=0?'+':'')+v.y.toFixed(1)+' '+(v.z>=0?'+':'')+v.z.toFixed(1)+') '+Math.hypot(v.x,v.y,v.z).toFixed(1)+' m';
function render(dt){
  const ds=swarm.all(); const L=swarm.leader; const elastic=settings.mode>=1;
  ds.forEach((d,i)=>{ const v=views[i]; v.group.position.set(d.x,d.y,d.z);
    v.group.rotation.set(0,0,0); v.group.rotateY(d.yaw); v.group.rotateX(d.pitch); v.group.rotateZ(-d.roll);
    for(const b of v.blades)b.rotation.y+=dt*(30+40*d.T/(settings.mass*9.81));
    v.halo.position.set(d.x,d.y-0.15,d.z); v.halo.material.opacity=0.55+0.3*Math.sin(simT*4+i);
    const gy=hAt(d.x,d.z); const up=d.footR>0.3; v.ring.visible=up; v.fill.visible=up; v.beam.visible=up; const r=Math.max(0.3,d.footR);
    v.ring.position.set(d.x,gy+0.035,d.z); v.ring.scale.set(r,r,1); v.fill.position.set(d.x,gy+0.03,d.z); v.fill.scale.set(r,r,1); v.fillMat.opacity=d.sees?0.14:0.04; v.ringMat.opacity=d.sees?0.9:0.35;
    const hh=Math.max(0.1,d.y-gy); v.beam.position.set(d.x,gy+hh/2,d.z); v.beam.scale.set(r,hh,r);
    placeArrow(v,{x:d.x,y:d.y,z:d.z},d.target); setLabel(v.vlabel,(i===0?'M ':'S'+i+' ')+fmtV3(d.rxVec),CSS[i]);
    v.slot.position.set(d.target.x,d.target.y,d.target.z); setLine(v.plumb,[{x:d.target.x,y:hAt(d.target.x,d.target.z)+0.03,z:d.target.z},{x:d.target.x,y:d.target.y,z:d.target.z}]);
    setLabel(v.label,(i===0?'MASTER':'SLAVE '+i)+' · '+d.y.toFixed(1)+' m · T '+(100*d.T/(settings.mass*9.81)).toFixed(0)+'%',CSS[i]); v.label.sprite.position.set(d.x,d.y+1.35,d.z); });
  swarm.followers.forEach((f,i)=>{ const a=radioLines[i].geometry.attributes.position; a.setXYZ(0,L.x,L.y,L.z); a.setXYZ(1,f.x,f.y,f.z); a.needsUpdate=true; radioLines[i].computeLineDistances();
    const age=simT-f.rxT; const show=age<settings.rlat+0.05&&age>=0; packets[i].visible=show; if(show){ const t=clamp(age/Math.max(0.05,settings.rlat),0,1); packets[i].position.set(L.x+(f.x-L.x)*t,L.y+(f.y-L.y)*t,L.z+(f.z-L.z)*t); }
    tethers[i].visible=elastic; if(elastic){ const q=clamp(f.stretch/Math.max(0.3,settings.Lmax-settings.d0),0,1); tetherMats[i].color.setRGB(0.58+0.42*q,0.64*(1-q)+0.25,0.72*(1-q)+0.1).convertSRGBToLinear(); const n=12; const b=tethers[i].geometry.attributes.position; for(let k=0;k<=n;k++){ const t=k/n; const sag=(1-q)*Math.sin(Math.PI*t)*1.0; b.setXYZ(k,L.x+(f.x-L.x)*t,L.y+(f.y-L.y)*t-sag,L.z+(f.z-L.z)*t); } b.needsUpdate=true; tethers[i].geometry.setDrawRange(0,n+1); } });
  intrG.visible=intruder.alive; intrHalo.visible=intruder.alive; intrLabel.sprite.visible=intruder.alive;
  intrG.position.set(intruder.x,intruder.y,intruder.z); intrG.rotation.y=intruder.heading; intrBody.position.y=0.75+Math.sin(intruder.walk*6)*0.04; intrHalo.position.set(intruder.x,intruder.y+0.9,intruder.z); intrHalo.material.opacity=intruder.seen?0.75:0.3;
  intrRing.material.opacity=intruder.seen?0.55+0.3*Math.sin(simT*8):0.25;
  setLabel(intrLabel,(intruder.mode==='mind'?'INTRUDER · '+intruder.state:'PERSON')+(intruder.seen?' · in view':(intruder.visible?' · unseen':' · under cover')),intruder.seen?'#fecdd3':'#9ca3af'); intrLabel.sprite.position.set(intruder.x,intruder.y+2.3,intruder.z);
  if(intruder.target&&intruder.path.length){ moveMarker.visible=true; moveMarker.position.set(intruder.target.x,hAt(intruder.target.x,intruder.target.z)+0.05,intruder.target.z); const sc=1+0.2*Math.sin(simT*6); moveMarker.scale.set(sc,sc,1); setLine(movePath,[{x:intruder.x,y:intruder.y+0.1,z:intruder.z}].concat(intruder.path.map(p=>({x:p.x,y:hAt(p.x,p.z)+0.1,z:p.z})))); } else { moveMarker.visible=false; movePath.visible=false; }
  updateFloor(dt); renderer.render(scene,camera);
}

// ---------- panel ----------
const el={metrics:$('#metrics'),cards:$('#cards'),log:$('#log'),mini:$('#mini'),status:$('#status'),laws:$('#laws'),cmd:$('#cmd'),hudinfo:$('#hudinfo'),tl:$('#tl'),srcbox:$('#srcbox'),talk:$('#talk')};
const miniCtx=el.mini.getContext('2d'), tlCtx=el.tl.getContext('2d'); let shownLogVer=-1, shownTalkVer=-1;
const fmt=n=>n.toFixed(1); const sgn=n=>(n>=0?'+':'')+n.toFixed(2);
function card(name,c,d,isMaster){
  const age=simT-d.rxT; const tilt=Math.hypot(d.roll,d.pitch)*180/Math.PI; const Tpct=100*d.T/(settings.mass*9.81);
  return '<div class="card" style="--c:'+c+'"><div class="ch"><span class="dot"></span><b>'+name+'</b><span class="mono" style="font-size:10.5px;color:var(--muted)">'+(isMaster?'issues 3 vectors':'vector age '+(age<0?'—':age.toFixed(2)+' s'))+'</span><span class="chip '+(d.sees?'ok':'')+'">'+(d.sees?'sees him':'no view')+'</span></div>'+
    '<div class="vec mono"><span class="l">'+(isMaster?'own vector':'received')+'</span><span class="n x">'+sgn(d.rxVec.x)+'</span><span class="n y">'+sgn(d.rxVec.y)+'</span><span class="n z">'+sgn(d.rxVec.z)+'</span><span class="l">|'+Math.hypot(d.rxVec.x,d.rxVec.y,d.rxVec.z).toFixed(2)+'| m</span>'+
    '<span class="l">to target</span><span class="n x">'+sgn(d.target.x-d.x)+'</span><span class="n y">'+sgn(d.target.y-d.y)+'</span><span class="n z">'+sgn(d.target.z-d.z)+'</span><span class="l">'+Math.hypot(d.target.x-d.x,d.target.y-d.y,d.target.z-d.z).toFixed(2)+' m</span>'+
    '<span class="l">velocity</span><span class="n x">'+sgn(d.vx)+'</span><span class="n y">'+sgn(d.vy)+'</span><span class="n z">'+sgn(d.vz)+'</span><span class="l">'+Math.hypot(d.vx,d.vy,d.vz).toFixed(2)+' m/s</span>'+
    '<span class="l">accel</span><span class="n x">'+sgn(d.acc.x)+'</span><span class="n y">'+sgn(d.acc.y)+'</span><span class="n z">'+sgn(d.acc.z)+'</span><span class="l">m/s²</span></div>'+
    '<div class="row2"><div class="gauge"><div class="k">roll '+(d.roll*180/Math.PI).toFixed(1)+'°</div><div class="track mid"><i style="left:'+(50+Math.min(50,Math.max(-50,d.roll*180/Math.PI/settings.tiltMax*50*(d.roll<0?1:1))))+'%;width:'+Math.min(50,Math.abs(d.roll)*180/Math.PI/settings.tiltMax*50)+'%;'+(d.roll<0?'left:auto;right:50%':'')+'"></i></div></div>'+
    '<div class="gauge"><div class="k">pitch '+(d.pitch*180/Math.PI).toFixed(1)+'°</div><div class="track mid"><i style="left:50%;width:'+Math.min(50,Math.abs(d.pitch)*180/Math.PI/settings.tiltMax*50)+'%;'+(d.pitch<0?'left:auto;right:50%':'')+'"></i></div></div>'+
    '<div class="gauge"><div class="k">thrust '+Tpct.toFixed(0)+'% of weight</div><div class="track"><i style="left:0;width:'+Math.min(100,Tpct/settings.twr)+'%"></i></div></div>'+
    '<div class="gauge" style="flex:0 0 96px"><div class="k">rotors FL FR RL RR</div><div class="rotors">'+d.rotors.map(r=>'<div><i style="height:'+(100*r).toFixed(0)+'%"></i><span>'+(100*r).toFixed(0)+'</span></div>').join('')+'</div></div></div>'+
    '<div class="sub mono">alt '+d.y.toFixed(2)+' m · target alt '+d.target.y.toFixed(2)+' m · footprint r '+d.footR.toFixed(2)+' m · tilt '+tilt.toFixed(1)+'°'+(settings.mode>=1&&!isMaster?' · string '+d.stretch.toFixed(2)+' m':'')+'</div></div>';
}
function updatePanel(){
  const cov=metrics.totT>0?Math.round(100*metrics.seenT/metrics.totT):0; const md=metrics.distN>0?metrics.distSum/metrics.distN:0; const wrongPct=metrics.cmds?Math.round(100*metrics.wrong/metrics.cmds):0;
  el.metrics.innerHTML=[['Sim time',fmt(simT)+' s'],['In view',cov+' %'],['Master distance',md.toFixed(1)+' m'],['Breach / deterred',metrics.breaches+' / '+metrics.deterred],['Turn cmds',metrics.cmds],['Wrong turns',wrongPct+' %'],['λ surprise',belief.lambda.toFixed(2)],['Radio drops',(metrics.rdrop||0)]].map(m=>'<div class="tile"><b class="mono">'+m[1]+'</b><span>'+m[0]+'</span></div>').join('');
  const L=swarm.leader;
  el.cards.innerHTML=card('MASTER',CSS[0],L,true)+card('SLAVE 1',CSS[1],swarm.followers[0],false)+card('SLAVE 2',CSS[2],swarm.followers[1],false);
  if(shownLogVer!==logVer){ shownLogVer=logVer; el.log.innerHTML=log.slice().reverse().map(l=>'<div class="'+l.kind+'"><span class="t">'+l.t.toFixed(1).padStart(6)+'</span>'+l.text+'</div>').join(''); }
  if(shownTalkVer!==talkVer){ shownTalkVer=talkVer; const tk=el.talk; const atBottom=tk.scrollHeight-tk.scrollTop-tk.clientHeight<48; tk.innerHTML=talk.slice(-120).map(l=>'<div class="'+l.who+'"><span class="t mono">'+l.t.toFixed(1)+'</span><span class="p">'+({you:'you',intruder:'intruder',master:'master',motor:'motors',site:'site'}[l.who])+'</span><span class="x'+(l.who==='motor'||l.who==='master'?' mono':'')+'">'+(l.who==='you'?'“'+l.text+'”':l.text)+'</span></div>').join(''); if(atBottom)tk.scrollTop=tk.scrollHeight; }
  drawMap(miniCtx,10,true); drawTimeline();
  const last=brain.last; el.cmd.textContent=last?(last.cmd==='L'?'←':last.cmd==='R'?'→':'·'):'·'; el.cmd.className=(last?(last.cmd==='L'?'L':last.cmd==='R'?'R':'')+(last&&!last.correct&&last.cmd!=='N'?' wrong':''):'');
  const srcName={keys:'keys ← →',sim:'sim BCI p '+settings.acc.toFixed(2)+' every '+settings.dec.toFixed(1)+' s',replay:'replay '+brain.replayIdx+' / '+brain.replay.length,live:'live · '+brain.liveState}[brain.source];
  el.hudinfo.innerHTML='<b>'+GOALS[mission.goal]+'</b> <span class="k">· '+mission.template+(mission.orient?' · rotated '+mission.orient+'°':'')+'</span><br><span class="k">brain</span> '+(brain.autopilot?'pulses ignored':srcName)+' <span class="k">· formation</span> '+(settings.mode>=1?'elastic strings':'rigid')+'<br><span class="k">in view</span> <span class="mono">'+cov+' %</span> <span class="k">· λ</span> <span class="mono">'+belief.lambda.toFixed(1)+'</span> <span class="k">· surprise</span> <span class="mono">'+belief.srate.toFixed(2)+'/'+settings.budget.toFixed(2)+'</span>';
  el.status.innerHTML=(intruder.alive?(intruder.seen?'<b style="color:#86efac">Intruder in view</b>':'<b style="color:#fecdd3">Intruder out of view</b>')+' <span class="k">· master</span> <span class="mono">'+dist2(L.x,L.z,intruder.x,intruder.z).toFixed(1)+' m</span> <span class="k">· state</span> '+intruder.state+(intruder.hiding?' (hiding)':''):'<b>Site clear</b> · next crossing soon')+'<br><span class="k">← → rotate · 1 keep out · 2 drive out · 3 track · 4 hold · click the ground to move him</span>';
}
function drawTimeline(){ const c=el.tl; const ctx=tlCtx; const w=c.width,h=c.height; ctx.fillStyle='rgba(0,0,0,0)'; ctx.clearRect(0,0,w,h); const span=40; const t0=simT-span;
  ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.beginPath(); for(let t=Math.ceil(t0/5)*5;t<=simT;t+=5){ const x=(t-t0)/span*w; ctx.moveTo(x,0); ctx.lineTo(x,h); } ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='10px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign='left'; ctx.fillText('L',4,16); ctx.fillText('N',4,40); ctx.fillText('R',4,64);
  for(const e of brain.history){ if(e.t<t0)continue; const x=(e.t-t0)/span*w; const y=e.cmd==='L'?12:(e.cmd==='R'?60:36); ctx.fillStyle=e.cmd==='N'?'#4b5563':(e.correct?'#34d399':'#fb7185'); ctx.fillRect(x-2,y-6,4,12); } }
function buildLaws(){
  el.laws.innerHTML=LAWS.map(l=>'<div class="law"><b>'+l.title+'</b><div class="f mono">'+l.f+'</div><p>'+l.text+'</p>'+l.params.map(p=>'<div class="row"><span>'+p[1]+'</span><input type="range" data-k="'+p[0]+'" min="'+p[2]+'" max="'+p[3]+'" step="'+p[4]+'" value="'+settings[p[0]]+'"><span class="v mono" id="v-'+p[0]+'">'+settings[p[0]]+' '+p[5]+'</span></div>').join('')+'</div>').join('');
  el.laws.querySelectorAll('input[type=range]').forEach(inp=>{ inp.addEventListener('input',()=>{ const k=inp.dataset.k; settings[k]=parseFloat(inp.value); const p=LAWS.flatMap(l=>l.params).find(q=>q[0]===k); $('#v-'+k).textContent=settings[k]+' '+p[5]; }); });
}
buildLaws();
function setSource(src){ brain.source=src; for(const b of $('#srcseg').children)b.classList.toggle('on',b.dataset.src===src); $('#replaybox').style.display=src==='replay'?'block':'none'; $('#livebox').style.display=src==='live'?'block':'none';
  el.srcbox.innerHTML={keys:'← and → stand in for your 2 classifier classes. Each press is 1 decision, delivered after the latency ℓ, and rotates the formation by 15°.',sim:'A classifier fires every Δt s with accuracy p. Tune p, Δt and ℓ in law L4.',replay:'Paste or upload timestamped decisions from a real session. Time 0 is the moment you press Load.',live:'Your pipeline sends 1 frame per decision over a websocket.'}[src]; }
$('#srcseg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b)setSource(b.dataset.src); });
setSource('keys');
function setGoal(g){ world.setGoal(g); for(const b of $('#goalseg').children)b.classList.toggle('on',b.dataset.goal===g); }
$('#goalseg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b)setGoal(b.dataset.goal); });
function setMode(m){ intruder.mode=m; for(const b of $('#modeseg').children)b.classList.toggle('on',b.dataset.mode===m); if(m==='mind'&&(!intruder.alive||intruder.state==='gone'))intruder.spawn(); if(m!=='mind'){ intruder.alive=true; intruder.path=[]; intruder.target=null; } }
$('#modeseg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b)setMode(b.dataset.mode); });
let voice=false; $('#voice').addEventListener('click',()=>{ voice=!voice; $('#voice').textContent=voice?'Voice on':'Voice off'; $('#voice').classList.toggle('on',voice); if(voice){ try{ window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance('Voice on.')); }catch(err){} } });
speakHook=text=>{ if(!voice)return; try{ const u=new SpeechSynthesisUtterance(text); u.rate=1.05; window.speechSynthesis.speak(u); }catch(err){} };
$('#narrate').addEventListener('click',()=>{ mission.narrate=mission.narrate==='tick'?'change':'tick'; $('#narrate').textContent=mission.narrate==='tick'?'every tick':'on change'; });
$('#auto').addEventListener('click',()=>{ brain.autopilot=!brain.autopilot; $('#auto').classList.toggle('on',brain.autopilot); $('#auto').textContent=brain.autopilot?'Pulses ignored':'Pulses off'; });
$('#play').addEventListener('click',togglePlay); function togglePlay(){ running=!running; $('#play').textContent=running?'Pause':'Play'; }
$('#reset').addEventListener('click',()=>world.reset());
$('#speed').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; speed=parseInt(b.dataset.s,10); for(const x of $('#speed').children)x.classList.toggle('on',x===b); });
let chase=false;
$('#orbit').addEventListener('click',()=>{ chase=false; Object.assign(cam,HOME); applyCam(); for(const b of ['#orbit','#top','#chase'])$(b).classList.toggle('on',b==='#orbit'); });
$('#top').addEventListener('click',()=>{ chase=false; Object.assign(cam,{theta:0,phi:0.1,r:60,tx:24,tz:22}); applyCam(); for(const b of ['#orbit','#top','#chase'])$(b).classList.toggle('on',b==='#top'); });
$('#chase').addEventListener('click',()=>{ chase=true; cam.r=24; cam.phi=1.0; for(const b of ['#orbit','#top','#chase'])$(b).classList.toggle('on',b==='#chase'); });
$('#replayload').addEventListener('click',()=>{ const f=$('#replayfile').files[0]; if(f){ f.text().then(t=>{ $('#replaytxt').value=t; brain.loadReplay(t); }); } else brain.loadReplay($('#replaytxt').value); });
$('#wsconnect').addEventListener('click',()=>{ try{ if(brain.ws){ brain.ws.close(); brain.ws=null; } const ws=new WebSocket($('#wsurl').value); brain.liveState='connecting'; ws.onopen=()=>{ brain.liveState='connected'; logLine('Live link connected.','good'); }; ws.onclose=()=>{ brain.liveState='closed'; }; ws.onerror=()=>{ brain.liveState='failed'; logLine('Live link failed. The hosted page cannot open sockets; run the page from a local file.','alert'); }; ws.onmessage=ev=>{ let c=String(ev.data).trim(); try{ const j=JSON.parse(c); if(j&&j.cmd)c=String(j.cmd); }catch(_){ } c=c.toUpperCase()[0]; if('LRN'.indexOf(c)>=0)brain.issue(c,'live'); }; brain.ws=ws; }catch(err){ brain.liveState='failed'; logLine('Live link failed: '+err.message,'alert'); } });
// sweep
const sweepC=$('#sweepc'), sweepCtx=sweepC.getContext('2d'); let sweepRes={auto:[],bci:[]}; let sweeping=false;
function drawSweep(){ const w=sweepC.width,h=sweepC.height; const ctx=sweepCtx; ctx.clearRect(0,0,w,h); const pad={l:36,r:10,t:10,b:22}; const bs=[0,0.05,0.1,0.2,0.3,0.45]; const X=B=>pad.l+(w-pad.l-pad.r)*B/0.45, Y=c=>h-pad.b-(h-pad.t-pad.b)*c;
  ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='10px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign='right'; for(const c of [0,0.25,0.5,0.75,1]){ ctx.beginPath(); ctx.moveTo(pad.l,Y(c)); ctx.lineTo(w-pad.r,Y(c)); ctx.stroke(); ctx.fillText(Math.round(100*c)+'%',pad.l-4,Y(c)+3); } ctx.textAlign='center'; for(const B of bs)ctx.fillText('B '+B,X(B),h-8);
  const plot=(res,color,dash)=>{ if(!res.length)return; ctx.strokeStyle=color; ctx.lineWidth=2; ctx.setLineDash(dash); ctx.beginPath(); res.forEach((r,i)=>{ if(i)ctx.lineTo(X(r.B),Y(r.cov)); else ctx.moveTo(X(r.B),Y(r.cov)); }); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle=color; for(const r of res){ ctx.beginPath(); ctx.arc(X(r.B),Y(r.cov),3,0,Math.PI*2); ctx.fill(); } let best=res[0]; for(const r of res)if(r.cov>best.cov)best=r; ctx.beginPath(); ctx.arc(X(best.B),Y(best.cov),7,0,Math.PI*2); ctx.stroke(); };
  plot(sweepRes.auto,'#22d3ee',[]); plot(sweepRes.bci,'#fbbf24',[5,4]); }
drawSweep();
$('#sweepbtn').addEventListener('click',()=>{ if(sweeping)return; sweeping=true; $('#sweepbtn').classList.add('on'); const bs=[0,0.05,0.1,0.2,0.3,0.45], seeds=[1,2,3,4]; const jobs=[]; for(const ap of [true,false])for(const B of bs)jobs.push({ap,B}); sweepRes={auto:[],bci:[]}; let j=0; const wasRunning=running; running=false; const keep={autopilot:brain.autopilot,imode:intruder.mode,budget:settings.budget,source:brain.source,mode:settings.mode,goal:mission.goal}; settings.mode=1;
  const next=()=>{ if(j>=jobs.length){ intruder.mode=keep.imode; mission.goal=keep.goal; world.reset(); brain.autopilot=keep.autopilot; settings.budget=keep.budget; brain.source=keep.source; settings.mode=keep.mode; running=wasRunning; sweeping=false; $('#sweepbtn').classList.remove('on'); const ba=sweepRes.auto.reduce((a,r)=>r.cov>a.cov?r:a,sweepRes.auto[0]), bb=sweepRes.bci.reduce((a,r)=>r.cov>a.cov?r:a,sweepRes.bci[0]); $('#sweepinfo').textContent='Best budget: autopilot B = '+ba.B+' ('+Math.round(100*ba.cov)+' % in view), simulated BCI B = '+bb.B+' ('+Math.round(100*bb.cov)+' % in view). Elastic field, 4 seeds × 60 s each.'; drawSweep(); return; }
    const job=jobs[j++]; let cov=0,dist=0,lost=0; for(const sd of seeds){ const r=sweepRun(job.B,sd,60,job.ap); cov+=r.cov; dist+=r.dist; lost+=r.lost; } (job.ap?sweepRes.auto:sweepRes.bci).push({B:job.B,cov:cov/seeds.length,dist:dist/seeds.length}); $('#sweepinfo').textContent='Sweeping… '+j+' / '+jobs.length+' (B = '+job.B+', '+(job.ap?'autopilot':'simulated BCI')+')'; drawSweep(); setTimeout(next,30); };
  setTimeout(next,30); });
window.addEventListener('keydown',e=>{ if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA')return; const k=e.key; if(k==='ArrowLeft'||k==='a'){ e.preventDefault(); if(brain.source==='keys'&&!brain.autopilot)brain.issue('L','keys'); } else if(k==='ArrowRight'||k==='d'){ e.preventDefault(); if(brain.source==='keys'&&!brain.autopilot)brain.issue('R','keys'); } else if(k==='p')togglePlay(); else if(k==='1')setGoal('keepout'); else if(k==='2')setGoal('driveout'); else if(k==='3')setGoal('track'); else if(k==='4')setGoal('hold'); else if(k==='r')world.reset(); else if(k==='t')$('#top').click(); else if(k==='o')$('#orbit').click(); else if(k==='c')$('#chase').click(); });

// ---------- main loop ----------
world.reset();
let last=performance.now(),uiT=0,acc=0; const STEP=1/60;
function frame(now){
  const real=Math.min(0.05,(now-last)/1000); last=now;
  if(running){ acc+=real*speed; let n=0; while(acc>=STEP&&n<12){ world.step(STEP); acc-=STEP; n++; } if(n>=12)acc=0; }
  if(chase){ const L=swarm.leader; cam.tx=L.x; cam.tz=L.z; cam.theta=L.yaw+Math.PI; applyCam(); }
  render(real);
  uiT-=real; if(uiT<=0){ uiT=0.12; updatePanel(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.SIM={world,metrics,settings,swarm,brain,intruder,belief,sweepRun,mission,talk,GOALS,get simT(){return simT;}};
})();
</script>
</body>
</html>
'''
open(__import__('os').path.join(__import__('os').path.dirname(__file__),'..','index.html'),'w').write(HEAD+core+UI)
print('written')
