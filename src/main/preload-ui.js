'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crowUI', {
  getState: () => ipcRenderer.invoke('ui:state'),
  setup: (data) => ipcRenderer.invoke('ui:setup', data),
  rename: (name) => ipcRenderer.invoke('ui:rename', name),
  setGender: (g) => ipcRenderer.invoke('ui:gender', g),
  updateSettings: (patch) => ipcRenderer.invoke('ui:settings', patch),
  openDataFolder: () => ipcRenderer.invoke('ui:open-data'),
  resetCrow: () => ipcRenderer.invoke('ui:reset'),
  close: () => ipcRenderer.send('ui:close'),
  onState: (cb) => ipcRenderer.on('ui:state', (_e, d) => cb(d)),
});
