'use strict';

const { World } = require('../src/core/world');
const { Crow } = require('../src/core/crow');
const { createRng } = require('../src/core/rng');
const { createItem, stepItem, ITEM_TYPES } = require('../src/core/items');
const { MotionChecker } = require('../src/core/qa');
const { computeRig, toWorld } = require('../src/core/rig');

const DT = 1 / 60;

const LAYOUTS = {
  single: [{ id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 824 } }],
  topTaskbar: [{ id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 36, width: 1536, height: 828 } }],
  leftTaskbar: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 62, y: 0, width: 1858, height: 1080 } }],
  rightTaskbar: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1858, height: 1080 } }],
  autoHide: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  dualEqual: [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
  ],
  dualNegativeTall: [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, bounds: { x: -2560, y: 0, width: 2560, height: 1440 }, workArea: { x: -2560, y: 0, width: 2560, height: 1440 } },
  ],
  stacked: [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, bounds: { x: 0, y: -1080, width: 1920, height: 1080 }, workArea: { x: 0, y: -1080, width: 1920, height: 1080 } },
  ],
  mixedDpi: [
    { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 0, width: 1280, height: 752 }, scaleFactor: 1.5 },
    { id: 2, bounds: { x: 1290, y: -280, width: 2560, height: 1440 }, workArea: { x: 1290, y: -280, width: 2560, height: 1400 }, scaleFactor: 1 },
  ],
};

function makeEnv(opts = {}) {
  const k = opts.scale || 1;
  const world = new World({ scale: k, perching: opts.perching !== false });
  world.setDisplays(opts.displays || LAYOUTS.single);
  if (opts.windows) world.setWindows(opts.windows);
  const rng = createRng(opts.seed == null ? 1234 : opts.seed);
  const items = new Map();
  const events = [];
  let cursor = opts.cursor || null;
  const env = {
    world,
    rng,
    getItem: (id) => items.get(id) || null,
    emit: (e) => {
      events.push(e);
      if (e.type === 'giftDropped') {
        const it = createItem(e.giftType, e.x, e.y, { gift: true });
        it.state = 'resting';
        items.set(it.id, it);
      } else if (e.type === 'dropCarried' && !e.carry.itemId) {
        const it = createItem(e.carry.type, e.x, e.y, { gift: true, z: e.z });
        items.set(it.id, it);
      }
    },
    cursor: () => cursor,
    annoyed: () => false,
  };
  const disp = world.displayById(opts.startDisplay || world.displays[0].id);
  const area = world.areaOf(disp.id);
  const x0 = opts.x != null ? opts.x : (area.x0 + area.x1) / 2;
  const y0 = opts.y != null ? opts.y : (area.y0 + area.y1) / 2;
  const crow = new Crow(env, { scale: k, x: x0, y: y0, h: opts.h || 0, perchId: opts.perchId });
  const checker = new MotionChecker(opts.checker || {});
  const h = {
    world,
    crow,
    items,
    events,
    checker,
    rng,
    k,
    drag: null,
    get cursor() {
      return cursor;
    },
    setCursor(c) {
      cursor = c;
    },
    addItem(type, x, y, extra = {}) {
      const it = createItem(type, x, y, extra);
      if (extra.handFed) it.handFed = true;
      items.set(it.id, it);
      return it;
    },
    bodyPoint() {
      const rig = computeRig(crow.pose);
      return toWorld(crow.pose, rig.body.cx, rig.body.cy);
    },
    grab() {
      const [bx, by] = h.bodyPoint();
      cursor = { x: bx, y: by };
      if (!crow.grab(bx, by)) return false;
      h.drag = { t: 0, x0: bx, y0: by, vx: 0, vy: 0 };
      return true;
    },
    release() {
      const d = h.drag;
      h.drag = null;
      return crow.release(d ? d.vx : 0, d ? d.vy : 0);
    },
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        if (h.drag) {
          const d = h.drag;
          d.t += DT;
          const ax = 110 * k;
          const ay = 70 * k;
          const b = world.displayAt(d.x0, d.y0) || world.displays[0];
          const bb = b.bounds;
          const x = Math.min(bb.x + bb.width - 5, Math.max(bb.x + 5, d.x0 + ax * Math.sin(d.t * 1.7)));
          const y = Math.min(bb.y + bb.height - 5, Math.max(bb.y + 5, d.y0 - ay * Math.sin(d.t * 2.3) * Math.abs(Math.sin(d.t * 0.9))));
          d.vx = (x - cursor.x) / DT;
          d.vy = (y - cursor.y) / DT;
          cursor = { x, y };
        }
        crow.step(DT);
        for (const it of items.values()) {
          stepItem(it, DT, world);
          if (it.state === 'gone') items.delete(it.id);
        }
        checker.check(crow, world, DT);
      }
    },
    runUntil(pred, maxSeconds = 10) {
      const maxFrames = Math.ceil(maxSeconds / DT);
      for (let i = 0; i < maxFrames; i++) {
        h.step(1);
        if (pred()) return true;
      }
      return false;
    },
    settle(maxSeconds = 10) {
      return h.runUntil(() => !crow.isBusy() && crow.state === 'idle' && crow.stateTime > 0.05, maxSeconds);
    },
  };
  return h;
}

module.exports = { makeEnv, LAYOUTS, DT, ITEM_TYPES };
