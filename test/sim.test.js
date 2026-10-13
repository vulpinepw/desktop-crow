'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core/game');
const { normalizeSave } = require('../src/core/save-schema');
const { MotionChecker } = require('../src/core/qa');
const { computeRig, toWorld } = require('../src/core/rig');
const { ITEM_TYPES } = require('../src/core/items');
const { CAM } = require('../src/core/dims');
const { DRAG_START_PX } = require('../src/core/sim');
const A = require('../src/core/affection');
const { LAYOUTS, DT } = require('./helpers');

function newGame(opts = {}) {
  let clock = opts.clock || new Date(2026, 8, 26, 14, 0).getTime();
  const save = normalizeSave(Object.assign({ version: 3 }, opts.save || {}), clock);
  save.crow.setupComplete = true;
  save.crow.name = opts.name || 'Morrigan';
  save.crow.gender = opts.gender || 'she';
  save.settings.spawnRate = opts.spawnRate || 'off';
  if (opts.affection != null) save.affection.value = opts.affection;
  if (opts.position) save.position = opts.position;
  const game = new Game({ save, seed: opts.seed || 3, now: () => clock });
  game.init(opts.displays || LAYOUTS.single);
  if (opts.windows) game.sim.setWindows(opts.windows);
  const checker = new MotionChecker();
  const out = [];
  const g = {
    game,
    save,
    sim: game.sim,
    checker,
    out,
    get crow() {
      return game.sim.crow;
    },
    get now() {
      return clock;
    },
    skipClock(ms) {
      clock += ms;
    },
    step() {
      clock += DT * 1000;
      game.step(DT);
      for (const e of game.drain()) out.push(e);
      checker.check(game.sim.crow, game.sim.world, DT);
    },
    advance(seconds) {
      for (let i = 0; i < Math.round(seconds / DT); i++) g.step();
    },
    runUntil(pred, maxSeconds) {
      for (let i = 0; i < Math.round(maxSeconds / DT); i++) {
        g.step();
        if (pred()) return true;
      }
      return false;
    },
    bodyPoint() {
      const c = game.sim.crow;
      const rig = computeRig(c.pose);
      return toWorld(c.pose, rig.body.cx, rig.body.cy);
    },
    headPoint() {
      const c = game.sim.crow;
      const rig = computeRig(c.pose);
      return toWorld(c.pose, rig.head.x, rig.head.y);
    },
    moveTo(x, y, seconds) {
      const c0 = game.sim.cursor || { x, y };
      const n = Math.max(1, Math.round(seconds / DT));
      for (let i = 1; i <= n; i++) {
        game.sim.setCursor(c0.x + ((x - c0.x) * i) / n, c0.y + ((y - c0.y) * i) / n, DT);
        g.step();
      }
    },
    clean() {
      assert.ok(checker.ok, JSON.stringify(checker.summary().first.slice(0, 3)));
    },
  };
  return g;
}

const grounded = (g) => g.crow.visible && !g.crow.airborne && g.crow.state === 'idle' && !g.crow.isBusy();

test('first run of the day: days active and the daily-visit affection bonus', () => {
  const g = newGame();
  assert.equal(g.save.stats.daysActive, 1);
  assert.equal(g.save.affection.value, A.GAINS.dailyVisit);
  const again = new Game({ save: g.save, seed: 4, now: () => g.now });
  again.init(LAYOUTS.single);
  assert.equal(g.save.stats.daysActive, 1);
  g.skipClock(24 * 3600 * 1000);
  g.advance(31);
  assert.equal(g.save.stats.daysActive, 2);
  g.advance(31);
  assert.equal(g.save.stats.daysActive, 2);
});

test('the crow starts on the desktop floor, not glued to the bottom edge', () => {
  const g = newGame();
  const a = g.sim.world.areas[0];
  assert.ok(g.sim.world.inWalkable(g.crow.x, g.crow.y));
  assert.ok(g.crow.y < a.y1 - 50, `started at y=${g.crow.y}`);
});

