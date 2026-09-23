// SPDX-License-Identifier: GPL-3.0-or-later
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const executablePath=process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe');
const profile=path.resolve('build/ocio-profile-'+Date.now());
const runtime=process.env.OWLSIGHT_EXE?path.join(path.dirname(executablePath),'resources/app/resources/decoder'):path.resolve('resources/decoder');
const samples=JSON.parse(await readFile('build/fixtures/ocio/samples.json','utf8'));
const launch=()=>electron.launch({executablePath,args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:profile}});
let app=await launch();const cases=[];
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#demo');
 await app.evaluate(({ipcMain})=>{global.__colorReads=0;global.__colorDescriptor=null;for(const name of ['preview-exr','sequence-frame']){const handler=ipcMain._invokeHandlers.get(name);ipcMain.removeHandler(name);ipcMain.handle(name,(...args)=>{const descriptor=JSON.stringify(args[name==='preview-exr'?2:3]);global.__colorDescriptor??=descriptor;if(descriptor===global.__colorDescriptor)global.__colorReads++;return handler(...args);});}});
 await app.evaluate(({app},file)=>app.emit('second-instance',{},['OwlSight.exe',file]),path.resolve('build/fixtures/ocio/colors.exr'));
 await page.waitForSelector('#viewer:not([hidden])');
 await page.locator('#stage').click({button:'right',position:{x:120,y:120}});await page.click('#tab-display');
 await page.selectOption('#display-mode','ocio');
 const ready=()=>page.waitForFunction(()=>document.querySelector('#ocio-message').textContent.startsWith('OCIO GPU'),null,{timeout:30000});
 await ready();
 const startReads=await app.evaluate(()=>global.__colorReads);
 const pixels=()=>page.locator('#viewer').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),scale=Math.min(canvas.width/8,canvas.height/2);return Array.from({length:8},(_,i)=>{const p=new Uint8Array(4);gl.readPixels(Math.floor((canvas.width-8*scale)/2+(i+.5)*scale),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];});});
 async function compare(name,source){
  const selected=await page.evaluate(()=>{const get=id=>document.getElementById(id).value,look=get('ocio-look');return {input:get('ocio-input'),display:get('ocio-display'),view:get('ocio-view'),lookMode:look.startsWith('look:')?'override':look,look:look.startsWith('look:')?document.querySelector('#ocio-look option:checked').textContent:'',exposure:Number(get('exposure'))};});
  const output=execFileSync(path.join(runtime,'owlsight-decoder.exe'),['-I','-B','-X','utf8',path.join(runtime,'ocio_service.py')],{input:JSON.stringify({action:'reference',source,...selected,samples})+'\n',encoding:'utf8',windowsHide:true});
  const reference=JSON.parse(output);assert.equal(reference.ok,true,reference.error);
  const actual=await pixels();let error=0;
  actual.forEach((pixel,i)=>pixel.slice(0,3).forEach((v,c)=>{error=Math.max(error,Math.abs(v-Math.round(Math.max(0,Math.min(1,reference.result[i][c]))*255)));}));
  assert.ok(error<=2,`${name}: GPU/CPU mismatch ${error}`);cases.push({name,maxByteError:error});return actual;
 }
 await compare('built-in ACES','builtin');
 async function load(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.click('#ocio-open');}
 await page.selectOption('#ocio-input','Raw');await ready();
 await page.locator('#exposure').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
 const rawInput=await compare('data input bypass including exposure','builtin');
 rawInput.forEach((pixel,i)=>pixel.slice(0,3).forEach((v,c)=>assert.ok(Math.abs(v-Math.round(Math.max(0,Math.min(1,samples[i][c]))*255))<=1)));
 await page.locator('#exposure').evaluate(input=>{input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));});
 const custom=path.resolve('build/fixtures/ocio/test.ocio');await load(custom);await ready();
 await compare('external 1D + 3D LUT',custom);
 await page.selectOption('#ocio-input','Encoded');await ready();
 await page.locator('#exposure').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await compare('nonlinear input, exposure in scene-linear',custom);
 await page.selectOption('#ocio-look','look:0');await ready();const validPixels=await compare('Look override',custom);
 await page.selectOption('#ocio-view','Missing LUT');await page.waitForFunction(()=>document.querySelector('#ocio-message').textContent.includes('未更新'));
 assert.equal(await page.locator('#ocio-view').inputValue(),'LUT');assert.deepEqual(await pixels(),validPixels);
 await load(path.resolve('build/fixtures/ocio/bad.ocio'));await page.waitForFunction(()=>document.querySelector('#ocio-message').textContent.includes('未更新'));
 assert.deepEqual(await pixels(),validPixels);assert.equal(await page.locator('#error').isVisible(),false);
 for(let i=0;i<9;i++){await load(path.resolve('build/fixtures/ocio/missing-lut.ocio'));await page.waitForFunction(()=>document.querySelector('#ocio-message').textContent.includes('未更新'));}
 assert.deepEqual(await pixels(),validPixels);
 await page.selectOption('#ocio-view','Direct');await ready();await compare('active config survives repeated failed candidates',custom);
 await page.selectOption('#ocio-view','LUT');await ready();assert.deepEqual(await pixels(),validPixels);

 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 await page.evaluate(()=>{const input=document.querySelector('#ocio-input');input.value='Linear';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#ocio-open').click();});
 await page.waitForFunction(()=>document.querySelector('#ocio-message').textContent==='保留当前 OCIO 配置');
 assert.equal(await page.locator('#ocio-input').inputValue(),'Encoded');assert.deepEqual(await pixels(),validPixels);
 assert.equal(await app.evaluate(()=>global.__colorReads),startReads,'Color changes must not decode the displayed layer again (independent idle layers excluded)');
 await page.click('#tab-channels');
 await page.locator('[data-menu-view]').filter({hasText:/^Z$/}).click();await page.waitForFunction(()=>document.querySelector('#image-label').textContent==='Z');
 assert.ok((await pixels()).every(p=>p[0]===64&&p[1]===64&&p[2]===64));
 await page.locator('[data-menu-view="0"]').click();await page.waitForFunction(()=>document.querySelector('#image-label').textContent==='RGB');
 await page.click('[data-component="R"]');await page.waitForFunction(()=>document.querySelector('#image-label').textContent.endsWith(' · R'));
 const raw=await pixels();raw.forEach((p,i)=>{const expected=Math.round(Math.max(0,Math.min(1,samples[i][0]))*255);assert.ok(Math.abs(p[0]-expected)<=1);assert.equal(p[0],p[1]);assert.equal(p[1],p[2]);});
 await page.click('[data-component="RGBA"]');await page.waitForFunction(()=>document.querySelector('#image-label').textContent==='RGB');
 if(process.env.OWLSIGHT_TEST_OCIO){await page.click('#tab-display');await load(process.env.OWLSIGHT_TEST_OCIO);await ready();await page.selectOption('#ocio-view','AgX');await ready();await compare('Blender AgX',process.env.OWLSIGHT_TEST_OCIO);await load(custom);await ready();await page.selectOption('#ocio-input','Encoded');await ready();}
 await app.close();app=await launch();const restored=await app.firstWindow();
 await restored.waitForFunction(()=>document.querySelector('#ocio-message').textContent.startsWith('OCIO GPU'),null,{timeout:30000});
 assert.equal(await restored.locator('#display-mode').inputValue(),'ocio');assert.equal(await restored.locator('#ocio-input').inputValue(),'Encoded');
 assert.deepEqual(errors,[]);
 const report={packaged:!!process.env.OWLSIGHT_EXE,cases,missingLutPreservesImage:true,badConfigPreservesImage:true,dataBypass:true,componentBypass:true,colorChangeCurrentLayerAdditionalReads:0,settingsRestored:true,repeatedFailuresPreserveActive:true,errors};
 console.log(JSON.stringify(report));await writeFile('build/verification/ocio-'+(process.env.OWLSIGHT_EXE?'packaged':'development')+'.json',JSON.stringify(report,null,2));
}finally{await app.close();}
