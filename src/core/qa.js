'use strict';

const M = require('./math');
const { computeRig, keyPoints, bodyAxes, bodyToLocal, toWorld } = require('./rig');
const { DIMS: D, CAM } = require('./dims');
const { TRANSITIONS, REACH } = require('./crow');

const POINTS = [
  'hip', 'body', 'neck', 'head', 'beakTip', 'eye', 'tailTip', 'wingLTip', 'wingRTip',
  'kneeL', 'kneeR', 'footL', 'footR', 'toeL', 'toeR',
];
const FAST_POINTS = new Set(['wingLTip', 'wingRTip']);

const CHANNEL_LIMITS = Object.freeze({
  h: 0.4,
  hipH: 4.2,
  pitch: 0.16,
  headX: 6.5,
  headY: 6.5,
  headA: 0.32,
  headYaw: 0.34,
  wing: 0.3,
  flap: 0.9,
  tailA: 0.2,
  tailFan: 0.2,
  fluff: 0.22,
});
const ANGLE_CHANNELS = new Set(['h']);

function ellipsoidBottom(center, axes) {
  let s = 0;
  for (const a of axes) s += a[1] * a[1];
  return center[1] + Math.sqrt(s);
}

class MotionChecker {
  constructor(opts = {}) {
    this.opts = Object.assign(
      {
        popMin: 2.5,
        popRatio: 2.6,
        maxStep: 22,
        maxStepFast: 38,
        maxCarry: 34,
        maxAccel: 14000,
        eps: 1e-6,
        maxViolations: 200,
      },
      opts
    );
    this.frames = [];
    this.violations = [];
    this.counts = {};
    this.frameNo = 0;
    this.seenTransitions = 0;
    this.releasedAt = -1;
    this.stats = { frames: 0, plantedFrames: 0, airborneFrames: 0, states: {}, transitions: {} };
  }

  fail(kind, msg, extra) {
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    if (this.violations.length < this.opts.maxViolations) {
      this.violations.push(Object.assign({ kind, msg, frame: this.frameNo }, extra || {}));
    }
  }

  get ok() {
    return this.violations.length === 0;
  }

  summary() {
    return {
      ok: this.ok,
      frames: this.stats.frames,
      counts: Object.assign({}, this.counts),
      first: this.violations.slice(0, 8),
    };
  }

