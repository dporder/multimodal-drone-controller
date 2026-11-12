import {add,sub,scale,norm,cross,unit} from './math.js';

function rotate(v,q){const [w,...xyz]=q,t=scale(cross(xyz,v),2);return add(v,add(scale(t,w),cross(xyz,t)));}
export function cameraPose(snapshot,id){
  const d=snapshot.drones[id],trajectory=snapshot.drone_modules?.drones[id]?.trajectory;
  const seen=snapshot.perception?.last_seen,age=seen?Math.max(0,snapshot.time-seen.time):Infinity;
  const aim=seen?add(seen.position,add(scale(seen.velocity||[0,0,0],Math.min(age,2)),[0,0,(seen.height||1.8)*.6])):null;
  const delta=aim?sub(aim,d.position):sub(trajectory?.target||d.goal,d.position);
  const heading=aim?Math.atan2(delta[1],delta[0])+(age>2?.55*Math.sin(snapshot.time*.9+id*2):0):-Math.PI/2+snapshot.time*.4+(id-1)*.5;
  // Point only at communicated last sightings; otherwise sweep the area.
  // This is an ideal gimbal, not privileged aiming at current hidden truth.
  const pitch=aim?Math.max(-80*Math.PI/180,Math.min(10*Math.PI/180,Math.atan2(delta[2],Math.max(.1,norm(delta.slice(0,2)))))):-25*Math.PI/180,direction=[Math.cos(heading)*Math.cos(pitch),Math.sin(heading)*Math.cos(pitch),Math.sin(pitch)];
  const position=add(d.position,rotate([.22,0,-.09],d.quaternion));
  return {frame:'world',drone:id,position,direction:unit(direction),up:[0,0,1],fov:80,width:256,height:144,time:snapshot.time,gimbal_yaw:heading,gimbal_pitch:pitch,source:'onboard gimbal / current rigid-body pose'};
}
export const camera_master=(snapshot,capture)=>capture(cameraPose(snapshot,0));
export const camera_slave1=(snapshot,capture)=>capture(cameraPose(snapshot,1));
export const camera_slave2=(snapshot,capture)=>capture(cameraPose(snapshot,2));
