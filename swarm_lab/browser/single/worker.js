import {SingleSimulation} from './simulation.js';
let simulation=null,last=performance.now(),accumulator=0,lastPublish=0,hidden=false;
const publish=()=>simulation&&postMessage({type:'state',state:simulation.snapshot()});
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){const response=await fetch(new URL('./flight-policy.json',import.meta.url));if(!response.ok)throw Error('Could not load flight-policy weights');simulation=new SingleSimulation(await response.json(),data.config);publish();return;}
  if(!simulation)throw Error('Flight model is loading');
  if(data.type==='visibility'){hidden=data.hidden;last=performance.now();accumulator=0;simulation.manual=[0,0,0,0];return;}
  if(data.type==='vla_reply'){simulation.acceptExternal(data.reply);return;}
  if(data.type==='vla_error'){simulation.failExternal(data.message);return;}
  const command=data.command;
  if(command==='reset')simulation.reset(data.config);
  else if(command==='pause')simulation.running=!simulation.running;
  else if(command==='step'){simulation.running=false;for(let i=0;i<12;i++)simulation.step(true);}
  else if(command==='select')simulation.select(data.id,data.reference);
  else if(command==='start')simulation.start(data.instruction);
  else if(command==='hold')simulation.hold();
  else if(command==='camera')simulation.setCamera(data.settings);
  else if(command==='manual')simulation.setManual(data.enabled);
  else if(command==='input')simulation.manual=data.input;
  else if(command==='policy')simulation.setPolicyMode(data.mode);
  else if(command==='observation'){const request=simulation.externalObservation();if(request)postMessage({type:'vla_request',request});return;}
  else throw Error('Unknown command');
  accumulator=0;publish();
 }catch(error){postMessage({type:'error',message:error.message});}
};
setInterval(()=>{
 const now=performance.now(),elapsed=Math.min(.1,(now-last)/1000);last=now;
 if(!simulation||hidden||!simulation.running){accumulator=0;return;}
 try{accumulator+=elapsed;let steps=0;while(accumulator>=1/240&&steps<24&&simulation.running){simulation.step();accumulator-=1/240;steps++;}if(now-lastPublish>49){lastPublish=now;publish();}}
 catch(error){simulation.running=false;postMessage({type:'error',message:error.message});publish();}
},4);
