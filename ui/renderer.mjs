// SPDX-License-Identifier: GPL-3.0-or-later
import { createLayerViews, componentView, handleViewerKey } from '../src/core/views.mjs';
import { unpackPreview } from './preview.mjs';
import { FrameCache } from '../src/core/sequence.mjs';
import { describeLayer as describeSourceLayer, findView } from '../src/core/sequence.mjs';
import { createSequencePlayer } from './sequence.mjs';
import {createColorController} from './color.mjs';
import { GpuViewer } from '../src/render/viewer.mjs';
import {createOperationLog,createUiMetrics} from './perf.mjs';
const $ = id => document.getElementById(id);
let frame = null, views = [], state = { selected: 0, grid: false }, generation = 0, currentPath = '';
const viewCache = new FrameCache(192 * 1024**2, 64);
let gpu = null, thumbnailGpu = null, observer = null;
let zoom = 1, panX = 0, panY = 0, fit = true, lastName = '', loading = false;
let layers = [], component = 'RGBA', previewRevision = 0;
const thumbs = new Map();
let presentedView = null, color = null, ocioPack = null;
let textureIndex = -1, previewBusy = false, queuedMain = null, activePreview = null;
const queuedThumbs = new Map();
let idleTimer=0;const idleAttempts=new Set();let recentLayers=[];
let rangeMode=$('display-mode').value==='range';
const componentIndex=view=>view?.component?'RGBA'.indexOf(view.component):-1;
const setText=(el,text)=>{if(el.textContent!==text)el.textContent=text;};
let stageW=0,stageH=0;
const perf=$('perf-status');
const layersMemo={sig:'',layers:[],views:[]};
// Rebuild the layer/component list only when the header content actually changes.
// The signature preserves part order, names and channel lists, so any reorder or
// channel change still rebuilds; identical headers reuse the sorted view list.
function layerViews(parts){
  const sig=JSON.stringify(parts.map(p=>[p.name||'',p.channels]))+'#'+component;
  if(layersMemo.sig!==sig){layersMemo.layers=createLayerViews(parts);layersMemo.views=layersMemo.layers.map(l=>componentView(l,component));layersMemo.sig=sig;}
  return layersMemo;
}
let logEnabled=true,logStart=performance.now(),logBuffer=[],logSending=false,logDrain=Promise.resolve(),logCounter=0,closingLog=false;
const operations=createOperationLog((kind,data)=>logEvent(kind,data)),uiMetrics=createUiMetrics();
let loggingWarning='';
function safeText(value){return String(value).replace(/[A-Za-z]:\\[^"'\r\n]+/g,'[path]').replace(/\\\\[^"'\r\n]+/g,'[path]');}
function loggingStatus(status){
  if(!status)return;
  const message=status.error?'性能日志未保存：'+status.error+'。请将程序放到可写文件夹后重试。':status.capped?'性能日志已达到 8 MiB 上限，本次后续操作不再记录。':status.enabled?'日志位置：'+status.directory:'性能日志已关闭';
  if(status.directory)$('open-log-directory').title='打开日志目录：'+status.directory;
  if(status.error||status.capped){loggingWarning=message;$('log-warning').textContent=message;$('log-warning').hidden=false;}
}
async function flushLog(){
  if(logSending){await logDrain;if(logBuffer.length)return flushLog();return;}
  if(!logBuffer.length)return;
  const batch=logBuffer.splice(0,128);logSending=true;
  logDrain=window.owl.perfLog(batch).then(loggingStatus).catch(()=>loggingStatus({error:'通信失败'})).finally(()=>{logSending=false;});
  await logDrain;if(logBuffer.length)return flushLog();
}
function logEvent(kind,data={}){
  if(!logEnabled)return;
  if(logBuffer.length>=1024){loggingStatus({error:'记录队列积压'});return;}
  logBuffer.push({t:Date.now(),dt:Math.round(performance.now()-logStart),rendererMs:performance.now(),rendererEventId:++logCounter,e:kind,...data});
}
function submitted(view){
  if(!view)return;
  operations.submitted(view.id,component,{file:lastName,layer:view.label,component,frameIndex:sequence.index});
}
function stopIdle(){clearTimeout(idleTimer);idleTimer=0;}
function interruptIdle(){
  stopIdle();
  if(activePreview?.kind==='warm'){
    generation++;previewBusy=false;activePreview=null;window.owl.cancelRead().catch(()=>{});
  }
}
function scheduleIdle(){
  if(idleTimer||sequence.active||sequence.playing||!frame||state.grid||loading||document.hidden)return;
  idleTimer=setTimeout(()=>{
    idleTimer=0;if(sequence.active||sequence.playing||state.grid||previewBusy||queuedMain||!frame||document.hidden)return;
    const others=layers.map((layer,index)=>index).filter(i=>i!==state.selected);
    const rank=i=>{const n=recentLayers.indexOf(layers[i].id);return n<0?2:n;};
    others.sort((a,b)=>rank(a)-rank(b));
    for(const index of others.slice(0,2)){
      const part=frame.parts[layers[index].part],descriptor=describeLayer(frame.parts,layers[index]);
      const divisor=sequence.divisor,key=JSON.stringify([currentPath,descriptor,divisor,0]);
      if(idleAttempts.has(key)||viewCache.entries.has(key))continue;
      idleAttempts.add(key);
      if(Math.ceil(part.width/divisor)*Math.ceil(part.height/divisor)*16+4096>viewCache.budget-viewCache.bytes)continue;
      queuedMain={kind:'warm',index};pumpPreview();break;
    }
  },600);
}

function fail(message) { operations.cancelAll('failed');logEvent('error',{where:'ui',message:safeText(message).slice(0,300)});flushLog();$('error-text').textContent = message; $('error').hidden = false; }
function setBusy(value, text = '正在读取 EXR…') { loading = value; $('busy').hidden = !value; $('busy-text').textContent = text; }
function closeMenu() { $('context-menu').hidden = true; }
function colorMode(view) { return $('display-mode').value === 'range' ? 2 : $('display-mode').value === 'raw' ? 0 : !view.color ? 0 : $('display-mode').value === 'ocio' && color?.ready ? 3 : 1; }
function describeLayer(parts,view) {
  const descriptor=describeSourceLayer(parts,view);
  if($('display-mode').value==='range')descriptor.range=true;
  return descriptor;
}
function getGpu() { return gpu ||= new GpuViewer($('viewer')); }
function refreshStage() {
  const rect = $('stage').getBoundingClientRect(), dpr = devicePixelRatio;
  stageW = Math.max(1, Math.round(rect.width * dpr));
  stageH = Math.max(1, Math.round(rect.height * dpr));
}
function draw() {
  if (!frame || state.grid || !gpu || (textureIndex !== state.selected && !sequence.playing)) return;
  const dpr = devicePixelRatio;
  const drawn=gpu.draw({ width: stageW, height: stageH, zoom, panX: panX * dpr, panY: panY * dpr, checkerSize: 12 * dpr, exposure: +$('exposure').value, mode: colorMode(presentedView || views[state.selected]), component:componentIndex(presentedView || views[state.selected]), fit });
  if(drawn)submitted(presentedView||views[state.selected]);
}
function resetView() { zoom = 1; panX = panY = 0; fit = true; draw(); }
function setSelection(index, exitGrid = true, source='menu') {
  if (!views[index]) return;
  if(index!==state.selected){operations.finish('open','superseded');operations.start('layer',{source,from:views[state.selected]?.label||'',to:views[index].label||'',playing:sequence.playing,frameIndex:sequence.index});operations.target('layer',views[index].id,component);}
  interruptIdle();idleAttempts.clear();
  if(layers[state.selected]&&index!==state.selected)recentLayers=[layers[state.selected].id,...recentLayers.filter(id=>id!==layers[state.selected].id)].slice(0,2);
  state = { selected: index, grid: exitGrid ? false : state.grid };
  sequence.viewChanged(); updateView();
}
function updateView() {
  const has = !!frame;
  $('empty').hidden = has; $('viewer').hidden = !has || state.grid || (textureIndex !== state.selected && !(sequence.playing && presentedView)); $('viewer-info').hidden = !has; $('grid').hidden = !has || !state.grid;
  if (!has) return;
  const view = sequence.playing && presentedView ? presentedView : views[state.selected], part = frame.parts[view.part];
  setText($('image-label'), view.label + (view.component ? ` · ${view.component}` : '') + (sequence.switching ? ' · 切换中…' : ''));
  setText($('status'), $('display-mode').value==='ocio' ? color?.status(view) || 'OCIO 准备中' : colorMode(view) === 2 ? '范围映射 · 非原始亮度 · 非 OCIO' : '基础预览 · 非 OCIO');
  setText($('metadata'), `${part.width} × ${part.height}  ·  ${frame.parts.length} Part  ·  ${frame.parts.reduce((n,p)=>n+p.channels.length,0)} 通道  ·  ${state.selected + 1}/${views.length}  ·  ${Math.round(frame.decodeMs)} ms 解码`);
  if(state.grid)document.querySelectorAll('[data-view]').forEach(el => {
    const selected = Number(el.dataset.view) === state.selected;
    el.classList.toggle('selected', selected);
    if (el.getAttribute('role') === 'option') el.setAttribute('aria-selected', String(selected));
  });
  if(!$('context-menu').hidden)document.querySelectorAll('[data-menu-view]').forEach(item => {
    const index = Number(item.dataset.menuView), layer = views[index];
    if (!layer) return;
    item.setAttribute('aria-checked', String(index === state.selected));
    item.textContent = `${index === state.selected ? '✓  ' : ''}${layer.label}`;
  });
  if (state.grid) ensureGrid(); else { ensureMainPreview(); draw(); }
}
function renderChannels() { updateView(); if (!$('context-menu').hidden) menuItems(); }
function ensureMainPreview() {
  if (!frame || sequence.playing || textureIndex === state.selected) return;
  if (activePreview?.kind === 'main' && activePreview.index === state.selected && activePreview.revision === previewRevision) return;
  queuedMain = { kind: 'main', index: state.selected };
  pumpPreview();
}
function paintThumbnail(index, canvas) {
  if (!frame || !canvas.isConnected || canvas.dataset.inView !== 'true') return;
  queuedThumbs.set(index, { kind: 'thumb', index, canvas });
  pumpPreview();
}
function pumpPreview() {
  if (previewBusy || !frame) return;
  let job = queuedMain; queuedMain = null;
  while (!job && queuedThumbs.size) {
    const [key, next] = queuedThumbs.entries().next().value; queuedThumbs.delete(key);
    if (state.grid && next.canvas.isConnected && next.canvas.dataset.inView === 'true') job = next;
  }
  if (!job) {scheduleIdle();return;}
  const view = layers[job.index];
  job.revision = previewRevision; activePreview = job; previewBusy = true;
  const request = generation, descriptor = describeLayer(frame.parts,view), divisor = sequence.divisor, maxEdge = job.kind === 'thumb' ? 300 : 0;
  const key = JSON.stringify([currentPath,descriptor,divisor,maxEdge]), cached = (job.kind==='main'?sequence.cachedPreview(descriptor):null)||viewCache.get(key);
  const deliver = entry => {
    if (request !== generation || activePreview !== job) return;
    if(job.kind==='main')sequence.rememberPreview(entry,descriptor);
    receivePreview({data:{type:'preview',ok:true,packed:entry.packed}});
  };
  if (cached) { deliver(cached); return; }
  window.owl.previewExr(currentPath,descriptor,divisor,maxEdge).then(result => {
    if(request !== generation || activePreview !== job)return;
    logEvent('preview-ready',{kind:job.kind,layer:layers[job.index]?.label,file:result.name,requestId:result.requestId,timing:result.timing,mainReadMs:result.mainReadMs});
    const entry=unpackPreview(result);if(!sequence.active||job.kind!=='main')viewCache.put(key,entry);deliver(entry);
  }).catch(error=>{if(request === generation && activePreview === job)receivePreview({data:{type:'preview',ok:false,error:error.message}});});
}
function receivePreview({ data }) {
  if (data.type !== 'preview') return;
  const job = activePreview; previewBusy = false; activePreview = null;
  if (!job) return;
  if (job.revision !== previewRevision) { pumpPreview(); return; }
  if (!data.ok) { if (job.kind==='warm'||/已取消/.test(data.error)) {pumpPreview();return;} fail(data.error); return; }
  try {
    if (job.kind === 'main' && job.index === state.selected) {
      operations.stage('open','pixels-ready',{layer:views[job.index]?.label});
      operations.stage('layer','pixels-ready',{layer:views[job.index]?.label});
      getGpu().upload(data.packed); presentedView=views[job.index]; textureIndex = job.index; updateView();
    } else if (job.kind === 'thumb' && job.canvas.isConnected && job.canvas.dataset.inView === 'true') {
      thumbnailGpu ||= new GpuViewer(document.createElement('canvas'),{cacheBytes:8*1024**2,cacheFrames:1,preserveDrawingBuffer:true});
      if(ocioPack)thumbnailGpu.commitColor(thumbnailGpu.prepareColor(ocioPack));
      thumbnailGpu.upload(data.packed);
      thumbnailGpu.draw({ width: 320, height: 200, mode: colorMode(views[job.index]), component:componentIndex(views[job.index]), exposure: +$('exposure').value });
      job.canvas.width = 320; job.canvas.height = 200;
      job.canvas.getContext('2d').drawImage(thumbnailGpu.canvas, 0, 0);
      job.canvas.dataset.painted = 'true';
    }
  } catch (error) { fail(error.message); }
  pumpPreview();
}
function ensureGrid() {
  if (thumbs.size) return;
  observer?.disconnect(); $('grid').replaceChildren();
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const canvas = entry.target, index = Number(canvas.dataset.index);
      canvas.dataset.inView = String(entry.isIntersecting);
      if (entry.isIntersecting && canvas.dataset.painted !== 'true') paintThumbnail(index, canvas);
      else if (!entry.isIntersecting) { queuedThumbs.delete(index); canvas.width = 1; canvas.height = 1; canvas.dataset.painted = 'false'; }
    }
  }, { root: $('grid'), rootMargin: '150px' });
  views.forEach((view, index) => {
    const tile = document.createElement('button'); tile.className = 'tile'; tile.dataset.view = index; tile.title = view.label; tile.setAttribute('aria-label', `预览 ${view.label}`);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; canvas.dataset.index = index;
    const footer = document.createElement('div'); footer.className = 'tile-footer';
    const label = document.createElement('span'); label.className = 'tile-name'; label.textContent = view.label;
    const type = document.createElement('span'); type.className = 'tile-type'; type.textContent = view.component || (view.kind === 'group' ? view.color ? 'RGBA' : 'XYZ' : 'RAW');
    footer.append(label,type); tile.append(canvas,footer); tile.onclick = () => { setSelection(index); $('stage').focus(); };
    tile.classList.toggle('selected', index === state.selected); $('grid').append(tile); thumbs.set(index, canvas); observer.observe(canvas);
  });
}
function invalidateThumbs() { observer?.disconnect(); queuedThumbs.clear(); thumbs.clear(); $('grid').replaceChildren(); if (state.grid) ensureGrid(); }

