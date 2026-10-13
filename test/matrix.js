'use strict';

const { makeEnv } = require('./helpers');
const { request } = require('./scenarios');
const { ANIM_STATES } = require('../src/core/crow');

const OFFSETS = [0.0, 0.07, 0.16, 0.29, 0.45, 0.7];

function runPair(a, b, offset, seed, layout, envOpts) {
  const h = makeEnv(Object.assign({ seed, displays: layout }, envOpts || {}));
  h.step(20);
  const inA = request(h, a);
  const reachedA = h.runUntil(inA, 8);
  h.step(Math.round(offset * 60));
  if (h.drag) h.release();
  const before = h.crow.queue.length;
  const inB = request(h, b);
  if (b === 'reactClick' || b === 'reactSpawn') {
    const act = h.crow.queue.pop();
    h.crow.queue.length = before;
    h.crow.interrupt(act);
  }
  const reachedB = h.runUntil(inB, 14);
  if (b === 'held') {
    h.step(40);
    h.release();
  }
  h.settle(14);
  return { h, reachedA, reachedB, summary: h.checker.summary() };
}

function runMatrix(opts = {}) {
  const states = opts.states || ANIM_STATES;
  const offsets = opts.offsets || OFFSETS;
  const seeds = opts.seeds || [11];
  const results = [];
  for (const a of states) {
    for (const b of states) {
      for (const off of offsets) {
        for (const seed of seeds) {
          const r = runPair(a, b, off, seed, opts.layout, opts.env);
          results.push({ a, b, off, seed, reachedA: r.reachedA, reachedB: r.reachedB, transitions: r.h.checker.stats.transitions, ...r.summary });
        }
      }
    }
  }
  return results;
}

if (require.main === module) {
  const t0 = Date.now();
  const only = process.env.STATES ? process.env.STATES.split(',') : null;
  const res = runMatrix({ seeds: [11, 12], states: only || undefined });
  const bad = res.filter((r) => !r.ok || !r.reachedA || !r.reachedB);
  let frames = 0;
  for (const r of res) frames += r.frames;
  console.log(`runs=${res.length} frames=${frames} failing=${bad.length} time=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const byKind = {};
  for (const r of bad) {
    for (const [k, v] of Object.entries(r.counts)) byKind[k] = (byKind[k] || 0) + v;
    if (!r.reachedA) byKind.unreachedA = (byKind.unreachedA || 0) + 1;
    if (!r.reachedB) byKind.unreachedB = (byKind.unreachedB || 0) + 1;
  }
  console.log('violations by kind:', byKind);
  const hist = {};
  for (const r of bad) {
    for (const v of r.first) {
      const key = `${v.kind}: ${v.msg.replace(/-?[\d.]+(e-?\d+)?/g, '#')}`;
      hist[key] = hist[key] || { n: 0, ex: `${r.a}->${r.b} off=${r.off} seed=${r.seed} frame=${v.frame}` };
      hist[key].n++;
    }
    if (!r.reachedA || !r.reachedB) {
      const key = `unreached ${!r.reachedA ? 'A' : 'B'}`;
      hist[key] = hist[key] || { n: 0, ex: `${r.a}->${r.b} off=${r.off} seed=${r.seed}` };
      hist[key].n++;
    }
  }
  const top = Object.entries(hist).sort((a, b) => b[1].n - a[1].n).slice(0, 40);
  for (const [k, v] of top) console.log(String(v.n).padStart(5), k, ' e.g.', v.ex);
  process.exit(bad.length ? 1 : 0);
}

module.exports = { runPair, runMatrix, OFFSETS };
