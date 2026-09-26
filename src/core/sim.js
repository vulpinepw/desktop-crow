'use strict';

const M = require('./math');
const { World } = require('./world');
const { Crow } = require('./crow');
const { Brain, EAT_OFFSET } = require('./brain');
const { createRng } = require('./rng');
const { CAM } = require('./dims');
const { ITEM_TYPES, TREATS, createItem, stepItem, pickSpawnType, hitTestItem, keepOnFloor } = require('./items');
const { computeRig, hitTest, worldBounds, toWorld } = require('./rig');
const { ANNOY } = require('./affection');

const SPAWN_INTERVALS = Object.freeze({ off: null, rare: [480, 900], normal: [180, 480], frequent: [60, 180] });
const MAX_WORLD_ITEMS = 5;
const ITEM_LIFETIME_S = 15 * 60;
const COLLECT_TIME = 0.8;
const DRAG_START_PX = 6;
const HELD_ITEM_Z = 16;
const DEFAULT_SETTINGS = Object.freeze({ scale: 1, spawnRate: 'normal', activity: 'normal', cursorReactions: true, windowPerching: true, multiMonitor: true, musicDance: true });
const BOX = Object.freeze({ w: 76, d: 56, h: 44, open: 0.6, stay: 5, fade: 1 });

class Sim {
  constructor(opts = {}) {
    this.rng = createRng(opts.seed == null ? Date.now() & 0xffffffff : opts.seed);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, opts.settings || {});
    this.world = new World({ scale: this.settings.scale, perching: this.settings.windowPerching });
    this.items = new Map();
    this.events = [];
    this.fx = [];
    this.toasts = [];
    this.time = 0;
    this.cursor = null;
    this.cursorVel = { x: 0, y: 0 };
    this.paused = false;
    this.hidden = false;
    this.hiding = false;
    this.press = null;
    this.drag = null;
    this.clickTimes = [];
    this.annoyedUntil = 0;
    this.spawnT = 20;
    this.tierIndex = opts.tierIndex || (() => 0);
    this.nightFactor = 1;
    this.crow = null;
    this.brain = null;
    this.toastSeq = 1;
    this.box = null;
    this.boxed = false;
    this.music = null;
    this.bubble = null;
  }

  emit(e) {
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  drainFx() {
    const f = this.fx;
    this.fx = [];
    return f;
  }

  get k() {
    return this.world.k;
  }

  get pointerBusy() {
    return !!(this.drag || this.press);
  }

  init(displays, position) {
    this.world.setDisplays(displays);
    const start = this.startPosition(position);
    this.crow = new Crow(this.crowEnv(), { scale: this.k, x: start.x, y: start.y, h: start.h });
    this.brain = new Brain(this);
    this.spawnT = this.rng.range(15, 40);
  }

  crowEnv() {
    return {
      world: this.world,
      rng: this.rng,
      getItem: (id) => this.items.get(id) || null,
      emit: (e) => this.onCrowEvent(e),
      cursor: () => this.cursor,
      annoyed: () => this.time < this.annoyedUntil,
    };
  }

  startPosition(pos) {
    const w = this.world;
    let x = null;
    let y = null;
    let displayId;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      let d = pos.displayId != null ? w.displayById(pos.displayId) : null;
      if (d && pos.relX != null && pos.relY != null) {
        x = d.workArea.x + pos.relX * d.workArea.width;
        y = d.workArea.y + pos.relY * d.workArea.height;
      } else {
        d = w.displayAt(pos.x, pos.y) || w.nearestDisplay(pos.x, pos.y);
        x = pos.x;
        y = pos.y;
      }
      displayId = d ? d.id : undefined;
    }
    if (x == null) {
      const d = w.displays[0];
      if (d) {
        x = d.workArea.x + d.workArea.width * 0.5;
        y = d.workArea.y + d.workArea.height * 0.72;
        displayId = d.id;
      } else {
        x = 0;
        y = 0;
      }
    }
    const c = w.clampWalkable(x, y, displayId) || { x, y };
    const h = pos && Number.isFinite(pos.h) ? M.wrapAngle(pos.h) : pos && pos.facing === -1 ? Math.PI : 0;
    return { x: c.x, y: c.y, h };
  }

  setDisplays(displays) {
    const prev = this.crow ? this.crow.perch() : null;
    this.world.setDisplays(displays);
    if (this.crow) this.crow.displaysChangedAt = this.crow.time;
    if (this.box) {
      const p = this.world.clampWalkable(this.box.x, this.box.y);
      if (p) {
        this.box.x = p.x;
        this.box.y = p.y;
      }
    }
    this.afterWorldChange(prev);
    if (this.crow) this.crow.onDisplaysChanged();
  }

  setWindows(windows) {
    const prev = this.crow ? this.crow.perch() : null;
    this.world.setWindows(windows);
    this.afterWorldChange(prev);
  }

  afterWorldChange(prevPerch) {
    if (!this.crow || this.boxed) return;
    const c = this.crow;
    const k = this.k;
    const intentionallyOff = c.state === 'away' || c.state === 'held' || (c.state === 'fly' && c.st && (c.st.offscreen || (c.st.mode === 'in' && !c.st.enteredScreen)));
    if (!intentionallyOff && !this.hidden && !this.world.onOrBetweenDisplays(c.x, c.y - c.z * CAM.H - 30 * k, 40 * k)) {
      this.brain.gift = null;
      this.brain.stash = null;
      c.carry = null;
      c.queue = [];
      if (c.action) c.finishAction(false);
      c.enter('away', { reason: 'displayLost' });
      this.brain.flyBack({ x: c.x, y: c.y });
      return;
    }
    c.onWorldChanged(prevPerch && Object.assign({}, prevPerch));
    if (!c.airborne && c.state !== 'away' && !this.world.displayAt(c.x, c.y)) c.convertToFall();
  }

  applySettings(s) {
    const scaleChanged = s.scale != null && s.scale !== this.settings.scale;
    const perchChanged = s.windowPerching != null && s.windowPerching !== this.settings.windowPerching;
    Object.assign(this.settings, s);
    if (perchChanged) {
      const prev = this.crow ? this.crow.perch() : null;
      this.world.opts.perching = this.settings.windowPerching;
      this.world.rebuild();
      this.afterWorldChange(prev);
    }
    if (scaleChanged && this.crow) {
      const c = this.crow;
      if (this.drag && this.drag.kind === 'crow') this.pointerCancel();
      this.press = null;
      const prev = { x: c.x, y: c.y, h: c.h };
      this.world.setScale(this.settings.scale);
      const at = this.world.inWalkable(prev.x, prev.y, 0.5) ? prev : this.world.clampWalkable(prev.x, prev.y) || prev;
      const wasHidden = this.hidden;
      this.crow = new Crow(c.env, { scale: this.k, x: at.x, y: at.y, h: prev.h });
      if (wasHidden || this.boxed) this.crow.enter('away', { reason: 'boxed' });
      this.brain.gift = null;
      this.brain.stash = null;
      this.brain.nextDecide = 1;
    }
  }

  setCursor(x, y, dt = 1 / 60) {
    if (this.cursor && dt > 0) {
      const vx = (x - this.cursor.x) / dt;
      const vy = (y - this.cursor.y) / dt;
      const a = Math.min(1, dt * 12);
      this.cursorVel.x += (vx - this.cursorVel.x) * a;
      this.cursorVel.y += (vy - this.cursorVel.y) * a;
    }
    this.cursor = { x, y };
    this.checkPress();
  }

  clearCursor() {
    this.cursor = null;
    this.cursorVel = { x: 0, y: 0 };
  }

  crowRig() {
    const c = this.crow;
    if (!c || !c.visible || c.state === 'away') return null;
    return computeRig(c.pose);
  }

  hitAt(x, y) {
    if (this.hidden) return null;
    if (this.box && this.box.state === 'closed' && this.boxHit(x, y)) return { kind: 'box' };
    let best = null;
    for (const it of this.items.values()) {
      if (it.state === 'gone' || it.state === 'carried' || it.collect > 0 || it.fade > 0 || it.glide) continue;
      if (it.state === 'held') continue;
      if (!hitTestItem(it, x, y, this.k, 5)) continue;
      if (it.gift) return { kind: 'gift', item: it };
      if (ITEM_TYPES[it.type].kind === 'shiny' && (it.state === 'resting' || it.state === 'falling')) return { kind: 'gift', item: it };
      if (!this.paused && (it.state === 'resting' || it.state === 'falling')) best = { kind: 'item', item: it };
    }
    if (best) return best;
    const rig = this.crowRig();
    if (rig && hitTest(rig, x, y, 3)) return { kind: 'crow' };
    return null;
  }

  interactiveAt(x, y) {
    if (this.pointerBusy) return true;
    return !!this.hitAt(x, y);
  }

  pointerDown(x, y, button = 0) {
    this.setCursor(x, y, 0);
    const hit = this.hitAt(x, y);
    if (!hit) return null;
    if (button === 2) {
      if (hit.kind === 'crow' || hit.kind === 'box') this.emit({ type: 'contextMenu', x, y });
      return hit.kind;
    }
    if (this.drag) return null;
    if (hit.kind === 'box') {
      this.openBox();
      return 'box';
    }
    if (hit.kind === 'gift') {
      this.collectGift(hit.item);
      return 'gift';
    }
    if (hit.kind === 'item') {
      const it = hit.item;
      it.state = 'held';
      it.held = true;
      it.claimedBy = 'user';
      it.vx = 0;
      it.vy = 0;
      it.vz = 0;
      this.drag = { kind: 'item', itemId: it.id, dx: it.x - x, dy: it.y - it.z * CAM.H - y };
      this.emit({ type: 'sound', name: 'pickup' });
      return 'item';
    }
    if (hit.kind === 'crow') {
      this.press = { x, y, t: this.time };
      return 'crow';
    }
    return null;
  }

  pointerMove(x, y) {
    this.setCursor(x, y, 1 / 60);
  }

  checkPress() {
    const p = this.press;
    const cur = this.cursor;
    if (!p || !cur || this.drag) return;
    if (Math.hypot(cur.x - p.x, cur.y - p.y) < DRAG_START_PX) return;
    this.press = null;
    const c = this.crow;
    if (c && c.grab(p.x, p.y)) {
      this.drag = { kind: 'crow' };
      for (const it of this.items.values()) if (it.claimedBy === 'crow' && it.state !== 'gone') it.claimedBy = null;
      this.brain.onGrabbed();
      this.emit({ type: 'crowGrabbed' });
    }
  }

  pointerUp(x, y) {
    if (this.press) {
      const p = this.press;
      this.press = null;
      if (!this.paused) this.clickCrow(p.x, p.y);
      return;
    }
    if (!this.drag) return;
    this.setCursor(x, y, 0);
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'crow') {
      const c = this.crow;
      if (c) c.release(this.cursorVel.x, this.cursorVel.y);
      this.brain.onReleased();
      this.emit({ type: 'crowReleased' });
      return;
    }
    const it = this.items.get(d.itemId);
    if (!it) return;
    it.held = false;
    it.claimedBy = null;
    if (this.tryHandFeed(it, x, y)) return;
    const k = this.k;
    const vx = M.clamp(this.cursorVel.x * 0.5, -800, 800);
    const vy = M.clamp(this.cursorVel.y * 0.5, -800, 800);
    it.state = 'falling';
    it.vx = vx;
    it.vy = vy;
    it.vz = Math.min(320 * k, Math.hypot(vx, vy) * 0.35);
    it.vrot = M.clamp(it.vx / 120, -8, 8);
    it.source = it.source === 'spawn' ? 'drop' : it.source;
  }

  pointerCancel(x, y) {
    this.press = null;
    if (!this.drag) return;
    const cur = this.cursor || { x: x || 0, y: y || 0 };
    this.pointerUp(x != null ? x : cur.x, y != null ? y : cur.y);
  }

  tryHandFeed(it, x, y) {
    const def = ITEM_TYPES[it.type];
    const c = this.crow;
    const k = this.k;
    if (def.kind !== 'food' || !c || !c.visible || c.airborne || c.state === 'away' || c.state === 'held') return false;
    const rig = this.crowRig();
    if (!rig) return false;
    const head = toWorld(c.pose, rig.head.x, rig.head.y);
    const near = hitTest(rig, x, y, 22 * k) || Math.hypot(x - head[0], y - head[1]) < 50 * k;
    if (!near) return false;
    const spot = this.eatSpot(c, def);
    if (!spot) return false;
    it.glide = { x0: it.x, y0: it.y, z0: it.z, x1: spot.x, y1: spot.y, t: 0, dur: 0.16 };
    it.state = 'falling';
    it.handFed = true;
    it.source = 'hand';
    it.claimedBy = 'crow';
    return true;
  }

  eatSpot(c, def) {
    const k = this.k;
    const w = this.world;
    for (const a of [0, 0.45, -0.45, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
      const h = c.h + a;
      const x = c.x + Math.cos(h) * EAT_OFFSET * k;
      const y = c.y + Math.sin(h) * EAT_OFFSET * k * CAM.F;
      const d = w.displayAt(x, y);
      if (!d) continue;
      const wa = d.workArea;
      const mx = (def.w / 2 + 6) * k;
      if (x < wa.x + mx || x > wa.x + wa.width - mx || y < wa.y + (def.h + 14) * k || y > wa.y + wa.height - 6 * k) continue;
      return { x, y };
    }
    return null;
  }

  clickCrow(x, y) {
    const now = this.time;
    this.clickTimes = this.clickTimes.filter((t) => now - t < ANNOY.windowMs / 1000);
    this.clickTimes.push(now);
    let annoyed = false;
    if (this.clickTimes.length >= ANNOY.clicks && now >= this.annoyedUntil) {
      annoyed = true;
      this.annoyedUntil = now + ANNOY.cooldownMs / 1000;
      this.clickTimes = [];
      this.emit({ type: 'annoyed' });
    }
    this.emit({ type: 'clicked', x, y, annoyed });
    this.brain.onClicked(x, y, annoyed);
  }

  collectGift(it) {
    if (it.collect > 0) return;
    const found = !it.gift;
    if (found && it.claimedBy === 'crow' && this.brain) this.brain.onItemTaken(it);
    it.claimedBy = 'user';
    it.collect = 1e-6;
    this.emit({ type: 'giftCollected', itemType: it.type, itemId: it.id, x: it.x, y: it.y, found });
    this.emit({ type: 'sound', name: 'pickup' });
    this.fx.push({ kind: 'sparkleBurst', x: it.x, y: it.y - it.z * CAM.H - (ITEM_TYPES[it.type].h * this.k) / 2, seed: this.rng.int(0, 1e6) });
    if (!found && this.brain) this.brain.onGiftCollected();
  }

  boxRect() {
    const b = this.box;
    if (!b) return null;
    const k = this.k;
    const hw = (BOX.w / 2 + 6) * k;
    const top = b.y - (BOX.d / 2) * k * CAM.F - BOX.h * k * CAM.H - 8 * k;
    const bottom = b.y + (BOX.d / 2) * k * CAM.F + 4 * k;
    return { x: b.x - hw, y: top, width: hw * 2, height: bottom - top };
  }

  boxHit(x, y) {
    const r = this.boxRect();
    return !!r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  }

  boxCrow(at, opts = {}) {
    const c = this.crow;
    if (!c) return null;
    const w = this.world;
    const k = this.k;
    let p = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? w.clampWalkable(at.x, at.y) : null;
    if (!p) {
      const d = w.displays[0];
      p = d ? w.clampWalkable(d.workArea.x + d.workArea.width * 0.5, d.workArea.y + d.workArea.height * 0.62) : null;
    }
    if (!p) return null;
    const a = w.areaAt(p.x, p.y, 1);
    if (a) {
      p = { x: M.clamp(p.x, a.x0 + 10 * k, a.x1 - 10 * k), y: M.clamp(p.y, Math.min(a.y1, a.y0 + 30 * k), a.y1) };
    }
    this.press = null;
    if (this.drag) this.pointerCancel();
    if (this.brain) {
      this.brain.gift = null;
      this.brain.stash = null;
    }
    c.carry = null;
    c.queue = [];
    this.hidden = false;
    this.hiding = false;
    this.boxed = true;
    if (c.state !== 'away') c.enter('away', { reason: 'boxed' });
    this.box = { x: p.x, y: p.y, state: 'closed', t: 0, born: this.time, open: 0, alpha: 1, welcome: !!opts.welcome, seed: this.rng.int(0, 1e6) };
    this.emit({ type: 'boxed', x: p.x, y: p.y });
    return this.box;
  }

  openBox() {
    const b = this.box;
    if (!b || b.state !== 'closed') return false;
    b.state = 'opening';
    b.t = 0;
    this.emit({ type: 'sound', name: 'pickup' });
    this.fx.push({ kind: 'dust', x: b.x, y: b.y - BOX.h * this.k * CAM.H, seed: this.rng.int(0, 1e6) });
    this.emit({ type: 'boxOpened' });
    return true;
  }

  releaseFromBox() {
    const b = this.box;
    const old = this.crow;
    if (!b || !old) return;
    const k = this.k;
    const w = this.world;
    this.boxed = false;
    this.hidden = false;
    this.crow = new Crow(old.env, { scale: k, x: b.x, y: b.y, h: Math.PI / 2 + this.rng.range(-0.5, 0.5) });
    const c = this.crow;
    c.caw('chirp');
    let target = null;
    for (let i = 0; i < 12 && !target; i++) {
      const ang = Math.PI / 2 + this.rng.range(-1.1, 1.1);
      const d = this.rng.range(120, 190) * k;
      const t = w.clampWalkable(b.x + Math.cos(ang) * d, b.y + Math.sin(ang) * d * CAM.F);
      if (t && Crow.floorDist(b.x, b.y, t.x, t.y) > 70 * k) target = t;
    }
    if (!target) target = w.randomWalkable(this.rng, { near: { x: b.x, y: b.y }, minR: 90 * k, maxR: 220 * k });
    c.act({ type: 'idle', duration: 0.9 });
    if (target) c.act({ type: 'flyTo', target: { x: target.x, y: target.y } });
    if (this.brain) {
      this.brain.plan = 'unboxed';
      this.brain.nextDecide = 3;
    }
    if (b.welcome) this.toast('welcomeToast', 4);
    this.emit({ type: 'unboxed', x: b.x, y: b.y });
  }

  stepBox(dt) {
    const b = this.box;
    if (!b) return;
    b.t += dt;
    if (b.state === 'opening') {
      b.open = Math.min(1, b.t / BOX.open);
      if (b.t >= BOX.open) {
        b.state = 'open';
        b.t = 0;
        this.releaseFromBox();
      }
    } else if (b.state === 'open') {
      const c = this.crow;
      const inside = c && !c.airborne && Crow.floorDist(c.x, c.y, b.x, b.y) < (BOX.w / 2) * this.k;
      if (b.t >= BOX.stay && !inside) {
        b.state = 'fading';
        b.t = 0;
      }
    } else if (b.state === 'fading') {
      b.alpha = Math.max(0, 1 - b.t / BOX.fade);
      if (b.t >= BOX.fade) this.box = null;
    }
  }

  setMusic(m) {
    this.music = m && m.playing ? { playing: true, source: m.source || null, title: m.title || null, artist: m.artist || null } : null;
  }

  say(kind, value, dur = 3.6) {
    this.bubble = { kind, value: M.clamp(value, 0, 1), t0: this.time, dur };
  }

  feed() {
    const c = this.crow;
    if (this.box && this.box.state === 'closed') return !!this.openBox();
    if (!c || this.hidden || this.paused || this.boxed) return false;
    const k = this.k;
    const type = this.rng.pick(TREATS);
    const def = ITEM_TYPES[type];
    let spot = c.visible && c.state !== 'away' && !c.airborne && c.state !== 'held' ? this.eatSpot(c, def) : null;
    if (!spot) spot = this.world.randomWalkable(this.rng, { near: { x: c.x, y: c.y }, minR: 40 * k, maxR: 120 * k });
    if (!spot) return false;
    const it = this.addItem(type, spot.x, spot.y, { z: 150 * k, source: 'tray', vrot: this.rng.range(-3, 3) });
    it.appear = 0;
    this.emit({ type: 'sound', name: 'drop' });
    return it;
  }

  addItem(type, x, y, opts = {}) {
    const it = createItem(type, x, y, Object.assign({ seed: this.rng.int(0, 1000) }, opts));
    this.items.set(it.id, it);
    this.emit({ type: 'itemSpawned', itemId: it.id, itemType: type, source: it.source });
    return it;
  }

  placeGift(type, x, y) {
    const w = this.world;
    const k = this.k;
    let gx = x;
    let gy = y;
    if (gx == null || gy == null || !Number.isFinite(gx) || !Number.isFinite(gy)) {
      const c = this.crow;
      const near = c && c.state !== 'away' ? { x: c.x, y: c.y } : null;
      const p = near ? w.randomWalkable(this.rng, { near, minR: 40 * k, maxR: 90 * k }) : w.randomWalkable(this.rng, {});
      gx = p ? p.x : 0;
      gy = p ? p.y : 0;
    }
    const it = createItem(type, gx, gy, { gift: true, source: 'gift', seed: this.rng.int(0, 1000) });
    it.state = 'resting';
    keepOnFloor(it, w);
    this.items.set(it.id, it);
    return it;
  }

  removeItem(id, why) {
    const it = this.items.get(id);
    if (!it) return;
    it.state = 'gone';
    this.items.delete(id);
    if (why === 'stashed') this.emit({ type: 'stashed', itemType: it.type });
  }

  deliverGift(type) {
    if (!this.crow || this.hidden || this.hiding || this.boxed) return false;
    return this.brain.deliverGift(type);
  }

  pendingGiftItems() {
    return [...this.items.values()].filter((it) => it.gift && it.collect === 0);
  }

  hide() {
    if (this.hidden || this.hiding || !this.crow) return;
    this.press = null;
    if (this.drag) this.pointerCancel();
    if (this.boxed) {
      this.box = null;
      this.boxed = false;
    }
    if (this.crow.state === 'away') {
      this.brain.gift = null;
      this.brain.stash = null;
      this.crow.carry = null;
      this.crow.queue = [];
      this.hidden = true;
      this.emit({ type: 'hidden' });
      return;
    }
    this.hiding = true;
    this.brain.flyAway();
  }

  show() {
    if (!this.hidden && !this.hiding) return;
    this.hiding = false;
    this.hidden = false;
    const c = this.crow;
    if (c.state === 'away') {
      this.brain.flyBack(this.cursor);
      return;
    }
    c.queue = c.queue.filter((a) => a.type !== 'flyOff');
    if (c.state === 'fly' && c.st && c.st.offscreen && this.world.inWalkable(c.x, c.y, 20 * this.k)) {
      const t = this.brain.landingNear(c.x, c.y);
      if (t) c.retargetFlight(t);
    }
  }

  setPaused(p) {
    this.paused = !!p;
    const c = this.crow;
    if (this.paused && c && !c.airborne && c.state !== 'held' && !this.brain.gift) {
      c.interrupt({ type: 'perch', duration: 1e9 });
    } else if (!this.paused && c && c.state === 'perch') {
      c.interrupt({ type: 'idle', duration: 0.5 });
      this.brain.nextDecide = 1;
    }
  }

  itemFromBeak(type, e, opts) {
    const c = this.crow;
    const k = this.k;
    const def = ITEM_TYPES[type];
    let z = e.z || 0;
    let rot = 0;
    if (c) {
      const rig = computeRig(c.pose);
      const drawn = toWorld(c.pose, rig.carryPt[0], rig.carryPt[1]);
      z = Math.max(0, (e.y - drawn[1] - (def.h / 2) * k) / CAM.H);
      rot = rig.carryAng * 0.6;
    }
    const it = createItem(type, e.x, e.y, Object.assign({ seed: this.rng.int(0, 1000), z, rot }, opts));
    if (z <= 1e-6) it.state = 'resting';
    keepOnFloor(it, this.world);
    this.items.set(it.id, it);
    return it;
  }

  onCrowEvent(e) {
    switch (e.type) {
      case 'giftDropped': {
        const it = this.itemFromBeak(e.giftType, e, { gift: true, source: 'gift', seed: e.seed });
        this.emit({ type: 'giftDropped', itemType: e.giftType, itemId: it.id, x: it.x, y: it.y });
        this.toast('giftToast', 4.5);
        break;
      }
      case 'dropCarried': {
        const cr = e.carry;
        const world = cr.itemId ? this.items.get(cr.itemId) : null;
        if (world) {
          const tmp = this.itemFromBeak(world.type, e, {});
          this.items.delete(tmp.id);
          Object.assign(world, { x: tmp.x, y: tmp.y, z: tmp.z, rot: tmp.rot, vx: 0, vy: 0, vz: 0, vrot: 0, state: tmp.state, claimedBy: null });
        } else if (!cr.itemId) {
          const it = this.itemFromBeak(cr.type, e, { gift: true, source: 'gift' });
          this.emit({ type: 'giftDropped', itemType: cr.type, itemId: it.id, x: it.x, y: it.y });
          this.toast('giftToast', 4.5);
        }
        break;
      }
      case 'bite':
        this.fx.push({ kind: 'crumbs', x: e.x, y: e.y, itemType: e.itemType, seed: this.rng.int(0, 1e6) });
        break;
      case 'ate': {
        const it = this.items.get(e.itemId);
        this.items.delete(e.itemId);
        this.emit({ type: 'ate', itemType: e.itemType, handFed: !!(it && it.handFed) || e.handFed, source: it ? it.source : e.source });
        break;
      }
      case 'peckHit':
        this.fx.push({ kind: 'dust', x: e.x, y: e.y, seed: this.rng.int(0, 1e6) });
        break;
      case 'away':
        if (this.hiding) {
          this.hiding = false;
          this.hidden = true;
          if (this.crow) this.crow.carry = null;
          this.emit({ type: 'hidden' });
        } else if (!this.hidden && !this.boxed && this.brain && !this.brain.gift && !this.brain.stash) {
          this.brain.flyBack(this.cursor);
        }
        break;
      case 'takeoff':
        this.emit({ type: 'flight' });
        break;
      case 'sleepStart':
        this.emit({ type: 'nap' });
        break;
      case 'state':
        this.emit({ type: 'crowState', from: e.from, to: e.to });
        if (e.to === 'hop') this.emit({ type: 'hop' });
        break;
      case 'sound':
        this.emit({ type: 'sound', name: e.name });
        break;
      case 'balanceStep':
        this.emit({ type: 'diag', what: e.type, data: e });
        break;
      case 'diag':
        this.emit({ type: 'diag', what: e.what, data: e });
        break;
      default:
        break;
    }
  }

  toast(key, dur = 4, vars) {
    this.toasts.push({ id: this.toastSeq++, key, vars: vars || null, t0: this.time, dur });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  stepHeldItem(it, dt) {
    const k = this.k;
    const cur = this.cursor;
    const d = this.drag;
    if (!cur || !d || d.itemId !== it.id) return;
    const def = ITEM_TYPES[it.type];
    it.z += (HELD_ITEM_Z * k - it.z) * Math.min(1, dt * 14);
    const tx = cur.x + d.dx * 0.3;
    const tby = cur.y + Math.max(d.dy, (def.h * k) / 2 + 4);
    const ty = tby + it.z * CAM.H;
    const ox = it.x;
    const a = Math.min(1, dt * 18);
    it.x += (tx - it.x) * a;
    it.y += (ty - it.y) * a;
    it.rot += (M.clamp((it.x - ox) / (dt * 600), -0.6, 0.6) - it.rot) * Math.min(1, dt * 10);
  }

  stepGlide(it, dt) {
    const g = it.glide;
    g.t += dt;
    const u = Math.min(1, g.t / g.dur);
    const e = M.easeInOutSine(u);
    it.x = M.lerp(g.x0, g.x1, e);
    it.y = M.lerp(g.y0, g.y1, e);
    it.z = M.lerp(g.z0, 0, e);
    it.rot *= Math.exp(-dt * 12);
    if (u >= 1) {
      it.glide = null;
      it.z = 0;
      it.vx = 0;
      it.vy = 0;
      it.vz = 0;
      it.state = 'resting';
      this.emit({ type: 'handOffer', itemId: it.id, itemType: it.type });
      this.brain.onHandOffer(it);
    }
  }

  step(dt) {
    this.time += dt;
    const c = this.crow;
    if (!c) return;
    this.checkPress();
    for (const it of [...this.items.values()]) {
      if (it.appear != null && it.appear < 1) it.appear = Math.min(1, it.appear + dt / 0.25);
      if (it.state === 'held') {
        this.stepHeldItem(it, dt);
        continue;
      }
      if (it.glide) {
        this.stepGlide(it, dt);
        continue;
      }
      if (it.collect > 0) {
        it.collect += dt / COLLECT_TIME;
        if (it.collect >= 1) this.items.delete(it.id);
        continue;
      }
      const ev = stepItem(it, dt, this.world);
      if (ev === 'landed') {
        this.emit({ type: 'itemLanded', itemId: it.id, itemType: it.type, source: it.source });
        this.emit({ type: 'sound', name: 'thud' });
        this.brain.onItemLanded(it);
      }
      if (!it.gift && it.claimedBy == null && it.state === 'resting' && it.age > ITEM_LIFETIME_S) it.fade += dt / 1.5;
      if (it.fade > 0) {
        it.alpha = Math.max(0, 1 - it.fade);
        if (it.fade >= 1) this.items.delete(it.id);
      }
    }
    if (!this.paused && !this.hidden && !this.boxed) {
      const iv = SPAWN_INTERVALS[this.settings.spawnRate];
      if (iv) {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          this.spawnT = this.rng.range(iv[0], iv[1]);
          this.spawnRandom();
        }
      }
    }
    this.stepBox(dt);
    this.brain.update(dt);
    this.crow.step(dt);
    this.toasts = this.toasts.filter((t) => this.time - t.t0 < t.dur);
    if (this.bubble && this.time - this.bubble.t0 >= this.bubble.dur) this.bubble = null;
    if (this.bubble && (!this.crow.visible || this.crow.state === 'away' || this.crow.state === 'held')) this.bubble = null;
  }

  spawnRandom() {
    const worldItems = [...this.items.values()].filter((it) => !it.gift).length;
    if (worldItems >= MAX_WORLD_ITEMS) return null;
    const w = this.world;
    const k = this.k;
    let displays = w.displays;
    if (!this.settings.multiMonitor && this.crow) {
      const d = w.displayAt(this.crow.x, this.crow.y);
      if (d) displays = [d];
    }
    const d = this.rng.weighted(displays, (q) => q.workArea.width * q.workArea.height);
    if (!d) return null;
    const wa = d.workArea;
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = this.rng.range(wa.x + 50 * k, wa.x + wa.width - 50 * k);
      y = this.rng.range(wa.y + 70 * k, wa.y + wa.height - 24 * k);
      const c = this.crow;
      if (!c || Math.hypot(x - c.x, (y - c.y) / CAM.F) > 70 * k) break;
    }
    const z = Math.min((y - wa.y + 30 * k) / CAM.H, 300 * k);
    const it = this.addItem(pickSpawnType(this.rng), x, y, { z, vrot: this.rng.range(-4, 4), source: 'spawn' });
    it.appear = 0;
    return it;
  }

  pace() {
    const c = this.crow;
    if (this.drag || this.press) return 'fast';
    if (this.box && this.box.state !== 'closed') return 'fast';
    for (const it of this.items.values()) {
      if (it.state === 'falling' || it.state === 'held' || it.glide || it.collect > 0 || it.fade > 0 || (it.appear != null && it.appear < 1)) return 'fast';
    }
    if (this.box) return 'medium';
    if (!c || !c.visible || c.state === 'away') return 'slow';
    if (this.bubble) return 'medium';
    if (c.airborne) return 'fast';
    switch (c.state) {
      case 'fly':
      case 'hop':
      case 'land':
      case 'eat':
      case 'peck':
      case 'giftDrop':
      case 'reactClick':
      case 'reactSpawn':
      case 'held':
      case 'dance':
        return 'fast';
      case 'walk':
        return Math.hypot(c.vx, c.vy / CAM.F) > 50 * this.k ? 'fast' : 'medium';
      case 'perch':
      case 'sleep':
        return (c.emote && c.emote.kind !== 'sleep') || this.toasts.length ? 'medium' : 'slow';
      default:
        return 'medium';
    }
  }

  snapshot() {
    const c = this.crow;
    const p = c ? c.pose : null;
    const crow =
      c && c.visible && c.state !== 'away'
        ? {
            x: p.x,
            y: p.y,
            z: p.z,
            h: p.h,
            k: p.k,
            hipH: p.hipH,
            pitch: p.pitch,
            headX: p.headX,
            headY: p.headY,
            headA: p.headA,
            headYaw: p.headYaw,
            beak: p.beak,
            eye: p.eye,
            lookX: p.lookX,
            lookY: p.lookY,
            wing: p.wing,
            flap: p.flap,
            tailA: p.tailA,
            tailFan: p.tailFan,
            fluff: p.fluff,
            feet: p.feet.map((f) => ({ x: f.x, y: f.y, lx: f.lx, ly: f.ly, lz: f.lz, th: f.th, curl: f.curl, planted: f.planted })),
            carry: p.carry,
            emote: p.emote,
            shadow: p.shadow,
            state: c.state,
          }
        : null;
    const items = [];
    for (const it of this.items.values()) {
      if (it.state === 'gone' || it.state === 'carried') continue;
      items.push({
        id: it.id,
        type: it.type,
        x: it.x,
        y: it.y,
        z: it.z || 0,
        rot: it.rot,
        alpha: it.alpha * (it.appear == null ? 1 : M.smoothstep(0, 1, it.appear)),
        scale: it.collect > 0 ? 1 + 0.6 * Math.sin(Math.min(1, it.collect) * Math.PI * 0.5) : 1,
        lift: it.collect > 0 ? it.collect * 26 * this.k : 0,
        fadeCollect: it.collect > 0 ? Math.max(0, 1 - Math.max(0, it.collect - 0.35) / 0.65) : 1,
        bitesLeft: it.bitesLeft,
        gift: it.gift,
        held: it.held,
        seed: it.seed,
      });
    }
    const toasts = this.toasts.map((t) => ({ id: t.id, key: t.key, vars: t.vars, age: this.time - t.t0, dur: t.dur }));
    const b = this.box;
    const box = b ? { x: b.x, y: b.y, state: b.state, open: b.open, alpha: b.alpha, age: this.time - b.born, seed: b.seed, w: BOX.w, d: BOX.d, h: BOX.h } : null;
    const u = this.bubble;
    const bubble = u && crow ? { kind: u.kind, value: u.value, age: this.time - u.t0, dur: u.dur } : null;
    return { t: this.time, crow, items, toasts, box, bubble, k: this.k, pace: this.pace() };
  }

  activeBounds() {
    const rects = [];
    const k = this.k;
    const rig = this.crowRig();
    if (rig) rects.push(worldBounds(rig, 50 * k));
    const br = this.boxRect();
    if (br) rects.push({ x: br.x - 40 * k, y: br.y - 40 * k, width: br.width + 80 * k, height: br.height + 60 * k });
    for (const it of this.items.values()) {
      if (it.state === 'gone' || it.state === 'carried') continue;
      const d = ITEM_TYPES[it.type];
      const top = it.y - (it.z || 0) * CAM.H - d.h * k - 60 * k;
      rects.push({ x: it.x - d.w * k - 30 * k, y: top, width: d.w * k * 2 + 60 * k, height: it.y + 12 * k - top });
    }
    return rects;
  }

  savedPosition() {
    const c = this.crow;
    if (!c) return null;
    const w = this.world;
    let x = c.x;
    let y = c.y;
    if (c.airborne || c.state === 'away') {
      const t = c.st && c.st.target;
      if (t) {
        x = t.x;
        y = t.y;
      }
    }
    const d = w.displayAt(x, y) || w.nearestDisplay(x, y);
    if (!d) return { x, y, displayId: null, relX: null, relY: null, h: c.h };
    return {
      x,
      y,
      displayId: d.id,
      relX: M.clamp((x - d.workArea.x) / Math.max(1, d.workArea.width), 0, 1),
      relY: M.clamp((y - d.workArea.y) / Math.max(1, d.workArea.height), 0, 1),
      h: c.h,
    };
  }
}

module.exports = { Sim, SPAWN_INTERVALS, MAX_WORLD_ITEMS, ITEM_LIFETIME_S, DRAG_START_PX };
