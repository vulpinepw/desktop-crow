'use strict';

const { drawCrow, drawItem } = require('../../src/renderer/draw');
const { defaultPose } = require('../../src/core/rig');
const { DIMS: D, CAM } = require('../../src/core/dims');

const qa = window.qa;
const CELL_W = 190;
const CELL_H = 170;
const K = 2.2;
const HEADINGS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);

function standing(h) {
  const p = defaultPose();
  p.h = h;
  p.k = K;
  for (const f of p.feet) f.th = h;
  return p;
}

const ROWS = [
  { name: 'standing', make: (h) => standing(h) },
  {
    name: 'flying, wings up',
    make: (h) => {
      const p = standing(h);
      p.z = 22;
      p.hipH = D.hipAir;
      p.wing = 1;
      p.flap = 0.75;
      p.pitch = -0.05;
      p.tailFan = 0.4;
      p.feet.forEach((f, i) => Object.assign(f, { planted: false, lx: i ? -7 : -5, ly: -17, lz: i ? -2.4 : 2.4, curl: 1 }));
      p.shadow = 1;
      return p;
    },
  },
  {
    name: 'flying, wings down',
    make: (h) => {
      const p = ROWS[1].make(h);
      p.flap = -0.7;
      return p;
    },
  },
  {
    name: 'looking round / pecking / perched / calling',
    make: (h, i) => {
      const p = standing(h);
      switch (i % 4) {
        case 0:
          p.headYaw = 1.3;
          p.lookX = 0.8;
          break;
        case 1:
          p.headX = 27;
          p.headY = -8;
          p.headA = 1.05;
          p.pitch = 0.45;
          p.hipH = 19.5;
          break;
        case 2:
          p.hipH = D.hipPerch;
          p.fluff = 0.6;
          p.headX = D.headIdle.x - 4;
          p.headY = D.headIdle.y + 4;
          p.feet.forEach((f) => (f.ly = -D.footLift));
          break;
        default:
          p.beak = 0.95;
          p.headA = -0.3;
          p.tailFan = 0.6;
          p.wing = 0.25;
          p.flap = 0.4;
          break;
      }
      return p;
    },
  },
];

function render() {
  const W = CELL_W * HEADINGS.length;
  const H = CELL_H * ROWS.length + 30;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#dfe4ea';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#333';
  ctx.fillText(`Turntable: heading every 30 deg (0 = facing right, 90 = facing the viewer); camera elevation ${Math.round((CAM.elevation * 180) / Math.PI)} deg`, 8, 16);
  ROWS.forEach((row, r) => {
    HEADINGS.forEach((h, i) => {
      const x0 = i * CELL_W;
      const y0 = 30 + r * CELL_H;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, CELL_W, CELL_H);
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      for (let gx = -4; gx <= 4; gx++) {
        ctx.beginPath();
        ctx.moveTo(x0 + CELL_W / 2 + gx * 22, y0);
        ctx.lineTo(x0 + CELL_W / 2 + gx * 22, y0 + CELL_H);
        ctx.stroke();
      }
      for (let gy = -6; gy <= 6; gy++) {
        const yy = y0 + CELL_H * 0.72 + gy * 22 * CAM.F;
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x0 + CELL_W, yy);
        ctx.stroke();
      }
      const p = row.make(h, i);
      p.x = x0 + CELL_W / 2;
      p.y = y0 + CELL_H * 0.72;
      const c2 = Math.cos(p.h);
      const s2 = Math.sin(p.h);
      for (const f of p.feet) {
        f.x = p.x + K * (f.lx * c2 + f.lz * s2);
        f.y = p.y + K * (f.lx * s2 - f.lz * c2) * CAM.F;
      }
      drawCrow(ctx, p);
      if (r === 3 && i % 4 === 1) drawItem(ctx, { type: 'bread', x: p.x + Math.cos(h) * 34 * K, y: p.y + Math.sin(h) * 34 * K * CAM.F, z: 0, bitesLeft: 3 }, K * 0.8, 0);
      ctx.restore();
      ctx.fillStyle = '#555';
      ctx.fillText(`${Math.round((h * 180) / Math.PI)}°`, x0 + 6, y0 + 14);
    });
    ctx.fillStyle = '#222';
    ctx.fillText(row.name, 8, 30 + r * CELL_H + CELL_H - 6);
  });
  return c.toDataURL('image/png');
}

(async () => {
  try {
    await qa.save('turntable.png', render());
    qa.done(0);
  } catch (e) {
    qa.log(String((e && e.stack) || e));
    qa.done(1);
  }
})();
