// Manufacturer limits are separate from illustrative simulation parameters.
export const AIRFRAMES={
 compact:{name:'Compact 500-class · generic',dry_kg:1.2,battery_kg:.55,battery_wh:88.8,payload_kg:.8,arm:.18,rotor_radius:.10,max_rotor_n:12,inertia:[.045,.045,.075]},
 x650:{name:'Holybro X650 class',dry_kg:2,battery_kg:1.2,battery_wh:222,payload_kg:3.1,arm:.23,rotor_radius:.115,max_rotor_n:24,inertia:[.095,.095,.16]}
};
export const COMPUTE={
 nx16:{name:'Orin NX · 16 GB',memory_gb:16,power_w:25,installed_kg:.45,note:'Carrier + cooling mass is an assumption; module supports 10–40 W.'},
 agx64:{name:'AGX Orin · 64 GB',memory_gb:64,power_w:60,installed_kg:1.2,note:'Installed mass is an assumption; module supports 15–60 W.'},
 thor128:{name:'Jetson Thor · 128 GB',memory_gb:128,power_w:130,installed_kg:2,note:'Installed mass is an assumption; module supports 40–130 W.'}
};
export const MODELS={smol:{name:'SmolVLA · 450M',parameters_b:.45},openvla:{name:'OpenVLA · 7B',parameters_b:7},aerial:{name:'Flight NN · local demo',parameters_b:387/1e9}};
export function hardwareBudget(config){
 const air=AIRFRAMES[config.airframe],compute=COMPUTE[config.compute],model=MODELS[config.model],camera=.12,probe=.10;
 if(!air||!compute||!model)throw Error('Unknown hardware profile');
 const payload=compute.installed_kg+camera+probe,weight=model.parameters_b*(config.precision==='int4'?.5:2),estimate=weight*1.6+3;
 const mass=air.dry_kg+air.battery_kg+payload;
 return {mass_kg:mass,payload_kg:payload,payload_limit_kg:air.payload_kg,payload_ok:payload<=air.payload_kg,weight_floor_gb:weight,runtime_estimate_gb:estimate,memory_ok:estimate<=compute.memory_gb,memory_gb:compute.memory_gb,compute_w:compute.power_w,thrust_weight:4*air.max_rotor_n/(mass*9.81),installed_compute_kg:compute.installed_kg};
}
export const DEFAULTS={airframe:'x650',compute:'nx16',model:'smol',precision:'fp16',mount:'front',camera_pitch:-8,camera_yaw:0,fov:78,wind:0.6,inference_ms:150,seed:7};
export const TARGETS=[
 {id:'orange-panel',name:'Orange inspection panel',color:0xe98d44,color_word:'orange',position:[4,-1.5,1.65],size:[1.2,.35,1.3]},
 {id:'blue-box',name:'Blue equipment box',color:0x4c8bb8,color_word:'blue',position:[-5,3.8,1.6],size:[1.25,.8,1.2]},
 {id:'green-panel',name:'Green service panel',color:0x5f9867,color_word:'green',position:[5,5,1.7],size:[1.1,.4,1.4]},
 {id:'red-box',name:'Red test box',color:0xc75a52,color_word:'red',position:[-5,-1,1.5],size:[1.15,.8,1.1]}
];
export const OBSTACLES=[
 {id:'divider',name:'Test-bay partition',position:[0,1.3,1.7],size:[2.6,1,3.4],color:0x81918d},
 {id:'crate',name:'Storage crate',position:[2.2,4.7,.55],size:[1.3,1.2,1.1],color:0xad9b78},
 {id:'shelf',name:'Equipment cabinet',position:[-8,4,1.6],size:[1,2.4,3.2],color:0x657a76}
];
export function parseInstruction(text,selected=null){
 const input=text.trim().toLowerCase();if(!input)throw Error('Describe a task or choose a target.');
 const actions=[['touch',/\b(touch|contact|tap)\b/],['inspect',/\b(inspect|examine|observe|spotlight)\b/],['find',/\b(find|locate|search)\b/]];
 const mode=actions.find(([,pattern])=>pattern.test(input))?.[0];if(!mode)throw Error('Use “find”, “inspect” or “touch”, followed by an object color or select a visual target.');
 const matches=TARGETS.filter(t=>input.includes(t.color_word)||input.includes(t.id));
 if(matches.length>1)throw Error('Choose one object per mission.');
 const target=matches[0]||TARGETS.find(t=>t.id===selected);if(!target)throw Error('Name an object color, or click an object in the scene or camera first.');
 return {mode,target_id:target.id,instruction:text.trim()};
}
