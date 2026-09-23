// SPDX-License-Identifier: GPL-3.0-or-later
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
const packaged=!!process.env.OWLSIGHT_EXE,root=path.resolve('.');
const executable=process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe');
const logDir=path.join(packaged?path.dirname(executable):root,'logs');
await mkdir('build/verification',{recursive:true});
let before=[];try{before=await readdir(logDir);}catch{}
const profile=path.resolve('build/perf-v2-profile-'+Date.now()),errors=[];
const app=await electron.launch({executablePath:executable,args:packaged?[]:[root],env:{...process.env,OWLSIGHT_PROFILE_DIR:profile}});
let report;
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('#demo');
 await page.waitForFunction(()=>document.querySelector('#open-log-directory')?.title.startsWith('打开日志目录：'));
 const fixture=path.resolve('build/fixtures/layer-switch/switch_0000.exr');
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),fixture);
 await page.waitForFunction(()=>!document.querySelector('#error').hidden||(document.querySelector('#viewer').title.startsWith('预览 ')&&!document.querySelector('#viewer').hidden));
 assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error-text').textContent());
 await page.waitForFunction(()=>!document.querySelector('#sequence-controls').hidden);
 await page.locator('#stage').click({position:{x:150,y:100}});
 await page.keyboard.press('Space');await page.waitForTimeout(1200);
 for(let i=0;i<3;i++){await page.keyboard.press('s');await page.waitForTimeout(90);}
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{const start=performance.now();while(performance.now()-start<180){}});
 await page.waitForTimeout(1200);
 await page.keyboard.press('Space');await page.waitForTimeout(2200);
 await page.locator('#stage').click({button:'right',position:{x:150,y:100}});
 await page.click('#tab-settings');
 await page.locator('#log-events').uncheck();await page.waitForTimeout(120);
 assert.equal(await page.locator('#log-events').isChecked(),false);
 await page.locator('#log-events').check();await page.waitForTimeout(1200);
 await page.click('#save-viewer-settings');
 await page.waitForFunction(()=>document.querySelector('#settings-message').textContent==='已保存');
 assert.equal(await page.locator('#error').isVisible(),false);
 assert.deepEqual(errors,[]);
 report={packaged,profile,logDirectory:logDir,pageErrors:errors};
 await page.click('#close');await app.waitForEvent('close',{timeout:10000}).catch(()=>{});
}finally{await app.close().catch(()=>{});}
const added=(await readdir(logDir)).filter(file=>file.endsWith('.jsonl')&&!before.includes(file));
assert.equal(added.length,1,'one new log per run');
const file=path.join(logDir,added[0]),events=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(events[0].e,'session');assert.equal(events[0].schema,2);
assert.equal(events.at(-1).e,'session-end');assert.equal(events.at(-1).rendererFlushed,true);
assert.ok(events.every((e,i)=>e.n===i+1),'writer sequence numbers are contiguous');
assert.ok(events.some(e=>e.e==='operation-end'&&e.kind==='open'&&e.status==='submitted'));
const switches=events.filter(e=>e.e==='operation-start'&&e.kind==='layer'&&e.source==='keyboard');
assert.equal(switches.length,3,'every S key has an operation');
assert.ok(switches.every(s=>events.some(e=>e.e==='operation-end'&&e.operationId===s.operationId)));
const perf=events.filter(e=>e.e==='perf');
assert.ok(perf.some(e=>!e.playing&&e.playingMs===0&&e.fps===0),'pause cannot carry stale fps');
assert.ok(perf.some(e=>e.frameIntervals.maxMs>150||e.maxHoldMs>150),'captures induced stall');
assert.ok(perf.some(e=>e.ui.longTasks.maxMs>=150),'captures renderer long task');
assert.ok(perf.some(e=>e.frameTrace.length>0&&Number.isFinite(e.targetFps)));
assert.ok(perf.some(e=>e.requestGroups.length>0));
assert.ok(events.some(e=>e.e==='reads'&&e.timings.sourceReadDecodeMs?.count>0));
assert.ok(events.some(e=>e.e==='resources'&&e.decoders.workers.some(w=>w.resources?.workingSetMiB>0)));
assert.ok(events.some(e=>e.e==='logging'&&e.enabled===false));
assert.ok(!JSON.stringify(events).includes(root),'no full project paths are persisted');
const output={...report,file,eventCount:events.length,switches:switches.length,normalEnd:true,
 open:events.find(e=>e.e==='operation-end'&&e.kind==='open'&&e.status==='submitted'),
 maxFrameIntervalMs:Math.max(...perf.map(e=>e.frameIntervals.maxMs||0)),checks:'open, S switches, stall, pause, native timing, resources, toggles, clean close'};
await writeFile('build/verification/perf-v2-'+(packaged?'packaged':'development')+'.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