async function openResult(resultPromise) {
  const t0=performance.now();
  operations.cancelAll('file-changed');const openId=operations.start('open');
  stopIdle();idleAttempts.clear();recentLayers=[];sequence.reset(); gpu?.clearImages(); thumbnailGpu?.clearImages(); presentedView=null; const request=++generation;
  previewBusy=false;queuedMain=activePreview=null;queuedThumbs.clear();viewCache.clear();frame=null;layers=[];views=[];component='RGBA';previewRevision++;textureIndex=-1;
  invalidateThumbs();renderChannels();syncComponentButtons();$('error').hidden=true;setBusy(true);
  try {
    const result=await resultPromise;if(request!==generation)return;
    operations.stage('open','header-ready',{file:result.name||'',requestId:result.requestId,mainReadMs:result.mainReadMs,fileBytes:result.fileBytes,storage:result.storage});
    const entry=unpackPreview(result);
    $('sequence-resolution').value=String(result.resolution);applyCacheBudget(result.cacheBudget);
    frame=entry.frame;currentPath=result.path;
    layers=createLayerViews(frame.parts);views=layers;if(!views.length)throw new Error('EXR 中没有可预览通道。');
    operations.target('open',views[0].id,'RGBA');
    state={selected:0,grid:false};lastName=result.name;$('file-name').textContent=lastName;$('file-name').title=result.path;document.title=`${lastName} — OwlSight`;
    $('exposure').value='0';$('exposure-value').value='0.00';resetView();syncComponentButtons();renderChannels();$('stage').focus();
    logEvent('open',{operationId:openId,file:lastName,parts:frame.parts.length,channels:frame.parts.reduce((n,p)=>n+p.channels.length,0),resolution:Number($('sequence-resolution').value),headerUiMs:Math.round(performance.now()-t0),sourceParts:frame.parts.map(p=>({name:p.name,width:p.width,height:p.height,channels:p.channels,compression:p.compression})),fileBytes:result.fileBytes});flushLog();
    void sequence.discover(result.path).catch(error=>fail(error.message));
  } catch(error){if(request===generation)fail(error.message);}
  finally{if(request===generation)setBusy(false);}
}
const pick = async () => {
  try { const result = await window.owl.pickExr(); if (!result.canceled) await openResult(window.owl.openExr(result.file)); }
  catch (error) { fail(error.message); }
};
$('empty-open').onclick = pick;
$('demo').onclick = () => openResult(window.owl.demo());
$('dismiss-error').onclick = () => { $('error').hidden = true; $('stage').focus(); };
for (const action of ['minimize','maximize','close']) $(action).onclick = () => window.owl.windowControl(action);
async function togglePin(){
  try{$('pin').setAttribute('aria-pressed',String(await window.owl.windowControl('pin')));}
  catch(error){fail(error.message);}
}
$('pin').onclick=togglePin;
async function toggleFullscreen(){
  closeMenu();
  try{
    const enabled=await window.owl.windowControl('fullscreen');
    if(enabled&&!loading&&sequence.active&&!sequence.playing)sequence.toggle();
    $('stage').focus({preventScroll:true});
  }catch(error){fail(error.message);}
}
window.owl.onFullscreenChanged(enabled=>document.body.classList.toggle('is-fullscreen',enabled));

