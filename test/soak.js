'use strict';

const { Game } = require('../src/core/game');
const { normalizeSave } = require('../src/core/save-schema');
const { MotionChecker } = require('../src/core/qa');
const { createRng } = require('../src/core/rng');
const { computeRig, toWorld } = require('../src/core/rig');
const { LAYOUTS } = require('./helpers');

const DT = 1 / 60;

function randomWindows(rng, displays, n) {
  const wins = [];
  for (let i = 0; i < n; i++) {
    const d = rng.pick(displays);
    const wa = d.workArea;
    const w = rng.range(260, Math.min(1100, wa.width - 20));
    const h = rng.range(160, Math.min(800, wa.height - 40));
    wins.push({ id: `w${i}`, x: Math.round(rng.range(wa.x - 60, wa.x + wa.width - w + 60)), y: Math.round(rng.range(wa.y, wa.y + wa.height - h)), width: Math.round(w), height: Math.round(h) });
  }
  return wins;
}

function runSoak(opts = {}) {
  const seconds = opts.seconds || 600;
  const seed = opts.seed == null ? 99 : opts.seed;
  let displays = opts.displays || LAYOUTS.single;
  const rng = createRng(seed * 7 + 3);
  let clock = Date.UTC(2026, 8, 26, 9, 0, 0);
  const save = normalizeSave({ version: 3, affection: { value: opts.affection == null ? 520 : opts.affection }, settings: { spawnRate: 'frequent', activity: 'lively', scale: opts.scale || 1 } }, clock);
  save.crow.setupComplete = true;
  const game = new Game({ save, seed, now: () => clock });
  game.init(displays);
  const sim = game.sim;
  const checker = new MotionChecker();
  let windows = opts.windows === false ? [] : randomWindows(rng, displays, 4);
  sim.setWindows(windows);
  const cur = { x: 400, y: 400 };
  let target = { x: 600, y: 500 };
  let speed = 12;
  const counts = { clicks: 0, grabs: 0, carriedS: 0, drags: 0, handFed: 0, feeds: 0, hides: 0, shows: 0, pauses: 0, windowMoves: 0, displayChanges: 0, gifts: 0, collected: 0, notifications: 0, errors: 0 };
  const stateTime = {};
  let longest = { state: null, t: 0 };
  let curState = null;
  let curStateT = 0;
  const frames = Math.round(seconds / DT);
  let hiddenT = 0;
  let pressT = -1;
  const union = () => sim.world.union();
  for (let f = 0; f < frames; f++) {
    clock += DT * 1000;
    const c = sim.crow;
    if (rng.chance(0.01) && !sim.drag) {
      const u = union();
      const r = rng.next();
      if (r < 0.3 && c && c.visible) {
        const rig = computeRig(c.pose);
        const b = toWorld(c.pose, rig.body.cx, rig.body.cy);
        target = { x: b[0] + rng.range(-6, 6), y: b[1] + rng.range(-5, 5) };
      } else if (r < 0.5 && c) target = { x: c.x + rng.range(-120, 120), y: c.y - rng.range(0, 90) };
      else target = { x: rng.range(u.x - 100, u.x + u.width + 100), y: rng.range(u.y, u.y + u.height) };
      speed = rng.chance(0.2) ? 60 : 12;
    }
    cur.x += (target.x - cur.x) * Math.min(1, DT * speed);
    cur.y += (target.y - cur.y) * Math.min(1, DT * speed);
    const d = sim.world.displayAt(cur.x, cur.y) || sim.world.nearestDisplay(cur.x, cur.y);
    if (d) {
      cur.x = Math.min(d.bounds.x + d.bounds.width - 1, Math.max(d.bounds.x, cur.x));
      cur.y = Math.min(d.bounds.y + d.bounds.height - 1, Math.max(d.bounds.y, cur.y));
    }
    sim.setCursor(cur.x, cur.y, DT);
    if (!sim.pointerBusy && rng.chance(0.005)) {
      const hit = sim.hitAt(cur.x, cur.y);
      if (hit) {
        const kind = sim.pointerDown(cur.x, cur.y, rng.chance(0.1) ? 2 : 0);
        if (kind === 'crow' && sim.press) {
          if (rng.chance(0.55)) {
            sim.pointerUp(cur.x, cur.y);
            counts.clicks++;
          } else {
            counts.grabs++;
            pressT = rng.range(0.4, 4);
            const u = union();
            target = { x: rng.range(u.x, u.x + u.width), y: rng.range(u.y, u.y + u.height) };
            speed = rng.chance(0.3) ? 30 : 4;
          }
        } else if (kind === 'item') {
          counts.drags++;
          if (rng.chance(0.5) && c) {
            const rig = computeRig(c.pose);
            const hp = toWorld(c.pose, rig.head.x, rig.head.y);
            target = { x: hp[0], y: hp[1] };
          }
        }
      }
    }
    if (pressT >= 0) {
      pressT -= DT;
      if (sim.drag && sim.drag.kind === 'crow') counts.carriedS += DT;
      if (pressT < 0) sim.pointerUp(cur.x, cur.y);
    }
    if (sim.drag && sim.drag.kind === 'item' && rng.chance(0.02)) sim.pointerUp(cur.x, cur.y);
    if (rng.chance(0.0008) && game.feed()) counts.feeds++;
    if (rng.chance(0.0002) && !game.save.app.hidden) {
      game.hide();
      counts.hides++;
    }
    if (game.save.app.hidden) {
      hiddenT += DT;
      if (hiddenT > 8 && rng.chance(0.01)) {
        game.show();
        counts.shows++;
        hiddenT = 0;
      }
    }
    if (rng.chance(0.0002)) {
      game.setPaused(!game.save.app.paused);
      counts.pauses++;
    }
    if (game.save.app.paused && rng.chance(0.003)) game.setPaused(false);
    if (opts.windows !== false && rng.chance(0.004)) {
      const i = rng.int(0, windows.length - 1);
      if (windows.length && rng.chance(0.6)) {
        const w = Object.assign({}, windows[i]);
        const big = rng.chance(0.3);
        w.x += Math.round(rng.range(-1, 1) * (big ? 300 : 25));
        w.y += Math.round(rng.range(-1, 1) * (big ? 200 : 15));
        windows = windows.slice();
        windows[i] = w;
      } else if (rng.chance(0.5) && windows.length > 1) {
        windows = windows.filter((_, j) => j !== i);
      } else {
        windows = windows.concat(randomWindows(rng, displays, 1).map((w) => Object.assign(w, { id: `w${f}` })));
        windows = [windows[windows.length - 1]].concat(windows.slice(0, -1));
      }
      sim.setWindows(windows);
      counts.windowMoves++;
    }
    if (opts.displayChanges && rng.chance(0.0003)) {
      const alt = opts.displayChanges[rng.int(0, opts.displayChanges.length - 1)];
      displays = alt;
      sim.setDisplays(displays);
      counts.displayChanges++;
    }
    try {
      game.step(DT);
    } catch (e) {
      counts.errors++;
      if (counts.errors < 3) console.error(e);
      throw e;
    }
    for (const e of game.drain()) {
      if (e.type === 'notify') counts.notifications++;
      if (e.type === 'giftIncoming') counts.gifts++;
      if (e.type === 'giftCollected') counts.collected++;
      if (e.type === 'diag' && e.what === 'balanceStep') counts.balanceSteps = (counts.balanceSteps || 0) + 1;
    }
    if (rng.chance(0.003) && !sim.pointerBusy) {
      for (const it of sim.items.values()) {
        if (it.gift && it.collect === 0 && it.state === 'resting') {
          sim.pointerDown(it.x, it.y - 3, 0);
          break;
        }
      }
    }
    checker.check(sim.crow, sim.world, DT);
    const st = sim.crow.state;
    stateTime[st] = (stateTime[st] || 0) + DT;
    if (st === curState) curStateT += DT;
    else {
      curState = st;
      curStateT = 0;
    }
    const exempt = st === 'away' || st === 'sleep' || st === 'held' || (st === 'perch' && game.save.app.paused);
    if (!exempt && curStateT > longest.t) longest = { state: st, t: curStateT };
  }
  counts.handFed = game.save.stats.handFed;
  return { summary: checker.summary(), violationsAll: checker.violations, stats: checker.stats, counts, stateTime, longest, save: game.save, game };
}

