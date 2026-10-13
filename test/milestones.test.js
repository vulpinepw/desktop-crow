'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MILESTONES, GIFT_KINDS, evaluateMilestones } = require('../src/core/milestones');
const { ITEM_TYPES, GIFT_TYPES_BY_RARITY } = require('../src/core/items');
const { ICONS } = require('../src/renderer/icons');
const A = require('../src/core/affection');

const byKey = (list) => Object.fromEntries(list.map((m) => [m.key, m]));

test('milestones: unique keys, positive targets, a title, a text and a known icon each', () => {
  assert.equal(new Set(MILESTONES.map((m) => m.key)).size, MILESTONES.length);
  for (const m of MILESTONES) {
    assert.ok(Number.isInteger(m.target) && m.target > 0, m.key);
    assert.ok(m.title && m.text, m.key);
    assert.ok(ICONS.includes(m.icon), `${m.key} icon ${m.icon}`);
  }
});

test('milestones: the gift kinds are exactly the giftable items', () => {
  const giftable = Object.keys(ITEM_TYPES).filter((t) => ITEM_TYPES[t].giftRarity);
  assert.deepEqual([...GIFT_KINDS].sort(), giftable.sort());
  assert.ok(!GIFT_KINDS.includes('button'));
  assert.ok(GIFT_KINDS.includes('foil'), 'every shiny thing is a treasure');
  for (const [type, def] of Object.entries(ITEM_TYPES)) if (def.kind === 'shiny') assert.ok(GIFT_KINDS.includes(type), type);
});

test('milestones: a brand-new crow has none, and missing data counts as zero', () => {
  for (const input of [{ stats: {}, inventory: {}, affection: 0 }, {}, null]) {
    const list = evaluateMilestones(input);
    assert.equal(list.length, MILESTONES.length);
    for (const m of list) {
      assert.equal(m.done, false, m.key);
      assert.equal(m.current, ['bestFriends', 'kindred', 'forLife'].includes(m.key) ? 1 : 0, m.key);
    }
  }
});

test('milestones: a crow with everything done has them all, progress capped at 1', () => {
  const inventory = Object.fromEntries(GIFT_KINDS.map((t) => [t, 3]));
  const list = evaluateMilestones({ stats: { itemsEaten: 900, handFed: 80, giftsReceived: 60, daysActive: 90, flights: 2000, pets: 30, dances: 12, cleaned: 40 }, inventory, affection: A.AFFECTION_MAX });
  assert.ok(list.every((m) => m.done && m.progress === 1 && m.current === m.target));
});

test('milestones: friendship levels 20, 35 and 50, and cleaning up', () => {
  const at = (value) => byKey(evaluateMilestones({ affection: value }));
  assert.equal(at(A.LEVEL_MINS[19]).bestFriends.done, true);
  assert.equal(at(A.LEVEL_MINS[19]).kindred.done, false);
  assert.equal(at(A.LEVEL_MINS[34]).kindred.done, true);
  assert.equal(at(A.LEVEL_MINS[34]).forLife.done, false);
  assert.equal(at(A.LEVEL_MINS[49]).forLife.done, true);
  assert.equal(byKey(evaluateMilestones({})).forLife.target, 50);
  assert.equal(byKey(evaluateMilestones({ stats: { cleaned: 24 } })).tidyNest.done, false);
  assert.equal(byKey(evaluateMilestones({ stats: { cleaned: 25 } })).tidyNest.done, true);
});

test('milestones: counts, partial progress and thresholds', () => {
  const m = byKey(
    evaluateMilestones({
      stats: { itemsEaten: 3, handFed: 24, giftsReceived: 9, daysActive: 7, flights: 99, pets: 10, dances: 4 },
      inventory: { bottlecap: 2, ring: 1, gem: 0 },
      affection: A.TIERS[4].min - 1,
    })
  );
  assert.equal(m.firstSnack.done, true);
  assert.equal(m.handFed.done, true);
  assert.equal(m.handFed25.done, false);
  assert.equal(m.handFed25.current, 24);
  assert.equal(m.firstGift.done, true);
  assert.equal(m.gifts10.current, 9);
  assert.equal(m.allKinds.current, 2);
  assert.equal(m.allKinds.target, GIFT_KINDS.length);
  assert.equal(m.legendary.done, false);
  assert.equal(m.week.done, true);
  assert.equal(m.month.current, 7);
  assert.equal(m.flights.done, false);
  assert.equal(m.goodCrow.done, true);
  assert.equal(m.dancePartner.done, false);
  assert.equal(m.dancePartner.current, 4);
  assert.equal(m.bonded.done, false);
  assert.equal(m.bestFriends.current, A.levelOf(A.TIERS[4].min - 1));
  assert.equal(byKey(evaluateMilestones({ affection: A.TIERS[4].min })).bonded.done, true);
  assert.equal(byKey(evaluateMilestones({ affection: A.LEVEL_MINS[A.CLASSIC_LEVELS - 1] })).bestFriends.done, true);
  const legendary = GIFT_TYPES_BY_RARITY.legendary[0];
  assert.equal(byKey(evaluateMilestones({ inventory: { [legendary]: 1 } })).legendary.done, true);
});
