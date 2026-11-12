// Reproducible behavioral-cloning baseline, not a foundation VLA checkpoint.
import fs from 'node:fs';
import {NeuralNetwork} from '../swarm_lab/browser/sim/neural.js';
import {Random} from '../swarm_lab/browser/sim/math.js';
import {features,teacherVelocity} from '../swarm_lab/browser/single/policy.js';
const net=new NeuralNetwork(8,3,71,32),rng=new Random(918);
function sample(i){const extent=i%3===0?.4:8,error=Array.from({length:3},()=>rng.uniform(-extent,extent)),velocity=Array.from({length:3},()=>rng.uniform(-.8,.8)),precise=i%3===0,speed=precise?.12:rng.uniform(.3,1.4);return {input:features(error,velocity,speed,precise),target:teacherVelocity(error,velocity,speed)};}
for(let i=0;i<45000;i++){const s=sample(i);net.train(s.input,s.target);}
let mae=0;for(let i=0;i<1500;i++){const s=sample(i),p=net.predict(s.input);mae+=p.reduce((n,v,k)=>n+Math.abs(v-s.target[k]),0)/3;}
const result={...net.export(),validation_mae:mae/1500,training:'45,000 seeded synthetic flight examples; held-out error is velocity MAE in m/s',version:1,parameters:387};
fs.writeFileSync(new URL('../swarm_lab/browser/single/flight-policy.json',import.meta.url),JSON.stringify(result));
console.log(JSON.stringify({parameters:387,samples:45000,held_out_velocity_mae:result.validation_mae}));
