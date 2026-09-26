'use strict';

const { GIFT_TYPES_BY_RARITY } = require('./items');

const AFFECTION_MAX = 1000;

const TIERS = Object.freeze([
  Object.freeze({ key: 'wary', name: 'Wary', min: 0 }),
  Object.freeze({ key: 'curious', name: 'Curious', min: 100 }),
  Object.freeze({ key: 'friendly', name: 'Friendly', min: 250 }),
  Object.freeze({ key: 'trusting', name: 'Trusting', min: 450 }),
  Object.freeze({ key: 'bonded', name: 'Bonded', min: 700 }),
]);

const LEVEL_MINS = Object.freeze([0, 20, 45, 70, 100, 135, 170, 210, 250, 295, 345, 395, 450, 510, 570, 635, 700, 775, 850, 930]);
const MAX_LEVEL = LEVEL_MINS.length;

const GAINS = Object.freeze({
  eatSpawned: 1,
  feedTray: 6,
  feedHand: 10,
  giftCollected: 4,
  dailyVisit: 5,
  pet: 2,
});

const CURVE_K = 1400;

const MANUAL_FEED_WINDOW_MS = 15 * 60 * 1000;
const DAILY_MANUAL_CAP = 120;
const DAILY_PASSIVE_CAP = 15;
const DAILY_PET_CAP = 20;

const ANNOY = Object.freeze({ clicks: 3, windowMs: 4000, penalty: -4, cooldownMs: 10000 });

const DECAY = Object.freeze({ graceDays: 2, perDay: 5, maxPerCheck: 60 });

const GIFT_CHECK_INTERVAL_S = 8 * 60;
const GIFT_CHANCE = Object.freeze({ wary: 0, curious: 0, friendly: 0.06, trusting: 0.12, bonded: 0.2 });
const GIFT_HANDFEED_CHANCE = Object.freeze({ wary: 0, curious: 0, friendly: 0.03, trusting: 0.06, bonded: 0.1 });
const GIFT_COOLDOWN_MS = 20 * 60 * 1000;
const GIFTS_PER_DAY_MAX = 4;
const MAX_PENDING_GIFTS = 2;
const RARITY_WEIGHTS = Object.freeze({
  friendly: Object.freeze({ common: 80, uncommon: 18, rare: 2, legendary: 0 }),
  trusting: Object.freeze({ common: 65, uncommon: 28, rare: 6, legendary: 1 }),
  bonded: Object.freeze({ common: 50, uncommon: 35, rare: 12, legendary: 3 }),
});
const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'legendary']);

function clampAffection(v) {
  return Math.max(0, Math.min(AFFECTION_MAX, Math.round(v)));
}

function tierIndex(value) {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) if (value >= TIERS[i].min) idx = i;
  return idx;
}

function tierOf(value) {
  return TIERS[tierIndex(value)];
}

function levelIndex(value) {
  let idx = 0;
  for (let i = 0; i < LEVEL_MINS.length; i++) if (value >= LEVEL_MINS[i]) idx = i;
  return idx;
}

function levelOf(value) {
  return levelIndex(value) + 1;
}

function tierLevels(index) {
  const lo = levelIndex(TIERS[index].min) + 1;
  const hi = index + 1 < TIERS.length ? levelIndex(TIERS[index + 1].min) : MAX_LEVEL;
  return { from: lo, to: hi };
}

function levelInfo(value) {
  const v = clampAffection(Number(value) || 0);
  const i = levelIndex(v);
  const min = LEVEL_MINS[i];
  const next = i + 1 < MAX_LEVEL ? LEVEL_MINS[i + 1] : null;
  return {
    level: i + 1,
    maxLevel: MAX_LEVEL,
    value: v,
    min,
    next,
    progress: next == null ? 1 : (v - min) / (next - min),
    toNext: next == null ? 0 : next - v,
    tierIndex: tierIndex(v),
  };
}

function effectiveGain(base, value) {
  if (base <= 0) return base;
  return Math.max(1, Math.round(base * (1 - value / CURVE_K)));
}

function dateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(aKey, bKey) {
  const a = Date.UTC(+aKey.slice(0, 4), +aKey.slice(5, 7) - 1, +aKey.slice(8, 10));
  const b = Date.UTC(+bKey.slice(0, 4), +bKey.slice(5, 7) - 1, +bKey.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

function applyEvent(state, kind, nowMs) {
  const before = state.value;
  let delta = 0;
  if (kind === 'annoyed') {
    delta = ANNOY.penalty;
  } else {
    const base = GAINS[kind];
    if (base == null) throw new Error(`unknown affection event ${kind}`);
    delta = effectiveGain(base, before);
    if (kind === 'feedTray' || kind === 'feedHand') {
      const recent = (state.manualFeeds || []).filter((t) => nowMs - t < MANUAL_FEED_WINDOW_MS);
      delta = Math.max(1, Math.round(delta * Math.pow(0.5, recent.length)));
      recent.push(nowMs);
      state.manualFeeds = recent.slice(-20);
      const today = dateKey(nowMs);
      if (!state.dailyManual || state.dailyManual.date !== today) state.dailyManual = { date: today, points: 0 };
      const room = Math.max(0, DAILY_MANUAL_CAP - state.dailyManual.points);
      delta = Math.min(delta, room);
      state.dailyManual.points += delta;
    }
    if (kind === 'eatSpawned') {
      const today = dateKey(nowMs);
      if (!state.dailyPassive || state.dailyPassive.date !== today) state.dailyPassive = { date: today, points: 0 };
      delta = Math.min(delta, Math.max(0, DAILY_PASSIVE_CAP - state.dailyPassive.points));
      state.dailyPassive.points += delta;
    }
    if (kind === 'pet') {
      const today = dateKey(nowMs);
      if (!state.dailyPet || state.dailyPet.date !== today) state.dailyPet = { date: today, points: 0 };
      delta = Math.min(delta, Math.max(0, DAILY_PET_CAP - state.dailyPet.points));
      state.dailyPet.points += delta;
    }
    if (kind === 'feedTray' || kind === 'feedHand' || kind === 'eatSpawned') state.lastFedAt = nowMs;
  }
  state.value = clampAffection(before + delta);
  const tb = tierIndex(before);
  const ta = tierIndex(state.value);
  return { delta: state.value - before, before, after: state.value, tierBefore: tb, tierAfter: ta, levelBefore: levelOf(before), levelAfter: levelOf(state.value) };
}

function applyDailyDecay(state, nowMs) {
  const today = dateKey(nowMs);
  if (state.lastDecayCheck === today) return 0;
  state.lastDecayCheck = today;
  if (!state.lastFedAt) return 0;
  const gap = daysBetween(dateKey(state.lastFedAt), today);
  if (gap <= DECAY.graceDays) return 0;
  const loss = Math.min(DECAY.maxPerCheck, DECAY.perDay * (gap - DECAY.graceDays));
  const before = state.value;
  state.value = clampAffection(before - loss);
  return state.value - before;
}

function giftChance(value, kind = 'periodic') {
  const key = tierOf(value).key;
  return kind === 'handfeed' ? GIFT_HANDFEED_CHANCE[key] : GIFT_CHANCE[key];
}

function canGift(gifts, nowMs) {
  if (gifts.lastGiftAt && nowMs - gifts.lastGiftAt < GIFT_COOLDOWN_MS) return false;
  const today = dateKey(nowMs);
  const count = gifts.today && gifts.today.date === today ? gifts.today.count : 0;
  if (count >= GIFTS_PER_DAY_MAX) return false;
  if ((gifts.pending || []).length >= MAX_PENDING_GIFTS) return false;
  return true;
}

function recordGift(gifts, nowMs) {
  const today = dateKey(nowMs);
  if (!gifts.today || gifts.today.date !== today) gifts.today = { date: today, count: 0 };
  gifts.today.count++;
  gifts.lastGiftAt = nowMs;
}

function pickGiftItem(rng, value) {
  const key = tierOf(value).key;
  const weights = RARITY_WEIGHTS[key] || RARITY_WEIGHTS.friendly;
  const rarity = rng.weighted(RARITIES, (r) => weights[r]);
  const pool = GIFT_TYPES_BY_RARITY[rarity];
  return { rarity, type: rng.pick(pool) };
}

function rollGift(rng, value, gifts, nowMs, kind = 'periodic') {
  if (!canGift(gifts, nowMs)) return null;
  const p = giftChance(value, kind);
  if (p <= 0 || !rng.chance(p)) return null;
  return pickGiftItem(rng, value);
}

module.exports = {
  AFFECTION_MAX,
  TIERS,
  LEVEL_MINS,
  MAX_LEVEL,
  GAINS,
  CURVE_K,
  MANUAL_FEED_WINDOW_MS,
  DAILY_MANUAL_CAP,
  DAILY_PASSIVE_CAP,
  DAILY_PET_CAP,
  ANNOY,
  DECAY,
  GIFT_CHECK_INTERVAL_S,
  GIFT_CHANCE,
  GIFT_HANDFEED_CHANCE,
  GIFT_COOLDOWN_MS,
  GIFTS_PER_DAY_MAX,
  MAX_PENDING_GIFTS,
  RARITY_WEIGHTS,
  RARITIES,
  clampAffection,
  tierIndex,
  tierOf,
  levelIndex,
  levelOf,
  tierLevels,
  levelInfo,
  effectiveGain,
  dateKey,
  daysBetween,
  applyEvent,
  applyDailyDecay,
  giftChance,
  canGift,
  recordGift,
  pickGiftItem,
  rollGift,
};
