// SPDX-License-Identifier: GPL-3.0-or-later
// Byte-accounted LRU: output pixels + header, not compressed source file size.
export class FrameCache {
  constructor(budget = 192 * 1024 ** 2, maxFrames = 48) { this.budget = budget; this.maxFrames = maxFrames; this.entries = new Map(); this.bytes = 0; }
  get(key) { const value = this.entries.get(key); if (value) { this.entries.delete(key); this.entries.set(key,value); } return value; }
  put(key, value) {
    if (this.entries.has(key)) { this.bytes -= this.entries.get(key).cost; this.entries.delete(key); }
    if (value.cost > this.budget) return;
    this.entries.set(key,value); this.bytes += value.cost;
    while (this.bytes > this.budget || this.entries.size > this.maxFrames) {
      const [old,entry] = this.entries.entries().next().value; this.entries.delete(old); this.bytes -= entry.cost;
    }
  }
  delete(key) { const entry=this.entries.get(key); if(entry){this.bytes-=entry.cost;this.entries.delete(key);} }
  resize(budget) {
    this.budget=budget;
    while(this.bytes>this.budget&&this.entries.size)this.delete(this.entries.keys().next().value);
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
// Sequence caches keep visited layers until space is actually required.
// Context accounting is incremental; a displayed frame does not scan the cache.
export class SequenceFrameCache extends FrameCache {
  constructor(budget = 512 * 1024**2, maxFrames = 2048) {
    super(budget,maxFrames);
    this.positions=new Map();this.contexts=new Map();this.stats={hits:0,misses:0,evictions:0,rejected:0};
  }
  get(id){const value=super.get(id);this.stats[value?'hits':'misses']++;return value;}
  contextInfo(context) { return this.contexts.get(context); }
  observe(context,cost) {
    let info=this.contexts.get(context);
    if(!info){info={count:0,bytes:0,frameCost:0};this.contexts.set(context,info);}
    info.frameCost=Math.max(info.frameCost,cost);
    return info;
  }
  delete(id) {
    const entry=this.entries.get(id),position=this.positions.get(id);
    if(entry&&position){
      const info=this.contexts.get(position.context);
      info.count--;info.bytes-=entry.cost;
    }
    this.positions.delete(id);super.delete(id);
  }
  resize(budget,{activeContext='',head=0,length=1}={}) {
    this.budget=budget;
    if(this.bytes<=budget)return;
    const candidates=[...this.entries.keys()].map(id=>{
      const position=this.positions.get(id);
      return {id,active:position.context===activeContext,ahead:(position.index-head+length)%length};
    });
    candidates.sort((a,b)=>Number(a.active)-Number(b.active)||(a.active?b.ahead-a.ahead:0));
    for(const {id} of candidates){if(this.bytes<=budget)break;this.stats.evictions++;this.delete(id);}
  }
  clear() { super.clear();this.positions.clear();this.contexts.clear(); }
  putFrame(context,index,entry,{activeContext=context,head=index,length=1,protectedIds=new Set(),foreground=false,allowEviction=true}={}) {
    this.observe(context,entry.cost);
    if(entry.cost>this.budget){this.stats.rejected++;return false;}
    const id=context+':'+index,existing=this.entries.get(id);
    let bytes=this.bytes-(existing?.cost||0)+entry.cost;
    let count=this.entries.size+(existing?0:1);
    const full=()=>bytes>this.budget||count>this.maxFrames;
    const victims=[];
    if(full()){
      if(!allowEviction){this.stats.rejected++;return false;}
      const distance=frame=>(frame-head+length)%length;
      const incomingDistance=distance(index);
      const inactive=[],active=[];
      for(const [old,value] of this.entries){
        if(old===id||protectedIds.has(old))continue;
        const position=this.positions.get(old),isActive=position.context===activeContext;
        const ahead=distance(position.index);
        // A far-ahead prefetch must not evict a nearer active frame. Foreground
        // requests may replace anything outside the protected playback segment.
        if(isActive&&!foreground&&ahead<=incomingDistance)continue;
        if(isActive)active.push({id:old,cost:value.cost,ahead});
        else inactive.push({id:old,cost:value.cost});
      }
      // Unselected contexts keep LRU (Map) order; active frames farthest from
      // playback are removed first. Only the smaller active set needs sorting,
      // and no per-entry object is built for the unselected majority.
      active.sort((a,b)=>b.ahead-a.ahead);
      for(const candidates of [inactive,active]){
        for(const candidate of candidates){
          victims.push(candidate.id);bytes-=candidate.cost;count--;
          if(!full())break;
        }
        if(!full())break;
      }
      // Do not partially empty the cache when protected frames leave no room.
      if(full()){this.stats.rejected++;return false;}
    }
    for(const victim of victims){this.stats.evictions++;this.delete(victim);}
    if(existing)this.delete(id);
    this.entries.set(id,entry);this.bytes+=entry.cost;
    this.positions.set(id,{context,index});
    const info=this.observe(context,entry.cost);info.count++;info.bytes+=entry.cost;
    return true;
  }
}
// Missing frame numbers hold the preceding frame. A slow decoder skips ahead by time.
export function clockFrame(frames, startNumber, elapsedMs, fps, loop = true) {
  const first = frames[0].number, last = frames.at(-1).number, duration = last-first+1;
  let number = startNumber + Math.floor(Math.max(0,elapsedMs)*fps/1000), ended = false;
  if (loop) number = first + ((number-first)%duration+duration)%duration;
  else if (number > last) { number = last; ended = true; }
  let lo = 0, hi = frames.length-1;
  while (lo < hi) { const mid = Math.ceil((lo+hi)/2); if (frames[mid].number <= number) lo = mid; else hi = mid-1; }
  return { index: lo, ended };
}
// Names, not part/channel positions, survive reordered multipart frames.
export function describeView(parts, view) {
  const part = parts[view.part];
  return { partName: part.name || '', partIndex: view.part, channels: view.components.map(index => part.channels[index]) };
}
export function findView(parts, views, descriptor) {
  return views.findIndex(view => {
    const part = parts[view.part];
    return (descriptor.partName ? part.name === descriptor.partName : !part.name && view.part === descriptor.partIndex)
      && view.components.every((index,i) => part.channels[index] === descriptor.channels[i]);
  });
}

// RGB and its components share one decode identity; alpha occupies the fourth slot.
export function describeLayer(parts, layer) {
  const descriptor=describeView(parts,layer);
  if(layer.color && layer.channels?.A!==undefined)descriptor.channels.push(parts[layer.part].channels[layer.channels.A]);
  return descriptor;
}
export function sourceKey(descriptor,divisor) {
  return JSON.stringify([descriptor?.partName?{...descriptor,partIndex:0}:descriptor,divisor]);
}
