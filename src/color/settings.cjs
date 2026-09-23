// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs/promises');
const path=require('node:path');
const {createOcioService}=require('./ocio.cjs');
function installColor({app,ipcMain,dialog,window,authorize,root}){
 const service=createOcioService(root),records=new Map();let next=0,activeId=null,saving=Promise.resolve();
 const settingsFile=path.join(app.getPath('userData'),'color-settings.json');
 async function saved(){try{return JSON.parse(await fs.readFile(settingsFile,'utf8'));}catch{return null;}}
 async function config(source){
  if(source!=='builtin'){
   if(typeof source!=='string'||!path.isAbsolute(source)||!source.toLowerCase().endsWith('.ocio'))throw new Error('请选择 .ocio 配置文件。');
   const stat=await fs.stat(source);if(!stat.isFile()||stat.size>16*1024**2)throw new Error('OCIO 配置文件无效或超过 16 MiB。');
  }
  const catalog=await service.request({action:'catalog',source}),id=++next;
  records.set(id,{source,catalog});
  // Failed candidates must never evict the last pipeline committed by the UI.
  while(records.size>8)records.delete([...records.keys()].find(key=>key!==activeId));
  return {id,catalog};
 }
 function selection(value){
  const record=records.get(value?.id);if(!record)throw new Error('配置已失效，请重新加载。');
  const {catalog}=record;
  if(!catalog.spaces.includes(value.input)||!Object.hasOwn(catalog.displays,value.display)||!catalog.displays[value.display].includes(value.view))throw new Error('OCIO 选择无效。');
  if(!['config','none','override'].includes(value.lookMode)||(value.lookMode==='override'&&!catalog.looks.includes(value.look)))throw new Error('OCIO Look 无效。');
  return {source:record.source,input:value.input,display:value.display,view:value.view,lookMode:value.lookMode,look:value.look||''};
 }
 const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{authorize(event);try{return {ok:true,...await fn(...args)};}catch(error){return {ok:false,error:error.message};}});
 handle('ocio-state',async()=>({enabled:(await saved())?.enabled===true}));
 handle('ocio-config',async action=>{
  let source='builtin',previous;
  if(action==='pick'){
   const result=await dialog.showOpenDialog(window,{title:'加载 OCIO 配置',filters:[{name:'OpenColorIO',extensions:['ocio']}],properties:['openFile']});
   if(result.canceled)return {canceled:true};source=result.filePaths[0];
  }else if(action==='restore'){previous=await saved();source=previous?.source||'builtin';}
  else if(action!=='builtin')throw new Error('未知 OCIO 配置操作。');
  return {...await config(source),selection:previous};
 });
 handle('ocio-build',async value=>({processor:await service.request({action:'build',...selection(value)})}));
 handle('ocio-save',async value=>{
  const preferences={...selection(value),enabled:value.enabled===true};
  activeId=value.id;
  saving=saving.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(settingsFile),{recursive:true});await fs.writeFile(settingsFile,JSON.stringify(preferences,null,2),'utf8');});
  await saving;return {};
 });
 return service;
}
module.exports={installColor};
