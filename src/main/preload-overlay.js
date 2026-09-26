'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('crowOverlay', {
  onInit: on('overlay:init'),
  onFrame: on('overlay:frame'),
  onClear: on('overlay:clear'),
  onFx: on('overlay:fx'),
  onSound: on('overlay:sound'),
  onCursor: on('overlay:cursor'),
  onSettings: on('overlay:settings'),
  pointer: (evt) => ipcRenderer.send('overlay:pointer', evt),
  ready: () => ipcRenderer.send('overlay:ready'),
  stats: (s) => ipcRenderer.send('overlay:stats', s),
});
