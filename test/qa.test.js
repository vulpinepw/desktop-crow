'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, DT } = require('./helpers');
const { request } = require('./scenarios');
const { MotionChecker } = require('../src/core/qa');
const { clonePose } = require('../src/core/rig');
const { stepItem } = require('../src/core/items');
const { CAM } = require('../src/core/dims');

function once(pred) {
  let fired = false;
  return (c, i, h) => {
    if (fired || !pred(c, i, h)) return false;
    fired = true;
    return true;
  };
}

function inject({ state = 'walk', when = () => false, mutate = () => {}, frames = 360, seed = 21, env = {}, setup } = {}) {
  const h = makeEnv(Object.assign({ seed }, env));
  h.step(20);
  if (setup) setup(h);
  request(h, state);
  const checker = new MotionChecker();
  let injected = 0;
  for (let i = 0; i < frames; i++) {
    h.crow.step(DT);
    for (const it of h.items.values()) {
      stepItem(it, DT, h.world);
      if (it.state === 'gone') h.items.delete(it.id);
    }
    let view = h.crow;
    if (when(h.crow, i, h)) {
      view = Object.create(h.crow);
      view.pose = clonePose(h.crow.pose);
      mutate(view, h, i);
      injected++;
    }
    checker.check(view, h.world, DT);
  }
  return { counts: checker.counts, violations: checker.violations, injected, h };
}

const bothPlanted = (c) => !c.airborne && c.pose.feet[0].planted && c.pose.feet[1].planted && c.stateTime > 0.2;
const has = (r, kind, re) => (r.counts[kind] || 0) > 0 && (!re || r.violations.some((v) => v.kind === kind && re.test(v.msg)));

test('control: the same runs without a fault are clean', () => {
  for (const state of ['idle', 'walk', 'hop', 'fly', 'eat', 'peck', 'held']) {
    const r = inject({ state, frames: 300 });
    assert.deepEqual(r.counts, {}, `${state}: ${JSON.stringify(r.violations.slice(0, 2))}`);
  }
});

test('pop: the whole crow jumps 30 units for one frame', () => {
  const r = inject({ when: once((c) => c.state === 'walk' && c.stateTime > 0.3), mutate: (v) => (v.pose.x += 30 * v.k) });
  assert.equal(r.injected, 1);
  assert.ok(has(r, 'pop', /jumped/), JSON.stringify(r.counts));
});

test('pop: a 5-unit one-frame twitch of the head alone', () => {
  const r = inject({
    state: 'idle',
    when: once((c, i) => i >= 10 && bothPlanted(c)),
    mutate: (v) => {
      v.pose.headX += 3;
      v.pose.headY -= 4;
    },
  });
  assert.ok(has(r, 'pop', /(head|eye|beakTip) twitched/), JSON.stringify(r.violations.slice(0, 3)));
});

test('snap: the body suddenly gains 480 units/s (small per-frame steps)', () => {
  let n = 0;
  const r = inject({
    when: (c) => c.state === 'walk' && c.stateTime > 0.3 && n < 10,
    mutate: (v) => {
      n++;
      v.pose.x += 8 * v.k * n;
    },
  });
  assert.ok(has(r, 'snap'), JSON.stringify(r.counts));
});

test('pop: a pose channel jumps (head angle +0.8 rad; heading +0.8 rad) in one frame', () => {
  const a = inject({ state: 'idle', when: once((c, i) => i >= 10 && bothPlanted(c)), mutate: (v) => (v.pose.headA += 0.8) });
  assert.ok(has(a, 'pop', /channel headA/), JSON.stringify(a.counts));
  const b = inject({ state: 'idle', when: once((c, i) => i >= 10 && bothPlanted(c)), mutate: (v) => (v.pose.h += 0.8) });
  assert.ok(has(b, 'pop', /channel h /), JSON.stringify(b.counts));
});