$('exposure').oninput = () => { $('exposure-value').value = (+$('exposure').value).toFixed(2); draw(); invalidateThumbs(); };
refreshStage();
new ResizeObserver(() => { refreshStage(); draw(); }).observe($('stage'));

// Space is an application shortcut, never native activation of a focused control.
document.addEventListener('keydown', event => {
  if(event.target.closest('#panel-settings'))return;
  if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (event.code !== 'Space') return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!event.repeat && !loading && !event.ctrlKey && !event.metaKey && !event.altKey && sequence.active) sequence.toggle();
}, true);
document.addEventListener('keyup', event => {
  if(event.target.closest('#panel-settings'))return;
  if (event.code === 'Space') { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
// Leave native selects focused while their popup is open.
document.addEventListener('click', event => {
  if (event.target.closest('button')&&!event.target.closest('#viewer-settings-form')) $('stage').focus({preventScroll:true});
});
document.addEventListener('change', event => {
  if (event.target.matches('input,select')&&!event.target.closest('#panel-settings')) $('stage').focus({preventScroll:true});
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); if(!event.repeat) pick(); return; }
  if(event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
    if(event.key.toLowerCase()==='f'){event.preventDefault();if(!event.repeat)void toggleFullscreen();return;}
    if(event.key.toLowerCase()==='t'){event.preventDefault();if(!event.repeat)void togglePin();return;}
  }
  if (event.key === 'Escape') {
    $('error').hidden = true; closeMenu(); $('stage').focus();
    if(!event.repeat)window.owl.windowControl('exit-fullscreen').catch(error=>fail(error.message));
    return;
  }
  if (event.key === 'F6') { event.preventDefault(); perf.hidden = !perf.hidden; if (!perf.hidden) renderPerf(); return; }
  const editable = !!event.target.closest('input,select,textarea,[contenteditable=true]') || !$('context-menu').hidden;
  if (loading || editable) return;
  if(frame&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&/^Digit[1-4]$/.test(event.code)){
    event.preventDefault();
    const control=$('sequence-resolution'),value=event.code.slice(-1);
    if(!event.repeat&&control.value!==value){control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));}
    return;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && sequence.active) {
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) sequence.toggle(); return; }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); if (!event.repeat) sequence.restart(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); sequence.step(event.key === 'ArrowRight' ? 1 : -1); return; }

  }
  const next = handleViewerKey(state, { key: event.key, repeat: event.repeat, editable, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey }, views.length);
  if(next!==state){event.preventDefault();const changed=next.selected!==state.selected;if(next.grid!==state.grid){sequence.pause();logEvent('grid',{enabled:next.grid});}if(changed){state={...next,selected:state.selected};setSelection(next.selected,false,'keyboard');}else{state=next;updateView();}}
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'f') resetView();
});
let drag = null, scrubTimer = 0;
function flushScrub() {
  clearTimeout(scrubTimer); scrubTimer = 0;
  if (drag?.kind === 'scrub' && drag.target !== drag.sent) {
    drag.sent = drag.target; sequence.seekTo(drag.target);
  }
}
$('stage').addEventListener('pointerdown', event => {
  if (state.grid || !frame || event.target !== $('viewer')) return;
  const pan = event.button === 1 || (event.button === 0 && event.altKey);
  if (!pan && (event.button !== 0 || !sequence.active)) return;
  event.preventDefault();
  drag = {kind:pan?'pan':'scrub', id:event.pointerId, x:event.clientX, y:event.clientY, panX, panY,
    index:sequence.index, target:sequence.index, sent:sequence.index, width:$('stage').clientWidth};
  if (!pan) sequence.pause();
  $('stage').setPointerCapture(event.pointerId); $('stage').focus();
});
$('stage').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  if (drag.kind === 'pan') { panX=drag.panX+event.clientX-drag.x; panY=drag.panY+event.clientY-drag.y; draw(); }
  else {
    drag.target=Math.max(0,Math.min(sequence.count-1,drag.index+Math.round((event.clientX-drag.x)/drag.width*(sequence.count-1))));
    $('sequence-position').value=drag.target;
    if (!scrubTimer) scrubTimer=setTimeout(flushScrub,60);
  }
});
function stopImageDrag() {flushScrub();drag=null;}
$('stage').addEventListener('pointerup', stopImageDrag);
$('stage').addEventListener('pointercancel', stopImageDrag);
$('stage').addEventListener('lostpointercapture', stopImageDrag);
window.addEventListener('blur', stopImageDrag);
$('viewer').addEventListener('dblclick', () => { fit = !fit; zoom = 1; panX = panY = 0; draw(); });
$('stage').addEventListener('wheel', event => {
  if (state.grid || !frame) return; event.preventDefault();
  const rect = $('stage').getBoundingClientRect(), next = Math.max(.05, Math.min(64, zoom * Math.exp(-event.deltaY * .0015))), ratio = next / zoom;
  const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
  panX = x - (x - panX) * ratio; panY = y - (y - panY) * ratio; zoom = next; draw();
}, { passive: false });

