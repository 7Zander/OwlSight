import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/component-profile-'+Date.now())}});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('#shortcut-watermark');
 assert.equal(await page.locator('#shortcut-watermark').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 assert.equal(await page.locator('#grid-toggle,#fit').count(),0);
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/known-origin.exr'));
 await page.waitForSelector('#viewer:not([hidden])');
 async function menu(){await page.locator('#stage').click({button:'right',position:{x:150,y:150}});}
 async function sample(){await page.waitForSelector('#viewer:not([hidden])');return page.locator('#viewer').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),w=canvas.width,h=canvas.height,side=Math.min(w,h),p=new Uint8Array(4);gl.readPixels(Math.round((w-side)/2+side*.25),Math.round((h-side)/2+side*.75),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});}
 await menu();assert.equal(await page.locator('#context-items button').count(),2);
 await page.locator('#context-items button').last().click();assert.equal(await page.locator('#context-menu').isVisible(),true);assert.equal(await page.locator('#context-items button').last().getAttribute('aria-checked'),'true');
 await page.locator('#context-items button').first().click();assert.equal(await page.locator('#context-menu').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#context-menu').isVisible(),true);
 await page.locator('#context-menu summary').click();await page.selectOption('#display-mode','raw');assert.equal(await page.locator('#context-menu').isVisible(),true);await page.selectOption('#display-mode','auto');await page.locator('#context-menu summary').click();
 await app.evaluate(({dialog})=>{global.__savedDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 await page.click('#open');assert.equal(await page.locator('#context-menu').isVisible(),true);
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=global.__savedDialog;delete global.__savedDialog;});
 assert.deepEqual(await page.locator('#component-switch button').allTextContents(),['RGBA','R','G','B','A']);
 for(const [mode,expected] of [['A',[0,0,0,255]],['G',[0,0,0,255]],['B',[0,0,0,255]],['R',[255,255,255,255]],['RGBA',[255,0,0,255]]]) {
  await page.click(`[data-component="${mode}"]`);assert.equal(await page.locator('#context-menu').isVisible(),true);await page.locator('#stage').click({position:{x:550,y:20}});assert.deepEqual(await sample(),expected);await menu();
 }
 await page.screenshot({path:'build/verification/06-component-menu.png'});await page.locator('#stage').click({position:{x:550,y:20}});
 await page.keyboard.press('a');assert.equal(await page.locator('.tile').count(),2);
 await menu();await page.click('[data-component="A"]');await page.locator('#stage').click({position:{x:550,y:20}});
 await page.waitForFunction(()=>document.querySelector('#grid .tile:first-child canvas').dataset.painted==='true');
 const alphaPixel=await page.locator('.tile canvas').first().evaluate(c=>[...c.getContext('2d').getImageData(110,50,1,1).data]);assert.deepEqual(alphaPixel,[0,0,0,255]);
 await page.keyboard.press('a');assert.match(await page.locator('#image-label').textContent(),/· A$/);
 await page.keyboard.press('f');assert.equal(await page.locator('#shortcut-watermark').isVisible(),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({packaged,compositeList:true,componentPixels:true,gridAlpha:true,watermark:true,removedMenuActions:true,persistentMenu:true,errors}));
} finally {await app.close();}
