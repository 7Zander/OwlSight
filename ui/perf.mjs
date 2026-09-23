// SPDX-License-Identifier: GPL-3.0-or-later
import {Samples} from '../src/core/perf-metrics.mjs';
export function createOperationLog(emit,now=()=>performance.now()){
  let serial=0;const pending=new Map();
  function finish(kind,status,data={}){
    const op=pending.get(kind);if(!op)return;pending.delete(kind);
    emit('operation-end',{operationId:op.id,kind,status,totalMs:now()-op.start,...data});
  }
  return {
    start(kind,data={}){finish(kind,'superseded');const op={id:kind+'-'+(++serial),start:now(),target:null};pending.set(kind,op);emit('operation-start',{operationId:op.id,kind,...data});return op.id;},
    stage(kind,name,data={}){const op=pending.get(kind);if(op)emit('operation-stage',{operationId:op.id,kind,stage:name,elapsedMs:now()-op.start,...data});},
    target(kind,layerId,component){const op=pending.get(kind);if(op)op.target={layerId,component};},
    submitted(layerId,component,data={}){for(const [kind,op] of pending){if(op.target?.layerId===layerId&&op.target.component===component)finish(kind,'submitted',{boundary:'CPU draw submission',...data});}},
    finish,
    cancelAll(status){for(const kind of [...pending.keys()])finish(kind,status);}
  };
}
export function createUiMetrics(){
  const longTasks=new Samples();let observer=null,last=performance.now();
  try{observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.add(entry.duration);});observer.observe({type:'longtask',buffered:false});}catch{}
  return {
    snapshot(){const now=performance.now(),intervalMs=now-last;last=now;
      return {intervalMs,timerDelayMs:Math.max(0,intervalMs-1000),longTaskSupported:!!observer,longTasks:longTasks.snapshot(true)};},
    close(){observer?.disconnect();}
  };
}
