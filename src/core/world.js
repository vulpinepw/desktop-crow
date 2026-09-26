'use strict';

const { clamp } = require('./math');
const { CAM } = require('./dims');

function rect(r) {
  return { x: +r.x || 0, y: +r.y || 0, width: Math.max(0, +r.width || 0), height: Math.max(0, +r.height || 0) };
}

function subtractInterval(list, a, b) {
  const out = [];
  for (const [x0, x1] of list) {
    if (b <= x0 || a >= x1) {
      out.push([x0, x1]);
      continue;
    }
    if (a > x0) out.push([x0, a]);
    if (b < x1) out.push([b, x1]);
  }
  return out;
}

class World {
  constructor(opts = {}) {
    this.opts = Object.assign(
      {
        scale: 1,
        perching: true,
        marginSide: 48,
        marginTop: 72,
        marginBottom: 22,
        minPerchUnits: 60,
        perchHeadroomUnits: 72,
        perchEndUnits: 12,
      },
      opts
    );
    this.displays = [];
    this.windows = [];
    this.areas = [];
    this.perches = [];
    this.byId = new Map();
    this.version = 0;
  }

  get k() {
    return this.opts.scale;
  }

  setScale(k) {
    this.opts.scale = k;
    this.rebuild();
  }

  setDisplays(list) {
    this.displays = (list || []).map((d, i) => ({
      id: d.id != null ? d.id : i + 1,
      bounds: rect(d.bounds),
      workArea: rect(d.workArea || d.bounds),
      scaleFactor: d.scaleFactor || 1,
    }));
    this.rebuild();
  }

  setWindows(list) {
    this.windows = (list || []).map((w) => ({
      id: String(w.id),
      x: +w.x,
      y: +w.y,
      width: +w.width,
      height: +w.height,
      occluderOnly: !!w.occluderOnly,
    }));
    this.rebuild();
  }

