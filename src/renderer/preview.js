'use strict';

const { World } = require('../core/world');
const { Crow } = require('../core/crow');
const { createRng } = require('../core/rng');
const { CAM } = require('../core/dims');
const { drawCrow } = require('./draw');

function createPreview(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let k = opts.scale || 1.6;
  let crow = null;
  let world = null;
  let raf = 0;
  let last = performance.now();
  let nextAct = 1.2;
  const rng = createRng(opts.seed || 7);
  let cssW = 0;
  let cssH = 0;

  function build() {
    const dpr = window.devicePixelRatio || 1;
    cssW = canvas.clientWidth || 360;
    cssH = canvas.clientHeight || 170;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    world = new World({ scale: k, perching: false, marginSide: 34, marginTop: 50, marginBottom: 12 });
    world.setDisplays([{ id: 1, bounds: { x: 0, y: 0, width: cssW, height: cssH }, workArea: { x: 0, y: 0, width: cssW, height: cssH } }]);
    const a = world.areas[0];
    const x = (a.x0 + a.x1) / 2;
    const y = a.ok ? (a.y0 + a.y1) / 2 : cssH - 16 * k;
    crow = new Crow({ world, rng, getItem: () => null, emit: () => {}, cursor: () => null, annoyed: () => false }, { scale: k, x, y, h: 0.25 });
  }

  function act() {
    const a = world.areas[0];
    const roll = rng.next();
    const spot = (minR, maxR) => world.randomWalkable(rng, { near: { x: crow.x, y: crow.y }, minR: minR * k, maxR: maxR * k }) || { x: crow.x, y: crow.y };
    if (!a.ok) crow.act({ type: 'idle', duration: 2 });
    else if (roll < 0.24) crow.act({ type: 'peck', count: rng.int(2, 3) });
    else if (roll < 0.44) {
      const t = spot(20, 50);
      crow.act({ type: 'hopTo', x: t.x, y: t.y });
    } else if (roll < 0.58) {
      const t = spot(40, 90);
      crow.act({ type: 'walkTo', x: t.x, y: t.y, speed: 30 });
    } else if (roll < 0.72) crow.act({ type: 'turn', h: crow.h + rng.sign() * rng.range(1.2, 2.6) });
    else if (roll < 0.8) crow.caw('chirp');
    else crow.act({ type: 'idle', duration: rng.range(1.5, 3) });
    nextAct = rng.range(2.2, 4.5);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    nextAct -= dt;
    if (nextAct <= 0 && !crow.isBusy() && crow.state === 'idle') act();
    let t = dt;
    while (t > 0) {
      const s = Math.min(1 / 60, t);
      crow.step(s);
      t -= s;
    }
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const g = ctx.createRadialGradient(crow.x, crow.y, 4, crow.x, crow.y, 90 * k);
    g.addColorStop(0, 'rgba(60, 64, 80, 0.10)');
    g.addColorStop(1, 'rgba(60, 64, 80, 0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(crow.x, crow.y);
    ctx.scale(1, CAM.F);
    ctx.translate(-crow.x, -crow.y);
    ctx.fillRect(0, -cssH, cssW, cssH * 3);
    ctx.restore();
    drawCrow(ctx, crow.pose);
    raf = requestAnimationFrame(frame);
  }

  build();
  raf = requestAnimationFrame(frame);

  return {
    setScale(nk) {
      k = nk;
      build();
    },
    caw() {
      crow.caw('caw');
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}

module.exports = { createPreview };
