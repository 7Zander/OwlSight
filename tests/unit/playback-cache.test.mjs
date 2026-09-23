import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackCache,frameWindow} from '../../src/core/playback-cache.mjs';

test('directional window favors upcoming frames, shrinks history and respects edges',()=>{
 assert.deepEqual(frameWindow(100,20,8,24),[20,21,22,23,19,24,25,26]);
 assert.deepEqual(frameWindow(100,20,3,24),[20,21,22]);
 assert.deepEqual(frameWindow(10,9,4,24,false),[9,8,7,6]);
 assert.deepEqual(frameWindow(10,9,4,24,true),[9,0,1,2]);
 assert.equal(new Set(frameWindow(8,3,20,24)).size,8);
});
const options={count:100,position:20,fps:24};
test('shared byte budget retains two short recent contexts and accounts for their own sizes',()=>{
 const c=new PlaybackCache(1000,100);
 for(const [key,cost] of [['a',10],['b',50],['c',100]]){
  c.activate(key);c.costs.set(key,cost);for(const i of c.plan(options))c.put(key+':'+i,{cost});
  assert.ok(c.bytes<=1000);
 }
 assert.equal(c.contexts.length,3);
 assert.ok([...c.entries.keys()].some(k=>k.startsWith('a:')));
 assert.ok([...c.entries.keys()].some(k=>k.startsWith('b:')));
 assert.ok(c.entries.has('c:20'));assert.ok(c.entries.has('c:21'));
 c.activate('d');c.costs.set('d',40);for(const i of c.plan(options))c.put('d:'+i,{cost:40});
 assert.ok(![...c.entries.keys()].some(k=>k.startsWith('a:')));
});
test('moving or seeking replaces remote frames without cycling through the whole sequence',()=>{
 const c=new PlaybackCache(800,100);c.activate('a');c.costs.set('a',100);
 for(const i of c.plan(options))c.put('a:'+i,{cost:100});
 const next=c.plan({...options,position:70});assert.equal(next[0],70);assert.equal(c.entries.size,8);
 for(const i of next)c.put('a:'+i,{cost:100});
 assert.equal(c.bytes,800);assert.deepEqual(c.plan({...options,position:70}),next);
 c.put('a:1',{cost:100});assert.equal(c.entries.has('a:1'),false);
});
test('mixed actual frame sizes never exceed memory and foreground beats history on eviction',()=>{
 const c=new PlaybackCache(500,100);c.activate('a');c.costs.set('a',100);c.plan(options);
 c.put('a:19',{cost:100});c.put('a:20',{cost:250});c.put('a:21',{cost:250});
 assert.equal(c.bytes,500);assert.ok(c.entries.has('a:20'));assert.ok(c.entries.has('a:21'));
 assert.ok(!c.entries.has('a:19'));
});
test('oversized frame is not retained and clearing resets estimates',()=>{
 const c=new PlaybackCache(50,10);c.activate('a');c.plan(options);c.put('a:20',{cost:100});
 assert.equal(c.bytes,0);c.clear();assert.equal(c.costs.size,0);assert.equal(c.contexts.length,0);
});

test('tiny switch budget reserves a bounded bridge and leaves room for the target runway',()=>{
 const c=new PlaybackCache(1200,100);c.activate('old');c.observe('old',100);
 for(const i of c.plan(options))c.put('old:'+i,{cost:100});
 c.activate('new');c.observe('new',100);
 const indices=c.plan({...options,bridge:'old'});
 assert.equal(indices.length,8);
 for(const i of [20,21,22,23])assert.ok(c.entries.has('old:'+i));
 for(const i of indices)c.put('new:'+i,{cost:100});
 assert.equal(c.bytes,1200);
});

test('full active sequence wins over recent reservation, and empty recent entries cost nothing',()=>{
 const c=new PlaybackCache(800,100);c.activate('old');c.observe('old',100);c.activate('new');c.observe('new',100);
 assert.equal(c.plan({...options,count:8,position:0}).length,8);
 assert.equal(c.windowSize,8);
});
test('unequal layer sizes expose actual target capacity during transition',()=>{
 const c=new PlaybackCache(400,100);c.activate('old');c.observe('old',100);c.activate('new');c.observe('new',150);
 assert.equal(c.plan({...options,bridge:'old'}).length,2);
 assert.equal(c.windowSize,2);
});

test('bridge yields its reservation when the target needs nearly all memory',()=>{
 const c=new PlaybackCache(400,100);c.activate('old');c.observe('old',100);c.activate('new');c.observe('new',350);
 assert.deepEqual(c.plan({...options,bridge:'old'}),[20]);
 c.put('new:20',{cost:350});assert.equal(c.bytes,350);assert.ok(c.get('new:20'));
});

test('switching keeps the entire playing layer while memory is available',()=>{
 const c=new PlaybackCache(4000,200);c.activate('old');c.observe('old',10);
 for(const i of c.plan({...options,count:100}))c.put('old:'+i,{cost:10});
 for(const key of ['new','third','fourth']){c.activate(key);c.observe(key,10);c.plan({...options,bridge:'old'});c.put(key+':20',{cost:10});}
 assert.equal(c.indices('old').length,100);assert.equal(c.bytes,1030);
});
test('pressure shrink evicts remote data and keeps the target and playing runway',()=>{
 const c=new PlaybackCache(4000,100);c.activate('old');c.observe('old',10);
 for(const i of c.plan({...options,count:100}))c.put('old:'+i,{cost:10});
 c.activate('new');c.observe('new',10);c.plan({...options,bridge:'old'});
 for(const i of [20,21,22])c.put('new:'+i,{cost:10});
 c.budget=120;c.plan({...options,bridge:'old'});assert.ok(c.bytes<=120);
 for(const i of [20,21,22])assert.ok(c.get('new:'+i));
 assert.ok(c.get('old:20'));
});
