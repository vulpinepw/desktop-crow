'use strict';

const { sanitizeName, sanitizeGender } = require('./text');
const { clampAffection, dateKey } = require('./affection');
const { ITEM_TYPES } = require('./items');

const SAVE_VERSION = 3;

const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;

const SETTINGS_DEFAULTS = Object.freeze({
  scale: 1,
  sound: true,
  volume: 0.5,
  notifications: true,
  spawnRate: 'normal',
  activity: 'normal',
  cursorReactions: true,
  windowPerching: true,
  multiMonitor: true,
  autostart: false,
  musicDance: true,
});

const SPAWN_RATES = ['off', 'rare', 'normal', 'frequent'];
const ACTIVITIES = ['calm', 'normal', 'lively'];

function defaultSave(nowMs = Date.now()) {
  return {
    version: SAVE_VERSION,
    crow: { name: 'Poe', gender: 'she', setupComplete: false, createdAt: nowMs },
    affection: { value: 0, lastFedAt: null, lastDecayCheck: null, manualFeeds: [], dailyManual: null, dailyPassive: null, dailyPet: null },
    gifts: { inventory: {}, history: [], pending: [], lastGiftAt: null, today: null, awakeSinceCheck: 0 },
    mood: { hunger: 0.35, energy: 0.9, happiness: 0.6, at: null },
    stats: {
      itemsEaten: 0,
      handFed: 0,
      trayFed: 0,
      giftsReceived: 0,
      shiniesStashed: 0,
      treasuresStashed: 0,
      shiniesFound: 0,
      pets: 0,
      dances: 0,
      clicks: 0,
      flights: 0,
      naps: 0,
      hops: 0,
      daysActive: 0,
      firstLaunch: nowMs,
      lastActiveDate: null,
      totalRunSeconds: 0,
    },
    position: null,
    settings: Object.assign({}, SETTINGS_DEFAULTS),
    app: { hidden: false, paused: false, lastRunVersion: null },
    windows: { settings: null },
  };
}

