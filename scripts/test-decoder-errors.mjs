import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {createDecoder} from '../src/exr/native.cjs';
import assert from 'node:assert/strict';
import path from 'node:path';
await mkdir('build/fixtures',{recursive:true});
const decoder=createDecoder(path.resolve(process.env.OWLSIGHT_APP_ROOT || '.'));
function windows(bytes,width,height) {
 for(const name of ['dataWindow','displayWindow']) {
  const key=Buffer.from(name+'\0box2i\0');const at=bytes.indexOf(key);
  assert.ok(at>=0);const offset=at+key.length+4;
  bytes.writeInt32LE(bytes.readInt32LE(offset)+width-1,offset+8);
  bytes.writeInt32LE(bytes.readInt32LE(offset+4)+height-1,offset+12);
 }
 return bytes;
}
const file=path.resolve('build/fixtures/oversize-chinese-error.exr');
await writeFile(file,windows(Buffer.from(await readFile('build/fixtures/known-origin.exr')),20000,2));
await assert.rejects(decoder.decode(file),error=>{assert.equal(error.message,'EXR 尺寸超过读取上限。');return true;});
const budgetFile=path.resolve('build/fixtures/over-budget.exr');
await writeFile(budgetFile,windows(Buffer.from(await readFile('resources/demo.exr')),8192,4096));
await assert.rejects(decoder.decode(budgetFile),error=>{assert.match(error.message,/超过当前 1024 MiB 上限/);assert.ok(!error.message.includes('\uFFFD'));console.log(error.message);return true;});
const truncated=path.resolve('build/fixtures/truncated.exr');await writeFile(truncated,(await readFile('resources/demo.exr')).subarray(0,500));
await assert.rejects(decoder.decode(truncated));
await assert.rejects(decoder.decode(path.resolve('build/fixtures/不存在的文件.exr')),error=>{assert.ok(!error.message.includes('\uFFFD'));return true;});
// Failure must not poison the next valid decode.
assert.ok((await decoder.decode(path.resolve('resources/demo.exr'))).bytes.length>0);
console.log('Chinese error, >budget, truncation, Unicode missing path and recovery: PASS');
