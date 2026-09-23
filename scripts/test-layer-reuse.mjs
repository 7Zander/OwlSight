// SPDX-License-Identifier: GPL-3.0-or-later
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/layer-reuse-profile-'+Date.now())}});
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 await app.evaluate(({ipcMain})=>{
  global.__reads=[];
  for(const name of ['preview-exr','sequence-frame']){const original=ipcMain._invokeHandlers.get(name);ipcMain.removeHandler(name);ipcMain.handle(name,(event,...args)=>{global.__reads.push({name,args});return original(event,...args);});}
 });
 await page.evaluate(()=>{window.__uploads=0;const proto=WebGL2RenderingContext.prototype,original=proto.texImage2D;proto.texImage2D=function(...args){window.__uploads++;return original.apply(this,args);};});
 const open=async file=>{
  await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve(file));
  await page.waitForFunction(name=>document.querySelector('#file-name').textContent===name&&!document.querySelector('#viewer').hidden&&document.querySelector('#busy').hidden,path.basename(file));
 };
 const reads=()=>app.evaluate(()=>global.__reads);
 const pixel=()=>page.locator('#viewer').evaluate(c=>{const gl=c.getContext('webgl2'),p=new Uint8Array(4);gl.readPixels(c.width/2,c.height/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});
 await open('build/fixtures/shared-components/colors_0000.exr');
 await page.selectOption('#sequence-resolution','1');
 await page.waitForFunction(()=>document.querySelector('#sequence-status').textContent.includes('12/12 帧'));
 await page.waitForTimeout(700);
 await page.locator('#stage').click({button:'right',position:{x:160,y:120}});await page.click('#tab-display');await page.selectOption('#display-mode','raw');await page.click('#tab-channels');
 const before=(await reads()).length,uploads=await page.evaluate(()=>window.__uploads),bytes=await page.locator('#sequence-status').getAttribute('data-cache-bytes');
 for(const [component,expected] of [['R',255],['G',255],['B',255],['A',153]]){
  await page.click(`[data-component=${component}]`);const p=await pixel();for(let c=0;c<3;c++)assert.ok(Math.abs(p[c]-expected)<=1,`${component}: ${p}`);
 }
 await page.click('#tab-display');await page.selectOption('#display-mode','range');await page.click('#tab-channels');
 for(const [component,expected] of [['R',170],['G',170],['B',170],['A',159]]){
  await page.click(`[data-component=${component}]`);const p=await pixel();for(let c=0;c<3;c++)assert.ok(Math.abs(p[c]-expected)<=1,`${component} range: ${p}`);
 }
 assert.equal((await reads()).length,before,'components must not decode again');
 assert.equal(await page.evaluate(()=>window.__uploads),uploads,'components must not upload again');
 assert.equal(await page.locator('#sequence-status').getAttribute('data-cache-bytes'),bytes);
 await page.click('[data-component=RGBA]');await page.click('#sequence-play');
 await page.locator('#stage').click({button:'right',position:{x:160,y:120}});
 for(const component of ['A','G','R','B','RGBA'])await page.click(`[data-component=${component}]`);
 assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true');
 assert.equal((await reads()).length,before,'warm playback components share the entire cached sequence');
 await open('build/fixtures/layer-switch/switch_0000.exr');
 await page.waitForFunction(()=>document.querySelector('#sequence-status').textContent.includes('48/48 帧'));
 await page.waitForTimeout(1200);
 const all=await reads(),start=all.findLastIndex(r=>r.name==='preview-exr'&&r.args[0].endsWith('switch_0000.exr'));
 const paused=all.slice(start).filter(r=>r.name==='sequence-frame'&&r.args[2].partName!=='beauty');
 assert.ok(paused.some(r=>r.args[2].partName==='diffuse'),'paused prefetch includes another layer');
 assert.ok(paused.every(r=>r.args[1]===0),'alternatives only read the current frame');
 assert.ok(new Set(paused.map(r=>r.args[2].partName)).size<=2);
 await page.click('#sequence-play');const playStart=(await reads()).length;await page.waitForTimeout(500);
 assert.ok((await reads()).slice(playStart).every(r=>r.args[r.name==='sequence-frame'?2:1].partName==='beauty'),'playing never decodes alternative layers');
 await page.click('#sequence-play');await page.waitForTimeout(800);
 await page.locator('#stage').click({button:'right',position:{x:160,y:120}});await page.click('#tab-channels');
 await page.locator('[data-menu-view="1"]').click();await page.waitForFunction(()=>document.querySelector('#image-label').textContent==='diffuse / RGB');
 await page.locator('[data-menu-view="0"]').click();await page.waitForFunction(()=>document.querySelector('#image-label').textContent==='beauty / RGB');
 // Single images use the same bounded, delayed preparation, without a sequence scheduler.
 const singleStart=(await reads()).length;await open('resources/demo.exr');await page.waitForTimeout(1800);
 const singleReads=(await reads()).slice(singleStart).filter(r=>r.name==='preview-exr');
 assert.ok(singleReads.length>=2&&singleReads.length<=3,'single image prepares at most two alternatives');
 const base=(await reads()).length;
 await page.locator('#stage').click({button:'right',position:{x:160,y:120}});await page.click('#tab-channels');
 await page.locator('[data-menu-view="1"]').click();await page.waitForTimeout(100);
 assert.equal((await reads()).length,base,'prepared single-image layer is reused');
 // Grid components must also use the real source alpha from a shared RGBA texture.
 await open('build/fixtures/known-origin.exr');
 await page.locator('#stage').click({button:'right',position:{x:160,y:120}});await page.click('#tab-channels');
 await page.click('[data-component=A]');await page.keyboard.press('Escape');await page.keyboard.press('a');
 await page.waitForFunction(()=>document.querySelector('#grid .tile:first-child canvas')?.dataset.painted==='true');
 const gridAlpha=await page.locator('#grid .tile:first-child canvas').evaluate(c=>[...c.getContext('2d').getImageData(110,50,1,1).data]);
 assert.deepEqual(gridAlpha,[0,0,0,255]);
 assert.equal(await page.locator('#error').isVisible(),false);assert.deepEqual(errors,[]);
 const report={packaged,componentAdditionalReads:0,componentAdditionalUploads:0,componentCacheBytesUnchanged:true,alphaAndRangePixels:true,warmPlaybackNoReads:true,pausedAlternativeLayers:[...new Set(paused.map(r=>r.args[2].partName))],pausedAlternativesOnlyCurrentFrame:true,playingAlternatives:false,singleImageReuse:true,gridAlpha:true,errors};
 await writeFile('build/verification/layer-reuse-'+(packaged?'packaged':'development')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
