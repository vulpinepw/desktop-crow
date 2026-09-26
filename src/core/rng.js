'use strict';

function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;

  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng = {
    next,
    range(lo, hi) {
      return lo + (hi - lo) * next();
    },
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
    weighted(entries, weightOf) {
      let total = 0;
      for (const e of entries) total += Math.max(0, weightOf(e));
      if (total <= 0) return null;
      let r = next() * total;
      for (const e of entries) {
        r -= Math.max(0, weightOf(e));
        if (r < 0) return e;
      }
      return entries[entries.length - 1];
    },
    fork() {
      return createRng(Math.floor(next() * 4294967296));
    },
    getState() {
      return a >>> 0;
    },
    setState(s) {
      a = s | 0;
    },
  };
  return rng;
}

module.exports = { createRng };
