import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/window-ui-'+Date.now())}});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 assert.equal(await page.locator('#empty svg circle').count(),4);assert.equal(await page.locator('#pin svg').count(),1);
 await page.screenshot({path:'build/verification/07-owl-home.png'});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setPosition(100,100);});
 const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getPosition());
 await page.mouse.move(100,120);await page.mouse.down({button:'right'});await page.mouse.move(155,165);
 // Flush renderer events and the IPC queue before observing native bounds.
 await page.waitForTimeout(150);await page.mouse.up({button:'right'});
 const after=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getPosition());
 assert.notDeepEqual(after,before,'Right drag must move the actual Electron window');
 assert.equal(await page.locator('#context-menu').isVisible(),false);
 await page.locator('#stage').click({button:'right',position:{x:160,y:180}});assert.equal(await page.locator('#context-menu').isVisible(),true);
 await page.locator('#stage').click({position:{x:600,y:20}});
 await page.click('#demo');await page.waitForSelector('#viewer:not([hidden])');
 assert.equal(await page.locator('#context-menu #metadata,#context-menu #status').count(),0);
 assert.equal(await page.locator('#viewer-info #metadata').isVisible(),true);assert.equal(await page.locator('#viewer-info #status').isVisible(),true);
 assert.match(await page.locator('#viewer-info').textContent(),/Combined.*基础预览.*640/);
 await page.keyboard.press('a');assert.equal(await page.locator('#grid').evaluate(e=>getComputedStyle(e).gap),'8px');
 assert.equal(await page.locator('#viewer-info').isVisible(),true);
 await page.waitForFunction(()=>document.querySelectorAll('#grid canvas[data-painted=true]').length>=2);
 await page.screenshot({path:'build/verification/08-tight-grid.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({packaged,nativeWindowBefore:before,nativeWindowAfter:after,rightClickMenu:true,infoOutsideMenu:true,newIcons:true,gridGap:8,errors}));
} finally {await app.close();}
