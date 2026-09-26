'use strict';

const { defaultPose, computeRig } = require('../../src/core/rig');
const { drawCrow } = require('../../src/renderer/draw');
const { DIMS: D } = require('../../src/core/dims');

const qa = window.qa;

function crowPose(k, h) {
  const p = defaultPose();
  p.k = k;
  p.x = 0;
  p.y = 0;
  p.h = h;
  for (const f of p.feet) f.th = h;
  p.hipH = D.hipStand;
  p.headA = -0.05;
  p.lookX = 0.6;
  p.lookY = -0.1;
  return p;
}

function badge(ctx, cx, cy, r, size) {
  const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  g.addColorStop(0, '#f6efe0');
  g.addColorStop(1, '#e7dcc4');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.strokeStyle = 'rgba(40, 42, 52, 0.6)';
  ctx.stroke();
}

function appIcon(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const r = size * 0.46;
  const cx = size / 2;
  const cy = size / 2;
  badge(ctx, cx, cy, r, size * 0.6);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - Math.max(1, size * 0.018) / 2, 0, Math.PI * 2);
  ctx.clip();
  const k = size / 88;
  const pose = crowPose(k, 0.35);
  pose.x = cx - 3 * k;
  pose.y = cy + r * 0.5;
  drawCrow(ctx, pose);
  ctx.restore();
  return c;
}

function trayIcon(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  badge(ctx, cx, cy, size * 0.47, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.47 - Math.max(1, size * 0.03) / 2, 0, Math.PI * 2);
  ctx.clip();
  const k = size / 30;
  const pose = crowPose(k, 0);
  const rig = computeRig(pose);
  pose.x = size * 0.36 - rig.head.x * k;
  pose.y = size * 0.56 - rig.head.y * k;
  drawCrow(ctx, pose);
  ctx.restore();
  return c;
}

async function main() {
  for (const s of [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]) {
    await qa.save(`app-${s}.png`, appIcon(s).toDataURL('image/png'));
  }
  for (const s of [16, 20, 24, 32, 40, 48, 64]) {
    await qa.save(`tray-${s}.png`, trayIcon(s).toDataURL('image/png'));
  }
  qa.done();
}

main().catch((e) => {
  qa.log(String(e && e.stack));
  qa.done(1);
});