  check(crow, world, dt) {
    this.frameNo++;
    this.stats.frames++;
    const st = crow.state;
    this.stats.states[st] = (this.stats.states[st] || 0) + 1;
    const trs = crow.transitions;
    const total = crow.transitionCount != null ? crow.transitionCount : trs.length;
    if (total < this.seenTransitions) this.seenTransitions = 0;
    const fresh = Math.min(trs.length, total - this.seenTransitions);
    this.seenTransitions = total;
    for (let i = trs.length - fresh; i < trs.length; i++) {
      const tr = trs[i];
      const key = `${tr.from}->${tr.to}`;
      this.stats.transitions[key] = (this.stats.transitions[key] || 0) + 1;
      const allowed = TRANSITIONS[tr.from];
      const displayLost = tr.to === 'away' && (tr.reason === 'displayLost' || tr.reason === 'boxed' || tr.reason === 'hidden');
      if (!displayLost && (!allowed || !allowed.has(tr.to))) this.fail('transition', `illegal transition ${key}`);
      if (tr.from === 'sleep' && tr.to !== 'reactClick' && tr.to !== 'held' && tr.reason !== 'startled' && (tr.fromPhase !== 'wake' || (this.lastPose && this.lastPose.fluff > 0.12))) {
        this.fail('transition', `left sleep before waking up (phase=${tr.fromPhase})`);
      }
      if (tr.from === 'held' || tr.to === 'held') this.releasedAt = this.frameNo;
    }

    if (!crow.visible || st === 'away') {
      this.frames = [];
      this.prevStep = null;
      this.lastPose = null;
      return;
    }
    const pose = crow.pose;
    const k = pose.k;
    this.lastPose = { eye: pose.eye, fluff: pose.fluff };
    for (const key of ['x', 'y', 'z', 'h', 'hipH', 'pitch', 'headX', 'headY', 'headA', 'headYaw', 'beak', 'eye', 'wing', 'flap', 'tailA', 'tailFan', 'fluff']) {
      if (!Number.isFinite(pose[key])) this.fail('nan', `pose.${key} is ${pose[key]}`);
    }
    for (const f of pose.feet) {
      if (![f.x, f.y, f.lx, f.ly, f.lz, f.th].every(Number.isFinite)) this.fail('nan', 'foot not finite');
    }
    if (pose.wing < 0 || pose.wing > 1 || pose.eye < 0 || pose.eye > 1) this.fail('range', 'wing/eye out of [0,1]');
    if (pose.z < -1e-9) this.fail('range', `below the floor (z=${pose.z})`);

    const rig = computeRig(pose);
    const kp = keyPoints(rig);
    for (const n of POINTS) {
      if (!Number.isFinite(kp[n][0]) || !Number.isFinite(kp[n][1])) this.fail('nan', `keypoint ${n} not finite`);
    }

    const grounded = !crow.airborne;
    const shift = crow.shift || { dx: 0, dy: 0 };
    const perch = grounded ? world.perch(crow.perchId) : null;
    const floorY = grounded ? 0 : pose.z / k;
    const settling =
      (crow.displaysChangedAt != null && crow.time - crow.displaysChangedAt < 2.5) || (crow.shiftedAt != null && crow.time - crow.shiftedAt < 2.5) || (crow.perchLostAt != null && crow.time - crow.perchLostAt < 2.5);

    const below = (y) => y > floorY + 1e-6;
    const ba = bodyAxes(pose);
    if (below(ellipsoidBottom(ba.center, ba.axes))) this.fail('penetration', `body below the floor in ${st}`);
    const hf = rig.headFrame;
    if (below(hf.c[1] + hf.r)) this.fail('penetration', `head below the floor in ${st}`);
    for (const [name, pts] of [['tail', tailLocal(pose)], ['wingL', rig.wing3.L], ['wingR', rig.wing3.R]]) {
      for (const p of pts) {
        if (below(p[1])) {
          this.fail('penetration', `${name} below the floor by ${(p[1] - floorY).toFixed(3)} in ${st}`);
          break;
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const leg = rig.legs[i];
      if (leg.knee3[1] > floorY - 0.5) this.fail('penetration', `knee ${i} touches/below the floor in ${st}`);
      for (const seg of [leg.toes3.front, leg.toes3.front2, leg.toes3.back]) {
        for (const p of seg) {
          if (p[1] > floorY + 0.02) {
            this.fail('penetration', `toe ${i} below the floor by ${(p[1] - floorY).toFixed(3)} in ${st}`);
            break;
          }
        }
      }
    }

    if (grounded) {
      this.stats.plantedFrames++;
      if (pose.z !== 0) this.fail('anchor', `standing but z=${pose.z} in ${st}`);
      if (crow.perchId && !perch) this.fail('surface', `perched on a vanished perch in ${st}`);
      if (perch) {
        if (Math.abs(crow.y - perch.y) > 1e-6) this.fail('anchor', `anchor y ${crow.y} off its perch line ${perch.y} in ${st}`);
        if (crow.x < perch.x0 - 1e-6 || crow.x > perch.x1 + 1e-6) this.fail('anchor', `anchor off the end of its perch in ${st}`);
      } else if (!settling && !world.inWalkable(crow.x, crow.y, 1)) {
        this.fail('floor', `standing off the floor at ${crow.x.toFixed(1)},${crow.y.toFixed(1)} in ${st}`);
      }
      const prev = this.frames.length ? this.frames[this.frames.length - 1] : null;
      for (let i = 0; i < 2; i++) {
        const f = pose.feet[i];
        const leg = rig.legs[i];
        if (!f.planted) continue;
        if (Math.abs(f.ly + D.footLift) > 1e-6) this.fail('float', `planted foot ${i} not on the floor (ly=${f.ly.toFixed(4)}) in ${st}`);
        if (leg.d > REACH - 0.2) this.fail('float', `leg ${i} over-stretched (${leg.d.toFixed(3)} >= ${REACH}) in ${st}`);
        if (perch && (Math.abs(f.y - perch.y) > 1e-6 || f.x < perch.x0 - 1e-6 || f.x > perch.x1 + 1e-6)) this.fail('float', `planted foot ${i} off its perch in ${st}`);
        if (prev && prev.planted[i] && prev.grounded) {
          const dx = f.x - shift.dx - prev.feet[i][0];
          const dy = f.y - shift.dy - prev.feet[i][1];
          if (Math.hypot(dx, dy) > 1e-6) this.fail('slide', `planted foot ${i} slid ${Math.hypot(dx, dy).toFixed(4)}px in ${st}`);
        }
      }
      if (pose.feet[0].planted && pose.feet[1].planted) {
        const a = [pose.feet[0].lx, pose.feet[0].lz];
        const b = [pose.feet[1].lx, pose.feet[1].lz];
        const abx = b[0] - a[0];
        const abz = b[1] - a[1];
        const l2 = abx * abx + abz * abz || 1;
        const t = M.clamp(-(a[0] * abx + a[1] * abz) / l2, 0, 1);
        const d = Math.hypot(a[0] + abx * t, a[1] + abz * t);
        if (d > 9.5) this.fail('pivot', `body not over its feet (${d.toFixed(2)} units) in ${st}`);
      }
    } else {
      this.stats.airborneFrames++;
      for (let i = 0; i < 2; i++) {
        if (rig.legs[i].d > REACH + 1e-6) this.fail('float', `airborne leg ${i} over-stretched in ${st}`);
      }
    }

    if (st === 'fly' && crow.st && crow.st.mode === 'in' && world.insideDisplays(kp.body[0], kp.body[1], 45 * k)) crow.st.enteredScreen = true;
    const inbound = st === 'fly' && crow.st && crow.st.mode === 'in' && !crow.st.enteredScreen;
    const carried = st === 'held' || (st === 'fly' && crow.st && crow.st.mode === 'drop');
    const offscreenOk = (st === 'fly' && crow.st && crow.st.offscreen) || inbound || carried || settling;
    if (!offscreenOk && world.displays.length) {
      const bodyW = kp.body;
      const onScreen = world.onOrBetweenDisplays(bodyW[0], bodyW[1], 24 * k);
      if (!onScreen) this.fail('bounds', `body off-screen in ${st} at ${bodyW.map((v) => v.toFixed(1))}`);
      if (grounded) {
        const off = (pt) => {
          const c = toWorld(pose, pt[0], pt[1]);
          return !world.insideDisplays(c[0], c[1]) && !world.onOrBetweenDisplays(c[0], c[1], 2);
        };
        const ext = (e) => {
          const hx = Math.sqrt(e.rx * e.rx * Math.cos(e.rot) ** 2 + e.ry * e.ry * Math.sin(e.rot) ** 2);
          const hy = Math.sqrt(e.rx * e.rx * Math.sin(e.rot) ** 2 + e.ry * e.ry * Math.cos(e.rot) ** 2);
          return [[e.cx - hx, e.cy], [e.cx + hx, e.cy], [e.cx, e.cy - hy], [e.cx, e.cy + hy]];
        };
        const h = rig.head;
        const parts = {
          body: ext(rig.body),
          head: [[h.x, h.y - h.r], [h.x - h.r, h.y], [h.x + h.r, h.y], [h.x, h.y + h.r]],
          beak: rig.beak.upper.concat(rig.beak.lower),
          tail: rig.tail,
          legs: rig.legs.flatMap((l) => [l.knee, l.foot].concat(l.toes.front, l.toes.back)),
          shadow: ext(rig.shadow),
        };
        if (pose.wing < 0.1) Object.assign(parts, { wingL: rig.wingL, wingR: rig.wingR });
        const names = Object.keys(parts).filter((n) => parts[n].some(off));
        if (names.length) this.fail('bounds', `crow silhouette leaves the screen in ${st} (${names.join(', ')})`);
      }
    }

    const anchor = [pose.x, pose.y - pose.z * CAM.H];
    const frame = {
      pts: {},
      feet: pose.feet.map((f) => [f.x, f.y]),
      planted: pose.feet.map((f) => f.planted),
      grounded,
      state: st,
      shift: { dx: shift.dx, dy: shift.dy },
      anchor,
      hip: kp.hip,
      ch: {},
    };
    for (const c of Object.keys(CHANNEL_LIMITS)) frame.ch[c] = pose[c];
    const prevF = this.frames.length ? this.frames[this.frames.length - 1] : null;
    frame.anchorDisp = prevF ? { dx: anchor[0] - prevF.anchor[0], dy: anchor[1] - prevF.anchor[1] } : { dx: 0, dy: 0 };
    frame.handover = this.frameNo - this.releasedAt <= 2;
    if (prevF && frame.handover) {
      const d = Math.hypot(frame.anchorDisp.dx, frame.anchorDisp.dy);
      if (d > this.opts.maxCarry * k) this.fail('pop', `jumped ${d.toFixed(2)}px when let go (${prevF.state}->${st})`);
    }
    if (prevF) {
      for (const [c, lim] of Object.entries(CHANNEL_LIMITS)) {
        const raw = frame.ch[c] - prevF.ch[c];
        const dv = Math.abs(ANGLE_CHANNELS.has(c) ? M.wrapAngle(raw) : raw);
        if (dv > lim) this.fail('pop', `channel ${c} jumped ${dv.toFixed(3)} (limit ${lim}) at ${prevF.state}->${st}`);
      }
    }
    for (const n of POINTS) frame.pts[n] = kp[n];
    this.frames.push(frame);
    if (this.frames.length > 3) this.frames.shift();
    const Fr = this.frames;
    if (Fr.length >= 2) {
      const a = Fr[Fr.length - 2];
      const b = Fr[Fr.length - 1];
      const sb = a.handover || b.handover ? b.anchorDisp : b.shift;
      for (const n of POINTS) {
        const dx = b.pts[n][0] - a.pts[n][0] - sb.dx;
        const dy = b.pts[n][1] - a.pts[n][1] - sb.dy;
        const d = Math.hypot(dx, dy);
        const cap = (FAST_POINTS.has(n) ? this.opts.maxStepFast : this.opts.maxStep) * k;
        if (d > cap) this.fail('pop', `${n} jumped ${d.toFixed(2)}px in one frame (${a.state}->${b.state})`);
      }
    }
    if (Fr.length === 3) {
      const [a, b, c] = Fr;
      const rel = a.handover || b.handover || c.handover;
      const sh = (f) => (rel ? f.anchorDisp : f.shift);
      const disp = (p, q, n) => Math.hypot(q.pts[n][0] - p.pts[n][0] - sh(q).dx, q.pts[n][1] - p.pts[n][1] - sh(q).dy);
      for (const n of POINTS) {
        const d1 = disp(a, b, n);
        const d2 = disp(b, c, n);
        if (!rel && this.prevStep && this.prevStep[n] != null) {
          const d0 = this.prevStep[n];
          const fast = FAST_POINTS.has(n);
          const ratio = fast ? 4.5 : this.opts.popRatio;
          const minPx = fast ? 14 : this.opts.popMin;
          const lim = Math.max(minPx * k, ratio * Math.max(d0, d2) + 0.8 * k);
          if (d1 > lim) this.fail('pop', `${n} spiked ${d1.toFixed(2)}px (neighbours ${d0.toFixed(2)}, ${d2.toFixed(2)}) at ${a.state}->${b.state}`);
        }
      }
      for (const n of POINTS) {
        const lim = (FAST_POINTS.has(n) ? 30 : rel ? 5 : 4) * k;
        const mx = (a.pts[n][0] + sh(b).dx + c.pts[n][0] - sh(c).dx) / 2;
        const my = (a.pts[n][1] + sh(b).dy + c.pts[n][1] - sh(c).dy) / 2;
        const dev = Math.hypot(b.pts[n][0] - mx, b.pts[n][1] - my);
        if (dev > lim) this.fail('pop', `${n} twitched ${dev.toFixed(2)}px out of line for one frame (${a.state}->${b.state}->${c.state})`);
      }
      if (!rel) {
        const vx1 = (b.hip[0] - a.hip[0] - b.shift.dx) / dt;
        const vy1 = (b.hip[1] - a.hip[1] - b.shift.dy) / dt;
        const vx2 = (c.hip[0] - b.hip[0] - c.shift.dx) / dt;
        const vy2 = (c.hip[1] - b.hip[1] - c.shift.dy) / dt;
        const acc = Math.hypot(vx2 - vx1, vy2 - vy1) / dt;
        if (acc > this.opts.maxAccel * k) this.fail('snap', `hip acceleration ${acc.toFixed(0)}px/s^2 at ${b.state}->${c.state}`);
      }
      this.prevStep = rel ? null : {};
      if (!rel) for (const n of POINTS) this.prevStep[n] = disp(a, b, n);
    }
  }
}

function tailLocal(pose) {
  const fan = M.clamp(pose.tailFan, 0, 1);
  const a = D.tailAngle + pose.tailA;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const mx = (D.tailTop.x + D.tailBottom.x) / 2;
  const my = (D.tailTop.y + D.tailBottom.y) / 2;
  const len = D.tailLen + fan * 2 + 2.2 + fan * 1.5;
  return [bodyToLocal(pose, D.tailTop.x, D.tailTop.y), bodyToLocal(pose, D.tailBottom.x, D.tailBottom.y), bodyToLocal(pose, mx + dx * len, my + dy * len)];
}

module.exports = { MotionChecker, POINTS, CHANNEL_LIMITS, ellipsoidBottom };
