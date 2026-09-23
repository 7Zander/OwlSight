import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {frameName,discover} from '../../src/app/sequence.cjs';
import {FrameCache,clockFrame,describeView,findView} from '../../src/core/sequence.mjs';
import {createLayerViews} from '../../src/core/views.mjs';
test('sequence discovery separates versions and padding; sorts signed frames and preserves gaps',async()=>{
 await mkdir('build/tests',{recursive:true});const dir=await mkdtemp(path.resolve('build/tests/sequence-'));
 for(const name of ['shot_v01_0001.exr','shot_v01_0003.exr','shot_v01_-001.exr','shot_v02_0002.exr','shot_v01_00002.exr','shot_v01_0004.png']) await writeFile(path.join(dir,name),'fixture');
 const result=await discover(path.join(dir,'shot_v01_0001.exr'));
 assert.deepEqual(result.frames.map(f=>f.number),[-1,1,3]); assert.equal(result.gaps,2); assert.equal(result.index,1);
 assert.equal(await discover(path.join(dir,'shot_v02_0002.exr')),null);
 assert.equal(await discover(path.join(dir,'shot_v01_0001.exr'),()=>false),null);
 assert.equal(frameName('shot_v001.exr'),null); assert.equal(frameName('shot-0001.exr').number,1);
});
test('cache enforces both decoded bytes and frame count; recently used frames survive eviction',()=>{
 const cache=new FrameCache(100,2);
 cache.put('a',{cost:40});cache.put('b',{cost:40});cache.get('a');cache.put('c',{cost:40});
 assert.equal(cache.get('b'),undefined);assert.equal(cache.bytes,80);
 cache.put('d',{cost:90});assert.equal(cache.bytes,90);assert.equal(cache.entries.size,1);
 cache.put('huge',{cost:101});assert.equal(cache.get('huge'),undefined);
 cache.clear();assert.equal(cache.bytes,0);
});
test('playback clock advances by elapsed time, holds gaps, loops and ends without catch-up queues',()=>{
 const frames=[{number:-1},{number:1},{number:3}];
 assert.deepEqual(clockFrame(frames,-1,100,10),{index:0,ended:false});
 assert.deepEqual(clockFrame(frames,-1,250,10),{index:1,ended:false});
 assert.deepEqual(clockFrame(frames,-1,500,10),{index:0,ended:false});
 assert.deepEqual(clockFrame(frames,-1,90000,24,false),{index:2,ended:true});
});
test('channel identity survives reordered parts and refuses missing channels',()=>{
 const parts=[{name:'beauty',channels:['B','G','R']},{name:'depth',channels:['Z']}];
 const views=createLayerViews(parts),descriptor=describeView(parts,views[1]);
 const reordered=[parts[1],parts[0]],next=createLayerViews(reordered);
 const selected=findView(reordered,next,descriptor);assert.equal(next[selected].part,0);
 assert.equal(findView([parts[0]],createLayerViews([parts[0]]),descriptor),-1);
});

test('unpadded frame numbers form one sequence across digit boundaries',async()=>{
 const dir=await mkdtemp(path.resolve('build/tests/unpadded-'));
 for(const name of ['plate.1.exr','plate.2.exr','plate.10.exr','plate.01.exr'])await writeFile(path.join(dir,name),'fixture');
 const result=await discover(path.join(dir,'plate.1.exr'));
 assert.deepEqual(result.frames.map(f=>f.number),[1,2,10]);
});


test('padded discovery crosses 0999 to 1000 from either side without including other padding',async()=>{
 const dir=await mkdtemp(path.resolve('build/tests/padded-rollover-'));
 for(const name of ['plate.0999.exr','plate.1000.exr','plate.1001.exr','plate.01000.exr'])await writeFile(path.join(dir,name),'fixture');
 for(const name of ['plate.0999.exr','plate.1000.exr']) {
  const result=await discover(path.join(dir,name));assert.deepEqual(result.frames.map(f=>f.number),[999,1000,1001]);
 }
});