test('tray Feed: a treat drops in front of the crow and it eats it', () => {
  const g = newGame();
  g.advance(2);
  const a0 = g.save.affection.value;
  assert.equal(g.game.feed(), true);
  const treat = [...g.sim.items.values()][0];
  assert.ok(treat.z > 0 && treat.state === 'falling', 'it drops from above');
  assert.ok(g.runUntil(() => g.save.stats.trayFed === 1, 30), 'the treat was never eaten');
  assert.equal(g.save.stats.itemsEaten, 1);
  assert.equal(g.save.affection.value, a0 + A.effectiveGain(A.GAINS.feedTray, a0));
  assert.equal([...g.sim.items.values()].length, 0, 'the eaten treat despawned');
  assert.ok(g.out.some((e) => e.type === 'stats'));
  g.clean();
});

test('hand-feeding: drag food up to the crow and it eats it from your hand', () => {
  const g = newGame({ affection: 300 });
  g.advance(2);
  const k = g.sim.k;
  const it = g.sim.addItem('bread', g.crow.x + 300 * k, g.crow.y - 150 * k, { source: 'spawn' });
  const grab = [it.x, it.y - (ITEM_TYPES.bread.h * k) / 2];
  g.sim.setCursor(grab[0], grab[1], 0);
  assert.equal(g.sim.pointerDown(grab[0], grab[1]), 'item');
  assert.ok(g.sim.interactiveAt(0, 0), 'while dragging the overlay captures the mouse everywhere');
  const [hx, hy] = g.headPoint();
  g.moveTo(hx, hy + 6, 0.8);
  const a0 = g.save.affection.value;
  g.sim.pointerUp(hx, hy + 6);
  assert.ok(g.runUntil(() => g.save.stats.handFed === 1, 20), 'never ate from the hand');
  assert.equal(g.save.affection.value, a0 + A.effectiveGain(A.GAINS.feedHand, a0));
  g.clean();
});

test('a quick press on the crow is a click; press-and-move picks it up', () => {
  const g = newGame({ affection: 300 });
  g.advance(2);
  const [bx, by] = g.bodyPoint();
  g.sim.setCursor(bx, by, 0);
  assert.equal(g.sim.pointerDown(bx, by), 'crow');
  g.step();
  g.sim.pointerUp(bx, by);
  g.step();
  assert.equal(g.save.stats.clicks, 1);
  assert.notEqual(g.crow.state, 'held');
  g.advance(3);
  const [cx, cy] = g.bodyPoint();
  g.sim.setCursor(cx, cy, 0);
  g.sim.pointerDown(cx, cy);
  g.moveTo(cx + DRAG_START_PX + 4, cy, 0.1);
  assert.equal(g.crow.state, 'held', 'moving the pressed pointer picks it up');
  assert.equal(g.save.stats.clicks, 1, 'a pick-up is not a click');
  g.clean();
});

test('pick the crow up, carry it across the screen, put it down: it flutters down there', () => {
  const g = newGame({ affection: 300 });
  g.advance(2);
  const [bx, by] = g.bodyPoint();
  g.sim.setCursor(bx, by, 0);
  g.sim.pointerDown(bx, by);
  const d = g.sim.world.displays[0].bounds;
  const path = [
    [d.x + 300, d.y + 200],
    [d.x + d.width - 300, d.y + d.height - 250],
    [d.x + d.width / 2, d.y + 220],
  ];
  for (const [x, y] of path) {
    g.moveTo(x, y, 1.2);
    g.advance(0.3);
    assert.equal(g.crow.state, 'held');
    const [px, py] = g.bodyPoint();
    assert.ok(Math.hypot(px - x, py - y) < 12, `body ${px.toFixed(0)},${py.toFixed(0)} vs pointer ${x},${y}`);
  }
  const drop = { x: g.sim.cursor.x, y: g.sim.cursor.y };
  g.sim.pointerUp(drop.x, drop.y);
  assert.equal(g.crow.state, 'fly');
  assert.ok(g.runUntil(() => grounded(g), 10), `never settled (${g.crow.state})`);
  assert.ok(g.sim.world.inWalkable(g.crow.x, g.crow.y));
  assert.ok(Math.hypot(g.crow.x - drop.x, g.crow.y - drop.y) < 160, `landed at ${g.crow.x.toFixed(0)},${g.crow.y.toFixed(0)}`);
  assert.ok(g.out.some((e) => e.type === 'crowState' && e.to === 'held'));
  g.clean();
});

