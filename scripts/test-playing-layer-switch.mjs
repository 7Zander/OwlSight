import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const privateFile=process.env.OWLSIGHT_TEST_EXR;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/layer-switch-profile-'+Date.now())}});
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),privateFile||path.resolve(process.env.OWLSIGHT_SWITCH_FIXTURE||'build/fixtures/layer-switch/switch_0000.exr'));
 await page.waitForSelector('#sequence-controls:not([hidden])');await page.waitForSelector('#viewer:not([hidden])');
 if(process.env.OWLSIGHT_BENCH_FULL==='1'){await page.selectOption('#sequence-resolution','1');await page.waitForTimeout(300);}
 const total=Number(await page.locator('#sequence-position').getAttribute('max'))+1;
 await page.waitForFunction(total=>document.querySelector('#sequence-status').textContent.includes(`· ${total}/${total} 帧`),total,{timeout:60000});
 await page.evaluate(()=>{window.__frames=[];window.__blank=0;window.__lastName=document.querySelector('#file-name').textContent;window.__watch=new MutationObserver(()=>{const name=document.querySelector('#file-name').textContent;if(name!==window.__lastName){window.__frames.push(performance.now());window.__lastName=name;}if(document.querySelector('#viewer').hidden)window.__blank++;});window.__watch.observe(document.querySelector('#file-name'),{childList:true});window.__hidden=new MutationObserver(()=>{if(document.querySelector('#viewer').hidden)window.__blank++;});window.__hidden.observe(document.querySelector('#viewer'),{attributes:true,attributeFilter:['hidden']});});
 await page.click('#sequence-play');await page.waitForTimeout(300);const original=await page.locator('#image-label').textContent();
 const switches=[];
 for(let n=0;n<3;n++){
  const begin=performance.now();await page.keyboard.press('s');
  assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true','Layer selection must not pause');
  assert.equal(await page.locator('#viewer').isVisible(),true);
  await page.waitForFunction(()=>!document.querySelector('#image-label').textContent.includes('切换中'),null,{timeout:15000});
  const elapsed=Math.round(performance.now()-begin);await page.waitForTimeout(1000);
  const pixel=await page.locator('#viewer').evaluate(c=>{const g=c.getContext('webgl2'),p=new Uint8Array(4);g.readPixels(c.width/2,c.height/2,1,1,g.RGBA,g.UNSIGNED_BYTE,p);return [...p];});
  if(!privateFile){const axis=(n+1)%3;assert.ok(pixel[axis]>100);assert.equal(pixel[(axis+1)%3],0);}
  switches.push({ms:elapsed,label:await page.locator('#image-label').textContent(),pixel});
 }
 // Multiple changes while the first request is still in flight must leave the last layer selected.
 await page.keyboard.press('s');await page.keyboard.press('s');await page.keyboard.press('s');
 await page.waitForFunction(()=>!document.querySelector('#image-label').textContent.includes('切换中'),null,{timeout:15000});
 assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true');
 if(!privateFile)assert.equal(await page.locator('#image-label').textContent(),original);
 const stats=await page.evaluate(()=>{window.__watch.disconnect();window.__hidden.disconnect();const t=window.__frames,intervals=t.slice(1).map((v,i)=>v-t[i]).sort((a,b)=>a-b);return {frames:t.length,fps:(t.length-1)*1000/(t.at(-1)-t[0]),p95:intervals[Math.floor(intervals.length*.95)],maxGap:Math.max(...intervals),blank:window.__blank};});
 assert.equal(stats.blank,0);assert.deepEqual(errors,[]);assert.ok(stats.frames>30);if(privateFile){assert.ok(stats.fps>=22,`Switching playback too slow: ${stats.fps}`);assert.ok(stats.p95<85,`Switching frame interval: ${stats.p95}`);}
 let warmStats=null;
 if(process.env.OWLSIGHT_MEASURE_WARM==='1'){
  await page.waitForFunction(total=>document.querySelector('#sequence-status').textContent.includes(`· ${total}/${total} 帧`),total,{timeout:60000});
  warmStats=await page.evaluate(()=>new Promise(resolve=>{
   const times=[];const observer=new MutationObserver(()=>times.push(performance.now()));
   observer.observe(document.querySelector('#file-name'),{childList:true});
   setTimeout(()=>{observer.disconnect();const intervals=times.slice(1).map((v,i)=>v-times[i]).sort((a,b)=>a-b);resolve({fps:(times.length-1)*1000/(times.at(-1)-times[0]),p95:intervals[Math.floor(intervals.length*.95)],maxGap:Math.max(...intervals)});},3000);
  }));
 }
 if(!privateFile){
  await page.locator('#stage').click({button:'right',position:{x:150,y:100}});
  for(const c of ['G','B','R'])await page.locator(`[data-component=${c}]`).click();
  await page.waitForFunction(()=>document.querySelector('#image-label').textContent.endsWith(' · R'),null,{timeout:10000});
  assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true');
  const rgb=await page.locator('#viewer').evaluate(c=>{const g=c.getContext('webgl2'),p=new Uint8Array(4);g.readPixels(c.width/2,c.height/2,1,1,g.RGBA,g.UNSIGNED_BYTE,p);return [...p];});
  assert.ok(rgb[0]>0);assert.equal(rgb[0],rgb[1]);assert.equal(rgb[1],rgb[2]);
  await page.locator('[data-component=G]').click();await page.keyboard.press('Space');
  await page.waitForSelector('#viewer:not([hidden])');
  await page.waitForFunction(()=>document.querySelector('#image-label').textContent.endsWith(' · G'));
  assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'false');
  await page.keyboard.press('Space');assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true');
  await page.locator('#stage').click({position:{x:650,y:20}});await page.keyboard.press('a');assert.equal(await page.locator('#grid').isVisible(),true);assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'false');
  assert.deepEqual(errors,[]);
 }
 const report={warmStats,fixture:privateFile?"private":process.env.OWLSIGHT_SWITCH_FIXTURE||"small",resolution:await page.locator('#sequence-resolution').inputValue(),packaged:!!process.env.OWLSIGHT_EXE,private:!!privateFile,switches,stats,errors};await writeFile('build/verification/layer-switch-'+(privateFile?'private':'fixture')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