test('heading wraps around without counting as a jump', () => {
  const r = inject({
    state: 'idle',
    setup: (h) => {
      h.crow.h = Math.PI - 0.01;
    },
    when: (c) => c.stateTime > 0.2,
    mutate: (v, h, i) => {
      v.pose.h = ((Math.PI - 0.01 + i * 0.01 + Math.PI) % (Math.PI * 2)) - Math.PI;
      for (const f of v.pose.feet) f.th = v.pose.h;
    },
    frames: 60,
  });
  assert.ok(!has(r, 'pop', /channel h /), JSON.stringify(r.violations.slice(0, 2)));
});

test('slide: a planted foot creeps 0.01 px per frame', () => {
  let drift = 0;
  const r = inject({
    state: 'idle',
    when: (c) => bothPlanted(c) && drift < 0.3,
    mutate: (v) => {
      drift += 0.01;
      v.pose.feet[0].x += drift;
    },
  });
  assert.ok(has(r, 'slide'), JSON.stringify(r.counts));
});

test('float: a planted foot hovers 0.5 units above the floor', () => {
  const r = inject({ state: 'idle', when: once(bothPlanted), mutate: (v) => (v.pose.feet[1].ly -= 0.5) });
  assert.ok(has(r, 'float', /not on the floor/), JSON.stringify(r.counts));
});

test('float: a planted leg is stretched past its reach', () => {
  const r = inject({ state: 'idle', when: once(bothPlanted), mutate: (v) => (v.pose.feet[0].lx += 14) });
  assert.ok(has(r, 'float', /over-stretched/), JSON.stringify(r.counts));
});

test('penetration: a planted foot sinks into the floor; the body sinks into it', () => {
  const a = inject({ state: 'idle', when: once(bothPlanted), mutate: (v) => (v.pose.feet[0].ly += 0.5) });
  assert.ok(has(a, 'penetration', /below the floor/) || has(a, 'float'), JSON.stringify(a.counts));
  const b = inject({
    state: 'idle',
    when: once(bothPlanted),
    mutate: (v) => {
      v.pose.hipH = 3;
      v.pose.pitch = 0.9;
    },
  });
  assert.ok(has(b, 'penetration', /body below the floor/), JSON.stringify(b.violations.slice(0, 3)));
});

test('penetration: toes dip below the floor just before a hop lands', () => {
  const r = inject({
    state: 'hop',
    when: (c) => c.airborne && c.vz < 0 && c.z < 3 * c.k && c.z > 0,
    mutate: (v) => {
      for (const f of v.pose.feet) f.ly += 5;
    },
  });
  assert.ok(r.injected > 0, 'hop never came close to touch-down');
  assert.ok(has(r, 'penetration', /toe/), JSON.stringify(r.counts));
});

test('pivot: the body is not over its feet', () => {
  const r = inject({
    state: 'idle',
    when: once(bothPlanted),
    mutate: (v) => {
      for (const f of v.pose.feet) f.lz += 14;
    },
  });
  assert.ok(has(r, 'pivot', /not over its feet/), JSON.stringify(r.counts));
});

test('nan and range: broken pose values', () => {
  const a = inject({ state: 'idle', when: once(bothPlanted), mutate: (v) => (v.pose.pitch = NaN) });
  assert.ok(has(a, 'nan'), JSON.stringify(a.counts));
  const b = inject({ state: 'idle', when: once(bothPlanted), mutate: (v) => (v.pose.eye = 1.3) });
  assert.ok(has(b, 'range'), JSON.stringify(b.counts));
  const c = inject({ state: 'fly', frames: 200, when: once((cr) => cr.airborne && cr.z > 5), mutate: (v) => (v.pose.z = -2) });
  assert.ok(has(c, 'range', /below the floor/), JSON.stringify(c.counts));
});

test('floor: standing where there is no floor (in the top margin, the taskbar)', () => {
  const r = inject({ state: 'idle', when: once(bothPlanted), mutate: (v, h) => (v.y = h.world.areas[0].y0 - 30) });
  assert.ok(has(r, 'floor', /standing off the floor/), JSON.stringify(r.counts));
});

