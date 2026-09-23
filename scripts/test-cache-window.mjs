import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/cache-window-profile-'+Date.now())}});
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 // Inject pressure and observable latency at the IPC boundary, only in this test.
 await app.evaluate(({ipcMain})=>{
  const open=ipcMain._invokeHandlers.get('read-exr'),frame=ipcMain._invokeHandlers.get('sequence-frame');
  global.__cacheReads=[];
  ipcMain.removeHandler('cache-state');ipcMain.handle('cache-state',()=>({preference:'auto',budget:64*1024,adjusted:false}));
  ipcMain.removeHandler('read-exr');ipcMain.handle('read-exr',async(...args)=>({...await open(...args),cacheBudget:64*1024}));
  ipcMain.removeHandler('sequence-frame');ipcMain.handle('sequence-frame',async(...args)=>{
   global.__cacheReads.push({index:args[2],time:Date.now()});const result=await frame(...args);await new Promise(r=>setTimeout(r,80));return result;
  });
 });
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/layer-switch/switch_0000.exr'));
 await page.waitForSelector('#viewer:not([hidden])');
 await page.waitForFunction(()=>Number(document.querySelector('#sequence-cache').dataset.cachedCount)>=2);
 await page.click('#sequence-play');await page.waitForTimeout(120);await page.click('#sequence-play');
 const before=Number(await page.locator('#sequence-cache').getAttribute('data-cached-count'));
 await page.waitForFunction(before=>Number(document.querySelector('#sequence-cache').dataset.cachedCount)>before,before);
 await page.waitForTimeout(800);
 const cached=Number(await page.locator('#sequence-cache').getAttribute('data-cached-count'));assert.ok(cached>=5&&cached<48);
 const stable=await app.evaluate(()=>global.__cacheReads.length);await page.waitForTimeout(400);assert.equal(await app.evaluate(()=>global.__cacheReads.length),stable,'A full cache window must not repeatedly reload evicted frames');
 await page.locator('#sequence-position').evaluate(input=>{for(const value of [12,29,4,40]){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}});
 await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='switch_0040.exr');
 await page.waitForTimeout(800);
 const spans=await page.locator('#sequence-cache span').evaluateAll(nodes=>nodes.map(n=>[parseFloat(n.style.left),parseFloat(n.style.width)]));
 assert.ok(spans.some(([start,width])=>start<=40/48*100&&start+width>40/48*100));
 assert.ok(spans.every(([start])=>start>50),'Distant obsolete frames must leave the cache');
 await page.click('#sequence-play');await page.waitForTimeout(100);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await page.waitForTimeout(300);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),true);
 const hidden=await app.evaluate(()=>global.__cacheReads.length);await page.waitForTimeout(400);assert.equal(await app.evaluate(()=>global.__cacheReads.length),hidden);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
 await page.waitForFunction(()=>!document.hidden);
 await page.waitForFunction(()=>Number(document.querySelector('#sequence-cache').dataset.cachedCount)>=5);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:600,height:400}));
 await page.waitForTimeout(150);
 const bounds=await page.locator('#sequence-cache').evaluate(bar=>{const r=bar.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,height:r.height,width:innerWidth,viewportHeight:innerHeight};});
 assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.viewportHeight&&bounds.height===3);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged:!!process.env.OWLSIGHT_EXE,budgetKiB:64,before,cached,pauseContinuesPreload:true,noCacheChurn:true,seekLatestWins:true,cacheBarTracksWindow:true,hiddenStopsReads:true,restorePreloads:true,minWindowCacheBarFits:true,errors}));
}finally{await app.close();}
