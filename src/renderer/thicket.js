'use strict';

const { createRng } = require('../core/rng');

const NS = 'http://www.w3.org/2000/svg';
const r2 = (n) => Math.round(n * 100) / 100;

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

function stops(grad, list) {
  for (const [offset, color, opacity] of list) el('stop', { offset, 'stop-color': color, 'stop-opacity': opacity == null ? 1 : opacity }, grad);
  return grad;
}

let defsReady = false;

function ensureDefs() {
  if (defsReady) return;
  defsReady = true;
  const svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' });
  const d = el('defs', null, svg);
  stops(el('radialGradient', { id: 'dc-petal-a', cx: '50%', cy: '100%', r: '105%' }, d), [['0%', '#4a0716'], ['48%', '#9c1536'], ['100%', '#e5486a']]);
  stops(el('radialGradient', { id: 'dc-petal-b', cx: '50%', cy: '100%', r: '105%' }, d), [['0%', '#5c0a1d'], ['55%', '#bd1d45'], ['100%', '#f2708c']]);
  stops(el('radialGradient', { id: 'dc-petal-c', cx: '50%', cy: '100%', r: '110%' }, d), [['0%', '#6d0c23'], ['60%', '#d12a52'], ['100%', '#ff8da3']]);
  stops(el('radialGradient', { id: 'dc-heart', cx: '45%', cy: '40%', r: '65%' }, d), [['0%', '#b81c42'], ['100%', '#3c0513']]);
  stops(el('linearGradient', { id: 'dc-bud', x1: '0', y1: '1', x2: '0.3', y2: '0' }, d), [['0%', '#5c0a1d'], ['60%', '#b3183f'], ['100%', '#ef5b7b']]);
  stops(el('linearGradient', { id: 'dc-leaf', x1: '0', y1: '1', x2: '0', y2: '0' }, d), [['0%', '#1d3a28'], ['100%', '#3f7a53']]);
  stops(el('linearGradient', { id: 'dc-leaf-2', x1: '0', y1: '1', x2: '0', y2: '0' }, d), [['0%', '#233b2f'], ['100%', '#4d7d5c']]);
  stops(el('linearGradient', { id: 'dc-sepal', x1: '0', y1: '1', x2: '0', y2: '0' }, d), [['0%', '#1f3d2a'], ['100%', '#46805a']]);
  stops(el('radialGradient', { id: 'dc-berry', cx: '35%', cy: '30%', r: '75%' }, d), [['0%', '#7c4d8c'], ['45%', '#2d1538'], ['100%', '#12070f']]);
  stops(el('radialGradient', { id: 'dc-berry-red', cx: '35%', cy: '30%', r: '75%' }, d), [['0%', '#f27a8f'], ['50%', '#a3213b'], ['100%', '#4a0b18']]);
  stops(el('linearGradient', { id: 'dc-sheen', x1: '0', y1: '0', x2: '1', y2: '1' }, d), [['0%', '#6d7dff'], ['50%', '#a07cff'], ['100%', '#53d3c0']]);
  document.body.appendChild(svg);
}

