// SPDX-License-Identifier: GPL-3.0-or-later
import {SequenceFrameCache,clockFrame,sourceKey} from '../src/core/sequence.mjs';
import {unpackPreview} from './preview.mjs';
import {PlaybackMetrics,Samples} from '../src/core/perf-metrics.mjs';
const $=id=>document.getElementById(id);
export function createSequencePlayer({getDescriptor,onStart,onPreview,onResolution,canPrefetch,onError,onPrepare=()=>{},getAlternates=()=>[],estimateFrameCost=()=>64*1024**2,onEvent=()=>{}}) {
 const cache=new SequenceFrameCache(512*1024**2,2048);
 const metrics=new PlaybackMetrics(()=>performance.now());
 const requests={started:0,completed:0,stale:0,retries:0,failed:0,cancelRequests:0,rereadRecent:0};
 const recentReads=new Map(),readGroups=new Map();let frameTrace=[];
 let sequence=null,revision=0,playing=false,current=0,wanted=0,descriptor=null,key='';
 const jobs=new Map();
 let retryAt=0,stoppedAt=0;
 const scheduling={cacheFallbacks:0,lateFramesNotPresented:0};
 let recent=[];const idleAttempts=new Set();
 let presented=null,transition=null;
 let animation=0,timer=0,scrub=0,navigation=null,seeking=false,anchor=0,anchorTime=0,shown=0,measuredAt=0,measuredFps=0;
 let decodeSamples=[],decodes=0,presentedTotal=0;
 const divisor=()=>Number($('sequence-resolution').value);
 const fps=()=>Number($('sequence-fps').value);
 const cacheKey=index=>key+':'+index;
 function context(){
  const previous=descriptor,oldKey=key;
  descriptor=getDescriptor()||descriptor;key=sourceKey(descriptor,divisor());
  if(oldKey&&oldKey!==key){
   recent=[{key:oldKey,view:previous},...recent.filter(v=>v.key!==oldKey&&v.key!==key)].slice(0,2);
   idleAttempts.clear();stoppedAt=performance.now();
  }
 }
 function indexAt(start,offset){
  const index=start+offset;
  if(index>=sequence.frames.length&&!$('sequence-loop').checked)return -1;
  return index%sequence.frames.length;
 }
 function framePlan(){
  // The cost belongs to this layer/resolution/range context, never a random LRU
  // entry from a scalar or lower-precision layer visited earlier.
  const cost=cache.contextInfo(key)?.frameCost||Math.max(1,estimateFrameCost());
  const capacity=Math.max(1,Math.min(sequence.frames.length,cache.maxFrames,Math.floor(cache.budget/cost)));
  return {cost,capacity};
 }
 function protectedFrames(head,capacity){
  const ids=new Set();
  const near=Math.min(capacity,Math.ceil(fps()/2)+1);
  for(let step=0;step<near;step++){
   const index=indexAt(head,step);if(index<0)break;
   ids.add(cacheKey(index));
  }
  if(playing&&!transition)ids.add(cacheKey(wanted));
  return ids;
 }
 function retain(index,entry,prefix=key,idle=false){
  cache.observe(prefix,entry.cost);
  const head=transition?.index??current,plan=framePlan();
  return cache.putFrame(prefix,index,entry,{
   activeContext:key,head,length:sequence.frames.length,
   protectedIds:protectedFrames(head,plan.capacity),
   foreground:prefix===key&&(index===(transition?.index??wanted)||(!playing&&index===current)),
   allowEviction:!idle
  });
 }
 function cachedPreview(view){return sequence?cache.get(sourceKey(view,divisor())+':'+current):null;}
 function rememberPreview(entry,view){
  if(!sequence||entry.result.name!==sequence.frames[current].name)return;
  retain(current,entry,sourceKey(view,divisor()));status();
 }
 function idleCandidate(){
  if(playing||jobs.size||performance.now()-stoppedAt<600||!canPrefetch())return null;
  // Alternatives only use spare capacity after the selected layer's entire
  // budgeted forward window is ready, including frames still being decoded.
  for(let n=0;n<framePlan().capacity;n++){
   const index=indexAt(current,n);if(index<0)break;
   if(!cache.entries.has(cacheKey(index)))return null;
  }
  const choices=getAlternates().filter(item=>sourceKey(item.view,divisor())!==key);
  choices.sort((a,b)=>{
   const rank=item=>{const n=recent.findIndex(v=>v.key===sourceKey(item.view,divisor()));return n<0?2:n;};
   return rank(a)-rank(b);
  });
  for(const item of choices.slice(0,2)){
   const prefix=sourceKey(item.view,divisor()),id=prefix+':'+current;
   if(cache.entries.has(id)||idleAttempts.has(id))continue;
   idleAttempts.add(id);
   const inactive=cache.bytes-(cache.contextInfo(key)?.bytes||0);
   if(item.cost>Math.min(256*1024**2,cache.budget/4)-inactive||item.cost>cache.budget-cache.bytes)continue;
   recent=[...recent.filter(v=>v.key!==prefix),{key:prefix,view:item.view}].slice(-2);
   return {...item,prefix};
  }
  return null;
 }
 function coverage(){return cache.contextInfo(key)?.count||0;}
 function continuousAhead(limit=sequence?.frames.length||0){
  let count=0;
  if(sequence)for(let step=1;step<Math.min(sequence.frames.length,limit+1);step++){
   const index=indexAt(current,step);if(index<0||!cache.entries.has(cacheKey(index)))break;count++;
  }
  return count;
 }
 function readerLimit(){
  if(!playing)return 2;
  // A short ready runway permits one reader to remain available for interaction.
  // If frames are missing, use both readers immediately, including during handoff.
  const runway=Math.max(1,Math.min(framePlan().capacity-1,Math.ceil(fps()/4)));
  return transition||continuousAhead(runway)<runway?2:1;
 }
 function anchorAt(index){wanted=index;anchor=sequence.frames[index].number;anchorTime=performance.now();}
 function status(note=''){
  $('sequence-controls').hidden=!sequence;document.body.classList.toggle('has-sequence',!!sequence);if(!sequence)return;
  $('sequence-play').setAttribute('aria-label',playing?'暂停':'播放');$('sequence-play').setAttribute('aria-pressed',String(playing));
  $('sequence-frame').textContent=`${sequence.frames[current].number} / ${sequence.frames.at(-1).number}`;
  if(document.activeElement!==$('sequence-position'))$('sequence-position').value=current;
  $('sequence-position').setAttribute('aria-valuetext',`第 ${sequence.frames[current].number} 帧`);
  $('sequence-status').setAttribute('data-cache-bytes',String(cache.bytes));
  $('sequence-status').textContent=note||`${divisor()===1?'full 分辨率':'1/'+divisor()+' 分辨率'} · ${playing?measuredFps.toFixed(1)+' fps · ':''}缓存 ${(cache.bytes/1024**2).toFixed(0)}/${Math.round(cache.budget/1024**2)} MiB · ${coverage()}/${sequence.frames.length} 帧${sequence.gaps?' · 缺 '+sequence.gaps+' 帧':''}`;
 }
 function stopScheduling(){cancelAnimationFrame(animation);clearTimeout(timer);clearTimeout(scrub);}
 function invalidate(cancelRead=true){if(cancelRead)requests.cancelRequests++;revision++;stopScheduling();seeking=false;jobs.clear();if(cancelRead)window.owl.cancelRead().catch(e=>onError(e.message));}
 function reset(){metrics.setPlaying(false);metrics.snapshot();frameTrace=[];readGroups.clear();recentReads.clear();invalidate(false);presented=transition=null;sequence=null;playing=false;navigation=null;descriptor=null;key='';recent=[];idleAttempts.clear();decodeSamples=[];decodes=0;presentedTotal=0;cache.clear();status();}
 function setBudget(budget){
  cache.resize(budget,{activeContext:key,head:transition?.index??current,length:sequence?.frames.length||1});
  idleAttempts.clear();status();if(sequence)schedule(0);
 }
 async function discover(file){
  const request=revision,result=await window.owl.discoverSequence(file);if(request!==revision)return;
  if(!result.ok){$('metadata').textContent+=' · '+result.error;return;}
  sequence=result.sequence;
  if(sequence){current=wanted=sequence.index;$('sequence-position').max=sequence.frames.length-1;$('sequence-position').value=current;context();onResolution({initial:true});schedule();}
  status();
 }
 function display(index,entry,view=descriptor){
  if(current===index && entry.displayedRevision===revision)return;
  try{onPreview(entry.frame,entry.packed,entry.result,view);}catch(e){metrics.setPlaying(false);playing=false;invalidate();status('播放已停止');onError(e.message);return;}
  metrics.submit({index,context:view===descriptor?key:presented?.key,length:sequence.frames.length,target:view===descriptor});
  if(frameTrace.length<240)frameTrace.push({rendererMs:performance.now(),index,sourceFrame:sequence.frames[index].number,layer:view?.partName||'',target:view===descriptor});
  current=index;entry.displayedRevision=revision;presented={key:view===descriptor?key:presented.key,descriptor:view};shown++;presentedTotal++;
  const now=performance.now();if(now-measuredAt>=1000){measuredFps=shown*1000/(now-measuredAt);shown=0;measuredAt=now;}
  status();
 }
 async function load(index,view=descriptor,prefix=key,idle=false){
  const startedAt=performance.now(),request=revision,resolution=divisor(),id=prefix+':'+index,pending={index,prefix,startedAt};jobs.set(id,pending);
  requests.started++;if(recentReads.has(id))requests.rereadRecent++;recentReads.delete(id);recentReads.set(id,true);if(recentReads.size>4096)recentReads.delete(recentReads.keys().next().value);
  try{
   const result=await window.owl.sequenceFrame(sequence.token,index,view,resolution);if(request!==revision){requests.stale++;return null;}
   const roundTripMs=performance.now()-startedAt;
   // Canceled readers can still be draining during rapid layer changes. Retry without stopping the clock.
   if(!result.ok && result.retryable){requests.retries++;retryAt=performance.now()+80;schedule(80);return null;}
   const unpackAt=performance.now(),entry=unpackPreview(result);requests.completed++;
   let group=readGroups.get(prefix);if(!group&&readGroups.size<64){group={layer:view.partName,channels:view.channels,divisor:resolution,roundTrip:new Samples(),unpack:new Samples(),bridgeOverhead:new Samples()};readGroups.set(prefix,group);}
   group?.roundTrip.add(roundTripMs);group?.unpack.add(performance.now()-unpackAt);if(result.mainReadMs!=null)group?.bridgeOverhead.add(Math.max(0,roundTripMs-result.mainReadMs));
   decodeSamples.push(result.decodeMs||0);if(decodeSamples.length>512)decodeSamples.shift();decodes++;
   if(!idle||entry.cost<=cache.budget-cache.bytes){retain(index,entry,prefix,idle);}
   status();return entry;
  }catch(e){requests.failed++;if(request===revision && prefix===key){metrics.setPlaying(false);playing=false;transition=null;invalidate();status('读取已停止');onError(e.message);}return null;}
  finally{if(jobs.get(id)===pending)jobs.delete(id);}
 }
 function nextPrefetch(){
  if(!sequence||!descriptor||!canPrefetch())return -1;
  const {capacity}=framePlan();
  for(let step=1;step<capacity;step++){
   const index=indexAt(current,step);if(index<0)break;
   if(!cache.entries.has(cacheKey(index))&&!jobs.has(cacheKey(index)))return index;
  }
  return -1;
 }
 function schedule(delay=50){clearTimeout(timer);if(sequence)timer=setTimeout(()=>void pump(),delay);}
 function transitionIndex(){
  if(!transition)return -1;
  // Read the handoff first, then one successor so playback can continue.
  for(let step=0;step<Math.min(2,framePlan().capacity);step++){
   const index=indexAt(transition.index,step);if(index<0)break;
   if(!cache.entries.has(cacheKey(index))&&!jobs.has(cacheKey(index)))return index;
  }
  return -1;
 }
 function prepareNearby(){
  if(!sequence||!canPrefetch())return;
  const candidates=[],head=transition?.index??current;
  const start=transition?0:1,end=Math.min(framePlan().capacity,start+3);
  for(let step=start;step<end;step++){
   const index=indexAt(head,step);if(index<0)break;
   const entry=cache.entries.get(cacheKey(index));
   // A missing nearer frame is a barrier; do not upload distant frames first.
   if(!entry)break;
   candidates.push(entry.packed);
  }
  onPrepare(candidates);
 }
 function showTarget(){
  const entry=cache.get(cacheKey(wanted));
  if(transition){
   // Old playback cannot pass this forward handoff; slow decode has a fixed target.
   const index=transition.index, target=cache.get(cacheKey(index));
   if(target){
    onEvent('layer-handoff',{fromIndex:current,toIndex:index,waitMs:performance.now()-transition.startedAt,layer:descriptor.partName});
    transition=null;wanted=index;anchor=sequence.frames[index].number;anchorTime=performance.now();
    display(index,target);return true;
   }
   const old=presented && cache.get(presented.key+':'+wanted);
   if(old)display(wanted,old,presented.descriptor);
   return false;
  }
  if(entry){display(wanted,entry);return true;}
  // If the clock outruns decoding, consume a ready successor and re-anchor.
  // Only scan forward up to the due frame; never display an early future frame.
  const distance=(wanted-current+sequence.frames.length)%sequence.frames.length;
  for(let step=1;step<=Math.min(distance,cache.maxFrames);step++){
   const index=indexAt(current,step);if(index<0)break;
   const ready=cache.get(cacheKey(index));if(!ready)continue;
   scheduling.cacheFallbacks++;anchorAt(index);display(index,ready);return true;
  }
  return false;
 }
 async function pump(){
  if(!sequence)return;
  const request=revision,available=playing?showTarget():false;
  if(jobs.size>=readerLimit())return;
  if(performance.now()<retryAt){schedule(Math.ceil(retryAt-performance.now()));return;}
  const switching=!!transition;
  const foreground=playing&&!available&&!switching&&!jobs.has(cacheKey(wanted));
  const index=switching?transitionIndex():foreground?wanted:nextPrefetch();
  if(index<0){
   if(switching){schedule(20);return;}
   // Foreground and selected-layer prefetch always get the readers first.
   const idle=idleCandidate();
   if(idle){await load(current,idle.view,idle.prefix,true);if(request===revision)schedule(50);return;}
   prepareNearby();schedule(playing?50:250);return;
  }
  const displayedAtRequest=presentedTotal,pending=load(index);
  if(jobs.size<readerLimit())schedule(0);
  const loaded=await pending;if(request!==revision||!loaded)return;
  if(playing){
   if(switching){
    // Oversized frames can be shown even when they cannot be retained in RAM.
    if(transition&&transition.index===index&&!cache.entries.has(cacheKey(index))){
     onEvent('layer-handoff',{fromIndex:current,toIndex:index,waitMs:performance.now()-transition.startedAt,layer:descriptor.partName});
     transition=null;wanted=index;anchor=sequence.frames[index].number;anchorTime=performance.now();display(index,loaded);
    }else showTarget();
   }else{
    const available=showTarget();
    // Completion order is not presentation order. Cached frames go through the
    // clock above; uncached/oversized foreground frames may publish only if no
    // newer image has been shown since this request began.
    if(foreground&&presentedTotal!==displayedAtRequest&&current!==index)scheduling.lateFramesNotPresented++;
    if(foreground&&!available&&presentedTotal===displayedAtRequest){
     anchorAt(index);display(index,loaded);
    }
   }
  }
  prepareNearby();
  schedule(0);
 }
 function tick(now){
  if(!playing)return;
  if(transition){
   // Advance the old layer by at most one frame, then hold at the handoff.
   // A cold selection must neither rewind nor chase a moving target forever.
   const steps=Math.min(transition.steps,Math.floor(Math.max(0,now-transition.startedAt)*fps()/1000));
   wanted=indexAt(transition.origin,steps);showTarget();
   void pump();animation=requestAnimationFrame(tick);return;
  }
  const target=clockFrame(sequence.frames,anchor,now-anchorTime,fps(),$('sequence-loop').checked);wanted=target.index;
  showTarget();
  if(target.ended&&current===sequence.frames.length-1){pause();return;}
  void pump();animation=requestAnimationFrame(tick);
 }
 function start(){
  if(!sequence||playing)return;
  const previousKey=key;context();
  // Pause-to-play is only a clock change. Keep this context's requests and
  // their revision so their results populate the same cache after playback starts.
  // An unfinished seek or changed context still invalidates stale results.
  if(key!==previousKey||seeking||navigation!==null)invalidate();
  else stopScheduling();
  navigation=null;wanted=current;playing=true;metrics.setPlaying(true);onEvent('playback',{action:'start',index:current,targetFps:fps()});onStart();
  anchor=sequence.frames[current].number;anchorTime=measuredAt=performance.now();shown=measuredFps=0;
  status();prepareNearby();schedule(0);animation=requestAnimationFrame(tick);$('stage').focus();
 }
 function pause(){const switching=!!transition;if(playing)onEvent('playback',{action:'pause',index:current});metrics.setPlaying(false);playing=false;transition=null;presented=null;invalidate();navigation=null;stoppedAt=performance.now();idleAttempts.clear();status();if(switching)onResolution();schedule(600);return true;}
 function restart(){void seek(0,true);}
 async function seek(index,resume=false){
  if(!sequence)return;metrics.setPlaying(false);onEvent('seek',{index});playing=false;transition=null;invalidate();context();onStart();wanted=index;seeking=true;const request=revision;
  status(`正在读取第 ${sequence.frames[index].number} 帧…`);
  async function readTarget(){
   const entry=cache.get(cacheKey(index))||await load(index);
   if(request!==revision)return;
   // Restart waits for the actual first frame, including a temporarily busy reader.
   // A later seek, pause, layer change or restart invalidates this continuation.
   if(!entry){
    if(resume&&performance.now()<retryAt){clearTimeout(timer);scrub=setTimeout(()=>void readTarget(),Math.ceil(retryAt-performance.now()));}
    return;
   }
   seeking=false;display(index,entry);
   if(request!==revision)return;
   navigation=null;if(resume)start();else schedule();
  }
  await readTarget();
 }
 function scheduleSeek(index){pause();navigation=index;scrub=setTimeout(()=>void seek(index),60);status(`跳转至第 ${sequence.frames[index].number} 帧…`);}
 function step(delta){if(sequence)scheduleSeek(Math.max(0,Math.min(sequence.frames.length-1,(navigation??current)+delta)));}
 function toggle(){playing?pause():start();}
 function viewChanged(){
  if(!sequence)return;
  if(!playing){pause();context();schedule();return;}
  presented ||= {key,descriptor};
  invalidate();context();
  wanted=current;
  const next=indexAt(current,1),warm=cache.entries.has(cacheKey(current));
  const steps=warm||next<0?0:1;
  transition=key===presented.key?null:{origin:current,index:steps?next:current,steps,startedAt:performance.now()};
  // Reuse a cached current frame immediately; cold switches land one frame ahead.
  onStart();status();animation=requestAnimationFrame(tick);schedule(0);
 }
 $('sequence-play').onclick=toggle;$('sequence-previous').onclick=()=>step(-1);$('sequence-next').onclick=()=>step(1);
 $('sequence-fps').onchange=()=>{onEvent('setting',{name:'targetFps',value:fps()});if(playing){anchor=sequence.frames[current].number;anchorTime=performance.now();}};
 $('sequence-position').oninput=()=>scheduleSeek(Number($('sequence-position').value));
 $('sequence-resolution').onchange=()=>{onEvent('setting',{name:'resolution',value:divisor()});const resume=playing;pause();context();onResolution();status();if(resume)start();else schedule();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();}else if(sequence)schedule();});
 window.addEventListener('beforeunload',reset);
 function logSnapshot(){
  const ahead=continuousAhead();
  const groups=[...readGroups.values()].map(g=>({layer:g.layer,channels:g.channels,divisor:g.divisor,roundTrip:g.roundTrip.snapshot(),unpack:g.unpack.snapshot(),bridgeOverhead:g.bridgeOverhead.snapshot()}));readGroups.clear();
  const trace=frameTrace;frameTrace=[];
  return {...metrics.snapshot(),targetFps:fps(),loop:$('sequence-loop').checked,currentIndex:current,targetIndex:transition?.index??wanted,
    currentFrame:sequence?.frames[current]?.number??null,targetFrame:sequence?.frames[transition?.index??wanted]?.number??null,
    targetLayer:descriptor?.partName||'',displayedLayer:presented?.descriptor?.partName||'',continuousAhead:ahead,
    inFlight:jobs.size,oldestInFlightMs:jobs.size?Math.max(...[...jobs.values()].map(j=>performance.now()-j.startedAt)):0,
    scheduling:{...scheduling,readConcurrency:sequence?readerLimit():0},requests:{...requests},cacheStats:{...cache.stats},requestGroups:groups,frameTrace:trace,frameTraceLimit:240};
 }
 return {logSnapshot,reset,discover,setBudget,toggle,restart,step,pause,viewChanged,cachedPreview,rememberPreview,seekTo:index=>void seek(index),perf:()=>({decodeMs:decodeSamples,decodes,presented:presentedTotal,fps:measuredFps,playing,switching:!!transition,divisor:divisor(),cacheBytes:cache.bytes,cacheFrames:cache.entries.size,budget:cache.budget,coverage:coverage(),count:sequence?.frames.length||0}),get index(){return current;},get count(){return sequence?.frames.length||0;},get targetDescriptor(){return descriptor;},get switching(){return !!transition;},get active(){return !!sequence;},get needsRestore(){return false;},get playing(){return playing;},get divisor(){return divisor();}};
}