test('put down right on a window top edge, it sits on the edge', () => {
  const win = { id: 'w1', x: 400, y: 420, width: 700, height: 300 };
  const g = newGame({ affection: 300, windows: [win] });
  g.advance(2);
  const [bx, by] = g.bodyPoint();
  g.sim.setCursor(bx, by, 0);
  g.sim.pointerDown(bx, by);
  const feetBelowPointer = g.crow.y - g.crow.z * CAM.H - by;
  g.moveTo(750, win.y - feetBelowPointer - 22, 1.2);
  g.advance(0.6);
  const target = g.crow.y - g.crow.z * CAM.H;
  g.sim.pointerUp(g.sim.cursor.x, g.sim.cursor.y);
  assert.ok(g.runUntil(() => grounded(g), 10), `never settled (${g.crow.state})`);
  const p = g.crow.perch();
  assert.ok(p && p.windowId === 'w1', `landed ${p ? 'on ' + p.id : 'on the floor'} (feet were at ${target.toFixed(0)}, edge ${win.y})`);
  g.clean();
});

test('a lost button-up (focus stolen mid-drag) still lets go of the crow', () => {
  const g = newGame({ affection: 300 });
  g.advance(2);
  const [bx, by] = g.bodyPoint();
  g.sim.setCursor(bx, by, 0);
  g.sim.pointerDown(bx, by);
  g.moveTo(bx + 120, by - 80, 0.6);
  assert.equal(g.crow.state, 'held');
  g.sim.pointerCancel();
  assert.ok(!g.sim.pointerBusy);
  assert.ok(g.runUntil(() => grounded(g), 10));
  assert.equal(g.save.stats.clicks, 0);
  g.clean();
});

test('gift: a trusted crow fetches a gift, notifies "<name> brought you something!", click collects it', () => {
  const real = A.rollGift;
  A.rollGift = () => ({ type: 'ring', rarity: 'rare' });
  try {
    const g = newGame({ affection: 800, name: 'Poe', gender: 'he' });
    g.advance(2);
    g.save.gifts.awakeSinceCheck = A.GIFT_CHECK_INTERVAL_S - 0.05;
    g.advance(0.2);
    assert.ok(g.out.some((e) => e.type === 'giftIncoming' && e.itemType === 'ring'), 'no gift check fired');
    assert.ok(g.runUntil(() => g.out.some((e) => e.type === 'notify' && e.kind === 'gift'), 60), 'gift never delivered');
    const n = g.out.find((e) => e.type === 'notify' && e.kind === 'gift');
    assert.equal(n.title, 'Poe brought you something!');
    assert.match(n.body, / he left for you/);
    assert.deepEqual(g.save.gifts.pending.map((p) => p.type), ['ring']);
    assert.ok(g.runUntil(() => grounded(g) && [...g.sim.items.values()].some((it) => it.gift && it.state === 'resting'), 20), 'never settled after the gift drop');
    const gift = [...g.sim.items.values()].find((it) => it.gift);
    const gy = gift.y - gift.z * CAM.H - 4;
    assert.ok(g.sim.interactiveAt(gift.x, gy), 'gift is clickable (not click-through)');
    assert.equal(g.sim.pointerDown(gift.x, gy), 'gift');
    g.advance(1.2);
    assert.equal(g.save.gifts.inventory.ring, 1);
    assert.equal(g.save.stats.giftsReceived, 1);
    assert.equal(g.save.gifts.pending.length, 0);
    assert.ok(![...g.sim.items.values()].some((it) => it.gift), 'collected gift despawns');
    g.clean();
  } finally {
    A.rollGift = real;
  }
});

