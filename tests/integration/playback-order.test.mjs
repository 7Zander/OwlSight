import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let harnessSerial=0;
async function harness(t,{length=20,loop=true}={}){
 let now=0,serial=0,selected='beauty',prefetch=false;
 const tasks=new Map(),calls=[],shown=[],errors=[],elements=new Map();
 const later=(fn,delay=0)=>{const id=++serial;tasks.set(id,{at:now+Math.max(1,delay),fn});return id;};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:id==='sequence-fps'?'24':'1',checked:loop,setAttribute(){},focus(){},textContent:''});
  return elements.get(id);
 };
 const frame=(index,layer)=>{
  const header=JSON.stringify({parts:[{width:1,height:1,channels:['R','G','B','A']}],sourceParts:[],range:[0,1]});
  const size=Math.ceil(header.length/4)*4,bytes=new Uint8Array(4+size+16);
  new DataView(bytes.buffer).setUint32(0,size,true);bytes.fill(32,4,4+size);bytes.set(new TextEncoder().encode(header),4);
  return {ok:true,bytes,path:layer+'/'+index,name:String(index)};
 };
 const environment={
  performance:{now:()=>now},setTimeout:later,clearTimeout:id=>tasks.delete(id),
  requestAnimationFrame:fn=>later(()=>fn(now),16),cancelAnimationFrame:id=>tasks.delete(id),
  document:{getElementById:element,body:{classList:{toggle(){}}},addEventListener(){}},
  window:{addEventListener(){},owl:{
   cancelRead:async()=>{},
   discoverSequence:async()=>({ok:true,sequence:{token:1,index:0,frames:Array.from({length},(_,number)=>({number,name:String(number)})),gaps:0}}),
   sequenceFrame:(token,index,view)=>new Promise(resolve=>calls.push({index,layer:view.partName,resolve,done:false,at:now}))
  }}
 };
 globalThis.__playbackOrderEnvironment=environment;
 let source=await readFile(new URL('../../ui/sequence.mjs',import.meta.url),'utf8');
 for(const relative of ['../src/core/sequence.mjs','./preview.mjs','../src/core/perf-metrics.mjs']){
  const actual=relative==='./preview.mjs'?'../../ui/preview.mjs':'../../'+relative.slice(3);
  source=source.replace("'"+relative+"'",JSON.stringify(new URL(actual,import.meta.url).href));
 }
 source='const {performance,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame,document,window}=globalThis.__playbackOrderEnvironment;\n'+source;
 const {createSequencePlayer}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// order fixture '+(++harnessSerial)).toString('base64'));
 const player=createSequencePlayer({
  getDescriptor:()=>({partName:selected,partIndex:0,channels:['R','G','B']}),
  onStart(){},onResolution(){},canPrefetch:()=>prefetch,onError:e=>errors.push(e),
  onPreview:(metadata,packed,result,view)=>shown.push({index:+result.name,layer:view.partName,at:now})
 });
 t.after(()=>{player.reset();tasks.clear();delete globalThis.__playbackOrderEnvironment;assert.deepEqual(errors,[]);});
 const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
 const advance=async ms=>{
  const end=now+ms;let count=0;
  while(true){
   const next=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next)break;
   assert.ok(++count<10000,'scheduler must yield');
   now=Math.max(now,next[1].at);tasks.delete(next[0]);next[1].fn();await flush();
  }
  now=end;await flush();
 };
 const finish=async call=>{assert.ok(call&&!call.done,'expected an outstanding read');call.done=true;call.resolve(frame(call.index,call.layer));await flush();};
 const pending=(index,layer=selected)=>calls.find(call=>!call.done&&call.index===index&&call.layer===layer);
 const warm=async index=>{
  const count=calls.length;player.seekTo(index);await flush();
  const call=calls.slice(count).find(call=>call.index===index);if(call)await finish(call);
  assert.equal(player.index,index);
 };
 await player.discover('test.exr');
 return {player,calls,shown,advance,finish,pending,warm,flush,
  jump:async ms=>{now+=ms;await advance(0);},
  allowPrefetch:()=>{prefetch=true;},
  select:layer=>{selected=layer;player.viewChanged();}
 };
}

test('a late older frame stays cached without replacing a newer displayed frame',async t=>{
 const h=await harness(t);await h.warm(0);h.player.toggle();
 await h.advance(50);const older=h.pending(1);
 await h.advance(50);const newer=h.pending(2);
 await h.finish(newer);assert.equal(h.player.index,2);
 await h.finish(older);assert.equal(h.player.index,2,'frame 1 must not overwrite frame 2');
 assert.ok(h.player.logSnapshot().scheduling.lateFramesNotPresented>0);
 h.player.pause();const reads=h.calls.length;await h.warm(1);
 assert.equal(h.calls.length,reads,'the late frame should remain available for a deliberate seek');
});

test('ready successors continue playback when the clock target is not cached',async t=>{
 const h=await harness(t);
 for(let index=0;index<=6;index++)await h.warm(index);
 await h.warm(0);h.player.toggle();await h.jump(320);
 assert.equal(h.player.index,1,'consume ready frame 1 instead of waiting at frame 0 for frame 7');
 await h.advance(140);
 assert.ok(h.player.index>=4,'continue consuming the cached runway at playback cadence');
 assert.ok(h.player.logSnapshot().scheduling.cacheFallbacks>0);
});

test('a cold layer switch immediately uses both readers for the target and successor',async t=>{
 const h=await harness(t);await h.warm(0);h.player.toggle();h.allowPrefetch();h.select('diffuse');
 await h.advance(5);
 const reads=h.calls.filter(call=>call.layer==='diffuse'&&!call.done);
 assert.deepEqual(reads.map(call=>call.index),[1,2]);
 await h.finish(h.pending(2,'diffuse'));
 assert.ok(!h.shown.some(frame=>frame.layer==='diffuse'),'a successor cannot overtake the handoff');
 await h.finish(h.pending(1,'diffuse'));assert.equal(h.player.index,1);
 await h.advance(60);assert.equal(h.player.index,2);
});

test('cached playback retains normal end-to-start looping',async t=>{
 const h=await harness(t,{length:8});
 for(let index=0;index<8;index++)await h.warm(index);
 await h.warm(0);const begin=h.shown.length;h.player.toggle();await h.advance(510);
 const frames=h.shown.slice(begin).map(frame=>frame.index);
 assert.ok(frames.some((frame,index)=>index>0&&frame===0&&frames[index-1]===7));
 for(let i=1;i<frames.length;i++)assert.equal((frames[i]-frames[i-1]+8)%8,1);
 assert.equal(h.player.playing,true);
});

test('non-loop playback consumes ready frames before waiting for and displaying the last frame',async t=>{
 const h=await harness(t,{length:8,loop:false});
 for(let index=0;index<7;index++)await h.warm(index);
 await h.warm(0);h.player.toggle();await h.jump(500);
 assert.equal(h.player.index,1);assert.equal(h.player.playing,true);
 await h.advance(350);assert.equal(h.player.index,6);assert.equal(h.player.playing,true);
 await h.finish(h.pending(7));await h.advance(60);
 assert.equal(h.player.index,7);assert.equal(h.player.playing,false);
});
