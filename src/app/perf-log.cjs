// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
function logDirectory({packaged, executable, root}) {
  return path.join(packaged ? path.dirname(executable) : root, 'logs');
}
// Ordered async batches; clean shutdown awaits close. Forced termination can lose pending data.
function createPerfLog(directory, {maxBytes=8*1024**2, now=()=>new Date(), onError=()=>{}, append=fs.appendFile}={}) {
  const file=path.join(directory,'session-'+now().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'-'+randomUUID().slice(0,8)+'.jsonl');
  let lines=[],pending=0,accepted=0,written=0,ended=false,error=null,count=0,queuedBytes=0;
  let writeMs=0,maxWriteMs=0,batches=0;
  const failed=cause=>{if(error)return;error=String(cause.code||cause.message||cause);ended=true;lines=[];pending=0;onError(error);};
  let chain=fs.mkdir(directory,{recursive:true}).catch(failed);
  function flush(){
    if(!lines.length)return chain;
    const text=lines.join(''),size=Buffer.byteLength(text);lines=[];pending=0;queuedBytes+=size;
    chain=chain.then(async()=>{
      if(error)return;
      const start=performance.now();
      try{await append(file,text,'utf8');written+=size;batches++;}
      catch(cause){failed(cause);}
      finally{const ms=performance.now()-start;writeMs+=ms;maxWriteMs=Math.max(maxWriteMs,ms);}
    }).finally(()=>{queuedBytes-=size;});
    return chain;
  }
  function enqueue(event){const line=JSON.stringify({...event,n:++count})+'\n';lines.push(line);pending+=Buffer.byteLength(line);accepted+=Buffer.byteLength(line);}
  function write(event){
    if(ended||error)return false;
    const size=Buffer.byteLength(JSON.stringify(event))+32;
    if(accepted+size>maxBytes){enqueue({t:event.t,e:'cap',maxBytes});ended=true;void flush();return false;}
    if(pending+queuedBytes+size>512*1024){failed(new Error('LOG_BACKPRESSURE'));return false;}
    enqueue(event);if(pending>=64*1024)void flush();return true;
  }
  return {file,write,flush,async close(){ended=true;await flush();},
    status:()=>({file,ended,error,records:count,writtenBytes:written,pendingBytes:pending+queuedBytes,batches,writeMs,maxWriteMs})};
}
module.exports={createPerfLog,logDirectory};
