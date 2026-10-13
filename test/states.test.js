'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, LAYOUTS } = require('./helpers');
const { request } = require('./scenarios');
const { runMatrix } = require('./matrix');
const { ANIM_STATES } = require('../src/core/crow');

function describe(bad) {
  return bad
    .slice(0, 6)
    .map((r) => `${r.a}->${r.b} off=${r.off} seed=${r.seed} reachedA=${r.reachedA} reachedB=${r.reachedB} ${r.first.slice(0, 2).map((v) => `${v.kind}: ${v.msg}`).join(' | ')}`)
    .join('\n');
}

test('every animation state can be entered, plays cleanly and returns to idle', () => {
  for (const s of ANIM_STATES) {
    for (const seed of [7, 8]) {
      const h = makeEnv({ seed });
      h.step(20);
      assert.ok(h.runUntil(request(h, s), 8), `${s} never entered`);
      if (s === 'held') {
        h.step(90);
        h.release();
      }
      assert.ok(h.settle(16), `${s} never settled back to idle (stuck in ${h.crow.state})`);
      const sum = h.checker.summary();
      assert.ok(sum.ok, `${s}: ${JSON.stringify(sum.first.slice(0, 3))}`);
      assert.ok(h.checker.stats.states[s] > 0);
    }
  }
});

test('state x state transition matrix, 6 entry points each, is clean', () => {
  const res = runMatrix({ seeds: [11] });
  assert.equal(res.length, ANIM_STATES.length * ANIM_STATES.length * 6);
  const bad = res.filter((r) => !r.ok || !r.reachedA || !r.reachedB);
  assert.equal(bad.length, 0, describe(bad));
  const seen = new Set();
  for (const r of res) for (const key of Object.keys(r.transitions)) seen.add(key);
  for (const s of ANIM_STATES) {
    assert.ok([...seen].some((k) => k.startsWith(`${s}->`)), `never left ${s}`);
    assert.ok([...seen].some((k) => k.endsWith(`->${s}`)), `never entered ${s}`);
  }
});

test('matrix at the smallest and largest crow sizes', () => {
  for (const scale of [0.6, 1.6]) {
    const res = runMatrix({ seeds: [5], offsets: [0.07, 0.29], env: { scale } });
    const bad = res.filter((r) => !r.ok || !r.reachedA || !r.reachedB);
    assert.equal(bad.length, 0, `scale ${scale}\n${describe(bad)}`);
  }
});

test('matrix on other monitor layouts (side taskbar, mixed-DPI secondary monitor)', () => {
  const cases = [
    { layout: LAYOUTS.leftTaskbar, env: {} },
    { layout: LAYOUTS.mixedDpi, env: { startDisplay: 2 } },
    { layout: LAYOUTS.stacked, env: { startDisplay: 2 } },
  ];
  for (const c of cases) {
    const res = runMatrix({ seeds: [9], offsets: [0.16], layout: c.layout, env: c.env });
    const bad = res.filter((r) => !r.ok || !r.reachedA || !r.reachedB);
    assert.equal(bad.length, 0, describe(bad));
  }
});
