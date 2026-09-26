'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.join(__dirname, '..');
const files = new Map();

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

function writeAll() {
  const out = (p, buf) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    console.log('wrote', path.relative(root, p), buf.length, 'bytes');
  };
  const app = (s) => files.get(`app-${s}.png`);
  const tray = (s) => files.get(`tray-${s}.png`);
  for (const s of [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]) out(path.join(root, 'build', 'icons', `${s}x${s}.png`), app(s));
  out(path.join(root, 'build', 'icon.png'), app(512));
  out(path.join(root, 'build', 'icon.ico'), buildIco([16, 20, 24, 32, 40, 48, 64, 128, 256].map((s) => ({ size: s, png: app(s) }))));
  out(path.join(root, 'assets', 'icon.ico'), buildIco([16, 24, 32, 48, 64, 256].map((s) => ({ size: s, png: app(s) }))));
  out(path.join(root, 'assets', 'icon-256.png'), app(256));
  out(path.join(root, 'assets', 'tray.ico'), buildIco([16, 20, 24, 32, 40, 48, 64].map((s) => ({ size: s, png: tray(s) }))));
  out(path.join(root, 'assets', 'tray-32.png'), tray(32));
  out(path.join(root, 'assets', 'tray-64.png'), tray(64));
}

app.whenReady().then(() => {
  ipcMain.handle('qa:save', (_e, name, dataUrl) => {
    files.set(name, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  });
  ipcMain.on('qa:log', (_e, m) => console.log('[page]', m));
  ipcMain.on('qa:done', (_e, code) => {
    if (!code) writeAll();
    app.exit(code || 0);
  });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'qa', 'qa-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'qa', 'icons.html'));
  setTimeout(() => app.exit(3), 60000);
});
