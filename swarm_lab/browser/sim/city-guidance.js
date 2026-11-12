import {Navigator} from './navigation.js';
import {add,sub,scale,unit,norm,distance,dot} from './math.js';
import {decideTactics} from './tactics.js';

// Sample distance along the walking route, including its corners. Route markers
// must turn around a house with the person, not extend through its facade.
function along(start,route,meters) {
  let from=start.slice(0,2);
  for(const to of route){const d=distance(from,to);if(d>=meters)return add(from,scale(unit(sub(to,from)),meters));meters-=d;from=to;}
  return from;
}

export function cityGuidance(s) {
  const tactics=decideTactics(s);
  if(!s.lastSeen){s.guidanceStatus='Searching for first sighting';return;}
  const positions=s.positions(),seen=s.lastSeen,visible=s.visible.some(Boolean);
  const recovery=new Navigator(s.obstacles,.55,3.8,.35);
  const recoveryMargin=new Navigator(s.obstacles,1.9,3.8,.35);
  const walk=new Navigator(s.obstacles,.42,.9,.9,true),person=seen.position.slice(0,2);
  // A short, bounded motion estimate comes only from the last real sighting.
  // No hidden actor position, operator path or hide target is available here.
  let search=[...person];
  if(!visible){
    const velocity=(seen.velocity||[0,0]).slice(0,2),travel=Math.min(7,norm(velocity)*Math.min(4,s.time-seen.time));
    for(let d=.25;d<=travel;d+=.25){const next=add(person,scale(unit(velocity),d));if(!walk.segmentClear(person,next))break;search=next;}
  }
  s.guidanceStatus=tactics.reason;
  const altitudes=[tactics.leader_altitude,3.8,5.2];

  if(s.time>=s.replanAt){
    s.replanAt=s.time+1;
    s.exitRoute=walk.path(person,s.actor.destination);
    let direction=unit(sub(s.exitRoute[0]||s.actor.destination.slice(0,2),person));if(norm(direction)<.1)direction=[0,1];
    const lateral=[-direction[1],direction[0]];
    const selected=[];
    for(let i=0;i<3;i++){
      // One leader marks the route; the two wings use opposite sides where
      // reachable. Different altitudes allow passing within the wider streets.
      const altitude=altitudes[i];
      if(!s.airNav.clear(positions[i])){
        const target=recoveryMargin.nearestClear(positions[i]);
        s.routes[i]=recovery.path(positions[i],target);s.droneRoles[i]='Recover street clearance';continue;
      }
      const side=i===0?0:i===1?-1:1;
      let ideal=visible?add(along(person,s.exitRoute,i===0?4.5:1.8),scale(lateral,side*2.5)):add(search,scale(lateral,side*4));
      if(tactics.state==='expand_search'){
        const angle=Math.floor((s.time-seen.time-12)/8)*Math.PI/3+side*Math.PI*.65;
        ideal=add(search,[5*Math.cos(angle),5*Math.sin(angle)]);
      }
      const candidates=[ideal];
      for(const radius of [2,4,6])for(let a=0;a<12;a++){
        const angle=a*Math.PI/6;candidates.push([ideal[0]+radius*Math.cos(angle),ideal[1]+radius*Math.sin(angle)]);
      }
      const scored=candidates.filter(p=>s.airNav.clear(p)&&selected.every(q=>distance(p,q)>2.4)).map(p=>{
        const target=[...search,seen.position[2]+seen.height*.6];
        const sight=!s.physics.ray([...p,altitude],target);
        const wrongSide=side&&dot(sub(p,search),lateral)*side<-.5;
        return {p,score:distance(p,ideal)+(sight?0:8)+(wrongSide?5:0)+.08*distance(p,positions[i].slice(0,2))};
      }).sort((a,b)=>a.score-b.score);
      let route=[];
      for(const {p} of scored.slice(0,16)){route=s.airNav.path(positions[i],p);if(route.length){selected.push(p);break;}}
      s.routes[i]=route;
      s.droneRoles[i]=visible?['Leader · bridge route','Left wing · escort','Right wing · escort'][i]:['Leader · elevated scan','Left wing · blind spot','Right wing · blind spot'][i];
      if(!route.length){if(!s.routeBlocked[i])s.goals[i]=[positions[i][0],positions[i][1],altitude];s.routeBlocked[i]=true;}
    }
  }
  for(let i=0;i<3;i++){
    const route=s.routes[i],p=positions[i];if(!route.length)continue;
    if(distance(p.slice(0,2),route[0])<.6&&route.length>1&&s.airNav.segmentClear(p,route[1]))route.shift();
    const goal=[...route[0],altitudes[i]];
    const nav=s.airNav.clear(p)?s.airNav:recovery;
    if(nav.segmentClear(p,goal)){s.goals[i]=goal;s.routeBlocked[i]=false;}
    else {if(!s.routeBlocked[i])s.goals[i]=[p[0],p[1],goal[2]];s.routeBlocked[i]=true;}
  }
  tactics.orders=s.goals.map((target,i)=>{
    const p=positions[i],delta=sub(target,p),heading=Math.atan2(delta[1],delta[0]);
    const forward=s.ranges[i].filter((_,r)=>Math.cos(r*Math.PI/6-heading)>.7);
    const clearance=Math.min(...forward),rapid=norm(delta)>6&&clearance>5&&!s.routeBlocked[i];
    s.droneSpeedLimits[i]=rapid?3:1.8;
    return {drone:i,commander:0,role:s.droneRoles[i],action:s.routeBlocked[i]?'Hold / recover clearance':rapid?'Fast reposition':tactics.lost&&i===0?'Ascend and scan':'Follow assigned viewpoint',target:[...target],altitude:altitudes[i],speed_limit:s.droneSpeedLimits[i],forward_clearance:clearance,route_blocked:s.routeBlocked[i],waypoints:s.routes[i].map(p=>[...p])};
  });
  tactics.active.push(s.routeBlocked.some(Boolean)?'detour':'reposition');
  if(s.routeBlocked.every(Boolean))s.guidanceStatus='Bridge mission · no reachable observation route';
}
