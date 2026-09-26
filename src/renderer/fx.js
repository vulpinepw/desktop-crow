'use strict';

const { createRng } = require('../core/rng');

const CRUMB_COLORS = {
  bread: ['#c98a3d', '#f4dfb0'],
  apple: ['#d8333a', '#f7e6b5'],
  peanut: ['#d9b37a', '#a8783c'],
  fry: ['#f2c14e', '#e0a93a'],
  cherry: ['#b3142a', '#7a0b1b'],
  cheese: ['#f5cf3d', '#d9a91c'],
};

function createFx() {
  const parts = [];

  function spawn(e) {
    const rng = createRng(e.seed || 1);
    const k = 1.25;
    if (e.kind === 'crumbs') {
      const cols = CRUMB_COLORS[e.itemType] || ['#c9a36b', '#8a6a3b'];
      for (let i = 0; i < 6; i++) {
        parts.push({ kind: 'crumb', x: e.x, y: e.y, vx: rng.range(-60, 60), vy: rng.range(-120, -40), g: 700, life: rng.range(0.35, 0.6), age: 0, size: rng.range(1.2, 2.4) * k, color: rng.pick(cols), floor: e.y + 6 * k });
      }
    } else if (e.kind === 'dust') {
      for (let i = 0; i < 4; i++) {
        parts.push({ kind: 'dust', x: e.x + rng.range(-3, 3), y: e.y + 2, vx: rng.range(-30, 30), vy: rng.range(-25, -8), g: 0, life: rng.range(0.3, 0.5), age: 0, size: rng.range(2, 3.5) * k });
      }
    } else if (e.kind === 'sparkleBurst') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const sp = rng.range(50, 110);
        parts.push({ kind: 'star', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, g: 60, life: rng.range(0.5, 0.8), age: 0, size: rng.range(2, 3.4) * k });
      }
    } else if (e.kind === 'feather') {
      parts.push({ kind: 'feather', x: e.x, y: e.y, vx: rng.range(-20, 20), vy: -30, g: 40, life: 1.6, age: 0, size: 7 * k, sway: rng.range(0, 6) });
    } else if (e.kind === 'heart') {
      parts.push({ kind: 'heart', x: e.x, y: e.y, vx: 0, vy: -28, g: 0, life: 1.2, age: 0, size: 5 * k });
    }
    if (parts.length > 300) parts.splice(0, parts.length - 300);
  }

  function step(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'feather') p.x += Math.sin(p.age * 5 + p.sway) * 0.6;
      if (p.floor != null && p.y > p.floor) {
        p.y = p.floor;
        p.vy = 0;
        p.vx *= 0.5;
      }
    }
  }

  function draw(ctx, drawHeart) {
    for (const p of parts) {
      const a = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.3));
      if (p.kind === 'crumb') {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === 'dust') {
        ctx.fillStyle = 'rgba(150, 140, 125, 0.6)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.age), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'star') {
        const s = p.size * (0.6 + a * 0.6);
        ctx.fillStyle = '#fff3b8';
        ctx.strokeStyle = 'rgba(140, 100, 10, 0.7)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.6);
        ctx.lineTo(p.x + s * 0.35, p.y - s * 0.35);
        ctx.lineTo(p.x + s * 1.6, p.y);
        ctx.lineTo(p.x + s * 0.35, p.y + s * 0.35);
        ctx.lineTo(p.x, p.y + s * 1.6);
        ctx.lineTo(p.x - s * 0.35, p.y + s * 0.35);
        ctx.lineTo(p.x - s * 1.6, p.y);
        ctx.lineTo(p.x - s * 0.35, p.y - s * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'feather') {
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(p.age * 4 + p.sway) * 0.6);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.32, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#23262f';
        ctx.fill();
        ctx.strokeStyle = 'rgba(220,226,240,0.8)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else if (p.kind === 'heart') {
        drawHeart(ctx, p.x, p.y, p.size, '#e2476b');
      }
      ctx.restore();
    }
  }

  function bounds() {
    if (!parts.length) return null;
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of parts) {
      const r = p.size * (2 + p.age) + 3;
      if (p.x - r < b.x0) b.x0 = p.x - r;
      if (p.y - r < b.y0) b.y0 = p.y - r;
      if (p.x + r > b.x1) b.x1 = p.x + r;
      if (p.y + r > b.y1) b.y1 = p.y + r;
    }
    return b;
  }

  return { spawn, step, draw, bounds, count: () => parts.length };
}

module.exports = { createFx };
