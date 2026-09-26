'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const outDir = path.join(__dirname, '..', 'qa', 'out');

app.whenReady().then(() => {
  fs.mkdirSync(outDir, { recursive: true });
  ipcMain.handle('qa:save', (_e, name, dataUrl) => {
    const safe = String(name).replace(/[^a-z0-9._-]/gi, '_');
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const buf = meta.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
    fs.writeFileSync(path.join(outDir, safe), buf);
    console.log('wrote', safe, buf.length, 'bytes');
  });
  ipcMain.on('qa:log', (_e, msg) => console.log('[page]', msg));
  ipcMain.on('qa:done', (_e, code) => {
    app.exit(code || 0);
  });
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { preload: path.join(__dirname, 'qa', 'qa-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (_e, level, message) => console.log('[console]', message));
  const pageArg = process.argv.find((a) => a.startsWith('--page='));
  const page = pageArg ? pageArg.slice(7).replace(/[^a-z-]/gi, '') : 'qa';
  win.loadFile(path.join(__dirname, 'qa', `${page}.html`));
  setTimeout(() => {
    console.error('QA render timed out');
    app.exit(2);
  }, 240000);
});
