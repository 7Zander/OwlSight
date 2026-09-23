// SPDX-License-Identifier: GPL-3.0-or-later

// A bounded directional window. The first few future frames outrank history.
export function frameWindow(count, position, capacity, fps, loop=true) {
 const size=Math.min(count,Math.max(0,capacity)), result=[],seen=new Set();
 if(!size)return result;
 const behind=Math.min(Math.ceil(fps*0.5),Math.floor((size-1)/4));
 const ahead=size-1-behind;
 const add=offset=>{let i=position+offset;if(loop)i=(i%count+count)%count;if(i>=0&&i<count&&!seen.has(i)){result.push(i);seen.add(i);}};
 add(0);
 for(let i=1;i<=Math.min(3,ahead);i++)add(i);
 for(let i=1;i<=behind;i++)add(-i);
 for(let i=4;i<=ahead;i++)add(i);
 // At a non-looping edge, spend the unused side on the other side.
 for(let i=1;result.length<size&&i<count;i++){add(i);if(result.length<size)add(-i);}
 return result;
}

// CPU pixel cache only. All contexts share one byte and frame-count budget.
export class PlaybackCache {
 constructor(budget,maxFrames){this.budget=budget;this.maxFrames=maxFrames;this.entries=new Map();this.bytes=0;this.costs=new Map();this.contexts=[];this.allowed=new Map();this.active='';this.windowSize=0;this.version=0;}
 activate(key){this.active=key;this.contexts=[key,...this.contexts.filter(k=>k!==key)].slice(0,3);}
 get(id){const entry=this.entries.get(id);if(entry){this.entries.delete(id);this.entries.set(id,entry);}return entry;}
 indices(context){const prefix=context+':';return [...this.entries.keys()].filter(id=>id.startsWith(prefix)).map(id=>Number(id.slice(prefix.length)));}
 observe(context,cost){this.costs.set(context,Math.max(this.costs.get(context)||0,cost));}
 clear(){this.entries.clear();this.bytes=0;this.costs.clear();this.contexts=[];this.allowed.clear();this.active='';this.windowSize=0;this.version++;}
 plan({count,position,fps,loop=true,bridge=null}) {
  const active=this.active;
  if(!active||!count)return [];
  const estimate=key=>this.costs.get(key)||this.costs.get(active)||this.budget/Math.min(count,this.maxFrames);
  const recent=bridge&&bridge!==active?[bridge]:this.contexts.filter(k=>k!==active).slice(0,2);
  const allowed=new Map();let retainedBytes=0,retainedFrames=0;
  const wholeFits=count<=this.maxFrames&&count*estimate(active)<=this.budget;
  const recentBudget=bridge?Math.min(this.budget/3,Math.max(0,this.budget-estimate(active))):Math.min(this.budget/4,wholeFits?this.budget-count*estimate(active):this.budget);
  const recentSlots=wholeFits&&!bridge?this.maxFrames-count:this.maxFrames/4;
  // Recent layers share at most 1/4 of RAM. During a switch, temporarily reserve
  // up to half a second of old-layer frames (at most 1/3 RAM) to bridge continuous playback.
  for(const context of recent){
   const perContext=Math.floor(Math.min(recentBudget/recent.length/estimate(context),recentSlots/recent.length,Math.ceil(fps*0.5)));
   const indices=frameWindow(count,position,perContext,fps,loop);
   for(const i of indices){const id=context+':'+i,entry=this.entries.get(id);if(!bridge&&!entry)continue;allowed.set(id,10000+retainedFrames++);retainedBytes+=entry?.cost||estimate(context);}
  }
  const capacity=Math.min(this.maxFrames-retainedFrames,Math.floor((this.budget-retainedBytes)/estimate(active)));
  const indices=frameWindow(count,position,capacity,fps,loop);
  indices.forEach((i,rank)=>allowed.set(active+':'+i,bridge&&rank>=3?200+rank:rank));
  if(bridge){let rank=100;for(const id of allowed.keys())if(id.startsWith(bridge+':'))allowed.set(id,rank++);}
  this.allowed=allowed;this.windowSize=indices.length;
  this.trim();
  return indices;
 }
 put(id,entry){
  const context=id.slice(0,id.lastIndexOf(':'));
  this.observe(context,entry.cost);
  if(entry.cost>this.budget)return;
  if(this.entries.has(id)){this.bytes-=this.entries.get(id).cost;this.entries.delete(id);}
  this.entries.set(id,entry);this.bytes+=entry.cost;this.version++;
  this.trim();
 }
 trim(){
  while(this.bytes>this.budget||this.entries.size>this.maxFrames){
   let victim=null,worst=-1;
   for(const key of this.entries.keys()){const rank=this.allowed.get(key)??Infinity;if(rank>worst){worst=rank;victim=key;}}
   this.bytes-=this.entries.get(victim).cost;this.entries.delete(victim);this.version++;
  }
 }
}
