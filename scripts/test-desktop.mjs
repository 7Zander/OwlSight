import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const output=path.resolve('build/verification'); await mkdir(output,{recursive:true});
const executable=process.env.OWLSIGHT_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:executable,args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve(`build/test-profile-${Date.now()}`)},timeout:30000});
const page=await app.firstWindow(), errors=[], report=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text());});
try {
 await page.waitForSelector('#demo');
 await page.screenshot({path:path.join(output,'01-empty.png')});
 await page.click('#demo');
 await page.waitForFunction(()=>document.querySelector('#busy').hidden && (!document.querySelector('#viewer').hidden || !document.querySelector('#error').hidden),null,{timeout:60000});
 assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error-text').textContent());
 await page.locator('#viewer').click({button:'right',position:{x:180,y:160}});
 const labels=await page.locator('#context-items button').allTextContents();
 await page.locator('#stage').click({position:{x:550,y:20}});
 assert.equal(labels.length,6); assert.match(labels[0],/Combined/);
 report.push('ZIP16 demo: 15 raw channels presented as 4 layers + Depth and ID');
 await app.evaluate(({dialog})=>{global.__originalDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 await page.keyboard.press('Control+o');
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#viewer').isVisible(),true);
 assert.equal(await page.locator('#image-label').textContent(),'Combined');
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=global.__originalDialog;delete global.__originalDialog;});
 report.push('Cancel file dialog preserves the current image and selection');
 const first=await page.locator('#image-label').textContent();
 await page.keyboard.press('s'); assert.notEqual(await page.locator('#image-label').textContent(),first);
 await page.keyboard.down('s'); const once=await page.locator('#image-label').textContent(); await page.keyboard.down('s'); assert.equal(await page.locator('#image-label').textContent(),once); await page.keyboard.up('s');
 for(let i=0;i<labels.length;i++) await page.keyboard.press('s');
 assert.equal(await page.locator('#image-label').textContent(),once); report.push('S advances, wraps and ignores key repeat');
 await page.keyboard.press('a'); assert.equal(await page.locator('#grid').isVisible(),true);
 await page.waitForFunction(()=>document.querySelectorAll('#grid canvas[data-painted=true]').length>=2);
 assert.equal(await page.locator('.tile').count(),6);
 await page.screenshot({path:path.join(output,'02-contact-sheet.png')});
 await page.keyboard.press('a'); assert.equal(await page.locator('#image-label').textContent(),once); report.push('A toggles all views and preserves selection');
 await page.locator('#viewer').click({button:'right',position:{x:180,y:160}});
 assert.equal(await page.locator('#context-items button').count(),6);
 await page.locator('#context-items button').filter({hasText:'Depth.Z'}).click();
 assert.equal(await page.locator('#image-label').textContent(),'Depth.Z');
 await page.locator('#stage').click({position:{x:550,y:20}});
 await page.keyboard.press('a'); await page.locator('.tile').filter({hasText:'Combined'}).first().click();
 assert.equal(await page.locator('#image-label').textContent(),'Combined');
 await page.screenshot({path:path.join(output,'03-beauty.png')}); report.push('Context menu and grid click select requested view');
 async function openFixture(name) { await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures',name)); }
 await openFixture('broken.exr'); await page.waitForSelector('#error:not([hidden])');
 await openFixture('多通道 样例.exr');
 await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='多通道 样例.exr' && document.querySelector('#busy').hidden,null,{timeout:60000});
 assert.equal(await page.locator('#error').isVisible(),false); report.push('Bad file recovery and Unicode/space path');
 await openFixture('known-origin.exr');
 await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='known-origin.exr' && document.querySelector('#busy').hidden,null,{timeout:60000});
 await page.waitForSelector('#viewer:not([hidden])');
 const colors=await page.locator('#viewer').evaluate(canvas=>{
  const gl=canvas.getContext('webgl2'),w=canvas.width,h=canvas.height,side=Math.min(w,h),left=(w-side)/2,bottom=(h-side)/2;
  const sample=(x,y)=>{const b=new Uint8Array(4);gl.readPixels(Math.round(left+side*x),Math.round(bottom+side*y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b];};
  return {topLeft:sample(.25,.75),topRight:sample(.75,.75),bottomLeft:sample(.25,.25),bottomRight:sample(.75,.25)};
 });
 assert.deepEqual(colors.topLeft,[255,0,0,255]); assert.deepEqual(colors.topRight,[0,255,0,255]); assert.deepEqual(colors.bottomLeft,[0,0,255,255]);
 assert.ok(Math.abs(colors.bottomRight[1]-137)<=2); assert.ok(Math.abs(colors.bottomRight[2]-188)<=2);
 report.push('GPU orientation and linear-to-sRGB values match known pixels');
 await page.screenshot({path:path.join(output,'04-known-pixels.png')});
 if ((await import('node:fs')).existsSync('build/fixtures/blender-zip.exr')) {
  await openFixture('blender-zip.exr');
  await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='blender-zip.exr' && document.querySelector('#busy').hidden,null,{timeout:60000});
  assert.equal(await page.locator('#error').isVisible(),false);

  assert.equal(await page.locator('#image-label').textContent(),'ViewLayer.Combined');
  await page.keyboard.press('a');
  assert.equal(await page.locator('.tile').count(),7);
  await page.locator('.tile').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('#grid .tile:last-child canvas').dataset.painted==='true');
  await page.screenshot({path:path.join(output,'05-blender-grid.png')});
  await page.keyboard.press('a');
  for (const codec of ['dwaa','dwab']) {
   await openFixture(`blender-${codec}.exr`);
   await page.waitForFunction(name=>document.querySelector('#file-name').textContent===name && document.querySelector('#busy').hidden && !document.querySelector('#viewer').hidden,`blender-${codec}.exr`,{timeout:60000});
   assert.equal(await page.locator('#error').isVisible(),false);
   await page.keyboard.press('a'); assert.equal(await page.locator('.tile').count(),7); await page.keyboard.press('a');
  }
  report.push('Blender ZIP/DWAA/DWAB: all 21 channels grouped into 7 views');
 }
 const visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());
 if(visible && process.env.OWLSIGHT_TEST_WINDOW_MANAGER === '1') {
  await page.locator('#pin').focus(); await page.keyboard.press('Space'); await page.waitForFunction(()=>document.querySelector('#pin').getAttribute('aria-pressed')==='true');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),true);
  await page.keyboard.press('Space'); await page.waitForFunction(()=>document.querySelector('#pin').getAttribute('aria-pressed')==='false');
  report.push('Visible native window pin toggles');
 } else report.push('OS pin check not included: enable OWLSIGHT_TEST_WINDOW_MANAGER=1 for separate native-window verification');
 report.push('Minimal UI has no sidebar or toolbar');
 assert.equal(await page.locator('aside,.toolbar').count(),0);
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,packaged?'packaged-results.json':'desktop-results.json'),JSON.stringify({executable,packaged,checks:report,colors,errors},null,2));
 console.log(JSON.stringify({packaged,checks:report,colors,errors},null,2));
} catch(error) { console.error('UI diagnostics',errors, await page.locator('#error-text').textContent(), await page.locator('#busy-text').textContent()); await page.screenshot({path:path.join(output,'failure.png')}); throw error; } finally { await app.close(); }

