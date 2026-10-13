'use strict';

const { DIMS: D, CAM } = require('../src/core/dims');
const { EAT_OFFSET } = require('../src/core/brain');

function spotFrom(h, d, a = 0) {
  const c = h.crow;
  const k = h.k;
  const w = h.world;
  for (const da of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
    const ang = c.h + a + da;
    const x = c.x + Math.cos(ang) * d * k;
    const y = c.y + Math.sin(ang) * d * k * CAM.F;
    if (w.inWalkable(x, y, 0)) return { x, y };
  }
  return w.clampWalkable(c.x + d * k, c.y);
}

function request(h, name) {
  const c = h.crow;
  const k = h.k;
  const w = h.world;
  switch (name) {
    case 'idle':
      c.act({ type: 'idle', duration: 1.2 });
      break;
    case 'walk': {
      const t = spotFrom(h, 90, 0.4);
      c.act({ type: 'walkTo', x: t.x, y: t.y });
      break;
    }
    case 'hop': {
      const t = spotFrom(h, 40, -0.3);
      c.act({ type: 'hopTo', x: t.x, y: t.y });
      break;
    }
    case 'fly':
    case 'land': {
      const a = w.areaAt(c.x, c.y, 2) || w.areas[0];
      const tx = c.x > (a.x0 + a.x1) / 2 ? a.x0 + (a.x1 - a.x0) * 0.2 : a.x0 + (a.x1 - a.x0) * 0.8;
      const ty = c.y > (a.y0 + a.y1) / 2 ? a.y0 + (a.y1 - a.y0) * 0.3 : a.y0 + (a.y1 - a.y0) * 0.75;
      c.act({ type: 'flyTo', target: { x: tx, y: ty } });
      break;
    }
    case 'perch':
      c.act({ type: 'perch', duration: 2.5 });
      break;
    case 'sleep':
      c.act({ type: 'sleep', duration: 2.5 });
      break;
    case 'eat': {
      let spot = null;
      for (const a of [0, 0.5, -0.5, 1.2, -1.2, Math.PI]) {
        const x = c.x + Math.cos(c.h + a) * EAT_OFFSET * k;
        const y = c.y + Math.sin(c.h + a) * EAT_OFFSET * k * CAM.F;
        const d = w.displayAt(x, y);
        if (d && y > d.workArea.y + 20 * k && y < d.workArea.y + d.workArea.height - 6 * k && x > d.workArea.x + 12 * k && x < d.workArea.x + d.workArea.width - 12 * k) {
          spot = { x, y };
          break;
        }
      }
      const it = h.addItem('bread', spot.x, spot.y, { handFed: true });
      c.act({ type: 'eat', itemId: it.id });
      break;
    }
    case 'peck':
      c.act({ type: 'peck', count: 3 });
      break;
    case 'giftDrop':
      c.carry = { type: 'coin', seed: 3 };
      c.act({ type: 'giftDrop' });
      break;
    case 'reactClick': {
      const [bx, by] = h.bodyPoint();
      c.act({ type: 'reactClick', x: bx - Math.cos(c.h) * 14 * k, y: by });
      break;
    }
    case 'reactSpawn': {
      const t = spotFrom(h, 150, 2.4);
      const it = h.addItem('apple', t.x, t.y);
      c.act({ type: 'reactSpawn', itemId: it.id });
      break;
    }
    case 'held':
      h.grab();
      break;
    case 'dance':
      c.act({ type: 'dance', duration: 4.5, beat: 0.5 });
      break;
    case 'pet':
      c.act({ type: 'pet', duration: 2 });
      break;
    case 'poop':
      c.act({ type: 'poop' });
      break;
    default:
      throw new Error(`unknown state ${name}`);
  }
  return () => c.state === name;
}

module.exports = { request, spotFrom, D };
