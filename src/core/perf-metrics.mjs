// SPDX-License-Identifier: GPL-3.0-or-later
// Bounded samples; aggregation happens at the reporting boundary, never on disk per frame.
export class Samples {
  constructor(limit = 2048) { this.limit = limit; this.reset(); }
  reset() { this.values = []; this.count = 0; this.sum = 0; this.max = 0; this.over100 = this.over250 = this.over500 = 0; }
  add(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.values[this.count % this.limit] = ms; this.count++; this.sum += ms; this.max = Math.max(this.max, ms);
    if (ms > 100) this.over100++; if (ms > 250) this.over250++; if (ms > 500) this.over500++;
  }
  snapshot(reset = false) {
    const sorted = [...this.values].sort((a,b) => a-b), q = k => sorted.length ? sorted[Math.min(sorted.length-1, Math.floor(sorted.length*k))] : null;
    const result = {count:this.count, sampled:sorted.length, meanMs:this.count?this.sum/this.count:null, p50Ms:q(.5), p95Ms:q(.95), maxMs:this.count?this.max:null, over100:this.over100, over250:this.over250, over500:this.over500};
    if (reset) this.reset(); return result;
  }
}

export class PlaybackMetrics {
  constructor(now = () => performance.now()) {
    this.now = now; this.at = now(); this.playing = false; this.lastFrame = null;
    this.activeMs = 0; this.submissions = 0; this.oldLayerSubmissions = 0;
    this.maxHoldMs=0;this.intervals = new Samples(); this.lastIdentity = null; this.indexAdvances = 0; this.repeatedIndex = 0; this.skippedIndices = 0;
  }
  account() { const time=this.now(); if(this.playing)this.activeMs+=Math.max(0,time-this.at);this.at=time;return time; }
  setPlaying(value) { const time=this.account();if(this.playing&&this.lastFrame!==null)this.maxHoldMs=Math.max(this.maxHoldMs,time-this.lastFrame);if(value!==this.playing){this.playing=value;this.lastFrame=value?time:null;this.lastIdentity=null;} }
  submit({index,context,length,target=true}) {
    const time=this.account();
    if(!this.playing)return;
    this.submissions++;if(!target)this.oldLayerSubmissions++;
    if(this.lastFrame!==null)this.intervals.add(time-this.lastFrame);this.lastFrame=time;
    const previous=this.lastIdentity;
    if(previous?.context===context && length>0){const delta=(index-previous.index+length)%length;if(delta===0)this.repeatedIndex++;else{this.indexAdvances++;this.skippedIndices+=Math.max(0,delta-1);}}
    this.lastIdentity={index,context};
  }
  snapshot() {
    const time=this.account();if(this.playing&&this.lastFrame!==null)this.maxHoldMs=Math.max(this.maxHoldMs,time-this.lastFrame);const result={playingMs:this.activeMs, submissions:this.submissions, oldLayerSubmissions:this.oldLayerSubmissions,
      fps:this.activeMs>0?1000*this.submissions/this.activeMs:0, frameIntervals:this.intervals.snapshot(true),
      currentHoldMs:this.playing&&this.lastFrame!==null?time-this.lastFrame:0,maxHoldMs:this.maxHoldMs,
      indexAdvances:this.indexAdvances,repeatedIndex:this.repeatedIndex,skippedIndices:this.skippedIndices};
    this.maxHoldMs=0;this.activeMs=this.submissions=this.oldLayerSubmissions=this.indexAdvances=this.repeatedIndex=this.skippedIndices=0;return result;
  }
}
