'use strict';

const M = require('./math');
const { CAM } = require('./dims');
const { ITEM_TYPES } = require('./items');
const { hitTest, toWorld } = require('./rig');

const DWELL = Object.freeze({ calm: [4, 12], normal: [2, 7], lively: [0.8, 3.5] });
const FLEE_RADIUS = Object.freeze([130, 80, 0, 0, 0]);
const PET = Object.freeze({ start: 3.2, max: 7, decay: 0.9, reverse: 0.9, enter: 1, minSpeed: 25, eventGap: 12 });
const SAY = Object.freeze({ gap: 18, remind: [150, 240] });
const EAT_OFFSET = 30;
const EXIT_OUT = 150;
const F = CAM.F;
const H = CAM.H;

function floorDist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, (by - ay) / F);
}

class Brain {
  constructor(sim) {
    this.sim = sim;
    this.hunger = 0.35;
    this.energy = 0.9;
    this.nextDecide = 1.2;
    this.lastCaw = -1e9;
    this.fleeCooldown = 0;
    this.ignored = new Map();
    this.plan = null;
    this.gift = null;
    this.stash = null;
    this.cursorRest = 0;
    this.happiness = 0.6;
    this.petScore = 0;
    this.petOver = false;
    this.petDir = 0;
    this.lastPetEvent = -1e9;
    this.heartT = 0;
    this.purrT = 0;
    this.musicOn = false;
    this.danceCooldown = 8;
    this.lastMood = 'content';
    this.sayT = 20;
    this.remindT = 0;
  }

  mood() {
    if (this.hunger >= 0.72) return 'hungry';
    if (this.energy <= 0.22) return 'tired';
    if (this.happiness <= 0.3) return 'sad';
    if (this.happiness >= 0.8) return 'happy';
    if (this.hunger <= 0.18) return 'satisfied';
    return 'content';
  }

  moodValue(kind) {
    switch (kind) {
      case 'hungry':
        return this.hunger;
      case 'tired':
        return 1 - this.energy;
      case 'sad':
        return 1 - this.happiness;
      case 'satisfied':
        return 1 - this.hunger;
      default:
        return this.happiness;
    }
  }

  moodState() {
    return { hunger: this.hunger, energy: this.energy, happiness: this.happiness, now: this.mood() };
  }

  restoreMood(m, awayMs = 0) {
    if (!m) return;
    const hours = Math.max(0, awayMs) / 3600000;
    if (Number.isFinite(m.hunger)) this.hunger = M.clamp(m.hunger + Math.min(0.4, hours * 0.08), 0, 0.8);
    if (Number.isFinite(m.energy)) this.energy = M.clamp(Math.max(m.energy, hours > 1 ? 0.85 : m.energy), 0, 1);
    if (Number.isFinite(m.happiness)) this.happiness = M.clamp(m.happiness, 0, 1);
  }

  canSpeak() {
    const c = this.crow;
    return !!c && c.visible && !this.sim.hidden && !this.sim.boxed && !['away', 'held', 'sleep', 'fly', 'land'].includes(c.state) && !c.airborne;
  }

  sayMood(force = false) {
    if (!this.canSpeak()) return false;
    if (!force && this.sayT > 0) return false;
    let kind = this.mood();
    if (kind === 'content') kind = this.happiness >= 0.5 ? 'happy' : 'sad';
    this.sim.say(kind, this.moodValue(kind));
    this.sayT = SAY.gap;
    return true;
  }

  updateMood(dt) {
    const c = this.crow;
    const tier = this.tier();
    const base = 0.45 + 0.1 * tier;
    this.happiness += (base - this.happiness) * Math.min(1, dt / 900);
    if (this.hunger > 0.85) this.happiness -= dt / 1500;
    if (this.energy < 0.12) this.happiness -= dt / 2400;
    if (c && c.state === 'dance') this.happiness += dt / 120;
    if (c && c.state === 'pet') this.happiness += dt / 25;
    this.happiness = M.clamp(this.happiness, 0, 1);
    this.sayT -= dt;
    this.remindT -= dt;
    const now = this.mood();
    if (now !== this.lastMood) {
      if (now !== 'content' && this.sayMood()) {
        this.lastMood = now;
        this.remindT = this.rnd().range(SAY.remind[0], SAY.remind[1]);
      } else if (now === 'content') this.lastMood = now;
    } else if (['hungry', 'tired', 'sad'].includes(now) && this.remindT <= 0 && this.sayMood()) {
      this.remindT = this.rnd().range(SAY.remind[0], SAY.remind[1]);
    }
  }