test('snatched up while bringing a gift: the gift falls out of its beak (and still counts)', () => {
  const real = A.rollGift;
  A.rollGift = () => ({ type: 'coin', rarity: 'uncommon' });
  try {
    const g = newGame({ affection: 800 });
    g.advance(2);
    g.save.gifts.awakeSinceCheck = A.GIFT_CHECK_INTERVAL_S - 0.05;
    g.advance(0.2);
    assert.ok(g.runUntil(() => g.crow.carry && g.crow.visible && g.crow.state === 'fly' && g.crow.st.enteredScreen, 60), 'never came back with the gift');
    g.advance(0.3);
    const [bx, by] = g.bodyPoint();
    g.sim.setCursor(bx, by, 0);
    g.sim.pointerDown(bx, by);
    g.moveTo(bx + 40, by, 0.2);
    assert.equal(g.crow.state, 'held');
    assert.equal(g.crow.carry, null);
    assert.ok(g.out.some((e) => e.type === 'notify' && e.kind === 'gift'), 'the gift notification');
    assert.ok(g.runUntil(() => [...g.sim.items.values()].some((it) => it.gift && it.state === 'resting'), 5), 'the gift landed on the desktop');
    g.sim.pointerUp(g.sim.cursor.x, g.sim.cursor.y);
    assert.ok(g.runUntil(() => grounded(g), 10));
    g.clean();
  } finally {
    A.rollGift = real;
  }
});

test('uncollected gifts are restored from the save file', () => {
  const g = newGame({ save: { gifts: { pending: [{ type: 'coin', x: 700, y: 500 }] } } });
  const gifts = [...g.sim.items.values()].filter((it) => it.gift);
  assert.equal(gifts.length, 1);
  assert.equal(gifts[0].type, 'coin');
  assert.equal(gifts[0].x, 700);
  assert.equal(gifts[0].y, 500);
  assert.equal(gifts[0].state, 'resting');
});

test('snacks drop onto any part of the desktop, not just the bottom', () => {
  const g = newGame({ spawnRate: 'frequent' });
  const ys = [];
  for (let i = 0; i < 60; i++) {
    const it = g.sim.spawnRandom();
    if (!it) {
      g.sim.items.clear();
      continue;
    }
    assert.ok(it.z > 0 && it.state === 'falling', 'it falls in from above');
    ys.push(it.y);
    g.sim.items.clear();
  }
  const wa = g.sim.world.displays[0].workArea;
  const top = ys.filter((y) => y < wa.y + wa.height / 3).length;
  const bottom = ys.filter((y) => y > wa.y + (wa.height * 2) / 3).length;
  assert.ok(top > 8 && bottom > 8, `top third ${top}, bottom third ${bottom} of ${ys.length}`);
});

test('left alone, the crow roams the whole desktop (top to bottom), not a strip', () => {
  const g = newGame({ save: { settings: { activity: 'lively' } } });
  const wa = g.sim.world.displays[0].workArea;
  const bands = new Set();
  for (let i = 0; i < 20 * 60 * 60; i += 30) {
    for (let j = 0; j < 30; j++) g.step();
    if (!g.crow.airborne && g.crow.visible) bands.add(Math.floor(((g.crow.y - wa.y) / wa.height) * 5));
  }
  assert.ok(bands.size >= 4, `visited ${[...bands].sort()} of 5 horizontal bands`);
  g.clean();
});

test('Hide flies it off-screen (nothing to click); Show brings it back', () => {
  const g = newGame();
  g.advance(3);
  g.game.hide();
  assert.equal(g.save.app.hidden, true);
  assert.ok(g.runUntil(() => g.sim.hidden, 20), 'never left the screen');
  assert.ok(g.out.some((e) => e.type === 'hidden'));
  assert.equal(g.sim.snapshot().crow, null);
  assert.equal(g.sim.interactiveAt(g.crow.x, g.crow.y - 20), false);
  g.advance(5);
  assert.equal(g.crow.state, 'away');
  g.game.show();
  assert.equal(g.save.app.hidden, false);
  assert.ok(g.runUntil(() => grounded(g), 30), 'never came back and landed');
  g.clean();
});

