import {vector,distance,sub} from './math.js';
import {evaluateTrajectory} from './trajectory.js';

// Validate the entire reply before any actor, motor, model or world mutation.
export function validateControlReply(reply,simulation){
  const finiteTree=value=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('Non-finite control response');if(value&&typeof value==='object')for(const v of Object.values(value))finiteTree(v);};finiteTree(reply);
  const triplets=(values,name,n=3)=>{if(!Array.isArray(values)||values.length!==3)throw Error(`Invalid ${name}`);values.forEach(v=>vector(v,n));};
  if(reply.controller!=='python'||reply.protocol_version!==2)throw Error('Unsupported control protocol');
  if(reply.control_revision!==simulation.controlRevision)throw Error('Superseded control revision');
  if(!Number.isFinite(reply.valid_until)||Math.abs(reply.valid_until-(simulation.time+.05))>1e-7)throw Error('Invalid control validity window');
  triplets(reply.rotor_commands,'rotors',4);if(reply.rotor_commands.flat().some(x=>x<0||x>7))throw Error('Rotor command outside limits');
  triplets(reply.goals,'goals');triplets(reply.accelerations,'accelerations');
  if(reply.accelerations.flat().some(x=>Math.abs(x)>4.001))throw Error('Acceleration outside limits');
  if(!reply.tactics||typeof reply.tactics.reason!=='string'||!Array.isArray(reply.tactics.orders)||reply.tactics.orders.length!==3||reply.tactics.orders.some((o,i)=>o.drone!==i||typeof o.role!=='string'))throw Error('Invalid three-drone orders');
  if(!Array.isArray(reply.exit_route))throw Error('Invalid exit route');reply.exit_route.forEach(p=>vector(p,2));
  const curves=reply.trajectories;if(!Array.isArray(curves)||curves.length!==3)throw Error('Expected three trajectories');
  curves.forEach((c,i)=>{
    if(c.drone!==i||c.frame!=='world'||c.horizon_seconds!==1||!Number.isFinite(c.generated_at)||Math.abs(c.generated_at-simulation.time)>1e-7)throw Error('Invalid trajectory identity/frame/time');
    if(!Array.isArray(c.control_points)||c.control_points.length!==4)throw Error('Invalid cubic controls');c.control_points.forEach(p=>vector(p));
    if(distance(c.control_points[0],simulation.positions()[i])>1e-6)throw Error('Trajectory starts at the wrong measured position');
    if(!Array.isArray(c.points)||c.points.length!==21)throw Error('Invalid trajectory sample count');
    c.points.forEach((p,j)=>{if(!Number.isFinite(p.t)||Math.abs(p.t-j*.05)>1e-7)throw Error('Invalid sample time');const actual=evaluateTrajectory(c,p.t);for(const k of ['position','velocity','acceleration']){vector(p[k]);if(distance(actual[k],p[k])>1e-6)throw Error('Inconsistent spline sample');}
      if(distance(vector(p.delta_position),sub(c.points[Math.min(j+1,20)].position,p.position))>1e-6)throw Error('Invalid next-step displacement');});
    if(distance(vector(c.target),c.points[20].position)>1e-6)throw Error('Invalid trajectory endpoint');
  });
  const m=reply.modules;if(!m||!Array.isArray(m.drones)||m.drones.length!==3||!m.tactics_network||m.rotor_networks?.length!==3)throw Error('Invalid module telemetry');
  m.drones.forEach((d,i)=>{if(d.id!==i||!d.trajectory||d.trajectory.drone!==i||JSON.stringify(d.trajectory.control_points)!==JSON.stringify(curves[i].control_points))throw Error('Inconsistent module trajectory');vector(d.rotors,4);vector(d.command,4);});
  if(!m.master_frame||distance(vector(m.master_frame.world_origin),simulation.referenceOrigin)>1e-8)throw Error('Reference origin changed');
  const frame=m.master_frame;
  if(frame.name!=='mission_origin'||frame.origin_at!=='episode_start'||JSON.stringify(frame.axes)!=='[[1,0,0],[0,1,0],[0,0,1]]'||frame.trajectories?.length!==3)throw Error('Invalid fixed mission frame');
  frame.trajectories.forEach((c,i)=>{
    if(c.drone!==i||c.frame!=='mission_origin'||c.control_points?.length!==4||c.points?.length!==21)throw Error('Invalid framed trajectory');
    c.control_points.forEach((p,j)=>{if(distance(vector(p),sub(curves[i].control_points[j],simulation.referenceOrigin))>1e-6)throw Error('Inconsistent frame transform');});
    c.points.forEach((p,j)=>{if(distance(vector(p.position),sub(curves[i].points[j].position,simulation.referenceOrigin))>1e-6)throw Error('Inconsistent framed sample');});
  });
  if(reply.inner_loop?.kind!=='onboard_attitude'||reply.inner_loop.rate_hz!==240)throw Error('Invalid inner-loop configuration');
  triplets(reply.inner_loop.rotor_residuals,'rotor residuals',4);if(reply.inner_loop.rotor_residuals.flat().some(v=>Math.abs(v)>.0250001))throw Error('Unbounded learned residual');
}
