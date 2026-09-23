// SPDX-License-Identifier: GPL-3.0-or-later
const {spawn} = require('node:child_process');
const path = require('node:path');
// One persistent process, one in-flight reply and one replaceable pending request.
function createPreviewDecoder(root,{onTelemetry=()=>{},onIdle=()=>{}}={}) {
  let child = null, active = null, pending = null, stopped = false;
  let lastResources=null,completed=0,canceled=0,failed=0;
  function report(job,outcome,extra={}) {
    if(job.reported)return;job.reported=true;
    if(outcome==='completed')completed++;else if(outcome==='canceled')canceled++;else failed++;
    const end=performance.now();
    onTelemetry({requestId:job.context.requestId,kind:job.context.kind||'preview',file:path.basename(job.request.file),
      layer:job.request.view?.partName||'',channels:job.request.view?.channels||[],divisor:job.request.divisor,
      frameIndex:job.context.frameIndex,sourceFrame:job.context.sourceFrame,outcome,
      timing:{poolWaitMs:job.context.poolWaitMs||0,helperWaitMs:(job.start||end)-job.queuedAt,serviceMs:job.start?end-job.start:0,
        firstByteMs:job.firstByte&&job.start?job.firstByte-job.start:null,receiveMs:job.firstByte?end-job.firstByte:null},...extra});
  }
  function reject(job,message) {
    if(job && !job.discarded) {job.discarded=true;job.dropOutput?.();job.reject(new Error(message));if(job!==active)report(job,'canceled');}
  }
  function cancel(force=false) {
    if(pending&&(force||pending.context.kind!=='warmup')){reject(pending,'旧预览已取消。');pending=null;}
    if(force||active?.context.kind!=='warmup')reject(active,'旧预览已取消。');
  }
  function dispose() {stopped=true;cancel(true);child?.kill();}
  function launch() {
    const proc=spawn(path.join(root,'resources/decoder/owlsight-decoder.exe'),['-I','-B','-X','utf8',path.join(root,'resources/decoder/preview_service.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    child=proc;
    const prefix=Buffer.allocUnsafe(4);
    let prefixSize=0,header=null,headerSize=0,output=null,offset=0,total=null,metadata=null,stderr='';
    const reset=()=>{prefixSize=headerSize=offset=0;header=output=metadata=null;total=null;};
    proc.stderr.setEncoding('utf8');proc.stderr.on('data',s=>{stderr=(stderr+s).slice(-4096);});
    proc.stdin.on('error',()=>{});
    proc.stdout.on('data',chunk=>{
      try {
        if(!active) throw new Error('收到未请求的解码结果。');
        active.firstByte ||= performance.now();
        let position=0;
        if(total===null){
          if(prefixSize<4){
            const count=Math.min(4-prefixSize,chunk.length);
            chunk.copy(prefix,prefixSize,0,count);prefixSize+=count;position+=count;
            if(prefixSize<4)return;
            const length=prefix.readUInt32LE(0);
            if(!length||length>1024**2||length%4)throw new Error('解码元数据无效。');
            header=Buffer.allocUnsafe(length);
          }
          const count=Math.min(header.length-headerSize,chunk.length-position);
          chunk.copy(header,headerSize,position,position+count);headerSize+=count;position+=count;
          if(headerSize<header.length)return;
          metadata=JSON.parse(header.toString('utf8'));
          if(!Array.isArray(metadata.parts))throw new Error('解码元数据无效。');
          const pixelBytes=metadata.parts.reduce((n,p)=>n+p.width*p.height*p.channels.length*(p.pixelType==='half'?2:4),0);
          if(!Number.isSafeInteger(pixelBytes)||pixelBytes<0||pixelBytes>512*1024**2)throw new Error('预览超过 512 MiB 上限。');
          offset=4+header.length;total=offset+pixelBytes;
          // A canceled frame must drain to keep the stream aligned, but it no
          // longer needs a full-size destination or any pixel copies.
          if(!active.discarded){
            output=Buffer.allocUnsafe(total);prefix.copy(output,0);header.copy(output,4);
          }
          active.dropOutput=()=>{output=null;};header=null;
        }
        const count=chunk.length-position;
        if(offset+count>total)throw new Error('解码结果大小无效。');
        if(output)chunk.copy(output,offset,position);
        offset+=count;
        if(offset===total){
          const job=active,bytes=output,error=metadata.error,native=metadata.diagnostics;
          if(native?.resources)lastResources=native.resources;
          report(job,job.discarded?'canceled':error?'failed':'completed',{native});
          const timing={poolWaitMs:job.context.poolWaitMs||0,helperWaitMs:job.start-job.queuedAt,serviceMs:performance.now()-job.start,
            firstByteMs:job.firstByte-job.start,receiveMs:performance.now()-job.firstByte,native};
          active=null;clearTimeout(job.timer);job.dropOutput=null;reset();
          if(!job.discarded)error?job.reject(new Error(error)):job.resolve({bytes,decodeMs:performance.now()-job.start,timing,requestId:job.context.requestId});
          dispatch();if(!active&&!pending)onIdle();
        }
      }catch(error){reject(active,error.message);proc.kill();}
    });
    proc.on('error',e=>{stderr=e.message;});
    proc.on('close',()=>{
      if(child!==proc)return;child=null;
      if(active){clearTimeout(active.timer);report(active,active.discarded?'canceled':'failed');reject(active,stderr || '预览进程已退出。');active=null;}
      reset();
      if(!stopped){dispatch();if(!active&&!pending)onIdle();}
    });
  }
  function dispatch() {
    if(stopped||active||!pending)return;
    if(!child)launch();
    active=pending;pending=null;active.start=performance.now();
    const proc=child,job=active;
    job.timer=setTimeout(()=>{reject(job,'解码超过 60 秒，已停止。');proc.kill();},60000);
    proc.stdin.write(JSON.stringify(job.request)+'\n');
  }
  function decode(file,view=null,divisor=1,maxEdge=0,context={}) {
    if(stopped)return Promise.reject(new Error('解码服务已关闭。'));
    reject(pending,'旧预览已取消。');
    return new Promise((resolve,reject)=>{pending={request:{file,view,divisor,maxEdge,...(context.kind==='warmup'?{warmup:true}:{})},context,queuedAt:performance.now(),resolve,reject};dispatch();});
  }
  return {decode,cancel,dispose,isBusy:()=>!!active||!!pending,
    warmup:()=>child?Promise.resolve():decode('',null,1,0,{kind:'warmup'}),stats:()=>({pid:child?.pid||null,activeRequest:active?.context.requestId||null,
    activeMs:active?.start?performance.now()-active.start:0,drainingCanceled:!!active?.discarded,pending:!!pending,completed,canceled,failed,
    resources:lastResources,resourceAgeMs:lastResources?Date.now()-lastResources.collectedAtUnixMs:null})};
}
module.exports={createPreviewDecoder};