if (require.main === module) {
  const arg = process.argv[2] || 'all';
  const layouts = arg === 'all' ? Object.keys(LAYOUTS) : [arg];
  if (layouts.some((n) => !LAYOUTS[n])) throw new Error(`unknown layout; use one of: all, ${Object.keys(LAYOUTS).join(', ')}`);
  const secs = +(process.argv[3] || 600);
  const seedArg = process.argv[4] || '5';
  const [s0, s1] = seedArg.includes('-') ? seedArg.split('-').map(Number) : [+seedArg, +seedArg];
  let fail = 0;
  for (let seed = s0; seed <= s1; seed++)
    for (const name of layouts) {
      const t0 = Date.now();
      if (s1 > s0) process.stdout.write(`seed ${seed} `);
      const r = runSoak({ displays: LAYOUTS[name], seconds: secs, seed, displayChanges: name === 'dualEqual' ? [LAYOUTS.dualEqual, LAYOUTS.single, LAYOUTS.autoHide] : null });
      const st = Object.fromEntries(Object.entries(r.stateTime).map(([k, v]) => [k, Math.round(v)]));
      console.log(`${name.padEnd(17)} ok=${r.summary.ok} frames=${r.summary.frames} ${((Date.now() - t0) / 1000).toFixed(1)}s longest=${r.longest.state}:${r.longest.t.toFixed(0)}s`);
      console.log('   counts', JSON.stringify(r.counts));
      console.log('   states', JSON.stringify(st));
      console.log('   stats', JSON.stringify({ eaten: r.save.stats.itemsEaten, hand: r.save.stats.handFed, tray: r.save.stats.trayFed, gifts: r.save.stats.giftsReceived, aff: r.save.affection.value }));
      if (!r.summary.ok) {
        fail++;
        console.log('   violations', JSON.stringify(r.summary.counts));
        const seen = new Set();
        for (const v of r.violationsAll) {
          const key = v.kind + v.msg.replace(/-?[\d.]+/g, '#');
          if (seen.has(key)) continue;
          seen.add(key);
          console.log('     ', v.kind, '@', v.frame, v.msg);
          if (seen.size > 14) break;
        }
      }
    }
  process.exit(fail ? 1 : 0);
}

module.exports = { runSoak, randomWindows };
