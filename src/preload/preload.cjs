// SPDX-License-Identifier: GPL-3.0-or-later
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('owl', {
  viewerSettings: () => ipcRenderer.invoke('viewer-settings'),
  openLogDirectory: () => ipcRenderer.invoke('open-log-directory'),
  setDefaultExr: () => ipcRenderer.invoke('set-default-exr'),
  perfLog: events => ipcRenderer.invoke('perf-log', events),
  onLogStatus: callback => ipcRenderer.on('perf-log-status',(_event,status)=>callback(status)),
  onPerfClose: callback => ipcRenderer.on('perf-close',()=>callback()),
  perfCloseReady: () => ipcRenderer.invoke('perf-close-ready'),
  saveViewerSettings: value => ipcRenderer.invoke('save-viewer-settings',value),
  ocioState: () => ipcRenderer.invoke('ocio-state'),
  ocioConfig: action => ipcRenderer.invoke('ocio-config',action),
  ocioBuild: selection => ipcRenderer.invoke('ocio-build',selection),
  ocioSave: selection => ipcRenderer.invoke('ocio-save',selection),
  discoverSequence: file => ipcRenderer.invoke('sequence-discover', file),
  sequenceFrame: (token, index, preview = null, divisor = 1) => ipcRenderer.invoke('sequence-frame', token, index, preview, divisor),
  previewExr: (file, view, divisor, maxEdge=0) => ipcRenderer.invoke('preview-exr',file,view,divisor,maxEdge),
  cancelRead: () => ipcRenderer.invoke('cancel-read'),
  dragWindow: (action, point) => ipcRenderer.send('window-drag', action, point),
  windowControl: action => ipcRenderer.invoke('window-control', action),
  onFullscreenChanged: callback => ipcRenderer.on('fullscreen-changed', (_event,enabled) => callback(enabled)),
  pickExr: () => ipcRenderer.invoke('pick-exr'),
  openExr: file => ipcRenderer.invoke('read-exr', file),
  demo: () => ipcRenderer.invoke('demo-exr'),
  droppedPath: file => ipcRenderer.invoke('read-exr', webUtils.getPathForFile(file)),
  onOpen: callback => {
    const listener = (_event, file) => callback(ipcRenderer.invoke('read-exr', file));
    ipcRenderer.on('open-request', listener);
    ipcRenderer.send('renderer-ready');
    return () => ipcRenderer.removeListener('open-request', listener);
  }
});