  updatePetting(dt) {
    const sim = this.sim;
    const c = this.crow;
    const k = this.k;
    this.petScore = Math.max(0, this.petScore - dt * PET.decay);
    this.heartT -= dt;
    this.purrT -= dt;
    const cur = sim.cursor;
    const can = cur && !sim.pointerBusy && !sim.boxed && c.visible && !c.airborne && !this.gift && !this.stash && ['idle', 'perch', 'walk', 'peck', 'pet', 'dance', 'reactSpawn', 'sleep'].includes(c.state);
    if (!can) {
      this.petOver = false;
      return;
    }
    const rig = sim.crowRig();
    const over = !!rig && hitTest(rig, cur.x, cur.y, 4 * k);
    const vx = sim.cursorVel.x;
    const speed = Math.hypot(sim.cursorVel.x, sim.cursorVel.y);
    if (over && speed > PET.minSpeed) {
      if (!this.petOver) this.petScore += PET.enter;
      const dir = Math.abs(vx) > 60 ? Math.sign(vx) : 0;
      if (dir && this.petDir && dir !== this.petDir) this.petScore += PET.reverse;
      if (dir) this.petDir = dir;
      this.petScore = Math.min(this.petScore, PET.max);
      this.nextDecide = Math.max(this.nextDecide, 1.5);
    }
    this.petOver = over;
    if (this.petScore < PET.start) return;
    if (c.state === 'pet') c.keepPetting(1.4);
    else {
      c.interrupt({ type: 'pet', duration: 2 });
      this.plan = 'petted';
      if (sim.time - this.lastPetEvent > PET.eventGap) {
        this.lastPetEvent = sim.time;
        this.happiness = Math.min(1, this.happiness + 0.12);
        sim.emit({ type: 'petted' });
      }
    }
    this.nextDecide = Math.max(this.nextDecide, 1.5);
    if (c.state === 'pet' && this.heartT <= 0 && rig) {
      this.heartT = 0.7;
      const [hx, hy] = toWorld(c.pose, rig.head.x, rig.head.y);
      sim.fx.push({ kind: 'heart', x: hx + this.rnd().range(-7, 7) * k, y: hy - 14 * k });
    }
    if (c.state === 'pet' && this.purrT <= 0) {
      this.purrT = this.rnd().range(2.6, 4.2);
      sim.emit({ type: 'sound', name: 'chirp' });
    }
  }

  updateMusic(dt) {
    const m = this.sim.music;
    const on = !!(m && m.playing && this.sim.settings.musicDance !== false);
    if (on && !this.musicOn) {
      this.danceCooldown = Math.min(this.danceCooldown, this.rnd().range(1.5, 4));
      this.nextDecide = Math.min(this.nextDecide, this.rnd().range(1, 3));
    }
    this.musicOn = on;
    this.danceCooldown -= dt;
  }

  onItemTaken(item) {
    const c = this.crow;
    if (!c || !item) return;
    this.ignored.set(item.id, this.sim.time + 60);
    const a = c.action;
    if (a && a.itemId === item.id && !c.airborne && c.state !== 'held') {
      c.interrupt({ type: 'idle', duration: 0.9 });
      c.showEmote('question', 1.2);
      this.plan = 'item-taken';
      this.nextDecide = 1.5;
    }
  }

  onGiftCollected() {
    this.happiness = Math.min(1, this.happiness + 0.06);
  }

  get crow() {
    return this.sim.crow;
  }

  get k() {
    return this.sim.world.k;
  }

  tier() {
    return this.sim.tierIndex();
  }

  rnd() {
    return this.sim.rng;
  }

