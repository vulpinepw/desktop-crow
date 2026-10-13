'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultPose, computeRig, keyPoints, hitTest, toWorld, solveIK3, LEG_POLE, frameOf, proj, depthOf } = require('../src/core/rig');
const { DIMS: D, CAM } = require('../src/core/dims');
const { createRng } = require('../src/core/rng');

const HEADINGS = Array.from({ length: 16 }, (_, i) => -Math.PI + (i * Math.PI) / 8);

function poseAt(h, extra = {}) {
  const p = defaultPose();
  p.h = h;
  for (const f of p.feet) f.th = h;
  return Object.assign(p, extra);
}

test('the camera is a true rotation: ground depth and heights shortened, lengths kept', () => {
  assert.ok(Math.abs(CAM.F * CAM.F + CAM.H * CAM.H - 1) < 1e-12);
  const rng = createRng(3);
  for (let i = 0; i < 500; i++) {
    const fr = frameOf(rng.range(-Math.PI, Math.PI));
    const v = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
    const len2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const [x, y] = proj(fr, ...v);
    const d = depthOf(fr, ...v);
    assert.ok(Math.abs(x * x + y * y + d * d - len2) < 1e-9);
  }
});

test('3D two-bone IK keeps bone lengths and bends the heel backward', () => {
  const rng = createRng(1);
  for (let i = 0; i < 2000; i++) {
    const hip = [rng.range(-2, 2), rng.range(-24, -8), rng.range(-3, 3)];
    const foot = [rng.range(-8, 8), rng.range(-3, 0), rng.range(-6, 6)];
    const ik = solveIK3(hip, foot, D.legUpper, D.legLower, LEG_POLE);
    if (!ik.reach) continue;
    const k = ik.knee;
    assert.ok(Math.abs(Math.hypot(k[0] - hip[0], k[1] - hip[1], k[2] - hip[2]) - D.legUpper) < 1e-6);
    assert.ok(Math.abs(Math.hypot(foot[0] - k[0], foot[1] - k[1], foot[2] - k[2]) - D.legLower) < 1e-6);
    const mid = [(hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2, (hip[2] + foot[2]) / 2];
    assert.ok(k[0] <= mid[0] + 1e-6, 'heel must point backwards');
  }
});

test('rig produces finite geometry for random poses at any heading, height and size', () => {
  const rng = createRng(2);
  for (let i = 0; i < 3000; i++) {
    const p = poseAt(rng.range(-Math.PI, Math.PI), {
      x: rng.range(-2000, 2000),
      y: rng.range(-500, 1500),
      z: rng.chance(0.5) ? 0 : rng.range(0, 200),
      k: rng.range(0.6, 1.6),
      hipH: rng.range(6, 24),
      pitch: rng.range(-0.5, 0.6),
      headYaw: rng.range(-1.9, 1.9),
      headA: rng.range(-0.8, 1.2),
      wing: rng.next(),
      flap: rng.range(-1, 1),
      fluff: rng.range(0, 1.2),
      beak: rng.next(),
    });
    const r = computeRig(p);
    for (const [name, pt] of Object.entries(keyPoints(r))) {
      assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1]), `${name} not finite`);
    }
    assert.ok(r.body.rx > 0 && r.body.ry > 0);
  }
});

test('the body never collapses to a sliver, from any side', () => {
  for (const h of HEADINGS) {
    const r = computeRig(poseAt(h));
    assert.ok(Math.min(r.body.rx, r.body.ry) >= 9, `h=${h.toFixed(2)}: body ${r.body.rx.toFixed(1)} x ${r.body.ry.toFixed(1)}`);
  }
});

test('eyes: both seen from the front, one from the side, none from behind', () => {
  const vis = (h) => computeRig(poseAt(h, { lookX: 0 })).eyes.map((e) => e.vis);
  assert.ok(vis(Math.PI / 2).every((v) => v > 0.5), 'facing the viewer');
  const side = vis(0);
  assert.ok(Math.max(...side) > 0.5 && Math.min(...side) < 0.05, `profile: ${side}`);
  assert.ok(vis(-Math.PI / 2).every((v) => v < 0.05), 'facing away');
});

test('painter order follows the camera: nearer leg last, head in front only when facing the viewer', () => {
  assert.deepEqual(computeRig(poseAt(0)).legOrder, [0, 1]);
  assert.deepEqual(computeRig(poseAt(Math.PI)).legOrder, [1, 0]);
  const order = (h) => computeRig(poseAt(h)).parts.map((p) => p.name);
  const front = order(Math.PI / 2);
  assert.ok(front.indexOf('head') > front.indexOf('body'), `facing the viewer: ${front}`);
  assert.ok(front.indexOf('tail') < front.indexOf('body'), `facing the viewer: ${front}`);
  const back = order(-Math.PI / 2);
  assert.ok(back.indexOf('head') < back.indexOf('body'), `facing away: ${back}`);
});

test('planted standing feet: toes flat on the floor, legs within reach', () => {
  for (const h of HEADINGS) {
    const r = computeRig(poseAt(h));
    for (const leg of r.legs) {
      assert.ok(leg.d < D.legUpper + D.legLower - 0.5);
      for (const pt of leg.toes3.front.concat(leg.toes3.back)) assert.ok(pt[1] <= 1e-9, 'toe below the floor');
      assert.ok(Math.abs(leg.foot3[1] + D.footLift) < 1e-9);
    }
  }
});

test('flying higher lifts the crow and fades and moves its shadow away from it', () => {
  const low = computeRig(poseAt(0.4, { z: 0 }));
  const high = computeRig(poseAt(0.4, { z: 120 }));
  assert.ok(high.shadow.a < low.shadow.a);
  const a = toWorld(low.pose, low.body.cx, low.body.cy);
  const b = toWorld(high.pose, high.body.cx, high.body.cy);
  assert.ok(Math.abs(a[1] - b[1] - 120 * CAM.H) < 1e-9);
  const sa = toWorld(low.pose, low.shadow.cx, low.shadow.cy);
  const sb = toWorld(high.pose, high.shadow.cx, high.shadow.cy);
  assert.ok(Math.abs(sa[1] - sb[1]) < 1e-9);
});

test('hit test covers body and head from every side, not empty space', () => {
  for (const h of HEADINGS) {
    const p = poseAt(h, { x: 500, y: 800, k: 1 });
    const r = computeRig(p);
    const body = toWorld(p, r.body.cx, r.body.cy);
    const head = toWorld(p, r.head.x, r.head.y);
    assert.ok(hitTest(r, body[0], body[1]), `body at h=${h.toFixed(2)}`);
    assert.ok(hitTest(r, head[0], head[1]), `head at h=${h.toFixed(2)}`);
    assert.ok(!hitTest(r, 500, 700));
    assert.ok(!hitTest(r, 620, 800));
  }
});
