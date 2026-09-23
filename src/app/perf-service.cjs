// SPDX-License-Identifier: GPL-3.0-or-later
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createPerfLog,logDirectory}=require('./perf-log.cjs');
function summary(values){values.sort((a,b)=>a-b);const n=values.length;return {count:n,p50Ms:n?values[Math.floor(n*.5)]:null,p95Ms:n?values[Math.min(n-1,Math.floor(n*.95))]:null,maxMs:n?values[n-1]:null};}
function createPerfService({app,root,getWindow,getDecoder}) {
  let log=null,enabled=false,timer=null,lastTick=performance.now(),groups=new Map(),groupOverflow=0,resourceAt=0,closed=false;
  const directory=logDirectory({packaged:app.isPackaged,executable:process.execPath,root});
  function status(){const s=log?.status();return {enabled,directory,file:s?.file||null,error:s?.error||null,capped:!!s?.ended&&!s.error,writer:s?{...s,file:undefined}:null};}
  function notify(){const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('perf-log-status',status());}
  function record(e,data={}){if(enabled&&!closed&&log)log.write({t:Date.now(),e,...data});}
  function open(){
    if(log)return;
    log=createPerfLog(directory,{onError:()=>notify()});
    const fingerprint=crypto.createHash('sha256');
    for(const file of ['package.json','ui/renderer.mjs','ui/sequence.mjs','src/exr/preview.cjs','src/exr/preview-pool.cjs','src/render/viewer.mjs','src/app/perf-service.cjs','resources/decoder/preview_service.py']){
      try{fingerprint.update(file).update(fs.readFileSync(path.join(root,file)));}catch{}
    }
    record('session',{schema:2,version:app.getVersion(),buildId:fingerprint.digest('hex').slice(0,20),packaged:app.isPackaged,
      electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,
      osRelease:os.release(),cpu:os.cpus()[0]?.model||'unknown',logicalCpus:os.cpus().length,totalMemoryMiB:Math.round(os.totalmem()/1048576),
      timingBoundary:'CPU draw submission; not compositor or physical display',filesystemCache:'unknown',
      maxLogBytes:8*1024**2,resourceIntervalMs:5000});
    void log.flush().then(notify);
  }
  function setEnabled(value){if(closed)return;if(!value&&enabled){record('logging',{enabled:false});void log?.flush();}enabled=value;
    if(value){open();record('logging',{enabled:true});}groups.clear();lastTick=performance.now();notify();}
  function batch(events){if(!enabled||closed)return status();open();for(const event of events.slice(0,256))record(event.e,event);return status();}
  function decoded(data){
    if(!enabled||closed)return;
    const context=JSON.stringify([data.kind,data.layer,data.channels,data.divisor]);
    let group=groups.get(context);
    if(!group){if(groups.size>=64){groupOverflow++;return;}group={kind:data.kind,layer:data.layer,channels:data.channels,divisor:data.divisor,
      completed:0,canceled:0,failed:0,lastFile:null,lastRequestId:null,nativeCacheHits:0,timings:{}};groups.set(context,group);}
    group[data.outcome==='completed'?'completed':data.outcome==='canceled'?'canceled':'failed']++;
    group.lastFile=data.file;group.lastRequestId=data.requestId;if(data.native?.planeCacheHit)group.nativeCacheHits++;
    for(const [name,value] of Object.entries({...data.timing,...data.native?.timing})){
      if(Number.isFinite(value)){const values=group.timings[name]||=[];if(values.length<2048)values.push(value);}
    }
    if(data.outcome!=='completed'||data.timing?.serviceMs>250)record('read-detail',data);
  }
  function tick(){
    if(!enabled||closed)return;
    const now=performance.now(),intervalMs=now-lastTick;lastTick=now;
    for(const group of groups.values()){const timings={};for(const [name,values] of Object.entries(group.timings))timings[name]=summary(values);
      record('reads',{...group,timings,intervalMs,sampleScope:'completed during interval; grouped by request context'});}
    groups.clear();
    if(groupOverflow){record('log-overflow',{groupsDropped:groupOverflow});groupOverflow=0;}
    if(now-resourceAt>=5000){resourceAt=now;
      try{record('resources',{freeMemoryMiB:Math.round(os.freemem()/1048576),
        electron:app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpuPercent:p.cpu.percentCPUUsage,memoryKiB:p.memory})),
        decoders:getDecoder().stats(),writer:status().writer,
        coverage:'Electron processes plus decoder self samples; OCIO helper excluded; decoder sample age is explicit'});}catch(error){record('resource-error',{message:error.code||'unavailable'});}
    }
    void log?.flush().then(()=>{if(log.status().ended)notify();});
  }
  timer=setInterval(tick,1000);timer.unref();
  return {status,setEnabled,batch,decoded,record,tick,
    async flush(){await log?.flush();return status();},
    async close(reason,rendererFlushed){if(closed)return;tick();record('session-end',{reason,rendererFlushed});closed=true;clearInterval(timer);await log?.close();}};
}
module.exports={createPerfService};