  update(dt) {
    const c = this.crow;
    const sim = this.sim;
    if (!c) return;
    const asleep = c.state === 'sleep';
    const flying = c.state === 'fly';
    this.hunger = Math.min(1, this.hunger + dt / 1200);
    const night = sim.nightFactor || 1;
    if (asleep) this.energy = Math.min(1, this.energy + dt / 90);
    else this.energy = Math.max(0, this.energy - (dt / 1800) * night - (flying ? dt / 400 : 0));
    if (this.fleeCooldown > 0) this.fleeCooldown -= dt;

    this.updateMood(dt);
    this.updateGiftSequence(dt);
    this.updateStash(dt);

    if (sim.hidden || sim.boxed || c.state === 'held') return;
    this.keepOnFloor();
    this.updatePetting(dt);
    if (sim.settings.cursorReactions && !sim.paused) this.cursorReactions(dt);

    if (sim.paused) {
      if (!c.isBusy() && c.state === 'idle' && !c.airborne && !this.gift) c.act({ type: 'perch', duration: 1e9 });
      return;
    }
    this.updateMusic(dt);
    if (c.isBusy() || this.gift || this.stash) return;
    if (c.state !== 'idle' && c.state !== 'perch') return;
    this.nextDecide -= dt;
    if (this.nextDecide > 0) return;
    this.decide();
  }

  keepOnFloor() {
    const c = this.crow;
    if (c.airborne || c.state === 'away' || this.gift || this.stash) return;
    if (!['idle', 'perch', 'peck', 'eat', 'sleep', 'reactSpawn'].includes(c.state)) return;
    if (this.fixingRange && c.time < this.fixingRange) return;
    if (c.standable(c.x, c.y, c.perchId)) return;
    const w = this.sim.world;
    const k = this.k;
    const t = w.clampWalkable(c.x, c.y);
    if (!t) return;
    this.fixingRange = c.time + 2;
    const d = floorDist(c.x, c.y, t.x, t.y);
    const here = w.displayAt(c.x, c.y);
    if (d < 60 * k) c.interrupt({ type: 'hopTo', x: t.x, y: t.y });
    else if (d < 260 * k && here && here.id === t.displayId) c.interrupt({ type: 'walkTo', x: t.x, y: t.y });
    else c.interrupt({ type: 'flyTo', target: { x: t.x, y: t.y } });
    this.plan = 'back-on-floor';
  }

  dwell() {
    const [a, b] = DWELL[this.sim.settings.activity] || DWELL.normal;
    this.nextDecide = this.rnd().range(a, b);
  }

  cursorReactions(dt) {
    const c = this.crow;
    const cur = this.sim.cursor;
    if (!cur || !c.visible || c.state === 'away') return;
    const k = this.k;
    const hx = c.x + Math.cos(c.h) * 12 * k;
    const hy = c.y - (c.z + 42 * k) * H;
    const d = Math.hypot(cur.x - hx, cur.y - hy);
    const speed = Math.hypot(this.sim.cursorVel.x, this.sim.cursorVel.y);
    const [fx, fy] = c.eyeLevelFloor(cur.x, cur.y);
    const watchStates = ['idle', 'perch', 'land', 'reactClick'];
    if (d < 320 * k && watchStates.includes(c.state)) {
      c.lookTarget = { x: fx, y: fy, atEye: true, until: c.time + 0.3 };
    }
    const tier = this.tier();
    const fr = FLEE_RADIUS[tier] * k;
    const stroking = this.petOver || this.petScore >= 1 || c.state === 'pet';
    if (fr > 0 && d < fr && !stroking && (speed > 260 || d < 34 * k) && this.fleeCooldown <= 0 && !c.airborne && ['idle', 'perch', 'walk', 'peck'].includes(c.state) && !this.gift) {
      this.fleeCooldown = 3.5;
      if (tier === 0 && d < 60 * k) this.planFlyAway(cur.x, cur.y);
      else {
        let ux = c.x - fx;
        let uy = (c.y - fy) / F;
        const len = Math.hypot(ux, uy);
        if (len < 1e-6) {
          ux = -Math.cos(c.h);
          uy = -Math.sin(c.h);
        } else {
          ux /= len;
          uy /= len;
        }
        const t = this.onMyFloor(c.x + ux * 75 * k, c.y + uy * 75 * k * F);
        c.interrupt({ type: 'hopTo', x: t.x, y: t.y, excited: true });
        this.plan = 'flee-hop';
      }
      this.nextDecide = 2;
      return;
    }
    if (tier >= 2 && speed < 30 && d < 160 * k) this.cursorRest += dt;
    else this.cursorRest = 0;
    if (this.cursorRest > 2.5 && !c.isBusy() && c.state === 'idle' && !this.gift) {
      this.cursorRest = -6;
      if (this.rnd().chance(0.5)) {
        const dd = floorDist(c.x, c.y, fx, fy);
        if (dd > 70 * k) {
          const f = (dd - 55 * k) / dd;
          const t = this.onMyFloor(c.x + (fx - c.x) * f, c.y + (fy - c.y) * f);
          if (floorDist(c.x, c.y, t.x, t.y) > 10 * k) c.act({ type: dd > 160 * k ? 'walkTo' : 'hopTo', x: t.x, y: t.y });
        }
        c.act({ type: 'idle', duration: 1.2 });
        this.plan = 'approach-cursor';
      } else {
        c.caw('chirp');
      }
    }
  }

