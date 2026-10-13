'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core/game');
const { normalizeSave } = require('../src/core/save-schema');
const { MotionChecker } = require('../src/core/qa');
const { computeRig, toWorld } = require('../src/core/rig');
const { ITEM_TYPES } = require('../src/core/items');
const { Crow } = require('../src/core/crow');
const A = require('../src/core/affection');
const { DROP, CARE } = require('../src/core/care');
const { LAYOUTS, DT } = require('./helpers');

function newGame(opts = {}) {
  let clock = opts.clock || new Date(2026, 8, 26, 14, 0).getTime();
  const save = normalizeSave(Object.assign({ version: 3 }, opts.save || {}), clock);
  save.crow.setupComplete = true;
  save.crow.name = 'Morrigan';
  save.crow.gender = 'she';
  save.settings.spawnRate = 'off';
  if (opts.affection != null) save.affection.value = opts.affection;
  const game = new Game({ save, seed: opts.seed || 3, now: () => clock });
  game.init(opts.displays || LAYOUTS.single);
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

function dropShiny(g, type, dx, dy) {
  const k = g.sim.k;
  const it = g.sim.addItem(type, g.crow.x + dx * k, g.crow.y + dy * k, { source: 'spawn' });
  it.state = 'resting';
  it.z = 0;
  return it;
}

test('clicking a shiny thing on the desktop puts it in your treasures', () => {
  const g = newGame({ affection: 30 });
  g.advance(1);
  const it = dropShiny(g, 'bottlecap', 260, 40);
  const k = g.sim.k;
  const x = it.x;
  const y = it.y - (ITEM_TYPES.bottlecap.h * k) / 2;
  const a0 = g.save.affection.value;
  assert.equal(g.sim.hitAt(x, y).kind, 'gift');
  assert.equal(g.sim.pointerDown(x, y), 'gift');
  g.sim.pointerUp(x, y);
  g.advance(1.2);
  assert.equal(g.save.gifts.inventory.bottlecap, 1);
  assert.equal(g.save.stats.shiniesFound, 1);
  assert.equal(g.save.stats.giftsReceived, 0);
  assert.equal(g.save.affection.value, a0, 'found things earn no trust');
  assert.equal(g.sim.items.size, 0);
  assert.ok(g.sim.toasts.some((t) => t.key === 'foundCollected'));
  assert.ok(g.out.some((e) => e.type === 'giftCollected' && e.found));
  g.clean();
});

test('a shiny the crow is going for can still be picked up; the crow gives up puzzled', () => {
  const g = newGame({ affection: 30, seed: 5 });
  g.advance(1);
  const it = dropShiny(g, 'marble', 120, 30);
  it.claimedBy = 'crow';
  g.crow.interrupt({ type: 'peck', itemId: it.id, x: it.x, y: it.y, count: 2, pickUp: true });
  g.advance(0.2);
  g.sim.collectGift(it);
  g.advance(2);
  assert.equal(g.save.gifts.inventory.marble, 1);
  assert.ok(!g.crow.carry, 'the crow did not get it');
  g.clean();
});

test('a shiny the crow stashes is kept in your treasures too', () => {
  const g = newGame({ affection: 30 });
  g.advance(1);
  const it = dropShiny(g, 'foil', 200, 0);
  g.sim.removeItem(it.id, 'stashed');
  g.step();
  assert.equal(g.save.gifts.inventory.foil, 1);
  assert.equal(g.save.stats.shiniesStashed, 1);
  assert.equal(g.save.stats.treasuresStashed, 1);
  assert.ok(g.out.some((e) => e.type === 'giftCollected' && e.stashed));
});

test('a gift still on its way is saved, and survives hiding, showing and a restart', () => {
  const g = newGame({ affection: 500 });
  g.advance(2);
  assert.ok(g.sim.deliverGift('coin'));
  g.advance(0.5);
  assert.deepEqual(g.game.pendingGifts(), [{ type: 'coin', x: null, y: null }]);
  g.game.hide();
  assert.ok(g.runUntil(() => g.sim.hidden, 20), 'never hid');
  assert.deepEqual(g.save.gifts.pending.map((p) => p.type), ['coin']);
  const copy = normalizeSave(JSON.parse(JSON.stringify(g.save)), g.now);
  const again = new Game({ save: copy, seed: 9, now: () => g.now });
  again.init(LAYOUTS.single);
  assert.equal(again.sim.pendingGiftItems().length, 0, 'still hidden: nothing on the desktop yet');
  assert.deepEqual(again.pendingGifts().map((p) => p.type), ['coin']);
  again.show();
  assert.equal(again.sim.pendingGiftItems().length, 1, 'it turns up when the crow is back');
  assert.equal(again.pendingGifts().length, 1, 'and is not counted twice');
  g.game.show();
  assert.equal(g.sim.pendingGiftItems().length, 1);
  assert.equal(g.game.pendingGifts().length, 1);
});

test('stroking the pointer back and forth over the crow pets it, even a wary one', () => {
  const g = newGame({ affection: 30 });
  g.advance(1);
  assert.ok(g.runUntil(() => grounded(g), 10));
  const k = g.sim.k;
  const [bx, by] = g.bodyPoint();
  const x0 = g.crow.x;
  const y0 = g.crow.y;
  const a0 = g.save.affection.value;
  g.moveTo(bx - 20 * k, by, 0.05);
  for (let i = 0; i < 6; i++) {
    g.moveTo(bx + 20 * k, by, 0.22);
    g.moveTo(bx - 20 * k, by, 0.22);
  }
  assert.ok(g.checker.stats.states.pet > 0, 'never enjoyed being petted');
  assert.equal(g.save.stats.pets, 1);
  assert.equal(g.save.affection.value, a0 + A.effectiveGain(A.GAINS.pet, a0));
  assert.ok(g.sim.fx.some((f) => f.kind === 'heart'), 'hearts float up');
  assert.ok(!g.checker.stats.states.fly, 'it did not fly off');
  assert.ok(Crow.floorDist(g.crow.x, g.crow.y, x0, y0) < 30 * k, 'it stayed put');
  g.moveTo(bx + 400 * k, by + 200 * k, 0.3);
  assert.ok(g.runUntil(() => g.crow.state !== 'pet', 6), 'it stops when you do');
  g.clean();
});

test('while you start stroking, the crow stays put; a sleeping crow wakes up to be petted', () => {
  const g = newGame({ affection: 300, save: { settings: { activity: 'lively' } } });
  g.advance(1);
  assert.ok(g.runUntil(() => grounded(g), 10));
  g.crow.act({ type: 'sleep', duration: 60 });
  assert.ok(g.runUntil(() => g.crow.state === 'sleep' && g.crow.st.phase === 'sleep', 10), 'never fell asleep');
  const k = g.sim.k;
  const x0 = g.crow.x;
  const y0 = g.crow.y;
  const [bx, by] = g.bodyPoint();
  g.moveTo(bx - 16 * k, by, 0.05);
  for (let i = 0; i < 10; i++) {
    g.moveTo(bx + 16 * k, by, 0.2);
    g.moveTo(bx - 16 * k, by, 0.2);
  }
  assert.ok(g.checker.stats.states.pet > 0, 'woke up and enjoyed it');
  assert.ok(Crow.floorDist(g.crow.x, g.crow.y, x0, y0) < 20 * k, 'it did not wander off');
  g.clean();
});

test('just hovering or passing over the crow once is not petting', () => {
  const g = newGame({ affection: 300 });
  g.advance(1);
  assert.ok(g.runUntil(() => grounded(g), 10));
  const k = g.sim.k;
  const [bx, by] = g.bodyPoint();
  g.moveTo(bx - 200 * k, by, 0.05);
  g.moveTo(bx + 200 * k, by, 0.6);
  g.moveTo(bx, by, 0.4);
  g.advance(2);
  assert.ok(!g.checker.stats.states.pet);
  assert.equal(g.save.stats.pets, 0);
});

test('petting keeps counting past its daily amount, at half', () => {
  const s = { value: 0 };
  const day = new Date(2026, 8, 26, 9).getTime();
  const gains = [];
  for (let i = 0; i < 60; i++) gains.push(A.applyEvent(s, 'pet', day + i * 60000).delta);
  const total = gains.reduce((a, b) => a + b, 0);
  assert.ok(total > A.DAILY_FULL.petting + 30, `total ${total}`);
  const late = gains.slice(20);
  for (let i = 0; i + 1 < late.length; i++) assert.ok(late[i] + late[i + 1] >= 1, `never two sessions in a row for nothing: ${late}`);
  const avg = late.reduce((a, b) => a + b, 0) / late.length;
  assert.ok(avg > 0.8 && avg < 1.2, `about half of 2 points: ${avg}`);
  assert.ok(A.applyEvent(s, 'pet', day + 86400000).delta >= 1);
});

test('Feed is answered quickly, even right after a meal', () => {
  for (const seed of [3, 4, 8, 16, 24]) {
    const g = newGame({ seed, affection: 149 });
    assert.ok(g.runUntil(() => grounded(g), 20));
    for (let i = 0; i < 4; i++) {
      const fed = g.save.stats.trayFed;
      assert.ok(g.game.feed());
      assert.ok(g.runUntil(() => g.save.stats.trayFed > fed, 10), `seed ${seed}, Feed ${i + 1}: still ${g.crow.state}/${g.sim.brain.plan}`);
      g.advance(0.6);
    }
    g.clean();
  }
});

test('Feed while the crow is flying drops the treat where it is about to land', () => {
  for (const seed of [3, 16, 20]) {
    const g = newGame({ seed, affection: 149 });
    const k = g.sim.k;
    assert.ok(g.runUntil(() => grounded(g), 20));
    const c = g.crow;
    const target = g.sim.world.clampWalkable(c.x + (c.x < 900 ? 750 : -750) * k, c.y);
    c.interrupt({ type: 'flyTo', target: { x: target.x, y: target.y } });
    assert.ok(g.runUntil(() => g.crow.state === 'fly' && g.crow.airborne, 5));
    g.advance(0.3);
    const fed = g.save.stats.trayFed;
    const it = g.game.sim.feed();
    assert.ok(it);
    assert.ok(Crow.floorDist(it.x, it.y, target.x, target.y) < 200 * k, `treat ${Math.round(Crow.floorDist(it.x, it.y, target.x, target.y) / k)} from the landing spot`);
    assert.ok(g.runUntil(() => g.save.stats.trayFed > fed, 12), `seed ${seed}: still ${g.crow.state}/${g.sim.brain.plan}`);
    g.clean();
  }
});

function droppingSpot(g, dx) {
  const k = g.sim.k;
  return g.sim.world.clampWalkable(g.crow.x + (g.crow.x < 700 ? dx : -dx) * k, g.crow.y + 30 * k);
}

test('after enough meals the crow poops: a white dropping falls from under its tail and splats', () => {
  const g = newGame({ affection: 300 });
  assert.ok(g.runUntil(() => grounded(g), 20));
  g.sim.brain.gut = 1.5;
  g.sim.brain.poopT = 1e4;
  assert.ok(g.runUntil(() => g.crow.state === 'poop', 30), 'never pooped');
  let at = null;
  assert.ok(
    g.runUntil(() => {
      if (g.sim.droppings.length && !at) at = { x: g.crow.x, y: g.crow.y, h: g.crow.h, z0: g.sim.droppings[0].z };
      return !!at;
    }, 3),
    'no dropping'
  );
  const d = g.sim.droppings[0];
  assert.ok(at.z0 > 10 * g.sim.k, `it falls from under the tail: ${at.z0}`);
  const back = (d.x - at.x) * Math.cos(at.h) + ((d.y - at.y) / 0.5878) * Math.sin(at.h);
  assert.ok(back < 0, 'behind the crow');
  assert.ok(Crow.floorDist(d.x, d.y, at.x, at.y) < 25 * g.sim.k);
  assert.ok(g.runUntil(() => d.z === 0 && d.splat >= 1, 2), 'it splats on the floor');
  assert.equal(g.save.stats.droppings, 1);
  assert.equal(g.save.droppings.length, 1);
  assert.ok(g.sim.toasts.some((t) => t.key === 'poopHintToast'));
  assert.ok(g.out.some((e) => e.type === 'sound' && e.name === 'splat'));
  assert.ok(g.sim.brain.gut < 1);
  assert.ok(g.runUntil(() => grounded(g), 10));
  g.clean();
});

test('rubbing a dropping with the pointer cleans it, and so do three clicks', () => {
  const g = newGame({ affection: 300 });
  assert.ok(g.runUntil(() => grounded(g), 20));
  g.game.setPaused(true);
  g.advance(1);
  const k = g.sim.k;
  const p = droppingSpot(g, 220);
  const d = g.sim.addDropping(p.x, p.y);
  assert.deepEqual(g.sim.hitAt(d.x, d.y), { kind: 'dropping', dropping: d });
  g.sim.setCursor(d.x, d.y, DT);
  assert.equal(g.sim.pointerDown(d.x, d.y), 'dropping');
  assert.ok(g.sim.pointerBusy);
  let strokes = 0;
  for (; strokes < 20 && !d.gone; strokes++) g.moveTo(d.x + (strokes % 2 ? -14 : 14) * k, d.y, 0.12);
  assert.ok(d.gone > 0, `still dirty: ${d.dirt}`);
  assert.ok(strokes >= 6, `it takes a few strokes, not one: ${strokes}`);
  g.sim.pointerUp(d.x, d.y);
  assert.ok(g.runUntil(() => g.sim.droppings.length === 0, 2), 'it fades away');
  assert.equal(g.save.stats.cleaned, 1);
  assert.ok(g.out.some((e) => e.type === 'sound' && e.name === 'clean'));
  const e = g.sim.addDropping(p.x, p.y);
  for (let i = 0; i < 2; i++) {
    g.sim.pointerDown(e.x, e.y);
    g.sim.pointerUp(e.x, e.y);
  }
  assert.ok(!e.gone && e.dirt > 0, 'two clicks are not enough');
  g.sim.pointerDown(e.x, e.y);
  g.sim.pointerUp(e.x, e.y);
  assert.ok(e.gone > 0, 'the third click cleans it');
  g.step();
  assert.equal(g.save.stats.cleaned, 2);
  assert.ok(g.sim.toasts.some((t) => t.key === 'allCleanToast'));
  g.clean();
});

test('droppings left on the screen make the crow unhappy and sick, never below the floor; cleaning lets it recover', () => {
  const g = newGame({ affection: 300 });
  assert.ok(g.runUntil(() => grounded(g), 20));
  const b = g.sim.brain;
  const p = droppingSpot(g, 200);
  g.sim.addDropping(p.x, p.y, 0, { age: 0 });
  b.updateCare(1);
  assert.equal(b.messy, 0, 'a fresh dropping is not a mess yet');
  for (const d of g.sim.droppings) d.age = CARE.grace + 1;
  const h0 = b.health;
  const happy0 = b.happiness;
  b.updateCare(60);
  assert.equal(b.messy, 1);
  assert.ok(b.health < h0 && b.happiness < happy0);
  assert.equal(b.mood(), 'messy');
  assert.equal(b.isIll(), true);
  g.sim.addDropping(p.x + 30, p.y, 0, { age: CARE.grace + 1 });
  g.sim.addDropping(p.x - 30, p.y, 0, { age: CARE.grace + 1 });
  for (let i = 0; i < 6 * 3600; i++) b.updateCare(1);
  assert.equal(b.health, CARE.floor, 'it never gets worse than the floor');
  assert.equal(b.mood(), 'sick');
  assert.ok(b.sick > 0.9);
  assert.equal(g.crow.sick, b.sick);
  g.game.cleanAll();
  assert.equal(g.sim.activeDroppings().length, 0);
  for (let i = 0; i < 3600; i++) b.updateCare(1);
  assert.ok(b.health > CARE.sick, `recovered: ${b.health}`);
  assert.notEqual(b.mood(), 'sick');
  for (let i = 0; i < 3 * 3600; i++) b.updateCare(1);
  assert.equal(b.isIll(), false);
  assert.equal(b.sick, 0);
});

test('a sick crow coughs, and while it is ill it wears an ice bag and holds a thermometer', () => {
  const g = newGame({ affection: 300 });
  assert.ok(g.runUntil(() => grounded(g), 20));
  g.sim.brain.health = 0.15;
  g.sim.brain.coughT = 0;
  assert.ok(g.runUntil(() => g.out.some((e) => e.type === 'sound' && e.name === 'cough'), 150), 'never coughed');
  assert.ok(g.runUntil(() => g.crow.pose.ill > 0.99, 4), 'the props never appeared');
  const rig = computeRig(g.crow.pose);
  assert.ok(rig.iceBag && rig.thermo);
  assert.ok(rig.iceBag.y < rig.head.y, 'the ice bag sits on top of the head');
  const snap = g.sim.snapshot();
  assert.ok(snap.crow.ill > 0.99);
  g.sim.brain.health = 1;
  assert.ok(g.runUntil(() => g.crow.pose.ill === 0, 6), 'the props go away when it is well');
  g.clean();
});

test('droppings are saved and come back; switching them off clears them and stops new ones', () => {
  const g = newGame({ affection: 300 });
  assert.ok(g.runUntil(() => grounded(g), 20));
  const p = droppingSpot(g, 200);
  g.sim.addDropping(p.x, p.y, 0, { seed: 77, size: 1.1, age: 400 });
  g.game.syncDroppings();
  g.save.mood = g.game.moodSave();
  const copy = normalizeSave(JSON.parse(JSON.stringify(g.save)), g.now);
  assert.equal(copy.droppings.length, 1);
  const again = new Game({ save: copy, seed: 4, now: () => g.now });
  again.init(LAYOUTS.single);
  assert.equal(again.sim.droppings.length, 1);
  const d = again.sim.droppings[0];
  assert.ok(Math.abs(d.x - p.x) < 0.2 && d.seed === 77 && d.size === 1.1 && d.age === 400);
  again.applySettings({ droppings: false });
  assert.equal(again.sim.droppings.length, 0);
  assert.deepEqual(again.save.droppings, []);
  again.sim.brain.gut = 1.5;
  again.sim.brain.poopT = 1e4;
  assert.equal(again.sim.brain.wantsToPoop(), false);
});

test('no pooping while hidden, paused or boxed, and never more than the maximum on screen', () => {
  const g = newGame({ affection: 300 });
  const b = g.sim.brain;
  b.gut = 1.5;
  b.poopT = 1e4;
  assert.equal(b.wantsToPoop(), true);
  g.sim.paused = true;
  assert.equal(b.wantsToPoop(), false);
  g.sim.paused = false;
  g.sim.hidden = true;
  assert.equal(b.wantsToPoop(), false);
  g.sim.hidden = false;
  for (let i = 0; i < DROP.max; i++) g.sim.addDropping(300 + i * 40, 500);
  assert.equal(b.wantsToPoop(), false);
  b.poopT = 0;
  g.sim.clearDroppings();
  assert.equal(b.wantsToPoop(), false, 'not again right after the last one');
});

test('a hungry crow says so in a bubble with a bar; a click asks how it feels', () => {
  const g = newGame({ affection: 300 });
  g.advance(2);
  assert.ok(g.runUntil(() => grounded(g), 10));
  g.sim.brain.hunger = 0.9;
  g.sim.brain.sayT = 0;
  assert.ok(g.runUntil(() => g.sim.bubble && g.sim.bubble.kind === 'hungry', 5), 'never said it was hungry');
  assert.ok(Math.abs(g.sim.bubble.value - g.sim.brain.hunger) < 0.02);
  const snap = g.sim.snapshot();
  assert.equal(snap.bubble.kind, 'hungry');
  assert.ok(snap.bubble.value > 0.85);
  assert.ok(g.runUntil(() => !g.sim.bubble, 6), 'the bubble goes away');
  g.sim.brain.hunger = 0.4;
  g.sim.brain.happiness = 0.95;
  const [bx, by] = g.bodyPoint();
  g.sim.setCursor(bx, by, 0);
  g.sim.pointerDown(bx, by);
  g.sim.pointerUp(bx, by);
  assert.equal(g.sim.bubble.kind, 'happy');
  assert.equal(g.game.summary().mood.now, 'happy');
  g.clean();
});

test('mood is saved and restored, hungrier after a long time away', () => {
  const g = newGame({ affection: 300 });
  g.sim.brain.hunger = 0.3;
  g.sim.brain.energy = 0.4;
  g.sim.brain.happiness = 0.7;
  g.save.mood = g.game.moodSave();
  const copy = normalizeSave(JSON.parse(JSON.stringify(g.save)), g.now + 5 * 3600000);
  const again = new Game({ save: copy, seed: 9, now: () => g.now + 5 * 3600000 });
  again.init(LAYOUTS.single);
  const m = again.sim.brain.moodState();
  assert.ok(m.hunger > 0.3 && m.hunger <= 0.8, `hunger ${m.hunger}`);
  assert.ok(m.energy >= 0.85, 'rested');
  assert.ok(Math.abs(m.happiness - 0.7) < 1e-9);
});

test('the crow can start in a taped box, and clicking the box lets it out', () => {
  const g = newGame({ affection: 300 });
  const box = g.sim.boxCrow({ x: g.crow.x, y: g.crow.y });
  assert.ok(box && g.sim.boxed);
  assert.equal(g.crow.state, 'away');
  g.advance(4);
  assert.equal(g.crow.state, 'away', 'it waits in the box');
  const snap = g.sim.snapshot();
  assert.equal(snap.crow, null);
  assert.equal(snap.box.state, 'closed');
  assert.equal(g.sim.pace(), 'medium');
  const r = g.sim.boxRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  assert.deepEqual(g.sim.hitAt(cx, cy), { kind: 'box' });
  assert.equal(g.sim.pointerDown(cx, cy), 'box');
  g.sim.pointerUp(cx, cy);
  assert.ok(g.runUntil(() => !g.sim.boxed && g.crow.visible && g.crow.state !== 'away', 2), 'never came out');
  assert.ok(Crow.floorDist(g.crow.x, g.crow.y, box.x, box.y) < 1, 'it pops up inside the box');
  assert.ok(g.runUntil(() => g.crow.state === 'fly', 4), 'it flies out');
  assert.ok(g.runUntil(() => grounded(g), 15), 'and lands');
  assert.ok(Crow.floorDist(g.crow.x, g.crow.y, box.x, box.y) > 60 * g.sim.k, 'outside the box');
  assert.ok(g.runUntil(() => g.sim.box === null, 12), 'the empty box fades away');
  assert.ok(g.out.some((e) => e.type === 'unboxed'));
  g.clean();
});

test('while boxed nothing drops in; Feed opens the box; Hide puts the box away', () => {
  const g = newGame({ affection: 300 });
  g.sim.settings.spawnRate = 'frequent';
  g.sim.spawnT = 0.1;
  g.sim.boxCrow(null);
  g.advance(3);
  assert.equal(g.sim.items.size, 0);
  assert.equal(g.game.feed(), true);
  assert.equal(g.sim.box.state, 'opening');
  const h = newGame({ affection: 300 });
  h.sim.boxCrow(null);
  h.game.hide();
  assert.equal(h.sim.box, null);
  assert.ok(h.sim.hidden);
  h.game.show();
  assert.ok(h.runUntil(() => h.crow.visible && h.crow.state !== 'away', 5), 'Show brings it back');
});

test('music playing: the crow dances now and then; with the setting off it never does', () => {
  const g = newGame({ affection: 300, save: { settings: { activity: 'lively' } } });
  g.advance(2);
  g.sim.setMusic({ playing: true, source: 'Spotify', title: 'Song' });
  assert.ok(g.runUntil(() => g.crow.state === 'dance', 90), 'never danced');
  assert.ok(g.runUntil(() => g.save.stats.dances >= 1, 1));
  assert.ok(g.runUntil(() => g.crow.state !== 'dance', 20), 'the dance ends');
  g.sim.setMusic(null);
  g.advance(60);
  assert.equal(g.crow.state === 'dance', false);
  g.clean();
  const off = newGame({ affection: 300, save: { settings: { activity: 'lively', musicDance: false } } });
  off.sim.setMusic({ playing: true });
  off.advance(90);
  assert.ok(!off.checker.stats.states.dance);
});