test('Show while it is leaving: mid-screen it turns back; at the edge it goes out and comes straight back', () => {
  for (const when of ['early', 'late']) {
    const g = newGame({ seed: when === 'early' ? 5 : 6 });
    g.advance(3);
    g.game.hide();
    const w = g.sim.world;
    const k = g.sim.k;
    const ready = when === 'early' ? () => g.crow.state === 'fly' && g.crow.airborne && w.inWalkable(g.crow.x, g.crow.y, 0) : () => g.crow.state === 'fly' && g.crow.airborne && !w.inWalkable(g.crow.x, g.crow.y, 20 * k);
    assert.ok(g.runUntil(ready, 20), `${when}: never got there`);
    g.game.show();
    assert.ok(g.runUntil(() => grounded(g), 30), `${when}: never came back and landed (${g.crow.state})`);
    assert.equal(g.sim.hidden, false);
    const went = g.out.some((e) => e.type === 'crowState' && e.to === 'away');
    assert.equal(went, when === 'late', `${when}: ${went ? 'went' : 'did not go'} off-screen`);
    g.clean();
  }
});

test('caught on its way out (Hide), then let go: it still leaves', () => {
  const g = newGame({ affection: 300 });
  g.advance(3);
  g.game.hide();
  assert.ok(g.runUntil(() => g.crow.state === 'fly' && g.crow.airborne, 5));
  const [bx, by] = g.bodyPoint();
  g.sim.setCursor(bx, by, 0);
  g.sim.pointerDown(bx, by);
  g.moveTo(bx - 60, by + 40, 0.3);
  assert.equal(g.crow.state, 'held');
  g.sim.pointerUp(g.sim.cursor.x, g.sim.cursor.y);
  assert.ok(g.runUntil(() => g.sim.hidden, 30), 'never left after being let go');
  g.clean();
});

test('Pause: it settles down, nothing spawns, Feed is refused; Resume', () => {
  const g = newGame({ spawnRate: 'frequent' });
  g.advance(2);
  g.game.setPaused(true);
  g.advance(3);
  assert.equal(g.crow.state, 'perch');
  const before = g.sim.items.size;
  g.advance(5 * 60);
  assert.equal(g.sim.items.size, before, 'items spawned while paused');
  assert.equal(g.crow.state, 'perch');
  assert.equal(g.game.feed(), false);
  g.game.setPaused(false);
  assert.ok(g.runUntil(() => g.crow.state !== 'perch', 3), 'still perched after resuming');
  g.clean();
});

test('repaint pace follows the action: fast while moving, slower at rest, slowest perched or hidden', () => {
  const g = newGame();
  g.advance(1);
  g.crow.interrupt({ type: 'idle', duration: 3 });
  assert.ok(g.runUntil(() => g.crow.state === 'idle' && g.crow.stateTime > 0.3, 5));
  assert.equal(g.sim.pace(), 'medium');
  assert.equal(g.sim.snapshot().pace, 'medium');
  g.game.feed();
  assert.equal(g.sim.pace(), 'fast');
  assert.ok(g.runUntil(() => g.crow.state === 'eat', 20));
  assert.equal(g.sim.pace(), 'fast');
  g.game.setPaused(true);
  const still = () => [...g.sim.items.values()].every((it) => it.state === 'resting' && !(it.collect > 0) && !(it.fade > 0));
  assert.ok(g.runUntil(() => g.crow.state === 'perch' && g.sim.toasts.length === 0 && !g.crow.emote && still(), 20));
  assert.equal(g.sim.pace(), 'slow');
  g.game.setPaused(false);
  g.game.hide();
  assert.ok(g.runUntil(() => g.crow.state === 'fly', 5));
  assert.equal(g.sim.pace(), 'fast');
  assert.ok(g.runUntil(() => g.sim.hidden, 20));
  assert.equal(g.sim.pace(), 'slow');
});

test('click-through: the overlay only captures the mouse on the crow and on items', () => {
  const g = newGame();
  g.advance(2);
  const [bx, by] = g.bodyPoint();
  assert.equal(g.sim.interactiveAt(bx, by), true);
  assert.equal(g.sim.interactiveAt(bx + 300, by - 300), false);
  assert.equal(g.sim.interactiveAt(bx, by - 150), false);
  g.game.setPaused(true);
  assert.equal(g.sim.interactiveAt(bx, by), true, 'still clickable (for the menu) while paused');
});

