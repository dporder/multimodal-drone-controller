export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const add = (a,b) => a.map((x,i)=>x+b[i]);
export const sub = (a,b) => a.map((x,i)=>x-b[i]);
export const scale = (a,s) => a.map(x=>x*s);
export const norm = a => Math.hypot(...a);
export const unit = a => scale(a,1/Math.max(norm(a),1e-9));
export const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const distance = (a,b) => norm(sub(a,b));
export function vector(value, length=3) {
  if (!Array.isArray(value) || value.length!==length || !value.every(Number.isFinite)) throw Error(`Expected ${length} finite coordinates`);
  return [...value];
}
// All simulation randomness is episode-local. Rendering never consumes this stream.
export class Random {
  constructor(seed=7) { this.state=seed>>>0; }
  random() { let t=this.state+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); this.state>>>=0; return ((t^t>>>14)>>>0)/4294967296; }
  uniform(a,b) { return a+(b-a)*this.random(); }
  normal() { return Math.sqrt(-2*Math.log(Math.max(1e-12,this.random())))*Math.cos(2*Math.PI*this.random()); }
}
