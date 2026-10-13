'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../src/core/affection');
const { ITEM_TYPES, SPAWN_TABLE, spawnTotalWeight, pickSpawnType, GIFT_TYPES_BY_RARITY } = require('../src/core/items');
const { createRng } = require('../src/core/rng');

const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 26, 12);

function freshState() {
  return { value: 0, lastFedAt: null, lastDecayCheck: null, manualFeeds: [], dailyManual: null };
}

test('tiers: thresholds ascending, tierOf consistent', () => {
  for (let i = 1; i < A.TIERS.length; i++) assert.ok(A.TIERS[i].min > A.TIERS[i - 1].min);
  assert.equal(A.tierOf(0).key, 'wary');
  assert.equal(A.tierOf(99).key, 'wary');
  assert.equal(A.tierOf(100).key, 'curious');
  assert.equal(A.tierOf(250).key, 'friendly');
  assert.equal(A.tierOf(449).key, 'friendly');
  assert.equal(A.tierOf(450).key, 'trusting');
  assert.equal(A.tierOf(700).key, 'bonded');
  assert.equal(A.tierOf(1000).key, 'bonded');
  assert.equal(A.tierOf(A.AFFECTION_MAX).key, 'bonded');
});

test('levels: 50 ascending thresholds, four per tier up to 20, every tier starts a level', () => {
  assert.equal(A.MAX_LEVEL, 50);
  assert.equal(A.CLASSIC_LEVELS, 20);
  assert.equal(A.LEVEL_MINS[0], 0);
  for (let i = 1; i < A.LEVEL_MINS.length; i++) assert.ok(A.LEVEL_MINS[i] > A.LEVEL_MINS[i - 1]);
  assert.ok(A.LEVEL_MINS[A.LEVEL_MINS.length - 1] < A.AFFECTION_MAX);
  for (let t = 0; t < A.TIERS.length; t++) {
    assert.ok(A.LEVEL_MINS.includes(A.TIERS[t].min), `tier ${A.TIERS[t].key} starts a level`);
    const r = A.tierLevels(t);
    if (t < A.TIERS.length - 1) assert.equal(r.to - r.from + 1, 4, `tier ${A.TIERS[t].key} spans four levels`);
    assert.equal(A.tierIndex(A.LEVEL_MINS[r.from - 1]), t);
    assert.equal(A.tierIndex(A.LEVEL_MINS[r.to - 1]), t);
  }
  assert.deepEqual(A.tierLevels(0), { from: 1, to: 4 });
  assert.deepEqual(A.tierLevels(4), { from: 17, to: 50 });
});

test('levels 1 to 20 keep the thresholds they had, and the new ones come after', () => {
  assert.deepEqual(A.LEVEL_MINS.slice(0, 20), [0, 20, 45, 70, 100, 135, 170, 210, 250, 295, 345, 395, 450, 510, 570, 635, 700, 775, 850, 930]);
  assert.equal(A.LEVEL_MINS[20], 1000);
  for (let v = 0; v <= 1000; v += 5) {
    const old = [0, 20, 45, 70, 100, 135, 170, 210, 250, 295, 345, 395, 450, 510, 570, 635, 700, 775, 850, 930].filter((m) => v >= m).length;
    assert.equal(A.levelOf(v), v < 1000 ? old : 21, `level at ${v}`);
  }
  for (let i = 21; i < A.LEVEL_MINS.length; i++) {
    const step = A.LEVEL_MINS[i] - A.LEVEL_MINS[i - 1];
    assert.ok(step >= 35 && step <= 65, `level ${i + 1} costs ${step}`);
  }
});

test('levelInfo: level, progress and points to the next level at every value', () => {
  let prev = 0;
  for (let v = 0; v <= A.AFFECTION_MAX; v++) {
    const L = A.levelInfo(v);
    assert.ok(L.level >= prev && L.level <= A.MAX_LEVEL);
    assert.equal(L.level, A.levelOf(v));
    assert.equal(L.tierIndex, A.tierIndex(v));
    assert.ok(L.progress >= 0 && L.progress <= 1);
    assert.ok(v >= L.min);
    if (L.next != null) {
      assert.ok(v < L.next);
      assert.equal(L.toNext, L.next - v);
    } else {
      assert.equal(L.level, A.MAX_LEVEL);
      assert.equal(L.progress, 1);
    }
    prev = L.level;
  }
  assert.deepEqual(A.levelInfo(312), { level: 10, maxLevel: 50, value: 312, min: 295, next: 345, progress: 17 / 50, toNext: 33, tierIndex: 2 });
  assert.deepEqual(A.levelInfo(960), { level: 20, maxLevel: 50, value: 960, min: 930, next: 1000, progress: 30 / 70, toNext: 40, tierIndex: 4 });
  assert.equal(A.levelInfo(1000).level, 21);
  assert.equal(A.levelInfo(A.AFFECTION_MAX).level, 50);
  assert.equal(A.levelInfo(A.AFFECTION_MAX).next, null);
  assert.equal(A.levelInfo(-50).level, 1);
  assert.equal(A.levelInfo(50000).level, 50);
  assert.equal(A.levelInfo('nonsense').level, 1);
});

