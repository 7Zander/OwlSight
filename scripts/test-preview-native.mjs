import assert from 'node:assert/strict';
import path from 'node:path';
import {createPreviewDecoder} from '../src/exr/preview.cjs';
import {createDecoder} from '../src/exr/native.cjs';
import {unpackFrame} from '../src/exr/frame.mjs';
import {createLayerViews} from '../src/core/views.mjs';
import {describeView} from '../src/core/sequence.mjs';
const root=path.resolve(process.env.OWLSIGHT_APP_ROOT||'.'),fast=createPreviewDecoder(root),reference=createDecoder(root);
const half = h => {const sign=h&32768?-1:1, exp=(h>>10)&31, frac=h&1023;return exp===31?frac?NaN:sign*Infinity:sign*(exp?2**(exp-15)*(1+frac/1024):2**-14*frac/1024);};
function value(part,i){return part.pixels instanceof Uint16Array?half(part.pixels[i]):part.pixels[i];}
try {
 const results=[];
 for(const name of ['NO','RLE','ZIPS','ZIP','PIZ','PXR24','B44','B44A','DWAA','DWAB','HTJ2K32','HTJ2K256','TILED']){
  const file=path.resolve(`build/fixtures/compression/${name}.exr`),original=unpackFrame((await reference.decode(file)).bytes),layers=createLayerViews(original.parts);
  for(const view of [layers[0],layers.at(-1)]){
   const result=await fast.decode(file,describeView(original.parts,view),2).catch(error=>{throw new Error(name+': '+error.message);}),p=unpackFrame(result.bytes).parts[0],source=original.parts[view.part];
   assert.equal(p.width,32);assert.equal(p.height,32);
   let max=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)for(let c=0;c<3;c++){const expected=source.pixels[((y*2)*64+x*2)*source.channels.length+view.components[c]];max=Math.max(max,Math.abs(value(p,(y*32+x)*4+c)-expected));}
   assert.ok(max<.03,`${name} ${view.label}: max error ${max}`);
  }
  results.push(name);
 }
 const f=path.resolve('build/fixtures/sequence/shot_v01_0001.exr'),desc={partName:'',partIndex:0,channels:['R','G','B']};
 for(const divisor of [1,2,4,8]){const p=unpackFrame((await fast.decode(f,desc,divisor)).bytes).parts[0];assert.equal(p.pixelType,'half');assert.equal(p.width,64/divisor);assert.equal(p.height,48/divisor);assert.equal(value(p,0),1);}
 for(const n of [1,2]){const p=unpackFrame((await fast.decode(path.resolve(`build/fixtures/sequence/parts_000${n}.exr`),{partName:'data',partIndex:1,channels:['Z','Z','Z']})).bytes).parts[0];assert.equal(p.pixelType,'float');assert.equal(value(p,0),n/2);}
 await assert.rejects(fast.decode(path.resolve('build/fixtures/sequence/missing_0001.exr'),desc),/缺少所选通道/);
 await assert.rejects(fast.decode(path.resolve('build/fixtures/不存在.exr'),desc));
 const request=fast.decode(path.resolve('build/fixtures/sequence/large_0001.exr'),desc),cancelled=assert.rejects(request,/取消/);fast.cancel();await cancelled;
 assert.equal(unpackFrame((await fast.decode(f,desc)).bytes).parts[0].width,64);
 console.log(JSON.stringify({codecs:results,sourcePixelAgreement:true,halfAndFloatPreserved:true,resolutionRatios:true,partReordering:true,cancelRecovery:true}));
} finally {fast.dispose();reference.cancel();}