test('three quick clicks annoy the crow: affection penalty and it flies off', () => {
  const g = newGame();
  g.advance(2);
  const a0 = g.save.affection.value;
  for (let i = 0; i < 3; i++) {
    const [bx, by] = g.bodyPoint();
    g.sim.setCursor(bx, by, 0);
    assert.equal(g.sim.pointerDown(bx, by), 'crow');
    g.sim.pointerUp(bx, by);
    g.advance(0.5);
  }
  assert.equal(g.save.stats.clicks, 3);
  assert.equal(g.save.affection.value, Math.max(0, a0 + A.ANNOY.penalty));
  assert.ok(g.runUntil(() => g.crow.state === 'fly', 5), 'did not fly away');
  g.clean();
});

test('rename and gender change are used in the next notification', () => {
  const g = newGame({ affection: 88 });
  g.game.drain();
  assert.ok(g.save.affection.value < 100, 'must start just below the Curious tier');
  g.game.rename('Nevermore');
  g.game.setGender('he');
  g.game.affection('feedHand');
  const n = g.game.drain().find((e) => e.type === 'notify' && e.kind === 'tier');
  assert.ok(n, 'no tier-up notification');
  assert.equal(n.title, 'Nevermore trusts you more');
  assert.equal(n.body, 'He seems curious now.');
});

test('the crow position (and which way it faces) is saved and restored on the same monitor', () => {
  const g = newGame({ displays: LAYOUTS.dualEqual, position: { x: 2900, y: 600, displayId: 2, relX: (2900 - 1920) / 1920, relY: 600 / 1040, h: 2 } });
  assert.ok(g.crow.x > 1920, `started at ${g.crow.x}`);
  assert.ok(Math.abs(g.crow.h - 2) < 1e-9);
  g.advance(40);
  const pos = g.save.position;
  assert.equal(pos.displayId, g.sim.world.displayAt(g.crow.x, g.crow.y).id);
  const again = new Game({ save: JSON.parse(JSON.stringify(g.save)), seed: 9, now: () => g.now });
  again.init(LAYOUTS.dualEqual);
  const c2 = again.sim.crow;
  assert.equal(again.sim.world.displayAt(c2.x, c2.y).id, pos.displayId);
  assert.ok(Math.hypot(c2.x - pos.x, c2.y - pos.y) < 60, `restored at ${c2.x},${c2.y}, saved ${pos.x},${pos.y}`);
});

test('unplugging the monitor the crow is on: it comes back on the remaining one', () => {
  const g = newGame({ displays: LAYOUTS.dualEqual, position: { x: 2900, y: 700, displayId: 2, relX: 0.5, relY: 0.6, h: 0 } });
  g.advance(2);
  g.sim.setDisplays(LAYOUTS.single);
  assert.ok(g.runUntil(() => grounded(g) && g.sim.world.displayAt(g.crow.x, g.crow.y), 30), `stuck in ${g.crow.state}`);
  g.clean();
});

test('a new friendship level pops up a message over the crow, and a new stage names it', () => {
  const { t } = require('../src/core/text');
  const g = newGame({ affection: 0 });
  g.save.affection.value = 15;
  g.save.affection.manualFeeds = [];
  g.sim.toasts.length = 0;
  g.game.affection('feedHand');
  assert.deepEqual(g.sim.toasts.map((x) => [x.key, x.vars && x.vars.level]), [['levelUpToast', 2]]);
  assert.equal(t('levelUpToast', g.save.crow, g.sim.toasts[0].vars), 'Friendship level 2!');
  g.sim.toasts.length = 0;
  g.save.affection.value = 245;
  g.save.affection.manualFeeds = [];
  g.game.affection('feedHand');
  const up = g.sim.toasts.find((x) => x.key === 'tierUpToast');
  assert.ok(up, 'a new stage gets its own message');
  assert.deepEqual(up.vars, { level: 9, tier: 'friendly' });
  assert.equal(t('tierUpToast', g.save.crow, up.vars), 'Level 9: Morrigan is friendly now!');
  assert.equal(g.sim.toasts.filter((x) => x.key === 'levelUpToast').length, 0);
  g.sim.toasts.length = 0;
  g.save.affection.value = 300;
  g.game.affection('eatSpawned');
  assert.equal(g.sim.toasts.length, 0, 'no message without a new level');
  const s = g.game.summary();
  assert.equal(s.affection, g.save.affection.value);
  assert.equal(s.level.level, A.levelOf(g.save.affection.value));
});