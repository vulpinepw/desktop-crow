'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers');
const { request } = require('./scenarios');
const { DIMS: D, CAM } = require('../src/core/dims');
const { REACH_SAFE } = require('../src/core/crow');
const { computeRig } = require('../src/core/rig');

const EPS = 1e-6;

function newAudit() {
  return { frames: 0, maxDrift: 0, maxGap: 0, maxSink: 0, noFootDown: 0, touchdowns: 0, lifts: 0, liftReach: [], landings: 0, landingGap: 0, prev: null };
}

function stepAudit(h, a) {
  h.step(1);
  const c = h.crow;
  const feet = c.pose.feet.map((f) => ({ x: f.x, y: f.y, ly: f.ly, planted: f.planted && !c.airborne }));
  const rig = computeRig(c.pose);
  const p = a.prev;
  a.frames++;
  if (!c.airborne) {
    for (let i = 0; i < 2; i++) {
      const f = feet[i];
      if (f.planted) {
        a.maxGap = Math.max(a.maxGap, Math.abs(f.ly + D.footLift));
        if (p && p.feet[i].planted) {
          a.maxDrift = Math.max(a.maxDrift, Math.hypot(f.x - c.shift.dx - p.feet[i].x, f.y - c.shift.dy - p.feet[i].y));
        }
        if (p && !p.airborne && !p.feet[i].planted) a.touchdowns++;
      } else {
        a.maxSink = Math.max(a.maxSink, f.ly + D.footLift);
        if (p && p.feet[i].planted) a.lifts++;
      }
    }
    if (c.state === 'walk' && !feet[0].planted && !feet[1].planted) a.noFootDown++;
    if (p && p.airborne) {
      a.landings++;
      for (const f of feet) if (f.planted) a.landingGap = Math.max(a.landingGap, Math.abs(f.ly + D.footLift));
      if (!feet[0].planted || !feet[1].planted) a.landingOneFoot = (a.landingOneFoot || 0) + 1;
    }
  } else if (p && !p.airborne) {
    a.liftReach.push(Math.max(rig.legs[0].d, rig.legs[1].d));
  }
  a.prev = { feet, airborne: c.airborne };
}

function assertContact(a, label) {
  assert.ok(a.maxDrift <= EPS, `${label}: planted foot slid ${a.maxDrift}`);
  assert.ok(a.maxGap <= EPS, `${label}: planted foot off the floor by ${a.maxGap}`);
  assert.ok(a.maxSink <= EPS, `${label}: swinging foot ${a.maxSink} below the floor`);
}

test('walking in every direction: no sliding, no floating, one foot always down (2 speeds x 3 sizes)', () => {
  for (const scale of [0.6, 1, 1.6]) {
    for (const speed of [30, 46]) {
      const h = makeEnv({ seed: 4, scale });
      h.step(20);
      const a = newAudit();
      const area = h.world.areas[0];
      const cx = (area.x0 + area.x1) / 2;
      const cy = (area.y0 + area.y1) / 2;
      const r = Math.min(area.x1 - area.x0, (area.y1 - area.y0) / CAM.F) * 0.35;
      for (let n = 0; n < 8; n++) {
        const ang = n * 2.4;
        h.crow.act({ type: 'walkTo', x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * CAM.F, speed });
        for (let i = 0; i < 60 * 60 && (h.crow.isBusy() || h.crow.state !== 'idle'); i++) stepAudit(h, a);
      }
      const label = `scale ${scale} speed ${speed}`;
      assertContact(a, label);
      assert.equal(a.noFootDown, 0, `${label}: both feet off the ground while walking`);
      assert.ok(a.touchdowns > 60, `${label}: only ${a.touchdowns} steps`);
      assert.ok(h.checker.ok, `${label}: ${JSON.stringify(h.checker.summary().first.slice(0, 2))}`);
    }
  }
});

