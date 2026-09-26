'use strict';

const { defaultPose, computeRig, worldBounds, toWorld } = require('../core/rig');
const { ITEM_TYPES } = require('../core/items');
const { CAM } = require('../core/dims');
const { drawCrow, drawItem, drawHeart, drawBox, boxBounds, drawMoodBubble, layoutMoodBubble } = require('./draw');
const { createAudio } = require('./audio');
const { createFx } = require('./fx');

const api = window.crowOverlay;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: true, desynchronized: false });

const DELAY = 40;
const STEP = 64;
const MIN_FRAME_MS = { fast: 1000 / 80, medium: 1000 / 32, slow: 1000 / 16 };
const state = {
  bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  dpr: window.devicePixelRatio || 1,
  snaps: [],
  offsets: [],
  offset: null,
  active: false,
  settings: { sound: true, volume: 0.5 },
  rafId: 0,
  timer: 0,
  frames: 0,
  lastDraw: 0,
  pace: 'fast',
  view: { x: 0, y: 0, w: 0, h: 0, shown: false, roomy: 0, dpr: 0 },
};
const audio = createAudio();
const fx = createFx();

function resize() {
  state.dpr = window.devicePixelRatio || 1;
}
window.addEventListener('resize', resize);
resize();

api.onInit((d) => {
  state.bounds = d.bounds;
  if (d.settings) Object.assign(state.settings, d.settings);
  resize();
  api.ready();
});
api.onSettings((s) => Object.assign(state.settings, s));
api.onFrame((snap) => {
  const now = performance.now();
  state.lastSnapAt = now;
  state.offsets.push({ at: now, off: snap.t - now });
  while (state.offsets.length && now - state.offsets[0].at > 2000) state.offsets.shift();
  let best = -Infinity;
  for (const o of state.offsets) if (o.off > best) best = o.off;
  state.offset = best;
  state.snaps.push(snap);
  if (state.snaps.length > 8) state.snaps.shift();
  if (snap.pace === 'fast' && state.timer) {
    clearTimeout(state.timer);
    state.timer = 0;
    state.pace = 'fast';
    schedule();
  }
  if (!state.active) {
    state.active = true;
    schedule();
  }
});
api.onClear(() => {
  state.active = false;
  state.snaps = [];
  state.offsets = [];
  clearAll();
});
api.onFx((list) => {
  for (const e of list) fx.spawn(e);
  if (!state.active && fx.count()) schedule();
});
api.onSound((s) => {
  if (state.settings.sound) audio.play(s.name, s.volume != null ? s.volume : state.settings.volume);
});
api.onCursor((style) => {
  document.body.style.cursor = style || 'default';
});

function send(type, e) {
  api.pointer({ type, x: e.clientX, y: e.clientY, button: e.button });
}
window.addEventListener('pointerdown', (e) => {
  audio.unlock();
  send('down', e);
});
window.addEventListener('pointerup', (e) => send('up', e));
window.addEventListener('pointermove', (e) => {
  if (e.buttons) send('move', e);
});
window.addEventListener('pointercancel', (e) => send('cancel', e));
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  send('context', e);
});

const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const NUM_KEYS = ['x', 'y', 'z', 'k', 'hipH', 'pitch', 'headX', 'headY', 'headA', 'headYaw', 'beak', 'eye', 'lookX', 'lookY', 'wing', 'flap', 'tailA', 'tailFan', 'fluff', 'shadow'];

function lerpPose(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  const p = defaultPose();
  for (const key of NUM_KEYS) p[key] = lerp(a[key] == null ? b[key] : a[key], b[key], t);
  p.h = lerpAngle(a.h, b.h, t);
  p.feet = b.feet.map((fb, i) => {
    const fa = a.feet[i];
    return {
      x: lerp(fa.x, fb.x, t),
      y: lerp(fa.y, fb.y, t),
      lx: lerp(fa.lx, fb.lx, t),
      ly: lerp(fa.ly, fb.ly, t),
      lz: lerp(fa.lz, fb.lz, t),
      th: lerpAngle(fa.th, fb.th, t),
      curl: lerp(fa.curl, fb.curl, t),
      planted: t < 0.5 ? fa.planted : fb.planted,
    };
  });
  p.carry = t < 0.5 ? a.carry : b.carry;
  p.state = t < 0.5 ? a.state : b.state;
  p.emote = b.emote && a.emote && a.emote.kind === b.emote.kind ? Object.assign({}, b.emote, { t: lerp(a.emote.t, b.emote.t, t), a: lerp(a.emote.a, b.emote.a, t) }) : t < 0.5 ? a.emote : b.emote;
  return p;
}

