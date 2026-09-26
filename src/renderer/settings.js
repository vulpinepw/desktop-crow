'use strict';
const { createPreview } = require('./preview');
const { drawItemShape } = require('./draw');
const { createThicket, stageIcon, roseEmblem } = require('./thicket');
const { icon } = require('./icons');
const { ITEM_TYPES } = require('../core/items');
const { PRONOUNS, MOOD_LABELS, sanitizeName, fill } = require('../core/text');
const A = require('../core/affection');
const { evaluateMilestones, GIFT_KINDS } = require('../core/milestones');

const ui = window.crowUI;
const $ = (id) => document.getElementById(id);
const TAB_KEY = 'desktop-crow.settings.tab';
const MOTION_KEY = 'desktop-crow.settings.motion';
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];
const RARITY_BADGE = { common: 'badge', uncommon: 'badge badge-teal', rare: 'badge badge-violet', legendary: 'badge badge-gold' };

const STAGES = [
  'Keeps {poss} distance, and flies off if your pointer rushes at {obj}. Hand-feeding wins {obj} over fastest.',
  'Watches you closely, and only hops aside when your pointer comes very near.',
  'Stops shying away, wanders over when your pointer rests nearby, and starts bringing you gifts.',
  'Brings gifts twice as often, and rare or even legendary treasures become possible.',
  'Brings gifts most often, with the best odds of rare and legendary treasures. You are {poss} favourite human.',
];

const TIER_HINTS = [
  '{name} is still wary of you. Hand-feeding is the fastest way to earn {poss} trust.',
  '{name} is curious about you. Keep sharing snacks.',
  '{name} is friendly! {Subj} may start bringing you small gifts.',
  '{name} trusts you. Gifts come more often, and sometimes rare ones.',
  '{name} and you are bonded. You are {poss} favourite human.',
];

const MOOD_TEXT = {
  hungry: '{name} is hungry. Drop a snack by {obj}, or use Feed in the tray menu.',
  tired: '{name} is tired and will want a nap soon.',
  sad: '{name} feels a bit down. A snack or some petting would help.',
  happy: '{name} is really happy right now.',
  satisfied: '{name} has eaten well and feels satisfied.',
  content: '{name} is doing fine.',
};
const MOOD_ICON = { hungry: 'cookie', tired: 'moon', sad: 'rain', happy: 'heart', satisfied: 'smile', content: 'smile' };

const STAT_CELLS = [
  ['cookie', (st) => st.itemsEaten, () => 'snacks eaten'],
  ['heart', (st) => st.handFed + st.trayFed, () => 'fed by you'],
  ['gift', (st) => st.giftsReceived, () => 'gifts received'],
  ['calendar', (st) => st.daysActive, (v) => (v === 1 ? 'day together' : 'days together')],
  ['feather', (st) => st.flights, () => 'flights'],
  ['moon', (st) => st.naps, () => 'naps'],
];

let state = null;
let preview = null;
let previewScale = 0;
const built = {};

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function iconBox(name, size = 17) {
  const box = h('span', 'ico');
  box.appendChild(icon(name, size));
  return box;
}

function progressBar(fraction, thin) {
  const bar = h('div', thin ? 'progress thin' : 'progress');
  const fillEl = h('i');
  fillEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  bar.appendChild(fillEl);
  return bar;
}

function changed(key, value) {
  const json = JSON.stringify(value);
  if (built[key] === json) return false;
  built[key] = json;
  return true;
}

function paintRange(el) {
  const min = +el.min || 0;
  const max = +el.max || 1;
  const t = Math.min(1, Math.max(0, (+el.value - min) / (max - min)));
  el.style.setProperty('--fill', `${(t * 100).toFixed(2)}%`);
}

function heroScale(scale) {
  return 0.62 + (Math.min(1.6, Math.max(0.6, scale)) - 0.6) * 0.5;
}

function platformName(p) {
  return { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }[p] || p;
}

function selectTab(name) {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const target = tabs.find((t) => t.dataset.tab === name) || tabs[0];
  for (const t of tabs) t.setAttribute('aria-selected', String(t === target));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== target.dataset.tab));
  $('panels').scrollTop = 0;
  try {
    localStorage.setItem(TAB_KEY, target.dataset.tab);
  } catch {
  }
}