const num = (v, d, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, d, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Math.round(num(v, d, lo, hi));
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const ts = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const dkey = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function normalizeRect(r) {
  if (!r || typeof r !== 'object') return null;
  const x = num(r.x, NaN);
  const y = num(r.y, NaN);
  const w = num(r.width, NaN, 200, 5000);
  const h = num(r.height, NaN, 200, 5000);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

function normalizeSave(raw, nowMs = Date.now()) {
  const d = defaultSave(nowMs);
  const src = obj(raw);
  const out = d;
  let version = int(src.version, 1, 0, 1000);
  const srcCrow = obj(src.crow);
  out.crow.name = sanitizeName(srcCrow.name, d.crow.name);
  out.crow.gender = sanitizeGender(srcCrow.gender);
  out.crow.setupComplete = bool(srcCrow.setupComplete, false);
  out.crow.createdAt = ts(srcCrow.createdAt) || nowMs;

  let aff = src.affection;
  if (typeof aff === 'number') aff = { value: aff };
  aff = obj(aff);
  out.affection.value = clampAffection(num(aff.value, 0));
  out.affection.lastFedAt = ts(aff.lastFedAt);
  out.affection.lastDecayCheck = dkey(aff.lastDecayCheck);
  out.affection.manualFeeds = Array.isArray(aff.manualFeeds) ? aff.manualFeeds.filter((t) => ts(t)).slice(-20) : [];
  const dm = obj(aff.dailyManual);
  out.affection.dailyManual = dkey(dm.date) ? { date: dm.date, points: int(dm.points, 0, 0, 10000) } : null;
  const dp = obj(aff.dailyPassive);
  out.affection.dailyPassive = dkey(dp.date) ? { date: dp.date, points: int(dp.points, 0, 0, 10000) } : null;
  const dpet = obj(aff.dailyPet);
  out.affection.dailyPet = dkey(dpet.date) ? { date: dpet.date, points: int(dpet.points, 0, 0, 10000) } : null;

  const mo = obj(src.mood);
  out.mood.hunger = num(mo.hunger, d.mood.hunger, 0, 1);
  out.mood.energy = num(mo.energy, d.mood.energy, 0, 1);
  out.mood.happiness = num(mo.happiness, d.mood.happiness, 0, 1);
  out.mood.at = ts(mo.at);

  const g = obj(src.gifts);
  const inv = obj(g.inventory);
  for (const [type, count] of Object.entries(inv)) {
    if (ITEM_TYPES[type]) out.gifts.inventory[type] = int(count, 0, 0, 1e6);
  }
  out.gifts.history = Array.isArray(g.history)
    ? g.history.filter((h) => h && ITEM_TYPES[h.type] && ts(h.at)).map((h) => ({ type: h.type, at: h.at })).slice(-200)
    : [];
  out.gifts.pending = Array.isArray(g.pending)
    ? g.pending.filter((p) => p && ITEM_TYPES[p.type]).map((p) => ({ type: p.type, x: num(p.x, null), y: num(p.y, null) })).slice(0, 4)
    : [];
  out.gifts.lastGiftAt = ts(g.lastGiftAt);
  const gt = obj(g.today);
  out.gifts.today = dkey(gt.date) ? { date: gt.date, count: int(gt.count, 0, 0, 100) } : null;
  out.gifts.awakeSinceCheck = num(g.awakeSinceCheck, 0, 0, 1e6);

  const st = obj(src.stats);
  for (const key of Object.keys(d.stats)) {
    if (key === 'firstLaunch') out.stats.firstLaunch = ts(st.firstLaunch) || nowMs;
    else if (key === 'lastActiveDate') out.stats.lastActiveDate = dkey(st.lastActiveDate);
    else if (key === 'totalRunSeconds') out.stats.totalRunSeconds = num(st.totalRunSeconds, 0, 0, 1e12);
    else out.stats[key] = int(st[key], 0, 0);
  }

  const pos = obj(src.position);
  if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    out.position = {
      x: pos.x,
      y: pos.y,
      displayId: pos.displayId != null ? pos.displayId : null,
      relX: num(pos.relX, null, 0, 1),
      relY: num(pos.relY, null, 0, 1),
      h: Number.isFinite(pos.h) ? num(pos.h, 0, -Math.PI, Math.PI) : pos.facing === -1 ? Math.PI : 0,
    };
  }

  const se = obj(src.settings);
  const oldScale = typeof se.scale === 'number' && Number.isFinite(se.scale) && version < 3 ? se.scale * 0.8 : se.scale;
  out.settings.scale = num(oldScale, SETTINGS_DEFAULTS.scale, SCALE_MIN, SCALE_MAX);
  out.settings.sound = bool(se.sound, SETTINGS_DEFAULTS.sound);
  out.settings.volume = num(se.volume, SETTINGS_DEFAULTS.volume, 0, 1);
  out.settings.notifications = bool(se.notifications, SETTINGS_DEFAULTS.notifications);
  out.settings.spawnRate = SPAWN_RATES.includes(se.spawnRate) ? se.spawnRate : SETTINGS_DEFAULTS.spawnRate;
  out.settings.activity = ACTIVITIES.includes(se.activity) ? se.activity : SETTINGS_DEFAULTS.activity;
  out.settings.cursorReactions = bool(se.cursorReactions, SETTINGS_DEFAULTS.cursorReactions);
  out.settings.windowPerching = bool(se.windowPerching, SETTINGS_DEFAULTS.windowPerching);
  out.settings.multiMonitor = bool(se.multiMonitor, SETTINGS_DEFAULTS.multiMonitor);
  out.settings.autostart = bool(se.autostart, SETTINGS_DEFAULTS.autostart);
  out.settings.musicDance = bool(se.musicDance, SETTINGS_DEFAULTS.musicDance);

  const app = obj(src.app);
  out.app.hidden = bool(app.hidden, false);
  out.app.paused = bool(app.paused, false);
  out.app.lastRunVersion = typeof app.lastRunVersion === 'string' ? app.lastRunVersion.slice(0, 40) : null;

  const win = obj(src.windows);
  out.windows.settings = normalizeRect(win.settings);

  if (version < SAVE_VERSION) version = SAVE_VERSION;
  out.version = version;
  return out;
}

module.exports = { SAVE_VERSION, SETTINGS_DEFAULTS, SCALE_MIN, SCALE_MAX, SPAWN_RATES, ACTIVITIES, defaultSave, normalizeSave, dateKey };
