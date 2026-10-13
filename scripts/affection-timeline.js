'use strict';

const A = require('../src/core/affection');

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 5, 8);

const PROFILES = {
  'Leaves it running (never feeds)': { snacks: 40, hand: 0, tray: 0 },
  'Casual (1 hand-feed, 1 Feed a day)': { snacks: 30, hand: 1, tray: 1 },
  'Attentive (3 hand-feeds, 2 Feeds a day)': { snacks: 30, hand: 3, tray: 2 },
};

const GOALS = [...A.TIERS.slice(1).map((t) => ({ name: t.name, min: t.min })), ...[21, 35, 50].map((l) => ({ name: `Level ${l}`, min: A.LEVEL_MINS[l - 1] }))];

function simulate(p, days = 500) {
  const s = { value: 0, lastFedAt: null, lastDecayCheck: null, manualFeeds: [], dailyManual: null, dailyPassive: null };
  const reached = {};
  for (let d = 0; d < days; d++) {
    const base = T0 + d * DAY;
    A.applyEvent(s, 'dailyVisit', base);
    for (let i = 0; i < p.hand; i++) A.applyEvent(s, 'feedHand', base + (1 + i * 2) * 3600000);
    for (let i = 0; i < p.tray; i++) A.applyEvent(s, 'feedTray', base + (2 + i * 2) * 3600000);
    for (let i = 0; i < p.snacks; i++) A.applyEvent(s, 'eatSpawned', base + i * 12 * 60000);
    for (const g of GOALS) if (reached[g.name] == null && s.value >= g.min) reached[g.name] = d + 1;
  }
  return reached;
}

console.log('| Play style | ' + GOALS.map((g) => g.name).join(' | ') + ' |');
console.log('|---|' + GOALS.map(() => '---:').join('|') + '|');
for (const [name, p] of Object.entries(PROFILES)) {
  const r = simulate(p);
  console.log(`| ${name} | ` + GOALS.map((g) => (r[g.name] ? `day ${r[g.name]}` : '> 500 days')).join(' | ') + ' |');
}
