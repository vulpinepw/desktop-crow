'use strict';

const { computeRig } = require('../core/rig');
const { CAM } = require('../core/dims');
const art = require('./art');

const { pathPoly, pathSmooth, pathEllipse, strokeLine, mixColor, drawEmote, drawItemShape } = art;

const PALETTE = Object.freeze({
  body: '#1c1f28',
  bodyLight: '#2b3141',
  sheen: '#46527a',
  wing: '#272c39',
  wingUnder: '#15171e',
  wingEdge: '#4b5573',
  thigh: '#1c1f28',
  thighFar: '#15171d',
  tail: '#191b23',
  beak: '#2c2e35',
  beakRidge: '#565b68',
  beakLower: '#212228',
  leg: '#34363f',
  legFar: '#23252c',
  eyeWhite: '#eef1f7',
  pupil: '#07080b',
  shadow: 'rgba(0, 0, 0, 0.24)',
});

const LAYERS = Object.freeze(['shadow', 'legs', 'tail', 'body', 'wingL', 'wingR', 'head', 'emote']);

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function legStrokes(leg) {
  return [
    { pts: [leg.knee, leg.foot], w: 2.5 },
    { pts: leg.toes.front, w: 2 },
    { pts: leg.toes.front2, w: 1.7 },
    { pts: leg.toes.back, w: 1.9 },
  ];
}

