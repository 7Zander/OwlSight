// SPDX-License-Identifier: GPL-3.0-or-later
const $=id=>document.getElementById(id);
export function createColorController({apply,redraw}){
 let record=null,active=null,revision=0,timer;
 const message=text=>{$('ocio-message').textContent=text;};
 function options(id,values,selected){const el=$(id);el.replaceChildren(...values.map(value=>{const o=document.createElement('option');o.value=value;o.textContent=value;return o;}));el.value=values.includes(selected)?selected:values[0];}
 function fill(next,selected={}){
  record=next;const c=next.catalog;
  $('ocio-config-name').textContent=c.name;$('ocio-config-name').title=c.source;
  options('ocio-input',c.spaces,selected.input||c.input);
  options('ocio-display',Object.keys(c.displays),selected.display||c.display);
  const d=$('ocio-display').value;options('ocio-view',c.displays[d],selected.view||c.defaults[d]);
  const look=$('ocio-look');look.replaceChildren();
  for(const [value,label] of [['config','配置默认'],['none','无 Look'],...c.looks.map((name,i)=>['look:'+i,name])]){const o=document.createElement('option');o.value=value;o.textContent=label;look.append(o);}
  look.value=selected.lookMode==='none'?'none':selected.lookMode==='override'&&c.looks.includes(selected.look)?'look:'+c.looks.indexOf(selected.look):'config';
 }
 function selection(){const look=$('ocio-look').value;return {id:record.id,input:$('ocio-input').value,display:$('ocio-display').value,view:$('ocio-view').value,lookMode:look.startsWith('look:')?'override':look,look:look.startsWith('look:')?record.catalog.looks[Number(look.slice(5))]:''};}
 async function save(enabled){if(!active)return;const result=await window.owl.ocioSave({...active.selection,enabled});if(!result.ok)message('设置未保存：'+result.error);}
 async function build(request){
  if(!record||request!==revision)return;
  const candidate=record,chosen=selection();message('正在准备 OCIO 显示…');
  try{
   const result=await window.owl.ocioBuild(chosen);if(request!==revision)return;
   if(!result.ok)throw new Error(result.error);
   apply(result.processor);active={record:candidate,selection:chosen};
   message('OCIO GPU · 输入空间需与 EXR 的实际工作空间一致');redraw();await save($('display-mode').value==='ocio');
  }catch(error){if(request!==revision)return;if(active)fill(active.record,active.selection);message('OCIO 未更新：'+error.message);redraw();}
 }
 function schedule(){message('正在准备 OCIO 显示…');clearTimeout(timer);const request=++revision;timer=setTimeout(()=>void build(request),100);}
 async function configure(action){
  clearTimeout(timer);const request=++revision;message('正在读取 OCIO 配置…');
  try{
   const result=await window.owl.ocioConfig(action);if(request!==revision)return;
   if(result.canceled){if(active)fill(active.record,active.selection);message(active?'保留当前 OCIO 配置':'尚未启用 OCIO');return;}
   if(!result.ok)throw new Error(result.error);
   fill({id:result.id,catalog:result.catalog},result.selection||{});await build(request);
  }catch(error){if(request===revision){if(active)fill(active.record,active.selection);message('OCIO 未更新：'+error.message);redraw();}}
 }
 $('display-mode').onchange=()=>{
  const enabled=$('display-mode').value==='ocio';$('ocio-controls').hidden=!enabled;
  if(enabled){if(record)schedule();else void configure('restore');}
  else{++revision;clearTimeout(timer);void save(false);}
  redraw();
 };
 $('ocio-open').onclick=()=>void configure('pick');$('ocio-builtin').onclick=()=>void configure('builtin');
 for(const id of ['ocio-input','ocio-view','ocio-look'])$(id).onchange=schedule;
 $('ocio-display').onchange=()=>{const d=$('ocio-display').value;options('ocio-view',record.catalog.displays[d],record.catalog.defaults[d]);schedule();};
 const initial=revision;void window.owl.ocioState().then(result=>{if(revision!==initial||!result.ok||!result.enabled)return;$('display-mode').value='ocio';$('ocio-controls').hidden=false;void configure('restore');});
 return {
  get ready(){return !!active;},
  diagnostics(){return active?{ready:true,configId:active.record.id,configName:active.record.catalog.name,...active.selection}:{ready:false};},
  status(view){if(!view.color)return '数据 / 分量 Raw · 不应用 OCIO';if(!active)return 'OCIO 尚未就绪 · 暂用基础 sRGB';const s=active.selection;if(active.record.catalog.dataSpaces.includes(s.input))return '输入为数据空间 · Raw · 不应用曝光或 OCIO';return `OCIO · ${s.input} → ${s.display} / ${s.view}${s.lookMode==='override'?' · '+s.look:''}`;}
 };
}
