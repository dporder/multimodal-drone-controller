const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 let browser,pythonServer,serverLog='';
 let appUrl=process.env.SWARM_URL||'http://127.0.0.1:8766/browser/single/';
 try{
  if(process.argv.includes('--python')){
   pythonServer=spawn(process.env.PYTHON||'python3',['-S','serve.py','--host','127.0.0.1','--port','0'],{cwd:path.resolve(__dirname,'../..'),stdio:['ignore','pipe','pipe']});
   pythonServer.stderr.on('data',data=>{serverLog=(serverLog+data.toString()).slice(-4000);});
   appUrl=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Python server startup timed out: '+serverLog)),10000);let output='';
    pythonServer.once('error',error=>{clearTimeout(timer);reject(error);});pythonServer.once('exit',code=>{clearTimeout(timer);reject(Error(`Python server exited ${code}: ${serverLog}`));});
    pythonServer.stdout.on('data',data=>{output+=data.toString();const match=output.match(/Swarm Flight Lab: (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
   });
  }
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1860,height:1160},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pythonServer?new URL('/',appUrl).href:appUrl);
  assert.equal(new URL(page.url()).pathname,'/browser/single/');
  await page.waitForFunction(()=>document.body.dataset.drones==='3'&&Number(document.querySelector('#camera-2').dataset.frames)>5,{},{timeout:20000});
  assert.equal(await page.locator('#viewport canvas').count(),1);assert.equal(await page.locator('#reconstruction canvas').count(),1);assert.equal(await page.locator('#coordinates tr').count(),3);
  const layout=await page.evaluate(()=>{const cameras=['camera','camera-1','camera-2'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON());return {cameras,map:document.getElementById('reconstruction').getBoundingClientRect().toJSON(),world:document.getElementById('viewport').getBoundingClientRect().toJSON(),settings:[...document.querySelectorAll('.drawer-grid details')].every(d=>!d.open)};});
  assert.ok(layout.cameras.every(c=>Math.abs(c.y-layout.cameras[0].y)<1));assert.ok(layout.cameras[0].x<layout.cameras[1].x&&layout.cameras[1].x<layout.cameras[2].x&&layout.cameras[2].x<layout.map.x);
  assert.ok(Math.abs(layout.map.y-layout.cameras[0].y)<1&&Math.abs(layout.map.width-layout.cameras[0].width)<1&&Math.abs(layout.map.height-layout.cameras[0].height)<1);
  assert.ok(layout.world.height>=420&&layout.world.width>layout.map.width*3&&layout.world.bottom<layout.cameras[0].y);assert.ok(layout.settings);
  assert.ok(await page.locator('#viewport canvas').isVisible());assert.ok(await page.locator('#reconstruction canvas').isVisible());
  const pixels=await page.evaluate(()=>['camera','camera-1','camera-2'].map(id=>{const c=document.getElementById(id),data=c.getContext('2d').getImageData(0,0,480,270).data;let lo=255,hi=0;for(let i=0;i<data.length;i+=4){lo=Math.min(lo,data[i]);hi=Math.max(hi,data[i]);}return {range:hi-lo,time:c.dataset.time,image:c.toDataURL()};}));
  assert.ok(pixels.every(p=>p.range>50));assert.equal(new Set(pixels.map(p=>p.time)).size,1);assert.equal(new Set(pixels.map(p=>p.image)).size,3);
  await page.locator('[data-target="orange-panel"]').click();await page.locator('#start').click();
  await fs.mkdir('test-results',{recursive:true});await page.waitForTimeout(6000);await page.screenshot({path:'test-results/team-flight-overview.png',fullPage:true});
  await page.locator('#play').click();await page.waitForTimeout(300);
  const withCones=await page.locator('#viewport canvas').screenshot(),raw=await page.locator('#camera').evaluate(c=>c.toDataURL());
  await page.screenshot({path:'test-results/team-flight-vision-cones.png',fullPage:true});await page.locator('#show-cones').uncheck();await page.waitForTimeout(150);
  const withoutCones=await page.locator('#viewport canvas').screenshot();assert.notDeepEqual(withCones,withoutCones);assert.equal(await page.locator('#camera').evaluate(c=>c.toDataURL()),raw);
  await page.locator('#show-cones').check();await page.locator('#play').click();
  assert.ok(Number(await page.locator('#reconstruction').getAttribute('data-points'))>100);assert.ok(Number(await page.locator('body').getAttribute('data-plan'))>=3);
  await page.waitForFunction(()=>['success','fault'].includes(document.body.dataset.state),{},{timeout:100000});assert.equal(await page.locator('body').getAttribute('data-state'),'success');
  await page.locator('#expand-map').click();await page.waitForTimeout(250);await page.screenshot({path:'test-results/team-flight-reconstruction.png',fullPage:true});
  await page.keyboard.press('Escape');
  const download=page.waitForEvent('download');await page.locator('#export').click();const result=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));
  assert.equal(result.kind,'three-drone-flight-dataset');assert.equal(result.state.drones.length,3);assert.equal(result.state.plans.length,3);assert.equal(result.cameras.length,3);assert.ok(result.records.length>30);
  assert.ok(result.records.every(r=>r.drones.length===3&&r.drones.every(a=>a.camera.time===r.time&&a.rotors.length===4&&a.rgb.startsWith('data:image/jpeg'))));
  assert.ok(result.records.some(r=>r.drones.some(a=>a.visible.some(id=>['master','slave1','slave2'].includes(id)))));
  assert.ok(result.state.drones.every(a=>a.telemetry.collisions===0));
  await page.locator('#play').click();await page.waitForTimeout(150);const t=Number(await page.locator('body').getAttribute('data-time'));await page.waitForTimeout(150);assert.equal(Number(await page.locator('body').getAttribute('data-time')),t);await page.locator('#step').click();await page.waitForTimeout(150);assert.ok(Math.abs(Number(await page.locator('body').getAttribute('data-time'))-t-.05)<1e-6);
  await page.locator('#camera-settings summary').click();await page.locator('#auto-aim').uncheck();await page.locator('#active-drone').selectOption('1');await page.locator('#mount').selectOption('underslung');await page.waitForTimeout(150);await page.locator('#camera-settings summary').click();
  await page.locator('#reset').click();await page.waitForFunction(()=>document.body.dataset.episode==='2');assert.equal(await page.locator('body').getAttribute('data-drones'),'3');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/team-flight-mobile.png',fullPage:true});
  const mobile=await page.evaluate(()=>['viewport','camera','reconstruction'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON()));assert.ok(mobile[0].bottom<mobile[1].top);assert.ok(Math.abs(mobile[1].width-mobile[2].width)<1&&Math.abs(mobile[1].height-mobile[2].height)<1);
  await page.setViewportSize({width:1720,height:1120});await page.goto(new URL('?drones=1',appUrl).href);await page.waitForFunction(()=>Number(document.querySelector('#camera').dataset.frames)>5,{},{timeout:20000});assert.ok(await page.locator('#viewport canvas').isVisible());assert.equal(await page.locator('.camera-feed:visible').count(),1);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',hosting:pythonServer?'Python stdlib (-S)':'existing server',aircraft:3,cameras:3,rotors:12,partial_map_samples:result.state.reconstruction.point_count,plans:result.state.plan_revision,records:result.records.length,inspection_time:result.state.time,peer_in_camera:true,mobile:true,errors}));
 }finally{try{if(browser)await browser.close();}finally{if(pythonServer&&pythonServer.exitCode===null&&pythonServer.signalCode===null){const stopped=new Promise(resolve=>pythonServer.once('exit',resolve));pythonServer.kill('SIGTERM');await stopped;}}}
})().catch(e=>{console.error(e);process.exitCode=1;});