function bez(p, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

function track(segs) {
  const pts = [];
  for (const s of segs) for (let i = pts.length ? 1 : 0; i <= 60; i++) pts.push(bez(s, i / 60));
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  const d = segs.map((s, i) => `${i ? '' : `M${r2(s[0][0])} ${r2(s[0][1])}`}C${r2(s[1][0])} ${r2(s[1][1])} ${r2(s[2][0])} ${r2(s[2][1])} ${r2(s[3][0])} ${r2(s[3][1])}`).join('');
  function at(f) {
    const want = Math.max(0, Math.min(1, f)) * total;
    let i = 1;
    while (i < len.length - 1 && len[i] < want) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const seg = len[i] - len[i - 1] || 1;
    const t = (want - len[i - 1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  return { d, total, at };
}

function petalPath(L, w) {
  return `M0 0C${r2(-0.62 * w)} ${r2(-0.1 * L)} ${r2(-0.84 * w)} ${r2(-0.78 * L)} ${r2(-0.22 * w)} ${r2(-L)}Q0 ${r2(-1.08 * L)} ${r2(0.22 * w)} ${r2(-L)}C${r2(0.84 * w)} ${r2(-0.78 * L)} ${r2(0.62 * w)} ${r2(-0.1 * L)} 0 0Z`;
}

function spiralPath(R, turns = 1.7) {
  let d = '';
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const rr = R * (0.12 + 0.88 * t);
    d += `${i ? 'L' : 'M'}${r2(Math.cos(a) * rr)} ${r2(Math.sin(a) * rr)}`;
  }
  return d;
}

function drawRose(parent, r, open = 1, rng = null) {
  const g = el('g', { class: 'rose-head' }, parent);
  const jit = () => (rng ? rng.range(-7, 7) : 0);
  const outer = r * (0.66 + 0.34 * open);
  for (let i = 0; i < 5; i++) el('path', { d: petalPath(outer, outer * 0.98), fill: 'url(#dc-petal-a)', transform: `rotate(${r2(i * 72 + jit())})` }, g);
  const mid = r * (0.66 + 0.08 * open);
  for (let i = 0; i < 5; i++) el('path', { d: petalPath(mid, mid * 0.9), fill: 'url(#dc-petal-b)', transform: `rotate(${r2(36 + i * 72 + jit())})` }, g);
  const inner = r * 0.46;
  for (let i = 0; i < 4; i++) el('path', { d: petalPath(inner, inner * 0.95), fill: 'url(#dc-petal-c)', transform: `rotate(${r2(18 + i * 90 + jit())})` }, g);
  el('circle', { r: r2(r * 0.27), fill: 'url(#dc-heart)' }, g);
  el('path', { d: spiralPath(r * 0.25), fill: 'none', stroke: '#ff7d98', 'stroke-width': r2(Math.max(0.55, r * 0.05)), 'stroke-linecap': 'round', opacity: 0.8 }, g);
  el('path', { d: `M${r2(-r * 0.5)} ${r2(-r * 0.42)}Q${r2(-r * 0.2)} ${r2(-r * 0.7)} ${r2(r * 0.18)} ${r2(-r * 0.6)}`, fill: 'none', stroke: '#ffc2cf', 'stroke-width': r2(Math.max(0.5, r * 0.045)), 'stroke-linecap': 'round', opacity: 0.35 }, g);
  return g;
}

function drawBud(parent, r) {
  const g = el('g', { class: 'rose-head' }, parent);
  el('path', { d: `M0 0C${r2(-0.62 * r)} ${r2(-0.12 * r)} ${r2(-0.56 * r)} ${r2(-0.86 * r)} 0 ${r2(-1.36 * r)}C${r2(0.56 * r)} ${r2(-0.86 * r)} ${r2(0.62 * r)} ${r2(-0.12 * r)} 0 0Z`, fill: 'url(#dc-bud)' }, g);
  el('path', { d: `M${r2(-0.42 * r)} ${r2(-0.35 * r)}C${r2(-0.3 * r)} ${r2(-0.95 * r)} ${r2(0.1 * r)} ${r2(-1.2 * r)} ${r2(0.22 * r)} ${r2(-1.22 * r)}`, fill: 'none', stroke: '#ff9db2', 'stroke-width': r2(Math.max(0.5, r * 0.07)), 'stroke-linecap': 'round', opacity: 0.55 }, g);
  for (const [a, len] of [[-38, 0.95], [38, 0.95], [0, 0.7]]) {
    el('path', { d: `M0 ${r2(0.08 * r)}Q${r2(-0.26 * r)} ${r2(-0.45 * r * len)} 0 ${r2(-0.95 * r * len)}Q${r2(0.26 * r)} ${r2(-0.45 * r * len)} 0 ${r2(0.08 * r)}Z`, fill: 'url(#dc-sepal)', transform: `rotate(${a})` }, g);
  }
  return g;
}

function drawLeaflet(parent, L, w, fill = 'url(#dc-leaf)') {
  el('path', { d: `M0 0C${r2(-w * 0.62)} ${r2(-L * 0.22)} ${r2(-w * 0.5)} ${r2(-L * 0.78)} 0 ${r2(-L)}C${r2(w * 0.5)} ${r2(-L * 0.78)} ${r2(w * 0.62)} ${r2(-L * 0.22)} 0 0Z`, fill }, parent);
  el('path', { d: `M0 ${r2(-L * 0.08)}L0 ${r2(-L * 0.86)}`, stroke: '#16301f', 'stroke-width': r2(Math.max(0.45, w * 0.08)), 'stroke-linecap': 'round', opacity: 0.8 }, parent);
}

function drawLeaf(parent, size, fill) {
  const g = el('g', { class: 'leaf-body' }, parent);
  el('path', { d: `M0 0L0 ${r2(-size * 0.42)}`, stroke: '#3a4a36', 'stroke-width': r2(Math.max(0.6, size * 0.07)), 'stroke-linecap': 'round' }, g);
  const tip = el('g', { transform: `translate(0 ${r2(-size * 0.4)})` }, g);
  drawLeaflet(el('g', { transform: 'rotate(-48)' }, tip), size * 0.72, size * 0.36, fill);
  drawLeaflet(el('g', { transform: 'rotate(48)' }, tip), size * 0.72, size * 0.36, fill);
  drawLeaflet(tip, size, size * 0.46, fill);
  return g;
}

function drawBerries(parent, r, ripe = true, rng = null) {
  const g = el('g', { class: 'berry-body' }, parent);
  el('path', { d: `M0 0L0 ${r2(r * 1.2)}`, stroke: '#3a4a36', 'stroke-width': r2(Math.max(0.6, r * 0.22)), 'stroke-linecap': 'round' }, g);
  const cells = [[0, 0], [-1, 0], [1, 0], [-0.5, 0.86], [0.5, 0.86], [-0.5, -0.86], [0.5, -0.86], [0, 1.72], [-1, 1.72], [1, 1.72], [0, -1.6]];
  const c = el('g', { transform: `translate(0 ${r2(r * 2.6)})` }, g);
  for (const [cx, cy] of cells) {
    const mix = rng ? rng.next() : 0.5;
    el('circle', { cx: r2(cx * r * 0.92), cy: r2(cy * r * 0.9), r: r2(r * (0.52 + 0.08 * mix)), fill: ripe || mix > 0.62 ? 'url(#dc-berry)' : 'url(#dc-berry-red)' }, c);
  }
  return g;
}

function thornPath(size, side) {
  const s = side;
  return `M${r2(-size * 0.55)} 0L${r2(-size * 1.05)} ${r2(-size * 1.05 * s)}L${r2(size * 0.55)} 0Z`;
}

function place(parent, x, y, deg, cls, delay, extra) {
  const outer = el('g', { transform: `translate(${r2(x)} ${r2(y)}) rotate(${r2(deg)})` }, parent);
  const inner = el('g', { class: cls, style: `--d:${r2(delay)}s${extra ? `;${extra}` : ''}` }, outer);
  return inner;
}

const HERO_CANES = [
  { segs: [[[404, 14], [352, -6], [300, 34], [248, 22]], [[248, 22], [214, 14], [190, 40], [158, 30]], [[158, 30], [140, 25], [128, 12], [118, 18]]], width: 2.4, color: '#4f3d49', delay: 0.05, dur: 1.9 },
  { segs: [[[396, -6], [378, 34], [344, 70], [356, 112]], [[356, 112], [364, 140], [348, 160], [332, 196]]], width: 2.1, color: '#4a3d45', delay: 0.3, dur: 1.6 },
  { segs: [[[404, 72], [372, 62], [338, 58], [308, 78]]], width: 1.6, color: '#48463f', delay: 0.75, dur: 1 },
  { segs: [[[300, 34], [290, 50], [270, 58], [254, 56]]], width: 1.2, color: '#4a4540', delay: 1.1, dur: 0.8 },
];

const HERO_FEATURES = [
  { cane: 0, at: 0.2, kind: 'rose', r: 17, open: 1 },
  { cane: 0, at: 0.63, kind: 'bud', r: 7.5, side: -1 },
  { cane: 1, at: 0.43, kind: 'rose', r: 14, open: 0.85 },
  { cane: 2, at: 1, kind: 'rose', r: 10.5, open: 0.6 },
  { cane: 3, at: 1, kind: 'bud', r: 6, side: 1, tilt: -60 },
  { cane: 0, at: 0.42, kind: 'berries', r: 2.3, ripe: true, side: 1 },
  { cane: 1, at: 0.72, kind: 'berries', r: 2.1, ripe: false, side: -1 },
  { cane: 0, at: 0.86, kind: 'berries', r: 1.9, ripe: true, side: 1 },
];

function createThicket(host, opts = {}) {
  ensureDefs();
  const rng = createRng(opts.seed || 29);
  const svg = el('svg', { class: 'thicket', viewBox: '0 0 400 180', preserveAspectRatio: 'xMaxYMin meet', 'aria-hidden': 'true' }, host);
  const back = el('g', { class: 'layer-back' }, svg);
  const stems = el('g', { class: 'layer-stems' }, svg);
  const front = el('g', { class: 'layer-front' }, svg);
  const tracks = HERO_CANES.map((c) => track(c.segs));
  HERO_CANES.forEach((c, ci) => {
    const t = tracks[ci];
    el('path', { d: t.d, class: 'stem', pathLength: 1, fill: 'none', stroke: c.color, 'stroke-width': c.width, 'stroke-linecap': 'round', style: `--d:${c.delay}s;--dur:${c.dur}s` }, stems);
    const when = (f) => c.delay + f * c.dur;
    const step = 8 + c.width * 1.5;
    let side = 1;
    for (let s = 6; s < t.total - 4; s += step + rng.range(-2, 2.5)) {
      const f = s / t.total;
      const p = t.at(f);
      side = -side;
      const g = place(stems, p.x, p.y, (p.ang * 180) / Math.PI, 'thorn', when(f) + 0.05);
      el('path', { d: thornPath(1.6 + c.width * 0.75, side), fill: '#6b4f5d' }, g);
    }
    let leafSide = ci % 2 ? 1 : -1;
    for (let s = 22 + rng.range(0, 10); s < t.total - 16; s += 30 + rng.range(-4, 10)) {
      const f = s / t.total;
      const p = t.at(f);
      leafSide = -leafSide;
      const deg = (p.ang * 180) / Math.PI + leafSide * 58 + rng.range(-14, 14) + 90;
      const g = place(back, p.x, p.y, deg, 'leaf', when(f) + 0.15, `--sway:${r2(rng.range(3, 6))}deg;--sd:${r2(rng.range(0, 3))}s`);
      drawLeaf(g, 12 + c.width * 2.4 + rng.range(-2, 3), rng.next() < 0.5 ? 'url(#dc-leaf)' : 'url(#dc-leaf-2)');
    }
  });
  for (const feat of HERO_FEATURES) {
    const c = HERO_CANES[feat.cane];
    const t = tracks[feat.cane];
    const p = t.at(feat.at);
    const delay = c.delay + feat.at * c.dur + 0.25;
    if (feat.kind === 'rose') {
      const g = place(front, p.x, p.y, rng.range(-20, 20), 'bloom', delay, `--sway:${r2(rng.range(2, 4))}deg;--sd:${r2(rng.range(0, 2))}s`);
      drawRose(el('g', { class: 'sway' }, g), feat.r, feat.open, rng);
    } else if (feat.kind === 'bud') {
      const deg = (p.ang * 180) / Math.PI + (feat.tilt != null ? feat.tilt : 90 * feat.side) + 90;
      const g = place(front, p.x, p.y, deg, 'bloom', delay, `--sway:${r2(rng.range(3, 6))}deg;--sd:${r2(rng.range(0, 2))}s`);
      drawBud(el('g', { class: 'sway' }, g), feat.r);
    } else if (feat.kind === 'berries') {
      const g = place(back, p.x, p.y, rng.range(-12, 12), 'berries', delay, `--sway:${r2(rng.range(2, 5))}deg;--sd:${r2(rng.range(0, 3))}s`);
      drawBerries(el('g', { class: 'sway' }, g), feat.r, feat.ripe, rng);
    }
  }
  return svg;
}

function stageIcon(stage, size = 40) {
  ensureDefs();
  const svg = el('svg', { class: 'stage-icon', viewBox: '-20 -20 40 40', width: size, height: size, 'aria-hidden': 'true' });
  const rng = createRng(11 + stage);
  if (stage === 0) {
    const t = track([[[-13, 14], [-6, 4], [2, -2], [13, -12]]]);
    el('path', { d: t.d, fill: 'none', stroke: '#6a5463', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, svg);
    let side = 1;
    for (let f = 0.12; f < 0.95; f += 0.16) {
      const p = t.at(f);
      side = -side;
      const g = el('g', { transform: `translate(${r2(p.x)} ${r2(p.y)}) rotate(${r2((p.ang * 180) / Math.PI)})` }, svg);
      el('path', { d: thornPath(3, side), fill: '#8a6a7c' }, g);
    }
    const p = t.at(0.55);
    drawLeaf(el('g', { transform: `translate(${r2(p.x)} ${r2(p.y)}) rotate(-60)` }, svg), 13, 'url(#dc-leaf-2)');
  } else if (stage === 1) {
    el('path', { d: 'M0 15C0 8 -1 2 1 -4', fill: 'none', stroke: '#4c7a57', 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
    drawLeaflet(el('g', { transform: 'translate(0.4 3) rotate(-58)' }, svg), 13, 7, 'url(#dc-leaf)');
    drawLeaflet(el('g', { transform: 'translate(0.8 -1) rotate(52)' }, svg), 11, 6, 'url(#dc-leaf-2)');
    el('circle', { cx: 1, cy: -5, r: 2.4, fill: '#4c7a57' }, svg);
  } else if (stage === 2) {
    el('path', { d: 'M0 17C0 10 1 6 0 2', fill: 'none', stroke: '#4c7a57', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, svg);
    drawLeaflet(el('g', { transform: 'translate(0 11) rotate(-62)' }, svg), 10, 5.5, 'url(#dc-leaf)');
    drawBud(el('g', { transform: 'translate(0 3)' }, svg), 10.5);
  } else {
    const open = stage === 3 ? 0.55 : 1;
    const r = stage === 3 ? 13.5 : 16.5;
    drawRose(el('g', { transform: 'rotate(8)' }, svg), r, open, rng);
  }
  return svg;
}

function roseEmblem(size = 56) {
  ensureDefs();
  const svg = el('svg', { class: 'emblem', viewBox: '-30 -30 60 60', width: size, height: size, 'aria-hidden': 'true' });
  const rng = createRng(5);
  drawLeaf(el('g', { transform: 'translate(-6 10) rotate(-128)' }, svg), 20, 'url(#dc-leaf)');
  drawLeaf(el('g', { transform: 'translate(7 9) rotate(122)' }, svg), 17, 'url(#dc-leaf-2)');
  drawRose(el('g', { transform: 'translate(0 -2) rotate(-6)' }, svg), 19, 1, rng);
  return svg;
}

function sheenGradientId() {
  ensureDefs();
  return 'dc-sheen';
}

module.exports = { createThicket, stageIcon, roseEmblem, sheenGradientId, drawRose, drawBud };
