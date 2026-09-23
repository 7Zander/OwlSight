import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const file=process.env.OWLSIGHT_TEST_EXR;
if(!file) throw new Error('Set OWLSIGHT_TEST_EXR to the authorized local regression sample.');
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE || path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[file]:[path.resolve('.'),file],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/private-test-profile-'+Date.now())},timeout:30000});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelector('#busy').hidden&&(!document.querySelector('#viewer').hidden||!document.querySelector('#error').hidden),null,{timeout:60000});
 assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error-text').textContent());
 assert.match(await page.locator('#metadata').textContent(),/17 Part.*68 通道/);
 const first=await page.locator('#image-label').textContent();
 await page.keyboard.press('s');assert.notEqual(await page.locator('#image-label').textContent(),first);
 await page.keyboard.press('a');assert.equal(await page.locator('.tile').count(),17);
 await page.locator('.tile').last().scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('#grid .tile:last-child canvas').dataset.painted==='true');
 await page.locator('.tile').last().click();await page.waitForSelector('#viewer:not([hidden])');
 await page.locator('#stage').click({button:'right',position:{x:100,y:100}});assert.equal(await page.locator('#context-items button').count(),17);await page.locator('#stage').click({position:{x:550,y:20}});
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/oversize-chinese-error.exr'));
 await page.waitForSelector('#error:not([hidden])');
 assert.equal(await page.locator('#error-text').textContent(),'EXR 尺寸超过读取上限。');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged,parts:17,channels:68,views:17,open:true,cycle:true,grid:true,contextMenu:true,chineseError:true,errors}));
} finally {await app.close();}