test('surface and anchor: perched on a vanished perch; anchor off its perch line', () => {
  const win = { id: 'w', x: 400, y: 380, width: 700, height: 300 };
  const perched = (h) => {
    const p = h.world.perches.find((q) => q.windowId === 'w');
    h.crow.act({ type: 'flyTo', target: { x: 750, y: p.y, perchId: p.id } });
    h.crow.act({ type: 'idle', duration: 30 });
    h.runUntil(() => h.crow.state === 'idle' && h.crow.perchId && h.crow.stateTime > 0.3, 15);
  };
  const a = inject({ state: 'idle', env: { windows: [win] }, setup: perched, when: once((c) => c.perchId && bothPlanted(c)), mutate: (v) => (v.perchId = 'win:gone:0') });
  assert.ok(has(a, 'surface'), JSON.stringify(a.counts));
  const b = inject({ state: 'idle', env: { windows: [win] }, setup: perched, when: once((c) => c.perchId && bothPlanted(c)), mutate: (v) => (v.y += 2) });
  assert.ok(has(b, 'anchor', /off its perch line/), JSON.stringify(b.counts));
});

test('bounds: the crow drawn off the screen', () => {
  const r = inject({ state: 'idle', when: (c) => bothPlanted(c), mutate: (v) => (v.pose.x = -400) });
  assert.ok(has(r, 'bounds'), JSON.stringify(r.counts));
});

test('let go of: the body may not jump further than a carried crow can move', () => {
  const h = makeEnv({ seed: 5 });
  h.step(20);
  h.grab();
  h.step(40);
  const checker = new MotionChecker();
  for (let i = 0; i < 5; i++) {
    h.step(1);
    checker.check(h.crow, h.world, DT);
  }
  h.release();
  let jumped = false;
  for (let i = 0; i < 10; i++) {
    h.crow.step(DT);
    let view = h.crow;
    if (!jumped && h.crow.state === 'fly') {
      jumped = true;
      view = Object.create(h.crow);
      view.pose = clonePose(h.crow.pose);
      view.pose.x += 60 * h.k;
    }
    checker.check(view, h.world, DT);
  }
  assert.ok(has({ counts: checker.counts, violations: checker.violations }, 'pop', /when let go|jumped/), JSON.stringify(checker.counts));
});

test('transition: illegal state change, and leaving sleep without waking', () => {
  const add = (tr) => (v) => {
    v.transitions = v.transitions.concat([Object.assign({ t: v.time, reason: null, fromPhase: null }, tr)]);
    v.transitionCount = v.transitionCount + 1;
  };
  const a = inject({ state: 'idle', when: once(bothPlanted), mutate: add({ from: 'fly', to: 'eat' }) });
  assert.ok(has(a, 'transition', /illegal transition fly->eat/), JSON.stringify(a.counts));
  const b = inject({ state: 'idle', when: once(bothPlanted), mutate: add({ from: 'sleep', to: 'idle', fromPhase: 'doze' }) });
  assert.ok(has(b, 'transition', /left sleep before waking/), JSON.stringify(b.counts));
  const c = inject({ state: 'idle', when: once(bothPlanted), mutate: add({ from: 'held', to: 'idle' }) });
  assert.ok(has(c, 'transition', /illegal transition held->idle/), JSON.stringify(c.counts));
});

test('the transition log is trimmed without losing a check', () => {
  const h = makeEnv({ seed: 3 });
  const checker = new MotionChecker();
  h.step(5);
  checker.check(h.crow, h.world, DT);
  while (h.crow.transitions.length < 400) {
    h.crow.transitions.push({ t: 0, from: 'idle', to: 'idle', fromPhase: null, reason: null });
    h.crow.transitionCount++;
  }
  checker.check(h.crow, h.world, DT);
  assert.deepEqual(checker.counts, {});
  h.crow.enter('away', {});
  assert.ok(h.crow.transitions.length < 400);
  checker.check(h.crow, h.world, DT);
  assert.ok(has({ counts: checker.counts, violations: checker.violations }, 'transition', /illegal transition idle->away/), JSON.stringify(checker.counts));
});

test('the camera constants the checks rely on', () => {
  assert.ok(CAM.F > 0.5 && CAM.F < 0.7 && CAM.H > 0.7 && CAM.H < 0.9);
});
