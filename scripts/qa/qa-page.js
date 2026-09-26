'use strict';

const { makeEnv, LAYOUTS } = require('../../test/helpers');
const { request } = require('../../test/scenarios');
const { ANIM_STATES } = require('../../src/core/crow');
const { drawCrow, drawItem, LAYERS } = require('../../src/renderer/draw');
const { computeRig, toWorld, clonePose } = require('../../src/core/rig');
const { ITEM_TYPES } = require('../../src/core/items');
const { CAM } = require('../../src/core/dims');

const qa = window.qa;

function snapshot(h) {
  return {
    pose: clonePose(h.crow.pose),
    state: h.crow.state,
    phase: (h.crow.st && (h.crow.st.phase || (h.crow.st.hop && h.crow.st.hop.phase))) || '',
    items: [...h.items.values()].map((it) => Object.assign({}, it)),
    airborne: h.crow.airborne,
    perch: h.crow.perch(),
    cursor: h.drag && h.cursor ? Object.assign({}, h.cursor) : null,
  };
}

function record(name, seed = 5, opts = {}) {
  const h = makeEnv(Object.assign({ seed, displays: LAYOUTS.single }, opts));
  h.step(12);
  const frames = [];
  const reached = request(h, name);
  let started = false;
  let after = 0;
  for (let i = 0; i < 60 * 12; i++) {
    if (name === 'held' && started && h.drag && h.crow.stateTime > 1.6) h.release();
    h.step(1);
    if (!started && reached()) started = true;
    if (started) {
      frames.push(snapshot(h));
      if (h.crow.state === 'idle' && !h.crow.isBusy()) after++;
      if (after > 12) break;
    }
  }
  return { frames, violations: h.checker.summary() };
}

