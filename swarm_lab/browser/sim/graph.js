export function browserSpec(source) {
  const spec=structuredClone(source);
  for(const [id,label] of [['building','Canal house'],['canal','Canal water / non-walkable'],['bridge','Footbridge'],['stairs','Walkable stairs'],['terrace','Raised terrace'],['barrier','Jumpable low rail']])spec.object_types.push({id,label,solid:id!=='canal',occludes:id==='building',walkable:['bridge','stairs','terrace'].includes(id)});
  spec.actions.push({id:'follow_drawn_path',layer:'person',effects:['follow collision-checked operator route','perform endpoint action'],engine:'browser_route_navigation'});
  spec.actions.push({id:'use_stairs',layer:'person',preconditions:['walkable support','step height <= 0.26 m'],effects:['walk up/down tread elevations'],engine:'support_height_navigation'});
  spec.runtime={engine:'Cannon ES 0.20.0',execution:'browser module worker',physics_hz:240,control_hz:30};
  spec.actions.find(a=>a.id==='observe').engine='cannon_es_raycast';
  spec.laws.find(l=>l.id==='contact').equation='Cannon ES constrained rigid-body contact';
  return spec;
}
export function graph(spec,s) {
  const nodes=[],edges=[];
  const node=(id,layer,kind,label,properties={})=>nodes.push({id,layer,kind,label,properties});
  const edge=(source,target,relation)=>edges.push({source,target,relation});
  for(const l of spec.layers)node(l.id,l.id,'layer',l.label,l);
  for(const t of spec.object_types){const layer=t.id==='person'?'person':t.id==='drone'?'swarm':'environment';node('type:'+t.id,layer,'type',t.label,t);edge('type:'+t.id,layer,'PART_OF');}
  for(const l of spec.laws){node('law:'+l.id,l.layer,'law',l.id.replaceAll('_',' '),l);edge(l.layer,'law:'+l.id,'GOVERNED_BY');}
  for(const a of spec.actions){node('action:'+a.id,a.layer,'action',a.id.replaceAll('_',' '),a);edge(a.layer,'action:'+a.id,'CAN_PERFORM');}
  node('actor','person','agent','Person',s.person);edge('actor','type:person','IS_A');
  node('destination','environment','goal',s.destination_label||'Exit / destination',{position:s.destination});
  node('mission_frame','environment','reference_frame','Fixed mission origin',{world_origin:s.reference_origin,axes:'world XYZ / Z up',origin_at:'episode_start'});
  for(const observed of s.observed_map?.objects||[]){const id='observed:'+observed.id;node(id,'swarm','observation',observed.label,{...observed,points:undefined,frame:'mission_origin'});edge(id,'mission_frame','LOCATED_IN');edge(id,observed.id,'OBSERVATION_OF');for(const i of observed.seen_by)edge('drone:'+i,id,'OBSERVED');}
  node('person_goal','person','goal','Person’s chosen goal',{position:s.person.goal,intention:s.person.intention});edge('actor','person_goal','HAS_GOAL');
  if((s.continuous_guidance||s.person.intention==='leave via destination')&&s.mode==='guidance')edge('swarm','destination','INDICATES_ROUTE_TO');
  node('ground','environment','object','Ground',{position:[0,0,0],friction:.7});edge('ground','type:ground','IS_A');edge('ground','actor','SUPPORTS');
  if(s.perception.last_seen){node('last_observation','swarm','observation','Last person observation',s.perception.last_seen);edge('swarm','last_observation','LAST_OBSERVED');}
  if(s.tactics){
    node('tactical_belief','swarm','belief','Observed world belief',s.tactics.belief||{});edge('swarm','tactical_belief','REASONS_FROM');
    for(const n of DECISION_NODES){node('decision:'+n.id,'swarm','decision',n.label,{description:n.detail,active:s.mode==='guidance'&&s.tactics.active.includes(n.id),state:s.tactics.state});edge('tactical_belief','decision:'+n.id,'INFORMS');}
    for(const e of DECISION_EDGES)edge('decision:'+e.source,'decision:'+e.target,e.condition);
    for(const order of s.tactics.orders){const id='order:'+order.drone;node(id,'swarm','order',`D${order.drone+1}: ${order.action}`,order);edge('drone:0',id,'ISSUES');edge(id,'drone:'+order.drone,'ASSIGNS');}
    edge('drone:0','drone:1','COORDINATES');edge('drone:0','drone:2','COORDINATES');
  }
  for(const d of s.drones){const id='drone:'+d.id;node(id,'swarm','agent',`Drone ${d.id+1}`,d);edge(id,'type:drone','IS_A');edge(id,'swarm','PART_OF');edge(id,'actor','AVOIDS');if(s.perception.visible[d.id])edge(id,'actor','OBSERVES');for(let j=0;j<3;j++)if(j!==d.id)edge(id,'drone:'+j,'COMMUNICATES_WITH');d.motors.forEach((f,k)=>{const r=id+':rotor:'+k;node(r,'swarm','actuator',`D${d.id+1} / rotor ${k+1}`,{thrust_N:f,angular_speed:d.motor_speeds[k]});edge(r,id,'PART_OF');});}
  s.obstacles.forEach((o,j)=>{const id='object:'+j;node(id,'environment','object',o.label,o);edge(id,'type:'+o.semantic,'IS_A');edge(id,'environment','PART_OF');if(!o.walkable)edge(id,'actor','BLOCKS');if(o.solid!==false)edge(id,'swarm','OCCLUDES');if(o.walkable)edge(id,'actor','SUPPORTS');if(o.climbable)edge(id,'action:climb_low_surface','SUPPORTS');});
  if(s.config.scene==='office'){for(const [id,kind,label,p] of [['door:1','door','Open entry doorway',[0,-12,0]],['window:1','window','Open observation window',[0,12,2]],['room:1','room','Furnished room',[0,2,0]],['hall:1','hall','Central aisle',[0,-5,0]]]){node(id,'environment','region',label,{position:p});edge(id,'type:'+kind,'IS_A');edge(id,'environment','PART_OF');}edge('door:1','hall:1','CONNECTS');edge('hall:1','room:1','CONNECTS');}
  return {schema_version:1,units:spec.units,invariants:spec.invariants,runtime:spec.runtime,time:s.time,tactics:s.tactics&&s.mode!=='guidance'?{...s.tactics,active:[],state:'operator_'+s.mode}:s.tactics,nodes,edges};
}
import {DECISION_NODES,DECISION_EDGES} from './tactics.js';
