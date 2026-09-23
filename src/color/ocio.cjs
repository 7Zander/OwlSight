// SPDX-License-Identifier: GPL-3.0-or-later
const {spawn}=require('node:child_process');
const path=require('node:path');
// Color configuration work is independent of the EXR reader pool and starts on demand.
function createOcioService(root){
 let child=null,active=null,chain=Promise.resolve(),queued=0,closed=false;
 function launch(){
  const proc=spawn(path.join(root,'resources/decoder/owlsight-decoder.exe'),['-I','-B','-X','utf8',path.join(root,'resources/decoder/ocio_service.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  child=proc;let output='',stderr='';proc.stdout.setEncoding('utf8');proc.stderr.setEncoding('utf8');
  const fail=message=>{if(child!==proc)return;child=null;const job=active;active=null;if(job){clearTimeout(job.timer);job.reject(new Error(message));}proc.kill();};
  proc.stderr.on('data',part=>{stderr=(stderr+part).slice(-4096);});
  proc.stdout.on('data',part=>{
   if(child!==proc)return;output+=part;
   if(output.length>64*1024**2){fail('OCIO 配置生成的数据超过上限。');return;}
   const end=output.indexOf('\n');if(end<0)return;
   try{const response=JSON.parse(output.slice(0,end));output=output.slice(end+1);const job=active;if(!job)throw new Error('OCIO 返回了未请求的数据。');active=null;clearTimeout(job.timer);response.ok?job.resolve(response.result):job.reject(new Error(response.error));}
   catch(error){fail(error.message);}
  });
  proc.on('error',error=>fail(error.message));proc.stdin.on('error',error=>fail(error.message));
  proc.on('close',()=>fail(stderr||'OCIO 辅助进程已退出。'));
 }
 function request(payload){
  if(closed)return Promise.reject(new Error('OCIO 服务已关闭。'));
  if(queued>=4)return Promise.reject(new Error('OCIO 设置正在更新，请稍后重试。'));
  queued++;
  const job=chain.then(()=>new Promise((resolve,reject)=>{
   if(closed){reject(new Error('OCIO 服务已关闭。'));return;}
   if(!child)launch();
   const proc=child,timer=setTimeout(()=>{if(active?.timer!==timer)return;active=null;child=null;proc.kill();reject(new Error('OCIO 配置处理超时。'));},30000);
   active={resolve,reject,timer};proc.stdin.write(JSON.stringify(payload)+'\n');
  }));
  chain=job.catch(()=>{});return job.finally(()=>queued--);
 }
 return {request,dispose(){closed=true;if(active){clearTimeout(active.timer);active.reject(new Error('OCIO 服务已关闭。'));active=null;}child?.kill();child=null;}};
}
module.exports={createOcioService};
