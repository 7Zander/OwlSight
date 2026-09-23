import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const file=process.env.OWLSIGHT_TEST_EXR;if(!file)throw new Error('Set OWLSIGHT_TEST_EXR');
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/performance-profile-'+Date.now())}});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('load');await page.waitForSelector('#demo');
 const cdp=await page.context().newCDPSession(page),start=performance.now(),data={items:[],files:[file],dragOperationsMask:1};
 for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:250,y:250,data});
 await page.waitForSelector('#viewer:not([hidden])',{timeout:60000});const openMs=Math.round(performance.now()-start);
 await page.waitForSelector('#sequence-controls:not([hidden])');assert.equal(await page.locator('#error').isVisible(),false);
 const total=Number(await page.locator('#sequence-position').getAttribute('max'))+1,records=[];
 for(const ratio of (process.env.OWLSIGHT_BENCH_FULL ? ['1','2','4'] : ['2','4'])){
  const warmStart=performance.now();await page.selectOption('#sequence-resolution',ratio);
  await page.waitForFunction(total=>document.querySelector('#sequence-status').textContent.includes(`· ${total}/${total} 帧`),total,{timeout:120000});
  const warmMs=Math.round(performance.now()-warmStart),texture=await page.locator('#viewer').getAttribute('title');
  await page.evaluate(()=>{window.__times=[];window.__observer?.disconnect();window.__observer=new MutationObserver(()=>window.__times.push(performance.now()));window.__observer.observe(document.querySelector('#file-name'),{childList:true});});
  await page.click('#sequence-play');await page.waitForTimeout(5000);await page.click('#sequence-play');
  const times=await page.evaluate(()=>{window.__observer.disconnect();return window.__times;});
  const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b),fps=(times.length-1)*1000/(times.at(-1)-times[0]);
  const status=await page.locator('#sequence-status').textContent();assert.ok(fps>=22,`Hot ratio 1/${ratio}: ${fps} fps`);assert.equal(await page.locator('#busy').isVisible(),false);
  records.push({ratio:'1/'+ratio,warmMs,texture,presented:times.length,fps:Number(fps.toFixed(2)),p95FrameMs:Math.round(intervals[Math.floor(intervals.length*.95)]),status});
 }
 // The selected AOV must become visible promptly, not after a full-frame reload.
 await page.locator('#stage').click({button:'right',position:{x:100,y:100}});const layerStart=performance.now();await page.locator('#context-items button').nth(1).click();await page.waitForSelector('#viewer:not([hidden])');const layerMs=Math.round(performance.now()-layerStart);
 const report={packaged,total,openMs,records,layerMs,errors,sourceUploaded:false};assert.deepEqual(errors,[]);assert.ok(layerMs<500);
 await page.screenshot({path:'build/verification/performance-ui.png'});await writeFile('build/verification/performance-'+(packaged?'packaged':'development')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await app.close();}
