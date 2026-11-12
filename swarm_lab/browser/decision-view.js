import {DECISION_NODES,DECISION_EDGES} from './sim/tactics.js';

export function createDecisionView(){
  const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg',svg=$('decision-tree');
  const make=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;return e;};
  const points=new Map(DECISION_NODES.map(n=>[n.id,n]));let state=null,selected='visible',lastRender=0;
  const defs=make('defs',{}),marker=make('marker',{id:'decision-arrow',markerWidth:6,markerHeight:6,refX:5,refY:3,orient:'auto'});marker.append(make('path',{d:'M0,0 L6,3 L0,6',fill:'#72968d'}));defs.append(marker);svg.append(defs);
  for(const edge of DECISION_EDGES){const a=points.get(edge.source),b=points.get(edge.target);const path=make('path',{d:`M${a.x+90},${a.y+50} C${a.x+90},${a.y+72} ${b.x+90},${b.y-22} ${b.x+90},${b.y}`,class:'decision-edge','data-from':edge.source,'data-to':edge.target,'marker-end':'url(#decision-arrow)'});path.append(make('title',{},edge.condition));svg.append(path);}
  for(const n of DECISION_NODES){
    const g=make('g',{class:'decision-node','data-decision':n.id,transform:`translate(${n.x},${n.y})`,role:'button',tabindex:0,'aria-label':n.label});
    g.append(make('rect',{width:180,height:50,rx:7}));
    const words=n.label.split(' ');let lines=[''];for(const word of words){if((lines.at(-1)+' '+word).length>25)lines.push(word);else lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}
    lines.forEach((line,i)=>g.append(make('text',{x:90,y:lines.length===1?29:21+i*15,'text-anchor':'middle'},line)));
    g.append(make('title',{},n.detail));g.onclick=()=>{selected=n.id;detail();};g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();g.onclick();}};svg.append(g);
  }
  function detail(){const n=points.get(selected);$('decision-detail-title').textContent=n.label;$('decision-detail').textContent=n.detail;svg.querySelectorAll('.decision-node').forEach(g=>g.classList.toggle('selected',g.dataset.decision===selected));}
  function toggle(open){$('decision-panel').hidden=!open;document.body.classList.toggle('decisions-open',open);$('decision-toggle').classList.toggle('active',open);$('decision-toggle').setAttribute('aria-expanded',String(open));if(open){document.body.classList.add('focus-scene');$('focus-scene').textContent='Show panels';update(state,true);}window.dispatchEvent(new Event('resize'));}
  $('decision-toggle').onclick=()=>toggle($('decision-panel').hidden);$('decision-close').onclick=()=>toggle(false);detail();
  function update(s,force=false){state=s;if(!s||$('decision-panel').hidden||!force&&performance.now()-lastRender<200)return;lastRender=performance.now();
    const t=s.tactics,active=new Set(s.mode==='guidance'?t?.active||[]:[]);
    $('decision-state').textContent=!t?'Canal-block controller':s.mode!=='guidance'?'Operator override':t.state.replaceAll('_',' ');
    $('decision-reason').textContent=t?t.reason:'Select the Amsterdam scene to run the coordinated search and escort controller.';
    $('decision-belief').textContent=t?.belief?`Last sighting ${t.belief.age.toFixed(1)} s ago · uncertainty radius ${t.belief.uncertainty_radius.toFixed(1)} m${t.cover?' · cover: '+t.cover.label:''}`:'No person observation yet';
    svg.querySelectorAll('.decision-node').forEach(g=>g.classList.toggle('active',active.has(g.dataset.decision)));
    svg.querySelectorAll('.decision-edge').forEach(g=>g.classList.toggle('active',active.has(g.dataset.from)&&active.has(g.dataset.to)));
    $('decision-orders').replaceChildren(...(t?.orders||[]).map(o=>{const row=document.createElement('div');row.className='decision-order';const name=document.createElement('strong'),action=document.createElement('span'),target=document.createElement('small');name.textContent=`D${o.drone+1} · ${o.role}`;action.textContent=o.action;target.textContent=`Target ${o.target.map(x=>x.toFixed(1)).join(', ')} m · limit ${o.speed_limit.toFixed(1)} m/s`;row.append(name,action,target);return row;}));
    $('decision-log').replaceChildren(...(t?.events||[]).slice(-5).reverse().map(e=>{const row=document.createElement('li');row.textContent=`${e.time.toFixed(1)} s — ${e.reason}`;return row;}));
    $('decision-predictor').textContent=`Dynamics predictor: ${s.world_model.ready?'learning':'collecting'} · ${s.world_model.samples} samples${s.world_model.velocity_rmse===null?'':' · error '+s.world_model.velocity_rmse.toFixed(3)+' m/s'}. Flight decisions above are explicit rules; the predictor estimates motion.`;
  }
  return {update};
}
