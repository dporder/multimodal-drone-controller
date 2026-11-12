const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1700,height:1100},acceptDownloads:true}),page=await context.newPage(),errors=[],packets=[],responses=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith(':8767/control')){const p=r.postDataJSON();if(packets.length<4)packets.push(p);}});
  page.on('response',async r=>{if(r.url().endsWith(':8767/control'))responses.push(await r.json().catch(()=>({error:'invalid JSON'})));});
  // Inspect the displayed frame synchronously when it is posted to the worker;
  // sensor mapping now runs before fetch, so a later network interception may
  // already be looking at a newer rendered image.
  await page.addInitScript(()=>{
    const original=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){
      if(message.type==='camera_frame'&&message.packet.time>.1&&!window.rawFrameCheck){const p=message.packet;
        window.rawFrameCheck=[...document.querySelectorAll('.onboard-frame')].map((c,i)=>{
          const raw=atob(p.frames[i].data),display=c.getContext('2d').getImageData(0,0,256,144).data;let same=0,different=0;
          for(let y=0;y<72;y++)for(let x=0;x<128;x++){const a=(y*128+x)*3,b=(y*2*256+x*2)*4;if([0,1,2].every(k=>raw.charCodeAt(a+k)===display[b+k]))same++;else different++;}
          return {same,different,time:JSON.parse(c.dataset.pose).time,packetTime:p.time};
        });
      }
      return original.call(this,message,...args);
    };
  });
  const targetUrl=process.env.SWARM_URL||'http://127.0.0.1:8766/browser/?scene=amsterdam&controller=python';
  await page.goto(targetUrl);
  await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Python controller · JS physics',{},{timeout:30000});
  const snapshot=async()=>{const promise=page.waitForEvent('download');await page.locator('#export').click();return JSON.parse(await fs.readFile(await (await promise).path(),'utf8'));};
  await page.waitForFunction(()=>Number(document.querySelector('#drone-dashboard').dataset.simTime)>=8,{},{timeout:90000});
  const state=await snapshot();
  assert.equal(state.controller,'python');assert.equal(state.reason,'flying');assert.equal(state.drones.length,3);
  assert.equal(await page.locator('#planning-map').inputValue(),state.config.map_source);
  assert.equal(await page.locator('#sensor-profile').inputValue(),state.config.sensor_profile);
  assert.equal(state.diagnostics.inner_loop_hz,240);assert.ok(state.diagnostics.accepted>100);assert.equal(state.diagnostics.rejected,0);
  assert.ok(state.drones.every(d=>d.angular_velocity_frame==='body'));
  assert.equal(state.drone_modules.rotor_networks.length,3);assert.ok(state.drone_modules.tactics_network.samples>=100);
  assert.equal(await page.locator('.onboard-frame').count(),3);assert.equal(await page.locator('.four-rotors>div').count(),12);
  const images=await page.locator('.onboard-frame').evaluateAll(cs=>cs.map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0,lo=255,hi=0;for(let i=0;i<d.length;i+=4){sum+=d[i]+d[i+1]+d[i+2];lo=Math.min(lo,d[i]);hi=Math.max(hi,d[i]);}return {sum,range:hi-lo,pose:JSON.parse(c.dataset.pose),frame:Number(c.dataset.frame)};}));
  assert.ok(images.every(i=>i.range>40&&i.frame>20));assert.equal(new Set(images.map(i=>i.sum)).size,3);
  assert.ok(packets.length>=3);for(const p of packets){assert.equal(p.frames.length,3);assert.ok(p.frames.every(f=>f.encoding==='rgb8-base64'&&f.pose.time===p.time));assert.equal(p.relative_coordinates.length,2);assert.equal('position' in p.intruder,false);}
  assert.ok(responses.every(r=>!r.error));assert.ok(responses.at(-1).rotor_commands.flat().every(v=>Number.isFinite(v)&&v>=0&&v<=7));
  for(const r of responses){assert.equal(r.protocol_version,2);assert.equal(r.inner_loop.rate_hz,240);assert.ok(r.inner_loop.rotor_residuals.flat().every(v=>Math.abs(v)<=.0250001));assert.ok(r.trajectories.every(t=>t.validation.continuous_velocity));}
  if(state.config.map_source==='observed')assert.ok(packets.every(p=>p.environment.obstacles.length===0),'Observed-only planner must not receive truth obstacles');
  assert.equal(state.drone_modules.tactics_network.architecture,'69 → 24 tanh → 27');
  assert.ok(state.drone_modules.drones.every(d=>d.trajectory.points.length===21&&d.trajectory.control_points.length===4&&d.tracking_reference.t===.25));
  const rawFrameCheck=await page.evaluate(()=>window.rawFrameCheck);
  assert.ok(rawFrameCheck.every(f=>f.time===f.packetTime&&f.same===9216&&f.different===0),'Camera images must exactly match raw controller RGB, with no path overlays');
  const plot=page.locator('#trajectory-canvas');await plot.scrollIntoViewIfNeeded();
  const frame=JSON.parse(await plot.getAttribute('data-frame'));
  assert.equal(frame.trajectories.length,3);assert.deepEqual(frame.world_origin,state.reference_origin);assert.equal(frame.name,'mission_origin');assert.equal(frame.origin_at,'episode_start');assert.ok(Math.hypot(...frame.master_position)>.5);
  assert.deepEqual(frame.trajectories[0].control_points[0],frame.master_position);assert.ok(frame.map.objects.length>0&&frame.map.point_count>100);assert.ok(frame.map.objects.some(o=>o.seen_by.length>1));assert.equal(frame.axis_alignment,'world');
  assert.ok(frame.trajectories.every(t=>t.points.length===21&&t.points.at(-1).t===1));
  await page.locator('[data-plot-expand]').click();assert.ok((await plot.boundingBox()).width>700);
  const viewBefore=await plot.getAttribute('data-view'),box=await plot.boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:8});await page.mouse.up();
  assert.notEqual(await plot.getAttribute('data-view'),viewBefore);await page.locator('[data-plot-reset]').click();assert.equal(await plot.getAttribute('data-view'),viewBefore);
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/fixed-origin-world-map.png'});
  await page.locator('.map-evidence summary').click();await page.locator('.map-keyframe-select').selectOption({index:1});assert.ok(await page.locator('.map-keyframe-detail img').isVisible());assert.match(await page.locator('.map-keyframe-detail p').textContent(),/XYZ/);await page.locator('.map-evidence summary').click();
  await page.locator('[data-plot-expand]').click();
  await page.locator('#play').click();await page.waitForTimeout(250);
  const exported=page.waitForEvent('download');await page.locator('#camera-export').click();
  const framePacket=JSON.parse(await fs.readFile(await (await exported).path(),'utf8'));
  assert.equal(framePacket.version,4);assert.equal(framePacket.image_annotations,'none');assert.deepEqual(framePacket.master_frame.world_origin,frame.world_origin);assert.ok(framePacket.camera_keyframes.length>=9);assert.ok(framePacket.camera_keyframes.every(k=>k.pose.frame==='mission_origin'&&k.image.startsWith('data:image/jpeg')));
  assert.ok(framePacket.frames.every(f=>!('overlay' in f)&&f.image.startsWith('data:image/png')));
  await page.locator('#play').click();
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/python-three-drone-dashboard.png'});
  if(process.argv.includes('--map-only')){
    assert.deepEqual(errors,[]);assert.ok(responses.at(-1).modules.observed_map.objects.length>0);
    assert.ok(responses.at(-1).modules.observed_map.objects.every(o=>!('points' in o)),'Controller receives fused landmark summaries, not duplicate surface clouds');
    console.log(JSON.stringify({result:'PASS',frame:frame.name,origin:frame.world_origin,objects:frame.map.objects.length,points:frame.map.point_count,keyframes:framePacket.camera_keyframes.length,raw_camera_pixels:'exact match',orbit:true,export:true}));return;
  }
  await page.locator('#focus-scene').click();await page.locator('#response').selectOption('1');await page.locator('#focus-scene').click();
  await page.locator('[data-camera="top"]').click();await page.waitForTimeout(1000);await page.locator('#path-pace').selectOption('run');
  const canvas=await page.locator('#viewport canvas').boundingBox(),x=canvas.x+canvas.width/2;
  await page.mouse.move(x,canvas.y+canvas.height*.65);await page.mouse.down();await page.mouse.move(x,canvas.y+canvas.height*.53,{steps:10});await page.mouse.up();
  await page.keyboard.press('h');await page.waitForTimeout(200);const hidden=await snapshot();assert.equal(hidden.person.intention,'seek cover');assert.ok(hidden.person.hide_target);
  await page.waitForFunction(()=>document.querySelector('#person-status').textContent==='at bridge',{},{timeout:120000});
  const arrived=await snapshot();assert.deepEqual(arrived.reference_origin,frame.world_origin);assert.ok(arrived.observed_map.point_count>frame.map.point_count);assert.equal(arrived.reason,'flying');assert.equal(arrived.metrics.collisions,0);assert.ok(arrived.tactics.events.some(e=>e.state==='escort'));
  await page.screenshot({path:'test-results/python-bridge-arrival.png'});
  // A lost controller pauses the browser's physical world, with no native fallback.
  await page.route('http://127.0.0.1:8767/control',route=>route.abort());await page.waitForTimeout(1200);
  const stopped=await snapshot();await page.waitForTimeout(500);const still=await snapshot();assert.equal(still.time,stopped.time);
  assert.match(await page.locator('#backend-status').textContent(),/physics paused/);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',bridge_arrival:arrived.time,time:state.time,packets:responses.length,cameras:images.map(x=>({variance:x.range,frame:x.frame})),master_frame:frame.name,paths:frame.trajectories.length,map_objects:arrived.observed_map.objects.length,map_points:arrived.observed_map.point_count,raw_camera_pixels:'exact match',trajectory_samples:21,rotors:12,python_ms:state.external_control.processing_ms,round_trip_ms:state.external_control.round_trip_ms,control_interval_ms:state.external_control.loop_interval_ms,frame_ms:await page.locator('#drone-dashboard').getAttribute('data-interval-ms')}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
