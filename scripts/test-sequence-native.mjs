import assert from 'node:assert/strict';
import path from 'node:path';
import {createDecoder} from '../src/exr/native.cjs';
import {unpackFrame} from '../src/exr/frame.mjs';
const decoder=createDecoder(path.resolve('.'));
const dir=path.resolve('build/fixtures/sequence');
const rgb={partName:'',partIndex:0,channels:['R','G','B']};
try {
 const decoded=await decoder.decode(path.join(dir,'shot_v01_0001.exr'),rgb),frame=unpackFrame(decoded.bytes);
 assert.deepEqual([...frame.parts[0].pixels.slice(0,4)].map(v=>v===0?0:v),[1,0,0,1]);assert.equal(frame.sourceParts[0].channels.length,4);
 const large=await decoder.decode(path.join(dir,'large_0001.exr'),rgb),preview=unpackFrame(large.bytes);
 assert.equal(preview.parts[0].width,1024);assert.equal(preview.parts[0].height,576);assert.ok(large.bytes.length<10*1024**2);
 assert.equal(preview.sourceParts[0].width,3840);
 for (const number of [1,2]) {
   const result=unpackFrame((await decoder.decode(path.join(dir,`parts_000${number}.exr`),{partName:'data',partIndex:1,channels:['Z','Z','Z']})).bytes);
   assert.equal(result.parts[0].pixels[0],number/2);
 }
 await assert.rejects(decoder.decode(path.join(dir,'missing_0001.exr'),rgb),/缺少所选通道/);
 const old=decoder.decode(path.join(dir,'large_0001.exr'),rgb);const rejected=assert.rejects(old,/取消/);
 const latest=decoder.decode(path.join(dir,'shot_v01_0002.exr'),rgb);await rejected;
 assert.deepEqual([...unpackFrame((await latest).bytes).parts[0].pixels.slice(0,4)].map(v=>v===0?0:v),[0,1,0,1]);
 console.log(JSON.stringify({nativePreview:true,multipartReordering:true,missingChannelError:true,cancelRecovery:true,large:{source:'3840x2160 DWAB',preview:'1024x576',bytes:large.bytes.length,decodeMs:Math.round(large.decodeMs)}}));
} finally {decoder.cancel();}