function syncComponentButtons() {
  document.querySelectorAll('[data-component]').forEach(button => {
    const value = button.dataset.component;
    button.setAttribute('aria-pressed', String(component === value));
    button.disabled = !layers.length || (value !== 'RGBA' && !layers.some(layer => layer.color && layer.channels?.[value] !== undefined));
  });
}
function selectComponent(value) {
  if (component === value) return;
  operations.start('component',{from:component,to:value,playing:sequence.playing});operations.target('component',views[state.selected]?.id,value);
  operations.target('layer',views[state.selected]?.id,value);operations.target('open',views[state.selected]?.id,value);
  component = value;
  views = layers.map(layer => componentView(layer, component));
  if(presentedView){const layer=layers.find(layer=>layer.id===presentedView.id);if(layer)presentedView=componentView(layer,component);}
  // Selection is a shader uniform: keep pixels, pending reads and playback clock.
  invalidateThumbs(); syncComponentButtons(); updateView();
}
document.querySelectorAll('[data-component]').forEach(button => button.onclick = () => selectComponent(button.dataset.component));
function menuItems() {
  const scrollTop = $('context-items').scrollTop;
  $('context-items').replaceChildren();
  views.forEach((view,index) => { const item = document.createElement('button'); item.setAttribute('role','menuitemradio'); item.dataset.menuView = index; item.setAttribute('aria-checked', String(index === state.selected)); item.textContent = `${index === state.selected ? '✓  ' : ''}${view.label}`; item.onclick = () => { setSelection(index); }; $('context-items').append(item); });
  $('context-items').scrollTop = scrollTop;
}
$('stage').addEventListener('contextmenu', event => {
  event.preventDefault(); if(loading || suppressContextMenu) return;
  menuItems(); const menu = $('context-menu'); menu.hidden = false;
  menu.style.left = Math.max(8,Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8,Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + 'px'; $('stage').focus();
});
document.addEventListener('pointerdown', event => { if(!event.target.closest('#context-menu')) closeMenu(); });
document.addEventListener('dragover', event => { event.preventDefault(); if(event.dataTransfer.types.includes('Files')) $('drop-hint').hidden = false; });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('drop-hint').hidden = true; });
document.addEventListener('drop', event => { event.preventDefault(); $('drop-hint').hidden = true; const file = event.dataTransfer.files[0]; if(file) openResult(window.owl.droppedPath(file)); });
window.addEventListener('beforeunload', () => { operations.cancelAll('unload');void flushLog();uiMetrics.close();stopIdle();observer?.disconnect(); gpu?.dispose(); thumbnailGpu?.dispose(); });
$('viewer').addEventListener('webglcontextlost', event => { event.preventDefault(); fail('GPU 上下文已丢失。请关闭并重新打开 OwlSight。'); });
const sequence = createSequencePlayer({
  onEvent:(kind,data)=>logEvent(kind,data),
  getDescriptor: () => frame && layers[state.selected] ? describeLayer(frame.parts,layers[state.selected]) : null,
  estimateFrameCost: () => {
    const layer=layers[state.selected],part=frame?.parts[layer?.part];
    if(!part)return 64*1024**2;
    const descriptor=describeLayer(frame.parts,layer),channels=new Set(descriptor.channels).size;
    return Math.ceil(part.width/sequence.divisor)*Math.ceil(part.height/sequence.divisor)*channels*4+4096;
  },
  getAlternates: () => frame?layers.map(layer=>{const part=frame.parts[layer.part],divisor=sequence.divisor;return {view:describeLayer(frame.parts,layer),cost:Math.ceil(part.width/divisor)*Math.ceil(part.height/divisor)*16+4096};}):[],
  onStart: () => {
    stopIdle();generation++; previewBusy = false; queuedMain = activePreview = null; state.grid = false;
    invalidateThumbs(); setBusy(false); updateView();
  },
  onPreview: (metadata, packed, result, descriptor) => {
    const {layers:nextLayers, views:nextViews} = layerViews(metadata.parts);
    const selected = findView(metadata.parts,nextLayers,sequence.targetDescriptor || descriptor);
    const visible=findView(metadata.parts,nextLayers,descriptor);
    if (selected < 0 || visible < 0) throw new Error('此帧缺少所选图层或分量。');
    const listChanged = nextViews.length !== views.length || nextViews.some((view,index) => view.id !== views[index].id || view.label !== views[index].label);
    currentPath = result.path; frame = metadata; layers = nextLayers; views = nextViews; state = {selected,grid:false};
    getGpu().upload(packed); presentedView=componentView(nextLayers[visible],component); textureIndex = sequence.switching ? -1 : selected; syncComponentButtons(); updateView();
    lastName = result.name; $('file-name').textContent = lastName; $('file-name').title = result.path; document.title = `${lastName} — OwlSight`;
    if (listChanged && !$('context-menu').hidden) menuItems();
  },
  onPrepare: candidates => gpu?.prepare(candidates),
  onResolution: ({initial=false}={}) => {
    if(initial){
      const descriptor=layers[state.selected]&&describeLayer(frame.parts,layers[state.selected]);
      const entry=descriptor&&viewCache.get(JSON.stringify([currentPath,descriptor,sequence.divisor,0]));
      if(entry)sequence.rememberPreview(entry,descriptor);
      updateView();return;
    }
    gpu?.clearImages();
    generation++;previewRevision++;previewBusy=false;queuedMain=activePreview=null;textureIndex=-1;
    invalidateThumbs();updateView();
  },
  canPrefetch: () => !loading && !previewBusy && !queuedMain && !state.grid && !document.hidden,
  onError: message => fail(typeof message === 'string' ? message : message.message)
});
window.owl.onOpen(result => openResult(Promise.resolve(result)));
function renderPerf() {
  if (perf.hidden) return;
  const p = sequence.perf(), ms = [...p.decodeMs].sort((a, b) => a - b), n = ms.length;
  const q = k => n ? ms[Math.min(n - 1, Math.floor(n * k))] : 0;
  const g = gpu?.stats || {};
  setText(perf, `解码 p50 ${q(.5).toFixed(0)} · p95 ${q(.95).toFixed(0)} ms · 解码 ${p.decodes} · 呈现 ${p.presented} · GPU 上传 ${g.uploads || 0} / 命中 ${g.hits || 0} / 复用 ${g.reuses || 0}`);
}
setInterval(renderPerf, 500);
function logEnvironment(){
  try{
    const gl=getGpu().gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
    logEvent('gpu',{renderer:ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0,120):'unknown',screen:screen.width+'x'+screen.height,dpr:devicePixelRatio,viewport:innerWidth+'x'+innerHeight});
  }catch{}
  void flushLog();
}
let reportAt=performance.now();
function logSnapshot(){
  const now=performance.now(),intervalMs=now-reportAt;reportAt=now;
  const p=sequence.perf(),detail=sequence.logSnapshot(),g=gpu?.stats||{};
  const ui=uiMetrics.snapshot(),gpuTimings=gpu?.perfSnapshot();
  if(!logEnabled)return;
  logEvent('perf',{intervalMs,fps:+detail.fps.toFixed(2),fpsScope:'submissions per playing second in this interval',
    playing:p.playing,switching:p.switching,mode:'1/'+p.divisor,selectedLayer:views[state.selected]?.label||'',
    displayedLabel:presentedView?.label||'',component,grid:state.grid,visible:!document.hidden,
    presented:p.presented,decoded:p.decodes,decodeSampleScope:'see requestGroups and reads; interval context groups',
    cacheMiB:Math.round(p.cacheBytes/1048576),cacheFrames:p.cacheFrames,budgetMiB:Math.round(p.budget/1048576),
    coverage:p.coverage,frames:p.count,gpu:{...g,textureMiB:gpu?gpu.residentBytes/1048576:0,prepareDisabled:gpu?.prepareDisabled||false,...gpuTimings},
    ui,...detail,color:color?.diagnostics?.()||null,displayMode:$('display-mode').value,exposure:Number($('exposure').value),
    viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},singleImageCacheMiB:viewCache.bytes/1048576});
}
setInterval(()=>{if(closingLog)return;logSnapshot();void flushLog();},1000);
window.owl.onLogStatus(loggingStatus);
window.owl.onPerfClose(async()=>{
  if(closingLog)return;closingLog=true;operations.cancelAll('window-close');logSnapshot();logEvent('renderer-end');
  await flushLog();await window.owl.perfCloseReady();
});
syncComponentButtons(); updateView();



