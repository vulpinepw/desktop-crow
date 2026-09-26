'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, Notification, shell, powerMonitor } = require('electron');

const { Storage } = require('./storage');
const { Overlays } = require('./overlays');
const native = require('./native');
const autostart = require('./autostart');
const { Game } = require('../core/game');
const { t, sanitizeName, sanitizeGender, DEFAULT_NAMES, MOOD_LABELS } = require('../core/text');
const { MediaWatcher } = require('./media');
const { defaultSave, SPAWN_RATES, ACTIVITIES, SCALE_MIN, SCALE_MAX } = require('../core/save-schema');
const { TIERS, tierIndex } = require('../core/affection');
const { ITEM_TYPES } = require('../core/items');
const { MotionChecker } = require('../core/qa');

const argv = process.argv.slice(1);
const hasFlag = (f) => argv.includes(f);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

let handedOff = false;
if (process.platform === 'linux' && !hasFlag('--ozone-platform=x11') && !hasFlag('--quit') && !process.env.DESKTOP_CROW_NO_X11) {
  const wayland = !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
  if (wayland && process.env.DISPLAY) {
    handedOff = true;
    const extracted = /appimage_extracted_/.test(process.execPath) || /appimage_extracted_/.test(process.env.APPDIR || '');
    if (extracted) {
      const os = require('os');
      const { spawn } = require('child_process');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-crow-launcher-'));
      app.setPath('userData', tmp);
      app.setPath('sessionData', tmp);
      const child = spawn(process.execPath, argv.concat(['--ozone-platform=x11']), { stdio: 'inherit' });
      const done = (code) => {
        fs.rmSync(tmp, { recursive: true, force: true });
        app.exit(typeof code === 'number' ? code : 0);
      };
      child.on('exit', done);
      child.on('error', () => done(1));
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
    } else {
      app.relaunch({ execPath: process.env.APPIMAGE || process.execPath, args: argv.concat(['--ozone-platform=x11']) });
      app.exit(0);
    }
  }
}

function resolveDataDir() {
  const fromFlag = flagValue('--data-dir');
  if (fromFlag) return path.resolve(fromFlag);
  if (process.env.DESKTOP_CROW_DATA_DIR) return path.resolve(process.env.DESKTOP_CROW_DATA_DIR);
  return path.join(app.getPath('appData'), 'desktop-crow');
}

const dataDir = resolveDataDir();
if (!handedOff) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
  }
  app.setPath('userData', dataDir);
  app.setPath('sessionData', path.join(dataDir, 'chromium'));
}
app.setName('Desktop Crow');
if (process.platform === 'win32') app.setAppUserModelId('com.desktopcrow.app');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DIAG = hasFlag('--diag') || process.env.DESKTOP_CROW_DIAG === '1';
const SETTINGS_BG = '#0b0c10';
const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const RENDERER = path.join(ROOT, 'src', 'renderer');

const quitRequest = hasFlag('--quit');
if (!handedOff) {
  const gotLock = app.requestSingleInstanceLock({ quit: quitRequest });
  if (!gotLock || quitRequest) {
    app.exit(0);
  } else {
    start();
  }
}

