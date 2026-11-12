import {distance,norm} from './math.js';

// The same executable branch IDs are used by the live decision view and the
// three-layer knowledge graph. Learned dynamics remain a separate predictor.
export const DECISION_NODES=[
  ['observe','Observe + update belief','Three ray sensors, timestamp, velocity and map',230,20],
  ['visible','Person visible?','A current ray must actually hit the person',230,100],
  ['occlusion','Locate occluding cover','Ray to last sighting; classify tree / building / unknown',30,190],
  ['route','Plan walking route to bridge','Ground A* excludes canals and solid buildings',430,190],
  ['ascend','Leader: raise viewpoint','Climb above estimated cover; bounded altitude',30,280],
  ['priority','Person keeps own route?','Drawn path and H finish before a new offer',430,280],
  ['split','Wings: cover both sides','Assign separate reachable blind-spot viewpoints',30,370],
  ['track','Track drawn route','Lead observation + left / right route indications',330,370],
  ['offer','Offer bridge route','Visible, at rest ≥ 6 s; retry interval 15 s',530,370],
  ['search','Search / expand belief','Use last velocity; expand scan if sight remains lost',30,460],
  ['choice','Independent response','Accept / refuse / seeded probability',530,460],
  ['reacquire','Reacquire + share sighting','Reset stale belief, refresh bridge route and orders',230,550],
  ['declined','Declined: keep tracking','Keep cover and route; retry only after cooldown',430,550],
  ['escort','Lead + two flank escorts','Leader marks onward route; wings maintain distinct sides',630,550],
  ['clearance','Route and speed checks','Map clearance, stopping distance, peer/person separation',330,640],
  ['reposition','Cruise / fast reposition','Up to 3 m/s only with sufficient forward clearance',130,730],
  ['detour','Detour / recover clearance','Wider street route; hold if no route exists',530,730],
  ['bridge','Bridge reached?','Accepted route ends inside the bridge goal tolerance',330,820],
  ['loiter','Loiter clear of bridge','Three separated viewpoints; person remains free',330,910],
].map(([id,label,detail,x,y])=>({id,label,detail,x,y}));
export const DECISION_EDGES=[
  ['observe','visible','sense'],['visible','occlusion','no'],['visible','route','yes'],
  ['occlusion','ascend','cover height'],['ascend','split','leader assigns wings'],['split','search','scan'],['search','reacquire','spotted'],['search','occlusion','still hidden'],
  ['reacquire','route','replan'],['route','priority','route found'],['priority','track','yes'],['priority','offer','no'],
  ['offer','choice','offer heard'],['choice','declined','refuse'],['choice','escort','accept'],['declined','offer','cooldown'],
  ['track','clearance','move'],['escort','clearance','move'],['search','clearance','move'],['declined','clearance','observe'],
  ['clearance','reposition','clear corridor'],['clearance','detour','blocked / close'],['reposition','bridge','arrive'],['detour','observe','replan'],['bridge','loiter','yes'],['bridge','observe','no'],
].map(([source,target,condition])=>({source,target,condition}));

export function decideTactics(s) {
  const previous=s.tactics,seen=s.lastSeen,visible=s.visible.some(Boolean),age=seen?Math.max(0,s.time-seen.time):null;
  if(visible&&previous?.lost)s.reacquiredUntil=s.time+2;
  const lost=!visible&&(!seen||age>.25);
  let cover=null;
  if(lost&&seen){
    const target=[seen.position[0],seen.position[1],seen.position[2]+seen.height*.6];
    const hit=s.physics.ray(s.positions()[0],target);
    cover=hit?.obstacle===undefined?null:s.obstacles[hit.obstacle];
    if(!cover)cover=s.obstacles.filter(o=>o.cover).sort((a,b)=>distance(a.position.slice(0,2),target.slice(0,2))-distance(b.position.slice(0,2),target.slice(0,2)))[0];
  }
  const top=cover?cover.position[2]+(cover.kind==='box'?cover.size[2]:cover.size[1])/2:6;
  const arrived=s.actor.intention==='leave via destination'&&s.actor.status==='at destination';
  let state,reason,active=['observe','visible'];
  if(lost){state=age>12?'expand_search':'search_cover';reason=`Sight lost${cover?' near '+cover.label:''}. Raise leader and cover both blind sides.`;active.push('occlusion','ascend','split','search');}
  else if(arrived){state='bridge_reached';reason='Person reached the bridge voluntarily; aircraft loiter clear.';active.push('route','escort','bridge','loiter');}
  else if(s.reacquiredUntil>s.time){state='reacquired';reason='A current sensor ray reacquired the person. Sharing sighting and replanning.';active.push('reacquire','route');}
  else if(s.actor.intention==='leave via destination'){state='escort';reason='Bridge route accepted. Leader indicates the next turn; wings escort from separate sides.';active.push('route','priority','offer','choice','escort');}
  else if((s.actor.route.length&&s.actor.routePriority)||s.actor.mode==='manual'||s.actor.intention==='inspect site'){state='track_route';reason='Person retains their route. Follow and show the bridge direction.';active.push('route','priority','track');}
  else if(s.actor.refused){state='declined';reason='Person declined. Maintain observation and wait for the next offer window.';active.push('route','priority','offer','choice','declined');}
  else {state='offer';reason=s.actor.decisionAt!==null?'Bridge offer heard; awaiting independent response.':'Maintain sight while the person finishes resting in cover.';active.push('route','priority','offer');}
  active.push('clearance');
  const leaderAltitude=lost?Math.min(10.2,Math.max(8.2,top+1.3)):6.6;
  const events=previous?.events||[];
  if(previous?.state!==state){events.push({time:s.time,state,reason});if(events.length>20)events.shift();s.replanAt=0;}
  s.tactics={state,reason,lost,active,cover:cover?{label:cover.label,kind:cover.semantic,top}:null,
    belief:seen?{position:[...seen.position],velocity:[...(seen.velocity||[0,0,0])],age,uncertainty_radius:Math.min(12,.4+age*Math.max(1,norm((seen.velocity||[0,0]).slice(0,2)))),source:'last ray observation'}:null,
    leader:0,leader_altitude:leaderAltitude,orders:[],events};
  return s.tactics;
}
