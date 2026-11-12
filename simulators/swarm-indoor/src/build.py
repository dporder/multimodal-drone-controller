"""[dan] Build simulators/swarm-indoor/index.html from src/core.html (the sim core, runs headless in node) and the page below.

    python simulators/swarm-indoor/src/build.py

The page reuses Swarm Mind's look (CSS copied from simulators/swarm-mind/src/build.py) and its push-to-talk protocol
(voice/server.py), and draws the floor top-down on a 2-D canvas.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
core = open(os.path.join(HERE, 'core.html')).read()

HEAD = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Swarm Indoor — three drones inside a building, steered by spoken orders</title>
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
.btn.rec{background:rgba(251,113,133,.22);color:#fecdd3;box-shadow:inset 0 0 0 1px rgba(251,113,133,.6)}
  .btn.danger.on{background:rgba(251,113,133,.16);color:#fecdd3;box-shadow:inset 0 0 0 1px rgba(251,113,133,.4)}
  .spacer{flex:1}
  .k{font-size:10px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
  #hud{position:absolute;top:66px;left:12px;padding:10px 12px;display:flex;gap:14px;align-items:center;pointer-events:none;z-index:2;max-width:min(640px,72%)}
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

  #view canvas#cv{position:absolute;inset:0;cursor:crosshair}
  #hud{top:auto;bottom:86px;left:12px;max-width:min(560px,70%);display:block}
  #hudinfo .small{color:#cbd5e1}
  .tiles{grid-template-columns:repeat(4,1fr)}
  #talk{max-height:320px}
  #rooms div{white-space:normal}
  @media (max-width:980px){ html,body{height:auto} #app{height:auto;grid-template-rows:max(62vh,460px) auto} #hud{bottom:96px} }
  @media (max-height:560px) and (min-width:981px){ html,body{height:auto} #app{height:auto;min-height:560px} }
</style>
</head>
<body>
<div id="app">
  <div id="view">
    <canvas id="cv"></canvas>
    <div id="bar" class="glass">
      <div class="brand"><b>Swarm Indoor</b><span>master · 2 followers · inside</span></div>
      <div class="seg goal" id="goalseg"><button data-goal="hold" class="on">Hold</button><button data-goal="keepout">Keep out</button><button data-goal="driveout">Drive out</button><button data-goal="guideout">Guide out</button><button data-goal="track">Track</button><button data-goal="contain">Contain</button><button data-goal="search">Search</button><button data-goal="explore">Map</button><button data-goal="overwatch">Watch</button><button data-goal="return">Return</button></div>
      <button class="btn" id="talkbtn" title="Hold Space, or hold this button, and say an order">Talk · hold Space</button>
      <div class="spacer"></div>
      <div class="seg" id="whoseg"><button data-who="intruder" class="on">Intruder</button><button data-who="visitor">Lost visitor</button><button data-who="hider">Hiding</button></div>
      <div class="seg" id="layseg"><button data-lay="fixed" class="on">Office</button><button data-lay="random">Random floor</button></div>
      <button class="btn" id="play">Pause</button>
      <button class="btn" id="reset">Reset</button>
      <div class="seg" id="speed"><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button></div>
    </div>
    <div id="hud" class="glass"><div id="hudinfo"></div></div>
    <div id="status" class="glass"></div>
    <div id="hint" class="glass"></div>
  </div>
  <aside id="panel">
    <section><div class="tiles" id="metrics"></div></section>
    <section><h3>Orders by voice <span id="speechstat" class="small" style="font-weight:400;margin-left:6px;text-transform:none;letter-spacing:0"></span></h3>
      <div class="src"><input type="text" id="ordertxt" placeholder="…or type one: keep him out of the lab" style="flex:1"><button class="btn" id="ordersend">Send</button></div>
      <div id="speechlast" class="small"></div>
      <p class="small">Try: “keep him out of the lab” · “drive him out the east exit” · “guide her out” · “track him” · “keep him in the kitchen” · “search the building thoroughly” · “map the floor” · “watch the main entrance” · “come back and land” · “search the building, then come back”.</p></section>
    <section><h3>Conversation</h3><div id="talk"></div></section>
    <section><h3>Drones</h3><div id="drones"></div></section>
    <section><h3>Rooms (search record)</h3><div id="rooms" class="log"></div></section>
    <section><h3>About</h3>
      <details><summary>What you are looking at</summary>
        <p>A floor seen from above. Rooms, 0.2 m walls, doors under a 2.0 m lintel, tables (0.8 m) and shelves (2.2 m). The coloured cones show what each drone camera can see at its height: walls, shelves and door lintels block it.</p>
        <p>Every 0.5 s the master (M) picks a tactic template for the current order and sends each follower a vector over a lossy radio. Yellow dashed lines are those vectors; squares are the slots. Amber rooms are where the person could be, green rooms were cleared since he was last seen.</p>
        <p>Safety rules run on board: never closer than 1.2 m to a person; 1.5 m in pressure tactics (drive out, keep out at the door) and 2.5 m otherwise (the dashed ring); 1 m between drones, 0.4 m from walls, one drone per doorway, slow in doors. The person model and the tactics are explained in docs/TACTICS.md; the training records in docs/DATASET_PLAN.md.</p></details></section>
  </aside>
</div>
'''

UI = r'''<script>
// [dan] Swarm Indoor page: top-down floor view, goal buttons, orders by voice (voice/server.py), conversation and safety metrics.
(()=>{
'use strict';
const $=s=>document.querySelector(s);
const COL={M:'#22d3ee',S1:'#a3e635',S2:'#f472b6',P:'#fb7185',vec:'#fbbf24',site:'#34d399'};
const GOAL_KEYS=['hold','keepout','driveout','guideout','track','contain','search','explore','overwatch','return'];
const ui={running:true,speed:1,who:'intruder',layout:'fixed',seed:1,floor:null,exploreImg:null,exploreT:-9,talkVer:-1,scale:30,ox:0,oy:0,fitKey:''};
const cv=$('#cv'), ctx=cv.getContext('2d'), view=$('#view');

// ---------- scenario ----------
function personOpts(){ return ui.who==='visitor'?{role:'visitor',intent:'wander'}:ui.who==='hider'?{role:'intruder',intent:'hide'}:{role:'intruder',delay:6}; }
function resetWorld(){ seed(ui.seed); world.reset({layout:ui.layout,person:personOpts(),goal:'hold'}); ui.floor=null; ui.exploreImg=null; ui.talkVer=-1; ui.fitKey=''; highlightGoal('hold');
  $('#hint').textContent='hold Space: say an order · 1–0 goals · click the floor: send the person there · p pause · r reset · n new floor (seed '+ui.seed+')'; }

// ---------- drawing ----------
function buildFloor(){ const c=document.createElement('canvas'); c.width=GX; c.height=GZ; const g=c.getContext('2d'), im=g.createImageData(GX,GZ), a=im.data;
  for(let j=0;j<GZ;j++)for(let i=0;i<GX;i++){ const k=j*GX+i, h=Hg[k], r=ROOMC[k], o=4*k; let col;
    if(DOORC[k])col=[30,44,60]; else if(r===plan.OUT)col=[7,11,18]; else if(r<0)col=[70,82,100]; else if(h>=1.0)col=[78,90,110]; else if(h>0.3)col=[44,54,72]; else col=[15,22,33];
    a[o]=col[0]; a[o+1]=col[1]; a[o+2]=col[2]; a[o+3]=255; }
  g.putImageData(im,0,0); return c; }
function fit(){ const r=view.getBoundingClientRect(), dpr=window.devicePixelRatio||1, bar=$('#bar').getBoundingClientRect();
  const key=[r.width,r.height,bar.height,dpr,plan.W,plan.D].join(); if(key===ui.fitKey)return; ui.fitKey=key;
  cv.width=Math.round(r.width*dpr); cv.height=Math.round(r.height*dpr); cv.style.width=r.width+'px'; cv.style.height=r.height+'px';
  const top=bar.bottom-r.top+10, bottom=70, side=16; const s=Math.min((r.width-2*side)/plan.W,(r.height-top-bottom)/plan.D);
  ui.scale=s*dpr; ui.ox=(r.width-s*plan.W)/2*dpr; ui.oy=(top+(r.height-top-bottom-s*plan.D)/2)*dpr; }
const X=x=>ui.ox+x*ui.scale, Y=z=>ui.oy+z*ui.scale;
function visPoly(d){ const pts=[[X(d.x),Y(d.z)]], half=settings.camFov/2*Math.PI/180;
  for(let k=0;k<=30;k++){ const a=d.yaw-half+2*half*k/30, sx=Math.sin(a), sz=Math.cos(a); let s=0.1;
    for(;s<settings.camRange;s+=0.1){ const c=cellIdx(d.x+sx*s,d.z+sz*s); if(Hg[c]>=d.y-0.05||(DOORC[c]&&d.y>settings.lintel))break; }
    pts.push([X(d.x+sx*s),Y(d.z+sz*s)]); } return pts; }
function drawExplore(){ const ex=mission.explore; if(!ex)return; if(!ui.exploreImg||simT-ui.exploreT>0.5){ ui.exploreT=simT; const c=ui.exploreImg||document.createElement('canvas'); c.width=NX; c.height=NZ;
    const g=c.getContext('2d'), im=g.createImageData(NX,NZ), a=im.data; for(let k=0;k<NX*NZ;k++){ const o=4*k; if(ex.bel[k]===1){ a[o]=34; a[o+1]=211; a[o+2]=238; a[o+3]=46; } else if(ex.bel[k]===2){ a[o]=251; a[o+1]=191; a[o+2]=36; a[o+3]=120; } }
    g.putImageData(im,0,0); ui.exploreImg=c; }
  ctx.imageSmoothingEnabled=false; ctx.drawImage(ui.exploreImg,X(0),Y(0),NX*NAV*ui.scale,NZ*NAV*ui.scale); }
function text(t,x,y,size,color,align){ ctx.font=(size*(window.devicePixelRatio||1))+'px Inter, system-ui, sans-serif'; ctx.fillStyle=color; ctx.textAlign=align||'center'; ctx.textBaseline='middle'; ctx.fillText(t,x,y); }
function render(){ fit(); const dpr=window.devicePixelRatio||1; ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#05080e'; ctx.fillRect(0,0,cv.width,cv.height);
  if(!ui.floor)ui.floor=buildFloor(); ctx.imageSmoothingEnabled=false; ctx.drawImage(ui.floor,X(0),Y(0),GX*CELL*ui.scale,GZ*CELL*ui.scale);
  // room state: amber = he could be here, green = cleared since he was last seen
  for(const q of plan.rooms){ const inB=team.beliefRooms.has(q.id), cl=team.cleared.has(q.id); if(!inB&&!cl)continue; ctx.fillStyle=cl?'rgba(52,211,153,0.10)':'rgba(251,191,36,0.10)'; ctx.fillRect(X(q.x0),Y(q.z0),(q.x1-q.x0)*ui.scale,(q.z1-q.z0)*ui.scale); }
  if(mission.goal==='explore')drawExplore();
  const P=world.scenario.protectedRoom, pq=plan.rooms[P]; if(pq&&person.role==='intruder'){ ctx.strokeStyle='rgba(251,191,36,0.55)'; ctx.setLineDash([6*dpr,5*dpr]); ctx.lineWidth=1.5*dpr; ctx.strokeRect(X(pq.x0)+3,Y(pq.z0)+3,(pq.x1-pq.x0)*ui.scale-6,(pq.z1-pq.z0)*ui.scale-6); ctx.setLineDash([]); }
  for(const q of plan.rooms)text(q.name+(q.id===P&&person.role==='intruder'?' · protected':''),X(q.cx),Y(q.z0)+12*dpr,10.5,'rgba(200,210,225,0.55)');
  for(const d of plan.doors){ const owner=doorLock[d.id]; if(owner!=null){ const c=COL[team.drones[owner].id]; ctx.fillStyle=c+'33'; const w=d.w+0.4; if(d.axis==='h')ctx.fillRect(X(d.x-w/2),Y(d.z-0.5),w*ui.scale,1.0*ui.scale); else ctx.fillRect(X(d.x-0.5),Y(d.z-w/2),1.0*ui.scale,w*ui.scale); }
    if(d.rooms[1]===plan.OUT)text(d.name,X(d.x)+(d.axis==='v'?0:0),Y(d.z)+(d.axis==='h'?(d.z>plan.D/2?14:-14):0)*dpr,9.5,'rgba(52,211,153,0.75)'); }
  for(const p of plan.pads){ ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1*dpr; ctx.strokeRect(X(p.x-0.3),Y(p.z-0.3),0.6*ui.scale,0.6*ui.scale); }
  text('operator',X(plan.operator.x),Y(plan.operator.z)+10*dpr,9,'rgba(103,232,249,0.6)');
  // cameras: what each drone can see at its height (walls, shelves and door lintels block it)
  for(const d of team.drones){ if(d.y<0.4)continue; const poly=visPoly(d); ctx.beginPath(); ctx.moveTo(poly[0][0],poly[0][1]); for(const p of poly)ctx.lineTo(p[0],p[1]); ctx.closePath(); ctx.fillStyle=COL[d.id]+(d.sees?'26':'14'); ctx.fill(); }
  // person (truth) and what the team believes
  if(person.alive){ const seen=team.seen, press=mission.band==='pressure'; ctx.globalAlpha=seen?1:0.45; ctx.setLineDash([4*dpr,4*dpr]); ctx.strokeStyle=press?'rgba(251,191,36,0.7)':'rgba(251,113,133,0.45)'; ctx.lineWidth=1*dpr; ctx.beginPath(); ctx.arc(X(person.x),Y(person.z),(press?settings.dPress:settings.dS)*ui.scale,0,2*Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle='rgba(251,113,133,0.35)'; ctx.beginPath(); ctx.arc(X(person.x),Y(person.z),settings.floorPress*ui.scale,0,2*Math.PI); ctx.stroke();
    ctx.fillStyle=COL.P; ctx.beginPath(); ctx.arc(X(person.x),Y(person.z),0.28*ui.scale,0,2*Math.PI); ctx.fill(); const h=person.heading; ctx.strokeStyle='#fff'; ctx.lineWidth=2*dpr; ctx.beginPath(); ctx.moveTo(X(person.x),Y(person.z)); ctx.lineTo(X(person.x+Math.sin(h)*0.45),Y(person.z+Math.cos(h)*0.45)); ctx.stroke();
    text((person.role==='visitor'?'visitor':'intruder')+' · '+person.state+(seen?'':' · not seen'),X(person.x),Y(person.z)-0.55*ui.scale,10.5,'#fecdd3'); ctx.globalAlpha=1; }
  const I=team.est(); if(I&&!team.seen){ ctx.strokeStyle='rgba(251,113,133,0.8)'; ctx.lineWidth=1.5*dpr; ctx.beginPath(); ctx.arc(X(I.x),Y(I.z),0.4*ui.scale,0,2*Math.PI); ctx.stroke(); text('last seen '+(simT-team.lkpT).toFixed(1)+' s',X(I.x),Y(I.z)+0.7*ui.scale,9.5,'rgba(251,113,133,0.9)'); }
  // drones: path, vector to slot, sight line, body
  for(const d of team.drones){ const c=COL[d.id];
    if(d.path&&d.path.length&&d.y>0.3){ ctx.strokeStyle=c+'55'; ctx.lineWidth=1*dpr; ctx.beginPath(); ctx.moveTo(X(d.x),Y(d.z)); for(const p of d.path)ctx.lineTo(X(p.x),Y(p.z)); ctx.stroke(); }
    if(d.slot&&hyp(d.slot.x-d.x,d.slot.z-d.z)>0.15){ ctx.strokeStyle='rgba(251,191,36,0.75)'; ctx.setLineDash([3*dpr,3*dpr]); ctx.lineWidth=1.2*dpr; ctx.beginPath(); ctx.moveTo(X(d.x),Y(d.z)); ctx.lineTo(X(d.slot.x),Y(d.slot.z)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle=c; ctx.strokeRect(X(d.slot.x)-4*dpr,Y(d.slot.z)-4*dpr,8*dpr,8*dpr); }
    if(d.sees&&person.alive){ ctx.strokeStyle=c+'aa'; ctx.lineWidth=1*dpr; ctx.beginPath(); ctx.moveTo(X(d.x),Y(d.z)); ctx.lineTo(X(person.x),Y(person.z)); ctx.stroke(); }
    ctx.fillStyle=d.y<0.3?c+'66':c; ctx.beginPath(); ctx.arc(X(d.x),Y(d.z),0.22*ui.scale,0,2*Math.PI); ctx.fill(); ctx.strokeStyle='#05080e'; ctx.lineWidth=1.5*dpr; ctx.beginPath(); ctx.moveTo(X(d.x),Y(d.z)); ctx.lineTo(X(d.x+Math.sin(d.yaw)*0.3),Y(d.z+Math.cos(d.yaw)*0.3)); ctx.stroke();
    text(d.id+' '+d.y.toFixed(1)+' m',X(d.x),Y(d.z)+0.48*ui.scale,9.5,c); } }

// ---------- panel ----------
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function highlightGoal(g){ for(const b of $('#goalseg').children)b.classList.toggle('on',b.dataset.goal===g); }
function roomName(r){ return r>=0&&r<plan.rooms.length?plan.rooms[r].name:(r===plan.OUT?'outside':'—'); }
function updatePanel(){ const M=metrics, inView=M.totT?Math.round(100*M.seenT/M.totT):0;
  const tiles=[[simT.toFixed(0)+' s','time'],['v'+mission.version,'order'],[inView+'%','in view'],[M.breaches,'breaches'],
    [person.role==='visitor'?M.guided:M.left,person.role==='visitor'?'guided out':'left'],[M.found?M.tFound+' s':'—','found'],[isFinite(M.minStandoff)?M.minStandoff.toFixed(1)+' m':'—','closest'],
    [(M.standoffViol+M.sepViol+M.wallViol).toFixed(1)+' s','safety'],[M.radioDrops,'radio drops'],[M.mapped?Math.round(100*M.mapped)+'%':'—','mapped'],[M.linkHolds,'link holds'],[M.maxMargin.toFixed(2),'margin']];
  $('#metrics').innerHTML=tiles.map(([v,k])=>'<div class="tile"><b class="mono">'+esc(v)+'</b><span>'+k+'</span></div>').join('');
  const st=mission.status, q=mission.queued;
  $('#hudinfo').innerHTML='<b>'+esc(describeGoal())+'</b> <span class="chip'+(st==='active'?' ok':'')+'">'+esc(st)+'</span> <span class="chip">'+(mission.band==='pressure'?'pressure · '+settings.dPress+' m':'comfort · '+settings.dS+' m')+'</span><br><span class="small">'+esc(mission.template?'Template: '+mission.template:'')+'</span>'+(q?'<br><span class="small">then: '+esc(GOALS[q.goal])+'</span>':'');
  const lastSite=[...talk].reverse().find(l=>l.who==='site'||l.who==='intruder');
  $('#status').innerHTML=(person.alive?esc((person.role==='visitor'?'Visitor':'Intruder')+' · '+person.state+' · '+roomName(person.room)+(team.seen?' · in sight':' · out of sight')):'Nobody inside.')+(lastSite?'<br><span class="small">'+esc(lastSite.t.toFixed(0)+' s '+lastSite.who+': '+lastSite.text)+'</span>':'');
  if(ui.talkVer!==talkVer){ ui.talkVer=talkVer; const el=$('#talk'); const near=el.scrollTop+el.clientHeight>=el.scrollHeight-30;
    el.innerHTML=talk.filter(l=>l.who!=='motor').slice(-80).map(l=>'<div class="'+l.who+'"><span class="t mono">'+l.t.toFixed(1)+'</span><span class="p">'+(l.who==='master'?'swarm':l.who)+'</span><span class="x">'+esc(l.text)+'</span></div>').join('');
    if(near)el.scrollTop=el.scrollHeight; }
  $('#drones').innerHTML=team.drones.map(d=>{ const v=hyp(d.vx,d.vz); return '<div class="card" style="--c:'+COL[d.id]+'"><div class="ch"><span class="dot"></span><b>'+d.id+'</b><span class="small">'+d.name+'</span><span class="chip'+(d.sees?' ok':'')+'">'+(d.sees?'sees him':roomName(roomAt(d.x,d.z)))+'</span></div>'+
    '<div class="small mono">height '+d.y.toFixed(2)+' m · speed '+v.toFixed(2)+' m/s · link '+(simT-d.rxT).toFixed(1)+' s'+(d.lock>=0?' · holds '+esc(plan.doors[d.lock].name):'')+(d.flags&&d.flags.length?' · validator: '+esc(d.flags.join(', ')):'')+'</div></div>'; }).join('');
  $('#rooms').innerHTML=plan.rooms.map(q=>{ const x=team.xmark[q.id]; const s=team.beliefRooms.has(q.id)?'<span class="warn">he could be here</span>':team.cleared.has(q.id)?'<span class="good">cleared'+(x&&x.tout!=null?' at '+x.tout+' s':'')+'</span>':'<span class="t">—</span>';
    return '<div><span class="t">'+esc(q.name.padEnd(13))+'</span>'+s+(x&&x.found?' <span class="alert">found</span>':'')+'</div>'; }).join(''); }

// ---------- orders by voice: push-to-talk -> local speech server (voice/server.py) -> world.order ----------
// Same protocol as Swarm Mind. The context carries only what the team knows (sighting, last-known room), plus the floor's names.
const speech={url:'ws://localhost:8765',ws:null,state:'offline',model:'',id:0,sent:{},rec:false,stopping:false,want:false,ctx:null,rate:16000,pre:[],buf:[],retry:1000};
const TAP='class Tap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}registerProcessor("tap",Tap);';
function speechContext(){ const lr=team.lkpRoom; return {sim:'swarm-indoor',goal:mission.goal,version:mission.version,queued:mission.queued?mission.queued.goal:null,
    person:{role:person.role,seen:!!team.seen,known:team.lkpT>=0,room:lr>=0&&lr<plan.rooms.length?plan.rooms[lr].name:(lr===plan.OUT?'outside':null),inside:lr>=0&&lr<plan.rooms.length},
    rooms:plan.rooms.map(q=>q.name),doors:plan.doors.map(d=>({name:d.name,rooms:d.rooms.map(r=>r<plan.rooms.length?plan.rooms[r].name:'outside')})),
    protected:plan.rooms[world.scenario.protectedRoom].name,sim_t:+simT.toFixed(2)}; }
function speechUI(){ const s=speech.state; $('#speechstat').textContent=s==='ready'?'· ready · offline '+speech.model:s==='listening'?'· listening…':s==='thinking'?'· recognizing…':s==='connecting'?'· connecting…':'· speech server off (run python main.py indoor --voice)'; $('#talkbtn').classList.toggle('rec',s==='listening'); }
function speechConnect(){ if(speech.ws&&speech.ws.readyState<=1)return; let ws; try{ ws=new WebSocket(speech.url); }catch(err){ speech.state='offline'; speechUI(); return; }
  speech.ws=ws; speech.state='connecting'; speechUI();
  ws.onopen=()=>{ speech.retry=1000; speech.state='ready'; ws.send(JSON.stringify({type:'hello',sim:'swarm-indoor'})); speechUI(); };
  ws.onclose=()=>{ speech.ws=null; speech.state='offline'; speechUI(); setTimeout(speechConnect,speech.retry); speech.retry=Math.min(10000,speech.retry*2); };
  ws.onmessage=ev=>{ let m; try{ m=JSON.parse(ev.data); }catch(_){ return; } if(m.type==='hello'){ speech.model=m.asr||''; speechUI(); } else if(m.type==='decision')applyDecision(m); }; }
function applyDecision(m){ const t0=speech.sent[m.id]; delete speech.sent[m.id]; const rt=t0!=null?Math.round(performance.now()-t0):null; if(speech.state==='thinking')speech.state='ready';
  const heard=m.transcript||'';
  if(m.action==='accept'&&m.goal){ if(mission.queued&&mission.queued.goal===m.goal)mission.queued=null; world.order(m.goal,heard||null,m.source,m.params||{}); highlightGoal(m.goal); if(m.queued)world.queue(m.queued,null,m.queued_params||{}); }
  else if(m.action==='accept'&&m.turn){ if(heard)say('you',heard); say('master','Formation turns are a Swarm Mind order. Indoors, give a goal: '+GOAL_KEYS.map(g=>GOALS[g].toLowerCase()).join(', ')+'.'); }
  else if(m.action==='query'||m.action==='refuse'){ if(heard)say('you',heard); say('master',m.reply); }
  const tm=m.timings||{}; const what=m.action==='accept'&&m.goal?GOALS[m.goal]+' (v'+mission.version+')'+(m.params&&Object.keys(m.params).length?' '+esc(JSON.stringify(m.params)):''):m.action==='ignore'?'nothing heard'+(m.skipped?' ('+m.skipped+')':''):m.action;
  $('#speechlast').innerHTML=(heard?'“'+esc(heard)+'” → ':'')+'<b>'+what+'</b>'+(m.source==='speech'?' · speech '+(tm.audio_s||0).toFixed(1)+' s · recognition '+(tm.asr_ms||0)+' ms':'')+(rt!=null?' · release → order '+rt+' ms':'');
  speechUI(); }
function sendOrder(payload){ if(!speech.ws||speech.ws.readyState!==1){ speech.state='offline'; speechUI(); $('#speechlast').textContent='Speech server not running: start it with python main.py indoor --voice.'; return false; }
  payload.id=++speech.id; payload.context=speechContext(); speech.sent[payload.id]=performance.now(); speech.ws.send(JSON.stringify(payload)); return true; }
async function micOpen(){ if(speech.ctx)return true; try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    const actx=new AudioContext(); await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP],{type:'application/javascript'})));
    const node=new AudioWorkletNode(actx,'tap'); const mute=actx.createGain(); mute.gain.value=0; actx.createMediaStreamSource(stream).connect(node); node.connect(mute); mute.connect(actx.destination);
    speech.rate=actx.sampleRate; const preMax=Math.round(0.3*actx.sampleRate);
    node.port.onmessage=e=>{ const f=e.data; if(speech.rec)speech.buf.push(f); else { speech.pre.push(f); let n=0; for(const p of speech.pre)n+=p.length; while(n>preMax&&speech.pre.length>1){ n-=speech.pre[0].length; speech.pre.shift(); } } };
    speech.ctx=actx; return true;
  }catch(err){ $('#speechlast').textContent='Microphone unavailable ('+err.message+'). Type the order instead, or open the page in Chrome.'; return false; } }
function toWav16k(chunks,rate){ let n=0; for(const c of chunks)n+=c.length; const x=new Float32Array(n); let o=0; for(const c of chunks){ x.set(c,o); o+=c.length; }
  const r=rate/16000, m=Math.floor(n/r), y=new Int16Array(m);
  for(let i=0;i<m;i++){ const a=Math.floor(i*r), b=Math.max(a+1,Math.floor((i+1)*r)); let s=0; for(let k=a;k<b&&k<n;k++)s+=x[k]; const v=Math.max(-1,Math.min(1,s/(b-a))); y[i]=v<0?v*32768:v*32767; }
  const buf=new ArrayBuffer(44+y.length*2), dv=new DataView(buf); const w=(o,s)=>{ for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i)); };
  w(0,'RIFF'); dv.setUint32(4,36+y.length*2,true); w(8,'WAVE'); w(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,16000,true); dv.setUint32(28,32000,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); w(36,'data'); dv.setUint32(40,y.length*2,true);
  new Int16Array(buf,44).set(y); return buf; }
function b64(buf){ const u=new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }
async function talkStart(){ if(speech.rec||speech.stopping)return; speech.want=true; if(!(await micOpen()))return; if(!speech.want)return; if(speech.ctx.state==='suspended')await speech.ctx.resume(); speech.buf=speech.pre.slice(); speech.pre=[]; speech.rec=true; speech.state='listening'; speechUI(); }
function talkStop(){ speech.want=false; if(!speech.rec||speech.stopping)return; speech.stopping=true;
  setTimeout(()=>{ speech.rec=false; speech.stopping=false; const chunks=speech.buf; speech.buf=[]; if(sendOrder({type:'order_audio',wav_b64:b64(toWav16k(chunks,speech.rate))}))speech.state='thinking'; speechUI(); },150); }
$('#talkbtn').addEventListener('pointerdown',e=>{ e.preventDefault(); talkStart(); }); for(const ev of ['pointerup','pointerleave','pointercancel'])$('#talkbtn').addEventListener(ev,()=>talkStop());
const typing=e=>['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName);
window.addEventListener('keydown',e=>{ if(typing(e))return;
  if(e.code==='Space'){ e.preventDefault(); if(!e.repeat)talkStart(); return; }
  const n='1234567890'.indexOf(e.key); if(n>=0){ world.setGoal(GOAL_KEYS[n],{}); highlightGoal(GOAL_KEYS[n]); return; }
  if(e.key==='p')togglePlay(); else if(e.key==='r')resetWorld(); else if(e.key==='n'){ ui.seed++; resetWorld(); } });
window.addEventListener('keyup',e=>{ if(e.code!=='Space'||typing(e))return; e.preventDefault(); talkStop(); });
const sendTyped=()=>{ const t=$('#ordertxt').value.trim(); if(!t)return; if(sendOrder({type:'order_text',text:t}))$('#ordertxt').value=''; };
$('#ordersend').addEventListener('click',sendTyped); $('#ordertxt').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); sendTyped(); } });

// ---------- buttons and clicks ----------
for(const b of $('#goalseg').children)b.addEventListener('click',()=>{ world.setGoal(b.dataset.goal,{}); highlightGoal(b.dataset.goal); });
const seg=(id,key,fn)=>{ for(const b of $(id).children)b.addEventListener('click',()=>{ for(const o of $(id).children)o.classList.toggle('on',o===b); fn(b.dataset[key]); }); };
seg('#whoseg','who',v=>{ ui.who=v; resetWorld(); }); seg('#layseg','lay',v=>{ ui.layout=v; resetWorld(); }); seg('#speed','s',v=>{ ui.speed=+v; });
function togglePlay(){ ui.running=!ui.running; $('#play').textContent=ui.running?'Pause':'Play'; $('#play').classList.toggle('on',!ui.running); }
$('#play').addEventListener('click',togglePlay); $('#reset').addEventListener('click',resetWorld);
cv.addEventListener('click',e=>{ if(!person.alive)return; const r=cv.getBoundingClientRect(), dpr=window.devicePixelRatio||1; const x=((e.clientX-r.left)*dpr-ui.ox)/ui.scale, z=((e.clientY-r.top)*dpr-ui.oy)/ui.scale;
  const p=nearestFreeNav(WALK,x,z,1.5); if(!p)return; person.setTarget(p); if(person.state==='hiding')person.state='approach'; say('site','You sent the '+(person.role==='visitor'?'visitor':'intruder')+' toward the '+roomName(roomAt(p.x,p.z))+'.'); });
window.addEventListener('resize',()=>{ ui.fitKey=''; });

// ---------- main loop ----------
resetWorld(); speechConnect(); speechUI();
let last=performance.now(),uiT=0,acc=0; const STEP=1/60;
function frame(now){ const real=Math.min(0.05,(now-last)/1000); last=now;
  if(ui.running){ acc+=real*ui.speed; let n=0; while(acc>=STEP&&n<16){ world.step(STEP); acc-=STEP; n++; } if(n>=16)acc=0; }
  render(); uiT-=real; if(uiT<=0){ uiT=0.15; updatePanel(); }
  requestAnimationFrame(frame); }
requestAnimationFrame(frame);
window.SIM={world,team,person,mission,metrics,settings,GOALS,talk,speechContext,applyDecision,get simT(){ return simT; },get plan(){ return plan; }};
})();
</script>
</body>
</html>
'''

open(os.path.join(HERE, '..', 'index.html'), 'w').write(HEAD + core + UI)
print('written')