function lerpItems(a, b, t) {
  const prev = new Map(a.map((i) => [i.id, i]));
  return b.map((ib) => {
    const ia = prev.get(ib.id);
    if (!ia) return ib;
    return Object.assign({}, ib, {
      x: lerp(ia.x, ib.x, t),
      y: lerp(ia.y, ib.y, t),
      z: lerp(ia.z || 0, ib.z || 0, t),
      rot: lerp(ia.rot, ib.rot, t),
      alpha: lerp(ia.alpha, ib.alpha, t),
      scale: lerp(ia.scale, ib.scale, t),
      lift: lerp(ia.lift, ib.lift, t),
      fadeCollect: lerp(ia.fadeCollect, ib.fadeCollect, t),
    });
  });
}

function nearness(y, z) {
  return (y * CAM.H) / CAM.F + (z || 0) * CAM.F;
}

function sample(now) {
  const snaps = state.snaps;
  if (!snaps.length) return null;
  const rt = now + (state.offset || 0) - DELAY;
  let a = snaps[0];
  let b = snaps[snaps.length - 1];
  if (rt <= a.t) return { crow: a.crow, items: a.items, toasts: a.toasts, box: a.box, bubble: a.bubble, k: a.k };
  if (rt >= b.t) return { crow: b.crow, items: b.items, toasts: b.toasts, box: b.box, bubble: b.bubble, k: b.k };
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].t <= rt && rt <= snaps[i + 1].t) {
      a = snaps[i];
      b = snaps[i + 1];
      break;
    }
  }
  const t = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
  return {
    crow: a.crow && b.crow ? lerpPose(a.crow, b.crow, t) : b.crow,
    items: lerpItems(a.items, b.items, t),
    toasts: b.toasts,
    box: b.box && a.box ? Object.assign({}, b.box, { open: lerp(a.box.open, b.box.open, t), alpha: lerp(a.box.alpha, b.box.alpha, t), age: lerp(a.box.age, b.box.age, t) }) : b.box,
    bubble: b.bubble,
    k: b.k,
  };
}

function hideCanvas() {
  if (!state.view.shown) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = 'none';
  state.view.shown = false;
}

function clearAll() {
  hideCanvas();
}

function addRect(r, x0, y0, x1, y1) {
  if (!r) return { x0, y0, x1, y1 };
  if (x0 < r.x0) r.x0 = x0;
  if (y0 < r.y0) r.y0 = y0;
  if (x1 > r.x1) r.x1 = x1;
  if (y1 > r.y1) r.y1 = y1;
  return r;
}

function crowRect(r, pose, rig) {
  const k = pose.k;
  const wb = worldBounds(rig, 8 * k);
  r = addRect(r, wb.x, wb.y, wb.x + wb.width, wb.y + wb.height);
  const [ex, ey] = toWorld(pose, rig.emotePt[0], rig.emotePt[1]);
  r = addRect(r, ex - 14 * k, ey - 14 * k, ex + 14 * k, ey + 14 * k);
  if (pose.carry) {
    const [cx, cy] = toWorld(pose, rig.carryPt[0], rig.carryPt[1]);
    r = addRect(r, cx - 22 * k, cy - 22 * k, cx + 22 * k, cy + 22 * k);
  }
  return r;
}

function itemRect(r, it, k) {
  const def = ITEM_TYPES[it.type];
  const sc = (it.scale == null ? 1 : it.scale) * k;
  const cy = it.y - (it.z || 0) * CAM.H - (def.h / 2) * sc;
  const R = Math.max(def.w, def.h) * sc * 0.85 + 9 * k;
  r = addRect(r, it.x - R, cy - R, it.x + R, cy + R);
  return addRect(r, it.x - def.w * 0.6 * sc, it.y - 4 * sc, it.x + def.w * 0.6 * sc, it.y + 4 * sc);
}

