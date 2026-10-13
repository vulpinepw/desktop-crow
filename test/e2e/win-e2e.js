'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const koffi = require('koffi');

const root = path.join(__dirname, '..', '..');
const exe = path.resolve(process.argv[2] || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'));
const packaged = !/electron\.exe$/i.test(exe);
const dataDir = path.join(os.tmpdir(), `dcrow-e2e-${process.pid}`);

const user32 = koffi.load('user32.dll');
const POINT = koffi.struct('E2E_POINT', { x: 'int32_t', y: 'int32_t' });
const GetCursorPos = user32.func('GetCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]);
const SetCursorPos = user32.func('SetCursorPos', 'int', ['int', 'int']);
const mouse_event = user32.func('mouse_event', 'void', ['uint32_t', 'uint32_t', 'uint32_t', 'uint32_t', 'uintptr_t']);
const GetTopWindow = user32.func('GetTopWindow', 'void *', ['void *']);
const GetWindow = user32.func('GetWindow', 'void *', ['void *', 'uint32_t']);
const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32_t', ['void *', koffi.out(koffi.pointer('uint32_t'))]);
const GetWindowLongW = user32.func('GetWindowLongW', 'int32_t', ['void *', 'int']);
const IsWindowVisible = user32.func('IsWindowVisible', 'int', ['void *']);
const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void *', 'void *', 'int']);
const SetProcessDPIAware = user32.func('SetProcessDPIAware', 'int', []);
SetProcessDPIAware();
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_TOPMOST = 0x8;
const MOUSEEVENTF_LEFTDOWN = 0x2;
const MOUSEEVENTF_LEFTUP = 0x4;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function status() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'status.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function waitFor(pred, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

function appPids() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' } | ForEach-Object { $_.Id }`], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number);
}

function overlayWindows(pids) {
  const set = new Set(pids);
  const out = [];
  const buf = Buffer.alloc(512);
  let h = GetTopWindow(null);
  let guard = 0;
  while (h && guard++ < 5000) {
    const pid = [0];
    GetWindowThreadProcessId(h, pid);
    if (set.has(pid[0])) {
      const n = GetWindowTextW(h, buf, 256);
      const title = buf.toString('utf16le', 0, n * 2);
      if (title === 'Desktop Crow') out.push({ h, ex: GetWindowLongW(h, -20), visible: !!IsWindowVisible(h) });
    }
    h = GetWindow(h, 2);
  }
  return out;
}

function launch(extra = []) {
  const args = (packaged ? [] : [root]).concat(['--diag', `--data-dir=${dataDir}`], extra);
  const child = spawn(exe, args, { detached: false, stdio: 'ignore' });
  return child;
}

async function main() {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const seed = { version: 3, crow: { name: 'Testy', gender: 'she', setupComplete: true }, affection: { value: 300 }, settings: { scale: 1, spawnRate: 'off', activity: 'calm', sound: false, notifications: false, cursorReactions: false } };
  fs.writeFileSync(path.join(dataDir, 'save.json'), JSON.stringify(seed));
  const cmds = [];
  fs.writeFileSync(path.join(dataDir, 'cmds.json'), JSON.stringify(cmds));
  const savedCursor = {};
  GetCursorPos(savedCursor);

  launch([`--test-commands=${path.join(dataDir, 'cmds.json')}`]);
  const sb = await waitFor(() => {
    const s = status();
    return s && s.box && s.box.state === 'closed' && s.fps > 0 ? s : null;
  }, 20000);
  check('app starts, the crow waits in a taped box', !!sb, sb ? `fps=${sb.fps} box at ${sb.box.x.toFixed(0)},${sb.box.y.toFixed(0)}` : 'no box');
  if (!sb) return finish();
  const disp = sb.displays[0];
  const sf = disp.scaleFactor;
  const bx = sb.box.rect.x + sb.box.rect.width / 2;
  const by = sb.box.rect.y + sb.box.rect.height * 0.55;
  const pids0 = appPids();
  SetCursorPos(Math.round(bx * sf), Math.round(by * sf));
  const overBox = await waitFor(() => {
    const ws = overlayWindows(pids0);
    return ws.length && ws.some((x) => !(x.ex & WS_EX_TRANSPARENT)) ? ws : null;
  }, 2000, 40);
  check('the overlay captures the mouse over the box', !!overBox);
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  await sleep(60);
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  const s0 = await waitFor(() => {
    const s = status();
    return s && !s.boxed && s.crow && s.crow.visible && !s.crow.airborne && s.crow.state !== 'away' && s.stats && s.fps > 0 && s.t > 0 && s.crow.state !== 'fly' && Math.hypot(s.crow.x - sb.box.x, s.crow.y - sb.box.y) > 40 ? s : null;
  }, 15000);
  check('clicking the box lets the crow out; it flies out and lands', !!s0, s0 ? `landed at ${s0.crow.x.toFixed(0)},${s0.crow.y.toFixed(0)}` : `state ${JSON.stringify((status() || {}).crow || null).slice(0, 120)}`);
  if (!s0) return finish();
  check('one overlay per display, exactly covering it', s0.overlays.length === s0.displays.length && s0.overlays.every((o, i) => JSON.stringify(o.bounds) === JSON.stringify(s0.displays[i].bounds)), JSON.stringify(s0.overlays.map((o) => o.bounds)));
  const sn = await waitFor(() => {
    const s = status();
    return s && s.native && s.native.available && s.windows > 0 ? s : null;
  }, 5000);
  check('native window tracking works (other windows are seen)', !!sn, sn ? `${sn.windows} windows, ${sn.perches} perches` : JSON.stringify((status() || {}).native || null).slice(0, 200));
  const wa = disp.workArea;
  const onFloor = (c) => c.z === 0 && !c.airborne && c.x >= wa.x + 47 && c.x <= wa.x + wa.width - 47 && c.y >= wa.y + 71 && c.y <= wa.y + wa.height - 21;
  check('crow stands on the desktop (anywhere on the work area, not just the bottom)', onFloor(s0.crow) || (s0.crow.perch && s0.crow.perch.kind), `x=${s0.crow.x.toFixed(1)} y=${s0.crow.y.toFixed(1)} work area ${JSON.stringify(wa)}`);

  await sleep(1500);
  const pids = appPids();
  check('app processes found (main + helpers)', pids.length >= 2, `${pids.length} processes`);
  let wins = overlayWindows(pids);
  check('overlay window is topmost', wins.length > 0 && wins.every((w) => w.ex & WS_EX_TOPMOST), wins.map((w) => w.ex.toString(16)).join(','));
  const s1 = status();
  const farX = s1.crow.x > disp.bounds.width / 2 ? 40 : disp.bounds.width - 40;
  const farY = s1.crow.y > disp.bounds.height / 2 ? disp.workArea.y + 80 : disp.workArea.y + disp.workArea.height - 80;
  SetCursorPos(Math.round(farX * sf), Math.round(farY * sf));
  await sleep(400);
  wins = overlayWindows(pids);
  check('click-through away from the crow (WS_EX_TRANSPARENT set)', wins.length && wins.every((w) => w.ex & WS_EX_TRANSPARENT));
  const hoverCrow = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = await waitFor(() => {
        const q = status();
        return q && !q.crow.airborne && ['idle', 'perch', 'peck', 'sleep', 'land'].includes(q.crow.state) ? q : null;
      }, 15000);
      if (!s) return null;
      const bx = s.crow.x;
      const by = s.crow.y - 24;
      SetCursorPos(Math.round(bx * sf), Math.round(by * sf));
      const w = await waitFor(() => {
        const ws = overlayWindows(pids);
        return ws.length && ws.some((x) => !(x.ex & WS_EX_TRANSPARENT)) ? ws : null;
      }, 700, 40);
      if (w) return { x: bx, y: by };
    }
    return null;
  };
  let at = await hoverCrow();
  check('overlay captures the mouse while hovering the crow', !!at);
  if (at) {
    const before = fs.readFileSync(path.join(dataDir, 'diag.log'), 'utf8').length;
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    await sleep(60);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    const reacted = await waitFor(() => (/->reactClick/.test(fs.readFileSync(path.join(dataDir, 'diag.log'), 'utf8').slice(before)) ? true : null), 2000, 50);
    check('clicking the crow triggers react-to-click', !!reacted);
    const said = await waitFor(() => (status() || {}).bubble, 2000, 50);
    check('and it tells you how it feels in a bubble', !!said, said ? `bubble: ${said}` : '');
  }
  await sleep(2500);
  at = await hoverCrow();
  if (at) {
    const petsBefore = (status().stats || {}).pets || 0;
    for (let i = 0; i < 24; i++) {
      const dx = i % 2 ? 18 : -18;
      for (let j = 0; j <= 6; j++) {
        SetCursorPos(Math.round((at.x - dx + (2 * dx * j) / 6) * sf), Math.round(at.y * sf));
        await sleep(20);
      }
    }
    const petted = await waitFor(() => (((status() || {}).stats || {}).pets || 0) > petsBefore, 2000, 50);
    check('stroking the pointer over the crow (no click) pets it', !!petted, `pets ${((status() || {}).stats || {}).pets}`);
    SetCursorPos(Math.round(farX * sf), Math.round(farY * sf));
  } else check('stroking the pointer over the crow (no click) pets it', false, 'could not hover the crow');
  await sleep(2500);
  at = await hoverCrow();
  if (at) {
    const to = { x: at.x > disp.bounds.width / 2 ? at.x - 360 : at.x + 360, y: at.y > disp.bounds.height / 2 ? at.y - 220 : at.y + 220 };
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    await sleep(80);
    for (let i = 1; i <= 30; i++) {
      SetCursorPos(Math.round((at.x + ((to.x - at.x) * i) / 30) * sf), Math.round((at.y + ((to.y - at.y) * i) / 30) * sf));
      await sleep(25);
    }
    const held = await waitFor(() => {
      const s = status();
      return s && s.crow.held ? s : null;
    }, 1500, 50);
    check('pressing on the crow and moving picks it up', !!held, held ? `held at ${held.crow.x.toFixed(0)},${held.crow.y.toFixed(0)}` : `state ${(status() || {}).crow && status().crow.state}`);
    for (let i = 0; i < 45; i++) {
      SetCursorPos(Math.round((to.x + 12 * Math.sin(i / 3)) * sf), Math.round((to.y + 8 * Math.cos(i / 4)) * sf));
      await sleep(100);
    }
    SetCursorPos(Math.round(to.x * sf), Math.round(to.y * sf));
    await sleep(150);
    const stillHeld = status();
    check('still held after 5 seconds of carrying', !!stillHeld && stillHeld.crow.held, stillHeld ? `state ${stillHeld.crow.state}` : 'no status');
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    const landed = await waitFor(() => {
      const s = status();
      return s && !s.crow.held && !s.crow.airborne && s.crow.z === 0 ? s : null;
    }, 6000, 100);
    check(
      'let go, it flutters down near where it was dropped',
      !!landed && Math.hypot(landed.crow.x - to.x, landed.crow.y - (to.y + 24)) < 180,
      landed ? `landed at ${landed.crow.x.toFixed(0)},${landed.crow.y.toFixed(0)}, dropped at ${to.x.toFixed(0)},${to.y.toFixed(0)}` : 'never landed'
    );
  } else check('pressing on the crow and moving picks it up', false, 'could not hover the crow');
  SetCursorPos(Math.round(farX * sf), Math.round(farY * sf));
  const released = await waitFor(() => {
    const w = overlayWindows(pids);
    return w.length && w.every((x) => x.ex & WS_EX_TRANSPARENT) ? w : null;
  }, 1500, 50);
  check('click-through restored after the cursor leaves', !!released);
  SetCursorPos(savedCursor.x, savedCursor.y);

  const inbox = (cmds) => {
    const f = path.join(dataDir, 'inbox.json');
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ cmds }));
    fs.renameSync(`${f}.tmp`, f);
  };
  const fedBefore = (status().stats || {}).trayFed || 0;
  inbox(['feed']);
  const dropped = await waitFor(() => (status().items || []).some((i) => i.state === 'falling' || i.state === 'resting'), 3000, 50);
  check('Feed drops a treat', !!dropped);
  const fed = await waitFor(() => ((status().stats || {}).trayFed || 0) > fedBefore, 20000, 200);
  check('the crow eats the treat (tray-fed count increases)', !!fed);
  inbox(['hide']);
  const hidden = await waitFor(() => {
    const s = status();
    return s.hidden && s.overlays.every((o) => !o.visible) ? s : null;
  }, 10000);
  check('Hide: crow flies off and the overlays are hidden', !!hidden);
  inbox(['show']);
  const shown = await waitFor(() => {
    const s = status();
    return !s.hidden && s.overlays.every((o) => o.visible) && s.crow.visible && !s.crow.airborne ? s : null;
  }, 15000);
  check('Show: overlays visible again and the crow lands', !!shown, shown ? `at ${shown.crow.x.toFixed(0)},${shown.crow.y.toFixed(0)}${shown.crow.perch ? ' on ' + shown.crow.perch.kind : ''}` : '');
  inbox(['music:Spotify', 'state:dance']);
  const danced = await waitFor(() => (/->dance/.test(fs.readFileSync(path.join(dataDir, 'diag.log'), 'utf8')) ? true : null), 5000, 100);
  check('with music playing the crow dances', !!danced);
  await sleep(1500);
  inbox(['music:off']);
  inbox(['pause']);
  const paused = await waitFor(() => {
    const s = status();
    return s.paused && s.crow.state === 'perch' ? s : null;
  }, 10000);
  check('Pause: the crow settles into a perch and stays', !!paused);

  const running = appPids().length;
  const t0 = Date.now();
  spawn(exe, (packaged ? [] : [root]).concat(['--quit', `--data-dir=${dataDir}`]), { stdio: 'ignore' });
  const gone = await waitFor(() => (appPids().length === 0 ? true : null), 8000, 150);
  check('"--quit" stops every app process (no orphans)', running > 0 && !!gone, `${running} running before, ${Date.now() - t0} ms, remaining=${appPids().join(',')}`);
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'save.json'), 'utf8'));
  } catch {
  }
  check('save written on quit', !!saved && saved.crow.name === 'Testy' && saved.app.paused === true && saved.position && Number.isFinite(saved.position.x), saved ? `pos=${JSON.stringify(saved.position)}` : 'unreadable');

  launch();
  const s2 = await waitFor(() => {
    const s = status();
    return s && s.t > t0 + 1000 && s.box && s.fps > 0 ? s : null;
  }, 20000);
  check(
    'restart loads the saved state (paused, back in its box at the same spot)',
    !!s2 && s2.paused === true && saved && Math.hypot(s2.box.x - saved.position.x, s2.box.y - saved.position.y) < 60,
    s2 ? `box at ${s2.box.x.toFixed(1)},${s2.box.y.toFixed(1)} saved ${saved && saved.position.x.toFixed(1)},${saved && saved.position.y.toFixed(1)} paused=${s2.paused}` : 'no status'
  );
  const running2 = appPids().length;
  spawn(exe, (packaged ? [] : [root]).concat(['--quit', `--data-dir=${dataDir}`]), { stdio: 'ignore' });
  const gone2 = await waitFor(() => (appPids().length === 0 ? true : null), 8000, 150);
  check('second quit also leaves no processes', running2 > 0 && !!gone2, `${running2} running before`);
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.mkdirSync(path.join(root, 'qa', 'out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qa', 'out', `e2e-win${packaged ? '-packaged' : ''}.json`), JSON.stringify({ exe, results }, null, 2));
  if (failed.length) console.log(`app data (diag.log, status.json): ${dataDir}`);
  else fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
