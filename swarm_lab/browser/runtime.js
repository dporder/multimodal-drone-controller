// The worker owns the entire simulation. Messages are serialized commands and
// immutable snapshots; neither rendering nor graph inspection advances physics.
export function createRuntime(onState,onError) {
  const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  const session=crypto.randomUUID(),channel=new BroadcastChannel('swarm-lab-'+session);
  let graph=null,sequence=0,inFlight=false,lastSent=null,retryAt=0,pendingControl=null;
  const controller=new URLSearchParams(location.search).get('controller')||'python';
  const graphLink=document.querySelector('.graph-link');graphLink.href=`graph.html?session=${session}`;graphLink.target='_blank';graphLink.rel='noopener';
  document.getElementById('decision-graph-link').href=`graph.html?session=${session}&view=decisions`;
  worker.onmessage=({data})=>{
    if(data.type==='state'){if(data.state.external_control?.sequence===pendingControl)inFlight=false;onState(data.state);}
    else if(data.type==='backend_status'){
      inFlight=false;
      if(data.error){lastSent=null;retryAt=performance.now()+1000;document.getElementById('backend-status').textContent=`Python unavailable · physics paused · ${data.error}`;document.getElementById('connection').textContent='Waiting for Python controller';}
      else if(!data.skipped)document.getElementById('backend-status').textContent=`Python ${(1000/data.interval).toFixed(1)} Hz · ${data.round_trip_ms.toFixed(0)} ms round trip · ${data.processing_ms.toFixed(0)} ms compute`;
    }
    else if(data.type==='graph'){graph=data.graph;channel.postMessage({type:'graph',graph});}
    else if(data.type==='error')onError(data.message);
  };
  worker.onerror=e=>onError(e.message||'Browser worker failed to start');
  channel.onmessage=({data})=>{if(data.type==='request'){if(graph)channel.postMessage({type:'graph',graph});worker.postMessage({type:'graph'});}};
  const graphTimer=setInterval(()=>worker.postMessage({type:'graph'}),1000);
  document.addEventListener('visibilitychange',()=>worker.postMessage({type:'visibility',hidden:document.hidden}));
  window.addEventListener('pagehide',()=>{clearInterval(graphTimer);worker.terminate();channel.close();},{once:true});
  const scene=new URLSearchParams(location.search).get('scene')||'amsterdam';
  const parameters=new URLSearchParams(location.search),map_source=parameters.get('map')||'known',sensor_profile=parameters.get('sensors')||'nominal';
  const seed=Number(parameters.get('seed')||7);
  worker.postMessage({type:'init',config:{scene,controller,map_source,sensor_profile,seed}});
  async function controlFrame(frames,state){
    if(controller!=='python'||inFlight||document.hidden||state.finished||(!state.running&&!state.step_pending)||performance.now()<retryAt)return;
    const key=`${state.version}:${state.control_revision}:${state.time}`;if(lastSent===key)return;
    const p=state.person,packet={protocol_version:2,control_revision:state.control_revision,session,sequence:++sequence,version:state.version,seed:state.seed,time:state.time,mode:state.mode,
      reference_origin:state.reference_origin,goal:state.destination,environment:{map_source:state.config.map_source,sensor_profile:state.config.sensor_profile,obstacles:state.config.map_source==='known'?state.obstacles:[],wind:state.wind},drones:state.drones,frames,
      relative_coordinates:state.drone_modules.slaves_relative,perception:state.perception,
      intruder:{intention:p.intention,status:p.status,mode:p.mode,refused:p.refused,route_pending:!!p.route.length,route_priority:p.route_priority,path_assigned:!!p.drawn_path.length,compliance:p.compliance}};
    inFlight=true;pendingControl=packet.sequence;lastSent=key;worker.postMessage({type:'camera_frame',packet});
  }
  return {command:command=>{lastSent=null;worker.postMessage({type:'command',id:++sequence,command});},controlFrame};
}
