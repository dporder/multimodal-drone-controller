import {add,sub,scale} from './math.js';

// Timed world-space cubic Bezier; C0 is always the measured drone position.
export function evaluateTrajectory(curve,time){
  const [a,b,c,d]=curve.control_points,T=curve.horizon_seconds;
  const t=Math.max(0,Math.min(T,time)),u=t/T,v=1-u;
  return {t,position:a.map((x,k)=>v**3*x+3*v*v*u*b[k]+3*v*u*u*c[k]+u**3*d[k]),
    velocity:a.map((x,k)=>(3*v*v*(b[k]-x)+6*v*u*(c[k]-b[k])+3*u*u*(d[k]-c[k]))/T),
    acceleration:a.map((x,k)=>(6*v*(c[k]-2*b[k]+x)+6*u*(d[k]-2*c[k]+b[k]))/(T*T))};
}

export function curveFromControls(controls,clear,horizon=1){
  const curve={kind:'cubic',horizon_seconds:horizon,control_points:controls.map(p=>[...p])};
  const count=Math.round(horizon/.05),sample=()=>Array.from({length:count+1},(_,j)=>evaluateTrajectory(curve,j*horizon/count));
  const valid=ps=>ps.slice(1).every((p,i)=>clear(ps[i].position,p.position));
  let points=sample();
  if(!valid(points)){curve.kind='straight';curve.control_points=[0,1/3,2/3,1].map(t=>add(controls[0],scale(sub(controls[3],controls[0]),t)));points=sample();}
  if(!valid(points)){curve.kind='hold';curve.control_points=controls.map(()=>[...controls[0]]);points=sample();}
  points.forEach((p,i)=>p.delta_position=sub(points[Math.min(i+1,count)].position,p.position));
  return {...curve,points,target:points.at(-1).position,sample_period_ms:50,frame:'world',representation:'cubic_bezier',validated:valid(points)};
}
