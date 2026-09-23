import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const packaged=!!process.env.OWLSIGHT_EXE;
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/sequence-profile-'+Date.now())}});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function open(name) { await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve(name)); }
 async function ready() { await page.waitForSelector('#viewer:not([hidden])');await page.waitForSelector('#busy[hidden]',{state:'attached'}); }
 async function full(number) { await page.waitForFunction(n=>document.querySelector('#sequence-play').getAttribute('aria-pressed')==='false' && document.querySelector('#sequence-frame').textContent.startsWith(n+' /'),number);await ready(); }
 async function pixel() {return page.locator('#viewer').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),p=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});}
 await open('build/fixtures/sequence/shot_v01_0001.exr');await ready();await page.waitForSelector('#sequence-controls:not([hidden])');
 assert.equal(await page.locator('#sequence-position').getAttribute('max'),'7');assert.match(await page.locator('#sequence-status').textContent(),/缺 1 帧/);
 assert.deepEqual(await pixel(),[255,0,0,255]);
 await page.keyboard.press('ArrowRight');await full(2);assert.deepEqual(await pixel(),[0,255,0,255]);
 await page.keyboard.press('ArrowLeft');await full(1);
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await full(5);
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await full(1);
 await page.keyboard.press('Space');
 await page.waitForFunction(()=>document.querySelector('#sequence-play').getAttribute('aria-pressed')==='true' && !document.querySelector('#file-name').textContent.endsWith('0001.exr'));
 await page.waitForFunction(()=>/MiB · 8\/8 帧/.test(document.querySelector('#sequence-status').textContent),null,{timeout:20000});
 await page.waitForFunction(()=>{const match=document.querySelector('#sequence-status').textContent.match(/([\d.]+) fps/);return match && Number(match[1])>=19 && document.querySelector('#sequence-status').textContent.includes('· 8/8 帧');},null,{timeout:20000});
 const warmed=await page.locator('#sequence-status').textContent();
 await page.screenshot({path:'build/verification/sequence-playback.png'});
 await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#sequence-play').getAttribute('aria-pressed')==='false');await ready();
 const paused=await page.locator('#file-name').textContent();await page.waitForTimeout(300);assert.equal(await page.locator('#file-name').textContent(),paused);
 // Scrub bursts: only the final target may win; keep both label and actual pixels in sync.
 await page.locator('#sequence-position').evaluate(input=>{for(const value of [2,6,0,7]){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}});
 await full(9);assert.deepEqual(await pixel(),[0,0,255,255]);
 await page.uncheck('#sequence-loop');await page.selectOption('#sequence-fps','12');await page.click('#sequence-play');
 await page.waitForFunction(()=>document.querySelector('#sequence-play').getAttribute('aria-pressed')==='false');await full(9);
 await page.locator('#stage').click({position:{x:100,y:100}});await page.keyboard.press('a');await page.waitForSelector('#grid:not([hidden])');assert.equal(await page.locator('.tile').count(),1);await page.keyboard.press('a');
 // Ratios change real textures; pause does not silently reload all channels.
 for(const [ratio,size] of [['1','64 × 48'],['2','32 × 24'],['4','16 × 12']]){
  await page.selectOption('#sequence-resolution',ratio);await page.waitForFunction(size=>document.querySelector('#viewer').title==='预览 '+size && !document.querySelector('#viewer').hidden,size);
 }
 await page.locator('#stage').click({button:'right',position:{x:120,y:120}});await page.click('[data-component="R"]');
 await page.locator('#stage').click({position:{x:550,y:20}});await page.check('#sequence-loop');await page.click('#sequence-play');
 await page.waitForFunction(()=>document.querySelector('#sequence-play').getAttribute('aria-pressed')==='true');
 await page.click('#sequence-play');assert.equal(await page.locator('#busy').isVisible(),false);
 await page.click('#sequence-play');await page.waitForSelector('#viewer:not([hidden])');await page.click('#sequence-play');
 assert.match(await page.locator('#image-label').textContent(),/· R$/);assert.equal(await page.locator('#error').isVisible(),false);
 await open('build/fixtures/sequence/parts_0001.exr');await ready();await page.waitForSelector('#sequence-controls:not([hidden])');
 await page.keyboard.press('s');await page.waitForFunction(()=>document.querySelector('#image-label').textContent.includes('Z'));await ready();
 await page.keyboard.press('ArrowRight');await full(2);assert.match(await page.locator('#image-label').textContent(),/Z/);assert.deepEqual(await pixel(),[255,255,255,255]);
 // Switching to a single image while sequence work is outstanding cancels the old session.
 await page.click('#sequence-play');await open('resources/demo.exr');await ready();
 await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='demo.exr');assert.equal(await page.locator('#sequence-controls').isVisible(),false);
 await page.waitForTimeout(500);assert.equal(await page.locator('#file-name').textContent(),'demo.exr');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged,discovery:true,stepPixels:true,playPause:true,warmed,seekLatestWins:true,loopOff:true,gridAfterPause:true,reorderedParts:true,resolutionTextures:true,pauseDoesNotReload:true,quickRestartPreservesComponent:true,openCancelsPlayback:true,errors}));
} finally {await app.close();}
