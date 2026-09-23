import {createDecoder} from '../src/exr/native.cjs';
import {unpackFrame} from '../src/exr/frame.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
const decoder=createDecoder(path.resolve(process.env.OWLSIGHT_APP_ROOT || '.'));
const names=process.argv.includes('--large')?['at-budget']:['channels-1','channels-4','channels-17','channels-64','channels-256'];
for(const name of names){
 const decoded=await decoder.decode(path.resolve('build/fixtures/boundaries',name+'.exr'));
 // Keep the already aligned buffer; do not copy a GiB just for the test.
 const frame=unpackFrame(decoded.bytes),p=frame.parts[0],count=name==='at-budget'?256:Number(name.split('-')[1]);
 assert.equal(p.channels.length,count);
 for(let c=0;c<count;c++){assert.equal(p.pixels[c],c/256);assert.equal(p.pixels[p.pixels.length-count+c],c/256);}
 if(name==='at-budget') assert.equal(p.pixels.byteLength,1024**3);
 console.log(JSON.stringify({name,channels:count,pixelMiB:p.pixels.byteLength/1024**2,passed:true}));
}
