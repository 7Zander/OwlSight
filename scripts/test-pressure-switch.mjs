import {_electron as electron} from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/pressure-switch-profile-'+Date.now())}});
try{
 const page=await app.firstWindow();await page.waitForSelector('#demo');
 await app.evaluate(({ipcMain})=>{
  const read=ipcMain._invokeHandlers.get('sequence-frame');global.__baseLayer=null;
  ipcMain.removeHandler('sequence-frame');ipcMain.handle('sequence-frame',async(...args)=>{
   global.__baseLayer??=args[3].partName;const result=await read(...args);
   if(args[3].partName!==global.__baseLayer)await new Promise(r=>setTimeout(r,600));return result;
  });
  ipcMain.removeHandler('cache-preference');ipcMain.handle('cache-preference',()=>({preference:'0.5',budget:1,adjusted:true}));
 });
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/layer-switch/switch_0000.exr'));
 await page.waitForFunction(()=>Number(document.querySelector('#sequence-cache').dataset.cachedCount)===48);
 await page.click('#sequence-play');await page.keyboard.press('s');
 await page.waitForFunction(()=>document.querySelector('#image-label').textContent.includes('切换中')&&Number(document.querySelector('#sequence-cache').dataset.cachedCount)>0);
 await page.locator('#cache-budget').evaluate(select=>{select.value='0.5';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForSelector('#error:not([hidden])');
 assert.match(await page.locator('#error-text').textContent(),/单帧超过序列缓存预算/);
 assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'false');
 await page.waitForTimeout(800);assert.equal(await page.locator('#sequence-play').getAttribute('aria-pressed'),'false');
 console.log(JSON.stringify({packaged:!!process.env.OWLSIGHT_EXE,oversizedTargetAfterShrinkStops:true,actionableWarning:true}));
}finally{await app.close();}
