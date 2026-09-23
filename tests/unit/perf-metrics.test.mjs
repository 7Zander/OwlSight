import test from 'node:test';
import assert from 'node:assert/strict';
import {Samples,PlaybackMetrics} from '../../src/core/perf-metrics.mjs';
import {createOperationLog} from '../../ui/perf.mjs';
test('interval fps expires while stalled and paused; a long hold crosses report boundaries',()=>{
 let now=0;const m=new PlaybackMetrics(()=>now);m.setPlaying(true);
 for(let i=0;i<24;i++){now+=1000/24;m.submit({index:i,context:'a',length:100});}
 let s=m.snapshot();assert.ok(Math.abs(s.fps-24)<.001);assert.equal(s.frameIntervals.count,24);
 now+=1000;s=m.snapshot();assert.equal(s.fps,0);assert.ok(s.currentHoldMs>=999);
 now+=200;m.submit({index:24,context:'a',length:100});s=m.snapshot();assert.ok(s.frameIntervals.maxMs>=1199);assert.equal(s.frameIntervals.over500,1);
 m.setPlaying(false);now+=1000;s=m.snapshot();assert.equal(s.fps,0);assert.equal(s.playingMs,0);assert.equal(s.currentHoldMs,0);
});
test('old layer submissions and frame identity gaps remain distinguishable',()=>{
 let now=0;const m=new PlaybackMetrics(()=>now);m.setPlaying(true);
 now=42;m.submit({index:0,context:'old',length:10,target:false});
 now=84;m.submit({index:2,context:'old',length:10,target:false});
 now=126;m.submit({index:2,context:'new',length:10,target:true});
 const s=m.snapshot();assert.equal(s.oldLayerSubmissions,2);assert.equal(s.submissions,3);assert.equal(s.skippedIndices,1);
});
test('bounded samples retain exact count and maximum even after overflow',()=>{
 const s=new Samples(2);s.add(800);s.add(10);s.add(20);const result=s.snapshot(true);
 assert.equal(result.count,3);assert.equal(result.sampled,2);assert.equal(result.maxMs,800);assert.equal(result.over500,1);assert.equal(s.snapshot().count,0);
});
test('rapid switches finish only the selected target; earlier requests are superseded',()=>{
 let now=0;const events=[];const ops=createOperationLog((e,data)=>events.push({e,...data}),()=>now);
 ops.start('layer',{to:'B'});ops.target('layer','b','RGBA');now=10;
 ops.start('layer',{to:'C'});ops.target('layer','c','RGBA');now=50;
 ops.submitted('b','RGBA');assert.equal(events.filter(e=>e.status==='submitted').length,0);
 now=80;ops.submitted('c','RGBA');
 const ends=events.filter(e=>e.e==='operation-end');assert.equal(ends[0].status,'superseded');assert.equal(ends[1].totalMs,70);assert.equal(ends[1].status,'submitted');
});
