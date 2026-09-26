'use strict';

let impl = null;
let failed = null;

function backend() {
  if (impl || failed) return impl;
  try {
    if (process.platform === 'win32') impl = require('./win32');
    else if (process.platform === 'linux') impl = require('./x11');
    else failed = new Error(`unsupported platform ${process.platform}`);
  } catch (e) {
    failed = e;
  }
  return impl;
}

function listWindows() {
  const b = backend();
  if (!b) return [];
  try {
    return b.listWindows(process.pid);
  } catch (e) {
    failed = e;
    impl = null;
    return [];
  }
}

function primaryButtonDown() {
  const b = backend();
  if (!b || !b.primaryButtonDown) return null;
  try {
    return b.primaryButtonDown();
  } catch {
    return null;
  }
}

function tintWindow(win, colors) {
  const b = backend();
  if (!b || !b.tintWindow || !win || win.isDestroyed()) return 0;
  try {
    return b.tintWindow(win.getNativeWindowHandle(), colors);
  } catch {
    return 0;
  }
}

function status() {
  backend();
  return { available: !!impl, error: failed ? String(failed.message || failed) : null, platform: process.platform };
}

function shutdown() {
  if (impl && impl.close) impl.close();
}

module.exports = { listWindows, primaryButtonDown, tintWindow, status, shutdown };