function renderHero(s, L, tier, p) {
  $('heroName').textContent = s.crow.name;
  $('heroLevel').textContent = `Level ${L.level}`;
  $('heroTier').textContent = tier.name;
  $('heroPronouns').textContent = `${p.subj} / ${p.obj}`;
  $('heroBar').firstElementChild.style.width = `${(L.progress * 100).toFixed(1)}%`;
  $('heroPoints').textContent = `${L.value} trust points`;
  $('heroNext').textContent = L.next == null ? 'Highest level reached' : `${L.toNext} more to level ${L.level + 1}`;
}

function renderMood(s) {
  const crow = s.crow;
  const m = s.mood;
  $('moodTip').textContent = fill('To pet {name}, stroke your pointer back and forth over {obj} without clicking.', crow);
  if (!m) return;
  const now = m.now || 'content';
  document.querySelector('.mood-card').dataset.mood = now;
  $('moodTitle').textContent = s.boxed ? 'Waiting in the box' : MOOD_LABELS[now] || now;
  $('moodLine').textContent = s.boxed ? fill('{name} is still in the box. Click it on your desktop to let {obj} out.', crow) : fill(MOOD_TEXT[now] || MOOD_TEXT.content, crow);
  if (changed('moodFace', [now, s.boxed])) {
    const face = $('moodFace');
    face.textContent = '';
    face.appendChild(icon(s.boxed ? 'box' : MOOD_ICON[now] || 'smile', 26));
  }
  const bars = [
    ['full', 'Fullness', 1 - m.hunger],
    ['energy', 'Energy', m.energy],
    ['happy', 'Happiness', m.happiness],
  ];
  const host = $('moodBars');
  if (!host.children.length) {
    for (const [key, label] of bars) {
      const row = h('div', `mood-row mood-${key}`);
      const top = h('div', 'mood-row-top');
      top.append(h('span', null, label), h('b'));
      row.append(top, progressBar(0, true));
      host.appendChild(row);
    }
  }
  bars.forEach(([, , v], i) => {
    const row = host.children[i];
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    row.querySelector('b').textContent = `${pct}%`;
    row.querySelector('.progress > i').style.width = `${pct}%`;
  });
}