function fillThigh(ctx, leg, color) {
  const [hx, hy] = leg.hip;
  const [kx, ky] = leg.knee;
  const dx = kx - hx;
  const dy = ky - hy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const w0 = 3.8;
  const w1 = 1.7;
  const ex = hx + dx * 0.86;
  const ey = hy + dy * 0.86;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(hx + nx * w0, hy + ny * w0);
  ctx.lineTo(ex + nx * w1, ey + ny * w1);
  ctx.lineTo(ex - nx * w1, ey - ny * w1);
  ctx.lineTo(hx - nx * w0, hy - ny * w0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex, ey, w1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx, hy, w0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLeg(ctx, leg, legColor, thighColor) {
  for (const s of legStrokes(leg)) strokeLine(ctx, s.pts, s.w, legColor);
  fillThigh(ctx, leg, thighColor);
}

function drawBody(ctx, rig) {
  pathEllipse(ctx, rig.body);
  ctx.fillStyle = PALETTE.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  pathEllipse(ctx, rig.sheen);
  ctx.fillStyle = PALETTE.bodyLight;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.restore();
}

function drawTail(ctx, rig) {
  pathSmooth(ctx, rig.tail);
  ctx.fillStyle = PALETTE.tail;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = PALETTE.wingEdge;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.9;
  for (const [a, b] of rig.tailLines) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWing(ctx, rig, side, depth) {
  const pts = side === 'L' ? rig.wingL : rig.wingR;
  const face = side === 'L' ? rig.wingFaceL : rig.wingFaceR;
  const top = smooth(-0.25, 0.25, face);
  const base = mixColor(PALETTE.wingUnder, PALETTE.wing, top);
  const apart = smooth(0.5, 5, Math.abs(depth - rig.depth.body));
  pathSmooth(ctx, pts);
  ctx.fillStyle = mixColor(PALETTE.body, base, apart);
  ctx.fill();
  const detail = apart * smooth(0.05, 0.45, face);
  if (detail > 0.01) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = PALETTE.wingEdge;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85 * detail;
    for (const i of [5, 7, 9]) {
      const a = pts[i];
      const c = pts[11];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(a[0] + (c[0] - a[0]) * 0.3, a[1] + (c[1] - a[1]) * 0.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5 * detail;
    ctx.strokeStyle = PALETTE.sheen;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[3][0], pts[3][1]);
    ctx.stroke();
    ctx.restore();
    pathSmooth(ctx, pts);
    ctx.save();
    ctx.strokeStyle = PALETTE.wingEdge;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.8 * detail;
    ctx.stroke();
    ctx.restore();
  }
}

function drawBeak(ctx, rig, conv) {
  const b = rig.beak;
  pathPoly(ctx, b.lower);
  ctx.fillStyle = mixColor(PALETTE.beakLower, PALETTE.body, conv);
  ctx.fill();
  pathPoly(ctx, b.upper);
  ctx.fillStyle = mixColor(PALETTE.beak, PALETTE.body, conv);
  ctx.fill();
  const a = 0.8 * b.ridgeVis * (1 - conv);
  if (a > 0.01) {
    ctx.save();
    ctx.globalAlpha *= a;
    strokeLine(ctx, [b.ridge[1], b.ridge[3], b.ridge[5]], 1.1, PALETTE.beakRidge);
    ctx.restore();
  }
}

function drawEyes(ctx, rig) {
  for (const e of rig.eyes) {
    if (e.vis <= 0.02) continue;
    ctx.save();
    ctx.globalAlpha *= e.vis;
    const rx = e.r * e.squash;
    const ry = e.r;
    if (e.open > 0.18) {
      ctx.beginPath();
      ctx.rect(e.x - e.r - 1, e.y - e.r * e.open, 2 * e.r + 2, 2 * e.r * e.open);
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, rx, ry, e.rot, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.eyeWhite;
      ctx.fill();
      ctx.clip();
      ctx.beginPath();
      ctx.arc(e.x + e.px, e.y + e.py, e.r * 0.68, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.pupil;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(e.x + e.px + 0.6, e.y + e.py - 0.7, 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r * 0.4, e.r * 0.95, Math.PI * 0.2, Math.PI * 0.8);
      ctx.strokeStyle = PALETTE.eyeWhite;
      ctx.globalAlpha *= 0.7;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function thermometerAlpha(pose) {
  const ill = pose.ill || 0;
  if (ill <= 0.01 || pose.carry) return 0;
  if (pose.state === 'eat' || pose.state === 'peck' || pose.state === 'giftDrop') return 0;
  return ill * (1 - smooth(0.18, 0.42, pose.beak || 0));
}

function drawThermometer(ctx, rig, alpha) {
  const t = rig.thermo;
  const dx = t.b[0] - t.a[0];
  const dy = t.b[1] - t.a[1];
  const len = Math.hypot(dx, dy);
  if (len < 4 || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha * smooth(4, 8, len);
  ctx.translate(t.a[0], t.a[1]);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.roundRect(-1, -1.25, len + 1, 2.5, 1.25);
  ctx.fillStyle = '#f5f9fc';
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = '#5b6576';
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(0, -0.42, len * 0.62, 0.84, 0.42);
  ctx.fillStyle = '#e23b3b';
  ctx.fill();
  ctx.strokeStyle = 'rgba(70, 80, 95, 0.75)';
  ctx.lineWidth = 0.35;
  for (let x = len * 0.3; x < len * 0.9; x += 1.6) {
    ctx.beginPath();
    ctx.moveTo(x, -1.2);
    ctx.lineTo(x, -0.55);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.roundRect(len - 1.4, -1.35, 2.2, 2.7, 1.1);
  ctx.fillStyle = '#cfd6df';
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = '#5b6576';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(len * 0.45, -0.75, len * 0.28, 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  ctx.restore();
}

function drawIceBag(ctx, rig, alpha, time) {
  const b = rig.iceBag;
  if (alpha <= 0.01) return;
  const s = b.r / 9;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(b.x, b.y);
  ctx.rotate(Math.atan2(b.uy, b.ux) + Math.PI / 2);
  ctx.scale((b.fx < 0 ? -1 : 1) * s, s);
  const sway = Math.sin((time || 0) * 1.7) * 0.05;
  ctx.rotate(-0.12 + sway);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8.8, -1.4);
  ctx.bezierCurveTo(-9.6, -5.6, -4.6, -8.2, 0.8, -8);
  ctx.bezierCurveTo(6.2, -7.8, 9.9, -5.2, 9.4, -1.2);
  ctx.bezierCurveTo(9.1, 1.4, 6.2, 2.4, 0.6, 2.2);
  ctx.bezierCurveTo(-4.8, 2, -8.3, 1.4, -8.8, -1.4);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, -8, 0, 2.4);
  grad.addColorStop(0, '#b9e3ff');
  grad.addColorStop(1, '#5aa9e3');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = '#25618f';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(37, 97, 143, 0.55)';
  ctx.lineWidth = 0.6;
  for (const [x0, y0, x1, y1, cx, cy] of [[-5.5, -1.2, -1.5, -5.6, -4.2, -4.2], [-0.6, 0.2, 3.6, -5.8, 2.2, -2.4], [4.4, 0.4, 7.4, -3.8, 6.8, -1.2]]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(1.8, -5.9, 3.6, 1.15, -0.12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8.6, -3.6);
  ctx.lineTo(-10.6, -4.6);
  ctx.lineTo(-10.6, -0.6);
  ctx.lineTo(-8.8, -1.1);
  ctx.closePath();
  ctx.fillStyle = '#7fbfe9';
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = '#25618f';
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-14.2, -5.4, 3.8, 5.6, 1.1);
  ctx.fillStyle = '#eef0f3';
  ctx.fill();
  ctx.strokeStyle = '#5b6576';
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.lineWidth = 0.45;
  for (const y of [-4.1, -2.6, -1.1]) {
    ctx.beginPath();
    ctx.moveTo(-13.8, y);
    ctx.lineTo(-10.8, y);
    ctx.stroke();
  }
  const drip = ((time || 0) * 0.45) % 1;
  ctx.globalAlpha *= Math.sin(drip * Math.PI);
  ctx.beginPath();
  const dy = 2.6 + drip * 3.2;
  ctx.moveTo(6.4, dy - 1.6);
  ctx.quadraticCurveTo(7.4, dy, 6.4, dy + 0.9);
  ctx.quadraticCurveTo(5.4, dy, 6.4, dy - 1.6);
  ctx.fillStyle = '#9fd3fb';
  ctx.fill();
  ctx.restore();
}

function drawHead(ctx, rig, pose, time) {
  const n = rig.neck;
  strokeLine(ctx, [[n.x0, n.y0], [n.x1, n.y1]], n.w, PALETTE.body);
  const b = rig.beak;
  const beakFirst = b.faceToCam < -0.25;
  const conv = 1 - smooth(0, 0.2, Math.abs(b.faceToCam + 0.25));
  const thermo = thermometerAlpha(pose);
  const carry = () => {
    if (thermo > 0.01) drawThermometer(ctx, rig, thermo);
    if (!pose.carry || !art.drawItemShape) return;
    ctx.save();
    ctx.translate(rig.carryPt[0], rig.carryPt[1]);
    ctx.rotate(rig.carryAng * 0.6);
    drawItemShape(ctx, pose.carry.type, 1, pose.carry.seed || 0);
    ctx.restore();
  };
  if (beakFirst) {
    drawBeak(ctx, rig, conv);
    carry();
  }
  const h = rig.head;
  ctx.beginPath();
  ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(h.x - 1.2, h.y - h.r * 0.45, h.r * 0.62, h.r * 0.34, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.bodyLight;
  ctx.globalAlpha = 0.45;
  ctx.fill();
  ctx.restore();
  drawEyes(ctx, rig);
  if (!beakFirst) {
    drawBeak(ctx, rig, conv);
    carry();
  }
}

function drawCrow(ctx, pose, opts = {}) {
  const rig = opts.rig || computeRig(pose);
  const k = pose.k;
  const order = [];
  const ax = pose.x;
  const ay = pose.y - (pose.z || 0) * CAM.H;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const sh = rig.shadow;
  if (sh.a > 0.01) {
    ctx.save();
    ctx.globalAlpha *= sh.a;
    pathEllipse(ctx, sh);
    ctx.fillStyle = PALETTE.shadow;
    ctx.fill();
    ctx.restore();
  }
  order.push('shadow');

  const sep = rig.sideSep;
  const legMid = mixColor(PALETTE.leg, PALETTE.legFar, 0.5);
  const thighMid = mixColor(PALETTE.thigh, PALETTE.thighFar, 0.5);
  rig.legOrder.forEach((i, n) => {
    const near = n === 1;
    drawLeg(ctx, rig.legs[i], mixColor(legMid, near ? PALETTE.leg : PALETTE.legFar, sep), mixColor(thighMid, near ? PALETTE.thigh : PALETTE.thighFar, sep));
  });
  order.push('legs');

  for (const part of rig.parts) {
    if (part.name === 'tail') drawTail(ctx, rig);
    else if (part.name === 'body') drawBody(ctx, rig);
    else if (part.name === 'wingL') drawWing(ctx, rig, 'L', part.d);
    else if (part.name === 'wingR') drawWing(ctx, rig, 'R', part.d);
    else if (part.name === 'head') {
      drawHead(ctx, rig, pose, opts.time);
      if ((pose.ill || 0) > 0.01) drawIceBag(ctx, rig, pose.ill, opts.time);
    }
    order.push(part.name);
  }
  ctx.restore();

  if (pose.emote) drawEmote(ctx, pose.emote, ax + k * rig.emotePt[0], ay + k * rig.emotePt[1], k);
  order.push('emote');
  return order;
}

module.exports = Object.assign({}, art, { PALETTE, LAYERS, drawCrow });