function frame(now) {
  state.rafId = 0;
  const newest = state.snaps[state.snaps.length - 1];
  state.pace = fx.count() ? 'fast' : (newest && newest.pace) || 'fast';
  const due = MIN_FRAME_MS[state.pace] || MIN_FRAME_MS.fast;
  if (now - state.lastDraw < due - 1) {
    schedule();
    return;
  }
  if (fx.count()) fx.step(Math.min(0.1, state.lastDraw ? (now - state.lastDraw) / 1000 : 1 / 60));
  state.lastDraw = now;
  const s = sample(now);
  const k = s ? s.k || 1 : 1;
  const items = [];
  let r = null;
  if (s) {
    for (const it of s.items) {
      if (!ITEM_TYPES[it.type]) continue;
      const it2 = Object.assign({}, it, { z: (it.z || 0) + (it.lift || 0) / CAM.H, alpha: (it.alpha == null ? 1 : it.alpha) * (it.fadeCollect == null ? 1 : it.fadeCollect) });
      items.push(it2);
      r = itemRect(r, it2, k);
    }
  }
  const rig = s && s.crow ? computeRig(s.crow) : null;
  if (rig) r = crowRect(r, s.crow, rig);
  const box = s ? s.box : null;
  if (box) {
    const bb = boxBounds(box, k);
    r = addRect(r, bb.x0, bb.y0, bb.x1, bb.y1);
  }
  const toasts = rig ? s.toasts.map((toast, i) => layoutToast(toast, s.crow, k, s.toasts.length - 1 - i)).filter(Boolean) : [];
  for (const t of toasts) r = addRect(r, t.x - 12, t.y - 12, t.x + t.w + 12, t.y + t.h + 20);
  let bubble = null;
  if (rig && s.bubble) {
    const [ex, ey] = toWorld(s.crow, rig.emotePt[0], rig.emotePt[1]);
    const top = toasts.length ? Math.min(...toasts.map((t) => t.y)) : Infinity;
    bubble = layoutMoodBubble(s.bubble, ex + 6 * k, Math.min(ey - 4 * k, top - 6), k, state.bounds);
    r = addRect(r, bubble.x - 14, bubble.y - 14, bubble.x + bubble.w + 14, bubble.y + bubble.h + 24);
  }
  const fb = fx.bounds();
  if (fb) r = addRect(r, fb.x0, fb.y0, fb.x1, fb.y1);
  const b = state.bounds;
  const dpr = state.dpr;
  const W = Math.round(window.innerWidth * dpr);
  const H = Math.round(window.innerHeight * dpr);
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  if (r) {
    x0 = Math.max(0, Math.floor((r.x0 - b.x) * dpr) - 2);
    y0 = Math.max(0, Math.floor((r.y0 - b.y) * dpr) - 2);
    x1 = Math.min(W, Math.ceil((r.x1 - b.x) * dpr) + 2);
    y1 = Math.min(H, Math.ceil((r.y1 - b.y) * dpr) + 2);
  }
  if (!r || x1 <= x0 || y1 <= y0) {
    hideCanvas();
  } else {
    placeCanvas(x0, y0, x1 - x0, y1 - y0);
    const v = state.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, -(b.x * dpr + v.x), -(b.y * dpr + v.y));
    const time = now / 1000;
    const scene = items.map((it) => ({ d: nearness(it.y, it.z), draw: () => drawItem(ctx, it, k, time) }));
    if (rig) scene.push({ d: nearness(s.crow.y, s.crow.z), draw: () => drawCrow(ctx, s.crow, { rig }) });
    if (box) {
      const half = (box.d / 2) * k * CAM.F;
      if (box.state === 'closed') scene.push({ d: nearness(box.y + half, 0), draw: () => drawBox(ctx, box, k, time, 'all') });
      else {
        scene.push({ d: nearness(box.y - half, 0), draw: () => drawBox(ctx, box, k, time, 'back') });
        scene.push({ d: nearness(box.y + half, 0) + 1e-3, draw: () => drawBox(ctx, box, k, time, 'front') });
      }
    }
    scene.sort((p, q) => p.d - q.d);
    for (const e of scene) e.draw();
    for (const t of toasts) drawToast(ctx, t);
    if (bubble) drawMoodBubble(ctx, s.bubble, bubble);
    if (fx.count()) fx.draw(ctx, drawHeart);
  }
  state.frames++;
  if (state.active && now - (state.lastSnapAt || 0) > 1500 && !fx.count()) {
    state.active = false;
    return;
  }
  if (state.active || fx.count()) schedule();
  else clearAll();
}

