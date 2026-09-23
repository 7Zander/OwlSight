import { createDecoder } from '../src/exr/native.cjs';
import { unpackFrame } from '../src/exr/frame.mjs';
import { inspectExr } from '../src/exr/header.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const decoder=createDecoder(path.resolve(process.env.OWLSIGHT_APP_ROOT || '.')), results=[];
for (const name of ['NO','RLE','ZIPS','ZIP','PIZ','PXR24','B44','B44A','DWAA','DWAB','HTJ2K32','HTJ2K256','TILED']) {
 const file=path.resolve(`build/fixtures/compression/${name}.exr`);
 inspectExr(await readFile(file));
 const decoded=await decoder.decode(file), frame=unpackFrame(new Uint8Array(decoded.bytes)), part=frame.parts[0];
 assert.equal(frame.parts.length,1); assert.equal(part.width,64); assert.equal(part.height,64);
 assert.deepEqual(part.channels,['A','B','G','ID','R','Z']);
 let sum=0;
 for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
  const i=(y*64+x)*6,p=part.pixels;
  assert.equal(p[i],1); assert.equal(p[i+3],y*64+x); assert.equal(p[i+5],y*64+x+.25);
  sum+=(p[i+4]-x/32)**2+(p[i+2]-y/64)**2+(p[i+1]-(x+y)/128)**2;
 }
 const rms=Math.sqrt(sum/(4096*3)); assert.ok(rms<.025,`${name}: RMS ${rms}`);
 results.push({format:name,rms,decodeMs:Math.round(decoded.decodeMs)});
}
let baseline;
for (const codec of ['zip','piz','dwaa','dwab']) {
 const result=await decoder.decode(path.resolve(`build/fixtures/blender-${codec}.exr`));
 const frame=unpackFrame(new Uint8Array(result.bytes));
 assert.equal(frame.parts.length,7); assert.equal(frame.parts.reduce((n,p)=>n+p.channels.length,0),21);
 assert.ok(frame.parts.every(p=>p.pixels.every(Number.isFinite)));
 if(!baseline) baseline=frame;
 let sum=0,count=0;
 frame.parts.forEach((part,i)=>{assert.deepEqual(part.channels,baseline.parts[i].channels);part.pixels.forEach((value,j)=>{sum+=(value-baseline.parts[i].pixels[j])**2;count++;});});
 const rms=Math.sqrt(sum/count); assert.ok(rms<.05,`${codec}: Blender RMS ${rms}`);
 results.push({format:`Blender ${codec}`,parts:7,channels:21,rms,decodeMs:Math.round(result.decodeMs)});
}
const known=unpackFrame(new Uint8Array((await decoder.decode(path.resolve('build/fixtures/known-origin.exr'))).bytes)).parts[0];
assert.deepEqual(known.dataWindow,{xMin:-3,yMin:7,xMax:-2,yMax:8});
assert.equal(known.pixels[known.channels.indexOf('R')],1);
assert.equal(known.pixels[3*known.channels.length+known.channels.indexOf('R')],2);
await assert.rejects(decoder.decode(path.resolve('build/fixtures/broken.exr')));
await writeFile('build/verification/compression-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
