import {_electron as electron} from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const file=process.env.OWLSIGHT_TEST_EXR;
if(!file)throw new Error('请设置 OWLSIGHT_TEST_EXR 为已授权的序列首帧路径。');
const versions=[process.env.OWLSIGHT_EXE?'packaged':'development'];
const reports=[];
for(const version of versions){
 const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/compare-profile-'+version+'-'+Date.now())}});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
  await app.evaluate(({ipcMain})=>{
   const open=ipcMain._invokeHandlers.get('read-exr'),read=ipcMain._invokeHandlers.get('sequence-frame');global.__reads=[];global.__cancels=0;
   ipcMain.removeHandler('read-exr');ipcMain.handle('read-exr',async(...args)=>({...await open(...args),cacheBudget:4*1024**3}));
   if(ipcMain._invokeHandlers.has('cache-state')){ipcMain.removeHandler('cache-state');ipcMain.handle('cache-state',()=>({preference:'auto',budget:4*1024**3,adjusted:false}));}
   const cancel=ipcMain._invokeHandlers.get('cancel-read');ipcMain.removeHandler('cancel-read');ipcMain.handle('cancel-read',(...args)=>{global.__cancels++;return cancel(...args);});
   ipcMain.removeHandler('sequence-frame');ipcMain.handle('sequence-frame',async(...args)=>{
    const record={index:args[2],layer:args[3]?.partName||JSON.stringify(args[3]?.channels),start:Date.now()};global.__reads.push(record);
    const result=await read(...args);record.ms=Date.now()-record.start;record.ok=result.ok;return result;
   });
  });
  const opened=performance.now();await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),file);
  await page.waitForSelector('#sequence-controls:not([hidden])');await page.waitForSelector('#viewer:not([hidden])');
  const total=Number(await page.locator('#sequence-position').getAttribute('max'))+1;
  await page.waitForFunction(n=>document.querySelector('#sequence-status').textContent.includes(`· ${n}/${n} 帧`),total,{timeout:120000});
  const warmMs=Math.round(performance.now()-opened),metadata=await page.locator('#metadata').textContent();
  const initialStatus=await page.locator('#sequence-status').textContent();
  const initialLayer=await app.evaluate(()=>{const layer=global.__reads[0]?.layer;global.__reads=[];return layer;});
  await page.click('#sequence-play');await page.waitForTimeout(200);await app.evaluate(()=>{global.__cancels=0;});
  await page.evaluate(()=>{
   window.__measureStart=performance.now();window.__times=[];window.__labels=[];window.__blank=0;window.__lastName=document.querySelector('#file-name').textContent;window.__lastLabel='';
   window.__watch=new MutationObserver(()=>{const name=document.querySelector('#file-name').textContent;if(name!==window.__lastName){window.__times.push(performance.now());window.__lastName=name;}const label=document.querySelector('#image-label').textContent.replace(' · 切换中…','');if(label!==window.__lastLabel){window.__labels.push(label);window.__lastLabel=label;}if(document.querySelector('#viewer').hidden)window.__blank++;});
   window.__watch.observe(document.querySelector('#file-name'),{childList:true});
  });
  const checkpoints=[];let lastPressAt=0;
  for(let i=0;i<64;i++){
   lastPressAt=performance.now();await page.keyboard.press('s');await page.waitForTimeout(120);
   if([0,7,31,63].includes(i))checkpoints.push({press:i+1,status:await page.locator('#sequence-status').textContent(),shown:await page.locator('#image-label').textContent()});
  }
  const stats=await page.evaluate(()=>{window.__watch.disconnect();const t=window.__times,d=t.slice(1).map((x,i)=>x-t[i]).sort((a,b)=>a-b);const elapsed=performance.now()-window.__measureStart;d.push(t[0]-window.__measureStart,performance.now()-t.at(-1));d.sort((a,b)=>a-b);return {frames:t.length,elapsed,fps:t.length*1000/elapsed,p95:d[Math.floor(d.length*.95)],maxGap:Math.max(...d),gapsOver100ms:d.filter(x=>x>100).length,blank:window.__blank,shownLayers:window.__labels};});
  const reads=await app.evaluate(()=>global.__reads);
  const cancelCalls=await app.evaluate(()=>global.__cancels);
  await page.waitForFunction(()=>!document.querySelector('#image-label').textContent.includes('切换中'),null,{timeout:15000});
  const finalSwitchMs=Math.round(performance.now()-lastPressAt);
  await page.locator('#stage').click({button:'right',position:{x:150,y:100}});
  const requested=(await page.locator('[data-menu-view][aria-checked=true]').textContent()).replace('✓','').replace('[组合]','').trim();
  assert.equal((await page.locator('#image-label').textContent()).trim(),requested);
  const report={version,cancelCalls,finalSwitchMs,requested,frames:total,metadata,warmMs,initialStatus,checkpoints,stats,reads:{total:reads.length,originalLayer:reads.filter(r=>r.layer===initialLayer).length,cancelled:reads.filter(r=>r.ok===false).length},playing:await page.locator('#sequence-play').getAttribute('aria-pressed'),errorText:await page.locator('#error-text').textContent(),errors};
  reports.push(report);console.log(JSON.stringify(report));await writeFile('build/verification/rapid-S-merged.json',JSON.stringify(reports,null,2));
  assert.ok(stats.fps>=22,`Rapid S fps: ${stats.fps}`);assert.ok(stats.maxGap<200,`Rapid S stall: ${stats.maxGap}`);assert.equal(cancelCalls,0);assert.equal(report.reads.originalLayer,0);assert.deepEqual(errors,[]);
 }finally{await app.close();}
}