function placeCanvas(x, y, w, h) {
  const v = state.view;
  const needW = Math.ceil(w / STEP) * STEP;
  const needH = Math.ceil(h / STEP) * STEP;
  const tooSmall = canvas.width < w || canvas.height < h;
  v.roomy = canvas.width * canvas.height > 2 * needW * needH + STEP * STEP * 4 ? v.roomy + 1 : 0;
  if (tooSmall || v.roomy > 60 || v.dpr !== state.dpr) {
    canvas.width = Math.max(STEP, needW);
    canvas.height = Math.max(STEP, needH);
    canvas.style.width = `${canvas.width / state.dpr}px`;
    canvas.style.height = `${canvas.height / state.dpr}px`;
    v.roomy = 0;
    v.dpr = state.dpr;
  }
  if (x !== v.x || y !== v.y || !v.shown) {
    canvas.style.transform = `translate(${x / state.dpr}px, ${y / state.dpr}px)`;
    v.x = x;
    v.y = y;
  }
  if (!v.shown) {
    canvas.style.display = 'block';
    v.shown = true;
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const TOAST_FONT = (fs) => `600 ${fs}px "Segoe UI", "Noto Sans", "Cantarell", "DejaVu Sans", sans-serif`;

function layoutToast(toast, crow, k, index) {
  const fadeIn = Math.min(1, toast.age / 0.2);
  const fadeOut = Math.min(1, (toast.dur - toast.age) / 0.4);
  const a = Math.max(0, Math.min(fadeIn, fadeOut));
  if (a <= 0.01) return null;
  const fs = Math.round(12.5 * Math.max(0.9, Math.min(1.3, k)));
  ctx.font = TOAST_FONT(fs);
  const w = ctx.measureText(toast.text).width + 20;
  const h = fs + 14;
  const cx = crow.x;
  const b = state.bounds;
  const x = Math.max(b.x + 6, Math.min(b.x + b.width - w - 6, cx - w / 2));
  const top = crow.y - (crow.z || 0) * CAM.H - (crow.hipH * CAM.H + 62) * k;
  const y = Math.max(b.y + 6, top - h - index * (h + 6) - (1 - fadeIn) * 6);
  return { text: toast.text, a, fs, x, y, w, h, tx: Math.max(x + 12, Math.min(x + w - 12, cx)) };
}

function drawToast(c, t) {
  c.save();
  c.globalAlpha = t.a;
  c.font = TOAST_FONT(t.fs);
  roundRect(c, t.x, t.y, t.w, t.h, 9);
  c.fillStyle = 'rgba(255, 253, 248, 0.97)';
  c.shadowColor = 'rgba(0,0,0,0.25)';
  c.shadowBlur = 8;
  c.shadowOffsetY = 2;
  c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(40, 42, 52, 0.85)';
  c.stroke();
  c.beginPath();
  c.moveTo(t.tx - 6, t.y + t.h - 0.5);
  c.lineTo(t.tx, t.y + t.h + 7);
  c.lineTo(t.tx + 6, t.y + t.h - 0.5);
  c.fillStyle = 'rgba(255, 253, 248, 0.97)';
  c.fill();
  c.fillStyle = '#22242c';
  c.textBaseline = 'middle';
  c.fillText(t.text, t.x + 10, t.y + t.h / 2 + 0.5);
  c.restore();
}

function schedule() {
  if (state.rafId || state.timer) return;
  const due = MIN_FRAME_MS[state.pace] || MIN_FRAME_MS.fast;
  const wait = due - (performance.now() - state.lastDraw);
  if (state.pace === 'fast' || wait < 12) {
    state.rafId = requestAnimationFrame(frame);
  } else {
    state.timer = setTimeout(() => {
      state.timer = 0;
      state.rafId = requestAnimationFrame(frame);
    }, wait - 10);
  }
}

setInterval(() => {
  api.stats({ fps: state.frames, active: state.active });
  state.frames = 0;
}, 5000);