test('hopping: lift-off only with a straight leg, touch-down exactly on the floor', () => {
  for (const scale of [0.6, 1, 1.6]) {
    const h = makeEnv({ seed: 6, scale });
    h.step(20);
    const a = newAudit();
    for (let n = 0; n < 12; n++) {
      const ang = n * 1.9;
      h.crow.act({ type: 'hopTo', x: h.crow.x + Math.cos(ang) * 40 * scale, y: h.crow.y + Math.sin(ang) * 40 * scale * CAM.F });
      for (let i = 0; i < 6 * 60 && (h.crow.isBusy() || h.crow.state !== 'idle'); i++) stepAudit(h, a);
    }
    const label = `scale ${scale}`;
    assertContact(a, label);
    assert.ok(a.liftReach.length >= 12, `${label}: ${a.liftReach.length} lift-offs`);
    const lifts = h.events.filter((e) => e.type === 'liftoff');
    assert.equal(lifts.length, a.liftReach.length);
    for (const e of lifts) assert.ok(Math.abs(e.reach - REACH_SAFE) < 1e-6, `${label}: left the ground with the leg at ${e.reach.toFixed(4)} (straight = ${REACH_SAFE})`);
    assert.equal(a.landings, a.liftReach.length, `${label}: every hop lands`);
    assert.ok(a.landingGap <= EPS, `${label}: landed ${a.landingGap} off the floor`);
    assert.ok(!a.landingOneFoot, `${label}: landed on one foot ${a.landingOneFoot} time(s)`);
    assert.ok(h.checker.ok, `${label}: ${JSON.stringify(h.checker.summary().first.slice(0, 2))}`);
  }
});

test('standing states keep planted feet perfectly still', () => {
  for (const s of ['idle', 'eat', 'peck', 'sleep', 'perch', 'reactSpawn', 'reactClick', 'giftDrop']) {
    const h = makeEnv({ seed: 12 });
    h.step(20);
    const a = newAudit();
    request(h, s);
    for (let i = 0; i < 16 * 60; i++) {
      stepAudit(h, a);
      if (i > 30 && !h.crow.isBusy() && h.crow.state === 'idle') break;
    }
    assertContact(a, s);
    assert.ok(h.checker.ok, `${s}: ${JSON.stringify(h.checker.summary().first.slice(0, 2))}`);
  }
});

test('turning on the spot steps round (small turns) or hops round (big ones); feet never twist', () => {
  const h = makeEnv({ seed: 3 });
  h.step(20);
  const a = newAudit();
  const facing = (target) => Math.abs(Math.atan2(Math.sin(h.crow.h - target), Math.cos(h.crow.h - target)));
  for (const target of [1.1, 0.1, -1.0, -0.1]) {
    h.crow.act({ type: 'turn', h: target });
    for (let i = 0; i < 6 * 60 && (h.crow.isBusy() || h.crow.state !== 'idle'); i++) stepAudit(h, a);
    assert.ok(facing(target) < 0.05, `ended facing ${h.crow.h} not ${target}`);
  }
  assert.ok(a.touchdowns >= 6, `it stepped round (${a.touchdowns} steps)`);
  assert.equal(a.landings, 0, 'small turns are stepped, not hopped');
  for (const target of [3.0, -1.4]) {
    h.crow.act({ type: 'turn', h: target });
    for (let i = 0; i < 6 * 60 && (h.crow.isBusy() || h.crow.state !== 'idle'); i++) stepAudit(h, a);
    assert.ok(facing(target) < 0.05, `ended facing ${h.crow.h} not ${target}`);
  }
  assert.ok(a.landings >= 2, 'big turns are hop-turns');
  assertContact(a, 'turning');
  assert.ok(h.checker.ok, JSON.stringify(h.checker.summary().first.slice(0, 2)));
});