// Screen coordinates remain stable while the window itself moves.
let windowDrag = null, suppressContextMenu = false;
$('stage').addEventListener('pointerdown', event => {
  if (event.button !== 2 || event.target.closest('#context-menu')) return;
  suppressContextMenu = false;
  windowDrag = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  $('stage').setPointerCapture(event.pointerId);
  window.owl.dragWindow('start', { x: event.screenX, y: event.screenY });
});
$('stage').addEventListener('pointermove', event => {
  if (!windowDrag || event.pointerId !== windowDrag.id) return;
  if (!windowDrag.moved && Math.hypot(event.screenX-windowDrag.x,event.screenY-windowDrag.y) < 5) return;
  windowDrag.moved = true; suppressContextMenu = true;
  window.owl.dragWindow('move', { x: event.screenX, y: event.screenY });
});
function stopWindowDrag() { if (windowDrag) window.owl.dragWindow('end'); windowDrag = null; }
$('stage').addEventListener('pointerup', stopWindowDrag);
$('stage').addEventListener('lostpointercapture', stopWindowDrag);
window.addEventListener('blur', stopWindowDrag);

color=createColorController({
 apply:pack=>{
  const main=getGpu();let next,thumb;
  try{next=main.prepareColor(pack);if(thumbnailGpu)thumb=thumbnailGpu.prepareColor(pack);}
  catch(error){if(next)main.discardColor(next);if(thumb)thumbnailGpu.discardColor(thumb);throw error;}
  main.commitColor(next);if(thumb)thumbnailGpu.commitColor(thumb);ocioPack=pack;
 },
 redraw:()=>{
  const nextRange=$('display-mode').value==='range';
  if(nextRange!==rangeMode){
   rangeMode=nextRange;stopIdle();idleAttempts.clear();
   generation++;previewRevision++;previewBusy=false;queuedMain=activePreview=null;textureIndex=-1;
   if(sequence.active)sequence.viewChanged();else window.owl.cancelRead().catch(error=>fail(error.message));
  }
  invalidateThumbs();updateView();
 }
});

