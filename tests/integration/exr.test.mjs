import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init, encodeExr } from 'exrs';
import { initializeDecoder, decodeFrame } from '../../src/exr/decode.mjs';
import { inspectExr } from '../../src/exr/header.mjs';
import { writeFixture } from '../fixtures/write-exr.mjs';
initializeDecoder(await readFile(new URL('../../node_modules/exrs/node_modules/exrs-raw-wasm-bindgen/exrs_raw_wasm_bindgen_bg.wasm',import.meta.url)));

test('independent scanline EXR preserves orientation, negative origin and HDR values',()=>{
  const bytes=writeFixture({width:2,height:2,origin:[-3,7],channels:{R:[1,0,0,2],G:[0,1,0,.25],B:[0,0,1,.5],A:[0,.5,1,1],Z:[10,20,30,40]}});
  const {parts}=decodeFrame(bytes);
  assert.deepEqual(parts[0].dataWindow,{xMin:-3,yMin:7,xMax:-2,yMax:8});
  assert.deepEqual(parts[0].channels,['A','B','G','R','Z']);
  assert.deepEqual([...parts[0].pixels],[0,0,0,1,10,.5,0,1,0,20,1,1,0,0,30,1,.5,.25,2,40]);
});

test('compressed multipart files keep all layer names, XYZ and depth channels',async()=>{
  await init();
  for(const compression of ['none','rle','zip','zip16','piz','pxr24']) {
    const bytes=encodeExr({width:2,height:1,layers:[{name:'Beauty',channelNames:['R','G','B'],interleavedPixels:new Float32Array([1,0,0,0,1,0]),compression},{name:'Depth',channelNames:['Z'],interleavedPixels:new Float32Array([12,24]),compression}]});
    const frame=decodeFrame(bytes);
    assert.equal(frame.parts.length,2,compression);
    assert.equal(frame.parts[1].name,'Depth');
    assert.deepEqual([...frame.parts[1].pixels],[12,24]);
  }
});

test('rejects corrupt headers and excessive declared allocations before decoding',()=>{
  assert.throws(()=>decodeFrame(new Uint8Array([1,2,3])),/不完整/);
  const bytes=writeFixture({width:1,height:1,channels:{R:[1]}});
  const marker=Buffer.from('dataWindow\0box2i\0'); const start=bytes.indexOf(marker)+marker.length+4;
  bytes.writeInt32LE(2147483647,start+8);
  assert.throws(()=>inspectExr(bytes),/尺寸超过/);
});
