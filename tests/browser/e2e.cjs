// End-to-end test of an isolated browser, static resources, real module worker,
// WebGL canvas and public controls. Start `npm start` first.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const url=new URL(process.env.SWARM_URL||'http://127.0.0.1:8766/browser/?scene=yard');url.searchParams.set('controller','browser');await page.goto(url.href);
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Browser simulation');
    await page.locator('#focus-scene').click();
    await page.waitForFunction(()=>document.querySelectorAll('.fleet-item').length===3);
    const snapshot=async()=>{const pending=page.waitForEvent('download');await page.locator('#export').click();const download=await pending;return JSON.parse(await fs.readFile(await download.path(),'utf8'));};
    await page.locator('#play').click();let paused=await snapshot();assert.equal(paused.running,false);
    await page.waitForTimeout(200);assert.equal((await snapshot()).time,paused.time);
    await page.locator('#step').click();assert.ok((await snapshot()).time>paused.time);
    await page.locator('#actor-manual').click();await page.locator('#play').click();
    const before=await snapshot();await page.keyboard.down('w');await page.waitForTimeout(700);await page.keyboard.up('w');await page.waitForTimeout(150);
    const moved=await snapshot();assert.equal(moved.person.mode,'manual');assert.ok(moved.person.position[1]>before.person.position[1]+.1);
    await page.locator('[data-person="crouch"]').click();assert.equal((await snapshot()).person.height,1.1);
    await page.locator('#response').selectOption('0');await page.locator('#guidance').click();await page.waitForFunction(()=>document.querySelector('#mission-state').textContent==='OPERATOR ALERT');assert.equal((await snapshot()).person.refused,true);
    await page.locator('#response').selectOption('1');await page.locator('#guidance').click();await page.waitForFunction(()=>document.querySelector('#person-status').textContent.includes('voluntarily'));
    await page.locator('#predictions').check();await page.waitForFunction(()=>document.querySelector('#model-status').textContent==='LEARNING');assert.ok((await snapshot()).predictions.length===16);
    await page.locator('[data-camera="top"]').click();await page.locator('[data-camera="action"]').click();
    await page.locator('#scene').selectOption('office');await page.locator('#apply').click();await page.waitForFunction(()=>document.querySelector('#scene-name').textContent==='Furnished interior');
    const office=await snapshot();assert.equal(office.drones.length,3);assert.equal(office.config.scene,'office');
    // Graph uses the same worker state, via a session-specific BroadcastChannel.
    const graphPage=await context.newPage();await graphPage.goto(await page.locator('.graph-link').evaluate(el=>el.href));
    await graphPage.waitForFunction(()=>document.querySelectorAll('.node').length>60);
    await graphPage.locator('[data-id="actor"]').click();assert.equal(await graphPage.locator('#title').textContent(),'Person');
    await graphPage.locator('#search').fill('rotor');assert.ok(await graphPage.locator('.node:not(.faded)').count()>=12);
    await graphPage.close();await page.bringToFront();
    await page.locator('#focus-scene').click();await page.locator('#reset').click();await page.waitForTimeout(600);
    await fs.mkdir(path.join(__dirname,'../../test-results'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../../test-results/browser-office.png')});
    const canvas=await page.locator('#viewport canvas').boundingBox(),viewport=await page.locator('#viewport').boundingBox();assert.ok(canvas.width>500&&canvas.height>400);assert.ok(Math.abs(canvas.width-viewport.width)<2);
    // Test initial and graph assets were local. A disconnected server must not
    // stop the already-loaded engine, controls, or prediction updates.
    const offlineBefore=await snapshot();await context.setOffline(true);await page.waitForTimeout(500);const offlineAfter=await snapshot();assert.ok(offlineAfter.time>offlineBefore.time);await context.setOffline(false);
    await page.locator('#focus-scene').click();
    for(const scene of ['yard','warehouse','forest']){
      await page.locator('#scene').selectOption(scene);await page.locator('#apply').click();await page.waitForTimeout(300);
      assert.equal((await snapshot()).config.scene,scene);assert.equal(await page.locator('.fleet-item').count(),3);
      await page.locator('#focus-scene').click();await page.waitForTimeout(200);
      await page.screenshot({path:path.join(__dirname,`../../test-results/browser-${scene}.png`)});await page.locator('#focus-scene').click();
    }
    await page.setViewportSize({width:390,height:844});await page.locator('#focus-scene').click();await page.waitForTimeout(200);
    assert.ok(await page.locator('#focus-scene').isVisible());assert.ok(await page.locator('#play').isVisible());
    assert.equal(requests.filter(u=>u.includes('/api/')).length,0);assert.ok(requests.every(u=>u.startsWith(new URL(url).origin+'/')||u.startsWith('blob:')||u.startsWith('data:')));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',drones:3,checks:['WebGL and worker boot','pause/step','manual keyboard','crouch','refusal/acceptance','learned forecast','all four rendered scenes','live graph','offline simulation','responsive controls','no backend API'],requests:requests.length,screenshots:'test-results/browser-*.png'}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
