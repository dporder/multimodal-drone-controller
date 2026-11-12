import {Random,clamp,norm} from './math.js';

// Five bootstrapped ridge regressors on top of a Newtonian prior. Model learning
// has a separate seeded stream so inspecting predictions cannot change physics.
export class WorldModel {
  constructor(seed,dt=1/30) {this.dt=dt;this.rng=new Random(seed^0x9e3779b9);this.samples=[];this.seen=0;this.weights=null;this.errors=[];this.priorErrors=[];this.scale=[4,4,4,1,1,1,3,3,3,4,4,4,4,1,1,1];}
  prior(s) {const out=[...s],thrust=s.slice(9,13).reduce((a,b)=>a+b,0);for(let i=0;i<3;i++)out[i]+=this.dt*(s[3+i]*thrust/1.2-(i===2?9.81:0));return out;}
  features(s,a) {return [...s,...a].map((v,i)=>v/this.scale[i]).concat(1);}
  predict(s,a) {
    const prior=this.prior(s);if(!this.weights)return {mean:prior,std:Array(13).fill(0)};
    const x=this.features(s,a),preds=this.weights.map(w=>prior.map((v,k)=>v+x.reduce((sum,f,j)=>sum+f*w[j][k],0)));
    const mean=prior.map((_,k)=>preds.reduce((sum,p)=>sum+p[k],0)/5),std=mean.map((m,k)=>Math.sqrt(preds.reduce((sum,p)=>sum+(p[k]-m)**2,0)/5));return {mean,std};
  }
  update(states,actions,next) {
    states.forEach((s,i)=>{const p=this.predict(s,actions[i]).mean,prior=this.prior(s);if(this.weights){this.errors.push(p.slice(0,3).reduce((a,v,k)=>a+(v-next[i][k])**2,0)/3);this.priorErrors.push(prior.slice(0,3).reduce((a,v,k)=>a+(v-next[i][k])**2,0)/3);}this.samples.push({x:this.features(s,actions[i]),y:next[i].map((v,k)=>v-prior[k])});});
    this.seen+=states.length;if(this.samples.length>6000)this.samples.splice(0,this.samples.length-6000);if(this.errors.length>600){this.errors.splice(0,this.errors.length-600);this.priorErrors.splice(0,this.priorErrors.length-600);}
    if(this.samples.length>=240&&this.seen%120<states.length)this.fit();
  }
  fit() {
    this.weights=Array.from({length:5},()=>{
      const a=Array.from({length:17},(_,i)=>Float64Array.from({length:30},(_,j)=>i===j?.04:0));
      // Bootstrap sufficient statistics; solve all thirteen outputs together.
      for(let n=0;n<this.samples.length;n++){const {x,y}=this.samples[Math.floor(this.rng.random()*this.samples.length)];for(let i=0;i<17;i++){for(let j=0;j<17;j++)a[i][j]+=x[i]*x[j];for(let k=0;k<13;k++)a[i][17+k]+=x[i]*y[k];}}
      for(let i=0;i<17;i++){let pivot=i;for(let j=i+1;j<17;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;[a[i],a[pivot]]=[a[pivot],a[i]];const d=a[i][i];for(let k=i;k<30;k++)a[i][k]/=d;for(let j=0;j<17;j++)if(j!==i){const f=a[j][i];for(let k=i;k<30;k++)a[j][k]-=f*a[i][k];}}
      return a.map(row=>Array.from(row.slice(17)));
    });
  }
  rollout(positions,states,actions) {
    if(!this.weights)return {predictions:[],uncertainty:[]};
    let p=positions.map(x=>[...x]),s=states.map(x=>[...x]);const predictions=[p],uncertainty=[];
    for(let step=0;step<15;step++){
      const pred=s.map((x,i)=>this.predict(x,actions[i]));const next=pred.map(({mean})=>{for(let k=0;k<3;k++)mean[k]=clamp(mean[k],-15,15);const n=Math.max(norm(mean.slice(3,6)),1e-6);for(let k=3;k<6;k++)mean[k]/=n;for(let k=6;k<9;k++)mean[k]=clamp(mean[k],-20,20);for(let k=9;k<13;k++)mean[k]=clamp(mean[k],0,8);return mean;});
      p=p.map((q,i)=>q.map((v,k)=>v+.5*(s[i][k]+next[i][k])*this.dt));s=next;predictions.push(p);uncertainty.push(pred.map(x=>norm(x.std.slice(0,3))));
    }return {predictions,uncertainty};
  }
  metrics() {const rmse=a=>a.length?Math.sqrt(a.reduce((s,x)=>s+x,0)/a.length):null;return {samples:this.seen,ready:!!this.weights,velocity_rmse:rmse(this.errors),prior_velocity_rmse:rmse(this.priorErrors),members:5,horizon_seconds:.5};}
}