function renderCrow(s) {
  const crow = s.crow;
  if (document.activeElement !== $('name')) $('name').value = crow.name;
  document.querySelectorAll('[data-g]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.g === crow.gender)));
  if (document.activeElement !== $('scale')) {
    $('scale').value = s.settings.scale;
    paintRange($('scale'));
    $('sizeValue').textContent = `${Math.round(s.settings.scale * 100)}%`;
  }
  const since = s.stats.firstLaunch ? new Date(s.stats.firstLaunch).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  $('sinceLine').textContent = since ? `Friends since ${since}.` : '';
  if (!changed('stats', [s.stats])) return;
  const grid = $('stats');
  grid.textContent = '';
  for (const [name, get, label] of STAT_CELLS) {
    const v = get(s.stats) || 0;
    const cell = h('div', 'stat');
    cell.append(iconBox(name, 15), h('b', null, v.toLocaleString('en-GB')), h('span', null, label(v)));
    grid.appendChild(cell);
  }
}

function oddsRow(tierKey) {
  const chance = A.GIFT_CHANCE[tierKey];
  if (!chance) return null;
  const row = h('div', 'odds');
  row.appendChild(h('span', null, `Gift chance ${Math.round(chance * 100)}% every ${Math.round(A.GIFT_CHECK_INTERVAL_S / 60)} min`));
  const w = A.RARITY_WEIGHTS[tierKey];
  const total = RARITY_ORDER.reduce((a, r) => a + w[r], 0);
  for (const r of RARITY_ORDER) {
    if (!w[r]) continue;
    const chip = h('span', `rarity-${r}`);
    chip.append(h('i'), document.createTextNode(`${Math.round((w[r] / total) * 100)}% ${r}`));
    row.appendChild(chip);
  }
  return row;
}

function renderFriendship(s, L, tier, p) {
  const crow = s.crow;
  $('ringFill').style.strokeDashoffset = String(100 - L.progress * 100);
  $('ringLevel').textContent = String(L.level);
  $('levelTitle').textContent = `Level ${L.level} · ${tier.name}`;
  $('levelHint').textContent = fill(TIER_HINTS[L.tierIndex] || '', crow);
  $('factPoints').textContent = String(L.value);
  $('factNext').textContent = L.next == null ? 'Max' : String(L.toNext);
  $('factNextLabel').textContent = L.next == null ? 'highest level' : `to level ${L.level + 1}`;
  $('factStage').textContent = `${L.tierIndex + 1} of ${A.TIERS.length}`;

  if (changed('path', [L.tierIndex, crow.gender, crow.name])) {
    const list = $('path');
    list.textContent = '';
    A.TIERS.forEach((t, i) => {
      const range = A.tierLevels(i);
      const li = h('li', i < L.tierIndex ? 'done' : i === L.tierIndex ? 'current' : 'locked');
      const art = h('div', 'stage-art');
      art.appendChild(stageIcon(i, 40));
      const body = h('div', 'stage-body');
      const top = h('div', 'stage-top');
      top.append(h('b', null, t.name), h('span', 'levels', `Levels ${range.from}–${range.to}`));
      if (i < L.tierIndex) top.appendChild(h('span', 'badge badge-rose', 'Reached'));
      else if (i === L.tierIndex) top.appendChild(h('span', 'badge badge-sheen', 'You are here'));
      else top.appendChild(h('span', 'badge', `From level ${range.from}`));
      body.append(top, h('p', 'stage-text', fill(STAGES[i], crow)));
      const odds = oddsRow(t.key);
      if (odds) body.appendChild(odds);
      li.append(art, body);
      list.appendChild(li);
    });
  }

  const ms = evaluateMilestones({ stats: s.stats, inventory: s.inventory, affection: L.value });
  const done = ms.filter((m) => m.done).length;
  $('milestoneLine').textContent = `${done} of ${ms.length} unlocked.`;
  if (changed('milestones', [ms, crow.name, crow.gender])) {
    const grid = $('milestones');
    grid.textContent = '';
    for (const m of ms) {
      const tile = h('div', m.done ? 'milestone done' : 'milestone');
      const top = h('div', 'ms-top');
      const text = h('div');
      text.append(h('b', null, m.title), h('p', null, fill(m.text, crow)));
      top.append(iconBox(m.icon, 17), text);
      const foot = h('div', 'ms-foot');
      if (m.done) foot.append(icon('check', 14), h('span', null, 'Unlocked'));
      else foot.append(progressBar(m.progress, true), h('span', null, `${m.current} / ${m.target}`));
      tile.append(top, foot);
      grid.appendChild(tile);
    }
  }

  const today = s.today || { feeding: 0, snacks: 0, petting: 0 };
  const over = (src) => !!src && (today[src] || 0) >= A.DAILY_FULL[src];
  if (changed('gains', [L.value, crow.gender, over('feeding'), over('snacks'), over('petting')])) {
    const rows = [
      ['hand', 'Hand-feed a snack', 'feedHand'],
      ['bowl', 'Feed from the tray menu', 'feedTray'],
      ['heart', 'Pet it', 'pet'],
      ['sun', 'A new day together', 'dailyVisit'],
      ['gift', 'Collect a gift', 'giftCollected'],
      ['seed', 'A snack it finds itself', 'eatSpawned'],
    ];
    const grid = $('gains');
    grid.textContent = '';
    for (const [name, label, kind] of rows) {
      const src = A.SOURCE[kind];
      let g = A.GAINS[kind] * Math.max(0, 1 - L.value / A.CURVE_K);
      if (over(src)) g *= A.OVER_DAILY[src];
      const shown = g >= 1.95 ? String(Math.round(g)) : String(Math.max(0.1, Math.round(g * 10) / 10));
      const row = h('div', over(src) ? 'gain slowed' : 'gain');
      row.append(iconBox(name, 15), h('span', 'gain-label', label), h('b', null, `+${shown}`));
      grid.appendChild(row);
    }
    const annoy = h('div', 'gain minus');
    annoy.append(iconBox('zap', 15), h('span', 'gain-label', 'Three quick clicks annoy it'), h('b', null, `−${Math.abs(A.ANNOY.penalty)}`));
    grid.appendChild(annoy);
    const F = A.DAILY_FULL;
    $('gainsNote').textContent = fill(
      `Points shrink a little as trust grows, and feeding again within ${Math.round(A.MANUAL_FEED_WINDOW_MS / 60000)} minutes counts for less. Each day the first ${F.feeding} points from feeding, ${F.snacks} from snacks {subj} finds and ${F.petting} from petting count in full; after that, feeding and petting count half and found snacks a quarter, so trust never stops growing. After ${A.DECAY.graceDays} days without food, trust starts to fade, a little more each day.`,
      crow
    );
  }
  if (changed('today', [today])) {
    const host = $('today');
    host.textContent = '';
    for (const [src, label] of [['feeding', 'Feeding today'], ['snacks', 'Found snacks today'], ['petting', 'Petting today']]) {
      const full = A.DAILY_FULL[src];
      const v = today[src] || 0;
      const cell = h('div', v >= full ? 'today-cell over' : 'today-cell');
      const top = h('div', 'today-top');
      top.append(h('span', null, label), h('b', null, `${v} / ${full}`));
      cell.append(top, progressBar(Math.min(1, v / full), true), h('small', null, v >= full ? `now counts ${A.OVER_DAILY[src] >= 0.5 ? 'half' : 'a quarter'}` : 'full points'));
      host.appendChild(cell);
    }
  }
}

function renderTreasures(s) {
  const crow = s.crow;
  const p = PRONOUNS[crow.gender] || PRONOUNS.she;
  const inv = s.inventory || {};
  const total = Object.values(inv).reduce((a, b) => a + b, 0);
  const st = s.stats || {};
  const parts = [];
  if (st.giftsReceived) parts.push(`${st.giftsReceived} brought to you by ${crow.name}`);
  if (st.shiniesFound) parts.push(`${st.shiniesFound} you picked up yourself`);
  if (st.treasuresStashed) parts.push(`${st.treasuresStashed} ${p.subj} hid away`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  $('treasureHint').textContent = total
    ? `${total} shiny ${total === 1 ? 'thing' : 'things'} so far${list ? `: ${list}` : ''}. The ones still to find stay a mystery.`
    : `Nothing yet. Click shiny things that drop onto your desktop to keep them, and once ${crow.name} trusts you, ${p.subj} will bring you gifts too.`;
  if (!changed('treasures', [inv, s.items])) return;
  const types = Object.keys(s.items).sort((a, b) => RARITY_ORDER.indexOf(s.items[a].rarity) - RARITY_ORDER.indexOf(s.items[b].rarity));
  const owned = GIFT_KINDS.filter((t) => (inv[t] || 0) > 0);
  let rarest = null;
  for (const t of owned) if (!rarest || RARITY_ORDER.indexOf(s.items[t].rarity) > RARITY_ORDER.indexOf(s.items[rarest].rarity)) rarest = t;
  const summary = $('treasureSummary');
  summary.textContent = '';
  for (const [name, value, label] of [
    ['gift', String(total), total === 1 ? 'treasure' : 'treasures'],
    ['grid', `${owned.length} / ${GIFT_KINDS.length}`, 'kinds found'],
    ['gem', rarest ? ITEM_TYPES[rarest].name : '—', rarest ? `rarest find, ${s.items[rarest].rarity}` : 'rarest find'],
  ]) {
    const cell = h('div', 'stat');
    cell.append(iconBox(name, 15), h('b', null, value), h('span', null, label));
    summary.appendChild(cell);
  }
  const grid = $('treasures');
  grid.textContent = '';
  const dpr = window.devicePixelRatio || 1;
  for (const type of types) {
    const count = inv[type] || 0;
    const rarity = s.items[type].rarity;
    const cell = h('div', count ? 'treasure' : 'treasure locked');
    const cv = h('canvas');
    cv.width = Math.round(56 * dpr);
    cv.height = Math.round(44 * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr * 2.5, 0, 0, dpr * 2.5, 28 * dpr, 22 * dpr);
    if (ITEM_TYPES[type]) drawItemShape(c, type, 1, 3);
    cell.append(cv, h('b', null, count ? ITEM_TYPES[type].name : '???'), h('span', 'count', count ? `× ${count}` : 'not found yet'), h('span', RARITY_BADGE[rarity] || 'badge', rarity));
    grid.appendChild(cell);
  }
}

function renderSettings(s) {
  $('activity').value = s.settings.activity;
  $('spawnRate').value = s.settings.spawnRate;
  $('cursorReactions').checked = s.settings.cursorReactions;
  $('windowPerching').checked = s.settings.windowPerching;
  $('multiMonitor').checked = s.settings.multiMonitor;
  $('musicDance').checked = s.settings.musicDance !== false;
  const mus = s.music;
  let hint = 'When Spotify, Deezer, YouTube Music or a music video on YouTube is playing.';
  if (s.settings.musicDance === false) hint = 'Off: your crow ignores the music you play.';
  else if (s.musicWatch === 'unavailable') hint = "This computer doesn't tell apps what is playing, so your crow can't hear your music.";
  else if (mus && mus.playing) hint = `Now playing${mus.source ? ` on ${mus.source}` : ''}${mus.title ? `: ${mus.title}${mus.artist ? ` by ${mus.artist}` : ''}` : ''}.`;
  $('musicHint').textContent = hint;
  $('sound').checked = s.settings.sound;
  if (document.activeElement !== $('volume')) {
    $('volume').value = s.settings.volume;
    paintRange($('volume'));
    $('volumeValue').textContent = `${Math.round(s.settings.volume * 100)}%`;
  }
  $('notifications').checked = s.settings.notifications;
  if (s.perching && !s.perching.available) $('perchHint').textContent = 'Not available on this desktop session (needs Windows, or an X11 or XWayland session).';
  $('autostart').checked = s.settings.autostart;
  $('dataDir').textContent = s.dataDir;
  $('resetHint').textContent = fill('Says goodbye to {name} and forgets {poss} name, trust and treasures.', s.crow);
  $('aboutVersion').textContent = `Version ${s.version} · ${platformName(s.platform)}`;
}

function render(s) {
  state = s;
  const p = PRONOUNS[s.crow.gender] || PRONOUNS.she;
  const L = s.level || A.levelInfo(s.affection || 0);
  const tier = A.TIERS[L.tierIndex];
  renderHero(s, L, tier, p);
  renderMood(s);
  renderCrow(s);
  renderFriendship(s, L, tier, p);
  renderTreasures(s);
  renderSettings(s);
  const k = heroScale(s.settings.scale);
  if (preview && Math.abs(k - previewScale) > 1e-6 && document.activeElement !== $('scale')) {
    previewScale = k;
    preview.setScale(k);
  }
}

async function patch(p) {
  render(await ui.updateSettings(p));
}

function readMotion() {
  try {
    return localStorage.getItem(MOTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setMotion(on) {
  document.documentElement.classList.toggle('still', !on);
  $('motion').checked = on;
  try {
    localStorage.setItem(MOTION_KEY, on ? 'on' : 'off');
  } catch {
  }
}

setMotion(readMotion());
document.querySelectorAll('[data-icon]').forEach((e) => e.appendChild(icon(e.dataset.icon, 17)));
createThicket($('heroDeco'), { seed: 29 });
$('aboutArt').appendChild(roseEmblem(58));

document.querySelectorAll('[data-tab]').forEach((b) => {
  b.addEventListener('click', () => selectTab(b.dataset.tab));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const i = tabs.indexOf(b);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next.dataset.tab);
    next.focus();
  });
});
try {
  const saved = localStorage.getItem(TAB_KEY);
  if (saved) selectTab(saved);
} catch {
}

$('saveName').addEventListener('click', async () => render(await ui.rename(sanitizeName($('name').value, state.crow.name))));
$('name').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    render(await ui.rename(sanitizeName($('name').value, state.crow.name)));
    $('name').blur();
  }
});
document.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => render(await ui.setGender(b.dataset.g))));
$('scale').addEventListener('input', () => {
  const v = +$('scale').value;
  paintRange($('scale'));
  $('sizeValue').textContent = `${Math.round(v * 100)}%`;
  if (preview) {
    previewScale = heroScale(v);
    preview.setScale(previewScale);
  }
});
$('scale').addEventListener('change', () => patch({ scale: +$('scale').value }));
$('volume').addEventListener('input', () => {
  paintRange($('volume'));
  $('volumeValue').textContent = `${Math.round(+$('volume').value * 100)}%`;
});
$('volume').addEventListener('change', () => patch({ volume: +$('volume').value }));
for (const id of ['activity', 'spawnRate']) $(id).addEventListener('change', () => patch({ [id]: $(id).value }));
for (const id of ['cursorReactions', 'windowPerching', 'multiMonitor', 'musicDance', 'sound', 'notifications', 'autostart']) $(id).addEventListener('change', () => patch({ [id]: $(id).checked }));
$('motion').addEventListener('change', () => setMotion($('motion').checked));
$('openData').addEventListener('click', () => ui.openDataFolder());
$('reset').addEventListener('click', async () => {
  const name = state ? state.crow.name : 'your crow';
  if (window.confirm(`Really say goodbye to ${name}? This cannot be undone.`)) await ui.resetCrow();
});
$('heroArt').addEventListener('click', () => preview && preview.caw());
ui.onState(render);

(async () => {
  const s = await ui.getState();
  previewScale = heroScale(s.settings.scale);
  preview = createPreview($('stage'), { scale: previewScale, seed: 11 });
  render(s);
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      render(await ui.getState());
    } catch {
    }
  }, 2000);
})();
