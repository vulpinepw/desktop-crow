'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qa', {
  save: (name, dataUrl) => ipcRenderer.invoke('qa:save', name, dataUrl),
  log: (msg) => ipcRenderer.send('qa:log', msg),
  done: (code = 0) => ipcRenderer.send('qa:done', code),
});
