'use strict';

const PRONOUNS = Object.freeze({
  she: Object.freeze({ subj: 'she', obj: 'her', poss: 'her', possPro: 'hers', refl: 'herself' }),
  he: Object.freeze({ subj: 'he', obj: 'him', poss: 'his', possPro: 'his', refl: 'himself' }),
});

const DEFAULT_NAMES = Object.freeze(['Poe', 'Edgar', 'Morrigan', 'Corvina', 'Russet', 'Onyx', 'Pip', 'Hugin', 'Munin', 'Soot']);

const MOOD_LABELS = Object.freeze({ hungry: 'Hungry', tired: 'Tired', happy: 'Happy', satisfied: 'Satisfied', sad: 'Sad', content: 'Content' });

const MAX_NAME = 24;

const STRINGS = Object.freeze({
  trayTooltip: 'Desktop Crow — {name}',
  trayTooltipHidden: 'Desktop Crow — {name} (hidden)',
  trayTooltipPaused: 'Desktop Crow — {name} (paused)',
  menuShow: 'Show {name}',
  menuHide: 'Hide {name}',
  menuRename: 'Rename {name}…',
  menuSettings: 'Settings…',
  menuFeed: 'Feed {name}',
  menuPause: 'Pause',
  menuResume: 'Resume',
  menuQuit: 'Quit Desktop Crow',
  giftTitle: '{name} brought you something!',
  giftBody: 'Click the shiny thing {subj} left for you to add it to your treasures.',
  giftToast: '{name} brought you something!',
  giftCollected: 'You got a {item}! ({count} in your treasures)',
  foundCollected: 'You found a {item}! ({count} in your treasures)',
  tierUpTitle: '{name} trusts you more',
  tierUpBody: '{Subj} seems {tier} now.',
  levelUpToast: 'Friendship level {level}!',
  tierUpToast: 'Level {level}: {name} is {tier} now!',
  fedToast: '{name} gobbles it up!',
  handFedToast: '{name} takes it right from you!',
  welcomeToast: 'Hi! I’m {name}.',
  moodLine: '{name} seems {tier} around you.',
  statsLine: '{Subj} has eaten {eaten} snacks and brought you {gifts} gifts.',
  asleep: '{name} is napping.',
});

const INVISIBLE_RANGES = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

function isInvisible(code) {
  for (const [a, b] of INVISIBLE_RANGES) if (code >= a && code <= b) return true;
  return false;
}

function sanitizeName(raw, fallback = 'Poe') {
  let s = String(raw == null ? '' : raw)
    .replace(/\s/g, ' ')
    .split('')
    .filter((ch) => !isInvisible(ch.charCodeAt(0)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if ([...s].length > MAX_NAME) s = [...s].slice(0, MAX_NAME).join('').trim();
  return s || fallback;
}

function sanitizeGender(g) {
  return g === 'he' ? 'he' : 'she';
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function fill(template, crow, vars = {}) {
  const p = PRONOUNS[sanitizeGender(crow && crow.gender)];
  const map = Object.assign(
    {
      name: sanitizeName(crow && crow.name),
      subj: p.subj,
      Subj: cap(p.subj),
      obj: p.obj,
      poss: p.poss,
      Poss: cap(p.poss),
      refl: p.refl,
    },
    vars
  );
  return template.replace(/\{(\w+)\}/g, (m, key) => (map[key] != null ? String(map[key]) : m));
}

function t(key, crow, vars) {
  return fill(STRINGS[key] || key, crow, vars);
}

module.exports = { PRONOUNS, DEFAULT_NAMES, MAX_NAME, STRINGS, MOOD_LABELS, sanitizeName, sanitizeGender, fill, t };