  onMyFloor(x, y) {
    const w = this.sim.world;
    const c = this.crow;
    const a = w.areaAt(c.x, c.y, 1);
    if (a) return { x: M.clamp(x, a.x0, a.x1), y: M.clamp(y, a.y0, a.y1) };
    return w.clampWalkable(x, y) || { x: c.x, y: c.y };
  }

  onItemLanded(item) {
    const c = this.crow;
    if (!c || this.sim.hidden || this.sim.paused || this.gift) return;
    if (!c.visible || c.state === 'away' || c.state === 'held') return;
    const def = ITEM_TYPES[item.type];
    if (!def || item.gift || def.kind === 'gift') return;
    const k = this.k;
    const far = floorDist(c.x, c.y, item.x, item.y) > 1100 * k;
    if (far && item.source === 'spawn') return;
    if (c.state === 'sleep') {
      const want = item.source !== 'spawn' || this.hunger > 0.6;
      if (!want || !this.rnd().chance(item.source === 'spawn' ? 0.5 : 0.9)) return;
    }
    if (['eat', 'giftDrop', 'fly', 'land'].includes(c.state) || c.airborne) return;
    if (c.state === 'hop' || c.state === 'walk') {
      if (item.source === 'spawn' && this.rnd().chance(0.5)) return;
    }
    c.interrupt({ type: 'reactSpawn', itemId: item.id });
    this.plan = 'react-spawn';
    this.nextDecide = 0.1;
  }

  onHandOffer(item) {
    const c = this.crow;
    if (!c || this.gift || c.state === 'held') return;
    c.interrupt({ type: 'eat', itemId: item.id, onDone: (ok) => this.afterEat(ok, item) });
    this.plan = 'hand-fed';
    this.nextDecide = 0.5;
  }

  onClicked(x, y, annoyed) {
    const c = this.crow;
    if (!c || c.state === 'away' || c.state === 'held') return;
    if (c.state === 'fly' || c.state === 'land' || c.airborne) {
      c.flinch();
      return;
    }
    if (annoyed) this.happiness = Math.max(0, this.happiness - 0.25);
    if (annoyed && !this.gift) {
      c.interrupt({ type: 'reactClick', x, y });
      this.planFlyAway(x, y, true);
      return;
    }
    c.interrupt({ type: 'reactClick', x, y });
    this.plan = 'clicked';
    this.nextDecide = 1.5;
    if (!annoyed) this.sayMood(true);
  }

  onGrabbed() {
    this.plan = 'held';
    this.stash = null;
    if (this.gift && this.gift.stage === 'return') this.gift = null;
    this.cursorRest = 0;
  }

  onReleased() {
    this.nextDecide = this.rnd().range(1.2, 2.6);
    if (this.sim.hiding) this.flyAway();
  }

