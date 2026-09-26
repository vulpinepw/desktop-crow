'use strict';

const { BrowserWindow } = require('electron');

function intersects(a, b, pad = 0) {
  return a.x - pad < b.x + b.width && b.x - pad < a.x + a.width && a.y - pad < b.y + b.height && b.y - pad < a.y + a.height;
}

class Overlays {
  constructor(opts) {
    this.opts = opts;
    this.map = new Map();
    this.visible = true;
    this.lastTopmost = 0;
  }

  sync(displays) {
    const seen = new Set();
    for (const d of displays) {
      seen.add(d.id);
      const o = this.map.get(d.id);
      if (!o || o.win.isDestroyed()) this.create(d);
      else if (!sameRect(o.display.bounds, d.bounds)) {
        o.display = d;
        o.win.setBounds(d.bounds);
        o.win.webContents.send('overlay:init', this.initData(d));
      } else o.display = d;
    }
    for (const [id, o] of this.map) {
      if (!seen.has(id)) {
        if (!o.win.isDestroyed()) o.win.destroy();
        this.map.delete(id);
      }
    }
  }

  initData(d) {
    return { displayId: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, settings: this.opts.settings ? this.opts.settings() : {} };
  }

  create(d) {
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      roundedCorners: false,
      thickFrame: false,
      type: 'toolbar',
      title: 'Desktop Crow',
      webPreferences: {
        preload: this.opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: !!this.opts.devTools,
      },
    });
    const o = { win, display: d, ready: false, active: false, ignoring: true, cursor: 'default' };
    this.map.set(d.id, o);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('overlay:init', this.initData(o.display));
    });
    win.once('ready-to-show', () => {
      if (this.visible && !win.isDestroyed()) {
        win.showInactive();
        this.verifyBounds(o);
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('console-message', (e, lvl, msg) => {
      const level = e && e.level != null ? e.level : lvl;
      const message = e && e.message != null ? e.message : msg;
      if (level === 'error' || level === 'warning' || level >= 2) this.opts.diag && this.opts.diag(`[overlay ${d.id}] ${level}: ${message}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => this.opts.diag && this.opts.diag(`[overlay ${d.id}] renderer gone: ${JSON.stringify(details)}`));
    win.loadFile(this.opts.html);
    return o;
  }

  verifyBounds(o) {
    if (o.win.isDestroyed()) return true;
    const b = o.win.getBounds();
    const want = o.display.bounds;
    if (sameRect(b, want)) {
      o.boundsTries = 0;
      return true;
    }
    const key = JSON.stringify(want);
    if (o.boundsKey !== key) {
      o.boundsKey = key;
      o.boundsTries = 0;
    }
    if (o.boundsTries >= 2) return false;
    o.boundsTries++;
    if (this.opts.diag) this.opts.diag(`overlay ${o.display.id} bounds ${JSON.stringify(b)} != display ${JSON.stringify(want)}; correcting`);
    o.win.setBounds(want);
    return false;
  }

  markReady(webContents) {
    for (const o of this.map.values()) {
      if (!o.win.isDestroyed() && o.win.webContents === webContents) o.ready = true;
    }
  }

  displayIdFor(webContents) {
    for (const [id, o] of this.map) if (!o.win.isDestroyed() && o.win.webContents === webContents) return id;
    return null;
  }

  boundsOf(displayId) {
    const o = this.map.get(displayId);
    return o ? o.display.bounds : null;
  }

  setVisible(v) {
    this.visible = v;
    for (const o of this.map.values()) {
      if (o.win.isDestroyed()) continue;
      if (v) {
        o.win.showInactive();
        o.win.setAlwaysOnTop(true, 'screen-saver');
      } else {
        if (o.ready) o.win.webContents.send('overlay:clear');
        o.win.hide();
        o.active = false;
      }
    }
  }

  broadcast(snapshot, rects) {
    if (!this.visible) return;
    for (const o of this.map.values()) {
      if (o.win.isDestroyed() || !o.ready) continue;
      const b = o.display.bounds;
      const show = rects.some((r) => intersects(r, b, 60));
      if (show) {
        o.win.webContents.send('overlay:frame', snapshot);
        o.active = true;
      } else if (o.active) {
        o.win.webContents.send('overlay:clear');
        o.active = false;
      }
    }
  }

  sendTo(displayId, channel, data) {
    const o = this.map.get(displayId);
    if (o && !o.win.isDestroyed() && o.ready) o.win.webContents.send(channel, data);
  }

  sendAll(channel, data) {
    for (const o of this.map.values()) if (!o.win.isDestroyed() && o.ready) o.win.webContents.send(channel, data);
  }

  displayAt(x, y) {
    for (const [id, o] of this.map) {
      const b = o.display.bounds;
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return id;
    }
    return null;
  }

  updateMouse(cursor, interactive, cursorStyle) {
    let changed = false;
    const target = cursor ? this.displayAt(cursor.x, cursor.y) : null;
    for (const [id, o] of this.map) {
      if (o.win.isDestroyed()) continue;
      const capture = this.visible && interactive && id === target;
      if (o.ignoring === capture) {
        o.win.setIgnoreMouseEvents(!capture, { forward: true });
        o.ignoring = !capture;
        changed = true;
      }
      const style = capture ? cursorStyle : 'default';
      if (o.cursor !== style && o.ready) {
        o.cursor = style;
        o.win.webContents.send('overlay:cursor', style);
      }
    }
    return changed;
  }

  keepOnTop(nowMs) {
    if (!this.visible || nowMs - this.lastTopmost < 4000) return;
    this.lastTopmost = nowMs;
    for (const o of this.map.values()) {
      if (o.win.isDestroyed()) continue;
      o.win.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'win32') o.win.moveTop();
      this.verifyBounds(o);
    }
  }

  windows() {
    return [...this.map.values()].map((o) => o.win).filter((w) => !w.isDestroyed());
  }

  destroyAll() {
    for (const o of this.map.values()) if (!o.win.isDestroyed()) o.win.destroy();
    this.map.clear();
  }
}

function sameRect(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

module.exports = { Overlays, intersects };
