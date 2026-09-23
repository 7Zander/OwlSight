import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/input-profile-'+Date.now())}});
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/sequence/shot_v01_0001.exr'));
 await page.waitForSelector('#viewer:not([hidden])');await page.waitForSelector('#sequence-controls:not([hidden])');
 await page.waitForTimeout(500);
 assert.equal(await page.locator('#sequence-play svg').count(),1);assert.equal((await page.locator('#sequence-play').textContent()).trim(),'');
 const slider=await page.locator('#sequence-position').boundingBox();await page.mouse.click(slider.x+slider.width*.3,slider.y+slider.height/2);await page.waitForTimeout(150);
 assert.notEqual(await page.evaluate(()=>document.activeElement.id),'sequence-position');
 const loop=await page.locator('#sequence-loop').isChecked();await page.locator('#sequence-loop').focus();await page.keyboard.press('Space');
 assert.equal(await page.locator('#sequence-loop').isChecked(),loop);assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Space');assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'false');
 await page.locator('#stage').click({button:'right',position:{x:180,y:100}});assert.equal(await page.locator('#context-search').count(),0);
 const label=await page.locator('#image-label').textContent();await page.locator('#context-items button').first().focus();await page.keyboard.press('Space');assert.equal(await page.locator('#image-label').textContent(),label);await page.keyboard.press('Space');
 await page.locator('#stage').click({position:{x:600,y:10}});
 const stage=await page.locator('#stage').boundingBox();
 const current=()=>page.locator('#sequence-position').inputValue();
 const before=Number(await current());const direction=before>3?-1:1;
 await page.mouse.move(stage.x+stage.width*.5,stage.y+stage.height*.5);await page.mouse.down();await page.mouse.move(stage.x+stage.width*(.5+.4*direction),stage.y+stage.height*.5,{steps:6});await page.mouse.up();await page.waitForTimeout(300);
 assert.equal(Number(await current()),Math.max(0,Math.min(7,before+3*direction)));
 const index=await current();
 const pixels=()=>page.locator('#viewer').evaluate(c=>c.toDataURL());
 const image=await pixels();await page.keyboard.down('Alt');await page.mouse.move(stage.x+stage.width*.5,stage.y+stage.height*.5);await page.mouse.down();await page.mouse.move(stage.x+stage.width*.5+100,stage.y+stage.height*.5+70);await page.mouse.up();await page.keyboard.up('Alt');
 assert.equal(await current(),index);assert.notEqual(await pixels(),image);
 const panned=await pixels();await page.mouse.down({button:'middle'});await page.mouse.move(stage.x+stage.width*.5,stage.y+stage.height*.5);await page.mouse.up({button:'middle'});assert.equal(await current(),index);assert.notEqual(await pixels(),panned);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({packaged,spaceDoesNotActivateControls:true,mouseFocusReleased:true,viewportScrub:true,altAndMiddlePan:true,playPauseIcons:true,noSearch:true,errors}));
}finally{await app.close();}