  rebuild() {
    const k = this.k;
    const o = this.opts;
    this.areas = this.displays.map((d) => {
      const wa = d.workArea;
      const x0 = wa.x + o.marginSide * k;
      const x1 = wa.x + wa.width - o.marginSide * k;
      const y0 = wa.y + o.marginTop * k;
      const y1 = wa.y + wa.height - o.marginBottom * k;
      return { displayId: d.id, x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1), ok: x1 > x0 && y1 > y0 };
    });
    const perches = [];
    const inset = (o.marginSide - o.perchEndUnits) * k;
    for (const d of this.displays) {
      const wa = d.workArea;
      const b = d.bounds;
      if (wa.y + wa.height < b.y + b.height - 1 && wa.y + wa.height > b.y + o.perchHeadroomUnits * k) {
        perches.push({ id: `bar:${d.id}`, kind: 'taskbar', y: wa.y + wa.height, x0: wa.x + inset, x1: wa.x + wa.width - inset, displayId: d.id, windowId: null });
      }
    }
    if (o.perching) {
      const minLen = o.minPerchUnits * k;
      const headroom = o.perchHeadroomUnits * k;
      const ws = this.windows;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        if (w.occluderOnly || w.width < minLen || w.height < 40) continue;
        const y = w.y;
        let segs = [[w.x, w.x + w.width]];
        for (let j = 0; j < i && segs.length; j++) {
          const u = ws[j];
          if (u.y - 1 <= y && u.y + u.height >= y - 1) segs = subtractInterval(segs, u.x - 1, u.x + u.width + 1);
        }
        const clipped = [];
        for (const d of this.displays) {
          const wa = d.workArea;
          if (y < wa.y + headroom || y > wa.y + wa.height - o.marginBottom * k) continue;
          for (const [a, bb] of segs) {
            const x0 = Math.max(a, wa.x + inset);
            const x1 = Math.min(bb, wa.x + wa.width - inset);
            if (x1 - x0 >= minLen) clipped.push([x0, x1, d.id]);
          }
        }
        clipped.sort((p, q) => p[0] - q[0]);
        clipped.forEach(([x0, x1, did], n) => {
          perches.push({ id: `win:${w.id}:${n}`, kind: 'window', y, x0, x1, displayId: did, windowId: w.id, win: { x: w.x, y: w.y, width: w.width, height: w.height } });
        });
      }
    }
    this.perches = perches;
    this.byId = new Map(perches.map((p) => [p.id, p]));
    this.version++;
  }

  perch(id) {
    return id ? this.byId.get(id) || null : null;
  }

  perchRange(p) {
    if (!p) return null;
    const m = this.opts.perchEndUnits * this.k;
    const x0 = p.x0 + m;
    const x1 = p.x1 - m;
    return x1 >= x0 ? { x0, x1, y: p.y } : null;
  }

  perchAt(x, y, tolY = 0.5) {
    for (const p of this.perches) {
      if (Math.abs(p.y - y) <= tolY && x >= p.x0 - 0.5 && x <= p.x1 + 0.5) return p;
    }
    return null;
  }

  areaOf(displayId) {
    return this.areas.find((a) => a.displayId === displayId) || null;
  }

  areaAt(x, y, tol = 0) {
    for (const a of this.areas) {
      if (x >= a.x0 - tol && x <= a.x1 + tol && y >= a.y0 - tol && y <= a.y1 + tol) return a;
    }
    return null;
  }

  inWalkable(x, y, tol = 0) {
    return !!this.areaAt(x, y, tol);
  }

  clampWalkable(x, y, displayId) {
    let best = null;
    let bestD = Infinity;
    for (const a of this.areas) {
      if (displayId != null && a.displayId !== displayId) continue;
      const cx = clamp(x, a.x0, a.x1);
      const cy = clamp(y, a.y0, a.y1);
      const dd = Math.hypot(cx - x, (cy - y) / CAM.F);
      if (dd < bestD) {
        bestD = dd;
        best = { x: cx, y: cy, displayId: a.displayId };
      }
    }
    if (!best && displayId != null) return this.clampWalkable(x, y);
    return best;
  }

  segmentWalkable(x0, y0, x1, y1, tol = 0.5) {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.inWalkable(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, tol)) return false;
    }
    return true;
  }

  randomWalkable(rng, opts = {}) {
    const areas = this.areas.filter((a) => a.ok && (opts.displayId == null || a.displayId === opts.displayId));
    if (!areas.length) return null;
    for (let tries = 0; tries < 20; tries++) {
      let x;
      let y;
      if (opts.near) {
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(opts.minR || 0, opts.maxR || 300);
        x = opts.near.x + Math.cos(ang) * r;
        y = opts.near.y + Math.sin(ang) * r * CAM.F;
      } else {
        const a = rng.weighted(areas, (q) => (q.x1 - q.x0) * (q.y1 - q.y0) + 1);
        x = rng.range(a.x0, a.x1);
        y = rng.range(a.y0, a.y1);
      }
      const a = this.areaAt(x, y);
      if (a && (opts.displayId == null || a.displayId === opts.displayId)) return { x, y, displayId: a.displayId };
    }
    const c = opts.near ? this.clampWalkable(opts.near.x, opts.near.y, opts.displayId) : null;
    return c || { x: (areas[0].x0 + areas[0].x1) / 2, y: (areas[0].y0 + areas[0].y1) / 2, displayId: areas[0].displayId };
  }

  displayAt(x, y) {
    for (const d of this.displays) {
      const b = d.bounds;
      if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return d;
    }
    return null;
  }

  nearestDisplay(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const d of this.displays) {
      const b = d.bounds;
      const cx = clamp(x, b.x, b.x + b.width);
      const cy = clamp(y, b.y, b.y + b.height);
      const dd = Math.hypot(cx - x, cy - y);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  displayById(id) {
    return this.displays.find((d) => d.id === id) || null;
  }

  onOrBetweenDisplays(x, y, tol) {
    if (this.displayAt(x, y)) return true;
    let near = 0;
    for (const d of this.displays) {
      const b = d.bounds;
      const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
      if (Math.hypot(dx, dy) <= tol) near++;
    }
    return near >= 2;
  }

  insideDisplays(x, y, margin = 0) {
    for (const d of this.displays) {
      const b = d.bounds;
      if (x >= b.x + margin && x <= b.x + b.width - margin && y >= b.y + margin && y <= b.y + b.height - margin) return true;
    }
    return false;
  }

  edgeExit(d, nearX, nearY, out) {
    const b = d.bounds;
    const wa = d.workArea;
    const k = this.k;
    const ex = clamp(nearX, wa.x + 60 * k, wa.x + wa.width - 60 * k);
    const ey = clamp(nearY, wa.y + 60 * k, wa.y + wa.height - 30 * k);
    const clear = (x0, y0, x1, y1) => {
      for (let i = 0; i <= 8; i++) {
        const x = x0 + ((x1 - x0) * i) / 8;
        const y = y0 + ((y1 - y0) * i) / 8;
        if (this.displayAt(x, y)) return false;
      }
      return true;
    };
    const cands = [
      { side: 'left', d: nearX - b.x, x: b.x - out, y: ey, ok: clear(b.x - 2, ey, b.x - out, ey) },
      { side: 'right', d: b.x + b.width - nearX, x: b.x + b.width + out, y: ey, ok: clear(b.x + b.width + 2, ey, b.x + b.width + out, ey) },
      { side: 'top', d: (nearY - b.y) * 0.8, x: ex, y: b.y - out, ok: clear(ex, b.y - 2, ex, b.y - out) },
      { side: 'bottom', d: (b.y + b.height - nearY) * 1.4, x: ex, y: b.y + b.height + out, ok: clear(ex, b.y + b.height + 2, ex, b.y + b.height + out) },
    ].filter((c) => c.ok);
    if (cands.length) {
      cands.sort((p, q) => p.d - q.d);
      return { x: cands[0].x, y: cands[0].y, side: cands[0].side };
    }
    const u = this.union();
    return nearX - u.x < u.x + u.width - nearX ? { x: u.x - out, y: ey, side: 'left' } : { x: u.x + u.width + out, y: ey, side: 'right' };
  }

  union() {
    if (!this.displays.length) return { x: 0, y: 0, width: 0, height: 0 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const d of this.displays) {
      const b = d.bounds;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width);
      y1 = Math.max(y1, b.y + b.height);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
}

module.exports = { World };
