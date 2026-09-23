import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const file=process.env.OWLSIGHT_TEST_EXR;
if(!file) throw new Error('Set OWLSIGHT_TEST_EXR to an authorized local sequence.');
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/sequence-private-profile-'+Date.now())}});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),file);
 await page.waitForSelector('#viewer:not([hidden])',{timeout:60000});await page.waitForSelector('#sequence-controls:not([hidden])');
 const count=Number(await page.locator('#sequence-position').getAttribute('max'))+1;
 await page.keyboard.press('Space');
 await page.waitForFunction(initial=>document.querySelector('#file-name').textContent!==initial,path.basename(file),{timeout:30000});
 assert.equal(await page.locator('#error').isVisible(),false);
 await page.keyboard.press('Space');
 await page.waitForFunction(()=>document.querySelector('#sequence-play').getAttribute('aria-pressed')==='false',null,{timeout:60000});
 await page.waitForSelector('#viewer:not([hidden])');assert.match(await page.locator('#metadata').textContent(),/17 Part.*68 通道/);
 await page.keyboard.press('a');assert.equal(await page.locator('.tile').count(),17);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged,privateSequenceFrames:count,playChangesFrame:true,pauseKeepsPreviewAndAllLayers:true,gridLayers:17,errors}));
} finally {await app.close();}
