export function makeScene(kind,rng) {
  const obstacles=[];
  const item=(label,semantic,position,size,color,extra={})=>obstacles.push({kind:'box',label,semantic,position,size,color,...extra});
  const box=(x,y,sx,sy,sz,color)=>item('',null,[x,y,sz/2],[sx,sy,sz],color);
  if(kind==='yard') {
    for(const [x,y] of [[-9,-7],[8,-6],[-8,7],[9,8],[0,10]]) box(x+rng.uniform(-.6,.6),y,4.8,2.4,2.6,['#ae684c','#547a80','#c5b182'][Math.floor(rng.random()*3)]);
    box(0,-11,5,3,4.5,'#a8aca5');box(-1,4,1.8,1.8,2,'#b79c70');
  } else if(kind==='warehouse') {
    for(const x of [-10,-5,5,10]) for(const y of [-8,7]) box(x,y,2.6,4,5,'#71818a');
    for(const x of [-16,16]) item('Side wall','wall',[x,0,4],[.4,32,8],'#89918b');
    for(const y of [-16,16]) item('End wall','wall',[0,y,4],[32,.4,8],'#89918b');
    item('Ceiling','ceiling',[0,0,8.2],[32,32,.4],'#aab0a9',{ceiling:true});
  } else if(kind==='office') {
    for(const x of [-15,15]) item('Side wall','wall',[x,0,2.6],[.3,24,5.2],'#b5b4a4');
    for(const x of [-8.5,8.5]) item('Entry wall','wall',[x,-12,2.6],[13,.3,5.2],'#b5b4a4');
    item('Door lintel','wall',[0,-12,4.2],[4,.3,2],'#b5b4a4');
    item('Window sill wall','wall',[0,12,.6],[30,.3,1.2],'#b5b4a4');
    item('Window header wall','wall',[0,12,3.95],[30,.3,2.5],'#b5b4a4');
    for(const x of [-9,9]) item('Window side wall','wall',[x,12,1.95],[12,.3,1.5],'#b5b4a4');
    item('Sofa','sofa',[-7,3,.45],[3,1.1,.9],'#5a7780');
    item('Coffee table','table',[-3,3,.425],[1.6,1,.85],'#ae8a5e',{climbable:true});
    item('Television','tv',[-7,5,1.1],[2,.15,1.1],'#263239');
    item('Work table','table',[6,6,.5],[2.4,1.2,1],'#b2956c',{climbable:true});
    item('Storage cabinet','shelf',[-10,-6,1.2],[2,1.2,2.4],'#a6987f');
    item('Central divider','wall',[3,4,1.1],[.2,4,2.2],'#b8b7a7');
    item('Ceiling','ceiling',[0,0,5.4],[30,24,.3],'#c9c8b8',{ceiling:true});
  } else if(kind==='forest') {
    for(let i=0;i<30;i++) {
      const x=rng.uniform(-15,15),y=rng.uniform(-15,15);
      if(Math.abs(x)<3 || Math.hypot(x,y)<4) continue;
      const radius=rng.uniform(.3,.7),height=rng.uniform(5,9);
      obstacles.push({kind:'cylinder',position:[x,y,height/2],size:[radius,height],color:'#667354'});
    }
  } else if(kind==='amsterdam') {
    // A fictional compact canal block, in metres. Alleys are 1.2 m wide:
    // traversable by the person, below the city aircraft planner's 2.8 m clearance.
    for(const side of [-1,1]) {
      for(const [y,length] of [[-12.6,2.8],[0,17.6],[12.6,2.8]])
        item(side<0?'West canal':'East canal','canal',[side*12.15,y,-.18],[3.7,length,.3],'#497f88',{groundOnly:true,solid:false,cover:false});
      for(const [j,[y,depth]] of [[-7.5,5],[-1.3,5],[4.95,5.1],[11.4,3.6]].entries()) {
        const height=[6.2,7.4,8.2,6.7][j]+(side>0?.35:0);
        item(`${side<0?'West':'East'} canal house ${j+1}`,'building',[side*6.1,y,height/2],[5.8,depth,height],['#a98d69','#c4b79f','#787b70','#8f6655'][j],{cover:true,facade:true});
      }
      for(const y of [-10,10])item('Canal footbridge','bridge',[side*12.15,y,.025],[3.7,2.4,.05],'#bcb7a4',{walkable:true,cover:false});
      for(const y of [-11.5,8.7])obstacles.push({kind:'cylinder',semantic:'tree',label:'Quayside elm',position:[side*8.1,y,2.9],size:[.28,5.8],color:'#667354',cover:true});
    }
    // Six 20 cm steps lead to a real 1.2 m terrace, not a decorative staircase.
    for(let i=0;i<6;i++)item(`Stair tread ${i+1}`,'stairs',[-1.85,4.15+i*.32,(i+1)*.2/2],[1.7,.32,(i+1)*.2],'#aaa79a',{walkable:true,cover:false});
    item('Raised canal terrace','terrace',[-1.85,6.75,.6],[1.7,2.4,1.2],'#b6b3a7',{walkable:true,cover:false});
    item('Climbable courtyard crate','crate',[1.9,7.1,.45],[1.1,1.1,.9],'#af9265',{climbable:true,cover:true});
    item('Low jump rail','barrier',[1.75,4.5,.13],[1.4,.2,.26],'#786e5d',{cover:false});
    item('Alley refuge wall','wall',[-9.45,4.6,1.2],[.18,1.8,2.4],'#8f7568',{cover:true});
  } else throw Error('Unknown scene');
  obstacles.forEach((o,i)=>{o.semantic ||= o.kind==='cylinder'?'tree':kind==='warehouse'?'shelf':o.size[0]<3?'crate':'container';o.label ||= `${o.semantic} ${i+1}`;o.cover??=!o.ceiling;});
  return obstacles;
}
