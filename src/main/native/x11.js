'use strict';

const koffi = require('koffi');

const XA_CARDINAL = 6;
const XA_WINDOW = 33;
const XA_ATOM = 4;
const AnyPropertyType = 0;
const IsViewable = 2;

let x = null;
let dpy = null;
let atoms = null;
let errorCount = 0;
let handlerPtr = null;

function load() {
  if (x) return x;
  const lib = koffi.load('libX11.so.6');
  const XWindowAttributes = koffi.struct('DC_XWindowAttributes', {
    x: 'int', y: 'int', width: 'int', height: 'int', border_width: 'int', depth: 'int',
    visual: 'void *', root: 'unsigned long', class: 'int', bit_gravity: 'int', win_gravity: 'int',
    backing_store: 'int', backing_planes: 'unsigned long', backing_pixel: 'unsigned long', save_under: 'int',
    colormap: 'unsigned long', map_installed: 'int', map_state: 'int', all_event_masks: 'long',
    your_event_mask: 'long', do_not_propagate_mask: 'long', override_redirect: 'int', screen: 'void *',
  });
  const ErrorHandler = koffi.proto('int DC_XErrorHandler(void *display, void *event)');
  x = {
    ErrorHandler,
    XOpenDisplay: lib.func('XOpenDisplay', 'void *', ['const char *']),
    XCloseDisplay: lib.func('XCloseDisplay', 'int', ['void *']),
    XDefaultRootWindow: lib.func('XDefaultRootWindow', 'unsigned long', ['void *']),
    XInternAtom: lib.func('XInternAtom', 'unsigned long', ['void *', 'const char *', 'int']),
    XGetWindowProperty: lib.func('XGetWindowProperty', 'int', [
      'void *', 'unsigned long', 'unsigned long', 'long', 'long', 'int', 'unsigned long',
      koffi.out(koffi.pointer('unsigned long')), koffi.out(koffi.pointer('int')),
      koffi.out(koffi.pointer('unsigned long')), koffi.out(koffi.pointer('unsigned long')),
      koffi.out(koffi.pointer('void *')),
    ]),
    XFree: lib.func('XFree', 'int', ['void *']),
    XGetGeometry: lib.func('XGetGeometry', 'int', [
      'void *', 'unsigned long', koffi.out(koffi.pointer('unsigned long')), koffi.out(koffi.pointer('int')),
      koffi.out(koffi.pointer('int')), koffi.out(koffi.pointer('unsigned int')), koffi.out(koffi.pointer('unsigned int')),
      koffi.out(koffi.pointer('unsigned int')), koffi.out(koffi.pointer('unsigned int')),
    ]),
    XTranslateCoordinates: lib.func('XTranslateCoordinates', 'int', [
      'void *', 'unsigned long', 'unsigned long', 'int', 'int',
      koffi.out(koffi.pointer('int')), koffi.out(koffi.pointer('int')), koffi.out(koffi.pointer('unsigned long')),
    ]),
    XQueryTree: lib.func('XQueryTree', 'int', [
      'void *', 'unsigned long', koffi.out(koffi.pointer('unsigned long')), koffi.out(koffi.pointer('unsigned long')),
      koffi.out(koffi.pointer('void *')), koffi.out(koffi.pointer('unsigned int')),
    ]),
    XGetWindowAttributes: lib.func('XGetWindowAttributes', 'int', ['void *', 'unsigned long', koffi.out(koffi.pointer(XWindowAttributes))]),
    XSetErrorHandler: lib.func('XSetErrorHandler', 'void *', ['void *']),
    XSync: lib.func('XSync', 'int', ['void *', 'int']),
    XQueryPointer: lib.func('XQueryPointer', 'int', [
      'void *', 'unsigned long', koffi.out(koffi.pointer('unsigned long')), koffi.out(koffi.pointer('unsigned long')),
      koffi.out(koffi.pointer('int')), koffi.out(koffi.pointer('int')), koffi.out(koffi.pointer('int')), koffi.out(koffi.pointer('int')),
      koffi.out(koffi.pointer('unsigned int')),
    ]),
  };
  return x;
}

const Button1Mask = 1 << 8;

function primaryButtonDown() {
  if (!open()) return null;
  const old = x.XSetErrorHandler(handlerPtr);
  try {
    const root = x.XDefaultRootWindow(dpy);
    const r = [0];
    const c = [0];
    const rx = [0];
    const ry = [0];
    const wx = [0];
    const wy = [0];
    const mask = [0];
    if (!x.XQueryPointer(dpy, root, r, c, rx, ry, wx, wy, mask)) return null;
    return (mask[0] & Button1Mask) !== 0;
  } finally {
    x.XSync(dpy, 0);
    x.XSetErrorHandler(old);
  }
}

function open() {
  if (dpy) return true;
  if (!process.env.DISPLAY) return false;
  load();
  dpy = x.XOpenDisplay(null);
  if (!dpy) return false;
  const a = (n) => x.XInternAtom(dpy, n, 0);
  atoms = {
    clientStacking: a('_NET_CLIENT_LIST_STACKING'),
    clientList: a('_NET_CLIENT_LIST'),
    wmState: a('_NET_WM_STATE'),
    hidden: a('_NET_WM_STATE_HIDDEN'),
    type: a('_NET_WM_WINDOW_TYPE'),
    typeNormal: a('_NET_WM_WINDOW_TYPE_NORMAL'),
    typeDialog: a('_NET_WM_WINDOW_TYPE_DIALOG'),
    typeUtility: a('_NET_WM_WINDOW_TYPE_UTILITY'),
    typeToolbar: a('_NET_WM_WINDOW_TYPE_TOOLBAR'),
    frameExtents: a('_NET_FRAME_EXTENTS'),
    gtkFrameExtents: a('_GTK_FRAME_EXTENTS'),
    pid: a('_NET_WM_PID'),
    desktop: a('_NET_WM_DESKTOP'),
    currentDesktop: a('_NET_CURRENT_DESKTOP'),
  };
  handlerPtr = koffi.register(() => {
    errorCount++;
    return 0;
  }, koffi.pointer(x.ErrorHandler));
  return true;
}