function start() {
  let diagStream = null;
  const diag = (msg) => {
    if (!DIAG) return;
    const line = `${new Date().toISOString()} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`;
    try {
      if (!diagStream) diagStream = fs.createWriteStream(path.join(dataDir, 'diag.log'), { flags: 'a' });
      diagStream.write(line);
    } catch {
    }
  };

  const storage = new Storage(dataDir, { log: (m) => diag(`[storage] ${m}`) });
  let game = null;
  let save = null;
  let overlays = null;
  let tray = null;
  let quitting = false;
  let loopTimer = null;
  let settingsWin = null;
  let setupWin = null;
  let renameWin = null;
  let media = null;
  let checker = DIAG ? new MotionChecker({ maxViolations: 2000 }) : null;
  const uiState = { firstRun: false };

  ipcMain.on('overlay:ready', (e) => overlays && overlays.markReady(e.sender));
  ipcMain.on('overlay:pointer', (e, evt) => {
    if (!game || !overlays || !evt || typeof evt !== 'object') return;
    const id = overlays.displayIdFor(e.sender);
    const b = id != null ? overlays.boundsOf(id) : null;
    if (!b) return;
    const x = b.x + Number(evt.x);
    const y = b.y + Number(evt.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const sim = game.sim;
    if (evt.type === 'down') sim.pointerDown(x, y, evt.button === 2 ? 2 : 0);
    else if (evt.type === 'up') sim.pointerUp(x, y);
    else if (evt.type === 'move') sim.pointerMove(x, y);
    else if (evt.type === 'context') sim.pointerDown(x, y, 2);
    else if (evt.type === 'cancel') {
      if (native.primaryButtonDown() !== true) sim.pointerCancel(x, y);
      else diag('pointer cancelled while the button is still down: drag continues');
    }
  });
  ipcMain.on('overlay:stats', (_e, s) => diag({ overlayStats: s }));

  ipcMain.handle('ui:state', () => uiSnapshot());
  ipcMain.handle('ui:setup', (_e, data) => {
    const name = sanitizeName(data && data.name, DEFAULT_NAMES[0]);
    const gender = sanitizeGender(data && data.gender);
    game.rename(name);
    game.setGender(gender);
    save.crow.setupComplete = true;
    game.markDirty();
    saveSoon();
    save.app.hidden = false;
    if (overlays) overlays.setVisible(true);
    resetClock();
    game.sim.boxCrow(null, { welcome: true });
    refreshTray();
    if (setupWin && !setupWin.isDestroyed()) setupWin.close();
    return uiSnapshot();
  });
  ipcMain.handle('ui:rename', (_e, name) => {
    game.rename(sanitizeName(name, save.crow.name));
    saveSoon();
    refreshTray();
    pushUiState();
    return uiSnapshot();
  });
  ipcMain.handle('ui:gender', (_e, g) => {
    game.setGender(sanitizeGender(g));
    saveSoon();
    refreshTray();
    pushUiState();
    return uiSnapshot();
  });
  ipcMain.handle('ui:settings', (_e, patch) => {
    applySettingsPatch(patch || {});
    return uiSnapshot();
  });
  ipcMain.handle('ui:open-data', () => shell.openPath(dataDir));
  ipcMain.handle('ui:reset', () => {
    const fresh = defaultSave(Date.now());
    fresh.crow.setupComplete = false;
    Object.keys(save).forEach((k) => delete save[k]);
    Object.assign(save, fresh);
    storage.trySave(save);
    app.relaunch();
    quitApp();
    return true;
  });
  ipcMain.on('ui:close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.close();
  });

  function uiSnapshot() {
    const s = game.summary();
    return {
      crow: s.crow,
      tier: s.tier,
      affection: s.affection,
      level: s.level,
      today: s.today,
      mood: s.mood,
      music: s.music,
      musicWatch: media ? (media.gaveUp ? 'unavailable' : media.running ? 'on' : 'off') : 'off',
      boxed: s.boxed,
      tiers: TIERS.map((x) => x.name),
      stats: s.stats,
      inventory: s.inventory,
      items: Object.fromEntries(Object.entries(ITEM_TYPES).filter(([, d]) => d.giftRarity).map(([k, d]) => [k, { name: d.name, rarity: d.giftRarity }])),
      settings: Object.assign({}, s.settings, { autostart: autostart.getAutostart() }),
      options: { spawnRates: SPAWN_RATES, activities: ACTIVITIES },
      app: s.app,
      version: app.getVersion(),
      dataDir,
      platform: process.platform,
      perching: native.status(),
      suggestions: DEFAULT_NAMES,
      firstRun: uiState.firstRun,
    };
  }

  function pushUiState() {
    for (const w of [settingsWin, setupWin, renameWin]) {
      if (w && !w.isDestroyed()) w.webContents.send('ui:state', uiSnapshot());
    }
  }

  function applySettingsPatch(patch) {
    const allowed = {};
    if ('scale' in patch && Number.isFinite(+patch.scale)) allowed.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, +patch.scale));
    if ('volume' in patch && Number.isFinite(+patch.volume)) allowed.volume = Math.min(1, Math.max(0, +patch.volume));
    for (const key of ['sound', 'notifications', 'cursorReactions', 'windowPerching', 'multiMonitor', 'musicDance']) {
      if (key in patch) allowed[key] = !!patch[key];
    }
    if (SPAWN_RATES.includes(patch.spawnRate)) allowed.spawnRate = patch.spawnRate;
    if (ACTIVITIES.includes(patch.activity)) allowed.activity = patch.activity;
    if ('autostart' in patch) {
      try {
        autostart.setAutostart(!!patch.autostart);
        allowed.autostart = !!patch.autostart;
      } catch (e) {
        diag(`autostart failed: ${e.message}`);
      }
    }
    game.applySettings(allowed);
    if ('musicDance' in allowed) updateMedia();
    if (overlays) overlays.sendAll('overlay:settings', overlaySettings());
    saveSoon();
    pushUiState();
  }

  function updateMedia() {
    if (save.settings.musicDance) {
      if (!media) {
        media = new MediaWatcher({
          script: path.join(__dirname, 'win-media.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
          diag,
          onChange: (m) => {
            if (game) game.sim.setMusic(m);
            diag({ music: m ? m.source : null });
            pushUiState();
          },
        });
      }
      media.start();
    } else if (media) {
      media.stop();
      if (game) game.sim.setMusic(null);
    }
  }

  function overlaySettings() {
    return { sound: save.settings.sound, volume: save.settings.volume, scale: save.settings.scale };
  }

  function uiWindow(file, opts) {
    const w = new BrowserWindow(
      Object.assign(
        {
          show: false,
          resizable: false,
          maximizable: false,
          fullscreenable: false,
          autoHideMenuBar: true,
          backgroundColor: '#f6f4ef',
          icon: path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
          webPreferences: {
            preload: path.join(__dirname, 'preload-ui.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
          },
        },
        opts
      )
    );
    w.setMenu(null);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.once('ready-to-show', () => w.show());
    w.loadFile(path.join(RENDERER, file));
    return w;
  }

  function openSetup() {
    if (setupWin && !setupWin.isDestroyed()) return setupWin.focus();
    uiState.firstRun = true;
    setupWin = uiWindow('setup.html', { width: 470, height: 610, title: 'Meet your crow' });
    setupWin.on('closed', () => {
      setupWin = null;
      if (!save.crow.setupComplete && !quitting) {
        showCrow(true);
      }
    });
  }

  function openRename() {
    if (renameWin && !renameWin.isDestroyed()) return renameWin.focus();
    renameWin = uiWindow('rename.html', { width: 400, height: 250, title: `Rename ${save.crow.name}` });
    renameWin.on('closed', () => (renameWin = null));
  }

  function openSettings() {
    if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
    const b = save.windows.settings;
    const onScreen = b && screen.getAllDisplays().some((d) => b.x + 60 > d.workArea.x && b.y + 20 > d.workArea.y && b.x + 60 < d.workArea.x + d.workArea.width && b.y + 20 < d.workArea.y + d.workArea.height);
    settingsWin = uiWindow('settings.html', Object.assign({ width: 640, height: 760, minWidth: 540, minHeight: 600, resizable: true, title: 'Desktop Crow settings', backgroundColor: SETTINGS_BG }, onScreen ? { x: b.x, y: b.y, width: Math.max(540, b.width), height: Math.max(600, b.height) } : {}));
    diag({ settingsTint: native.tintWindow(settingsWin, { caption: SETTINGS_BG, text: '#e9ebf2', border: 'none' }) });
    const remember = () => {
      if (settingsWin && !settingsWin.isDestroyed() && !settingsWin.isMinimized()) {
        save.windows.settings = settingsWin.getBounds();
        game.markDirty();
      }
    };
    settingsWin.on('moved', remember);
    settingsWin.on('resized', remember);
    settingsWin.on('close', remember);
    settingsWin.on('closed', () => (settingsWin = null));
  }

  function trayImage() {
    const f = process.platform === 'win32' ? 'tray.ico' : 'tray-32.png';
    const img = nativeImage.createFromPath(path.join(ASSETS, f));
    return img.isEmpty() ? nativeImage.createEmpty() : img;
  }

  function menuTemplate() {
    const crow = save.crow;
    const hidden = save.app.hidden;
    const paused = save.app.paused;
    return [
      { label: hidden ? t('menuShow', crow) : t('menuHide', crow), click: () => (save.app.hidden ? showCrow() : hideCrow()) },
      { label: t('menuRename', crow), click: openRename },
      { label: t('menuSettings', crow), click: openSettings },
      { type: 'separator' },
      { label: t('menuFeed', crow), enabled: !hidden && !paused, click: () => game.feed() },
      { label: paused ? t('menuResume', crow) : t('menuPause', crow), click: () => setPaused(!save.app.paused) },
      { type: 'separator' },
      { label: t('menuQuit', crow), click: quitApp },
    ];
  }

  function refreshTray() {
    if (!tray) return;
    const crow = save.crow;
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
    tray.setToolTip(save.app.hidden ? t('trayTooltipHidden', crow) : save.app.paused ? t('trayTooltipPaused', crow) : t('trayTooltip', crow));
  }

  function createTray() {
    try {
      tray = new Tray(trayImage());
      tray.on('click', () => tray.popUpContextMenu());
      refreshTray();
    } catch (e) {
      diag(`tray unavailable: ${e.message}`);
      tray = null;
    }
  }

  function hideCrow() {
    save.app.hidden = true;
    game.hide();
    refreshTray();
    saveSoon();
  }

  function showCrow(fromSetup) {
    if (!fromSetup) save.app.hidden = false;
    if (overlays) overlays.setVisible(true);
    resetClock();
    game.show();
    if (fromSetup) save.app.hidden = false;
    refreshTray();
    saveSoon();
  }

  function setPaused(p) {
    game.setPaused(p);
    refreshTray();
    saveSoon();
  }

  function popupMenuAtCursor() {
    Menu.buildFromTemplate(menuTemplate()).popup({});
  }

  let saveTimer = null;
  function saveNow() {
    if (!game) return;
    save.position = game.sim.savedPosition() || save.position;
    save.gifts.pending = game.pendingGifts();
    save.mood = game.moodSave();
    if (storage.trySave(save)) game.dirty = false;
  }
  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, 1500);
  }

  function readDisplays() {
    return screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }));
  }

  let displayTimer = null;
  function onDisplaysChanged() {
    clearTimeout(displayTimer);
    displayTimer = setTimeout(() => {
      const list = readDisplays();
      diag({ displays: list });
      game.sim.setDisplays(list);
      overlays.sync(list);
      winKey = '';
    }, 300);
  }

  let lastWinPoll = 0;
  let winKey = '';
  let rideUntil = 0;
  function toDip(w) {
    if (process.platform === 'win32') {
      const r = screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.width, height: w.height });
      return Object.assign({}, w, r);
    }
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    return Object.assign({}, w, { x: w.x / sf, y: w.y / sf, width: w.width / sf, height: w.height / sf });
  }
  function pollWindows(now) {
    const c = game.sim.crow;
    const p = c && c.perch();
    const onLedge = !!(p && p.kind === 'window' && !c.airborne);
    const interval = onLedge ? (now < rideUntil ? 16 : 66) : 250;
    if (now - lastWinPoll < interval) return;
    lastWinPoll = now;
    if (!save.settings.windowPerching) {
      if (winKey !== 'off') {
        winKey = 'off';
        game.sim.setWindows([]);
      }
      return;
    }
    const list = native.listWindows().map(toDip);
    const key = list.map((w) => `${w.id}:${Math.round(w.x)},${Math.round(w.y)},${Math.round(w.width)},${Math.round(w.height)}`).join('|');
    if (key !== winKey) {
      if (onLedge) rideUntil = now + 1000;
      winKey = key;
      game.sim.setWindows(list);
    }
  }

  const TICK = 1000 / 60;
  let last = performance.now();
  let acc = 0;
  let lastStatus = 0;
  let frames = 0;
  let lastCursor = null;
  const SEND_EVERY = { fast: 1, medium: 2, slow: 4 };
  let lastPace = null;
  let sinceSend = 0;

  let simClock = performance.now();
  function resetClock() {
    last = performance.now();
    acc = 0;
    simClock = last;
  }

  function hitStyle(hit) {
    if (game.sim.drag) return 'grabbing';
    if (!hit) return 'default';
    return hit.kind === 'gift' || hit.kind === 'box' ? 'pointer' : 'grab';
  }

  let buttonUpSince = 0;
  function checkButtonReleased(now, cur) {
    const sim = game.sim;
    if (!sim.pointerBusy) {
      buttonUpSince = 0;
      return;
    }
    const down = native.primaryButtonDown();
    if (down !== false) {
      buttonUpSince = 0;
      return;
    }
    if (!buttonUpSince) buttonUpSince = now;
    else if (now - buttonUpSince > 250) {
      buttonUpSince = 0;
      diag('drag released by the button-state check');
      sim.pointerCancel(cur.x, cur.y);
    }
  }

  function tick() {
    loopTimer = null;
    if (quitting) return;
    const now = performance.now();
    let elapsed = now - last;
    last = now;
    if (elapsed > 250) elapsed = TICK;
    acc += elapsed;
    const sim = game.sim;
    const hiddenIdle = sim.hidden && !sim.hiding;
    let steps = 0;
    if (!hiddenIdle) {
      const cur = screen.getCursorScreenPoint();
      while (acc >= TICK && steps < 6) {
        sim.setCursor(cur.x, cur.y, TICK / 1000);
        game.step(TICK / 1000);
        acc -= TICK;
        simClock += TICK;
        steps++;
        if (checker) {
          checker.check(sim.crow, sim.world, TICK / 1000);
          if (checker.violations.length) {
            for (const v of checker.violations.splice(0)) diag({ qa: v });
          }
        }
      }
      if (acc > TICK * 6) {
        acc = 0;
        simClock = now;
      }
      if (steps) {
        frames += steps;
        handleGameEvents();
        const pace = sim.pace();
        sinceSend += steps;
        if (pace !== lastPace || sinceSend >= SEND_EVERY[pace]) {
          lastPace = pace;
          sinceSend = 0;
          const snap = sim.snapshot();
          snap.toasts = snap.toasts.map((x) => ({ id: x.id, text: t(x.key, save.crow, x.vars || {}), age: x.age, dur: x.dur }));
          if (snap.bubble) snap.bubble.label = MOOD_LABELS[snap.bubble.kind] || snap.bubble.kind;
          snap.t = simClock;
          overlays.broadcast(snap, sim.activeBounds());
        }
        const fx = sim.drainFx();
        if (fx.length) overlays.sendAll('overlay:fx', fx);
        const hit = sim.hitAt(cur.x, cur.y);
        overlays.updateMouse(cur, !!hit || sim.pointerBusy, hitStyle(hit));
        checkButtonReleased(now, cur);
        lastCursor = cur;
        pollWindows(now);
        if (!sim.pointerBusy) overlays.keepOnTop(Date.now());
      }
    } else {
      acc = 0;
      handleGameEvents();
    }
    if (game.dirty && Date.now() - lastSaveAt > 60000) {
      lastSaveAt = Date.now();
      saveNow();
    }
    if (DIAG && now - lastStatus > 1000) {
      lastStatus = now;
      writeStatus(frames);
      frames = 0;
    }
    const wait = hiddenIdle ? 250 : Math.max(1, TICK - acc);
    loopTimer = setTimeout(tick, wait);
  }
  let lastSaveAt = Date.now();

  function handleGameEvents() {
    for (const e of game.drain()) {
      switch (e.type) {
        case 'notify':
          notify(e.title, e.body);
          break;
        case 'sound': {
          const c = game.sim.crow;
          const id = overlays.displayAt(c.x, c.y - 20) || overlays.displayAt(lastCursor ? lastCursor.x : 0, lastCursor ? lastCursor.y : 0);
          if (id != null) overlays.sendTo(id, 'overlay:sound', { name: e.name, volume: save.settings.volume });
          break;
        }
        case 'hidden':
          overlays.setVisible(false);
          saveSoon();
          break;
        case 'contextMenu':
          popupMenuAtCursor();
          break;
        case 'giftCollected':
        case 'stats':
        case 'tierChanged':
        case 'unboxed':
          pushUiState();
          saveSoon();
          break;
        case 'crowState':
          if (DIAG) diag({ state: `${e.from}->${e.to}` });
          break;
        case 'diag':
          if (DIAG) diag({ sim: e.what });
          break;
        default:
          break;
      }
    }
  }

  function notify(title, body) {
    if (!save.settings.notifications) return;
    try {
      if (!Notification.isSupported()) return;
      new Notification({ title, body, silent: true, icon: path.join(ASSETS, 'icon-256.png') }).show();
    } catch (e) {
      diag(`notification failed: ${e.message}`);
    }
  }

  function writeStatus(fps) {
    const sim = game.sim;
    const c = sim.crow;
    const p = c.perch();
    const status = {
      t: Date.now(),
      fps,
      crow: { state: c.state, x: c.x, y: c.y, z: c.z, h: c.h, airborne: c.airborne, visible: c.visible, perch: p ? { id: p.id, kind: p.kind, y: p.y } : null, plan: sim.brain.plan, held: c.state === 'held' },
      items: [...sim.items.values()].map((i) => ({ type: i.type, x: i.x, y: i.y, z: i.z, state: i.state, gift: i.gift })),
      perches: sim.world.perches.length,
      windows: sim.world.windows.length,
      displays: sim.world.displays,
      overlays: overlays.windows().map((w) => ({ bounds: w.getBounds(), visible: w.isVisible() })),
      hidden: sim.hidden,
      paused: sim.paused,
      boxed: sim.boxed,
      box: sim.box ? { x: sim.box.x, y: sim.box.y, state: sim.box.state, rect: sim.boxRect() } : null,
      mood: sim.brain ? sim.brain.moodState() : null,
      bubble: sim.bubble ? sim.bubble.kind : null,
      pet: sim.brain ? { score: Math.round(sim.brain.petScore * 100) / 100, over: sim.brain.petOver } : null,
      music: sim.music ? sim.music.source : null,
      affection: save.affection.value,
      tier: TIERS[tierIndex(save.affection.value)].key,
      stats: save.stats,
      inventory: save.gifts.inventory,
      qa: checker ? checker.summary().counts : null,
      native: native.status(),
    };
    try {
      fs.writeFileSync(path.join(dataDir, 'status.json'), JSON.stringify(status, null, 1));
    } catch {
    }
  }

  function quitApp() {
    if (quitting) return;
    quitting = true;
    diag('quit requested');
    if (loopTimer) clearTimeout(loopTimer);
    if (media) media.stop();
    saveNow();
    try {
      if (tray) tray.destroy();
    } catch {
    }
    tray = null;
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.destroy();
      } catch {
      }
    }
    native.shutdown();
    if (diagStream) diagStream.end();
    app.quit();
    setTimeout(() => app.exit(0), 2500).unref();
  }

  app.on('second-instance', (_e, _argv, _cwd, data) => {
    if (data && data.quit) return quitApp();
    if (!game) return;
    if (save.app.hidden) showCrow();
    openSettings();
  });
  app.on('window-all-closed', () => {
  });
  app.on('before-quit', () => {
    if (!quitting && game) saveNow();
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try {
      process.on(sig, () => quitApp());
    } catch {
    }
  }
  process.on('uncaughtException', (e) => {
    diag(`uncaught: ${e && e.stack}`);
    try {
      if (game) storage.trySave(save);
    } catch {
    }
  });

  app.whenReady().then(() => {
    const loaded = storage.load(Date.now());
    save = loaded.save;
    save.app.lastRunVersion = app.getVersion();
    diag({ start: app.getVersion(), platform: process.platform, electron: process.versions.electron, dataDir, loaded: loaded.source, recovered: loaded.recovered, argv });

    game = new Game({ save });
    const displays = readDisplays();
    diag({ displays });
    const firstRun = !save.crow.setupComplete;
    const startHidden = save.app.hidden;
    game.init(displays);
    if (firstRun && !startHidden) {
      game.sim.hidden = true;
      game.sim.crow.enter('away', { reason: 'hidden' });
    } else if (!startHidden && !hasFlag('--no-box')) {
      game.sim.boxCrow(save.position);
    }

    overlays = new Overlays({
      preload: path.join(__dirname, 'preload-overlay.js'),
      html: path.join(RENDERER, 'overlay.html'),
      diag,
      devTools: DIAG,
      settings: overlaySettings,
    });
    overlays.sync(displays);
    if (startHidden) overlays.setVisible(false);

    createTray();
    if (firstRun) openSetup();

    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);
    powerMonitor.on('resume', resetClock);
    powerMonitor.on('suspend', saveNow);
    powerMonitor.on('shutdown', saveNow);
    diag({ native: native.status() });

    resetClock();
    loopTimer = setTimeout(tick, TICK);
    updateMedia();
    runTestScript();
  });

  function runTestScript() {
    const exitAfter = Number(flagValue('--exit-after'));
    if (DIAG && Number.isFinite(exitAfter) && exitAfter > 0) setTimeout(quitApp, exitAfter * 1000);
    const file = flagValue('--test-commands');
    if (!DIAG || !file) return;
    let cmds = [];
    try {
      cmds = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      diag(`test commands unreadable: ${e.message}`);
      return;
    }
    for (const c of cmds) setTimeout(() => runCommand(c.cmd), (Number(c.at) || 0) * 1000);
  }

  if (DIAG) {
    setInterval(() => {
      const f = path.join(dataDir, 'inbox.json');
      if (!game || !fs.existsSync(f)) return;
      let list = [];
      try {
        list = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).cmds || [];
      } catch {
        return;
      }
      try {
        fs.unlinkSync(f);
      } catch {
      }
      for (const c of list) runCommand(c);
    }, 250).unref();
  }

  function runCommand(command) {
    diag({ testCommand: command });
    const [cmd, arg] = String(command).split(':');
    const sim = game.sim;
    switch (cmd) {
      case 'feed':
        game.feed();
        break;
      case 'hide':
        hideCrow();
        break;
      case 'show':
        showCrow();
        break;
      case 'pause':
        setPaused(true);
        break;
      case 'resume':
        setPaused(false);
        break;
      case 'gift':
        sim.deliverGift(arg || 'coin');
        break;
      case 'spawn': {
        const cr = sim.crow;
        const k = sim.k;
        const t = sim.world.clampWalkable(cr.x + Math.cos(cr.h) * 120 * k, cr.y + Math.sin(cr.h) * 120 * k * 0.59) || { x: cr.x, y: cr.y };
        const it = sim.addItem(arg || 'apple', t.x, t.y, { z: 160 * k });
        it.appear = 0;
        break;
      }
      case 'walkTo': {
        const [x, y] = String(arg || '').split(',').map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) sim.crow.interrupt({ type: 'walkTo', x, y });
        break;
      }
      case 'state':
        sim.crow.interrupt({ type: arg });
        break;
      case 'affection':
        save.affection.value = Math.max(0, Math.min(1000, Number(arg)));
        break;
      case 'settings':
        openSettings();
        break;
      case 'openBox':
        sim.openBox();
        break;
      case 'box':
        sim.boxCrow(save.position);
        break;
      case 'music':
        sim.setMusic(arg === 'off' ? null : { playing: true, source: arg || 'test' });
        break;
      case 'rename':
        openRename();
        break;
      case 'quit':
        quitApp();
        break;
      default:
        diag(`unknown test command ${command}`);
    }
  }
}
