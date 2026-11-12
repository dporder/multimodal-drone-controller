import {clamp,distance} from './math.js';

export class Navigator {
  constructor(obstacles,radius=.42,z=.9,halfHeight=radius,grounded=false) {
    Object.assign(this,{obstacles,radius,z,halfHeight,grounded});
    this.width=57;this.spacing=.5;this.low=-14;
  }
  clear(p) {
    if(p.slice(0,2).some(x=>!Number.isFinite(x)||Math.abs(x)>14)) return false;
    const zHere=this.grounded?this.surfaceHeight(p)+this.halfHeight:this.z;
    for(const o of this.obstacles) {
      if(o.groundOnly&&!this.grounded)continue;
      if(this.grounded&&o.walkable)continue;
      const [x,y,z]=o.position,s=o.size,h=o.kind==='box'?s[2]:s[1];
      // Full actor/aircraft vertical envelope, not just a point at torso height.
      if(!o.groundOnly&&(zHere+this.halfHeight<=z-h/2+.015 || zHere-this.halfHeight>=z+h/2-.015)) continue;
      if(o.kind==='box') { if(Math.hypot(Math.max(0,Math.abs(p[0]-x)-s[0]/2),Math.max(0,Math.abs(p[1]-y)-s[1]/2))<this.radius) return false; }
      else if(Math.hypot(p[0]-x,p[1]-y)<s[0]+this.radius) return false;
    }
    return true;
  }
  segmentClear(a,b) {
    const n=Math.max(2,Math.ceil(distance(a.slice(0,2),b.slice(0,2))/.1));
    let prior=this.surfaceHeight(a);
    for(let i=0;i<=n;i++) {
      const p=[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n];
      if(!this.clear(p))return false;
      const h=this.surfaceHeight(p);if(this.grounded&&Math.abs(h-prior)>.26)return false;prior=h;
    }
    return true;
  }
  surfaceHeight(p) {
    let h=0;
    for(const o of this.obstacles)if(o.walkable&&o.kind==='box'&&[0,1].every(i=>Math.abs(p[i]-o.position[i])<=o.size[i]/2+.001))h=Math.max(h,o.position[2]+o.size[2]/2);
    return h;
  }
  cell(p) { return p.slice(0,2).map(v=>clamp(Math.round((v+14)*2),0,56)); }
  point(id) { return [(id%57)*.5-14,Math.floor(id/57)*.5-14]; }
  nearestClear(p) {
    p=p.slice(0,2);if(this.clear(p)) return p;
    let best=null,d=Infinity;
    for(let i=0;i<3249;i++){const q=this.point(i),r=distance(p,q);if(r<d&&this.clear(q)){best=q;d=r;}}
    if(!best) throw Error('No free space');return best;
  }
  path(start,goal) {
    start=start.slice(0,2);goal=goal.slice(0,2);
    if(!this.clear(start)||!this.clear(goal)) return [];
    if(this.segmentClear(start,goal)) return [goal];
    const nearestCell=p=>{const c=this.cell(p);let best=null,d=Infinity;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const x=c[0]+dx,y=c[1]+dy;if(x<0||y<0||x>56||y>56)continue;const id=x+y*57,q=this.point(id),r=distance(p,q);if(r<d&&this.segmentClear(p,q)){best=id;d=r;}}return best;};
    const a=nearestCell(start),b=nearestCell(goal);if(a===null||b===null)return [];
    const cost=new Float64Array(3249).fill(Infinity),came=new Int32Array(3249).fill(-1),closed=new Uint8Array(3249),occupied=new Uint8Array(3249);
    for(let i=0;i<3249;i++)occupied[i]=!this.clear(this.point(i));
    const queue=[[a,0]];cost[a]=0;
    while(queue.length) {
      let best=0;for(let j=1;j<queue.length;j++)if(queue[j][1]<queue[best][1])best=j;
      const [cur]=queue.splice(best,1)[0];if(closed[cur])continue;closed[cur]=1;
      if(cur===b){const points=[goal];let c=b;while(c!==-1){points.push(this.point(c));c=came[c];}points.push(start);points.reverse();const smooth=[];let i=0;while(i<points.length-1){let j=points.length-1;while(j>i+1&&!this.segmentClear(points[i],points[j]))j--;if(!this.segmentClear(points[i],points[j]))return [];smooth.push(points[j]);i=j;}return smooth;}
      const x=cur%57,y=Math.floor(cur/57);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        if(x+dx<0||x+dx>56||y+dy<0||y+dy>56)continue;
        const n=cur+dx+dy*57;if(closed[n]||occupied[n]||(dx&&dy&&(occupied[cur+dx]||occupied[cur+dy*57])))continue;
        if(this.grounded&&!this.segmentClear(this.point(cur),this.point(n)))continue;
        const g=cost[cur]+Math.hypot(dx,dy);if(g<cost[n]){cost[n]=g;came[n]=cur;queue.push([n,g+distance(this.point(n),this.point(b))*2]);}
      }
    }
    return [];
  }
}
