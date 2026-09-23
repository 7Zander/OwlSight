// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const GiB=1024**3,minimumGiB=0.125;
async function createViewerSettings(directory){
 const file=path.join(directory,'viewer-settings.json');
 const maxMemoryGiB=Math.floor(os.totalmem()/GiB*1000)/1000;
 const automaticBudget=Math.max(128*1024**2,Math.min(4*GiB,Math.floor(os.totalmem()/8),Math.floor(os.freemem()/4)));
 const validMemory=value=>value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=minimumGiB&&value<=maxMemoryGiB);
 let preferences={memoryGiB:null,defaultResolution:2,logging:true},saving=Promise.resolve();
 try{
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  if(validMemory(saved?.memoryGiB))preferences.memoryGiB=saved.memoryGiB;
  if([1,2,3,4,8].includes(saved?.defaultResolution))preferences.defaultResolution=saved.defaultResolution;
  if(typeof saved?.logging==='boolean')preferences.logging=saved.logging;
 }catch{}
 const state=()=>({preferences:{...preferences},cacheBudget:preferences.memoryGiB===null?automaticBudget:Math.floor(preferences.memoryGiB*GiB),automaticBudget,maxMemoryGiB,minimumGiB});
 function save(value){
  if(!value||!validMemory(value.memoryGiB))throw new Error(`缓存内存须为 ${minimumGiB}–${maxMemoryGiB} GiB，或留空使用自动设置。`);
  if(![1,2,3,4,8].includes(value.defaultResolution))throw new Error('请选择有效的默认分辨率。');
  if(typeof value.logging!=='boolean')throw new Error('日志开关无效。');
  const next={memoryGiB:value.memoryGiB,defaultResolution:value.defaultResolution,logging:value.logging};
  saving=saving.catch(()=>{}).then(async()=>{
   await fs.mkdir(directory,{recursive:true});
   await fs.writeFile(file+'.tmp',JSON.stringify(next,null,2),'utf8');
   await fs.rename(file+'.tmp',file);
   preferences=next;
   return state();
  });
  return saving;
 }
 return {state,save};
}
module.exports={createViewerSettings};
