// SPDX-License-Identifier: GPL-3.0-or-later
const {createPreviewDecoder}=require('./preview.cjs');
// Two persistent readers. Each reader retains its own bounded native Part cache.
function createPreviewPool(root,{onTelemetry=()=>{}}={}){
 const slots=Array.from({length:2},()=>({decoder:createPreviewDecoder(root,{onTelemetry,onIdle:()=>drain()}),job:null}));
 const queue=[];let closed=false,serial=0,retries=0,canceledQueued=0;
 function drain(){
  if(closed)return;
  for(const slot of slots){
   if(slot.job||slot.decoder.isBusy()||!queue.length)continue;
   const job=queue.shift();slot.job=job;
   slot.decoder.decode(...job.args,{...job.context,requestId:job.id,poolWaitMs:performance.now()-job.queuedAt}).then(job.resolve,job.reject).finally(()=>{if(slot.job===job)slot.job=null;drain();});
  }
 }
 function cancel(){
  for(const job of queue.splice(0)){canceledQueued++;onTelemetry({requestId:job.id,kind:job.context.kind||'preview',file:require('node:path').basename(job.args[0]),layer:job.args[1]?.partName||'',divisor:job.args[2],outcome:'canceled',timing:{poolWaitMs:performance.now()-job.queuedAt,serviceMs:0}});job.reject(new Error('旧预览已取消。'));}
  for(const slot of slots)slot.decoder.cancel();
 }
 return {
  decode(file,view=null,divisor=1,maxEdge=0,context={}){
   const args=[file,view,divisor,maxEdge];
   if(closed)return Promise.reject(new Error('解码服务已关闭。'));
   if(queue.length>=2){retries++;return Promise.reject(Object.assign(new Error('预览请求过多，请稍后重试。'),{code:'PREVIEW_BUSY'}));}
   return new Promise((resolve,reject)=>{queue.push({args,context,id:++serial,queuedAt:performance.now(),resolve,reject});drain();});
  },
  cancel,
  warmup:()=>closed?Promise.resolve([]):Promise.allSettled(slots.map(slot=>slot.decoder.warmup())),
  stats:()=>({queued:queue.length,retries,canceledQueued,workers:slots.map(slot=>slot.decoder.stats())}),
  dispose(){closed=true;cancel();for(const slot of slots)slot.decoder.dispose();}
 };
}
module.exports={createPreviewPool};
