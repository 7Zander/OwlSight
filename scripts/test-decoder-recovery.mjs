import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE || path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/boundary-ui-'+Date.now())},timeout:30000});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 const open=async name=>app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures',name));
 const loaded=async name=>page.waitForFunction(name=>document.querySelector('#file-name').textContent===name&&document.querySelector('#busy').hidden&&!document.querySelector('#viewer').hidden,name,{timeout:60000});
 await open('boundaries/at-budget.exr');await loaded('at-budget.exr');
 await page.keyboard.press('a');assert.equal(await page.locator('.tile').count(),256);
 await page.locator('.tile').last().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#grid .tile:last-child canvas').dataset.painted==='true');
 await page.locator('.tile').last().click();await page.waitForSelector('#viewer:not([hidden])');
 const value=await page.locator('#viewer').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),p=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return p[0];});
 assert.ok(Math.abs(value-254)<=1,`Last channel display ${value}`);
 await open('over-budget.exr');await page.waitForSelector('#error:not([hidden])');assert.match(await page.locator('#error-text').textContent(),/1920 MiB.*1024 MiB/);
 await open('known-origin.exr');await loaded('known-origin.exr');
 // Cancel a large in-flight decode with a small later request.
 await open('boundaries/at-budget.exr');await page.waitForSelector('#busy:not([hidden])');await open('blender-dwab.exr');await loaded('blender-dwab.exr');
 assert.equal(await page.locator('#error').isVisible(),false);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged,budgetGiB:1,all256Channels:true,lastChannelPixel:value,overBudgetChinese:true,recovery:true,cancelLargeForNewFile:true,errors}));
} finally {await app.close();}
