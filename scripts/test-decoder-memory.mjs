import {createDecoder} from '../src/exr/native.cjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
if(typeof global.gc!=='function') throw new Error('Run with node --expose-gc.');
const decoder=createDecoder(path.resolve('.'));
const before=process.memoryUsage().arrayBuffers;
async function read() { const result=await decoder.decode(path.resolve('build/fixtures/sequence/large_0001.exr'));return result.bytes.length; }
const decodedBytes=await read();
for(let i=0;i<6;i++){await setImmediate();global.gc();}
const retained=Math.max(0,process.memoryUsage().arrayBuffers-before);
assert.ok(retained<16*1024**2,`Decoder retained ${retained} bytes after delivery`);
console.log(JSON.stringify({fullFrameBytes:decodedBytes,retainedArrayBufferBytes:retained,queueRetainsNoFullFrame:true}));
decoder.cancel();
