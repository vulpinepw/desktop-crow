'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeSave, defaultSave, SAVE_VERSION, SCALE_MIN, SCALE_MAX } = require('../src/core/save-schema');
const { Storage } = require('../src/main/storage');
const { AFFECTION_MAX } = require('../src/core/affection');
const { DROP, CARE } = require('../src/core/care');

const made = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dcrow-save-'));
  made.push(d);
  return d;
}
test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

test('defaults are complete and normalizing them is idempotent', () => {
  const d = defaultSave(1000);
  const n = normalizeSave(JSON.parse(JSON.stringify(d)), 1000);
  assert.deepEqual(n, d);
  assert.equal(n.version, SAVE_VERSION);
});

test('garbage and hostile input never throws and yields valid values', () => {
  const inputs = [null, 42, 'x', [], { crow: 5 }, { crow: { name: 123, gender: 'robot' } }, { affection: { value: 1e9 } }, { affection: -5 }, { settings: { scale: 99, spawnRate: 'always', volume: 'loud', droppings: 'yes' } }, { gifts: { inventory: { coin: -3, notAThing: 5 }, pending: [{ type: 'ring', x: 'a' }, { type: 'nope' }] } }, { position: { x: NaN, y: 3 } }, { stats: { itemsEaten: 'many', daysActive: 3.7, cleaned: -2 } }, { windows: { settings: { x: 1, y: 2, width: 99999, height: -4 } } }, { mood: { health: -3, gut: 99 } }, { droppings: 'lots' }, { droppings: [null, { x: 'a' }, { x: 5, y: 6, size: 9, age: -1 }, ...Array(9).fill({ x: 1, y: 2 })] }];
  for (const raw of inputs) {
    const s = normalizeSave(raw, 1000);
    assert.ok(typeof s.crow.name === 'string' && s.crow.name.length > 0);
    assert.ok(s.crow.gender === 'she' || s.crow.gender === 'he');
    assert.ok(s.affection.value >= 0 && s.affection.value <= AFFECTION_MAX);
    assert.ok(s.mood.health >= CARE.floor && s.mood.health <= 1);
    assert.ok(Array.isArray(s.droppings) && s.droppings.length <= DROP.max);
    for (const d of s.droppings) assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y) && d.size >= 0.7 && d.size <= 1.4 && d.age >= 0);
    assert.equal(typeof s.settings.droppings, 'boolean');
    assert.ok(s.stats.cleaned >= 0);
    assert.ok(s.settings.scale >= SCALE_MIN && s.settings.scale <= SCALE_MAX);
    assert.ok(['off', 'rare', 'normal', 'frequent'].includes(s.settings.spawnRate));
    assert.ok(s.settings.volume >= 0 && s.settings.volume <= 1);
    for (const [k, v] of Object.entries(s.gifts.inventory)) assert.ok(v >= 0 && k !== 'notAThing');
    for (const p of s.gifts.pending) assert.ok(p.type === 'ring' || p.type === 'coin' || typeof p.type === 'string');
    assert.ok(Number.isInteger(s.stats.daysActive));
  }
});

test('1.3 saves load with a healthy crow, no droppings and droppings switched on; trust above 1000 is kept', () => {
  const s = normalizeSave({ version: 3, affection: { value: 640 }, mood: { hunger: 0.5, energy: 0.6, happiness: 0.7, at: 5 }, settings: { musicDance: false } }, 1000);
  assert.equal(s.affection.value, 640);
  assert.equal(s.mood.health, 1);
  assert.deepEqual(s.droppings, []);
  assert.equal(s.settings.droppings, true);
  assert.equal(s.stats.cleaned, 0);
  assert.equal(normalizeSave({ affection: { value: 1800 } }, 1000).affection.value, 1800);
  assert.equal(normalizeSave({ affection: { value: 99999 } }, 1000).affection.value, AFFECTION_MAX);
});

test('v1 saves (plain number affection) migrate', () => {
  const s = normalizeSave({ version: 1, crow: { name: 'Old', gender: 'he', setupComplete: true }, affection: 321 }, 1000);
  assert.equal(s.affection.value, 321);
  assert.equal(s.crow.name, 'Old');
  assert.equal(s.version, SAVE_VERSION);
});

test('v2 saves migrate: the crow gets 20% smaller, facing left/right becomes a heading', () => {
  const s = normalizeSave({ version: 2, settings: { scale: 1.25 }, position: { x: 700, y: 824, displayId: 1, relX: 0.4, relY: 1, facing: -1 } }, 1000);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.settings.scale, 1, 'the old default size becomes the new (smaller) default');
  assert.ok(Math.abs(s.position.h - Math.PI) < 1e-12);
  const big = normalizeSave({ version: 2, settings: { scale: 2 } }, 1000);
  assert.ok(Math.abs(big.settings.scale - 1.6) < 1e-12, 'the old largest size becomes the new largest');
  const again = normalizeSave(JSON.parse(JSON.stringify(s)), 1000);
  assert.equal(again.settings.scale, 1);
  assert.equal(normalizeSave({ version: 3, settings: { scale: 1.25 } }, 1000).settings.scale, 1.25);
  assert.equal(defaultSave(1000).settings.scale, 1);
});

test('unicode names survive a save/load round trip', () => {
  const dir = tmpDir();
  const st = new Storage(dir);
  const s = defaultSave(1000);
  s.crow.name = 'Corvo ☆ 🐦';
  s.crow.gender = 'he';
  s.affection.value = 512;
  s.gifts.inventory = { coin: 3, ring: 1 };
  s.position = { x: -1234.5, y: 640, displayId: 2528732444, relX: 0.25, relY: 0.6, h: -2.5 };
  st.save(s);
  const back = new Storage(dir).load(2000);
  assert.equal(back.source, 'main');
  assert.equal(back.save.crow.name, s.crow.name);
  assert.equal(back.save.affection.value, 512);
  assert.deepEqual(back.save.gifts.inventory, { coin: 3, ring: 1 });
  assert.equal(back.save.position.x, -1234.5);
  assert.equal(back.save.position.h, -2.5);
  assert.equal(back.save.position.displayId, 2528732444);
});

test('atomic save keeps a backup; a corrupt main file falls back to it', () => {
  const dir = tmpDir();
  const st = new Storage(dir);
  const s = defaultSave(1000);
  s.crow.name = 'First';
  st.save(s);
  s.crow.name = 'Second';
  st.save(s);
  assert.ok(fs.existsSync(path.join(dir, 'save.json.bak')));
  assert.ok(!fs.existsSync(path.join(dir, 'save.json.tmp')));
  fs.writeFileSync(path.join(dir, 'save.json'), '{"crow": {"name": "Sec');
  const r = new Storage(dir).load(2000);
  assert.equal(r.source, 'backup');
  assert.equal(r.recovered, true);
  assert.equal(r.save.crow.name, 'First');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('save.json.corrupt-')));
});

test('BOM-prefixed JSON (edited in Notepad) loads', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'save.json'), '﻿' + JSON.stringify({ crow: { name: 'Bom' } }), 'utf8');
  const r = new Storage(dir).load(1000);
  assert.equal(r.save.crow.name, 'Bom');
});

test('missing directory is created; first run gives fresh defaults', () => {
  const dir = path.join(tmpDir(), 'nested', 'deeper');
  const st = new Storage(dir);
  const r = st.load(1000);
  assert.equal(r.fresh, true);
  st.save(r.save);
  assert.ok(fs.existsSync(path.join(dir, 'save.json')));
});
