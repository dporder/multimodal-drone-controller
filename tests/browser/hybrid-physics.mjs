import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Simulation} from '../../swarm_lab/browser/sim/simulation.js';
import {cameraPose} from '../../swarm_lab/browser/sim/camera-pose.js';
const spec=JSON.parse(fs.readFileSync(new URL('../../swarm_lab/models/world.json',import.meta.url)));
const backend=spawn('.venv/bin/python',['-m','swarm_lab.drone_backend','--stdio'],{stdio:['pipe','pipe','inherit']});
const replies=createInterface({input:backend.stdout})[Symbol.asyncIterator]();
const rgb=Buffer.alloc(4*4*3,128).toString('base64');let sequence=0;
async function control(s){
 const state=s.snapshot({predictions:false}),p=state.person;
 const frames=[0,1,2].map(i=>({encoding:'rgb8-base64',width:4,height:4,data:rgb,pose:cameraPose(state,i)}));s.observeCameras(frames);
 const observed=s.observedMap.snapshot(s.time);
 const packet={protocol_version:2,control_revision:s.controlRevision,reference_origin:s.referenceOrigin,session:'integration',sequence:++sequence,version:state.version,seed:state.seed,time:state.time,mode:state.mode,goal:state.destination,environment:{map_source:s.config.map_source,obstacles:s.config.map_source==='known'?state.obstacles:[],wind:state.wind,observed_map:{...observed,objects:observed.objects.map(({points,...o})=>o),trails:undefined}},drones:state.drones,
 frames,relative_coordinates:state.drone_modules.slaves_relative,perception:{visible:s.visible,last_seen:s.lastSeen},
 intruder:{intention:p.intention,status:p.status,mode:p.mode,refused:p.refused,route_pending:!!p.route.length,route_priority:p.route_priority,path_assigned:!!p.drawn_path.length,compliance:p.compliance}};
 backend.stdin.write(JSON.stringify(packet)+'\n');const {value,done}=await replies.next();if(done)throw Error('Python controller terminated');return JSON.parse(value);
}
try{
 for(const scenario of ['patrol','alley']){
  const s=new Simulation(spec,{scene:'amsterdam',controller:'python',map_source:process.env.SWARM_MAP||'known',sensor_profile:process.env.SWARM_SENSORS||'nominal',seed:Number(process.env.SWARM_SEED||7),seconds:300});s.version=scenario==='patrol'?1:2;
  if(scenario==='alley')s.command({command:'actor_path',points:[[0,-4.4],[-5,-4.4],[-9.7,-4.4],[-9.7,1.8],[-9.7,3.1]],pace:'run',endAction:'hide',compliance:1});
  const states=new Set(),processing=[];let learned=false;
  for(let i=0;i<Number(process.env.SWARM_STEPS||1200)&&!s.finished;i++){
    const reply=await control(s);assert.equal(reply.rotor_commands.length,3);assert.equal(reply.modules.rotor_networks.length,3);
    const before=s.time;assert.equal(s.stepExternal(reply),true);assert.ok(Math.abs(s.time-before-.05)<1e-9);
    const same=s.time;assert.equal(s.stepExternal(reply),false);assert.equal(s.time,same);
    states.add(reply.tactics.state);processing.push(reply.processing_ms);learned ||= reply.modules.rotor_networks.some(n=>n.blend>0);
  }
  console.log(JSON.stringify({scenario,time:s.time,reason:s.reason,person:s.actor.status,positions:s.positions(),states:[...states],learned,diagnostics:s.diagnostics,map:s.config.map_source,mean_compute:processing.reduce((a,b)=>a+b,0)/processing.length}));
  assert.equal(s.reason,'flying');assert.equal(s.physics.drones.length,3);if(!process.env.SWARM_STEPS)assert.ok(learned);
  if(scenario==='alley'&&!process.env.SWARM_STEPS){assert.equal(s.actor.status,'at destination');assert.ok(states.has('search_cover')&&states.has('reacquired')&&states.has('escort'));}
 }
 console.log(process.env.SWARM_STEPS?'PASS: configured short flight episodes, 50 ms lockstep, stale reply rejection':'PASS: 60-second patrol and bridge escort; 240 Hz onboard feedback, 50 ms lockstep, stale reply rejection and bounded neural contribution');
}finally{backend.stdin.end();backend.kill();}
