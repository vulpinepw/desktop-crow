'use strict';

const { ITEM_TYPES } = require('../core/items');
const { CAM } = require('../core/dims');

function pathPoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function pathSmooth(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

function pathEllipse(ctx, e) {
  ctx.beginPath();
  ctx.ellipse(e.cx, e.cy, e.rx, e.ry, e.rot, 0, Math.PI * 2);
}

function strokeLine(ctx, pts, width, color) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixColor(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

function drawBubble(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(30,32,40,0.85)';
  ctx.stroke();
}

function drawHeart(ctx, x, y, s, color) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawEmote(ctx, emote, x, y, k) {
  const t = emote.t || 0;
  const alpha = emote.a == null ? 1 : emote.a;
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const pop = t < 0.15 ? 0.6 + 0.4 * Math.sin((t / 0.15) * Math.PI * 0.5) * 1.1 : 1;
  const r = 7.5 * k * pop;
  const bob = Math.sin(t * Math.PI * 4) * 0.8 * k;
  ctx.font = `bold ${Math.round(11 * k * pop)}px "Segoe UI", "Noto Sans", "DejaVu Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (emote.kind) {
    case 'alert':
      drawBubble(ctx, x, y + bob, r);
      ctx.fillStyle = '#e0532f';
      ctx.fillText('!', x, y + bob + 0.5 * k);
      break;
    case 'question':
      drawBubble(ctx, x, y + bob, r);
      ctx.fillStyle = '#3a6fd8';
      ctx.fillText('?', x, y + bob + 0.5 * k);
      break;
    case 'heart':
      drawBubble(ctx, x, y + bob, r);
      drawHeart(ctx, x, y + bob + 1.2 * k, 5 * k * pop, '#e2476b');
      break;
    case 'annoyed': {
      drawBubble(ctx, x, y + bob, r);
      ctx.strokeStyle = '#d33b2c';
      ctx.lineWidth = 1.6 * k;
      const q = 2.8 * k;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * q * 0.35, y + bob + dy * q);
        ctx.quadraticCurveTo(x + dx * q * 0.35, y + bob + dy * q * 0.35, x + dx * q, y + bob + dy * q * 0.35);
        ctx.stroke();
      }
      break;
    }
    case 'note':
      drawBubble(ctx, x, y + bob, r);
      ctx.fillStyle = '#2d2f3a';
      ctx.fillText('♪', x, y + bob + 0.5 * k);
      break;
    case 'sleep': {
      ctx.fillStyle = 'rgba(235, 240, 255, 0.95)';
      ctx.strokeStyle = 'rgba(25, 27, 35, 0.9)';
      ctx.lineWidth = 2.2 * k;
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const ph = (t + i / 3) % 1;
        const a = Math.sin(ph * Math.PI);
        const sz = (7 + ph * 6) * k;
        ctx.font = `bold ${Math.round(sz)}px "Segoe UI", "Noto Sans", "DejaVu Sans", sans-serif`;
        ctx.globalAlpha = alpha * a;
        const zx = x + (ph * 14 + Math.sin(ph * 6) * 2) * k;
        const zy = y + 4 * k - ph * 22 * k;
        ctx.strokeText('z', zx, zy);
        ctx.fillText('z', zx, zy);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawItemShape(ctx, type, alpha = 1, seed = 0) {
  const def = ITEM_TYPES[type];
  if (!def) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const OL = 'rgba(20, 20, 26, 0.9)';
  const lw = 1.1;
  const w = def.w;
  const h = def.h;
  switch (def.shape) {
    case 'apple': {
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.28);
      ctx.bezierCurveTo(w * 0.55, -h * 0.62, w * 0.62, h * 0.35, w * 0.12, h * 0.5);
      ctx.quadraticCurveTo(0, h * 0.44, -w * 0.12, h * 0.5);
      ctx.bezierCurveTo(-w * 0.62, h * 0.35, -w * 0.55, -h * 0.62, 0, -h * 0.28);
      ctx.fillStyle = '#d8333a';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-w * 0.2, -h * 0.08, w * 0.09, h * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
      strokeLine(ctx, [[0, -h * 0.26], [w * 0.06, -h * 0.5]], 1.4, '#5a3a22');
      ctx.beginPath();
      ctx.ellipse(w * 0.2, -h * 0.44, w * 0.16, h * 0.07, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#4fae45';
      ctx.fill();
      break;
    }
    case 'bread': {
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h * 0.05);
      ctx.bezierCurveTo(-w / 2, -h * 0.75, w / 2, -h * 0.75, w / 2, -h * 0.05);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath();
      ctx.fillStyle = '#c98a3d';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 2, h / 2 - 1.5);
      ctx.lineTo(-w / 2 + 2, 0);
      ctx.bezierCurveTo(-w / 2 + 2, -h * 0.5, w / 2 - 2, -h * 0.5, w / 2 - 2, 0);
      ctx.lineTo(w / 2 - 2, h / 2 - 1.5);
      ctx.closePath();
      ctx.fillStyle = '#f4dfb0';
      ctx.fill();
      break;
    }
    case 'peanut': {
      ctx.beginPath();
      ctx.ellipse(-w * 0.22, 0, w * 0.3, h * 0.5, 0, 0, Math.PI * 2);
      ctx.ellipse(w * 0.22, 0, w * 0.3, h * 0.46, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d9b37a';
      ctx.fill('nonzero');
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120, 80, 40, 0.6)';
      ctx.lineWidth = 0.7;
      for (const dx of [-0.3, -0.12, 0.12, 0.3]) {
        ctx.beginPath();
        ctx.moveTo(w * dx, -h * 0.3);
        ctx.lineTo(w * dx, h * 0.3);
        ctx.stroke();
      }
      break;
    }
    case 'fry': {
      ctx.save();
      ctx.rotate(-0.08);
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#f2c14e';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.fillStyle = 'rgba(200, 130, 30, 0.6)';
      ctx.fillRect(-w / 2, h * 0.15, w, h * 0.3);
      ctx.restore();
      break;
    }
    case 'cherry': {
      strokeLine(ctx, [[-w * 0.25, h * 0.15], [w * 0.05, -h * 0.5], [w * 0.28, h * 0.05]], 1.2, '#4b6b2a');
      for (const dx of [-0.25, 0.28]) {
        ctx.beginPath();
        ctx.arc(w * dx, h * 0.24, h * 0.26, 0, Math.PI * 2);
        ctx.fillStyle = '#b3142a';
        ctx.fill();
        ctx.lineWidth = lw;
        ctx.strokeStyle = OL;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w * dx - 1, h * 0.17, h * 0.07, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill();
      }
      break;
    }
    case 'cheese': {
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(w / 2, -h * 0.1);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.closePath();
      ctx.fillStyle = '#f5cf3d';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.fillStyle = '#d9a91c';
      for (const [hx, hy, hr] of [[-w * 0.15, h * 0.18, 1.6], [w * 0.2, h * 0.05, 1.2], [w * 0.05, h * 0.32, 1]]) {
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'bottlecap': {
      ctx.beginPath();
      const teeth = 9;
      for (let i = 0; i <= teeth; i++) {
        const x = -w / 2 + (w * i) / teeth;
        ctx.lineTo(x, i % 2 ? h / 2 - 1 : h / 2);
      }
      ctx.lineTo(w / 2, -h * 0.1);
      ctx.quadraticCurveTo(0, -h * 0.75, -w / 2, -h * 0.1);
      ctx.closePath();
      ctx.fillStyle = '#c62f2f';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.22, w * 0.36, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      break;
    }
    case 'foil': {
      ctx.beginPath();
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = (w / 2) * (0.84 + 0.16 * Math.sin(i * 2.7 + seed));
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = '#c7ccd6';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-w * 0.25, -h * 0.1);
      ctx.lineTo(-w * 0.05, -h * 0.25);
      ctx.lineTo(w * 0.15, -h * 0.05);
      ctx.stroke();
      break;
    }
    case 'marble': {
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(-w * 0.15, -h * 0.15, 1, 0, 0, w / 2);
      g.addColorStop(0, '#bfe6ff');
      g.addColorStop(1, '#2b7bc0');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.05, h * 0.05, w * 0.25, 0.3, 2.6);
      ctx.strokeStyle = '#f5a623';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    }
    case 'coin': {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#e8b923';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.34, h * 0.34, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-w * 0.12, -h * 0.14, w * 0.1, h * 0.06, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,230,0.8)';
      ctx.fill();
      break;
    }
    case 'ring': {
      ctx.beginPath();
      ctx.ellipse(0, h * 0.14, w * 0.42, h * 0.34, 0, 0, Math.PI * 2);
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = def.color || '#f0c030';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.5);
      ctx.lineTo(w * 0.17, -h * 0.28);
      ctx.lineTo(0, -h * 0.12);
      ctx.lineTo(-w * 0.17, -h * 0.28);
      ctx.closePath();
      ctx.fillStyle = def.gem || '#7fd3ff';
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = OL;
      ctx.stroke();
      break;
    }
    case 'paperclip': {
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = OL;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, h * 0.2);
        ctx.lineTo(w * 0.35, h * 0.2);
        ctx.arc(w * 0.35, 0, h * 0.2, Math.PI / 2, -Math.PI / 2, true);
        ctx.lineTo(-w * 0.4, -h * 0.2);
        ctx.arc(-w * 0.4, 0, h * 0.2, -Math.PI / 2, Math.PI / 2, true);
        ctx.lineTo(w * 0.2, h * 0.2 - 0.001);
      };
      path();
      ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = '#c9d0db';
      path();
      ctx.stroke();
      break;
    }
    case 'pebble': {
      ctx.beginPath();
      ctx.ellipse(0, h * 0.05, w / 2, h * 0.45, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = def.color || '#9aa0a8';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-w * 0.15, -h * 0.1, w * 0.14, h * 0.09, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fill();
      break;
    }
    case 'key': {
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = OL;
      const kp = () => {
        ctx.beginPath();
        ctx.arc(-w * 0.3, 0, h * 0.32, 0, Math.PI * 2);
        ctx.moveTo(-w * 0.3 + h * 0.32, 0);
        ctx.lineTo(w * 0.45, 0);
        ctx.moveTo(w * 0.3, 0);
        ctx.lineTo(w * 0.3, h * 0.3);
        ctx.moveTo(w * 0.42, 0);
        ctx.lineTo(w * 0.42, h * 0.25);
      };
      kp();
      ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#d6a63a';
      kp();
      ctx.stroke();
      break;
    }
    case 'earring': {
      ctx.beginPath();
      ctx.arc(0, -h * 0.2, w * 0.3, Math.PI, 0);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = '#e2c26b';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.15, w * 0.24, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(w * 0.24, h * 0.08, 0.5, w * 0.3, h * 0.15, w * 0.24);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#d8d2e6');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      break;
    }
    case 'gem': {
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.1);
      ctx.lineTo(-w * 0.28, -h / 2);
      ctx.lineTo(w * 0.28, -h / 2);
      ctx.lineTo(w / 2, -h * 0.1);
      ctx.lineTo(0, h / 2);
      ctx.closePath();
      ctx.fillStyle = def.color || '#3cc6e6';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = OL;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.1);
      ctx.lineTo(w / 2, -h * 0.1);
      ctx.moveTo(-w * 0.12, -h * 0.1);
      ctx.lineTo(0, h * 0.45);
      ctx.lineTo(w * 0.12, -h * 0.1);
      ctx.stroke();
      break;
    }
    case 'feather': {
      ctx.save();
      ctx.rotate(-0.5);
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.quadraticCurveTo(0, -h * 0.9, w / 2, 0);
      ctx.quadraticCurveTo(0, h * 0.9, -w / 2, 0);
      ctx.fillStyle = '#2a2f3c';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(210,216,230,0.9)';
      ctx.stroke();
      strokeLine(ctx, [[-w / 2 - 2, 0], [w / 2, 0]], 0.8, '#8c96ad');
      ctx.restore();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#888';
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawItem(ctx, item, k, time = 0) {
  const def = ITEM_TYPES[item.type];
  if (!def) return;
  const sc = (item.scale == null ? 1 : item.scale) * k;
  const alpha = item.alpha == null ? 1 : item.alpha;
  if (alpha <= 0.01) return;
  const z = item.z || 0;
  const by = item.y - z * CAM.H;
  ctx.save();
  if (item.shadow !== false) {
    const far = Math.min(1, z / (220 * k));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.globalAlpha = alpha * (1 - far * 0.8);
    ctx.beginPath();
    ctx.ellipse(item.x, item.y, def.w * 0.55 * sc * (1 - far * 0.4), def.w * 0.55 * sc * CAM.F * 0.55 * (1 - far * 0.4), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.translate(item.x, by - (def.h / 2) * sc);
  ctx.rotate(item.rot || 0);
  ctx.scale(sc, sc);
  const frac = def.bites ? Math.max(0.25, (item.bitesLeft == null ? def.bites : item.bitesLeft) / def.bites) : 1;
  if (frac < 1) {
    ctx.beginPath();
    const r = Math.max(def.w, def.h);
    ctx.rect(-r, -r, r * 2 * frac + (1 - frac) * r * 0.2, r * 2);
    ctx.clip();
  }
  drawItemShape(ctx, item.type, alpha, item.seed || 0);
  ctx.restore();
  if (def.shiny || item.gift) {
    drawSparkles(ctx, item.x, by - (def.h / 2) * sc, def.w * sc * 0.75, time + (item.seed || 0), alpha * (item.gift ? 1 : 0.7), k);
  }
}

function drawSparkles(ctx, x, y, r, time, alpha, k) {
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const ph = (time * 0.9 + i * 0.37) % 1;
    const a = Math.sin(ph * Math.PI);
    if (a < 0.05) continue;
    const ang = i * 2.1 + Math.floor(time * 0.9 + i * 0.37) * 1.7;
    const sx = x + Math.cos(ang) * r;
    const sy = y + Math.sin(ang) * r * 0.8;
    const s = (1.2 + a * 2.6) * k;
    ctx.globalAlpha = alpha * a;
    ctx.fillStyle = '#fff6c9';
    ctx.strokeStyle = 'rgba(120, 90, 10, 0.8)';
    ctx.lineWidth = 0.6 * k;
    ctx.beginPath();
    ctx.moveTo(sx, sy - s * 1.6);
    ctx.lineTo(sx + s * 0.35, sy - s * 0.35);
    ctx.lineTo(sx + s * 1.6, sy);
    ctx.lineTo(sx + s * 0.35, sy + s * 0.35);
    ctx.lineTo(sx, sy + s * 1.6);
    ctx.lineTo(sx - s * 0.35, sy + s * 0.35);
    ctx.lineTo(sx - s * 1.6, sy);
    ctx.lineTo(sx - s * 0.35, sy - s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

const BOX_YAW = 0.3;
const CARD = Object.freeze({ top: '#d6b07a', front: '#bf8f58', side: '#a27443', inner: '#6b4a27', deep: '#3d2914', edge: 'rgba(96, 64, 30, 0.55)', flap: '#cfa56d', flapIn: '#b58651' });
const TAPE = Object.freeze({ fill: '#d72f3e', light: 'rgba(255, 140, 150, 0.55)' });
const MARKER = '#c8102e';

function boxGeometry(box, k) {
  const W = box.w * k;
  const Dd = box.d * k;
  const Hh = box.h * k;
  const ca = Math.cos(BOX_YAW);
  const sa = Math.sin(BOX_YAW);
  const P = (lx, lz, z) => [box.x + lx * ca - lz * sa, box.y + (lx * sa + lz * ca) * CAM.F - z * CAM.H];
  return { W, D: Dd, Hh, ca, sa, P };
}

function poly(ctx, pts, fill) {
  pathPoly(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}

function edge(ctx, pts, width) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = CARD.edge;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function flapPoints(g, side, open) {
  const th = open * 2.05;
  const pts = [];
  const hinge = side * (g.W / 2);
  for (const [s, lz] of [[0, -g.D / 2], [g.W / 2, -g.D / 2], [g.W / 2, g.D / 2], [0, g.D / 2]]) {
    const lx = hinge - side * s * Math.cos(th);
    const z = g.Hh + s * Math.sin(th);
    pts.push(g.P(lx, lz, z));
  }
  return pts;
}

function drawFlap(ctx, g, side, open, k) {
  const pts = flapPoints(g, side, open);
  const th = open * 2.05;
  poly(ctx, pts, th > Math.PI / 2 ? CARD.flapIn : CARD.flap);
  edge(ctx, [...pts, pts[0]], 0.8 * k);
  const tw = 5 * k;
  const s0 = g.W / 2 - tw;
  const hinge = side * (g.W / 2);
  const tp = [];
  for (const [s, lz] of [[s0, -g.D / 2 - 0.5 * k], [g.W / 2, -g.D / 2 - 0.5 * k], [g.W / 2, g.D / 2 + 0.5 * k], [s0, g.D / 2 + 0.5 * k]]) {
    tp.push(g.P(hinge - side * s * Math.cos(th), lz, g.Hh + s * Math.sin(th)));
  }
  poly(ctx, tp, TAPE.fill);
}

function drawBoxBody(ctx, g, k, part, open) {
  const { W, D: Dd, Hh, P } = g;
  const fl = [P(-W / 2, Dd / 2, Hh), P(W / 2, Dd / 2, Hh), P(W / 2, Dd / 2, 0), P(-W / 2, Dd / 2, 0)];
  const sd = [P(W / 2, Dd / 2, Hh), P(W / 2, -Dd / 2, Hh), P(W / 2, -Dd / 2, 0), P(W / 2, Dd / 2, 0)];
  const top = [P(-W / 2, -Dd / 2, Hh), P(W / 2, -Dd / 2, Hh), P(W / 2, Dd / 2, Hh), P(-W / 2, Dd / 2, Hh)];
  if (part === 'all' || part === 'back') {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    pathPoly(ctx, [P(-W / 2 - 3 * k, -Dd / 2 - 2 * k, 0), P(W / 2 + 5 * k, -Dd / 2 - 2 * k, 0), P(W / 2 + 6 * k, Dd / 2 + 4 * k, 0), P(-W / 2 - 2 * k, Dd / 2 + 4 * k, 0)]);
    ctx.fill();
    ctx.restore();
    if (open > 0) {
      poly(ctx, top, CARD.deep);
      const back = [P(-W / 2, -Dd / 2, Hh), P(W / 2, -Dd / 2, Hh), P(W / 2, -Dd / 2, Hh * 0.35), P(-W / 2, -Dd / 2, Hh * 0.35)];
      const g2 = ctx.createLinearGradient(0, back[0][1], 0, back[3][1]);
      g2.addColorStop(0, CARD.inner);
      g2.addColorStop(1, CARD.deep);
      poly(ctx, back, g2);
      const left = [P(-W / 2, -Dd / 2, Hh), P(-W / 2, Dd / 2, Hh), P(-W / 2, Dd / 2, Hh * 0.5), P(-W / 2, -Dd / 2, Hh * 0.5)];
      poly(ctx, left, 'rgba(90, 62, 32, 0.9)');
      drawFlap(ctx, g, -1, open, k);
      drawFlap(ctx, g, 1, open, k);
    }
  }
  if (part === 'all' || part === 'front') {
    poly(ctx, sd, CARD.side);
    poly(ctx, fl, CARD.front);
    const shade = ctx.createLinearGradient(0, fl[0][1], 0, fl[3][1]);
    shade.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
    poly(ctx, fl, shade);
    for (const [u, v] of [[-0.18, 0.62], [0.12, 0.62], [0.42, 0.62]]) {
      const c = P(W / 2, u * Dd, Hh * v);
      ctx.beginPath();
      ctx.ellipse(c[0], c[1], 1.6 * k, 1.9 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40, 24, 8, 0.75)';
      ctx.fill();
    }
    edge(ctx, [fl[0], fl[1], sd[1], sd[2], sd[3], fl[3], fl[0]], 0.9 * k);
    edge(ctx, [fl[1], fl[2]], 0.9 * k);
    if (open <= 0) {
      poly(ctx, top, CARD.top);
      edge(ctx, [top[0], top[1], top[2], top[3], top[0]], 0.9 * k);
      edge(ctx, [P(0, -Dd / 2, Hh), P(0, Dd / 2, Hh)], 0.7 * k);
      const tw = 5 * k;
      poly(ctx, [P(-tw, -Dd / 2 - 0.5 * k, Hh), P(tw, -Dd / 2 - 0.5 * k, Hh), P(tw, Dd / 2, Hh), P(-tw, Dd / 2, Hh)], TAPE.fill);
      poly(ctx, [P(-tw, Dd / 2, Hh), P(tw, Dd / 2, Hh), P(tw, Dd / 2, Hh - 11 * k), P(-tw, Dd / 2, Hh - 11 * k)], TAPE.fill);
      poly(ctx, [P(-tw, -Dd / 2 - 0.5 * k, Hh), P(-tw * 0.35, -Dd / 2 - 0.5 * k, Hh), P(-tw * 0.35, Dd / 2, Hh), P(-tw, Dd / 2, Hh)], TAPE.light);
    } else {
      const tw = 5 * k;
      const gap = Math.min(1, open * 3) * 3 * k;
      poly(ctx, [P(-tw - gap, Dd / 2, Hh), P(-gap, Dd / 2, Hh), P(-gap, Dd / 2, Hh - 11 * k), P(-tw - gap, Dd / 2, Hh - 11 * k)], TAPE.fill);
      poly(ctx, [P(gap, Dd / 2, Hh), P(tw + gap, Dd / 2, Hh), P(tw + gap, Dd / 2, Hh - 11 * k), P(gap, Dd / 2, Hh - 11 * k)], TAPE.fill);
    }
    const c = P(0, Dd / 2, Hh * 0.4);
    ctx.save();
    ctx.transform(g.ca, g.sa * CAM.F, 0, CAM.H, c[0], c[1]);
    ctx.font = `bold ${(12.5 * k).toFixed(2)}px "Segoe Print", "Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", cursive, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MARKER;
    ctx.fillText('OPEN ME', 0, 0);
    ctx.restore();
  }
}

function drawBox(ctx, box, k, time = 0, part = 'all') {
  const alpha = box.alpha == null ? 1 : box.alpha;
  if (alpha <= 0.01) return;
  const g = boxGeometry(box, k);
  const open = box.state === 'closed' ? 0 : Math.max(0.001, box.open == null ? 1 : box.open);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (box.state === 'closed') {
    const period = 3.4;
    const ph = ((box.age || 0) + (box.seed % 17) * 0.1) % period;
    const w = ph < 0.55 ? Math.sin((ph / 0.55) * Math.PI) : 0;
    const wob = w * 0.07 * Math.sin(ph * 38);
    const hop = w * Math.abs(Math.sin(ph * 19)) * 2.5 * k;
    const pivot = g.P(0, g.D / 2, 0);
    ctx.translate(pivot[0], pivot[1] - hop);
    ctx.rotate(wob);
    ctx.translate(-pivot[0], -pivot[1]);
  }
  drawBoxBody(ctx, g, k, part, open);
  ctx.restore();
}

function boxBounds(box, k) {
  const g = boxGeometry(box, k);
  const xs = [];
  const ys = [];
  for (const lx of [-g.W, g.W]) {
    for (const lz of [-g.D / 2, g.D / 2]) {
      for (const z of [0, g.Hh + g.W / 2]) {
        const p = g.P(lx, lz, z);
        xs.push(p[0]);
        ys.push(p[1]);
      }
    }
  }
  return { x0: Math.min(...xs) - 8 * k, y0: Math.min(...ys) - 10 * k, x1: Math.max(...xs) + 8 * k, y1: Math.max(...ys) + 10 * k };
}

const MOOD_COLORS = Object.freeze({ hungry: '#f59e0b', tired: '#6366f1', happy: '#ec4899', satisfied: '#22c55e', sad: '#3b82f6', content: '#14b8a6' });

function moodIcon(ctx, kind, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const c = MOOD_COLORS[kind] || MOOD_COLORS.content;
  if (kind === 'hungry' || kind === 'satisfied') {
    ctx.save();
    ctx.scale(s / 17, s / 17);
    drawItemShape(ctx, 'bread', 1, 1);
    ctx.restore();
    if (kind === 'satisfied') {
      ctx.beginPath();
      ctx.arc(s * 0.42, s * 0.3, s * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.3);
      ctx.lineTo(s * 0.39, s * 0.41);
      ctx.lineTo(s * 0.58, s * 0.2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  } else if (kind === 'tired') {
    ctx.beginPath();
    ctx.arc(-s * 0.08, 0, s * 0.38, 0.35 * Math.PI, 1.75 * Math.PI, false);
    ctx.arc(s * 0.08, -s * 0.08, s * 0.3, 1.62 * Math.PI, 0.45 * Math.PI, true);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.fillStyle = c;
    ctx.font = `bold ${(s * 0.42).toFixed(1)}px "Segoe UI", "Noto Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('z', s * 0.38, -s * 0.34);
  } else if (kind === 'sad') {
    ctx.fillStyle = '#9aa7ba';
    ctx.beginPath();
    ctx.arc(-s * 0.18, -s * 0.08, s * 0.2, 0, Math.PI * 2);
    ctx.arc(s * 0.08, -s * 0.16, s * 0.24, 0, Math.PI * 2);
    ctx.arc(s * 0.28, -s * 0.04, s * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-s * 0.36, -s * 0.06, s * 0.8, s * 0.17);
    ctx.fillStyle = c;
    for (const dx of [-0.16, 0.1]) {
      ctx.beginPath();
      ctx.moveTo(s * dx, s * 0.2);
      ctx.quadraticCurveTo(s * (dx + 0.08), s * 0.34, s * dx, s * 0.4);
      ctx.quadraticCurveTo(s * (dx - 0.08), s * 0.34, s * dx, s * 0.2);
      ctx.fill();
    }
  } else {
    drawHeart(ctx, 0, s * 0.05, s * 0.42, c);
  }
  ctx.restore();
}

function layoutMoodBubble(bubble, ax, ay, k, bounds) {
  const sc = Math.max(0.9, Math.min(1.3, k));
  const w = 112 * sc;
  const h = 42 * sc;
  let x = ax + 12 * sc;
  let y = ay - h - 12 * sc;
  if (bounds) {
    x = Math.max(bounds.x + 6, Math.min(bounds.x + bounds.width - w - 6, x));
    y = Math.max(bounds.y + 6, y);
  }
  return { x, y, w, h, sc, ax, ay };
}

function drawMoodBubble(ctx, bubble, lay) {
  const { x, y, w, h, sc } = lay;
  const age = bubble.age || 0;
  const dur = bubble.dur || 3.6;
  const a = Math.max(0, Math.min(1, age / 0.18, (dur - age) / 0.35));
  if (a <= 0.01) return;
  const pop = age < 0.25 ? 0.85 + 0.15 * Math.sin((age / 0.25) * Math.PI * 0.5) : 1;
  const color = MOOD_COLORS[bubble.kind] || MOOD_COLORS.content;
  ctx.save();
  ctx.globalAlpha *= a;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.translate(-cx, -cy);
  const r = 11 * sc;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.lineTo(x + 26 * sc, y + h);
  ctx.lineTo(Math.min(x + 18 * sc, lay.ax + 2 * sc), y + h + 9 * sc);
  ctx.lineTo(x + 12 * sc, y + h);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 253, 248, 0.97)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(40, 42, 52, 0.85)';
  ctx.stroke();
  moodIcon(ctx, bubble.kind, x + 20 * sc, cy, 20 * sc);
  ctx.fillStyle = '#22242c';
  ctx.font = `600 ${(12 * sc).toFixed(1)}px "Segoe UI", "Noto Sans", "Cantarell", "DejaVu Sans", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(bubble.label || bubble.kind, x + 38 * sc, y + 17 * sc);
  const bx = x + 38 * sc;
  const by = y + 24 * sc;
  const bw = w - 50 * sc;
  const bh = 7 * sc;
  const fillT = Math.min(1, age / 0.45);
  const v = Math.max(0, Math.min(1, bubble.value || 0)) * (1 - Math.pow(1 - fillT, 3));
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(34, 36, 44, 0.12)';
  ctx.fill();
  if (v > 0.01) {
    ctx.beginPath();
    ctx.roundRect(bx, by, Math.max(bh, bw * v), bh, bh / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

module.exports = {
  pathPoly,
  pathSmooth,
  pathEllipse,
  strokeLine,
  hexToRgb,
  mixColor,
  drawBubble,
  drawHeart,
  drawEmote,
  drawItemShape,
  drawItem,
  drawSparkles,
  drawBox,
  boxBounds,
  drawMoodBubble,
  layoutMoodBubble,
  MOOD_COLORS,
};
