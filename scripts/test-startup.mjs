import { _electron as electron } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const pkg=JSON.parse(await readFile('build/latest-package.json','utf8'));
for(const relative of [false,true]) {
 const app=await electron.launch({executablePath:pkg.executable,args:[relative?'known-origin.exr':path.resolve('build/fixtures/known-origin.exr')],cwd:path.resolve('build/fixtures'),env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/startup-profile-'+Date.now())}});
 try {
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='known-origin.exr'&&document.querySelector('#busy').hidden&&!document.querySelector('#viewer').hidden,null,{timeout:60000});
  assert.equal(await page.locator('#error').isVisible(),false);
  await app.evaluate(({app},cwd)=>app.emit('second-instance',{},['OwlSight.exe','blender-dwab.exr'],cwd),path.resolve('build/fixtures'));
  await page.waitForFunction(()=>document.querySelector('#file-name').textContent==='blender-dwab.exr'&&document.querySelector('#busy').hidden&&!document.querySelector('#viewer').hidden,null,{timeout:60000});
  console.log(`Packaged EXE ${relative?'relative':'absolute'} startup and second-instance relative DWAB: PASS`);
 } finally {await app.close();}
}