function recordPair(a, b, off, seed) {
  const h = makeEnv({ seed, displays: LAYOUTS.single });
  h.step(12);
  const inA = request(h, a);
  h.runUntil(inA, 8);
  h.step(Math.round(off * 60));
  if (h.drag) h.release();
  const frames = [];
  for (let i = 0; i < 6; i++) frames.push(snapshot(h));
  const before = h.crow.queue.length;
  const inB = request(h, b);
  if (b === 'reactClick' || b === 'reactSpawn') {
    const act = h.crow.queue.pop();
    h.crow.queue.length = before;
    h.crow.interrupt(act);
  }
  let reached = false;
  for (let i = 0; i < 60 * 8; i++) {
    if (b === 'held' && reached && h.drag && h.crow.stateTime > 1) h.release();
    h.step(1);
    frames.push(snapshot(h));
    if (inB()) reached = true;
    if (reached && h.crow.state !== b && !h.crow.airborne) break;
  }
  return { frames, violations: h.checker.summary() };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function drawFloor(ctx, cx, cy, w, h, opts) {
  ctx.fillStyle = opts.floor || '#dfe2e8';
  ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
  ctx.strokeStyle = opts.grid || 'rgba(60,70,90,0.13)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  const x0 = Math.floor((cx - w) / 20) * 20;
  const y0 = Math.floor((cy - h) / 20) * 20;
  for (let x = x0; x < cx + w; x += 20) {
    ctx.moveTo(x, cy - h);
    ctx.lineTo(x, cy + h);
  }
  for (let y = y0; y < cy + h; y += 20) {
    ctx.moveTo(cx - w, y);
    ctx.lineTo(cx + w, y);
  }
  ctx.stroke();
}

function drawPerch(ctx, p) {
  if (!p) return;
  ctx.save();
  ctx.fillStyle = p.kind === 'taskbar' ? 'rgba(30,34,44,0.9)' : 'rgba(250,251,253,0.95)';
  ctx.fillRect(p.x0, p.y, p.x1 - p.x0, 60);
  ctx.strokeStyle = 'rgba(40,50,70,0.8)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(p.x0, p.y);
  ctx.lineTo(p.x1, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawDebug(ctx, fr) {
  const p = fr.pose;
  const rig = computeRig(p);
  const w = (pt) => toWorld(p, pt[0], pt[1]);
  ctx.save();
  ctx.lineWidth = 0.5;
  for (const leg of rig.legs) {
    const a = w(leg.hip);
    const b = w(leg.knee);
    const c = w(leg.foot);
    ctx.strokeStyle = 'rgba(255,0,200,0.9)';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i];
    ctx.fillStyle = f.planted ? '#00d25b' : fr.airborne ? '#2f7bff' : '#ff9d00';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#ff2b2b';
  ctx.beginPath();
  ctx.moveTo(p.x - 3, p.y);
  ctx.lineTo(p.x + 3, p.y);
  ctx.moveTo(p.x, p.y - 3);
  ctx.lineTo(p.x, p.y + 3);
  if (p.z > 0) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - p.z * CAM.H);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,43,43,0.6)';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.h) * 14, p.y + Math.sin(p.h) * 14 * CAM.F);
  ctx.stroke();
  const bt = w(rig.beak.tip);
  ctx.fillStyle = '#ffe600';
  ctx.beginPath();
  ctx.arc(bt[0], bt[1], 1, 0, Math.PI * 2);
  ctx.fill();
  if (fr.cursor) {
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(fr.cursor.x, fr.cursor.y);
    ctx.lineTo(fr.cursor.x + 5, fr.cursor.y + 11);
    ctx.lineTo(fr.cursor.x + 1, fr.cursor.y + 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawScene(ctx, fr, time) {
  const list = fr.items.map((it) => ({ y: it.y, draw: () => drawItem(ctx, it, fr.pose.k, time) }));
  list.push({ y: fr.pose.y, draw: () => drawCrow(ctx, fr.pose) });
  list.sort((a, b) => a.y - b.y);
  for (const e of list) e.draw();
}

function sheet(title, frames, opts = {}) {
  const cols = opts.cols || 8;
  const every = opts.every || Math.max(1, Math.ceil(frames.length / (cols * (opts.rows || 6))));
  const picked = frames.filter((_, i) => i % every === 0).slice(0, cols * (opts.rows || 6));
  const zoom = opts.zoom || 2;
  const cw = (opts.cellW || 120) * zoom;
  const ch = (opts.cellH || 100) * zoom;
  const rows = Math.ceil(picked.length / cols);
  const head = 28;
  const c = makeCanvas(cols * cw, rows * ch + head);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9aa1ad';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 15px Segoe UI, sans-serif';
  ctx.fillText(`${title}  (${frames.length} frames @60fps, every ${every}${opts.debug ? ', debug overlay' : ''})`, 8, 19);
  const ref = frames[0].pose;
  picked.forEach((fr, n) => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    const ox = col * cw;
    const oy = head + row * ch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, cw, ch);
    ctx.clip();
    const p = opts.follow ? fr.pose : ref;
    const camX = p.x;
    const camY = p.y - (opts.follow ? p.z * CAM.H : 0) - 22;
    ctx.translate(ox + cw / 2, oy + ch / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    drawFloor(ctx, camX, camY, cw / zoom, ch / zoom, opts);
    drawPerch(ctx, fr.perch);
    drawScene(ctx, fr, 0.3 + n * 0.05);
    if (opts.debug) drawDebug(ctx, fr);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = '11px Consolas, monospace';
    ctx.fillText(`${frames.indexOf(fr)} ${fr.state}${fr.phase ? ':' + fr.phase : ''}`, ox + 4, oy + 13);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(ox + 0.5, oy + 0.5, cw - 1, ch - 1);
  });
  return c;
}

function hero() {
  const c = makeCanvas(1600, 760);
  const ctx = c.getContext('2d');
  const labels = ['idle', 'walk', 'perch', 'sleep', 'fly', 'eat', 'held', 'peck'];
  const poses = labels.map((name, i) => {
    const h = makeEnv({ seed: 9 + i, displays: LAYOUTS.single, h: (i * Math.PI) / 4 + 0.3 });
    h.step(12);
    const reached = request(h, name);
    h.runUntil(reached, 8);
    h.step(name === 'fly' ? 40 : name === 'sleep' ? 150 : name === 'perch' ? 60 : name === 'held' ? 50 : 14);
    return { label: name, fr: snapshot(h) };
  });
  for (const [bg, y0, fg] of [
    ['#eef0f3', 0, '#333'],
    ['#1b1e25', 380, '#ccd'],
  ]) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, y0, c.width, 380);
    poses.forEach((p, i) => {
      ctx.save();
      const zoom = 2.6;
      const pp = p.fr.pose;
      ctx.translate(100 + i * 200, y0 + 250);
      ctx.scale(zoom, zoom);
      ctx.translate(-pp.x, -(pp.y - pp.z * CAM.H));
      drawCrow(ctx, pp);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.font = '14px Segoe UI, sans-serif';
      ctx.fillText(p.label, 80 + i * 200, y0 + 360);
    });
  }
  return c;
}

function itemsSheet() {
  const types = Object.keys(ITEM_TYPES);
  const zoom = 4;
  const c = makeCanvas(types.length * 90 + 20, 150);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9ebef';
  ctx.fillRect(0, 0, c.width, 75);
  ctx.fillStyle = '#22262f';
  ctx.fillRect(0, 75, c.width, 75);
  types.forEach((t, i) => {
    for (const [y, dark] of [
      [60, false],
      [135, true],
    ]) {
      ctx.save();
      ctx.translate(55 + i * 90, y);
      ctx.scale(zoom / 2, zoom / 2);
      drawItem(ctx, { type: t, x: 0, y: 0, z: 0, gift: ITEM_TYPES[t].kind === 'gift' }, 1, 0.4 + i * 0.13);
      ctx.restore();
      ctx.fillStyle = dark ? '#ccd' : '#333';
      ctx.font = '10px Segoe UI, sans-serif';
      if (!dark) ctx.fillText(t, 30 + i * 90, 72);
    }
  });
  return c;
}

function footStrip(name, frames) {
  const zoom = 3;
  const xs = frames.map((f) => f.pose.x);
  const ys = frames.map((f) => f.pose.y);
  const x0 = Math.min(...xs) - 60;
  const x1 = Math.max(...xs) + 60;
  const y0 = Math.min(...ys) - 80;
  const y1 = Math.max(...ys) + 30;
  const w = Math.min(4000, (x1 - x0) * zoom);
  const hgt = Math.min(1600, (y1 - y0) * zoom + 30);
  const c = makeCanvas(w, hgt);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(0, 30);
  ctx.scale(zoom, zoom);
  ctx.translate(-x0, -y0);
  drawFloor(ctx, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + 10, (y1 - y0) / 2 + 10, {});
  frames.forEach((fr, i) => {
    if (i % 6) return;
    ctx.save();
    ctx.globalAlpha = 0.16;
    drawCrow(ctx, fr.pose);
    ctx.restore();
  });
  for (let fi = 0; fi < 2; fi++) {
    ctx.beginPath();
    frames.forEach((fr, i) => {
      const f = fr.pose.feet[fi];
      if (i === 0) ctx.moveTo(f.x, f.y);
      else ctx.lineTo(f.x, f.y);
    });
    ctx.strokeStyle = fi === 0 ? 'rgba(255,120,0,0.9)' : 'rgba(170,60,220,0.9)';
    ctx.lineWidth = 0.35;
    ctx.stroke();
    frames.forEach((fr) => {
      const f = fr.pose.feet[fi];
      if (!f.planted) return;
      ctx.fillStyle = '#00b050';
      ctx.fillRect(f.x - 0.4, f.y - 0.4, 0.8, 0.8);
    });
  }
  drawCrow(ctx, frames[frames.length - 1].pose);
  ctx.restore();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 14px Segoe UI, sans-serif';
  ctx.fillText(`${name}: onion skin every 6 frames; foot paths (orange=left, purple=right), green = planted samples`, 8, 18);
  return c;
}

async function save(name, canvas) {
  await qa.save(name, canvas.toDataURL('image/png'));
}

async function main() {
  const only = (window.location.hash || '').slice(1);
  const report = { states: {}, layers: LAYERS };
  if (!only) {
    await save('hero.png', hero());
    await save('items.png', itemsSheet());
  }
  for (const name of ANIM_STATES) {
    if (only && only !== name) continue;
    const r = record(name);
    report.states[name] = { frames: r.frames.length, violations: r.violations };
    const follow = ['fly', 'land', 'walk', 'hop', 'giftDrop', 'held'].includes(name);
    await save(`state-${name}.png`, sheet(name, r.frames, { follow, cols: 8, rows: 6 }));
    await save(`state-${name}-debug.png`, sheet(`${name}`, r.frames, { follow, cols: 8, rows: 6, debug: true, floor: '#cfd3db', zoom: 2 }));
  }
  if (!only) {
    const walk = record('walk');
    await save('feet-walk.png', footStrip('walk', walk.frames));
    const hop = record('hop');
    await save('feet-hop.png', footStrip('hop', hop.frames));
    const fly = record('fly');
    await save('feet-fly-landing.png', footStrip('fly/land', fly.frames.slice(-90)));
    const pairs = [
      ['walk', 'reactClick', 0.29],
      ['sleep', 'reactClick', 0.45],
      ['fly', 'eat', 0.45],
      ['hop', 'fly', 0.07],
      ['eat', 'reactSpawn', 0.29],
      ['walk', 'held', 0.29],
      ['held', 'eat', 0.7],
    ];
    report.pairs = {};
    for (const [a, b, off] of pairs) {
      const r = recordPair(a, b, off, 21);
      report.pairs[`${a}->${b}@${off}`] = r.violations;
      await save(`pair-${a}-${b}.png`, sheet(`${a} -> ${b} (requested ${off}s into ${a})`, r.frames, { follow: true, cols: 10, rows: 5, debug: true, floor: '#cfd3db', zoom: 2, every: 2 }));
    }
  }
  await qa.save('report.json', 'data:application/json,' + encodeURIComponent(JSON.stringify(report, null, 2)));
  qa.done();
}

main().catch((e) => {
  qa.log(String((e && e.stack) || e));
  qa.done(1);
});
