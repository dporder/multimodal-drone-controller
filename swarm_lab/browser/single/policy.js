import {NeuralNetwork} from '../sim/neural.js';
import {clamp,norm,scale,sub} from '../sim/math.js';
export function teacherVelocity(error,velocity,speed){const length=norm(error),desired=scale(error,Math.min(speed,.85*length)/Math.max(length,1e-9));return desired.map((v,i)=>v-.08*velocity[i]);}
export function features(error,velocity,speed,precise=false){return [...error.map(v=>clamp(v/5,-2,2)),...velocity.map(v=>v/3),speed/2,precise?1:0];}
export class FlightPolicy {
 constructor(weights){this.net=new NeuralNetwork(8,3,71,32);if(!weights||weights.inputs!==8||weights.outputs!==3||weights.hidden!==32)throw Error('Flight policy weights missing or incompatible');for(const k of ['w1','w2','b1','b2'])this.net[k]=structuredClone(weights[k]);this.net.samples=weights.samples;this.validation_mae=weights.validation_mae;this.calls=0;}
 predict(error,velocity,speed,precise=false){
  const f=features(error,velocity,speed,precise),negative=features(scale(error,-1),scale(velocity,-1),speed,precise);
  // Symmetry removes a learned zero-error bias while preserving network inference.
  let action=scale(sub(this.net.predict(f),this.net.predict(negative)),.5);this.calls++;
  if(precise){const max=Math.min(speed,norm(error)*.65);if(norm(action)>max)action=scale(action,max/norm(action));}
  if(norm(action)>speed)action=scale(action,speed/norm(action));return action;
 }
}
// Flight-native VLA contract: camera RGB + instruction + state -> body velocity.
// Policies trained for grippers/joints must be adapted; their action indices are
// never interpreted as quadcopter motor thrusts.
export function validateAction(reply,request,time){
 if(reply.version!==1||reply.episode!==request.episode||reply.mission!==request.mission||reply.sequence!==request.sequence)throw Error('Stale or mismatched VLA response');
 if(reply.frame!=='body_flu'||!Array.isArray(reply.velocity_mps)||reply.velocity_mps.length!==3||!reply.velocity_mps.every(Number.isFinite)||norm(reply.velocity_mps)>1.50001)throw Error('VLA velocity must be body FLU, finite, and at most 1.5 m/s');
 if(!Number.isFinite(reply.yaw_rate_rps)||Math.abs(reply.yaw_rate_rps)>1||!Number.isFinite(reply.duration_s)||reply.duration_s<=0||reply.duration_s>.5)throw Error('Invalid VLA yaw rate or action duration');
 if(time-request.simulation_time>.75)throw Error('VLA response expired');return structuredClone(reply);
}
