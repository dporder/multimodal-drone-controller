import {Simulation} from './sim/simulation.js';

let simulation=null,last=performance.now(),accumulator=0,lastPublish=0,hidden=false,backendBusy=false,lastControlStart=0;
function publish() {if(simulation)postMessage({type:'state',state:simulation.snapshot()});}
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init'){
      const response=await fetch(new URL('../models/world.json',import.meta.url));
      if(!response.ok)throw Error('Could not load world specification');
      simulation=new Simulation(await response.json(),data.config);last=performance.now();accumulator=0;publish();
    } else if(data.type==='camera_frame'&&simulation){
      const packet=data.packet;
      if(backendBusy||hidden||packet.version!==simulation.version||packet.control_revision!==simulation.controlRevision||Math.abs(packet.time-simulation.time)>1e-6){postMessage({type:'backend_status',skipped:true});return;}
      backendBusy=true;const start=performance.now(),interval=lastControlStart?start-lastControlStart:50;lastControlStart=start;
      try{
        simulation.observeCameras(packet.frames);
        packet.perception={visible:[...simulation.visible],last_seen:structuredClone(simulation.lastSeen)};
        packet.reference_origin=[...simulation.referenceOrigin];
        const map=simulation.observedMap.snapshot(simulation.time);
        // The shared map retains its surface cloud locally. Send the master
        // fused landmark bounds/provenance rather than retransmitting the cloud
        // and flight history on every 50 ms control exchange.
        packet.environment.observed_map={frame:map.frame,world_origin:map.world_origin,revision:map.revision,time:map.time,source:map.source,point_count:map.point_count,
          objects:map.objects.map(({points,...object})=>object),views:map.views};
        const response=await fetch('http://127.0.0.1:8767/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet),signal:AbortSignal.timeout(10000)});
        const reply=await response.json();if(!response.ok)throw Error(reply.error||`Controller HTTP ${response.status}`);
        if(reply.version!==packet.version||reply.sequence!==packet.sequence||reply.time!==packet.time)throw Error('Mismatched Python control response');
        reply.round_trip_ms=performance.now()-start;reply.loop_interval_ms=interval;
        const applied=!hidden&&simulation.stepExternal(reply);publish();
        if(!applied){postMessage({type:'backend_status',skipped:true});return;}
        postMessage({type:'backend_status',round_trip_ms:reply.round_trip_ms,processing_ms:reply.processing_ms,interval});
      }catch(error){postMessage({type:'backend_status',error:error.message});}
      finally{backendBusy=false;}
    } else if(data.type==='control'&&simulation){
      if(!hidden)simulation.stepExternal(data.reply);publish();
    } else if(data.type==='visibility'){
      hidden=data.hidden;last=performance.now();accumulator=0;
      if(hidden&&simulation){simulation.actor.manual_input=[0,0];publish();}
    } else if(data.type==='graph'&&simulation)postMessage({type:'graph',graph:simulation.graph()});
    else if(data.type==='command'){
      if(!simulation)throw Error('Simulation is still loading');
      simulation.command(data.command);accumulator=0;last=performance.now();publish();postMessage({type:'ack',id:data.id});
    }
  } catch(error){postMessage({type:'error',id:data.id,message:error.message});}
};
setInterval(()=>{
  const now=performance.now(),elapsed=Math.min(.1,(now-last)/1000);last=now;
  if(!simulation||simulation.config.controller==='python'||hidden||!simulation.running){accumulator=0;return;}
  try {
    accumulator+=elapsed*simulation.speed;
    let steps=0;
    while(accumulator>=1/30&&steps<6&&simulation.running){simulation.step();accumulator-=1/30;steps++;}
    if(now-lastPublish>=50||!simulation.running){simulation.observeNativeCameras();publish();lastPublish=now;}
  } catch(error){simulation.running=false;postMessage({type:'error',message:error.message});publish();}
},8);
