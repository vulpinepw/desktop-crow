'use strict';

const { GIFT_TYPES_BY_RARITY } = require('./items');
const { TIERS, MAX_LEVEL, levelOf } = require('./affection');

const GIFT_KINDS = Object.freeze([...GIFT_TYPES_BY_RARITY.common, ...GIFT_TYPES_BY_RARITY.uncommon, ...GIFT_TYPES_BY_RARITY.rare, ...GIFT_TYPES_BY_RARITY.legendary]);
const BONDED_MIN = TIERS[TIERS.length - 1].min;

const count = (inv, types) => types.reduce((a, t) => a + (inv[t] || 0), 0);

const MILESTONES = Object.freeze([
  { key: 'firstSnack', icon: 'seed', title: 'First snack', text: 'Share a snack with {name}.', target: 1, of: (s) => s.stats.itemsEaten },
  { key: 'handFed', icon: 'hand', title: 'From your hand', text: 'Hand-feed {name} for the first time.', target: 1, of: (s) => s.stats.handFed },
  { key: 'handFed25', icon: 'heart', title: 'Trusted hand', text: 'Hand-feed {name} 25 times.', target: 25, of: (s) => s.stats.handFed },
  { key: 'firstGift', icon: 'gift', title: 'A shiny surprise', text: 'Receive your first gift.', target: 1, of: (s) => s.stats.giftsReceived },
  { key: 'gifts10', icon: 'sparkle', title: 'Magpie’s envy', text: 'Receive 10 gifts.', target: 10, of: (s) => s.stats.giftsReceived },
  { key: 'allKinds', icon: 'grid', title: 'Cabinet of curiosities', text: 'Collect every kind of treasure.', target: GIFT_KINDS.length, of: (s) => GIFT_KINDS.filter((t) => (s.inventory[t] || 0) > 0).length },
  { key: 'legendary', icon: 'gem', title: 'Legendary find', text: 'Receive a legendary treasure.', target: 1, of: (s) => count(s.inventory, GIFT_TYPES_BY_RARITY.legendary) },
  { key: 'week', icon: 'calendar', title: 'A week together', text: 'Spend 7 days together.', target: 7, of: (s) => s.stats.daysActive },
  { key: 'month', icon: 'moon', title: 'Old friends', text: 'Spend 30 days together.', target: 30, of: (s) => s.stats.daysActive },
  { key: 'flights', icon: 'feather', title: 'Frequent flyer', text: '{name} takes 100 flights.', target: 100, of: (s) => s.stats.flights },
  { key: 'goodCrow', icon: 'hand', title: 'Good crow', text: 'Pet {name} 10 times.', target: 10, of: (s) => s.stats.pets },
  { key: 'dancePartner', icon: 'music', title: 'Dance partner', text: '{name} dances to your music 5 times.', target: 5, of: (s) => s.stats.dances },
  { key: 'bonded', icon: 'rose', title: 'Bonded', text: 'Reach the Bonded stage.', target: BONDED_MIN, of: (s) => s.affection },
  { key: 'bestFriends', icon: 'crown', title: 'Best friends', text: `Reach friendship level ${MAX_LEVEL}.`, target: MAX_LEVEL, of: (s) => levelOf(s.affection) },
]);

function evaluateMilestones(input) {
  const src = {
    stats: (input && input.stats) || {},
    inventory: (input && input.inventory) || {},
    affection: Number((input && input.affection) || 0),
  };
  return MILESTONES.map((m) => {
    const raw = Math.max(0, Number(m.of(src)) || 0);
    const current = Math.min(m.target, raw);
    return { key: m.key, icon: m.icon, title: m.title, text: m.text, target: m.target, current, progress: current / m.target, done: raw >= m.target };
  });
}

module.exports = { MILESTONES, GIFT_KINDS, evaluateMilestones };