test('applyEvent reports the level before and after', () => {
  const s = freshState();
  s.value = 15;
  const r = A.applyEvent(s, 'feedHand', T0);
  assert.equal(r.levelBefore, 1);
  assert.equal(r.levelAfter, 2);
});

test('gain curve: diminishing, never below 1, never negative for gains', () => {
  let prev = Infinity;
  for (let v = 0; v <= 1000; v += 50) {
    const g = A.effectiveGain(10, v);
    assert.ok(g >= 1 && g <= 10);
    assert.ok(g <= prev);
    prev = g;
  }
  assert.equal(A.effectiveGain(10, 0), 10);
  assert.equal(A.effectiveGain(10, 700), 5);
  assert.equal(A.effectiveGain(1, 1000), 1);
});

test('past 1000 points the gain curve stops shrinking, so levels 21 to 50 stay reachable', () => {
  assert.equal(A.CURVE_END, 1000);
  assert.equal(A.curveFactor(1000), 1 - 1000 / A.CURVE_K);
  assert.equal(A.curveFactor(1800), A.curveFactor(1000));
  assert.equal(A.curveFactor(A.AFFECTION_MAX), A.curveFactor(1000));
  assert.equal(A.effectiveGain(10, 2400), 3);
  assert.equal(A.curveFactor(500), 1 - 500 / A.CURVE_K);
  const s = freshState();
  s.value = 2000;
  let gained = 0;
  for (let d = 0; d < 3; d++) for (let i = 0; i < 3; i++) gained += A.applyEvent(s, 'feedHand', T0 + d * DAY + i * 3600000).delta;
  assert.ok(gained >= 20, `nine hand-feeds over three days at 2000 points: ${gained}`);
  s.value = A.AFFECTION_MAX - 1;
  A.applyEvent(s, 'feedHand', T0 + 10 * DAY);
  assert.equal(s.value, A.AFFECTION_MAX);
  assert.equal(s.carry, 0);
});

test('feeding again within 15 minutes counts for less, but never for nothing', () => {
  const s = freshState();
  const d = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => A.applyEvent(s, 'feedHand', T0 + m * 60000).delta);
  assert.equal(d[0], 10);
  assert.equal(d[1], 7);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] <= d[i - 1], `${d}`);
  assert.ok(d.every((x) => x >= 1), `every feed counts: ${d}`);
  const later = A.applyEvent(s, 'feedHand', T0 + 23 * 60000).delta;
  assert.ok(later >= 8, `a quarter of an hour later it counts in full again: ${later}`);
});

test('past the daily amount feeding counts half, never nothing, and a new day is full again', () => {
  const s = freshState();
  const dayStart = new Date(2026, 8, 26, 0, 30).getTime();
  const gains = [];
  for (let i = 0; i < 60; i++) gains.push(A.applyEvent(s, 'feedTray', dayStart + i * 16 * 60000).delta);
  const today = A.todayPoints(s, dayStart + 59 * 16 * 60000);
  assert.ok(today.feeding > A.DAILY_FULL.feeding, `feeding keeps counting: ${today.feeding}`);
  let sum = 0;
  let cross = -1;
  gains.forEach((g, i) => {
    sum += g;
    if (cross < 0 && sum >= A.DAILY_FULL.feeding) cross = i;
  });
  const after = gains.slice(cross + 1);
  assert.ok(after.length > 10);
  for (let i = 0; i + 1 < after.length; i++) assert.ok(after[i] + after[i + 1] >= 1, `never two feeds in a row for nothing: ${after}`);
  const full = A.effectiveGain(A.GAINS.feedTray, s.value);
  const avg = after.reduce((a, b) => a + b, 0) / after.length;
  assert.ok(avg >= full * 0.35 && avg <= full * 0.65, `about half: ${avg} vs ${full}`);
  const next = A.applyEvent(s, 'feedTray', dayStart + 86400000).delta;
  assert.ok(next >= full - 1, `a new day starts at full points again: ${next}`);
});

