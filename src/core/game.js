'use strict';

const { Sim } = require('./sim');
const A = require('./affection');
const { ITEM_TYPES } = require('./items');
const { t } = require('./text');
const { createRng } = require('./rng');

class Game {
  constructor({ save, seed, now } = {}) {
    this.save = save;
    this.now = now || (() => Date.now());
    this.rng = createRng(seed == null ? (Date.now() ^ 0x5bd1e995) >>> 0 : seed + 1);
    this.sim = new Sim({ seed, settings: save.settings, tierIndex: () => A.tierIndex(this.save.affection.value) });
    this.out = [];
    this.dirty = false;
    this.clockCheckT = 0;
    this.runAccum = 0;
    this.unplaced = [];
  }

  pendingGifts() {
    const out = this.sim.pendingGiftItems().map((it) => ({ type: it.type, x: it.x, y: it.y }));
    for (const p of this.unplaced) out.push({ type: p.type, x: p.x, y: p.y });
    const g = this.sim.brain && this.sim.brain.gift;
    const c = this.sim.crow;
    if (g && (g.stage !== 'return' || (c && c.carry))) out.push({ type: g.type, x: null, y: null });
    return out;
  }

  syncPending() {
    this.save.gifts.pending = this.pendingGifts();
  }

  moodSave() {
    const m = this.sim.brain.moodState();
    return { hunger: m.hunger, energy: m.energy, happiness: m.happiness, at: this.now() };
  }

  emit(e) {
    this.out.push(e);
  }

  drain() {
    const o = this.out;
    this.out = [];
    return o;
  }

  markDirty() {
    this.dirty = true;
  }

  get crowInfo() {
    return this.save.crow;
  }

  init(displays) {
    const s = this.save;
    this.sim.init(displays, s.position);
    this.unplaced = [];
    if (!s.app.hidden) {
      for (const p of s.gifts.pending) this.sim.placeGift(p.type, p.x, p.y);
    } else {
      this.unplaced = s.gifts.pending.map((p) => ({ type: p.type, x: p.x, y: p.y }));
    }
    if (s.mood) this.sim.brain.restoreMood(s.mood, s.mood.at ? this.now() - s.mood.at : 0);
    this.dailyUpdate();
    if (s.app.paused) this.sim.setPaused(true);
    if (s.app.hidden) {
      this.sim.hidden = true;
      this.sim.crow.enter('away', { reason: 'hidden' });
    }
    this.syncPending();
    this.updateNight();
  }

  dailyUpdate() {
    const s = this.save;
    const nowMs = this.now();
    const today = A.dateKey(nowMs);
    const decay = A.applyDailyDecay(s.affection, nowMs);
    if (decay) this.markDirty();
    if (s.stats.lastActiveDate !== today) {
      s.stats.lastActiveDate = today;
      s.stats.daysActive++;
      this.affection('dailyVisit');
      this.markDirty();
    }
  }

  updateNight() {
    const h = new Date(this.now()).getHours();
    this.sim.nightFactor = h >= 22 || h < 6 ? 1.8 : 1;
  }

  affection(kind) {
    const r = A.applyEvent(this.save.affection, kind, this.now());
    this.markDirty();
    if (r.levelAfter > r.levelBefore) {
      if (r.tierAfter > r.tierBefore) this.sim.toast('tierUpToast', 4, { level: r.levelAfter, tier: A.TIERS[r.tierAfter].name.toLowerCase() });
      else this.sim.toast('levelUpToast', 3.2, { level: r.levelAfter });
    }
    if (r.tierAfter > r.tierBefore) {
      const tier = A.TIERS[r.tierAfter];
      this.emit({
        type: 'notify',
        kind: 'tier',
        title: t('tierUpTitle', this.save.crow),
        body: t('tierUpBody', this.save.crow, { tier: tier.name.toLowerCase() }),
      });
      this.emit({ type: 'tierChanged', tier: tier.key });
    } else if (r.tierAfter < r.tierBefore) {
      this.emit({ type: 'tierChanged', tier: A.TIERS[r.tierAfter].key });
    }
    return r;
  }

  tier() {
    return A.tierOf(this.save.affection.value);
  }

  giftCheck(kind) {
    const s = this.save;
    this.syncPending();
    const roll = A.rollGift(this.rng, s.affection.value, s.gifts, this.now(), kind);
    if (!roll) return null;
    if (!this.sim.deliverGift(roll.type)) return null;
    A.recordGift(s.gifts, this.now());
    this.markDirty();
    this.emit({ type: 'giftIncoming', itemType: roll.type, rarity: roll.rarity });
    return roll;
  }

  step(dt) {
    const sim = this.sim;
    sim.step(dt);
    const s = this.save;
    for (const e of sim.drainEvents()) this.handle(e);
    const c = sim.crow;
    if (!sim.paused && !sim.hidden && c && c.visible && c.state !== 'sleep' && c.state !== 'away') {
      s.gifts.awakeSinceCheck += dt;
      if (s.gifts.awakeSinceCheck >= A.GIFT_CHECK_INTERVAL_S) {
        s.gifts.awakeSinceCheck = 0;
        this.giftCheck('periodic');
        this.markDirty();
      }
    }
    this.runAccum += dt;
    if (this.runAccum >= 5) {
      s.stats.totalRunSeconds += this.runAccum;
      this.runAccum = 0;
    }
    this.clockCheckT -= dt;
    if (this.clockCheckT <= 0) {
      this.clockCheckT = 30;
      this.dailyUpdate();
      this.updateNight();
      s.position = sim.savedPosition() || s.position;
      s.mood = this.moodSave();
      this.syncPending();
    }
  }

