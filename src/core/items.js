'use strict';

const { CAM } = require('./dims');

const ITEM_TYPES = Object.freeze({
  bread: { kind: 'food', name: 'bread crust', shape: 'bread', w: 17, h: 11, bites: 3, nutrition: 0.35, spawnWeight: 22 },
  peanut: { kind: 'food', name: 'peanut', shape: 'peanut', w: 11, h: 6, bites: 1, nutrition: 0.15, spawnWeight: 20, treat: true },
  apple: { kind: 'food', name: 'apple', shape: 'apple', w: 14, h: 15, bites: 4, nutrition: 0.45, spawnWeight: 14 },
  fry: { kind: 'food', name: 'french fry', shape: 'fry', w: 16, h: 4.5, bites: 2, nutrition: 0.2, spawnWeight: 10 },
  cherry: { kind: 'food', name: 'pair of cherries', shape: 'cherry', w: 13, h: 12, bites: 2, nutrition: 0.2, spawnWeight: 9, treat: true },
  cheese: { kind: 'food', name: 'cube of cheese', shape: 'cheese', w: 14, h: 10, bites: 2, nutrition: 0.3, spawnWeight: 7, treat: true },

  bottlecap: { kind: 'shiny', name: 'bottle cap', shape: 'bottlecap', w: 11, h: 5, spawnWeight: 8, shiny: true, giftRarity: 'common' },
  foil: { kind: 'shiny', name: 'foil ball', shape: 'foil', w: 9, h: 9, spawnWeight: 6, shiny: true, giftRarity: 'common' },
  marble: { kind: 'shiny', name: 'glass marble', shape: 'marble', w: 8, h: 8, spawnWeight: 4, shiny: true, giftRarity: 'uncommon' },

  paperclip: { kind: 'gift', name: 'paperclip', shape: 'paperclip', w: 13, h: 6, shiny: true, giftRarity: 'common' },
  pebble: { kind: 'gift', name: 'smooth pebble', shape: 'pebble', w: 10, h: 7, shiny: true, giftRarity: 'common', color: '#a3a9b3' },
  feather: { kind: 'gift', name: 'glossy black feather', shape: 'feather', w: 16, h: 6, shiny: true, giftRarity: 'common' },
  coin: { kind: 'gift', name: 'shiny coin', shape: 'coin', w: 10, h: 10, shiny: true, giftRarity: 'uncommon' },
  key: { kind: 'gift', name: 'little brass key', shape: 'key', w: 15, h: 8, shiny: true, giftRarity: 'uncommon' },
  earring: { kind: 'gift', name: 'pearl earring', shape: 'earring', w: 10, h: 11, shiny: true, giftRarity: 'rare' },
  ring: { kind: 'gift', name: 'gold ring', shape: 'ring', w: 11, h: 11, shiny: true, giftRarity: 'rare', color: '#f0c030', gem: '#7fd3ff' },
  gem: { kind: 'gift', name: 'sparkling gem', shape: 'gem', w: 11, h: 10, shiny: true, giftRarity: 'legendary', color: '#3cc6e6' },
});

const SPAWN_TABLE = Object.freeze(
  Object.entries(ITEM_TYPES)
    .filter(([, d]) => d.spawnWeight > 0)
    .map(([type, d]) => Object.freeze({ type, weight: d.spawnWeight }))
);

const TREATS = Object.freeze(Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t].treat));

const GIFT_TYPES_BY_RARITY = Object.freeze({
  common: Object.freeze(Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t].giftRarity === 'common')),
  uncommon: Object.freeze(Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t].giftRarity === 'uncommon')),
  rare: Object.freeze(Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t].giftRarity === 'rare')),
  legendary: Object.freeze(Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t].giftRarity === 'legendary')),
});

function spawnTotalWeight() {
  return SPAWN_TABLE.reduce((s, e) => s + e.weight, 0);
}

function pickSpawnType(rng) {
  return rng.weighted(SPAWN_TABLE, (e) => e.weight).type;
}

