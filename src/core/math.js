'use strict';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeInOutSine(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
}

function easeOutCubic(t) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

function easeInCubic(t) {
  const u = clamp(t, 0, 1);
  return u * u * u;
}

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function rotate(x, y, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

function sign(v) {
  return v < 0 ? -1 : 1;
}

function springStep(x, v, target, omega, dt) {
  const y = x - target;
  const e = Math.exp(-omega * dt);
  const c = v + omega * y;
  return [target + (y + c * dt) * e, (v - omega * c * dt) * e];
}

function hermite(p0, m0, p1, m1, T, t) {
  const u = clamp(t / T, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p0 + h10 * T * m0 + h01 * p1 + h11 * T * m1;
}

function hermiteDeriv(p0, m0, p1, m1, T, t) {
  const u = clamp(t / T, 0, 1);
  const u2 = u * u;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  return (d00 * p0 + d10 * T * m0 + d01 * p1 + d11 * T * m1) / T;
}

function solveIK2(hx, hy, fx, fy, a, b, bend) {
  const dx = fx - hx;
  const dy = fy - hy;
  const d = Math.hypot(dx, dy);
  const maxD = a + b - 1e-6;
  const minD = Math.abs(a - b) + 1e-6;
  const dc = clamp(d, minD, maxD);
  const along = (a * a - b * b + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const ux = d > 1e-9 ? dx / d : 0;
  const uy = d > 1e-9 ? dy / d : 1;
  return {
    kx: hx + ux * along + uy * h * bend,
    ky: hy + uy * along - ux * h * bend,
    reach: d <= a + b + 1e-9,
    d,
  };
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

module.exports = {
  TAU,
  clamp,
  lerp,
  invLerp,
  smoothstep,
  easeInOutSine,
  easeOutCubic,
  easeInCubic,
  wrapAngle,
  lerpAngle,
  dist,
  rotate,
  sign,
  springStep,
  hermite,
  hermiteDeriv,
  solveIK2,
  rectsIntersect,
  pointInRect,
};