  decide() {
    const c = this.crow;
    const rng = this.rnd();
    const k = this.k;
    const w = this.sim.world;
    const food = this.bestItem((it) => ITEM_TYPES[it.type].kind === 'food');
    if (food && (this.hunger > 0.22 || food.source !== 'spawn' || rng.chance(0.3))) {
      if (this.planApproach(food, 'eat')) return;
    }
    const shiny = this.bestItem((it) => ITEM_TYPES[it.type].kind === 'shiny');
    if (shiny && rng.chance(0.45)) {
      if (this.planApproach(shiny, 'inspect')) return;
    }
    if (this.energy < 0.25) {
      this.planNap();
      return;
    }
    const perch = c.perch();
    const onBar = !!(perch && perch.kind === 'taskbar');
    const onEdge = !!(perch && perch.kind === 'window');
    const multi = this.sim.settings.multiMonitor;
    const myDisplay = w.displayAt(c.x, c.y) || w.nearestDisplay(c.x, c.y);
    const edges = w.perches.filter((p) => p.kind === 'window' && p.id !== c.perchId && (multi || !myDisplay || p.displayId === myDisplay.id) && w.perchRange(p));
    const bars = w.perches.filter((p) => p.kind === 'taskbar' && p.id !== c.perchId && (multi || !myDisplay || p.displayId === myDisplay.id) && w.perchRange(p));
    const act = this.sim.settings.activity;
    const lively = act === 'lively' ? 1.5 : act === 'calm' ? 0.6 : 1;
    const options = [
      { name: 'wander', w: (onBar ? 1 : 3) * lively },
      { name: 'hopAbout', w: (onBar ? 0.3 : 1.2) * lively },
      { name: 'forage', w: perch ? 0.3 : 1.6 },
      { name: 'lookAround', w: 2.2 / lively },
      { name: 'perchRest', w: perch ? 2.2 : 0.8 },
      { name: 'flyToEdge', w: edges.length ? 1.3 * lively : 0 },
      { name: 'flyToBar', w: bars.length && !onBar ? 0.5 * lively : 0 },
      { name: 'flyDown', w: onBar || onEdge ? 1.2 : 0 },
      { name: 'flyAcross', w: 0.6 * lively * (multi && w.displays.length > 1 ? 2 : 1) },
      { name: 'caw', w: c.time - this.lastCaw > 90 ? 0.35 : 0 },
      { name: 'nap', w: this.energy < 0.5 ? 0.8 : 0.05 },
      { name: 'dance', w: this.musicOn && this.danceCooldown <= 0 && this.energy > 0.15 ? 4.5 * lively : 0 },
    ];
    const pick = rng.weighted(options, (o) => o.w);
    this.plan = pick.name;
    const speed = act === 'lively' ? 44 : act === 'calm' ? 30 : 36;
    switch (pick.name) {
      case 'wander': {
        const t = this.randomSpotNear(60, 320);
        if (t) c.act({ type: 'walkTo', x: t.x, y: t.y, speed });
        break;
      }
      case 'hopAbout': {
        const t = this.randomSpotNear(25, 90);
        if (t) c.act({ type: 'hopTo', x: t.x, y: t.y });
        break;
      }
      case 'forage':
        c.act({ type: 'peck', count: rng.int(2, 4) });
        break;
      case 'lookAround':
        c.act({ type: 'idle', duration: rng.range(2, 6) });
        break;
      case 'perchRest':
        c.act({ type: 'perch', duration: rng.range(6, 20) });
        break;
      case 'flyToEdge': {
        const p = this.pickPerch(edges);
        if (p) this.goToPerch(p);
        break;
      }
      case 'flyToBar': {
        const p = this.pickPerch(bars);
        if (p) this.goToPerch(p);
        break;
      }
      case 'flyDown': {
        const t = this.randomSpotNear(80, 260) || w.clampWalkable(c.x, c.y);
        if (t) {
          if (floorDist(c.x, c.y, t.x, t.y) < 110 * k && onEdge) c.act({ type: 'walkTo', x: t.x, y: t.y, speed });
          else c.act({ type: 'flyTo', target: { x: t.x, y: t.y } });
        }
        break;
      }
      case 'flyAcross': {
        const t = w.randomWalkable(rng, multi ? {} : { displayId: myDisplay ? myDisplay.id : undefined });
        if (t && floorDist(c.x, c.y, t.x, t.y) > 200 * k) c.act({ type: 'flyTo', target: { x: t.x, y: t.y } });
        else if (t) c.act({ type: 'walkTo', x: t.x, y: t.y, speed });
        break;
      }
      case 'caw':
        this.lastCaw = c.time;
        c.caw('caw');
        c.act({ type: 'idle', duration: 1.2 });
        break;
      case 'nap':
        this.planNap();
        break;
      case 'dance':
        c.act({ type: 'dance', duration: rng.range(7, 14), beat: rng.range(0.45, 0.56) });
        this.danceCooldown = rng.range(18, 45);
        this.sim.emit({ type: 'danced' });
        break;
      default:
        break;
    }
    this.dwell();
  }

