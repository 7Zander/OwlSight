import {createPreviewPool} from '../src/exr/preview-pool.cjs';
import assert from 'node:assert/strict';
import path from 'node:path';
const pool=createPreviewPool(path.resolve('.'));
try{
 const files=['build/fixtures/sequence/parts_0001.exr','build/fixtures/sequence/parts_0002.exr','resources/demo.exr'];
 const responses=await Promise.all(files.map(f=>pool.decode(path.resolve(f))));assert.equal(responses.length,3);for(const result of responses)assert.ok(result.bytes.byteLength>4);
 const cancelled=pool.decode(path.resolve('build/fixtures/sequence/large_0001.exr'),{partName:'',partIndex:0,channels:['R','G','B']},2);cancelled.catch(()=>{});pool.cancel();await assert.rejects(cancelled,/取消/);
 const next=await pool.decode(path.resolve('resources/demo.exr'));assert.ok(next.bytes.byteLength>4);
 await assert.rejects(pool.decode(path.resolve('build/fixtures/broken.exr')));
 assert.ok((await pool.decode(path.resolve(files[0]))).bytes.byteLength>4);
 console.log('Preview pool: parallel reads, cancellation and error recovery PASS');
}finally{pool.dispose();}