test('snacks it finds keep counting past the daily amount, at a quarter: trust grows every hour', () => {
  const s = freshState();
  const dayStart = new Date(2026, 8, 26, 7, 0).getTime();
  const hourly = [];
  let last = s.value;
  for (let hour = 0; hour < 12; hour++) {
    for (let i = 0; i < 20; i++) A.applyEvent(s, 'eatSpawned', dayStart + (hour * 20 + i) * 3 * 60000);
    hourly.push(s.value - last);
    last = s.value;
  }
  assert.ok(hourly.every((x) => x >= 3), `grows every hour: ${hourly}`);
  assert.ok(A.todayPoints(s, dayStart + 12 * 3600000).snacks > A.DAILY_FULL.snacks);
});

test('a very busy day never gets stuck: trust rises every hour until the maximum', () => {
  const s = freshState();
  const dayStart = new Date(2026, 8, 26, 8, 0).getTime();
  let last = s.value;
  for (let hour = 0; hour < 14; hour++) {
    for (let m = 0; m < 60; m++) {
      const t = dayStart + (hour * 60 + m) * 60000;
      if (m % 2 === 0) A.applyEvent(s, 'feedHand', t);
      if (m % 3 === 0) A.applyEvent(s, 'eatSpawned', t + 1000);
      if (m % 5 === 0) A.applyEvent(s, 'pet', t + 2000);
    }
    assert.ok(s.value > last || s.value === A.AFFECTION_MAX, `stuck at ${s.value} in hour ${hour + 1}`);
    last = s.value;
  }
});

test('the carried fraction of a point is kept between events and saves', () => {
  const s = freshState();
  s.value = 500;
  const day = new Date(2026, 8, 26, 9).getTime();
  s.dailyPassive = { date: A.dateKey(day), points: A.DAILY_FULL.snacks };
  let total = 0;
  for (let i = 0; i < 40; i++) total += A.applyEvent(s, 'eatSpawned', day + i * 60000).delta;
  assert.ok(total >= 6 && total <= 8, `40 snacks at a quarter of about 0.64 each: ${total}`);
  assert.ok(Math.abs(s.carry) <= 0.5);
});

test('annoyance is a flat penalty and never drops below 0', () => {
  const s = freshState();
  s.value = 2;
  A.applyEvent(s, 'annoyed', T0);
  assert.equal(s.value, 0);
});

test('neglect decay: grace period, per-day loss, cap per check, once per day', () => {
  const s = freshState();
  s.value = 500;
  s.lastFedAt = T0;
  assert.equal(A.applyDailyDecay(s, T0 + 2 * DAY), 0);
  const d = A.applyDailyDecay(s, T0 + 5 * DAY);
  assert.equal(d, -15);
  assert.equal(A.applyDailyDecay(s, T0 + 5 * DAY + 3600000), 0);
  const s2 = freshState();
  s2.value = 500;
  s2.lastFedAt = T0;
  assert.equal(A.applyDailyDecay(s2, T0 + 60 * DAY), -A.DECAY.maxPerCheck);
});

test('gift probabilities per tier and rarity weights are well-formed', () => {
  for (const t of A.TIERS) {
    assert.ok(A.GIFT_CHANCE[t.key] >= 0 && A.GIFT_CHANCE[t.key] <= 1);
    assert.ok(A.GIFT_HANDFEED_CHANCE[t.key] >= 0 && A.GIFT_HANDFEED_CHANCE[t.key] <= 1);
  }
  assert.equal(A.GIFT_CHANCE.wary, 0);
  assert.equal(A.GIFT_CHANCE.curious, 0);
  for (const [tier, w] of Object.entries(A.RARITY_WEIGHTS)) {
    const sum = A.RARITIES.reduce((s, r) => s + w[r], 0);
    assert.equal(sum, 100, `${tier} weights sum`);
  }
  for (const r of A.RARITIES) assert.ok(GIFT_TYPES_BY_RARITY[r].length > 0, `no items of rarity ${r}`);
});

test('gift rolls: empirical rate matches the table, cooldown/day cap respected', () => {
  const rng = createRng(42);
  const trials = 20000;
  let hits = 0;
  for (let i = 0; i < trials; i++) {
    const gifts = { pending: [], lastGiftAt: null, today: null };
    if (A.rollGift(rng, 800, gifts, T0 + i * DAY)) hits++;
  }
  const rate = hits / trials;
  assert.ok(Math.abs(rate - A.GIFT_CHANCE.bonded) < 0.012, `bonded rate ${rate}`);
  const g = { pending: [], lastGiftAt: T0, today: { date: A.dateKey(T0), count: 1 } };
  assert.equal(A.canGift(g, T0 + 5 * 60000), false);
  assert.equal(A.canGift(g, T0 + A.GIFT_COOLDOWN_MS + 1), true);
  g.today.count = A.GIFTS_PER_DAY_MAX;
  assert.equal(A.canGift(g, T0 + A.GIFT_COOLDOWN_MS + 1), false);
  assert.equal(A.canGift({ pending: [{}, {}], lastGiftAt: null, today: null }, T0), false);
});

