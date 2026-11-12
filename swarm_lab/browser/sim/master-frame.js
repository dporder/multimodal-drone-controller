import {sub} from './math.js';

export const TRAJECTORY_COLORS=['#5dd6bf','#e6b36c','#90b1e2'];

// One immutable origin for the whole episode; never follow the moving master.
export function masterReferenceFrame(trajectories,worldOrigin){
  if(trajectories.length!==3||trajectories.some((t,i)=>t.drone!==i))throw Error('Expected master and two slave plans');
  if(!Array.isArray(worldOrigin)||worldOrigin.length!==3||!worldOrigin.every(Number.isFinite))throw Error('Fixed episode origin required');
  const origin=[...worldOrigin];
  return {name:'mission_origin',origin_at:'episode_start',world_origin:origin,
    axes:[[1,0,0],[0,1,0],[0,0,1]],axis_alignment:'world',units:'metres',
    generated_at:trajectories[0].generated_at,horizon_seconds:1,master_position:sub(trajectories[0].control_points[0],origin),
    trajectories:trajectories.map(t=>({...t,frame:'mission_origin',
      control_points:t.control_points.map(p=>sub(p,origin)),target:sub(t.target,origin),
      points:t.points.map(p=>({...p,position:sub(p.position,origin)}))}))};
}
