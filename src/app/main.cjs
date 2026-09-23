// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
let diagnostics;
const decoder = require('../exr/preview-pool.cjs').createPreviewPool(root,{onTelemetry:data=>diagnostics?.decoded(data)});
const { createViewerSettings } = require('./viewer-settings.cjs');
const {openExrDefaults}=require('./file-association.cjs');
const {createPerfService}=require('./perf-service.cjs');
const {discover,resolveOpenTarget}=require('./sequence.cjs');
let viewerSettings;
let sequenceSession = null, sequenceGeneration = 0, openedFile = null;
function resetSequence() { sequenceSession = null; openedFile = null; sequenceGeneration++; }
const origin = 'owlsight://app';
const limit = 256 * 1024 * 1024;
let colorService;
let window, pendingPath, rendererReady = false;
let activeReads = 0, readGeneration = 0, windowDrag = null;
// Keep development and packaged runs out of shared Electron/user profiles.
app.setPath('userData', process.env.OWLSIGHT_PROFILE_DIR || path.join(app.getPath('appData'), 'OwlSight-Prototype'));
protocol.registerSchemesAsPrivileged([{ scheme: 'owlsight', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function fileArg(argv, cwd = process.cwd()) { const file = argv.slice(1).find(arg => !arg.startsWith('-') && /\.exr$/i.test(arg)); return file ? path.resolve(cwd, file) : undefined; }
function sendOpen(file) {
  if (!file) return;
  pendingPath = file;
  if (window && rendererReady) { window.webContents.send('open-request', file); pendingPath = null; }
  window?.show(); window?.focus();
}
function authorize(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw new Error('拒绝未知窗口请求。');
}
async function readExr(file, preview = null, divisor = 1, maxEdge = 0, context = {}) {
  const readStarted=performance.now();
  const request = readGeneration;
  if (activeReads >= 4) return { ok: false, retryable: true, error: '仍有文件读取未结束，请稍后重试。最多允许四个执行或等待中的读取。' };
  activeReads++;
  const current = () => { if (request !== readGeneration) throw new Error('旧文件读取已取消。'); };
  let handle;
  try {
    if (typeof file !== 'string' || file.length > 32767 || !path.isAbsolute(file) || !/\.exr$/i.test(file)) throw new Error('请选择本地或网络盘上的 .exr 文件。');
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    current();
    if (!stat.isFile() || stat.size < 8) throw new Error('文件为空或不是普通 EXR 文件。');
    if (stat.size > limit) throw new Error('文件超过 256 MiB 读取上限。');
    const decoded = await decoder.decode(file, preview, divisor, maxEdge, context); current();
    return { ok: true, name: path.basename(file), path: file, cacheBudget:viewerSettings.state().cacheBudget, fileBytes:stat.size, storage:file.startsWith('\\\\')?'network-path':'local-or-mapped', ...decoded, mainReadMs:performance.now()-readStarted };
  } catch (error) { return { ok: false, retryable: error.code === 'PREVIEW_BUSY', error: error.message }; }
  finally { try { await handle?.close(); } finally { activeReads--; } }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  pendingPath = fileArg(process.argv);
  app.on('second-instance', (_event, argv, cwd) => sendOpen(fileArg(argv, cwd)));
  app.on('window-all-closed', async () => { await diagnostics?.close('windows-closed',false); decoder.dispose(); colorService?.dispose(); app.quit(); });
  app.whenReady().then(async () => {
    viewerSettings=await createViewerSettings(app.getPath('userData'));
    diagnostics=createPerfService({app,root,getWindow:()=>window,getDecoder:()=>decoder});
    diagnostics.setEnabled(viewerSettings.state().preferences.logging);
    protocol.handle('owlsight', request => {
      const url = new URL(request.url);
      let resource;
      try { resource = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
      const allowed = /^\/(ui|src\/(core|render|exr))\/[\w./-]+\.(html|css|mjs)$/.test(resource)
        || /^\/node_modules\/exrs\/node_modules\/exrs-raw-wasm-bindgen\/exrs_raw_wasm_bindgen(_bg\.wasm|\.js)$/.test(resource);
      const absolute = path.resolve(root, '.' + resource);
      if (url.hostname !== 'app' || !allowed || !absolute.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(absolute).href);
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // The viewer never needs remote resources, telemetry or app service traffic.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    window = new BrowserWindow({ width: 1280, height: 850, minWidth: 600, minHeight: 400, frame: false, title: 'OwlSight', backgroundColor: '#111315', show: false,
      webPreferences: { preload: path.join(root, 'src/preload/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    window.setMenu(null);
    let closeAllowed=false,closing=false,closeTimer;
    const finishClose=async rendererFlushed=>{if(closeAllowed)return;clearTimeout(closeTimer);await Promise.race([diagnostics.close('window-close',rendererFlushed),new Promise(resolve=>setTimeout(resolve,2000))]);closeAllowed=true;window?.close();};
    window.on('close',event=>{if(closeAllowed)return;event.preventDefault();if(closing)return;closing=true;
      window.webContents.send('perf-close');closeTimer=setTimeout(()=>void finishClose(false),2000);});
    ipcMain.handle('perf-close-ready',async event=>{authorize(event);void finishClose(true);return true;});
    window.webContents.on('render-process-gone',(_event,details)=>{diagnostics.record('renderer-gone',{reason:details.reason,exitCode:details.exitCode});void diagnostics.flush();});
    colorService=require('../color/settings.cjs').installColor({app,ipcMain,dialog,window,authorize,root});
    ipcMain.on('window-drag', (event, action, point) => {
      authorize(event);
      if (action === 'end') { windowDrag = null; return; }
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 100000 || Math.abs(point.y) > 100000) return;
      if (action === 'start') { windowDrag = window.isMaximized() || window.isFullScreen() ? null : { point, bounds: window.getBounds() }; return; }
      if (action === 'move' && windowDrag && !window.isMaximized() && !window.isFullScreen()) {
        const x = Math.round(windowDrag.bounds.x + point.x - windowDrag.point.x);
        const y = Math.round(windowDrag.bounds.y + point.y - windowDrag.point.y);
        if (Math.abs(x) < 100000 && Math.abs(y) < 100000) window.setPosition(x, y, false);
      }
    });
    window.on('blur', () => { windowDrag = null; });
    window.on('enter-full-screen', () => { windowDrag = null; window.webContents.send('fullscreen-changed',true); });
    window.on('leave-full-screen', () => window.webContents.send('fullscreen-changed',false));
    ipcMain.handle('window-control', (event, action) => {
      authorize(event);
      if (action === 'close') window.close();
      else if (action === 'minimize') window.minimize();
      else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
      else if (action === 'pin') { window.setAlwaysOnTop(!window.isAlwaysOnTop()); return window.isAlwaysOnTop(); }
      else if (action === 'fullscreen') { const enabled=!window.isFullScreen();window.setFullScreen(enabled);return enabled; }
      else if (action === 'exit-fullscreen') window.setFullScreen(false);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.once('ready-to-show', () => {
      window.show();
      const started=performance.now();
      void decoder.warmup().then(results=>diagnostics.record('decoder-warmup',{totalMs:performance.now()-started,ready:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length}));
    });
    window.on('closed', () => { window = null; rendererReady = false; });
    ipcMain.handle('pick-exr', async event => {
      authorize(event);
      const result = await dialog.showOpenDialog(window, { title: '打开 EXR', filters: [{ name: 'OpenEXR', extensions: ['exr'] }], properties: ['openFile'] });
      return result.canceled ? { canceled: true } : { file: result.filePaths[0] };
    });
    ipcMain.handle('viewer-settings', event => { authorize(event); return {ok:true,...viewerSettings.state(),loggingStatus:diagnostics.status()}; });
    ipcMain.handle('set-default-exr', async event => {
      authorize(event);
      try{return await openExrDefaults({app,shell,root});}
      catch(error){return {ok:false,error:error.message};}
    });
    ipcMain.handle('open-log-directory', async event => {
      authorize(event);
      try {
        const directory=diagnostics.status().directory;
        await fs.mkdir(directory,{recursive:true});
        const error=await shell.openPath(directory);
        return error?{ok:false,error}:{ok:true};
      } catch(error) { return {ok:false,error:error.message}; }
    });
    ipcMain.handle('perf-log',async(event,batch)=>{authorize(event);
      if(!Array.isArray(batch)||JSON.stringify(batch).length>256*1024)return {error:'INVALID_LOG_BATCH'};
      diagnostics.batch(batch);return diagnostics.flush();});
    ipcMain.handle('save-viewer-settings', async (event,value) => {
      authorize(event);
      try{const saved=await viewerSettings.save(value);diagnostics.setEnabled(saved.preferences.logging);return {ok:true,...saved,loggingStatus:diagnostics.status()};}
      catch(error){return {ok:false,error:error.message};}
    });
    async function openFile(target) {
      resetSequence(); readGeneration++; decoder.cancel(); const token = sequenceGeneration;
      const resolution=viewerSettings.state().preferences.defaultResolution;
      try{
        const resolved=await resolveOpenTarget(target,()=>token===sequenceGeneration),file=resolved.file;
        if(token!==sequenceGeneration)return {ok:false,error:'旧文件读取已取消。'};
        const result = await readExr(file,null,resolution,0,{kind:'open-header'});
        if (result.ok && token === sequenceGeneration){
          openedFile=file;
          if(resolved.sequence)sequenceSession={...resolved.sequence,token};
        }
        return {...result,resolution};
      }catch(error){return {ok:false,error:error.message};}
    }
    ipcMain.handle('read-exr', (event, file) => { authorize(event); return openFile(file); });
    ipcMain.handle('cancel-read', event => { authorize(event); readGeneration++; decoder.cancel(); });
    ipcMain.handle('sequence-discover', async (event, file) => {
      authorize(event);
      const token = sequenceGeneration;
      if (!openedFile || file !== openedFile) return { ok: false, error: '文件已切换。' };
      try {
        const found = sequenceSession || await discover(file, () => token === sequenceGeneration);
        if (token !== sequenceGeneration) return { ok: false, error: '文件已切换。' };
        sequenceSession = found ? { ...found, token } : null;
        return { ok: true, sequence: found ? { token, frames: found.frames.map(f => ({number:f.number, name:f.name})), index:found.index, gaps:found.gaps } : null };
      } catch(error) { return {ok:false,error:error.message}; }
    });
    ipcMain.handle('sequence-frame', async (event, token, index, preview, divisor = 1) => {
      authorize(event);
      const sequence = sequenceSession;
      if (!sequence || token !== sequence.token || !Number.isInteger(index) || !sequence.frames[index]) return {ok:false,error:'序列已切换或帧号无效。'};
      if (preview !== null && (!preview || typeof preview.partName !== 'string' || preview.partName.length > 1024 || !Number.isInteger(preview.partIndex) || preview.partIndex < 0 || preview.partIndex > 31 || (preview.range!==undefined&&typeof preview.range!=='boolean') || !Array.isArray(preview.channels) || ![3,4].includes(preview.channels.length) || preview.channels.some(c => typeof c !== 'string' || c.length > 1024))) return {ok:false,error:'预览通道无效。'};
      if (![1,2,3,4,8].includes(divisor)) return {ok:false,error:'无效的分辨率。'};
      const result = await readExr(sequence.frames[index].path, preview, divisor,0,{kind:'sequence',frameIndex:index,sourceFrame:sequence.frames[index].number});
      if (sequenceSession !== sequence) return {ok:false,error:'序列已切换。'};
      return result;
    });
    ipcMain.handle('preview-exr', async (event, file, preview, divisor=1, maxEdge=0) => {
      authorize(event);
      if (file !== openedFile && !sequenceSession?.frames.some(f=>f.path===file)) return {ok:false,error:'文件已切换。'};
      if (![1,2,3,4,8].includes(divisor) || ![0,300].includes(maxEdge) || !preview || typeof preview.partName!=='string' || preview.partName.length>1024 || !Number.isInteger(preview.partIndex) || preview.partIndex<0 || preview.partIndex>31 || (preview.range!==undefined&&typeof preview.range!=='boolean') || !Array.isArray(preview.channels) || ![3,4].includes(preview.channels.length) || preview.channels.some(c=>typeof c!=='string'||c.length>1024)) return {ok:false,error:'预览参数无效。'};
      return readExr(file,preview,divisor,maxEdge,{kind:maxEdge?'thumbnail':'preview'});
    });
    ipcMain.handle('demo-exr', event => { authorize(event); return openFile(path.join(root, 'resources/demo.exr'));  });
    ipcMain.on('renderer-ready', event => { authorize(event); rendererReady = true; if (pendingPath) sendOpen(pendingPath); });
    window.loadURL(origin + '/ui/index.html');
  }).catch(error => { dialog.showErrorBox('OwlSight 启动失败', error.message); app.quit(); });
}

