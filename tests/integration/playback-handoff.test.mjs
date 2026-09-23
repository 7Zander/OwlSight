import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const budget of [1024*1024,256,1])test(`slow full-resolution handoff with ${budget} byte cache`, async t => {
 let now=0, serial=0, selected='beauty';
 const tasks=new Map(), shown=[], errors=[];
 const later=(fn,delay=0)=>{const id=++serial;tasks.set(id,{at:now+Math.max(1,delay),fn});return id;};
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:id==='sequence-fps'?'24':'1',checked:true,
   setAttribute(){},focus(){},textContent:''});
  return elements.get(id);
 };
 const environment={
  performance:{now:()=>now},setTimeout:later,clearTimeout:id=>tasks.delete(id),
  requestAnimationFrame:fn=>later(()=>fn(now),16),cancelAnimationFrame:id=>tasks.delete(id),
  document:{getElementById:element,body:{classList:{toggle(){}}},addEventListener(){}},
  window:{addEventListener(){},owl:{cancelRead:async()=>{},
   discoverSequence:async()=>({ok:true,sequence:{token:1,index:0,frames:Array.from({length:120},(_,number)=>({number})),gaps:0}}),
   sequenceFrame:async(token,index,view)=>{
    await new Promise(resolve=>later(resolve,view.partName==='beauty'?5:180));
    const header=JSON.stringify({parts:[{width:1,height:1,channels:['R','G','B','A']}],sourceParts:[],range:[0,1]});
    const size=Math.ceil(header.length/4)*4,bytes=new Uint8Array(4+size+16);
    new DataView(bytes.buffer).setUint32(0,size,true);bytes.fill(32,4,4+size);bytes.set(new TextEncoder().encode(header),4);
    return {ok:true,bytes,path:`${view.partName}/${index}`,name:String(index)};
   }}}
 };
 globalThis.__playbackTestEnvironment=environment;
 t.after(()=>{delete globalThis.__playbackTestEnvironment;});
 let source=await readFile(new URL('../../ui/sequence.mjs',import.meta.url),'utf8');
 source=source.replace("'../src/core/sequence.mjs'",JSON.stringify(new URL('../../src/core/sequence.mjs',import.meta.url).href)).replace("'./preview.mjs'",JSON.stringify(new URL('../../ui/preview.mjs',import.meta.url).href));
 source=source.replace("'../src/core/perf-metrics.mjs'",JSON.stringify(new URL('../../src/core/perf-metrics.mjs',import.meta.url).href));
 source='const {performance,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame,document,window}=globalThis.__playbackTestEnvironment;\n'+source;
 const {createSequencePlayer}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// budget '+budget).toString('base64'));
 const player=createSequencePlayer({getDescriptor:()=>({partName:selected,partIndex:0,channels:['R','G','B']}),
  onStart(){},onResolution(){},canPrefetch:()=>true,onError:e=>errors.push(e),
  onPreview:(frame,packed,result,view)=>shown.push({at:now,index:+result.name,layer:view.partName})});
 const advance=async ms=>{
  const end=now+ms;
  while(true){
   const next=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next)break;
   now=next[1].at;tasks.delete(next[0]);next[1].fn();
   for(let i=0;i<10;i++)await Promise.resolve();
  }
  now=end;
 };
 await player.discover('test.exr');player.setBudget(budget);
 player.toggle();await advance(500);
 selected='diffuse';player.viewChanged();await advance(1500);
 assert.equal(player.playing,true);
 assert.equal(player.switching,false,'new layer must complete even when decode is slower than playback');
 assert.ok(shown.some(f=>f.layer==='diffuse'),'the target pixels must actually be presented');
 const count=shown.filter(f=>f.layer==='diffuse').length;
 await advance(1000);
 assert.ok(shown.filter(f=>f.layer==='diffuse').length>count,'cold playback must continue after handoff');
 selected='specular';player.viewChanged();await advance(20);
 selected='normal';player.viewChanged();const changedAt=now;await advance(1000);
 assert.equal(player.switching,false);
 assert.ok(shown.some(f=>f.at>=changedAt&&f.layer==='normal'));
 assert.ok(!shown.some(f=>f.at>=changedAt&&f.layer==='specular'),'superseded requests cannot publish');
 for(let i=1;i<shown.length;i++){
  const before=shown[i-1],after=shown[i];
  if(before.layer!==after.layer)assert.ok(after.index>=before.index||(before.index===119&&after.index===0),'a new layer must not rewind frames already shown');
 }
 assert.deepEqual(errors,[]);player.reset();
});
