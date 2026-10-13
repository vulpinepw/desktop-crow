'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { World } = require('../src/core/world');
const { CAM } = require('../src/core/dims');
const { createRng } = require('../src/core/rng');
const { LAYOUTS } = require('./helpers');

function world(displays, windows, k = 1) {
  const w = new World({ scale: k });
  w.setDisplays(displays);
  if (windows) w.setWindows(windows);
  return w;
}

const O = new World().opts;

test('the whole work area is floor, less margins that keep the crow on screen', () => {
  for (const k of [0.6, 1, 1.6]) {
    const w = world(LAYOUTS.single, null, k);
    assert.equal(w.areas.length, 1);
    const a = w.areas[0];
    assert.ok(a.ok);
    assert.equal(a.x0, O.marginSide * k);
    assert.equal(a.x1, 1536 - O.marginSide * k);
    assert.equal(a.y0, O.marginTop * k);
    assert.equal(a.y1, 824 - O.marginBottom * k);
    assert.ok((a.y1 - a.y0) / 824 > 0.75, `walkable height ${a.y1 - a.y0} at k=${k}`);
  }
});

test('taskbars are not floor; a bottom taskbar is a perch', () => {
  const w = world(LAYOUTS.single);
  assert.ok(!w.inWalkable(700, 840));
  const bar = w.perches.find((p) => p.kind === 'taskbar');
  assert.ok(bar, 'bottom taskbar perch');
  assert.equal(bar.y, 824);
  assert.ok(bar.x0 > 0 && bar.x1 < 1536, 'inset from the screen sides');
  for (const name of ['topTaskbar', 'leftTaskbar', 'rightTaskbar', 'autoHide']) {
    assert.ok(!world(LAYOUTS[name]).perches.some((p) => p.kind === 'taskbar'), `${name}: no taskbar perch`);
  }
  const top = world(LAYOUTS.topTaskbar);
  assert.ok(!top.inWalkable(700, 20), 'top taskbar is not floor');
  const left = world(LAYOUTS.leftTaskbar);
  assert.ok(left.areas[0].x0 >= 62 + O.marginSide - 1e-9);
});

test('every monitor has its own floor; the gap between monitors is not floor', () => {
  const w = world(LAYOUTS.dualEqual);
  assert.equal(w.areas.length, 2);
  assert.ok(w.inWalkable(500, 500) && w.inWalkable(2500, 500));
  assert.ok(!w.inWalkable(1920, 500), 'the seam between the monitors keeps margins on both sides');
  const neg = world(LAYOUTS.dualNegativeTall);
  assert.ok(neg.inWalkable(-1280, 1300), 'the taller monitor on the left is floor down to its bottom');
});

test('window perches: visible top edges, clipped by windows above them', () => {
  const wins = [
    { id: 'top', x: 500, y: 300, width: 400, height: 300 },
    { id: 'low', x: 300, y: 400, width: 800, height: 300 },
  ];
  const w = world(LAYOUTS.single, wins);
  const low = w.perches.filter((s) => s.windowId === 'low');
  assert.deepEqual(low.map((s) => [s.x0, s.x1]), [
    [300, 499],
    [901, 1100],
  ]);
  assert.equal(w.perches.filter((s) => s.windowId === 'top').length, 1);
  assert.ok(low.every((p) => p.kind === 'window' && p.y === 400));
});

test('perches need headroom and a usable length; occluder-only windows are not perches', () => {
  const wins = [
    { id: 'tool', x: 400, y: 380, width: 300, height: 60, occluderOnly: true },
    { id: 'app', x: 300, y: 400, width: 600, height: 300 },
    { id: 'hi', x: 1000, y: 30, width: 400, height: 300 },
    { id: 'tiny', x: 1200, y: 500, width: 40, height: 200 },
  ];
  const w = world(LAYOUTS.single, wins);
  const ids = new Set(w.perches.map((p) => p.windowId));
  assert.ok(!ids.has('tool') && !ids.has('hi') && !ids.has('tiny'));
  assert.equal(w.perches.filter((p) => p.windowId === 'app').length, 2);
});

test('perches on a window hanging off the screen stop short of the edge', () => {
  const w = world(LAYOUTS.single, [{ id: 'off', x: -300, y: 400, width: 700, height: 300 }]);
  const p = w.perches.find((q) => q.windowId === 'off');
  assert.ok(p.x0 > 0 && p.x1 === 400);
  assert.ok(w.perchRange(p).x0 >= O.marginSide - 1e-9);
});

test('clampWalkable finds the nearest floor spot (measured on the floor)', () => {
  const w = world(LAYOUTS.dualEqual);
  const c = w.clampWalkable(1920, 30);
  assert.ok(w.inWalkable(c.x, c.y));
  const a = w.clampWalkable(10, 500);
  assert.equal(a.x, O.marginSide);
  assert.equal(a.y, 500);
  const d = w.clampWalkable(O.marginSide - 20, O.marginTop - 20 * CAM.F * 0.5);
  assert.equal(d.x, O.marginSide);
});

test('random floor spots are on the floor, and in the requested band around a point', () => {
  const w = world(LAYOUTS.mixedDpi);
  const rng = createRng(4);
  for (let i = 0; i < 500; i++) {
    const p = w.randomWalkable(rng, {});
    assert.ok(w.inWalkable(p.x, p.y));
    const q = w.randomWalkable(rng, { near: { x: 600, y: 400 }, minR: 40, maxR: 120, displayId: 1 });
    assert.ok(w.inWalkable(q.x, q.y));
    assert.equal(w.areaAt(q.x, q.y).displayId, 1);
  }
});

test('edgeExit: the nearest outer edge of a display, never into a neighbour; all four sides', () => {
  const w = world(LAYOUTS.dualEqual);
  const d1 = w.displayById(1);
  const e1 = w.edgeExit(d1, 1850, 500, 100);
  assert.notEqual(e1.side, 'right');
  assert.ok(!w.displayAt(e1.x, e1.y));
  const s = world(LAYOUTS.single);
  const d = s.displays[0];
  assert.equal(s.edgeExit(d, 20, 400, 100).side, 'left');
  assert.equal(s.edgeExit(d, 1520, 400, 100).side, 'right');
  assert.equal(s.edgeExit(d, 700, 40, 100).side, 'top');
  assert.equal(s.edgeExit(d, 700, 850, 100).side, 'bottom');
  const m = world(LAYOUTS.mixedDpi);
  for (const dd of m.displays) {
    for (const [x, y] of [
      [dd.bounds.x + 10, dd.workArea.y + 200],
      [dd.bounds.x + dd.bounds.width - 10, dd.workArea.y + 300],
      [dd.bounds.x + 400, dd.bounds.y + 10],
    ]) {
      const ex = m.edgeExit(dd, x, y, 112);
      assert.ok(!m.displayAt(ex.x, ex.y), 'exit point must be off every display');
    }
  }
});

test('onOrBetweenDisplays accepts small DIP gaps between monitors only', () => {
  const m = world(LAYOUTS.mixedDpi);
  assert.ok(m.onOrBetweenDisplays(1285, 400, 30));
  assert.ok(!m.onOrBetweenDisplays(640, 1000, 30));
});
