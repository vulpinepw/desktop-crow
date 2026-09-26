'use strict';

const koffi = require('koffi');

const GW_HWNDNEXT = 2;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_CHILD = 0x40000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;
const DWMWA_TEXT_COLOR = 36;
const DWMWA_COLOR_NONE = 0xfffffffe;

const SKIP_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'Windows.UI.Core.CoreWindow', 'ForegroundStaging', 'MultitaskingViewFrame', 'XamlExplorerHostIslandWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Xaml_WindowedPopupClass', 'SysShadow', 'tooltips_class32', '#32768',
  'IME', 'MSCTFIME UI', 'CiceroUIWndFrame', 'EdgeUiInputTopWndClass', 'ApplicationManager_DesktopShellWindow',
  'Shell_InputSwitchTopLevelWindow', 'NarratorHelperWindow', 'Windows.Internal.Shell.TabProxyWindow',
]);

let api = null;

function init() {
  if (api) return api;
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const RECT = koffi.struct('DC_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  api = {
    RECT,
    GetTopWindow: user32.func('GetTopWindow', 'void *', ['void *']),
    GetWindow: user32.func('GetWindow', 'void *', ['void *', 'uint32_t']),
    IsWindowVisible: user32.func('IsWindowVisible', 'int', ['void *']),
    IsIconic: user32.func('IsIconic', 'int', ['void *']),
    GetWindowRect: user32.func('GetWindowRect', 'int', ['void *', koffi.out(koffi.pointer(RECT))]),
    GetWindowLongW: user32.func('GetWindowLongW', 'int32_t', ['void *', 'int']),
    GetWindowThreadProcessId: user32.func('GetWindowThreadProcessId', 'uint32_t', ['void *', koffi.out(koffi.pointer('uint32_t'))]),
    GetClassNameW: user32.func('GetClassNameW', 'int', ['void *', 'void *', 'int']),
    GetWindowTextLengthW: user32.func('GetWindowTextLengthW', 'int', ['void *']),
    DwmRect: dwmapi.func('DwmGetWindowAttribute', 'int32_t', ['void *', 'uint32_t', koffi.out(koffi.pointer(RECT)), 'uint32_t']),
    DwmInt: dwmapi.func('DwmGetWindowAttribute', 'int32_t', ['void *', 'uint32_t', koffi.out(koffi.pointer('int32_t')), 'uint32_t']),
    DwmSet: dwmapi.func('DwmSetWindowAttribute', 'int32_t', ['uintptr_t', 'uint32_t', 'void *', 'uint32_t']),
    GetAsyncKeyState: user32.func('GetAsyncKeyState', 'int16_t', ['int']),
    GetSystemMetrics: user32.func('GetSystemMetrics', 'int', ['int']),
  };
  return api;
}

const SM_SWAPBUTTON = 23;

function primaryButtonDown() {
  init();
  const vk = api.GetSystemMetrics(SM_SWAPBUTTON) ? 0x02 : 0x01;
  return (api.GetAsyncKeyState(vk) & 0x8000) !== 0;
}

const classCache = new Map();
const classBuf = Buffer.alloc(512);

function className(hwnd) {
  const key = String(hwnd);
  let c = classCache.get(key);
  if (c != null) return c;
  const n = api.GetClassNameW(hwnd, classBuf, 256);
  c = n > 0 ? classBuf.toString('utf16le', 0, n * 2) : '';
  if (classCache.size > 4000) classCache.clear();
  classCache.set(key, c);
  return c;
}

function listWindows(ownPid = process.pid) {
  init();
  const out = [];
  let h = api.GetTopWindow(null);
  const rect = {};
  const pid = [0];
  const cloaked = [0];
  let guard = 0;
  while (h && guard++ < 5000) {
    const hwnd = h;
    h = api.GetWindow(hwnd, GW_HWNDNEXT);
    if (!api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) continue;
    const style = api.GetWindowLongW(hwnd, GWL_STYLE);
    if (style & WS_CHILD) continue;
    const ex = api.GetWindowLongW(hwnd, GWL_EXSTYLE);
    if ((ex & WS_EX_TRANSPARENT) && (ex & WS_EX_LAYERED)) continue;
    api.GetWindowThreadProcessId(hwnd, pid);
    if (pid[0] === ownPid) continue;
    const cls = className(hwnd);
    if (SKIP_CLASSES.has(cls)) continue;
    cloaked[0] = 0;
    if (api.DwmInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) continue;
    let ok = api.DwmRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) === 0;
    if (!ok) ok = !!api.GetWindowRect(hwnd, rect);
    if (!ok) continue;
    const w = rect.right - rect.left;
    const hgt = rect.bottom - rect.top;
    if (w < 40 || hgt < 24) continue;
    const titled = api.GetWindowTextLengthW(hwnd) > 0;
    out.push({
      id: String(hwnd),
      x: rect.left,
      y: rect.top,
      width: w,
      height: hgt,
      occluderOnly: !titled || !!(ex & WS_EX_TOOLWINDOW) || !!(ex & WS_EX_NOACTIVATE),
      cls,
    });
  }
  return out;
}

function colorRef(value) {
  if (value === 'none') return DWMWA_COLOR_NONE;
  const m = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
}

function tintWindow(handle, colors) {
  init();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  let applied = 0;
  for (const [attr, value] of [[DWMWA_CAPTION_COLOR, colors.caption], [DWMWA_TEXT_COLOR, colors.text], [DWMWA_BORDER_COLOR, colors.border]]) {
    const ref = colorRef(value);
    if (ref == null) continue;
    if (api.DwmSet(hwnd, attr, new Uint32Array([ref >>> 0]), 4) === 0) applied++;
  }
  return applied;
}

module.exports = { listWindows, primaryButtonDown, tintWindow, init };