test('landing from a flight: both feet touch down exactly on the floor', () => {
  for (const seed of [1, 2, 3]) {
    const h = makeEnv({ seed });
    h.step(20);
    const a = newAudit();
    request(h, 'fly');
    for (let i = 0; i < 14 * 60; i++) {
      stepAudit(h, a);
      if (a.landings && !h.crow.isBusy() && h.crow.state === 'idle') break;
    }
    assert.equal(a.landings, 1);
    const lifts = h.events.filter((e) => e.type === 'liftoff');
    assert.equal(lifts.length, 1);
    assert.ok(Math.abs(lifts[0].reach - REACH_SAFE) < 1e-6, `took off with the leg at ${lifts[0].reach}`);
    assert.ok(a.landingGap <= EPS, `landed ${a.landingGap} off the floor`);
    assert.ok(!a.landingOneFoot, 'landed on one foot');
    assertContact(a, `flight seed ${seed}`);
    assert.ok(h.checker.ok, JSON.stringify(h.checker.summary().first.slice(0, 2)));
  }
});

function onWindow(seed) {
  const win = { id: 'w', x: 400, y: 380, width: 700, height: 300 };
  const h = makeEnv({ seed, windows: [win] });
  h.step(20);
  const p = h.world.perches.find((q) => q.windowId === 'w');
  h.crow.act({ type: 'flyTo', target: { x: 750, y: p.y, perchId: p.id } });
  h.crow.act({ type: 'idle', duration: 30 });
  assert.ok(h.runUntil(() => h.crow.state === 'idle' && h.crow.perchId === p.id && h.crow.stateTime > 0.5, 15), 'never landed on the window');
  return { h, win };
}

function moveWindow(h, win) {
  const prev = Object.assign({}, h.crow.perch());
  h.world.setWindows([win]);
  h.crow.onWorldChanged(prev);
}

test('a crow on a window edge rides along when the window is dragged', () => {
  const { h, win } = onWindow(5);
  const before = h.crow.pose.feet.map((f) => [f.x, f.y]);
  const x0 = h.crow.x;
  moveWindow(h, Object.assign({}, win, { x: win.x + 10, y: win.y - 6 }));
  h.step(1);
  assert.ok(Math.abs(h.crow.x - (x0 + 10)) < 0.5, `crow x ${h.crow.x} vs ${x0 + 10}`);
  assert.equal(h.crow.y, win.y - 6);
  h.crow.pose.feet.forEach((f, i) => {
    if (f.planted) assert.ok(Math.abs(f.x - (before[i][0] + 10)) < EPS && Math.abs(f.y - (before[i][1] - 6)) < EPS, `foot ${i} did not move with the window`);
  });
  const a = newAudit();
  for (let i = 1; i <= 60; i++) {
    moveWindow(h, Object.assign({}, win, { x: win.x + 10 + i * 2, y: win.y - 6 + (i % 2) }));
    stepAudit(h, a);
  }
  assertContact(a, 'riding');
  assert.equal(h.crow.state, 'idle');
  assert.ok(h.checker.ok, JSON.stringify(h.checker.summary().first.slice(0, 3)));
});

test('window flung away or closed under the crow: it stays put on the desktop, never teleports', () => {
  for (const change of ['fling', 'close']) {
    const { h, win } = onWindow(6);
    const x0 = h.crow.x;
    const y0 = h.crow.y;
    if (change === 'fling') moveWindow(h, Object.assign({}, win, { x: win.x + 400, y: win.y + 250 }));
    else {
      const prev = Object.assign({}, h.crow.perch());
      h.world.setWindows([]);
      h.crow.onWorldChanged(prev);
    }
    h.step(1);
    assert.equal(h.crow.perchId, null, `${change}: still perched`);
    assert.ok(Math.hypot(h.crow.x - x0, h.crow.y - y0) < 1e-9, `${change}: moved to ${h.crow.x},${h.crow.y}`);
    assert.ok(h.world.inWalkable(h.crow.x, h.crow.y));
    h.step(120);
    assert.ok(h.checker.ok, `${change}: ${JSON.stringify(h.checker.summary().first.slice(0, 3))}`);
  }
});
