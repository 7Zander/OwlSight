import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const profile=path.resolve('build/shared-cache-profile-'+Date.now());
const launch=()=>electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:profile}});
let app=await launch();
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 await app.evaluate(({ipcMain})=>{
  global.__reads=0;global.__forcedBudget=0;
  for(const channel of ['sequence-frame','preview-exr']){const handler=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);ipcMain.handle(channel,(...args)=>{global.__reads++;return handler(...args);});}
  const state=ipcMain._invokeHandlers.get('cache-state');ipcMain.removeHandler('cache-state');ipcMain.handle('cache-state',(...args)=>{const result=state(...args);return global.__forcedBudget?{...result,budget:global.__forcedBudget}:result;});
  const os=process.getBuiltinModule('node:os');global.__free=16*1024**3;os.totalmem=()=>32*1024**3;os.freemem=()=>global.__free;
 });
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/shared-components/colors_0000.exr'));
 await page.waitForSelector('#sequence-controls:not([hidden])');await page.selectOption('#sequence-resolution','1');
 await page.waitForFunction(()=>document.querySelector('#viewer').title==='预览 4 × 4'&&Number(document.querySelector('#sequence-cache').dataset.cachedCount)===12);
 await page.waitForTimeout(250);
 await page.locator('#stage').click({button:'right',position:{x:180,y:120}});await page.locator('#context-menu summary').click();
 const reads=await app.evaluate(()=>global.__reads),bytes=Number(await page.locator('#sequence-status').getAttribute('data-cache-bytes'));
 const pixel=()=>page.locator('#viewer').evaluate(c=>{const gl=c.getContext('webgl2'),p=new Uint8Array(4);gl.readPixels(c.width/2,c.height/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});
 await page.selectOption('#display-mode','raw');
 for(const [component,value] of [['R',255],['G',255],['B',255],['A',153]]){
  await page.click(`[data-component=${component}]`);const p=await pixel();for(let c=0;c<3;c++)assert.ok(Math.abs(p[c]-value)<=1,component+': '+p);
 }
 await page.selectOption('#display-mode','range');
 for(const [component,value] of [['R',170],['G',170],['B',170],['A',159]]){
  await page.click(`[data-component=${component}]`);const p=await pixel();for(let c=0;c<3;c++)assert.ok(Math.abs(p[c]-value)<=1,component+' range: '+p);
 }
 await page.click('[data-component=RGBA]');
 assert.equal(await app.evaluate(()=>global.__reads),reads,'Component switches must issue no decoder reads');
 assert.equal(Number(await page.locator('#sequence-status').getAttribute('data-cache-bytes')),bytes,'Components must share pixel buffers');
 await page.click('#sequence-play');await page.locator('#stage').click({button:'right',position:{x:180,y:120}});
 for(const c of ['R','G','B','A','RGBA'])await page.click(`[data-component=${c}]`);
 assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true');
 assert.equal(await app.evaluate(()=>global.__reads),reads,'Warm playback components must reuse cached frames');
 await page.click('#sequence-play');await page.locator('#stage').click({button:'right',position:{x:180,y:120}});
 // Persisted upper limit, simulated pressure, and actual renderer eviction without consuming host RAM.
 await page.selectOption('#cache-budget','0.5');await page.waitForFunction(()=>Number(document.querySelector('#sequence-status').dataset.cacheBudget)===0.5*1024**3);
 await page.selectOption('#cache-budget','2');await page.waitForFunction(()=>Number(document.querySelector('#sequence-status').dataset.cacheBudget)===2*1024**3);
 await app.evaluate(()=>{global.__free=100*1024**2;});
 await page.waitForFunction(()=>Number(document.querySelector('#sequence-status').dataset.cacheBudget)===128*1024**2,null,{timeout:7000});
 assert.match(await page.locator('#sequence-status').textContent(),/内存保护/);assert.equal(await page.locator('#cache-budget').inputValue(),'2');
 await app.evaluate(()=>{global.__forcedBudget=2048;});
 await page.waitForFunction(()=>Number(document.querySelector('#sequence-status').dataset.cacheBudget)===2048,null,{timeout:7000});
 assert.ok(Number(await page.locator('#sequence-status').getAttribute('data-cache-bytes'))<=2048);
 assert.ok(Number(await page.locator('#sequence-cache').getAttribute('data-cached-count'))<12);
 await app.evaluate(()=>{global.__forcedBudget=0;global.__free=16*1024**3;});await page.selectOption('#cache-budget','1');
 await page.waitForFunction(()=>Number(document.querySelector('#sequence-status').dataset.cacheBudget)===1024**3);
 assert.equal(await page.locator('#error').isVisible(),false);assert.deepEqual(errors,[]);
 await app.close();app=await launch();const restored=await app.firstWindow();
 await restored.waitForFunction(()=>document.querySelector('#cache-budget')?.value==='1');
 console.log(JSON.stringify({packaged:!!process.env.OWLSIGHT_EXE,componentSwitchAdditionalReads:0,componentSwitchAdditionalBytes:0,rgbaPixels:true,componentRangePixels:true,playingPreserved:true,manualBudget:true,pressureShrinks:true,shrinkEvicts:true,preferenceSurvivesRestart:true,errors}));
}finally{await app.close();}

