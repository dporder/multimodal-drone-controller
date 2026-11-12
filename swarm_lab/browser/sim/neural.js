import {Random,clamp} from './math.js';

// Small, genuine one-hidden-layer MLPs, trained online by behavioral cloning.
// Each instance owns its weights and RNG; telemetry never trains a network.
export class NeuralNetwork {
  constructor(inputs,outputs,seed,hidden=16){
    Object.assign(this,{inputs,outputs,hidden,samples:0,mae:null});const rng=new Random(seed);
    this.w1=Array.from({length:hidden},()=>Array.from({length:inputs},()=>rng.normal()*.12));this.b1=Array(hidden).fill(0);
    this.w2=Array.from({length:outputs},()=>Array(hidden).fill(0));this.b2=Array(outputs).fill(0);
  }
  forward(input){
    if(input.length!==this.inputs||!input.every(Number.isFinite))throw Error('Invalid neural input');
    const x=input.map(v=>clamp(v,-4,4)),h=this.w1.map((w,i)=>Math.tanh(w.reduce((n,v,j)=>n+v*x[j],this.b1[i])));
    return {x,h,y:this.w2.map((w,i)=>w.reduce((n,v,j)=>n+v*h[j],this.b2[i]))};
  }
  predict(input){return this.forward(input).y;}
  train(input,target){
    if(target.length!==this.outputs||!target.every(Number.isFinite))throw Error('Invalid neural target');
    const {x,h,y}=this.forward(input),error=y.map((v,i)=>clamp(v-target[i],-2,2)),rate=.025;
    const hiddenError=h.map((v,j)=>(1-v*v)*error.reduce((n,e,i)=>n+e*this.w2[i][j],0));
    this.w2.forEach((w,i)=>{w.forEach((_,j)=>w[j]-=rate*error[i]*h[j]);this.b2[i]-=rate*error[i];});
    this.w1.forEach((w,j)=>{w.forEach((_,k)=>w[k]-=rate*hiddenError[j]*x[k]);this.b1[j]-=rate*hiddenError[j];});
    const mae=error.reduce((a,e)=>a+Math.abs(e),0)/error.length;this.mae=this.mae===null?mae:.98*this.mae+.02*mae;this.samples++;
    return y;
  }
  metrics(){return {architecture:`${this.inputs} → ${this.hidden} tanh → ${this.outputs}`,samples:this.samples,mae:this.mae,status:this.samples<100?'warming up':'online imitation',trained_from:'geometric / map controller'};}
  export(){return {...this.metrics(),inputs:this.inputs,outputs:this.outputs,hidden:this.hidden,w1:this.w1.map(r=>[...r]),w2:this.w2.map(r=>[...r]),b1:[...this.b1],b2:[...this.b2]};}
}

export function rotorNetwork(network,input,teacher,train=false){
  const prediction=network.predict(input).map(v=>clamp(v*7,0,7));
  // Gate learned contribution on data and error. Even then retain a narrowly
  // bounded correction so online training cannot replace attitude stabilization.
  const ready=network.samples>=100&&network.mae<.025;
  const applied=teacher.map((v,i)=>clamp(v+(ready?clamp((prediction[i]-v)*.1,-.025,.025):0),0,7));
  if(train)network.train(input,teacher.map(v=>v/7));
  return {prediction,applied,blend:ready?.1:0};
}
export const neuralnetwork_rotor_master=(net,input,teacher,train)=>rotorNetwork(net,input,teacher,train);
export const neuralnetwork_rotor_slave1=(net,input,teacher,train)=>rotorNetwork(net,input,teacher,train);
export const neuralnetwork_rotor_slave2=(net,input,teacher,train)=>rotorNetwork(net,input,teacher,train);