  randomSpotNear(minR, maxR) {
    const c = this.crow;
    const w = this.sim.world;
    const k = this.k;
    const here = w.areaAt(c.x, c.y, 1) || w.clampWalkable(c.x, c.y);
    if (!here) return null;
    const near = w.areaAt(c.x, c.y, 1) ? { x: c.x, y: c.y } : w.clampWalkable(c.x, c.y);
    return w.randomWalkable(this.rnd(), { near, minR: minR * k, maxR: maxR * k, displayId: here.displayId });
  }

  bestItem(filter) {
    const c = this.crow;
    const now = this.sim.time;
    let best = null;
    let bestScore = -Infinity;
    for (const it of this.sim.items.values()) {
      if (it.state !== 'resting' || it.gift || it.held || it.glide || it.collect > 0 || !filter(it)) continue;
      if (it.claimedBy === 'user') continue;
      const until = this.ignored.get(it.id);
      if (until && until > now) continue;
      const d = floorDist(c.x, c.y, it.x, it.y);
      const bonus = it.source !== 'spawn' ? 2000 : 0;
      const score = bonus - d;
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  standingSpotFor(item) {
    const c = this.crow;
    const w = this.sim.world;
    const k = this.k;
    const base = Math.atan2((c.y - item.y) / F, c.x - item.x);
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
      const a = base + da;
      const x = item.x + Math.cos(a) * EAT_OFFSET * k;
      const y = item.y + Math.sin(a) * EAT_OFFSET * k * F;
      if (w.inWalkable(x, y, 0)) return { x, y };
    }
    return null;
  }

  planApproach(item, what) {
    const c = this.crow;
    const w = this.sim.world;
    const k = this.k;
    const spot = this.standingSpotFor(item);
    if (!spot) {
      this.ignored.set(item.id, this.sim.time + 60);
      return false;
    }
    const myArea = !c.airborne ? w.areaAt(c.x, c.y, 0.5) : null;
    const sameArea = !!myArea && myArea === w.areaAt(spot.x, spot.y, 0.5) && (!c.perchId || c.perch().kind === 'window');
    const d = floorDist(c.x, c.y, spot.x, spot.y);
    if (sameArea && d < 900 * k) {
      if (d > 1.5 * k) {
        if (d < 110 * k && this.rnd().chance(0.5)) c.act({ type: 'hopTo', x: spot.x, y: spot.y, excited: true });
        else c.act({ type: 'walkTo', x: spot.x, y: spot.y, speed: d > 300 * k ? 46 : 38 });
      }
    } else {
      c.act({ type: 'flyTo', target: { x: spot.x, y: spot.y } });
    }
    if (what === 'eat') c.act({ type: 'eat', itemId: item.id, onDone: (ok) => this.afterEat(ok, item) });
    else {
      const pickUp = this.rnd().chance(0.5);
      c.act({
        type: 'peck',
        itemId: item.id,
        x: item.x,
        y: item.y,
        count: this.rnd().int(2, 3),
        pickUp,
        onDone: () => {
          if (pickUp && c.carry && c.carry.itemId === item.id) this.startStash(item);
        },
      });
    }
    this.plan = what === 'eat' ? 'go-eat' : 'go-inspect';
    return true;
  }

  afterEat(ok, item) {
    if (!ok) {
      this.ignored.set(item.id, this.sim.time + 20);
      return;
    }
    const def = ITEM_TYPES[item.type];
    this.hunger = Math.max(0, this.hunger - (def.nutrition || 0.2));
    this.energy = Math.min(1, this.energy + 0.05);
    this.happiness = Math.min(1, this.happiness + (item.handFed ? 0.12 : 0.05));
  }

  pickPerch(list) {
    const c = this.crow;
    const rng = this.rnd();
    const k = this.k;
    if (!list.length) return null;
    return rng.weighted(list, (p) => {
      const mid = (p.x0 + p.x1) / 2;
      const d = floorDist(c.x, c.y, mid, p.y);
      return (p.x1 - p.x0) / (200 * k + d);
    });
  }

  goToPerch(p, preferX) {
    const c = this.crow;
    const w = this.sim.world;
    const k = this.k;
    const r = w.perchRange(p);
    if (!r) return;
    const x = M.clamp(preferX != null ? preferX : M.lerp(r.x0, r.x1, this.rnd().range(0.15, 0.85)), r.x0, r.x1);
    const target = { x, y: p.y, perchId: p.id };
    const d = floorDist(c.x, c.y, x, p.y);
    const area = w.areaAt(c.x, c.y, 0.5);
    if (!c.airborne && d < 26 * k) c.act({ type: 'hopTo', x, y: p.y, perchId: p.id });
    else if (!c.airborne && d < 160 * k && area && area === w.areaAt(x, p.y + 20 * k * F, 0.5)) {
      const ay = p.y + 20 * k * F;
      c.act({ type: 'walkTo', x, y: ay });
      c.act({ type: 'hopTo', x, y: p.y, perchId: p.id });
    } else c.act({ type: 'flyTo', target });
    const rng = this.rnd();
    c.act({ type: 'turn', h: rng.pick([0, Math.PI, Math.PI, 0, Math.PI / 2]) + rng.range(-0.35, 0.35) });
  }

  planFlyAway(fromX, fromY, annoyed = false) {
    const c = this.crow;
    const w = this.sim.world;
    const k = this.k;
    const rng = this.rnd();
    const multi = this.sim.settings.multiMonitor;
    const myDisplay = w.displayAt(c.x, c.y) || w.nearestDisplay(c.x, c.y);
    const cands = [];
    for (let i = 0; i < 14; i++) {
      const t = w.randomWalkable(rng, multi ? {} : { displayId: myDisplay ? myDisplay.id : undefined });
      if (!t) continue;
      const d = floorDist(fromX, fromY, t.x, t.y);
      if (d > 300 * k) cands.push({ target: { x: t.x, y: t.y }, w: d });
    }
    for (const p of w.perches) {
      const r = w.perchRange(p);
      if (!r || p.id === c.perchId || (!multi && myDisplay && p.displayId !== myDisplay.id)) continue;
      const x = (r.x0 + r.x1) / 2;
      const d = floorDist(fromX, fromY, x, p.y);
      if (d > 300 * k) cands.push({ target: { x, y: p.y, perchId: p.id }, w: d });
    }
    const pick = cands.length ? rng.weighted(cands, (q) => q.w) : null;
    if (pick) c.act({ type: 'flyTo', target: pick.target, mode: 'flee' });
    this.plan = annoyed ? 'annoyed-fly' : 'flee-fly';
    this.nextDecide = 3;
  }

  planNap() {
    const c = this.crow;
    const rng = this.rnd();
    const w = this.sim.world;
    if (!c.perchId && rng.chance(0.5)) {
      const edges = w.perches.filter((p) => w.perchRange(p));
      const p = this.pickPerch(edges);
      if (p) this.goToPerch(p);
    }
    c.act({ type: 'perch', duration: rng.range(2, 5) });
    c.act({ type: 'sleep', duration: rng.range(45, 200), onDone: () => this.sim.emit({ type: 'napDone' }) });
    this.plan = 'nap';
  }

  offscreenPoint() {
    const w = this.sim.world;
    const c = this.crow;
    const d = w.displayAt(c.x, c.y) || w.nearestDisplay(c.x, c.y);
    return w.edgeExit(d, c.x, c.y, EXIT_OUT * this.k);
  }

  flyInTo(target) {
    const c = this.crow;
    const w = this.sim.world;
    const k = this.k;
    const d = w.displayAt(target.x, target.y) || w.nearestDisplay(target.x, target.y);
    const e = w.edgeExit(d, target.x, target.y, EXIT_OUT * k);
    const sp = 240 * k;
    const v = { left: [sp, 0], right: [-sp, 0], top: [0, sp * F], bottom: [0, -sp * F] }[e.side] || [sp, 0];
    c.act({ type: 'flyIn', target, from: { x: e.x, y: e.y, vx: v[0], vy: v[1], z: 60 * k } });
    return e.side;
  }

  landingNear(x, y) {
    const w = this.sim.world;
    const k = this.k;
    const a = this.rnd().range(0, Math.PI * 2);
    const t = w.clampWalkable(x + Math.cos(a) * 60 * k, y + Math.sin(a) * 60 * k * F);
    return t ? { x: t.x, y: t.y } : null;
  }

  deliverGift(type) {
    const c = this.crow;
    if (!c || this.gift || this.stash || c.state === 'away' || c.state === 'held') return false;
    this.gift = { type, stage: 'leave', t: 0 };
    c.interrupt({ type: 'flyOff', offscreen: () => this.offscreenPoint() });
    this.plan = 'gift';
    return true;
  }

  readyForErrand() {
    const c = this.crow;
    return !c.airborne && !c.isBusy() && (c.state === 'idle' || c.state === 'perch');
  }

  updateGiftSequence(dt) {
    const g = this.gift;
    if (!g) return;
    const c = this.crow;
    g.t += dt;
    if (g.stage === 'leave' && c.state !== 'away' && this.readyForErrand()) {
      c.interrupt({ type: 'flyOff', offscreen: () => this.offscreenPoint() });
    } else if (g.stage === 'leave' && c.state === 'away') {
      g.stage = 'away';
      g.t = 0;
      g.wait = this.rnd().range(2.5, 5);
    } else if (g.stage === 'away' && g.t >= g.wait && !this.sim.hidden) {
      const cur = this.sim.cursor;
      const u = this.sim.world.union();
      const target = cur && this.sim.world.displayAt(cur.x, cur.y) ? this.landingNear(cur.x, cur.y + 60 * this.k) : this.landingNear(u.x + u.width / 2, u.y + u.height / 2);
      if (!target) return;
      c.carry = { type: g.type, seed: this.rnd().int(0, 90), itemId: null };
      this.flyInTo(target);
      c.act({ type: 'giftDrop' });
      g.stage = 'return';
      g.t = 0;
    } else if (g.stage === 'return') {
      if (!c.carry && c.state !== 'giftDrop') {
        this.gift = null;
        this.dwell();
      } else if (c.carry && this.readyForErrand()) {
        c.act({ type: 'giftDrop' });
      } else if (g.t > 40) {
        c.dropCarry();
        this.gift = null;
      }
    } else if (g.t > 90 && g.stage !== 'away') {
      this.gift = null;
    }
  }

  startStash(item) {
    this.stash = { itemId: item.id, stage: 'leave', t: 0 };
    this.crow.act({ type: 'flyOff', offscreen: () => this.offscreenPoint() });
    this.plan = 'stash';
  }

  updateStash(dt) {
    const st = this.stash;
    if (!st) return;
    const c = this.crow;
    st.t += dt;
    if (st.stage === 'leave' && c.state === 'away') {
      st.stage = 'away';
      st.t = 0;
      c.carry = null;
      this.sim.removeItem(st.itemId, 'stashed');
    } else if (st.stage === 'leave' && !c.carry) {
      this.stash = null;
    } else if (st.stage === 'leave' && this.readyForErrand()) {
      c.interrupt({ type: 'flyOff', offscreen: () => this.offscreenPoint() });
    } else if (st.stage === 'away' && st.t > this.rnd().range(2, 4) && !this.sim.hidden) {
      const t = this.sim.world.randomWalkable(this.rnd(), {});
      if (t) this.flyInTo({ x: t.x, y: t.y });
      st.stage = 'return';
    } else if (st.stage === 'return' && c.state !== 'fly' && c.state !== 'away') {
      this.stash = null;
      this.dwell();
    } else if (st.t > 60) {
      if (c.carry && c.carry.itemId === st.itemId) c.dropCarry();
      this.stash = null;
    }
  }

  flyAway() {
    const c = this.crow;
    this.gift = null;
    this.stash = null;
    c.interrupt({ type: 'flyOff', offscreen: () => this.offscreenPoint() });
    this.plan = 'hide';
  }

  flyBack(near) {
    const c = this.crow;
    const u = this.sim.world.union();
    const p = near || { x: u.x + u.width / 2, y: u.y + u.height / 2 };
    const target = this.landingNear(p.x, p.y);
    if (!target) return;
    this.gift = null;
    this.stash = null;
    c.carry = null;
    c.queue = [];
    this.flyInTo(target);
    this.plan = 'show';
    this.nextDecide = 2;
  }
}

module.exports = { Brain, EAT_OFFSET, DWELL, FLEE_RADIUS, floorDist };