  handle(e) {
    const s = this.save;
    const st = s.stats;
    switch (e.type) {
      case 'ate': {
        st.itemsEaten++;
        if (e.handFed || e.source === 'hand') {
          st.handFed++;
          this.affection('feedHand');
          this.sim.toast('handFedToast', 3);
          this.giftCheck('handfeed');
        } else if (e.source === 'tray') {
          st.trayFed++;
          this.affection('feedTray');
          this.sim.toast('fedToast', 3);
        } else {
          this.affection('eatSpawned');
        }
        this.emit({ type: 'stats' });
        break;
      }
      case 'giftDropped':
        this.syncPending();
        this.markDirty();
        this.emit({ type: 'notify', kind: 'gift', title: t('giftTitle', s.crow), body: t('giftBody', s.crow), itemType: e.itemType });
        break;
      case 'giftCollected': {
        const inv = s.gifts.inventory;
        inv[e.itemType] = (inv[e.itemType] || 0) + 1;
        const name = ITEM_TYPES[e.itemType].name;
        if (e.found) {
          st.shiniesFound++;
          this.markDirty();
          this.sim.toast('foundCollected', 3.5, { item: name, count: inv[e.itemType] });
        } else {
          s.gifts.history.push({ type: e.itemType, at: this.now() });
          if (s.gifts.history.length > 200) s.gifts.history.splice(0, s.gifts.history.length - 200);
          st.giftsReceived++;
          this.affection('giftCollected');
          this.sim.toast('giftCollected', 3.5, { item: name, count: inv[e.itemType] });
        }
        this.syncPending();
        this.emit({ type: 'giftCollected', itemType: e.itemType, count: inv[e.itemType], found: !!e.found });
        this.emit({ type: 'stats' });
        break;
      }
      case 'petted':
        st.pets++;
        this.affection('pet');
        this.emit({ type: 'stats' });
        break;
      case 'danced':
        st.dances++;
        this.markDirty();
        this.emit({ type: 'stats' });
        break;
      case 'boxed':
      case 'boxOpened':
      case 'unboxed':
        this.emit(e);
        break;
      case 'clicked':
        st.clicks++;
        this.markDirty();
        break;
      case 'annoyed':
        this.affection('annoyed');
        break;
      case 'flight':
        st.flights++;
        break;
      case 'nap':
        st.naps++;
        break;
      case 'hop':
        st.hops++;
        break;
      case 'stashed': {
        st.shiniesStashed++;
        const def = ITEM_TYPES[e.itemType];
        if (def && def.giftRarity) {
          const inv = s.gifts.inventory;
          inv[e.itemType] = (inv[e.itemType] || 0) + 1;
          st.treasuresStashed++;
          this.emit({ type: 'giftCollected', itemType: e.itemType, count: inv[e.itemType], stashed: true });
        }
        this.markDirty();
        this.emit({ type: 'stats' });
        break;
      }
      case 'hidden':
        this.emit({ type: 'hidden' });
        break;
      case 'contextMenu':
        this.emit({ type: 'contextMenu', x: e.x, y: e.y });
        break;
      case 'sound':
        if (s.settings.sound) this.emit({ type: 'sound', name: e.name });
        break;
      case 'crowState':
      case 'diag':
        this.emit(e);
        break;
      default:
        break;
    }
  }

  feed() {
    return !!this.sim.feed();
  }

  hide() {
    const g = this.sim.brain.gift;
    const c = this.sim.crow;
    if (g && (g.stage !== 'return' || (c && c.carry))) this.unplaced.push({ type: g.type, x: null, y: null });
    this.save.app.hidden = true;
    this.markDirty();
    this.sim.hide();
    this.syncPending();
  }

  show() {
    this.save.app.hidden = false;
    this.markDirty();
    this.sim.show();
    for (const p of this.unplaced) this.sim.placeGift(p.type, p.x, p.y);
    this.unplaced = [];
    this.syncPending();
  }

  setPaused(p) {
    this.save.app.paused = !!p;
    this.markDirty();
    this.sim.setPaused(p);
  }

  rename(name) {
    this.save.crow.name = name;
    this.markDirty();
  }

  setGender(g) {
    this.save.crow.gender = g;
    this.markDirty();
  }

  applySettings(partial) {
    Object.assign(this.save.settings, partial);
    this.sim.applySettings(this.save.settings);
    this.markDirty();
  }

  summary() {
    const s = this.save;
    const tier = this.tier();
    return {
      crow: Object.assign({}, s.crow),
      tier: { key: tier.key, name: tier.name, index: A.tierIndex(s.affection.value), count: A.TIERS.length },
      affection: s.affection.value,
      level: A.levelInfo(s.affection.value),
      mood: this.sim.brain ? this.sim.brain.moodState() : null,
      music: this.sim.music,
      boxed: this.sim.boxed,
      stats: Object.assign({}, s.stats),
      inventory: Object.assign({}, s.gifts.inventory),
      settings: Object.assign({}, s.settings),
      app: Object.assign({}, s.app),
    };
  }
}

module.exports = { Game };
