import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/gpu-cache-profile-'+Date.now())}});
try {
 const page=await app.firstWindow();await page.waitForSelector('#demo');
 const result=await page.evaluate(async()=>{
  const {GpuViewer}=await import('/src/render/viewer.mjs');
  const canvas=document.createElement('canvas'), width=3840,height=2160,cost=width*height*8;
  const viewer=new GpuViewer(canvas,{cacheBytes:cost*2,cacheFrames:2});
  const image=axis=>{
   const rgba=new Uint16Array(width*height*4);
   for(let i=0;i<rgba.length;i+=4){rgba[i+axis]=0x3800;rgba[i+3]=0x3c00;}
   return {width,height,rgba,range:[0,1]};
  };
  const red=image(0),green=image(1),blue=image(2),gl=viewer.gl;
  const draw=()=>{viewer.draw({width:64,height:64,mode:0});const p=new Uint8Array(4);gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};
  try{
   viewer.upload(red);const first=draw();
   viewer.prepare([green]);const afterPrepare=draw(),uploadsBefore=viewer.stats.uploads;
   viewer.upload(green);const second=draw(),uploadsAfter=viewer.stats.uploads;
   viewer.upload(red);const reused=draw();
   viewer.prepare([blue]);const stillRed=draw();
   viewer.upload(blue);const third=draw();
   const residentBytes=viewer.residentBytes,frames=viewer.resident.size,stats={...viewer.stats};
   viewer.clearImages();const cleared=viewer.residentBytes===0&&viewer.resident.size===0&&viewer.size===null;
   return {first,afterPrepare,second,reused,stillRed,third,uploadsBefore,uploadsAfter,residentBytes,budget:cost*2,frames,cleared,stats,error:gl.getError()};
  }finally{viewer.dispose();}
 });
 const pixel=(actual,expected)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<=1,`pixel ${actual} vs ${expected}`));
 pixel(result.first,[128,0,0,255]);assert.deepEqual(result.afterPrepare,result.first);
 pixel(result.second,[0,128,0,255]);assert.equal(result.uploadsBefore,result.uploadsAfter,'prepared frame must display without another upload');
 assert.deepEqual(result.reused,result.first);assert.deepEqual(result.stillRed,result.first);
 pixel(result.third,[0,0,128,255]);assert.ok(result.residentBytes<=result.budget);assert.ok(result.frames<=2);assert.ok(result.cleared);assert.equal(result.error,0);
 await mkdir('build/verification',{recursive:true});await writeFile('build/verification/gpu-cache.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.close();}