let nextItemId = 1;

function createItem(type, x, y, opts = {}) {
  const def = ITEM_TYPES[type];
  if (!def) throw new Error(`unknown item type ${type}`);
  return {
    id: opts.id || `i${nextItemId++}`,
    type,
    x,
    y,
    z: opts.z || 0,
    vx: opts.vx || 0,
    vy: opts.vy || 0,
    vz: opts.vz || 0,
    rot: opts.rot || 0,
    vrot: opts.vrot || 0,
    bitesLeft: def.bites || 0,
    age: 0,
    gift: !!opts.gift,
    handFed: false,
    held: false,
    claimedBy: null,
    state: opts.z > 0 ? 'falling' : 'resting',
    alpha: opts.alpha == null ? 1 : opts.alpha,
    scale: 1,
    seed: opts.seed || Math.floor(Math.abs(x * 7.3 + y * 3.1) % 97),
    source: opts.source || 'spawn',
    fade: 0,
    collect: 0,
  };
}

const GRAVITY = 1700;

function keepOnFloor(item, world) {
  const k = world.k;
  let d = world.displayAt(item.x, item.y);
  if (!d || item.y > d.workArea.y + d.workArea.height || item.y < d.workArea.y || item.x < d.workArea.x || item.x > d.workArea.x + d.workArea.width) {
    d = d || world.nearestDisplay(item.x, item.y);
    if (!d) return false;
    const wa = d.workArea;
    const x = Math.min(Math.max(item.x, wa.x + 12 * k), wa.x + wa.width - 12 * k);
    const y = Math.min(Math.max(item.y, wa.y + 20 * k), wa.y + wa.height - 6 * k);
    const moved = x !== item.x || y !== item.y;
    item.x = x;
    item.y = y;
    if (moved) {
      item.vx = 0;
      item.vy = 0;
    }
    return moved;
  }
  return false;
}

function stepItem(item, dt, world) {
  item.age += dt;
  if (item.state === 'held' || item.state === 'carried' || item.state === 'gone') return null;
  const k = world.k;
  if (item.state === 'resting') {
    item.z = 0;
    item.rot *= Math.exp(-dt * 12);
    if (Math.abs(item.rot) < 1e-3) item.rot = 0;
    keepOnFloor(item, world);
    return null;
  }
  item.vz -= GRAVITY * dt;
  item.z += item.vz * dt;
  item.x += item.vx * dt;
  item.y += item.vy * dt;
  item.rot += item.vrot * dt;
  const drag = Math.exp(-dt * 1.2);
  item.vx *= drag;
  item.vy *= drag;
  keepOnFloor(item, world);
  if (item.z <= 0) {
    item.z = 0;
    if (item.vz < -300 * k) {
      item.vz = -item.vz * 0.3;
      item.vx *= 0.5;
      item.vy *= 0.5;
      item.vrot *= 0.5;
      return 'bounced';
    }
    item.vz = 0;
    item.vx = 0;
    item.vy = 0;
    item.vrot = 0;
    item.state = 'resting';
    return 'landed';
  }
  return null;
}

function itemSize(type, k) {
  const d = ITEM_TYPES[type];
  return { w: d.w * k, h: d.h * k };
}

function hitTestItem(item, x, y, k, pad = 6) {
  const d = ITEM_TYPES[item.type];
  const cx = item.x;
  const cy = item.y - (item.z || 0) * CAM.H - (d.h * k) / 2;
  return Math.abs(x - cx) <= (d.w * k) / 2 + pad && Math.abs(y - cy) <= (d.h * k) / 2 + pad;
}

module.exports = {
  ITEM_TYPES,
  SPAWN_TABLE,
  TREATS,
  GIFT_TYPES_BY_RARITY,
  spawnTotalWeight,
  pickSpawnType,
  createItem,
  stepItem,
  itemSize,
  hitTestItem,
  keepOnFloor,
  GRAVITY,
};