test('rarity sampling follows the per-tier weights', () => {
  const rng = createRng(7);
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  const n = 40000;
  for (let i = 0; i < n; i++) counts[A.pickGiftItem(rng, 800).rarity]++;
  for (const r of A.RARITIES) {
    const expect = A.RARITY_WEIGHTS.bonded[r] / 100;
    assert.ok(Math.abs(counts[r] / n - expect) < 0.01, `${r}: ${counts[r] / n} vs ${expect}`);
  }
});

test('spawn table: weights sum to 100 and sampling matches them', () => {
  assert.equal(spawnTotalWeight(), 100);
  const rng = createRng(3);
  const counts = {};
  const n = 50000;
  for (let i = 0; i < n; i++) {
    const t = pickSpawnType(rng);
    counts[t] = (counts[t] || 0) + 1;
  }
  for (const e of SPAWN_TABLE) assert.ok(Math.abs(counts[e.type] / n - e.weight / 100) < 0.008, e.type);
});

function tableRows(md, heading) {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `missing section ${heading}`);
  const lines = md.slice(start).split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith('|')) {
      inTable = true;
      if (/^\|\s*-/.test(line)) continue;
      rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
    } else if (inTable) break;
  }
  return rows.slice(1);
}

test('docs/AFFECTION.md tables match the constants', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'AFFECTION.md'), 'utf8');
  const tiers = tableRows(md, '## Trust tiers');
  assert.equal(tiers.length, A.TIERS.length);
  A.TIERS.forEach((t, i) => {
    assert.equal(tiers[i][0], t.name);
    assert.equal(Number(tiers[i][1].split(/[–-]/)[0]), t.min);
  });
  const gains = tableRows(md, '## Affection gains');
  for (const [key, base] of Object.entries(A.GAINS)) {
    const row = gains.find((r) => r[0].includes(`\`${key}\``));
    assert.ok(row, `gain ${key} missing in doc`);
    assert.equal(Number(row[1].replace('+', '')), base, key);
  }
  const chances = tableRows(md, '## Gift chance per check');
  for (const t of A.TIERS) {
    const row = chances.find((r) => r[0] === t.name);
    assert.ok(row, `gift chance row ${t.name}`);
    assert.equal(Number(row[1].replace('%', '')) / 100, A.GIFT_CHANCE[t.key], `${t.name} periodic`);
    assert.equal(Number(row[2].replace('%', '')) / 100, A.GIFT_HANDFEED_CHANCE[t.key], `${t.name} hand-feed`);
  }
  const rar = tableRows(md, '## Gift rarity');
  for (const r of A.RARITIES) {
    const row = rar.find((x) => x[0].toLowerCase() === r);
    assert.ok(row, `rarity ${r}`);
    assert.equal(Number(row[1]), A.RARITY_WEIGHTS.friendly[r]);
    assert.equal(Number(row[2]), A.RARITY_WEIGHTS.trusting[r]);
    assert.equal(Number(row[3]), A.RARITY_WEIGHTS.bonded[r]);
    const listed = row[4].split(',').map((s) => s.trim()).sort();
    assert.deepEqual(listed, GIFT_TYPES_BY_RARITY[r].map((t) => ITEM_TYPES[t].name).sort());
  }
  const levels = tableRows(md, '## Friendship levels');
  assert.equal(levels.length, A.TIERS.length);
  A.TIERS.forEach((t, i) => {
    const r = A.tierLevels(i);
    assert.equal(levels[i][0], t.name);
    assert.equal(levels[i][1], `${r.from}–${r.to}`);
    const mins = levels[i][2].split(',').map((x) => Number(x.trim()));
    assert.deepEqual(mins, A.LEVEL_MINS.slice(r.from - 1, r.to));
  });
  const spawn = tableRows(md, '## World item spawn table');
  for (const e of SPAWN_TABLE) {
    const row = spawn.find((x) => x[0] === ITEM_TYPES[e.type].name);
    assert.ok(row, `spawn ${e.type}`);
    assert.equal(Number(row[2]), e.weight);
  }
});