function close() {
  if (dpy) {
    try {
      x.XCloseDisplay(dpy);
    } catch {
    }
    dpy = null;
  }
  if (handlerPtr) {
    try {
      koffi.unregister(handlerPtr);
    } catch {
    }
    handlerPtr = null;
  }
}

function prop32(win, atom, type = AnyPropertyType, max = 4096) {
  const actualType = [0];
  const format = [0];
  const nitems = [0];
  const after = [0];
  const data = [null];
  const r = x.XGetWindowProperty(dpy, win, atom, 0, max, 0, type, actualType, format, nitems, after, data);
  if (r !== 0 || !data[0]) return null;
  try {
    if (format[0] !== 32 || !nitems[0]) return [];
    const vals = koffi.decode(data[0], 'unsigned long', Number(nitems[0]));
    return Array.from(vals, (v) => Number(v));
  } finally {
    x.XFree(data[0]);
  }
}

function frameOf(win, root) {
  const rootRet = [0];
  const gx = [0];
  const gy = [0];
  const gw = [0];
  const gh = [0];
  const border = [0];
  const depth = [0];
  if (!x.XGetGeometry(dpy, win, rootRet, gx, gy, gw, gh, border, depth)) return null;
  const ax = [0];
  const ay = [0];
  const child = [0];
  if (!x.XTranslateCoordinates(dpy, win, root, 0, 0, ax, ay, child)) return null;
  let left = ax[0];
  let top = ay[0];
  let width = gw[0];
  let height = gh[0];
  const fe = prop32(win, atoms.frameExtents, XA_CARDINAL, 4);
  if (fe && fe.length === 4) {
    left -= fe[0];
    top -= fe[2];
    width += fe[0] + fe[1];
    height += fe[2] + fe[3];
  }
  const ge = prop32(win, atoms.gtkFrameExtents, XA_CARDINAL, 4);
  if (ge && ge.length === 4) {
    left += ge[0];
    top += ge[2];
    width -= ge[0] + ge[1];
    height -= ge[2] + ge[3];
  }
  return { x: left, y: top, width, height };
}

function listViaEwmh(root, ownPid) {
  let ids = prop32(root, atoms.clientStacking, XA_WINDOW);
  if (!ids || !ids.length) ids = prop32(root, atoms.clientList, XA_WINDOW);
  if (!ids || !ids.length) return null;
  const cur = prop32(root, atoms.currentDesktop, XA_CARDINAL, 1);
  const curDesk = cur && cur.length ? cur[0] : null;
  const out = [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const w = ids[i];
    const pid = prop32(w, atoms.pid, XA_CARDINAL, 1);
    if (pid && pid.length && pid[0] === ownPid) continue;
    const state = prop32(w, atoms.wmState, XA_ATOM) || [];
    if (state.includes(atoms.hidden)) continue;
    const desk = prop32(w, atoms.desktop, XA_CARDINAL, 1);
    if (curDesk != null && desk && desk.length && desk[0] !== 0xffffffff && desk[0] !== curDesk) continue;
    const types = prop32(w, atoms.type, XA_ATOM) || [];
    const perch = !types.length || types.includes(atoms.typeNormal) || types.includes(atoms.typeDialog);
    const occ = perch || types.includes(atoms.typeUtility) || types.includes(atoms.typeToolbar);
    if (!occ) continue;
    const f = frameOf(w, root);
    if (!f || f.width < 40 || f.height < 24) continue;
    out.push({ id: String(w), x: f.x, y: f.y, width: f.width, height: f.height, occluderOnly: !perch });
  }
  return out;
}

function listViaQueryTree(root) {
  const rootRet = [0];
  const parent = [0];
  const children = [null];
  const n = [0];
  if (!x.XQueryTree(dpy, root, rootRet, parent, children, n) || !children[0]) return [];
  let ids = [];
  try {
    ids = Array.from(koffi.decode(children[0], 'unsigned long', n[0]), (v) => Number(v));
  } finally {
    x.XFree(children[0]);
  }
  const out = [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const attr = {};
    if (!x.XGetWindowAttributes(dpy, ids[i], attr)) continue;
    if (attr.map_state !== IsViewable || attr.override_redirect) continue;
    if (attr.width < 40 || attr.height < 24) continue;
    out.push({ id: String(ids[i]), x: attr.x, y: attr.y, width: attr.width, height: attr.height, occluderOnly: false });
  }
  return out;
}

function listWindows(ownPid = process.pid) {
  if (!open()) return [];
  const old = x.XSetErrorHandler(handlerPtr);
  try {
    const root = x.XDefaultRootWindow(dpy);
    return listViaEwmh(root, ownPid) || listViaQueryTree(root);
  } finally {
    x.XSync(dpy, 0);
    x.XSetErrorHandler(old);
  }
}

module.exports = { listWindows, primaryButtonDown, close, errors: () => errorCount };