// Keep the menu inside the window when changing to a taller tab.
function positionMenu() {
  const menu=$('context-menu');
  menu.style.left=Math.max(8,Math.min(parseFloat(menu.style.left)||8,innerWidth-menu.offsetWidth-8))+'px';
  menu.style.top=Math.max(8,Math.min(parseFloat(menu.style.top)||8,innerHeight-menu.offsetHeight-8))+'px';
}
for(const tab of document.querySelectorAll('[data-menu-tab]')) tab.onclick=()=>{
  for(const item of document.querySelectorAll('[data-menu-tab]')) {
    const selected=item===tab;
    item.setAttribute('aria-selected',String(selected));
    $('panel-'+item.dataset.menuTab).hidden=!selected;
  }
  positionMenu();
};
new ResizeObserver(()=>{if(!$('context-menu').hidden)positionMenu();}).observe($('context-menu'));
window.addEventListener('resize',()=>{if(!$('context-menu').hidden)positionMenu();});
function applyCacheBudget(budget){
  viewCache.resize(Math.min(192*1024**2,Math.floor(budget/8)));
  sequence.setBudget(budget-viewCache.budget);
  idleAttempts.clear();scheduleIdle();
}
function showPreferences(result){
  const {preferences,cacheBudget,automaticBudget,maxMemoryGiB,minimumGiB}=result;
  logEnabled=preferences.logging!==false;$('log-events').checked=logEnabled;if(!logEnabled)void flushLog();loggingStatus(result.loggingStatus);
  $('memory-limit').value=preferences.memoryGiB===null?'':String(preferences.memoryGiB);
  $('memory-limit').min=String(minimumGiB);$('memory-limit').max=String(maxMemoryGiB);
  $('memory-limit').placeholder='自动';
  $('memory-limit').title=`可输入 ${minimumGiB}–${maxMemoryGiB} GiB；留空为自动（${(automaticBudget/1024**3).toFixed(2)} GiB）。仅限制图像缓存。`;
  $('default-resolution').value=String(preferences.defaultResolution);
  applyCacheBudget(cacheBudget);
}
function settingsMessage(message,error=false){
  $('settings-message').textContent=message;$('settings-message').dataset.error=String(error);
}
$('viewer-settings-form').onsubmit=async event=>{
  event.preventDefault();
  if(!$('viewer-settings-form').reportValidity())return;
  const raw=$('memory-limit').value.trim();
  const preferences={memoryGiB:raw===''?null:Number(raw),defaultResolution:Number($('default-resolution').value),logging:logEnabled};
  $('viewer-preferences').disabled=true;settingsMessage('正在保存…');
  try{
    const result=await window.owl.saveViewerSettings(preferences);
    if(!result.ok)throw new Error(result.error);
    showPreferences(result);settingsMessage('已保存');
  }catch(error){settingsMessage(error.message,true);}
  finally{$('viewer-preferences').disabled=false;}
};
window.owl.viewerSettings().then(result=>{
  if(!result.ok)throw new Error(result.error);
  showPreferences(result);logEnvironment();
  if(!frame&&!loading)$('sequence-resolution').value=String(result.preferences.defaultResolution);
  settingsMessage('');
}).catch(error=>settingsMessage(error.message,true)).finally(()=>{$('viewer-preferences').disabled=false;});
for(const [id,className] of [['show-shortcuts','hide-shortcuts'],['show-image-info','hide-image-info']]) {
  const control=$(id),key='owlsight.ui.'+id;
  try { control.checked=localStorage.getItem(key)!=='false'; } catch {}
  const apply=()=>{if(className)document.body.classList.toggle(className,!control.checked);};
  apply();
  control.addEventListener('change',()=>{apply();try{localStorage.setItem(key,String(control.checked));}catch{}});
}
$('set-default-exr').onclick=async()=>{
  const button=$('set-default-exr');button.disabled=true;settingsMessage('正在打开默认应用设置…');
  try{
    const result=await window.owl.setDefaultExr();
    if(!result.ok)throw new Error(result.error);
    settingsMessage(result.message);
  }catch(error){settingsMessage(error.message,true);}
  finally{button.disabled=false;}
};
$('open-log-directory').onclick=async()=>{
  const button=$('open-log-directory');button.disabled=true;
  try{
    const result=await window.owl.openLogDirectory();
    if(!result.ok)throw new Error(result.error);
  }catch(error){settingsMessage('无法打开日志目录：'+error.message,true);}
  finally{button.disabled=false;}
};
$('log-events').addEventListener('change',async()=>{
  const nextLogging=$('log-events').checked;
  if(!nextLogging){operations.cancelAll('logging-disabled');logEvent('log',{enabled:false});await flushLog();}
  logEnabled=nextLogging;
  if(logEnabled)logEvent('log',{enabled:true});
  try{
    const raw=$('memory-limit').value.trim();
    const result=await window.owl.saveViewerSettings({memoryGiB:raw===''?null:Number(raw),defaultResolution:Number($('default-resolution').value),logging:logEnabled});
    if(!result.ok)throw new Error(result.error);
    showPreferences(result);settingsMessage('已保存');
  }catch(error){settingsMessage(error.message,true);}
});
