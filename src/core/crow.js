'use strict';

const M = require('./math');
const { DIMS: D, CAM } = require('./dims');
const { defaultPose, hipLocal, headFrame, headLocal } = require('./rig');
const { ITEM_TYPES } = require('./items');

const ANIM_STATES = Object.freeze([
  'idle', 'walk', 'hop', 'fly', 'land', 'perch', 'eat', 'sleep', 'peck', 'giftDrop', 'reactClick', 'reactSpawn', 'held', 'dance', 'pet',
]);

const GROUND = ['idle', 'walk', 'hop', 'perch', 'eat', 'sleep', 'peck', 'giftDrop', 'reactClick', 'reactSpawn', 'dance', 'pet'];

const TRANSITIONS = Object.freeze({
  idle: new Set([...GROUND, 'fly', 'held']),
  walk: new Set([...GROUND, 'fly', 'held']),
  hop: new Set([...GROUND.filter((s) => s !== 'hop'), 'hop', 'fly', 'held']),
  fly: new Set(['land', 'away', 'fly', 'held']),
  land: new Set([...GROUND.filter((s) => s !== 'sleep'), 'sleep', 'fly', 'held']),
  perch: new Set([...GROUND, 'fly', 'held']),
  eat: new Set([...GROUND, 'fly', 'held']),
  sleep: new Set([...GROUND, 'fly', 'held']),
  peck: new Set([...GROUND, 'fly', 'held']),
  giftDrop: new Set([...GROUND, 'fly', 'held']),
  reactClick: new Set([...GROUND, 'fly', 'held']),
  reactSpawn: new Set([...GROUND, 'fly', 'held']),
  dance: new Set([...GROUND, 'fly', 'held']),
  pet: new Set([...GROUND, 'fly', 'held']),
  held: new Set(['fly']),
  away: new Set(['fly']),
});

const OMEGA = Object.freeze({
  hipH: 14, pitch: 10, headX: 15, headY: 15, headA: 13, headYaw: 11, beak: 26, eye: 42,
  lookX: 10, lookY: 10, wing: 12, flapBase: 10, flapAmp: 10, tailA: 11, tailFan: 9, fluff: 4,
});
const CH = Object.keys(OMEGA);
const VMAX = Object.freeze({ headX: 320, headY: 320, hipH: 170, headA: 13, headYaw: 10, pitch: 7 });

const REACH = D.legUpper + D.legLower;
const REACH_SAFE = REACH - 0.45;
const STEP_TRIGGER = 5.2;
const STEP_AHEAD = 5.4;
const RIDE_MAX = 36;
const TURN_WALK = 3.4;
const TURN_STAND = 2.2;
const HOLD_SPEED_MAX = 1900;
const THROW_MAX = 900;
const F = CAM.F;
const H = CAM.H;

function newFoot(i) {
  const side = i === 0 ? 1 : -1;
  return {
    i,
    side,
    planted: true,
    x: 0,
    y: 0,
    th: 0,
    lift: 0,
    lx: side * D.stanceX,
    ly: -D.footLift,
    lz: side * D.stanceZ,
    curl: 0,
    curlV: 0,
    swing: null,
    slx: 0,
    sly: 0,
    slz: 0,
    svx: 0,
    svy: 0,
    svz: 0,
  };
}

class Crow {
  constructor(env, opts = {}) {
    this.env = env;
    this.world = env.world;
    this.rng = env.rng;
    this.k = opts.scale || 1;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.z = 0;
    this.h = opts.h != null ? opts.h : opts.facing === -1 ? Math.PI : 0;
    this.hv = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.airborne = false;
    this.perchId = opts.perchId || null;
    this.c = {};
    this.cv = {};
    this.ct = {};
    this.om = {};
    const dp = defaultPose();
    for (const ch of CH) {
      const v = ch === 'flapBase' || ch === 'flapAmp' ? 0 : dp[ch];
      this.c[ch] = v;
      this.cv[ch] = 0;
      this.ct[ch] = v;
      this.om[ch] = OMEGA[ch];
    }
    this.flapPhase = 0;
    this.flapFreq = 0;
    this.direct = new Set();
    this.feet = [newFoot(0), newFoot(1)];
    this.state = 'idle';
    this.stateTime = 0;
    this.st = {};
    this.queue = [];
    this.action = null;
    this.time = 0;
    this.emote = null;
    this.carry = null;
    this.lookTarget = null;
    this.blinkT = 1.5;
    this.blinkPhase = 0;
    this.lookAroundT = 0;
    this.visible = true;
    this.shift = { dx: 0, dy: 0 };
    this.pendingShift = { dx: 0, dy: 0 };
    this.transitions = [];
    this.transitionCount = 0;
    this.pose = defaultPose();
    this.pose.k = this.k;
    this.plantFeetAtRest();
    this.composePose();
  }

  emit(type, data) {
    if (this.env.emit) this.env.emit(Object.assign({ type }, data || {}));
  }

  perch() {
    return this.world.perch(this.perchId);
  }

  standable(x, y, perchId) {
    const p = this.world.perch(perchId);
    if (p) {
      const r = this.world.perchRange(p);
      return !!r && Math.abs(y - p.y) < 1e-6 && x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6;
    }
    return this.world.inWalkable(x, y, 0.5);
  }

  floorToLocal(wx, wy) {
    const c = Math.cos(this.h);
    const s = Math.sin(this.h);
    const dx = (wx - this.x) / this.k;
    const dy = (wy - this.y) / (this.k * F);
    return [dx * c + dy * s, dx * s - dy * c];
  }

  localToFloor(lx, lz) {
    const c = Math.cos(this.h);
    const s = Math.sin(this.h);
    return [this.x + this.k * (lx * c + lz * s), this.y + this.k * (lx * s - lz * c) * F];
  }

  homeFloor(i) {
    const side = i === 0 ? 1 : -1;
    return this.localToFloor(side * D.stanceX, side * D.stanceZ);
  }

  static floorDist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, (by - ay) / F);
  }

  headingTo(wx, wy) {
    return Math.atan2((wy - this.y) / F, wx - this.x);
  }

  plantFeetAtRest() {
    for (const f of this.feet) {
      const [x, y] = this.homeFloor(f.i);
      f.planted = true;
      f.swing = null;
      f.x = x;
      f.y = y;
      f.th = this.h;
      f.lift = 0;
      f.lx = f.side * D.stanceX;
      f.ly = -D.footLift;
      f.lz = f.side * D.stanceZ;
      f.curl = 0;
    }
  }

  setT(t) {
    for (const key in t) this.ct[key] = t[key];
  }

  setOm(o) {
    for (const key in o) this.om[key] = o[key];
  }

  resetOm() {
    for (const ch of CH) this.om[ch] = OMEGA[ch];
  }

  showEmote(kind, dur = 1.2, loop = false) {
    this.emote = { kind, t0: this.time, dur, loop };
  }

  caw(kind = 'caw') {
    if (this.state === 'sleep' || this.state === 'away') return;
    this.cawT = kind === 'chirp' ? 0.16 : 0.34;
    this.cawKind = kind;
    this.emit('sound', { name: kind });
    if (kind === 'chirp') this.showEmote('note', 1);
  }

  flinch() {
    this.cv.flapAmp += 3;
    this.showEmote('alert', 0.8);
    this.emit('sound', { name: 'caw' });
  }

  clearEmote(kind) {
    if (this.emote && (!kind || this.emote.kind === kind)) this.emote = null;
  }

  footLocal(f) {
    if (this.airborne) return [f.lx, f.ly, f.lz];
    const [lx, lz] = this.floorToLocal(f.x, f.y);
    return [lx, -D.footLift - f.lift, lz];
  }

  footReach(i) {
    const f = this.feet[i];
    const p = this.footLocal(f);
    const hp = hipLocal({ hipH: this.c.hipH }, i);
    return Math.hypot(p[0] - hp[0], p[1] - hp[1], p[2] - hp[2]);
  }

  maxHipForFeet() {
    let hMax = Infinity;
    for (const f of this.feet) {
      const p = this.footLocal(f);
      const hp = hipLocal({ hipH: 0 }, f.i);
      const dx = p[0] - hp[0];
      const dz = p[2] - hp[2];
      const h = Math.sqrt(Math.max(0, REACH_SAFE * REACH_SAFE - dx * dx - dz * dz)) - p[1];
      if (h < hMax) hMax = h;
    }
    return hMax;
  }

  startSwing(i, x1, y1, dur, liftUnits, th1) {
    const f = this.feet[i];
    f.swing = { x0: f.x, y0: f.y, x1, y1, th0: f.th, th1: th1 == null ? this.h : th1, t: 0, dur, lift: liftUnits };
    f.planted = false;
  }

  clampFoot(x, y) {
    const p = this.perch();
    if (p) return [M.clamp(x, p.x0 + 1.5 * this.k, p.x1 - 1.5 * this.k), p.y];
    return [x, y];
  }

  updateFeet(dt) {
    const k = this.k;
    if (this.airborne) {
      const tg = this.st.airFeet || this.defaultAirFeet();
      const om = this.st.airFeetOmega || 16;
      const lbs = this.landBlendStance(dt);
      for (const f of this.feet) {
        const t = tg[f.i];
        let r = M.springStep(f.slx, f.svx, t.lx, om, dt);
        f.slx = r[0];
        f.svx = r[1];
        r = M.springStep(f.sly, f.svy, t.ly, om, dt);
        f.sly = r[0];
        f.svy = r[1];
        r = M.springStep(f.slz, f.svz, t.lz, om, dt);
        f.slz = r[0];
        f.svz = r[1];
        let lx = f.slx;
        let ly = f.sly;
        let lz = f.slz;
        const lb = this.st.landBlend;
        if (lbs) {
          lx = M.lerp(lx, lbs[f.i].lx, lb.w);
          ly = M.lerp(ly, lbs[f.i].ly, lb.w);
          lz = M.lerp(lz, lbs[f.i].lz, lb.w);
        }
        const hp = hipLocal({ hipH: this.c.hipH }, f.i);
        const dx = lx - hp[0];
        const dy = ly - hp[1];
        const dz = lz - hp[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > REACH_SAFE) {
          lx = hp[0] + (dx / d) * REACH_SAFE;
          ly = hp[1] + (dy / d) * REACH_SAFE;
          lz = hp[2] + (dz / d) * REACH_SAFE;
        }
        f.lx = lx;
        f.ly = ly;
        f.lz = lz;
        const fl = this.localToFloor(lx, lz);
        f.x = fl[0];
        f.y = fl[1];
        f.th = M.wrapAngle(f.th + M.wrapAngle(this.h - f.th) * (1 - Math.exp(-14 * dt)));
        const baseCurl = this.st.airCurl == null ? 1 : this.st.airCurl;
        const cr = M.springStep(f.curl, f.curlV, lb && lb.w > 0 ? M.lerp(baseCurl, 0, lb.w) : baseCurl, 14, dt);
        f.curl = cr[0];
        f.curlV = cr[1];
        if (lb && lb.w > 0) f.curl = Math.min(f.curl, (1 - lb.w) * baseCurl);
        const allowed = this.toeClearanceCurl(f, f.curl);
        if (allowed < f.curl) {
          f.curl = allowed;
          f.curlV = Math.min(f.curlV, 0);
        }
      }
      return;
    }
    for (const f of this.feet) {
      if (f.swing) {
        const sw = f.swing;
        sw.t += dt;
        const u = Math.min(1, sw.t / sw.dur);
        const e = M.easeInOutSine(u);
        f.x = M.lerp(sw.x0, sw.x1, e);
        f.y = M.lerp(sw.y0, sw.y1, e);
        f.th = sw.th0 + M.wrapAngle(sw.th1 - sw.th0) * e;
        f.lift = sw.lift * Math.sin(Math.PI * u);
        f.curl = 0.35 * Math.sin(Math.PI * u);
        if (u >= 1) {
          f.x = sw.x1;
          f.y = sw.y1;
          f.th = sw.th1;
          f.lift = 0;
          f.swing = null;
          f.planted = true;
          f.curl = 0;
          this.emit('footstep', { foot: f.i, x: f.x, y: f.y });
        }
      }
      const [lx, lz] = this.floorToLocal(f.x, f.y);
      f.lx = lx;
      f.lz = lz;
      f.ly = -D.footLift - f.lift;
    }
  }

  reseatAirFeet() {
    for (const f of this.feet) {
      f.slx = f.lx;
      f.sly = f.ly;
      f.slz = f.lz;
    }
  }

  defaultAirFeet() {
    return [
      { lx: -5, ly: -16.6, lz: 2.4 },
      { lx: -7, ly: -17, lz: -2.4 },
    ];
  }

  setLandBlend(w, perchId, dt, final = false) {
    const lb = this.st.landBlend || (this.st.landBlend = { w: 0 });
    lb.w = final ? 1 : dt > 0 ? M.clamp(w, lb.w - 8 * dt, lb.w + 8 * dt) : w;
    lb.perchId = perchId || null;
    lb.frozen = null;
    return lb;
  }

  landBlendStance(dt) {
    const lb = this.st.landBlend;
    if (!lb || !(lb.w > 0)) return null;
    const key = lb.frozen ? 'frozen' : String(lb.perchId || '');
    const want = lb.frozen || this.landingStance(lb.perchId);
    if (lb.key != null && lb.key !== key && lb.last) {
      lb.from = lb.last;
      lb.ft = 0;
    }
    lb.key = key;
    let out = want;
    if (lb.from) {
      lb.ft += dt;
      const s = M.smoothstep(0, 0.25, lb.ft);
      out = want.map((q, i) => ({ lx: M.lerp(lb.from[i].lx, q.lx, s), ly: M.lerp(lb.from[i].ly, q.ly, s), lz: M.lerp(lb.from[i].lz, q.lz, s) }));
      if (s >= 1) lb.from = null;
    }
    lb.last = out;
    return out;
  }

  landingStance(perchId) {
    const p = perchId ? this.world.perch(perchId) : null;
    return [0, 1].map((i) => {
      const side = i === 0 ? 1 : -1;
      if (!p) return { lx: side * D.stanceX, ly: -D.footLift, lz: side * D.stanceZ };
      const [hx] = this.homeFloor(i);
      const x = M.clamp(hx, p.x0 + 1.5 * this.k, p.x1 - 1.5 * this.k);
      const [lx, lz] = this.floorToLocal(x, p.y);
      return { lx, ly: -D.footLift, lz };
    });
  }

  toeClearanceCurl(f, want) {
    const gap = this.z / this.k - f.ly;
    const lowest = (c) => {
      const af = c * 1.15;
      const ab = c * 0.85;
      return Math.max(Math.sin(af) * D.toeFront, Math.sin(af + 0.18 * c) * (D.toeFront - 1.8), Math.sin(ab) * D.toeBack, 0);
    };
    if (gap > 12 || lowest(want) <= gap - 0.05) return want;
    if (gap <= 0.05) return 0;
    let lo = 0;
    let hi = want;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (lowest(mid) <= gap - 0.05) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  gait(mx, my, speed) {
    if (this.feet.some((f) => f.swing)) return;
    const k = this.k;
    let best = null;
    let bestScore = -Infinity;
    for (const f of this.feet) {
      const home = this.homeFloor(f.i);
      const ex = (f.x - home[0]) / k;
      const ey = (f.y - home[1]) / (k * F);
      const along = ex * mx + ey * my;
      const lat = -ex * my + ey * mx;
      const score = -along + Math.abs(lat) * 0.8 + Math.abs(M.wrapAngle(f.th - this.h)) * 4;
      if (score > bestScore) {
        bestScore = score;
        best = { f, home };
      }
    }
    const strained = this.feet.some((f) => this.footReach(f.i) > REACH - 1.4);
    if (bestScore > STEP_TRIGGER || strained) {
      const sp = speed / k;
      const dur = M.clamp(0.19 - sp * 0.0007, 0.12, 0.19);
      const lead = STEP_AHEAD + (best.f.i === 0 ? 0.3 : -0.3);
      let tx = best.home[0] + k * mx * lead + this.vx * dur;
      let ty = best.home[1] + k * my * lead * F + this.vy * dur;
      [tx, ty] = this.clampFoot(tx, ty);
      this.startSwing(best.f.i, tx, ty, dur, 3.2, this.h);
    }
  }

  settleFeet(tol = 1.3) {
    if (this.feet.some((f) => f.swing)) return false;
    const k = this.k;
    let worst = null;
    let worstE = tol;
    for (const f of this.feet) {
      const home = this.clampFoot(...this.homeFloor(f.i));
      const e = Math.hypot((f.x - home[0]) / k, (f.y - home[1]) / (k * F)) + Math.max(0, Math.abs(M.wrapAngle(f.th - this.h)) - 0.5) * 6;
      if (e > worstE) {
        worstE = e;
        worst = { f, home };
      }
    }
    if (!worst) return true;
    this.startSwing(worst.f.i, worst.home[0], worst.home[1], 0.15, 2.4, this.h);
    return false;
  }

  balanceGuard() {
    if (this.feet.some((f) => f.swing)) return;
    for (const f of this.feet) {
      if (!f.planted) continue;
      const p = this.footLocal(f);
      const reach = this.footReach(f.i);
      if (reach > REACH - 1.2 || Math.abs(p[0]) > 13.5 || Math.abs(p[2]) > 9.5 || p[2] * f.side < -2.5) {
        const home = this.homeFloor(f.i);
        const [tx, ty] = this.clampFoot(home[0] + this.vx * 0.12, home[1] + this.vy * 0.12);
        this.startSwing(f.i, tx, ty, 0.12, 2.6, this.h);
        this.emit('balanceStep', { foot: f.i, reach });
        return;
      }
    }
  }

  turnToward(dt, target, maxRate, omega = 10) {
    const err = M.wrapAngle(target - this.h);
    const r = M.springStep(this.h, this.hv, this.h + err, omega, dt);
    let nh = r[0];
    let nv = r[1];
    if (Math.abs(nv) > maxRate) {
      nv = Math.sign(nv) * maxRate;
      const moved = nh - this.h;
      if (Math.abs(moved) > maxRate * dt) nh = this.h + Math.sign(moved) * maxRate * dt;
    }
    this.h = M.wrapAngle(nh);
    this.hv = nv;
    return Math.abs(M.wrapAngle(target - this.h));
  }

  holdHeading(dt) {
    this.hv *= Math.exp(-14 * dt);
    if (Math.abs(this.hv) < 1e-3) this.hv = 0;
    this.h = M.wrapAngle(this.h + this.hv * dt);
  }

  standTargets(extra) {
    const t = this.stateTime;
    this.setT({
      hipH: D.hipStand + 0.35 * Math.sin((t * Math.PI * 2) / 3.2),
      pitch: 0.04,
      headX: D.headIdle.x,
      headY: D.headIdle.y,
      headA: 0.1,
      headYaw: 0,
      beak: 0,
      lookX: 0.3,
      lookY: 0,
      wing: 0,
      flapBase: 0,
      flapAmp: 0,
      tailA: 0.03 * Math.sin(t * 1.3),
      tailFan: 0,
      fluff: 0,
    });
    if (extra) this.setT(extra);
  }

  lookAtPoint(wx, wy, strength = 1, atEye = false) {
    const [lx, lz] = this.floorToLocal(wx, wy);
    const hx = this.c.headX;
    const yaw = Math.atan2(lz, lx - hx * 0.5);
    const dist = Math.hypot(lx - hx, lz);
    this.ct.headYaw = M.clamp(yaw, -1.9, 1.9) * strength;
    this.ct.headA = atEye ? -0.05 * strength : M.clamp(0.05 + Math.atan2(40, Math.max(10, dist)) * 0.45, -0.3, 0.8) * strength;
    this.ct.lookX = M.clamp(Math.sin(yaw) * 0.6, -1, 1);
    this.ct.lookY = atEye ? 0 : M.clamp(0.4 - dist / 400, -0.5, 0.6);
  }

  eyeLevelFloor(x, y) {
    return [x, y + (this.z + 42 * this.k) * H];
  }

  applyLookTarget() {
    const lt = this.lookTarget;
    if (!lt) return false;
    if (lt.until != null && this.time > lt.until) {
      this.lookTarget = null;
      return false;
    }
    this.lookAtPoint(lt.x, lt.y, lt.strength || 1, !!lt.atEye);
    return true;
  }

  idleLook(dt, calm = false) {
    if (this.applyLookTarget()) return;
    this.lookAroundT -= dt;
    if (this.lookAroundT <= 0) {
      const r = this.rng;
      this.lookAroundT = calm ? r.range(2.5, 6) : r.range(1.1, 3.6);
      const back = !calm && r.chance(0.14);
      this.st.look = {
        dx: r.range(-2.5, 2.5),
        dy: r.range(-2.2, 2),
        a: r.range(-0.32, 0.36),
        yaw: back ? r.sign() * r.range(1.3, 1.8) : r.range(-0.9, 0.9),
        lx: r.range(-0.2, 1),
        ly: r.range(-0.5, 0.5),
      };
    }
    const lk = this.st.look;
    if (lk) {
      this.ct.headX += lk.dx;
      this.ct.headY += lk.dy;
      this.ct.headA = lk.a;
      this.ct.headYaw = lk.yaw;
      this.ct.lookX = lk.lx;
      this.ct.lookY = lk.ly;
    }
  }

  driftAnchor(dt, decay) {
    const e = Math.exp(-decay * dt);
    this.vx *= e;
    this.vy *= e;
    if (Math.hypot(this.vx, this.vy) < 0.5) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const p = this.perch();
    if (p) {
      const r = this.world.perchRange(p);
      if (r && nx >= r.x0 && nx <= r.x1) this.x = nx;
      else this.vx = 0;
      this.vy = 0;
      return;
    }
    if (!this.world.inWalkable(nx, ny, 0.5) && this.world.inWalkable(this.x, this.y, 0.5)) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    this.x = nx;
    this.y = ny;
  }

  pushStep(p, t, dt, ux, uy, speed) {
    const tt = Math.min(t, p.T);
    let hv = M.hermite(p.h0, p.v0, p.h1, p.v1, p.T, tt);
    let hvel = M.hermiteDeriv(p.h0, p.v0, p.h1, p.v1, p.T, tt);
    if (t > p.T) {
      hv = p.h1 + p.v1 * (t - p.T);
      hvel = p.v1;
    }
    const ramp = Math.min(1, t / p.T);
    const g = speed * ramp * ramp;
    this.vx = g * ux;
    this.vy = g * uy * F;
    let nx = this.x + this.vx * dt;
    let ny = this.y + this.vy * dt;
    const perch = this.perch();
    if (perch) {
      const r = this.world.perchRange(perch);
      const lo = r ? Math.min(r.x0, this.x) : this.x;
      const hi = r ? Math.max(r.x1, this.x) : this.x;
      if (nx < lo || nx > hi) {
        nx = M.clamp(nx, lo, hi);
        this.vx = 0;
      }
      ny = perch.y;
      this.vy = 0;
    } else if (!this.world.inWalkable(nx, ny, 0.5)) {
      nx = this.x;
      ny = this.y;
      this.vx = 0;
      this.vy = 0;
    }
    this.x = nx;
    this.y = ny;
    const hMax = this.maxHipForFeet();
    let lift = false;
    this.liftOver = 0;
    if (hv >= hMax - 1e-9) {
      this.liftOver = Math.max(0, hv - hMax);
      hv = hMax;
      lift = true;
    }
    if (t > p.T + 0.12) lift = true;
    this.c.hipH = hv;
    this.cv.hipH = hvel;
    this.ct.hipH = hv;
    this.direct.add('hipH');
    this.pushing = true;
    return lift ? Math.max(hvel, 1) : null;
  }

  liftoff(vz, kind = 'push') {
    const reach = Math.max(this.footReach(0), this.footReach(1));
    for (const f of this.feet) {
      const p = this.footLocal(f);
      f.lx = p[0];
      f.ly = p[1];
      f.lz = p[2];
      f.slx = p[0];
      f.sly = p[1];
      f.slz = p[2];
      f.svx = 0;
      f.svy = 0;
      f.svz = 0;
      f.planted = false;
      f.swing = null;
      f.lift = 0;
    }
    this.airborne = true;
    this.vz = vz;
    this.cv.hipH = 0;
    this.ct.hipH = this.c.hipH;
    this.st.landBlend = null;
    this.perchId = null;
    this.emit('liftoff', { reach, kind });
  }

  touchdown(perchId) {
    const p = this.world.perch(perchId);
    this.airborne = false;
    this.z = 0;
    this.perchId = p && Math.abs(this.y - p.y) < 0.5 ? p.id : null;
    if (this.perchId) this.y = p.y;
    this.cv.hipH = Math.min(0, this.vz) / this.k;
    this.vz = 0;
    this.hv = this.hRate || 0;
    for (const f of this.feet) {
      const [x, y] = this.clampFoot(...this.localToFloor(f.lx, f.lz));
      f.planted = true;
      f.swing = null;
      f.x = x;
      f.y = y;
      f.lift = 0;
      f.curl = 0;
      const [lx, lz] = this.floorToLocal(x, y);
      f.lx = lx;
      f.lz = lz;
      f.ly = -D.footLift;
    }
    this.st.landBlend = null;
    this.emit('touchdown', { x: this.x, y: this.y });
  }

  enter(state, params = {}) {
    const from = this.state;
    const exit = this['exit_' + from];
    if (exit) exit.call(this);
    this.transitions.push({ t: this.time, from, to: state, fromPhase: this.st.phase || null, reason: params.reason || null });
    this.transitionCount++;
    if (this.transitions.length > 400) this.transitions.splice(0, 200);
    if (this.airborne) this.reseatAirFeet();
    this.state = state;
    this.stateTime = 0;
    this.st = { p: params };
    this.resetOm();
    const fn = this['enter_' + state];
    if (fn) fn.call(this, params);
    this.emit('state', { from, to: state });
  }

  act(action) {
    this.queue.push(action);
  }

  interrupt(action) {
    this.queue = [action];
    this.st.interrupt = true;
  }

  isBusy() {
    return !!this.action || this.queue.length > 0;
  }

  finishAction(ok = true) {
    const a = this.action;
    this.action = null;
    if (a && a.onDone) a.onDone(ok, a);
    if (a) this.emit('actionDone', { action: a.type, ok });
  }

  pump() {
    if (!this.st.done) return;
    if (this.action && !this.st.keepAction) this.finishAction(this.st.ok !== false);
    const next = this.queue.shift();
    if (!next) {
      if (this.state === 'away') this.st.done = false;
      else this.enter('idle', {});
      return;
    }
    this.startAction(next);
  }

  startAction(a) {
    const needTurn = (target) => {
      const err = Math.abs(M.wrapAngle(target - this.h));
      if (err > 1.9) {
        this.queue.unshift(a);
        this.enter('hop', { turnTo: target, x: this.x, y: this.y, perchId: this.perchId });
        return true;
      }
      return false;
    };
    this.action = a;
    if (a.type === 'flyIn' && this.state !== 'away') {
      this.action = null;
      if (a.onDone) a.onDone(false, a);
      this.emit('diag', { what: 'flyInRejected', state: this.state });
      this.enter('idle', { duration: 0 });
      return;
    }
    if (this.state === 'away' && a.type !== 'flyIn') {
      this.action = null;
      if (a.onDone) a.onDone(false, a);
      this.st.done = false;
      return;
    }
    const k = this.k;
    switch (a.type) {
      case 'idle':
        this.enter('idle', { duration: a.duration, faceTo: a.faceTo });
        break;
      case 'walkTo': {
        if (this.perchId) {
          if (this.world.inWalkable(this.x, this.y, 0.5)) this.perchId = null;
          else {
            const area = this.world.clampWalkable(this.x, this.y);
            this.queue.unshift(a);
            this.enter('hop', { x: area ? area.x : a.x, y: area ? area.y : a.y });
            break;
          }
        }
        const t = this.world.inWalkable(a.x, a.y, 0.5) ? { x: a.x, y: a.y } : this.world.clampWalkable(a.x, a.y);
        if (!t || Crow.floorDist(this.x, this.y, t.x, t.y) < 0.75 * k) {
          this.enter('idle', { duration: 0 });
          break;
        }
        const hd = this.headingTo(t.x, t.y);
        if (needTurn(hd)) break;
        if (Math.abs(M.wrapAngle(hd - this.h)) > 1.2) {
          this.queue.unshift(a);
          this.enter('idle', { duration: 0, faceTo: hd });
          break;
        }
        this.enter('walk', { x: t.x, y: t.y, speed: a.speed });
        break;
      }
      case 'hopTo': {
        const tx = a.x == null ? this.x : a.x;
        const ty = a.y == null ? this.y : a.y;
        if (!a.perchId && Crow.floorDist(this.x, this.y, tx, ty) > 3 * k && needTurn(this.headingTo(tx, ty))) break;
        this.enter('hop', { x: tx, y: ty, height: a.height, excited: a.excited, perchId: a.perchId });
        break;
      }
      case 'turn': {
        const err = Math.abs(M.wrapAngle(a.h - this.h));
        if (err > 1.2) this.enter('hop', { turnTo: a.h, x: this.x, y: this.y, perchId: this.perchId });
        else this.enter('idle', { duration: 0, faceTo: a.h });
        break;
      }
      case 'flyTo':
        this.enter('fly', { target: a.target, mode: a.mode || 'normal' });
        break;
      case 'flyOff':
        this.enter('fly', { offscreen: a.offscreen, mode: 'off' });
        break;
      case 'flyIn':
        this.enter('fly', { target: a.target, from: a.from, mode: 'in' });
        break;
      case 'perch':
        this.enter('perch', { duration: a.duration });
        break;
      case 'sleep':
        this.enter('sleep', { duration: a.duration });
        break;
      case 'eat': {
        const it = this.env.getItem(a.itemId);
        if (it && needTurn(this.headingTo(it.x, it.y))) break;
        if (it && Math.abs(M.wrapAngle(this.headingTo(it.x, it.y) - this.h)) > 0.22) {
          this.queue.unshift(a);
          this.enter('idle', { duration: 0, faceTo: this.headingTo(it.x, it.y) });
          break;
        }
        this.enter('eat', { itemId: a.itemId });
        break;
      }
      case 'peck': {
        if (a.x != null && Crow.floorDist(this.x, this.y, a.x, a.y) > 6 * k) {
          const hd = this.headingTo(a.x, a.y);
          if (needTurn(hd)) break;
          if (Math.abs(M.wrapAngle(hd - this.h)) > 0.22) {
            this.queue.unshift(a);
            this.enter('idle', { duration: 0, faceTo: hd });
            break;
          }
        }
        this.enter('peck', { count: a.count, itemId: a.itemId, pickUp: a.pickUp });
        break;
      }
      case 'giftDrop':
        this.enter('giftDrop', {});
        break;
      case 'reactClick':
        this.enter('reactClick', { x: a.x, y: a.y });
        break;
      case 'reactSpawn':
        this.enter('reactSpawn', { itemId: a.itemId });
        break;
      case 'dance':
        this.enter('dance', { duration: a.duration, beat: a.beat });
        break;
      case 'pet':
        this.enter('pet', { duration: a.duration });
        break;
      default:
        this.action = null;
        this.enter('idle', { duration: 0 });
    }
  }

  step(dt) {
    this.time += dt;
    this.stateTime += dt;
    const h0 = this.h;
    this.shift.dx = this.pendingShift.dx;
    this.shift.dy = this.pendingShift.dy;
    this.pendingShift.dx = 0;
    this.pendingShift.dy = 0;

    if (this.st.interrupt && this.canInterrupt()) {
      this.st.done = true;
      this.st.ok = false;
    }
    this.pump();

    const fn = this['update_' + this.state];
    if (fn) fn.call(this, dt);

    this.ambient(dt);
    this.integrate(dt);
    this.updateFeet(dt);
    if (!this.airborne && !this.pushing) this.balanceGuard();
    this.pushing = false;
    this.hRate = dt > 0 ? M.wrapAngle(this.h - h0) / dt : 0;
    this.composePose();
  }

  canInterrupt() {
    const hop = this.st.hop;
    if (hop && (hop.phase === 'push' || hop.phase === 'air')) return false;
    switch (this.state) {
      case 'fly':
      case 'land':
      case 'away':
      case 'held':
        return false;
      case 'hop':
        return this.st.hop ? this.st.hop.phase === 'absorb' || this.st.hop.phase === 'crouch' : true;
      case 'reactClick':
      case 'giftDrop':
        return !this.airborne && this.stateTime > 0.2;
      case 'sleep':
        if (this.st.phase !== 'wake') {
          this.st.phase = 'wake';
          this.st.pt = 0;
        }
        return false;
      default:
        return !this.airborne;
    }
  }

  integrate(dt) {
    for (const ch of CH) {
      if (this.direct.has(ch)) continue;
      const r = M.springStep(this.c[ch], this.cv[ch], this.ct[ch], this.om[ch], dt);
      const vmax = VMAX[ch];
      if (vmax && Math.abs(r[1]) > vmax) {
        const v = Math.sign(r[1]) * vmax;
        const moved = r[0] - this.c[ch];
        this.c[ch] += Math.abs(moved) > vmax * dt ? Math.sign(moved) * vmax * dt : moved;
        this.cv[ch] = v;
      } else {
        this.c[ch] = r[0];
        this.cv[ch] = r[1];
      }
    }
    this.direct.clear();
    if (!this.airborne) {
      const hMax = this.maxHipForFeet();
      if (this.c.hipH > hMax) {
        this.c.hipH = hMax;
        if (this.cv.hipH > 0) this.cv.hipH = 0;
      }
    }
    this.flapPhase += Math.PI * 2 * this.flapFreq * dt;
    if (this.flapPhase > 1e4) this.flapPhase -= Math.PI * 2 * 1000;
  }

  ambient(dt) {
    const awake = !(this.state === 'sleep' && this.st.phase !== 'wake');
    if (awake && this.state !== 'away') {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinkPhase = 0.11;
        this.blinkT = this.rng.range(2.2, 6.5);
      }
      if (this.blinkPhase > 0) {
        this.blinkPhase -= dt;
        this.ct.eye = 0;
        this.om.eye = 55;
      } else if (this.st.eyeTarget == null) {
        this.ct.eye = 1;
      }
    }
    if (this.emote && !this.emote.loop && this.time - this.emote.t0 > this.emote.dur) this.emote = null;
    if (this.cawT > 0) {
      this.cawT -= dt;
      this.ct.beak = this.cawKind === 'chirp' ? 0.5 : 0.95;
      this.ct.headA -= this.cawKind === 'chirp' ? 0.1 : 0.3;
      this.om.beak = 34;
    }
  }

  enter_idle(p) {
    this.st.dur = p.duration == null ? Infinity : p.duration;
    this.st.faceTo = p.faceTo == null ? null : p.faceTo;
    this.vx = 0;
    this.vy = 0;
  }

  update_idle(dt) {
    this.standTargets();
    let turning = false;
    if (this.st.faceTo != null) {
      turning = this.turnToward(dt, this.st.faceTo, TURN_STAND, 9) > 0.015 || Math.abs(this.hv) > 0.05;
      if (!turning) {
        this.hv = 0;
        this.st.faceTo = null;
      }
      this.ct.headYaw = 0;
    } else {
      this.holdHeading(dt);
      this.idleLook(dt);
    }
    const settled = this.settleFeet(turning ? 1.0 : 1.3);
    if (turning) return;
    if (this.stateTime >= this.st.dur && settled) this.st.done = true;
    if (this.queue.length && settled) this.st.done = true;
  }

  enter_walk(p) {
    this.st.tx = p.x;
    this.st.ty = p.y;
    this.st.speed = (p.speed || 36) * this.k;
    this.st.v = Math.hypot(this.vx, this.vy / F);
  }

  update_walk(dt) {
    const k = this.k;
    const st = this.st;
    if (!this.world.inWalkable(st.tx, st.ty, 0.5)) {
      const c = this.world.clampWalkable(st.tx, st.ty);
      if (c) {
        st.tx = c.x;
        st.ty = c.y;
      }
    }
    let gx = st.tx;
    let gy = st.ty;
    if (!this.world.inWalkable(this.x, this.y, 0.5)) {
      const e = this.world.clampWalkable(this.x, this.y);
      const a = e && this.world.areaOf(e.displayId);
      if (a) {
        gx = M.clamp(e.x, a.x0 + 3 * k, a.x1 - 3 * k);
        gy = M.clamp(e.y, a.y0 + 3 * k * F, a.y1 - 3 * k * F);
      }
    }
    const dgx = gx - this.x;
    const dgy = (gy - this.y) / F;
    const remaining = Math.hypot(dgx, dgy);
    const want = Math.atan2(dgy, dgx);
    if (remaining > 1.5 * k) this.turnToward(dt, want, TURN_WALK, 12);
    else this.holdHeading(dt);
    const err = Math.abs(M.wrapAngle(want - this.h));
    const accel = 220 * k;
    const vStop = Math.sqrt(2 * accel * Math.max(0, remaining));
    const vTarget = Math.min(st.speed * M.clamp(Math.cos(err), 0.2, 1), vStop);
    if (st.v < vTarget) st.v = Math.min(vTarget, st.v + accel * dt);
    else st.v = Math.max(vTarget, st.v - accel * 1.5 * dt);
    const c = Math.cos(this.h);
    const s = Math.sin(this.h);
    let move = st.v * dt;
    const ahead = dgx * c + dgy * s;
    if (ahead <= 0.02 * k || remaining <= 0.02 * k) {
      move = 0;
      st.v = 0;
      if (remaining > 3 * k) {
        st.blocked = (st.blocked || 0) + dt;
        this.settleFeet(1.0);
      }
    } else if (move >= ahead) {
      move = ahead;
    }
    const nx = this.x + move * c;
    const ny = this.y + move * s * F;
    if (move === 0) {
    } else if (this.world.inWalkable(nx, ny, 0.5) || !this.world.inWalkable(this.x, this.y, 0.5)) {
      this.x = nx;
      this.y = ny;
      st.blocked = 0;
    } else {
      move = 0;
      st.v = 0;
      st.blocked = (st.blocked || 0) + dt;
    }
    this.vx = dt > 0 ? (move * c) / dt : 0;
    this.vy = dt > 0 ? (move * s * F) / dt : 0;
    if (st.v > 0.5 * k) this.gait(c, s, st.v);
    const swinging = this.feet.some((f) => f.swing);
    const t = this.stateTime;
    this.setT({
      hipH: D.hipWalk - (swinging ? 0.75 : 0),
      pitch: 0.11,
      headX: D.headIdle.x + 1 + (swinging ? 2.4 : -0.9),
      headY: D.headIdle.y + 0.8,
      headA: 0.12,
      headYaw: M.clamp(M.wrapAngle(want - this.h) * 0.5, -0.6, 0.6),
      beak: 0,
      lookX: 0.6,
      lookY: 0.1,
      wing: 0,
      flapBase: 0,
      flapAmp: 0,
      tailA: 0.06 * Math.sin(t * 9),
      tailFan: 0,
      fluff: 0,
    });
    this.setOm({ headX: 24, hipH: 20 });
    if (st.v === 0 && (remaining <= 0.05 * k || (ahead <= 0.02 * k && remaining <= 3 * k) || st.blocked > 0.3)) {
      this.vx = 0;
      this.vy = 0;
      if (this.settleFeet()) {
        st.done = true;
        if (st.blocked > 0.3) st.ok = false;
      }
    }
  }

  enter_hop(p) {
    const turn = p.turnTo != null && Math.abs(M.wrapAngle(p.turnTo - this.h)) > 0.05;
    this.st.turn = turn;
    this.st.tx = p.x == null ? this.x : p.x;
    this.st.ty = p.y == null ? this.y : p.y;
    this.st.height = p.height || (turn ? 5.5 : 8.5);
    this.st.excited = !!p.excited;
    this.st.perchId = p.perchId || null;
    this.hopBegin({ tx: this.st.tx, ty: this.st.ty, height: this.st.height, turnTo: turn ? p.turnTo : null, perchId: this.st.perchId });
  }

  update_hop(dt) {
    const h = this.st.hop;
    const ph = h.phase;
    const res = this.hopUpdate(dt);
    if (ph === 'air') this.setT({ wing: 0.22, flapBase: 0.35, flapAmp: 0.25 });
    else this.setT({ wing: 0.05, flapBase: 0, flapAmp: 0 });
    this.flapFreq = 6;
    if (res === 'landed') {
      const remaining = Crow.floorDist(this.x, this.y, this.st.tx, this.st.ty);
      if (!this.st.turn && remaining > 2.5 * this.k && !this.perchId) {
        this.st.hop.chain = { tx: this.st.tx, ty: this.st.ty, height: this.st.height };
      }
    } else if (res === 'done') {
      this.st.done = true;
    }
    const hop = this.st.hop;
    if (hop && hop.chain && hop.phase === 'absorb' && (this.cv.hipH > -12 || hop.t > 0.12)) {
      const next = hop.chain;
      hop.chain = null;
      this.hopChain(next);
    }
  }

  hopBegin(o) {
    this.st.hop = { phase: 'crouch', t: 0, tx: o.tx, ty: o.ty, height: o.height, turnTo: o.turnTo, perchId: o.perchId || null, sfx: o.sfx };
  }

  hopChain(o) {
    const h = this.st.hop;
    h.phase = 'push';
    h.t = 0;
    h.tx = o.tx;
    h.ty = o.ty;
    h.height = o.height;
    h.turnTo = null;
    this.hopPlan();
  }

  hopPlan() {
    const k = this.k;
    const h = this.st.hop;
    let tx = h.tx;
    let ty = h.ty;
    const perch = this.world.perch(h.perchId);
    const pr = perch && this.world.perchRange(perch);
    if (pr) {
      tx = M.clamp(tx, pr.x0, pr.x1);
      ty = perch.y;
    } else {
      h.perchId = null;
      const area = this.world.areaAt(this.x, this.y, 1);
      if (area) {
        tx = M.clamp(tx, area.x0, area.x1);
        ty = M.clamp(ty, area.y0, area.y1);
      } else if (!this.world.inWalkable(tx, ty, 0.5)) {
        const c = this.world.clampWalkable(tx, ty);
        if (c) {
          tx = c.x;
          ty = c.y;
        }
      }
    }
    let dgx = tx - this.x;
    let dgy = (ty - this.y) / F;
    let dist = Math.hypot(dgx, dgy);
    const maxHop = 26 * k;
    if (dist > maxHop) {
      dgx *= maxHop / dist;
      dgy *= maxHop / dist;
      dist = maxHop;
      h.perchId = null;
      if (!this.world.inWalkable(this.x + dgx, this.y + dgy * F, 0.5)) {
        const e = this.world.clampWalkable(this.x, this.y);
        const a = e && this.world.areaOf(e.displayId);
        if (e && a) {
          const ex = M.clamp(e.x, a.x0 + 2 * k, a.x1 - 2 * k);
          const ey = M.clamp(e.y, a.y0 + 2 * k * F, a.y1 - 2 * k * F);
          dgx = ex - this.x;
          dgy = (ey - this.y) / F;
          dist = Math.hypot(dgx, dgy);
        }
      }
    }
    const ux = dist > 1e-6 ? dgx / dist : Math.cos(this.h);
    const uy = dist > 1e-6 ? dgy / dist : Math.sin(this.h);
    const airT = h.turnTo != null ? 0.26 + (0.08 * Math.abs(M.wrapAngle(h.turnTo - this.h))) / Math.PI : 0.24;
    const Hh = h.height * k;
    const g = (8 * Hh) / (airT * airT);
    const vz0 = (4 * Hh) / airT;
    const Tp = 0.075;
    h.exact = !!h.perchId || !this.world.inWalkable(this.x, this.y, 0.5);
    const speed = dist / (airT + Tp / 3 + (h.exact ? 0 : 1 / 22));
    h.tx = this.x + dgx;
    h.ty = this.y + dgy * F;
    h.plan = { airT, g, vz0, speed, ux, uy, Tp };
    h.h0 = this.h;
    let horiz = 0;
    for (const f of this.feet) {
      const p = this.footLocal(f);
      const hp = hipLocal({ hipH: 0 }, f.i);
      horiz = Math.max(horiz, Math.hypot(p[0] - hp[0], p[2] - hp[2]));
    }
    horiz += (speed * Tp) / (3 * k);
    const hLo = Math.sqrt(Math.max(1, REACH_SAFE * REACH_SAFE - horiz * horiz)) + D.footLift - 0.3;
    h.push = { h0: this.c.hipH, v0: this.cv.hipH, h1: hLo, v1: vz0 / k, T: Tp };
  }

  hopUpdate(dt) {
    const k = this.k;
    const h = this.st.hop;
    h.t += dt;
    switch (h.phase) {
      case 'crouch': {
        this.setT({ hipH: D.hipCrouch, pitch: 0.16, headY: D.headIdle.y + 2.5, headX: D.headIdle.x - 0.5, tailA: 0.14 });
        this.setOm({ hipH: 30, pitch: 18, headY: 20 });
        this.holdHeading(dt);
        if (h.turnTo != null) {
          this.setT({ headYaw: 0, headA: 0.1 });
          this.setOm({ headYaw: 22 });
          this.lookTarget = null;
        }
        h.wait = (h.wait || 0) + dt;
        if ((this.feet.some((f) => f.swing) || (h.turnTo != null && Math.abs(this.c.headYaw) > 0.3)) && h.wait < 0.8) {
          h.t = Math.min(h.t, 0.04);
          return null;
        }
        if (h.t >= 0.09) {
          h.phase = 'push';
          h.t = 0;
          this.hopPlan();
        }
        return null;
      }
      case 'push': {
        const p = h.push;
        const pl = h.plan;
        this.setT({ pitch: 0.06, tailA: 0.18 });
        this.holdHeading(dt);
        const hvel = this.pushStep(p, h.t, dt, pl.ux, pl.uy, pl.speed);
        if (hvel != null) {
          this.liftoff(hvel * k);
          this.z = this.liftOver * k;
          this.vx = pl.speed * pl.ux;
          this.vy = pl.speed * pl.uy * F;
          h.phase = 'air';
          h.t = 0;
          h.h0 = this.h;
          if (h.sfx) this.emit('sound', { name: h.sfx });
        }
        return null;
      }
      case 'air': {
        const pl = h.plan;
        const prevT = h.t - dt;
        const disc = this.vz * this.vz + 2 * pl.g * this.z;
        const tHit = (this.vz + Math.sqrt(Math.max(0, disc))) / pl.g;
        if (h.perchId) {
          const pp = this.world.perch(h.perchId);
          const r = pp && this.world.perchRange(pp);
          if (!r || Math.abs(pp.y - h.ty) > 1e-6 || h.tx < r.x0 - 1e-6 || h.tx > r.x1 + 1e-6) {
            h.perchId = null;
            h.lostPerch = true;
            this.perchLostAt = this.time;
          }
        }
        const u = M.clamp(h.t / Math.max(1e-3, prevT + tHit), 0, 1);
        if (h.turnTo != null) {
          const tu = M.smoothstep(0, 0.92, u);
          this.h = M.wrapAngle(h.h0 + M.wrapAngle(h.turnTo - h.h0) * tu);
          this.hv = 0;
          h.turnSched = { h0: h.h0, h1: h.turnTo, t: h.t, total: Math.max(1e-3, prevT + tHit) };
        }
        this.st.airFeet = [
          { lx: 0.2, ly: -10.5, lz: 2.4 },
          { lx: -1.8, ly: -11, lz: -2.4 },
        ];
        this.st.airFeetOmega = 22;
        const wBlend = M.smoothstep(0.45, 1.0, Math.min(1, (prevT + dt) / Math.max(1e-3, prevT + tHit)));
        const lb = this.setLandBlend(wBlend, h.perchId, dt);
        if (h.lostPerch && lb.last) lb.frozen = lb.last;
        this.setT({ hipH: D.hipAir, pitch: -0.02 });
        this.setOm({ hipH: 9 });
        const pp = h.perchId ? this.world.perch(h.perchId) : null;
        if (h.exact && !h.lostPerch && tHit > 0.03) {
          const nvx = (h.tx - this.x) / tHit;
          const nvy = ((pp ? pp.y : h.ty) - this.y) / tHit;
          if (Math.hypot(nvx - this.vx, nvy - this.vy) < 80 * k) {
            this.vx = nvx;
            this.vy = nvy;
          } else {
            h.lostPerch = true;
            if (h.perchId) this.perchLostAt = this.time;
            h.perchId = null;
          }
        }
        if (tHit <= dt) {
          this.x += this.vx * tHit;
          this.y += this.vy * tHit;
          this.vz -= pl.g * tHit;
          this.z = 0;
          if (h.turnTo != null) this.h = M.wrapAngle(h.turnTo);
          if (pp && h.perchId) this.y = pp.y;
          if (h.exact && !h.lostPerch) {
            this.vx = 0;
            this.vy = 0;
          }
          this.st.landBlend.w = 1;
          this.updateFeet(0);
          this.touchdown(h.perchId);
          h.phase = 'absorb';
          h.t = dt - tHit;
          return 'landed';
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.z += this.vz * dt - 0.5 * pl.g * dt * dt;
        this.vz -= pl.g * dt;
        return null;
      }
      case 'absorb': {
        this.driftAnchor(dt, 22);
        this.holdHeading(dt);
        this.setT({ hipH: D.hipStand, pitch: 0.05 });
        this.setOm({ hipH: 15 });
        if (!h.chain && h.t > 0.13 && this.cv.hipH >= -2) {
          if (this.settleFeet()) {
            h.phase = 'done';
            return 'done';
          }
        }
        return null;
      }
      default:
        return 'done';
    }
  }

  retargetFlight(target) {
    if (this.state !== 'fly') return false;
    const st = this.st;
    st.offscreen = null;
    st.offscreenFn = null;
    st.mode = 'in';
    st.enteredScreen = false;
    st.target = target;
    if (st.phase === 'air') this.planFlight();
    return true;
  }

  onDisplaysChanged() {
    const st = this.st;
    if (this.state !== 'fly' || st.phase !== 'air' || !st.path) return;
    if (st.offscreen) {
      if (st.offscreenFn) st.offscreen = st.offscreenFn();
    } else if (st.target && !this.targetValid(st.target)) {
      st.target = null;
    }
    this.planFlight();
  }

  targetValid(t) {
    if (!t) return false;
    if (t.perchId) {
      const p = this.world.perch(t.perchId);
      const r = p && this.world.perchRange(p);
      return !!r && Math.abs(t.y - p.y) < 1e-6 && t.x >= r.x0 - 1e-6 && t.x <= r.x1 + 1e-6;
    }
    return this.world.inWalkable(t.x, t.y, 0.5);
  }

  convertToFall() {
    this.clearEmote('sleep');
    const hop = this.st.hop;
    const sched = hop && hop.turnTo != null && hop.phase === 'air' && hop.turnSched ? Object.assign({}, hop.turnSched) : null;
    this.enter('fly', { mode: 'fall', fromAir: true, reason: 'startled' });
    if (sched) this.st.turnCarry = sched;
    this.ct.eye = 1;
    this.om.eye = 30;
    this.ct.fluff = 0;
    this.om.fluff = 10;
  }

  enter_fly(p) {
    const st = this.st;
    const k = this.k;
    st.mode = p.mode || 'normal';
    st.target = p.target || null;
    st.offscreenFn = typeof p.offscreen === 'function' ? p.offscreen : null;
    st.offscreen = st.offscreenFn ? st.offscreenFn() : p.offscreen || null;
    this.flapFreq = 7;
    if (st.mode === 'in') {
      const from = p.from;
      this.airborne = true;
      this.visible = true;
      this.perchId = null;
      this.x = from.x;
      this.y = from.y;
      this.z = from.z != null ? from.z : 90 * k;
      this.vx = from.vx || 0;
      this.vy = from.vy || 0;
      this.vz = 0;
      this.h = Math.atan2(this.vy / F, this.vx);
      this.hv = 0;
      for (const f of this.feet) {
        const t = this.defaultAirFeet()[f.i];
        f.planted = false;
        f.swing = null;
        f.slx = f.lx = t.lx;
        f.sly = f.ly = t.ly;
        f.slz = f.lz = t.lz;
        f.svx = f.svy = f.svz = 0;
        f.curl = 1;
      }
      for (const [ch, v] of Object.entries({ wing: 1, flapBase: 0.15, flapAmp: 0.85, hipH: D.hipAir, pitch: 0 })) {
        this.c[ch] = v;
        this.ct[ch] = v;
        this.cv[ch] = 0;
      }
      st.phase = 'air';
      st.arriving = true;
      this.planFlight();
      return;
    }
    if (this.airborne || p.fromAir) {
      if (!this.airborne) this.liftoff(0, 'startled');
      st.phase = 'air';
      if (st.mode === 'fall') {
        this.emit('sound', { name: 'caw' });
        this.showEmote('alert', 1);
        this.cv.flapAmp += 4;
        this.cv.wing += 3;
      }
      this.planFlight();
      return;
    }
    st.phase = 'crouch';
    st.pt = 0;
  }

  landingBelow(ahead = 0.3) {
    const x = this.x + this.vx * ahead;
    const y = this.y + this.vy * ahead;
    const c = this.world.inWalkable(x, y, 0.5) ? { x, y } : this.world.clampWalkable(x, y);
    return c ? { x: c.x, y: c.y, perchId: null } : null;
  }

  planFlight() {
    const st = this.st;
    const k = this.k;
    const w = this.world;
    if (!st.offscreen && (!st.target || !this.targetValid(st.target))) {
      st.target = this.landingBelow(st.mode === 'drop' ? 0.15 : 0.2);
    }
    const P0 = [this.x, this.y / F];
    const V0 = [this.vx, this.vy / F];
    let P3;
    let exitDir = null;
    if (st.offscreen) {
      P3 = [st.offscreen.x, st.offscreen.y / F];
    } else if (st.target) {
      P3 = [st.target.x, st.target.y / F];
    } else {
      P3 = [P0[0], P0[1]];
    }
    const dx = P3[0] - P0[0];
    const dy = P3[1] - P0[1];
    const D0 = Math.hypot(dx, dy);
    const cruise = M.clamp(170 + (0.2 * D0) / k, 170, 320) * k;
    const dirx = D0 > 1e-6 ? dx / D0 : Math.cos(this.h);
    const diry = D0 > 1e-6 ? dy / D0 : Math.sin(this.h);
    const nodes = [{ p: P0, v: V0 }];
    const way = this.waypointBetween(P0, P3);
    const v0 = Math.hypot(V0[0], V0[1]);
    if (st.mode !== 'drop' && v0 > 20 * k && D0 > 120 * k) {
      const next = way || P3;
      const nx = next[0] - P0[0];
      const ny = next[1] - P0[1];
      const nl = Math.hypot(nx, ny) || 1;
      const T1 = M.clamp(0.3 + v0 / (900 * k), 0.3, 0.7);
      const s1 = Math.min(cruise * 0.7, (nl * 0.6) / T1);
      const V1 = [(nx / nl) * s1, (ny / nl) * s1];
      nodes.push({ p: [P0[0] + ((V0[0] + V1[0]) / 2) * T1, P0[1] + ((V0[1] + V1[1]) / 2) * T1], v: V1, T: T1 });
    }
    if (way) nodes.push({ p: way, v: null });
    let V3;
    if (st.offscreen) {
      V3 = [dirx * cruise, diry * cruise];
      exitDir = [dirx, diry];
    } else {
      V3 = [dirx * 42 * k, diry * 42 * k];
    }
    nodes.push({ p: P3, v: V3 });
    for (let i = 1; i < nodes.length - 1; i++) {
      if (nodes[i].v) continue;
      const a = nodes[i - 1].p;
      const b = nodes[i + 1].p;
      const cl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      nodes[i].v = [((b[0] - a[0]) / cl) * cruise, ((b[1] - a[1]) / cl) * cruise];
    }
    const segs = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
      const va = Math.hypot(a.v[0], a.v[1]);
      const vb = Math.hypot(b.v[0], b.v[1]);
      let T = b.T || Math.max(0.3, len / Math.max(60 * k, 0.5 * (va + vb) * 0.4 + cruise * 0.6));
      if (i === 0 && !b.T) T = Math.max(T, Math.min(1.2, (va * 0.33) / Math.max(40 * k, len) + 0.3));
      segs.push({ a: a.p, va: a.v, b: b.p, vb: b.v, T });
    }
    const minTotal = st.offscreen ? 0 : 0.3 + this.z / (110 * k);
    const sum = segs.reduce((s, g) => s + g.T, 0);
    if (sum < minTotal) segs[segs.length - 1].T += minTotal - sum;
    const total = segs.reduce((s, g) => s + g.T, 0);
    const want = st.mode === 'drop' ? this.z : M.clamp(34 + (0.16 * D0) / k, 34, 140) * k;
    const path = { segs, total, t: 0 };
    const roomAt = (x, fy) => {
      const top = (z) => fy - z * H - 50 * k;
      if (!w.onOrBetweenDisplays(x, top(0), 6 * k)) return null;
      let z = 0;
      for (let n = 0; n < 40 && w.onOrBetweenDisplays(x, top(z + 6 * k), 6 * k); n++) z += 6 * k;
      return z;
    };
    let zc = want;
    let pathLen = 0;
    for (const sg of segs) pathLen += Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) + 0.3 * sg.T * Math.hypot(sg.va[0], sg.va[1]);
    const n = Math.round(M.clamp(pathLen / (4 * k), 24, 1200));
    for (let i = 0; i <= n; i++) {
      const q = this.evalFloorPath(path, (total * i) / n);
      const room = roomAt(q.x, q.gy * F);
      if (room != null) zc = Math.min(zc, room);
    }
    if (st.arriving) {
      st.arriving = false;
      this.z = Math.min(this.z, Math.max(zc, 6 * k));
    }
    zc = Math.max(zc, Math.min(this.z, 6 * k), 0);
    if (st.mode === 'drop') zc = Math.min(zc, this.z);
    const keys = [{ t: 0, z: this.z, v: this.vz }];
    const tUp = st.mode === 'in' || st.mode === 'drop' ? 0 : Math.min(total * 0.42, 0.8);
    const tDown = st.offscreen ? 0 : Math.min(total * 0.45, 0.85);
    const tDownStart = total - tDown;
    if (tUp > 0 && tUp < tDownStart - 0.02) keys.push({ t: tUp, z: zc, v: 0 });
    else if (tUp === 0 && Math.min(0.6, tDownStart * 0.6) > 0.2) keys.push({ t: Math.min(0.6, tDownStart * 0.6), z: zc, v: 0 });
    if (tDown > 0 && tDownStart > keys[keys.length - 1].t + 0.02) keys.push({ t: tDownStart, z: zc, v: 0 });
    keys.push(st.offscreen ? { t: total, z: zc, v: 0 } : { t: total, z: 0, v: -46 * k });
    path.alt = keys;
    path.exitDir = exitDir;
    st.path = path;
    st.flare = !st.offscreen;
  }

  waypointBetween(P0, P3) {
    const w = this.world;
    const k = this.k;
    let outside = 0;
    const n = Math.round(M.clamp(Math.hypot(P3[0] - P0[0], (P3[1] - P0[1]) * F) / (6 * k), 16, 800));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = P0[0] + (P3[0] - P0[0]) * t;
      const y = (P0[1] + (P3[1] - P0[1]) * t) * F;
      if (!w.onOrBetweenDisplays(x, y, 24 * k) || !w.onOrBetweenDisplays(x, y - 50 * k, 6 * k)) outside++;
    }
    if (!outside) return null;
    const da = w.displayAt(P0[0], P0[1] * F) || w.nearestDisplay(P0[0], P0[1] * F);
    const db = w.displayAt(P3[0], P3[1] * F) || w.nearestDisplay(P3[0], P3[1] * F);
    if (!da || !db || da === db) return null;
    const a = da.bounds;
    const b = db.bounds;
    const oy0 = Math.max(a.y, b.y);
    const oy1 = Math.min(a.y + a.height, b.y + b.height);
    const ox0 = Math.max(a.x, b.x);
    const ox1 = Math.min(a.x + a.width, b.x + b.width);
    if (oy1 - oy0 > 60 * k && (Math.abs(a.x + a.width - b.x) < 40 || Math.abs(b.x + b.width - a.x) < 40)) {
      const x = Math.abs(a.x + a.width - b.x) < 40 ? (a.x + a.width + b.x) / 2 : (b.x + b.width + a.x) / 2;
      return [x, M.clamp((P0[1] * F + P3[1] * F) / 2, oy0 + 70 * k, oy1 - 30 * k) / F];
    }
    if (ox1 - ox0 > 60 * k && (Math.abs(a.y + a.height - b.y) < 40 || Math.abs(b.y + b.height - a.y) < 40)) {
      const y = Math.abs(a.y + a.height - b.y) < 40 ? (a.y + a.height + b.y) / 2 : (b.y + b.height + a.y) / 2;
      return [M.clamp((P0[0] + P3[0]) / 2, ox0 + 50 * k, ox1 - 50 * k), y / F];
    }
    return null;
  }

  evalFloorPath(path, t) {
    let tt = t;
    for (const sg of path.segs) {
      if (tt <= sg.T) {
        return {
          x: M.hermite(sg.a[0], sg.va[0], sg.b[0], sg.vb[0], sg.T, tt),
          gy: M.hermite(sg.a[1], sg.va[1], sg.b[1], sg.vb[1], sg.T, tt),
          vx: M.hermiteDeriv(sg.a[0], sg.va[0], sg.b[0], sg.vb[0], sg.T, tt),
          vgy: M.hermiteDeriv(sg.a[1], sg.va[1], sg.b[1], sg.vb[1], sg.T, tt),
        };
      }
      tt -= sg.T;
    }
    const last = path.segs[path.segs.length - 1];
    return { x: last.b[0], gy: last.b[1], vx: last.vb[0], vgy: last.vb[1] };
  }

  evalAlt(path, t) {
    const keys = path.alt;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t <= b.t || i === keys.length - 2) {
        const T = Math.max(1e-6, b.t - a.t);
        const u = M.clamp(t - a.t, 0, T);
        return [M.hermite(a.z, a.v, b.z, b.v, T, u), M.hermiteDeriv(a.z, a.v, b.z, b.v, T, u)];
      }
    }
    const last = keys[keys.length - 1];
    return [last.z, last.v];
  }

  update_fly(dt) {
    const st = this.st;
    const k = this.k;
    st.pt = (st.pt || 0) + dt;
    if (st.phase === 'crouch') {
      this.setT({ hipH: D.hipCrouch - 1, pitch: 0.2, wing: 0.5, flapBase: 0.6, flapAmp: 0, tailA: 0.2, headY: D.headIdle.y + 2 });
      this.setOm({ hipH: 26, wing: 14, flapBase: 12 });
      this.holdHeading(dt);
      if (this.feet.some((f) => f.swing) && st.pt < 0.8) return;
      if (st.pt >= 0.11) {
        st.phase = 'push';
        st.pt = 0;
        const Tp = 0.075;
        let horiz = 0;
        for (const f of this.feet) {
          const p = this.footLocal(f);
          const hp = hipLocal({ hipH: 0 }, f.i);
          horiz = Math.max(horiz, Math.hypot(p[0] - hp[0], p[2] - hp[2]));
        }
        horiz += (70 * Tp) / 3;
        const hLo = Math.sqrt(Math.max(1, REACH_SAFE * REACH_SAFE - horiz * horiz)) + D.footLift - 0.3;
        st.push = { h0: this.c.hipH, v0: this.cv.hipH, h1: hLo, v1: 190, T: Tp };
        this.emit('sound', { name: 'flap' });
      }
      return;
    }
    if (st.phase === 'push') {
      const p = st.push;
      this.setT({ wing: 1, flapBase: 0.15, flapAmp: 0.95, pitch: -0.05 });
      this.setOm({ wing: 20, flapAmp: 18 });
      this.flapFreq = 7.5;
      this.holdHeading(dt);
      const hvel = this.pushStep(p, st.pt, dt, Math.cos(this.h), Math.sin(this.h), 70 * k);
      if (hvel != null) {
        this.liftoff(hvel * k);
        this.z = this.liftOver * k;
        st.phase = 'air';
        st.pt = 0;
        this.emit('takeoff', {});
        this.planFlight();
      }
      return;
    }
    if (st.phase !== 'air') return;
    if (!st.offscreen && st.target && !this.targetValid(st.target)) {
      st.target = null;
      this.planFlight();
    }
    const path = st.path;
    path.t += dt;
    const done = path.t >= path.total;
    const t = Math.min(path.t, path.total);
    const q = this.evalFloorPath(path, t);
    const [z, vz] = this.evalAlt(path, t);
    this.x = q.x;
    this.y = q.gy * F;
    this.z = Math.max(0, z);
    this.vx = q.vx;
    this.vy = q.vgy * F;
    this.vz = vz;
    if (st.mode === 'in' && !st.enteredScreen && this.world.insideDisplays(this.x, this.y - this.z * H - 30 * k, 45 * k)) st.enteredScreen = true;
    const sp = Math.hypot(q.vx, q.vgy);
    const remain = path.total - path.t;
    const flareT = 0.34;
    const flaring = st.flare && remain < flareT;
    if (flaring) {
      this.setT({ wing: 1, flapBase: 0.28, flapAmp: 0.62, tailFan: 1, tailA: -0.18, pitch: -0.34 });
      this.setOm({ pitch: 12, tailFan: 12 });
      this.flapFreq = 4.6;
    } else {
      const climbing = vz > 30 * k;
      const diving = vz < -70 * k;
      this.setT({
        wing: 1,
        flapBase: diving ? 0.4 : 0.06,
        flapAmp: diving ? 0.25 : climbing ? 0.94 : 0.86,
        tailFan: 0.3,
        tailA: -0.04,
        pitch: M.clamp((-vz / Math.max(sp, 60 * k)) * 0.5, -0.42, 0.42),
      });
      this.flapFreq = climbing ? 6.4 : diving ? 3.2 : 5;
    }
    this.setOm({ wing: 14 });
    this.setT({ hipH: D.hipAir, headX: D.headIdle.x + 2.5, headY: D.headIdle.y + 1.5, headA: flaring ? 0.35 : 0.05, headYaw: 0, fluff: 0, lookX: 0.9, lookY: flaring ? 0.6 : 0.1 });
    this.setOm({ hipH: 8 });
    if (st.turnCarry) {
      const tc = st.turnCarry;
      tc.t += dt;
      const tu = M.smoothstep(0, 0.92, M.clamp(tc.t / tc.total, 0, 1));
      this.h = M.wrapAngle(tc.h0 + M.wrapAngle(tc.h1 - tc.h0) * tu);
      this.hv = 0;
      if (tu >= 1) st.turnCarry = null;
    } else if (sp > (st.mode === 'drop' ? 260 : 18) * k) {
      this.turnToward(dt, Math.atan2(q.vgy, q.vx), flaring ? 4 : 6, flaring ? 9 : 8);
    } else {
      this.holdHeading(dt);
    }
    this.st.airFeet = this.defaultAirFeet();
    this.st.airFeetOmega = 12;
    if (flaring) {
      this.setLandBlend(done ? 1 : M.smoothstep(0, 1, 1 - remain / flareT), st.target ? st.target.perchId : null, dt, done);
    } else if (this.st.landBlend && this.st.landBlend.w > 0) {
      const lb = this.st.landBlend;
      if (!lb.frozen && lb.last) lb.frozen = lb.last;
      lb.w = Math.max(0, lb.w - dt * 4);
    } else this.st.landBlend = null;
    if (st.offscreen) {
      const body = [this.x, this.y - this.z * H - 25 * k];
      if (done || (!this.world.onOrBetweenDisplays(body[0], body[1], 70 * k) && path.t > 0.3)) {
        this.enter('away', {});
      }
      return;
    }
    if (done) {
      if (st.target) {
        this.x = st.target.x;
        this.y = st.target.y;
        this.z = 0;
        this.setLandBlend(1, st.target.perchId, 0, true);
        const vx = this.vx;
        const vy = this.vy;
        const vzT = this.vz;
        this.updateFeet(0);
        this.touchdown(st.target.perchId);
        this.enter('land', { vx, vy, vz: vzT });
      } else {
        st.mode = 'fall';
        this.planFlight();
      }
    }
  }

  enter_land(p) {
    this.vx = p.vx || 0;
    this.vy = p.vy || 0;
    this.cv.hipH = Math.min(0, (p.vz || 0) / this.k);
    this.emit('landed', { x: this.x, y: this.y, perchId: this.perchId });
  }

  update_land(dt) {
    this.driftAnchor(dt, 14);
    this.holdHeading(dt);
    this.setT({
      hipH: D.hipStand,
      pitch: 0.04,
      wing: 0,
      flapBase: 0,
      flapAmp: 0,
      tailFan: 0,
      tailA: 0,
      headX: D.headIdle.x,
      headY: D.headIdle.y,
      headA: 0.1,
      headYaw: 0,
      lookY: 0,
    });
    this.setOm({ hipH: 12, pitch: 9, wing: 7.5, flapBase: 7, flapAmp: 6.5, tailFan: 6, headX: 10, headY: 10 });
    this.flapFreq = 3.6;
    if (this.stateTime > 0.55 && this.c.wing < 0.06) {
      if (this.settleFeet()) this.st.done = true;
    }
  }

  enter_perch(p) {
    this.st.dur = p.duration == null ? Infinity : p.duration;
    this.vx = 0;
    this.vy = 0;
  }

  update_perch(dt) {
    const t = this.stateTime;
    this.holdHeading(dt);
    this.setT({
      hipH: D.hipPerch + 0.25 * Math.sin((t * Math.PI * 2) / 3.6),
      pitch: -0.02,
      headX: D.headIdle.x - 3.5,
      headY: D.headIdle.y + 3.5,
      headA: 0.08,
      headYaw: 0,
      beak: 0,
      lookX: 0.4,
      lookY: 0.2,
      wing: 0,
      flapBase: 0,
      flapAmp: 0,
      tailA: -0.12,
      tailFan: 0,
      fluff: 0.35,
    });
    this.setOm({ hipH: 5, fluff: 3, headX: 8, headY: 8 });
    this.idleLook(dt, true);
    this.ct.headX = Math.min(this.ct.headX, D.headIdle.x - 1);
    const settled = this.settleFeet();
    if ((this.stateTime >= this.st.dur || this.queue.length) && settled) this.st.done = true;
  }

  enter_sleep(p) {
    this.st.dur = p.duration == null ? 60 : p.duration;
    this.st.phase = 'settle';
    this.st.pt = 0;
    this.st.eyeTarget = 1;
    this.vx = 0;
    this.vy = 0;
    this.emit('sleepStart', {});
  }

  update_sleep(dt) {
    const st = this.st;
    st.pt += dt;
    const t = this.stateTime;
    this.holdHeading(dt);
    if (st.phase === 'settle') {
      this.settleFeet();
      this.setT({
        hipH: D.hipSleep,
        pitch: 0.02,
        headX: D.headIdle.x - 6.5,
        headY: D.headIdle.y + 7.5,
        headA: 0.42,
        headYaw: 0,
        beak: 0,
        lookX: 0,
        lookY: 0.4,
        wing: 0,
        flapBase: 0,
        flapAmp: 0,
        tailA: -0.1,
        tailFan: 0,
        fluff: 0.85,
      });
      this.setOm({ hipH: 4, fluff: 2.5, headX: 5, headY: 5, headA: 5 });
      st.eyeTarget = 1 - M.smoothstep(0.2, 1.1, st.pt);
      this.ct.eye = st.eyeTarget;
      this.om.eye = 8;
      if (st.pt > 1.2 && !this.feet.some((f) => f.swing)) {
        st.phase = 'sleep';
        st.pt = 0;
        this.showEmote('sleep', 2.4, true);
      }
      if (this.st.interrupt) {
        st.phase = 'wake';
        st.pt = 0;
      }
    } else if (st.phase === 'sleep') {
      const b = Math.sin((t * Math.PI * 2) / 4.2);
      this.setT({ hipH: D.hipSleep + 0.3 * b, fluff: 0.85 + 0.06 * b, headY: D.headIdle.y + 7.5 + 0.35 * b });
      this.ct.eye = 0;
      this.om.eye = 8;
      if (st.pt >= st.dur || this.st.interrupt) {
        st.phase = 'wake';
        st.pt = 0;
      }
    }
    if (st.phase === 'wake') {
      this.clearEmote('sleep');
      st.eyeTarget = null;
      this.ct.eye = 1;
      this.om.eye = 10;
      const stretch = st.pt < 0.55;
      this.setT({
        hipH: D.hipStand,
        fluff: 0,
        headX: D.headIdle.x,
        headY: D.headIdle.y - 1.5,
        headA: -0.12,
        pitch: 0.02,
        wing: stretch ? 0.45 : 0,
        flapBase: stretch ? 0.75 : 0,
        flapAmp: 0,
        tailA: stretch ? 0.2 : 0,
      });
      this.setOm({ hipH: 6, fluff: 5, headX: 7, headY: 7, wing: 9, flapBase: 9 });
      if (st.pt > 1.0 && this.c.wing < 0.06 && Math.abs(this.c.hipH - D.hipStand) < 1.2) {
        if (this.settleFeet()) {
          st.done = true;
          this.emit('sleepEnd', {});
        }
      }
    }
  }

  headTargetFor(lx, ly, lz, headA, tip) {
    const f = tip.x * Math.cos(headA) - tip.y * Math.sin(headA);
    const d = tip.x * Math.sin(headA) + tip.y * Math.cos(headA);
    const yaw = Math.asin(M.clamp(lz / Math.max(4, f), -0.6, 0.6));
    return { x: lx - f * Math.cos(yaw), y: ly - d + this.c.hipH, yaw };
  }

  headPointLocal(tip) {
    const hf = headFrame({ headX: this.c.headX, headY: this.c.headY, hipH: this.c.hipH, headYaw: this.c.headYaw, headA: this.c.headA, fluff: this.c.fluff });
    return headLocal(hf, tip.x, tip.y, 0);
  }

  strikeTargets(lx, ly, lz, headA, tip, pitch) {
    const ht = this.headTargetFor(lx, ly, lz, headA, tip);
    this.setT({ headX: ht.x, headY: ht.y, headA, headYaw: ht.yaw, pitch });
    this.setOm({ headX: 36, headY: 36, headA: 30, headYaw: 30, pitch: 16 });
  }

  itemInReach(it) {
    if (!it || it.state !== 'resting') return false;
    const [lx, lz] = this.floorToLocal(it.x, it.y);
    return lx >= 12 && lx <= 44 && Math.abs(lz) <= 7;
  }

  biteTarget(it) {
    const def = ITEM_TYPES[it.type];
    const [lx, lz] = this.floorToLocal(it.x, it.y);
    return [lx - 1.5, -Math.max(def.h * 0.55, 5.5), lz];
  }

  enter_eat(p) {
    const it = this.env.getItem(p.itemId);
    this.vx = 0;
    this.vy = 0;
    if (!it || !this.itemInReach(it)) {
      this.st.done = true;
      this.st.ok = false;
      this.emit('eatFailed', { itemId: p.itemId });
      return;
    }
    it.claimedBy = 'crow';
    this.st.phase = 'strike';
    this.st.pt = 0;
    this.st.item = it;
  }

  exit_eat() {
    const it = this.st.item;
    if (it && it.state !== 'gone' && it.claimedBy === 'crow') it.claimedBy = null;
  }

  update_eat(dt) {
    const st = this.st;
    if (st.done) return;
    st.pt += dt;
    const it = st.item;
    this.holdHeading(dt);
    this.settleFeet();
    if (it.state !== 'gone' && (st.phase === 'strike' || st.phase === 'hold') && !this.itemInReach(it)) {
      it.claimedBy = null;
      this.emit('eatFailed', { itemId: it.id });
      st.phase = 'swallow';
      st.pt = 0.3;
      st.ok = false;
    }
    switch (st.phase) {
      case 'strike': {
        const b = this.biteTarget(it);
        this.strikeTargets(b[0], b[1], b[2], 1.0, D.beakTip, 0.42);
        this.setT({ beak: 0.25, tailA: 0.2, hipH: D.hipStand - 1.5, fluff: 0 });
        const tip = this.headPointLocal(D.beakTip);
        if (Math.hypot(tip[0] - b[0], tip[1] - b[1], tip[2] - b[2]) < 1.4 || st.pt > 0.4) {
          it.bitesLeft = Math.max(0, it.bitesLeft - 1);
          const wp = this.localToFloor(b[0], b[2]);
          this.emit('bite', { itemId: it.id, x: wp[0], y: wp[1] - Math.max(ITEM_TYPES[it.type].h * 0.5, 5) * this.k * H, left: it.bitesLeft, itemType: it.type });
          this.emit('sound', { name: 'crunch' });
          if (it.bitesLeft <= 0) {
            it.state = 'gone';
            this.emit('ate', { itemId: it.id, itemType: it.type, handFed: it.handFed, source: it.source });
          }
          st.phase = 'hold';
          st.pt = 0;
        }
        break;
      }
      case 'hold':
        this.setT({ beak: 0 });
        if (st.pt > 0.07) {
          st.phase = 'lift';
          st.pt = 0;
        }
        break;
      case 'lift':
        this.setT({ headX: D.headIdle.x + 1, headY: D.headIdle.y + 5, headA: 0.3, headYaw: 0, pitch: 0.14, beak: 0, tailA: 0.05, hipH: D.hipStand });
        this.setOm({ headX: 18, headY: 18, headA: 16, headYaw: 16, pitch: 12 });
        if (st.pt > 0.15) {
          st.phase = 'chew';
          st.pt = 0;
        }
        break;
      case 'chew':
        this.setT({ beak: Math.sin(st.pt * 26) > 0 ? 0.45 : 0, headA: 0.15 + 0.08 * Math.sin(st.pt * 26) });
        if (st.pt > 0.3) {
          st.phase = it.state === 'gone' ? 'swallow' : 'strike';
          st.pt = 0;
        }
        break;
      case 'swallow':
        this.setT({ headA: -0.45, headY: D.headIdle.y - 3.5, headX: D.headIdle.x - 1, headYaw: 0, beak: 0.1, pitch: 0.0 });
        this.setOm({ headA: 12, headY: 12 });
        if (st.pt > 0.12 && st.pt - dt <= 0.12 && it.handFed) this.showEmote('heart', 1.4);
        if (st.pt > 0.42) {
          this.setT({ headA: 0.1, headY: D.headIdle.y, beak: 0 });
          st.done = true;
        }
        break;
      default:
        break;
    }
  }

  enter_peck(p) {
    this.vx = 0;
    this.vy = 0;
    this.st.count = p.count || this.rng.int(2, 4);
    this.st.phase = 'strike';
    this.st.pt = 0;
    this.st.itemId = p.itemId || null;
    this.st.pickUp = !!p.pickUp;
    this.st.lz = this.rng.range(-2.5, 2.5);
  }

  update_peck(dt) {
    const st = this.st;
    st.pt += dt;
    this.holdHeading(dt);
    this.settleFeet();
    let it = st.itemId ? this.env.getItem(st.itemId) : null;
    if (it && !this.itemInReach(it)) {
      it = null;
      st.itemId = null;
      st.pickUp = false;
    }
    const target = it ? this.biteTarget(it) : [27, -2.6, st.lz];
    switch (st.phase) {
      case 'strike': {
        this.strikeTargets(target[0], target[1], target[2], 1.05, D.beakTip, 0.45);
        this.setT({ beak: st.pickUp && st.count === 1 ? 0.35 : 0.05, tailA: 0.22, hipH: D.hipStand - 1.5 });
        const tip = this.headPointLocal(D.beakTip);
        if (Math.hypot(tip[0] - target[0], tip[1] - target[1], tip[2] - target[2]) < 1.4 || st.pt > 0.4) {
          const wp = this.localToFloor(target[0], target[2]);
          this.emit('peckHit', { x: wp[0], y: wp[1], itemId: it ? it.id : null });
          this.emit('sound', { name: 'tock' });
          if (it && st.pickUp && st.count === 1) {
            it.state = 'carried';
            this.carry = { type: it.type, itemId: it.id, seed: it.seed };
            this.emit('pickedUp', { itemId: it.id, itemType: it.type });
          }
          st.phase = 'up';
          st.pt = 0;
          st.count--;
          st.lz = this.rng.range(-2.5, 2.5);
        }
        break;
      }
      case 'up':
        this.setT({ headX: D.headIdle.x + 1.5, headY: D.headIdle.y + 6, headA: 0.35, headYaw: 0, pitch: 0.18, beak: 0 });
        this.setOm({ headX: 20, headY: 20, headA: 18, headYaw: 18, pitch: 12 });
        if (st.pt > 0.2) {
          if (st.count > 0) {
            st.phase = 'strike';
            st.pt = 0;
          } else {
            st.phase = 'recover';
            st.pt = 0;
          }
        }
        break;
      case 'recover':
        this.standTargets();
        if (st.pt > 0.2) st.done = true;
        break;
      default:
        break;
    }
  }

  enter_giftDrop() {
    this.vx = 0;
    this.vy = 0;
    if (!this.carry) {
      this.st.done = true;
      this.st.ok = false;
      return;
    }
    this.st.phase = 'lower';
    this.st.pt = 0;
  }

  update_giftDrop(dt) {
    const st = this.st;
    if (st.done) return;
    st.pt += dt;
    const k = this.k;
    switch (st.phase) {
      case 'lower': {
        this.holdHeading(dt);
        this.settleFeet();
        const def = ITEM_TYPES[this.carry.type];
        const tip = { x: D.carryPoint.x, y: D.carryPoint.y + def.h / 2 };
        this.strikeTargets(27, -0.2, 0, 0.9, tip, 0.4);
        this.setOm({ headX: 14, headY: 14, headA: 12, pitch: 9 });
        this.setT({ tailA: 0.2, beak: 0.12 });
        const p = this.headPointLocal(tip);
        if ((Math.abs(p[1]) < 1.2 && st.pt > 0.3) || st.pt > 0.9) {
          const cp = this.headPointLocal(D.carryPoint);
          const wp = this.localToFloor(cp[0], cp[2]);
          st.drop = { x: wp[0], y: wp[1], type: this.carry.type };
          this.emit('giftDropped', { itemType: this.carry.type, giftType: this.carry.type, x: wp[0], y: wp[1], itemId: this.carry.itemId });
          this.emit('sound', { name: 'drop' });
          this.carry = null;
          st.phase = 'release';
          st.pt = 0;
        }
        break;
      }
      case 'release':
        this.holdHeading(dt);
        this.setT({ beak: 0.55, headX: D.headIdle.x - 1, headY: D.headIdle.y + 4, headA: 0.2, headYaw: 0, pitch: 0.1 });
        this.setOm({ headX: 10, headY: 10, headA: 10, pitch: 8 });
        if (st.pt > 0.25) {
          st.phase = 'back';
          st.pt = 0;
          const back = this.localToFloor(-12, 0);
          const ok = this.perchId ? false : this.world.inWalkable(back[0], back[1], 0.5);
          st.back = ok ? back : [this.x, this.y];
          st.v = 0;
        }
        break;
      case 'back': {
        this.holdHeading(dt);
        const dgx = st.back[0] - this.x;
        const dgy = (st.back[1] - this.y) / F;
        const remaining = Math.hypot(dgx, dgy);
        const accel = 160 * k;
        const vT = Math.min(22 * k, Math.sqrt(2 * accel * Math.max(0, remaining)));
        st.v = st.v < vT ? Math.min(vT, st.v + accel * dt) : Math.max(vT, st.v - accel * 1.5 * dt);
        let mv = st.v * dt;
        if (mv >= remaining) {
          mv = Math.max(0, remaining);
          st.v = 0;
        }
        const ux = remaining > 1e-9 ? dgx / remaining : 0;
        const uy = remaining > 1e-9 ? dgy / remaining : 0;
        this.x += ux * mv;
        this.y += uy * mv * F;
        this.vx = dt > 0 ? (ux * mv) / dt : 0;
        this.vy = dt > 0 ? (uy * mv * F) / dt : 0;
        if (st.v > 0.5 * k) this.gait(ux, uy, st.v);
        this.standTargets({ beak: 0, headA: 0.25, pitch: 0.06 });
        if (st.v === 0 && remaining <= 0.02 * k && this.settleFeet()) {
          st.phase = 'present';
          st.pt = 0;
          this.vx = 0;
          this.vy = 0;
          this.showEmote('note', 1.3);
          this.emit('sound', { name: 'chirp' });
        }
        break;
      }
      case 'present': {
        this.holdHeading(dt);
        this.standTargets({ headA: -0.22, headY: D.headIdle.y - 2, headX: D.headIdle.x + 1, lookX: 1, lookY: -0.2 });
        const c = this.env.cursor && this.env.cursor();
        if (c) this.lookAtPoint(...this.eyeLevelFloor(c.x, c.y), 0.8, true);
        this.settleFeet();
        if (st.pt > 0.9) st.done = true;
        break;
      }
      default:
        break;
    }
  }

  enter_reactClick(p) {
    this.vx = 0;
    this.vy = 0;
    this.st.cx = p.x;
    this.st.cy = p.y;
    this.st.phase = 'jolt';
    this.st.pt = 0;
    this.showEmote(this.env.annoyed && this.env.annoyed() ? 'annoyed' : 'alert', 1.1);
    this.emit('sound', { name: 'caw' });
    let turnTo = null;
    if (p.x != null) {
      const hd = this.headingTo(...this.eyeLevelFloor(p.x, p.y));
      if (Math.abs(M.wrapAngle(hd - this.h)) > 1.6 && Crow.floorDist(this.x, this.y, p.x, p.y) > 8 * this.k) turnTo = hd;
    }
    this.st.turnTo = turnTo;
  }

  update_reactClick(dt) {
    const st = this.st;
    st.pt += dt;
    if (st.phase === 'jolt') {
      this.holdHeading(dt);
      this.setT({ fluff: 0.9, beak: 1, headY: D.headIdle.y - 2, headA: -0.3, eye: 1 });
      this.setOm({ fluff: 26, beak: 30 });
      if (st.pt > 0.05) {
        st.phase = 'jump';
        st.pt = 0;
        this.hopBegin({ tx: this.x, ty: this.y, height: 9, turnTo: st.turnTo, perchId: this.perchId });
        this.st.hop.t = 0.05;
      }
      return;
    }
    if (st.phase === 'jump') {
      const ph = this.st.hop.phase;
      const res = this.hopUpdate(dt);
      this.setT({ wing: ph === 'air' ? 0.8 : 0.35, flapBase: 0.3, flapAmp: ph === 'air' ? 0.8 : 0.3, beak: st.pt < 0.35 ? 1 : 0, fluff: 0.6 });
      this.flapFreq = 8;
      if (res === 'done') {
        st.phase = 'glare';
        st.pt = 0;
      }
      return;
    }
    if (st.phase === 'glare') {
      this.holdHeading(dt);
      this.standTargets({ fluff: 0.25, beak: 0 });
      this.setOm({ fluff: 3 });
      const c = this.env.cursor && this.env.cursor();
      if (c) this.lookAtPoint(...this.eyeLevelFloor(c.x, c.y), 1, true);
      else if (st.cx != null) this.lookAtPoint(...this.eyeLevelFloor(st.cx, st.cy), 1, true);
      this.settleFeet();
      if (st.pt > 0.6) st.done = true;
    }
  }

  enter_dance(p) {
    this.vx = 0;
    this.vy = 0;
    const st = this.st;
    st.dur = p.duration == null ? 8 : p.duration;
    st.beat = M.clamp(p.beat || 0.5, 0.36, 0.8);
    st.phase = 'groove';
    st.pt = 0;
    st.next = st.beat * 4;
    st.dir = this.rng.sign();
    st.home = this.h;
    st.turns = 0;
    this.showEmote('note', st.beat * 2, true);
  }

  update_dance(dt) {
    const st = this.st;
    st.pt += dt;
    const beat = st.beat;
    if (st.phase === 'hop') {
      const ph = st.hop.phase;
      const res = this.hopUpdate(dt);
      this.setT({ wing: ph === 'air' ? 0.5 : 0.18, flapBase: 0.2, flapAmp: ph === 'air' ? 0.55 : 0.12, fluff: 0.3, tailFan: 0.7, beak: 0 });
      this.flapFreq = 7;
      if (res === 'done') {
        st.phase = 'groove';
        st.pt = 0;
        st.next = beat * (st.turns % 2 ? 4 : 6);
      }
      return;
    }
    this.holdHeading(dt);
    const t = this.stateTime;
    const ph = (t / beat) % 1;
    const n = Math.floor(t / beat);
    const bounce = Math.cos(ph * Math.PI * 2);
    const sway = Math.sin((t / (beat * 2)) * Math.PI * 2);
    this.standTargets({
      hipH: D.hipStand - 0.75 + 0.75 * bounce,
      pitch: 0.06 + 0.05 * bounce,
      headX: D.headIdle.x + 1.4 * bounce,
      headY: D.headIdle.y + 1.9 * bounce,
      headA: 0.1 + 0.2 * bounce,
      headYaw: 0.42 * sway,
      lookX: 0.3,
      tailA: 0.1 * sway,
      tailFan: 0.3 + 0.3 * Math.max(0, bounce),
      wing: n % 4 === 3 && ph < 0.55 ? 0.34 : 0.04,
      fluff: 0.22,
    });
    this.setOm({ hipH: 18, pitch: 14, headX: 22, headY: 22, headA: 20, headYaw: 12, tailA: 14, tailFan: 14, wing: 14 });
    const settled = this.settleFeet();
    if (!settled) return;
    if (this.queue.length || this.stateTime >= st.dur) {
      st.done = true;
      return;
    }
    if (st.pt >= st.next && this.stateTime < st.dur - beat * 3) {
      const out = st.turns % 2 === 0;
      st.turns++;
      st.phase = 'hop';
      st.pt = 0;
      if (out) st.dir = -st.dir;
      this.hopBegin({ tx: this.x, ty: this.y, height: 5, turnTo: M.wrapAngle(out ? st.home + st.dir * 0.85 : st.home), perchId: this.perchId });
    }
  }

  exit_dance() {
    this.clearEmote('note');
  }

  enter_pet(p) {
    this.vx = 0;
    this.vy = 0;
    this.st.dur = p.duration == null ? 2.5 : p.duration;
    this.st.eyeTarget = 0.3;
    this.showEmote('heart', 1.4, true);
  }

  update_pet(dt) {
    const st = this.st;
    this.holdHeading(dt);
    const t = this.stateTime;
    const lean = Math.sin(t * 2.3);
    this.standTargets({
      hipH: D.hipStand - 0.7 + 0.25 * Math.sin(t * 3.1),
      pitch: -0.02,
      headX: D.headIdle.x - 1.4,
      headY: D.headIdle.y + 1,
      headA: -0.12 + 0.05 * lean,
      headYaw: 0.3 * lean,
      lookX: 0.2,
      lookY: 0.3,
      tailA: 0.05 * lean,
      tailFan: 0.25,
      fluff: 0.75,
    });
    this.setOm({ fluff: 5, headYaw: 6, headA: 8, hipH: 8 });
    this.ct.eye = st.eyeTarget;
    this.om.eye = 10;
    const settled = this.settleFeet();
    if ((this.stateTime >= st.dur || this.queue.length) && settled) st.done = true;
  }

  exit_pet() {
    this.clearEmote('heart');
  }

  keepPetting(seconds) {
    if (this.state !== 'pet') return false;
    this.st.dur = Math.max(this.st.dur, this.stateTime + seconds);
    return true;
  }

  enter_reactSpawn(p) {
    this.vx = 0;
    this.vy = 0;
    const it = this.env.getItem(p.itemId);
    this.st.itemId = p.itemId;
    this.st.phase = 'alert';
    this.st.pt = 0;
    this.showEmote('alert', 0.9);
    if (it) {
      const hd = this.headingTo(it.x, it.y);
      this.st.faceTo = hd;
      if (Math.abs(M.wrapAngle(hd - this.h)) > 1.6 && Crow.floorDist(this.x, this.y, it.x, it.y) > 12 * this.k) {
        this.st.phase = 'turn';
        this.hopBegin({ tx: this.x, ty: this.y, height: 6, turnTo: hd, perchId: this.perchId });
        this.st.hop.t = 0.03;
      }
    }
  }

  update_reactSpawn(dt) {
    const st = this.st;
    st.pt += dt;
    const it = this.env.getItem(st.itemId);
    if (st.phase === 'turn') {
      const res = this.hopUpdate(dt);
      this.setT({ wing: 0.15, flapBase: 0.2, flapAmp: 0.2, headY: D.headIdle.y - 2 });
      if (res === 'done') {
        st.phase = 'alert';
        st.pt = 0;
        st.faceTo = null;
      }
      return;
    }
    this.standTargets({ hipH: D.hipStand + 1.6, pitch: -0.06, headY: D.headIdle.y - 3, tailA: st.pt < 0.25 ? 0.3 : 0.05 });
    this.setOm({ headX: 24, headY: 24, headA: 26, headYaw: 20, hipH: 16 });
    if (st.faceTo != null && this.turnToward(dt, st.faceTo, TURN_STAND, 9) < 0.02) st.faceTo = null;
    else if (st.faceTo == null) this.holdHeading(dt);
    if (it) this.lookAtPoint(it.x, it.y, 1);
    const settled = this.settleFeet(st.faceTo != null ? 1.0 : 1.3);
    if (st.pt > 0.55 && st.faceTo == null && settled) st.done = true;
    if (st.pt > 2.5) st.done = true;
  }

  carryWorld() {
    const p = this.headPointLocal(D.carryPoint);
    const [x, y] = this.localToFloor(p[0], p[2]);
    return { x, y, z: this.z + Math.max(0, -p[1]) * this.k };
  }

  dropCarry() {
    if (!this.carry) return;
    const at = this.carryWorld();
    const carry = this.carry;
    this.carry = null;
    this.emit('dropCarried', { carry, x: at.x, y: at.y, z: at.z });
  }

  grab(gx, gy) {
    if (this.state === 'away' || this.state === 'held' || !this.visible) return false;
    this.queue = [];
    if (this.action) this.finishAction(false);
    this.dropCarry();
    this.enter('held', { gx, gy });
    return true;
  }

  release(vx, vy) {
    if (this.state !== 'held') return false;
    const k = this.k;
    const sp = Math.hypot(vx, vy);
    const cap = 900 * k;
    const s = sp > cap ? cap / sp : 1;
    let fvx = this.vx * 0.6 + vx * s * 0.4;
    let fvy = this.vy * 0.6 + vy * s * 0.4;
    const fsp = Math.hypot(fvx, fvy);
    if (fsp > THROW_MAX * k) {
      fvx *= (THROW_MAX * k) / fsp;
      fvy *= (THROW_MAX * k) / fsp;
    }
    this.vx = fvx;
    this.vy = fvy;
    const feetY = this.y - this.z * H;
    let target = null;
    for (const p of this.world.perches) {
      const r = this.world.perchRange(p);
      if (!r || this.x < r.x0 || this.x > r.x1) continue;
      const dy = p.y - feetY;
      if (dy > -10 * k && dy < 28 * k && (!target || Math.abs(dy) < Math.abs(target.y - feetY))) target = { x: this.x, y: p.y, perchId: p.id };
    }
    this.enter('fly', { mode: 'drop', fromAir: true, reason: 'released', target });
    return true;
  }

  enter_held(p) {
    if (!this.airborne) this.liftoff(Math.max(0, this.cv.hipH) * this.k, 'grab');
    this.perchId = null;
    const ax = this.x;
    const ay = this.y - this.z * H;
    this.st.off = [ax - p.gx, ay - p.gy];
    this.st.dv = [this.vx, this.vy - this.vz * H];
    this.st.flurry = 0.45;
    this.st.nextFlurry = this.rng.range(0.9, 2.2);
    this.hv = this.hRate || 0;
    this.lookTarget = null;
    this.clearEmote('sleep');
    this.showEmote('alert', 1.0);
    this.emit('sound', { name: 'caw' });
    this.cawT = 0.3;
    this.cawKind = 'caw';
  }

  update_held(dt) {
    const st = this.st;
    const k = this.k;
    const cur = (this.env.cursor && this.env.cursor()) || null;
    const ax = this.x;
    const ay = this.y - this.z * H;
    let nx = ax;
    let ny = ay;
    if (cur) {
      const tx = cur.x + st.off[0];
      const ty = cur.y + st.off[1];
      const rx = M.springStep(ax, st.dv[0], tx, 24, dt);
      const ry = M.springStep(ay, st.dv[1], ty, 24, dt);
      let vx = rx[1];
      let vy = ry[1];
      nx = rx[0];
      ny = ry[0];
      const sp = Math.hypot(vx, vy);
      if (sp > HOLD_SPEED_MAX) {
        vx *= HOLD_SPEED_MAX / sp;
        vy *= HOLD_SPEED_MAX / sp;
        const mv = Math.hypot(nx - ax, ny - ay);
        const lim = HOLD_SPEED_MAX * dt;
        if (mv > lim) {
          nx = ax + ((nx - ax) * lim) / mv;
          ny = ay + ((ny - ay) * lim) / mv;
        }
      }
      st.dv = [vx, vy];
    } else {
      st.dv = [st.dv[0] * Math.exp(-8 * dt), st.dv[1] * Math.exp(-8 * dt)];
    }
    const zT = 24 * k;
    const rz = M.springStep(this.z, this.vz, zT, 10, dt);
    this.z = Math.max(0, rz[0]);
    this.vz = rz[1];
    const gx = nx;
    const gy = ny + this.z * H;
    this.shift.dx += nx - ax;
    this.shift.dy += ny - ay;
    this.vx = dt > 0 ? (gx - this.x) / dt : 0;
    this.vy = dt > 0 ? (gy - this.y) / dt : 0;
    this.x = gx;
    this.y = gy;
    const sp = Math.hypot(st.dv[0], st.dv[1]);
    st.nextFlurry -= dt;
    if (st.nextFlurry <= 0 || (sp > 700 * k && st.flurry <= 0)) {
      st.flurry = this.rng.range(0.3, 0.6);
      st.nextFlurry = this.rng.range(0.9, 2.4);
      if (this.rng.chance(0.4)) this.caw('caw');
    }
    const flurry = st.flurry > 0;
    if (flurry) st.flurry -= dt;
    this.setT({
      hipH: D.hipAir,
      pitch: M.clamp(0.1 - st.dv[1] * 0.00035, -0.4, 0.45),
      headX: D.headIdle.x - 1,
      headY: D.headIdle.y + 1,
      headA: flurry ? -0.15 : 0.15,
      headYaw: M.clamp(-st.dv[0] * 0.0006, -0.7, 0.7),
      wing: flurry ? 1 : 0.18,
      flapBase: flurry ? 0.1 : 0.2,
      flapAmp: flurry ? 0.9 : 0,
      tailFan: flurry ? 0.8 : 0.3,
      tailA: -0.1,
      fluff: 0.35,
      lookX: 0.3,
      lookY: -0.3,
    });
    this.setOm({ wing: 16, flapAmp: 14, pitch: 7 });
    this.flapFreq = 7;
    if (sp > 260 * k) this.turnToward(dt, Math.atan2(st.dv[1] / F, st.dv[0]), 2.5, 6);
    else this.holdHeading(dt);
    this.st.airFeet = [
      { lx: 0.6 - st.dv[0] * 0.002, ly: -D.hipAir + 22, lz: 2.4 },
      { lx: -0.6 - st.dv[0] * 0.002, ly: -D.hipAir + 22, lz: -2.4 },
    ];
    this.st.airFeetOmega = 9;
    this.st.airCurl = 0.45;
  }

  enter_away() {
    this.visible = false;
    this.airborne = true;
    this.perchId = null;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.emit('away', {});
  }

  update_away() {
    this.st.done = this.queue.length > 0;
  }

  composePose() {
    const p = this.pose;
    p.x = this.x;
    p.y = this.y;
    p.z = this.z;
    p.h = this.h;
    p.k = this.k;
    p.hipH = this.c.hipH;
    p.pitch = this.c.pitch;
    p.headX = this.c.headX;
    p.headY = this.c.headY;
    p.headA = this.c.headA;
    p.headYaw = this.c.headYaw;
    p.beak = M.clamp(this.c.beak, 0, 1);
    p.eye = M.clamp(this.c.eye, 0, 1);
    p.lookX = this.c.lookX;
    p.lookY = this.c.lookY;
    p.wing = M.clamp(this.c.wing, 0, 1);
    p.flap = M.clamp(this.c.flapBase + this.c.flapAmp * Math.sin(this.flapPhase), -1, 1);
    p.tailA = this.c.tailA;
    p.tailFan = M.clamp(this.c.tailFan, 0, 1);
    p.fluff = M.clamp(this.c.fluff, 0, 1.2);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const q = p.feet[i];
      q.x = f.x;
      q.y = f.y;
      q.lx = f.lx;
      q.ly = f.ly;
      q.lz = f.lz;
      q.th = f.th;
      q.planted = f.planted && !this.airborne;
      q.curl = M.clamp(f.curl, 0, 1);
    }
    p.carry = this.carry ? { type: this.carry.type, seed: this.carry.seed || 0 } : null;
    if (this.emote) {
      const e = this.emote;
      const el = this.time - e.t0;
      const t = e.loop ? (el / e.dur) % 1 : M.clamp(el / e.dur, 0, 1);
      const a = e.loop ? M.clamp(el / 0.4, 0, 1) : M.clamp(Math.min(el / 0.12, (e.dur - el) / 0.25), 0, 1);
      p.emote = { kind: e.kind, t, a };
    } else p.emote = null;
    p.shadow = 1;
    return p;
  }

  onWorldChanged(prevPerch) {
    if (this.state === 'away' || this.airborne) return;
    const w = this.world;
    const k = this.k;
    if (!this.perchId) return;
    let p = w.perch(this.perchId);
    let dx = 0;
    let dy = 0;
    const room = 4 * k;
    const fits = (q, x) => x >= q.x0 + room && x <= q.x1 - room;
    if (!p || Math.abs(p.y - this.y) > 0.01 || !fits(p, this.x)) {
      let cand = null;
      if (prevPerch && prevPerch.windowId) {
        const pw = prevPerch.win;
        for (const q of w.perches) {
          if (q.windowId !== prevPerch.windowId || !q.win) continue;
          const ddx = q.win.x - pw.x;
          const ddy = q.win.y - pw.y;
          if (fits(q, this.x + ddx)) {
            cand = q;
            dx = ddx;
            dy = ddy;
            break;
          }
        }
      } else if (prevPerch && prevPerch.kind === 'taskbar') {
        const q = w.perch(prevPerch.id);
        if (q && fits(q, this.x)) {
          cand = q;
          dy = q.y - this.y;
        }
      }
      if (cand && Math.hypot(dx, dy) > RIDE_MAX * k) {
        cand = null;
        this.showEmote('alert', 0.9);
      }
      if (!cand) {
        this.perchId = null;
        this.perchLostAt = this.time;
        return;
      }
      p = cand;
      this.perchId = p.id;
    }
    if (dx || dy) {
      this.x += dx;
      this.y += dy;
      for (const f of this.feet) {
        f.x += dx;
        f.y += dy;
        if (f.swing) {
          f.swing.x0 += dx;
          f.swing.x1 += dx;
          f.swing.y0 += dy;
          f.swing.y1 += dy;
        }
      }
      this.pendingShift.dx += dx;
      this.pendingShift.dy += dy;
      this.shiftedAt = this.time;
      if (this.st.tx != null) this.st.tx += dx;
      if (this.st.ty != null) this.st.ty += dy;
      if (this.st.hop && this.st.hop.tx != null) {
        this.st.hop.tx += dx;
        this.st.hop.ty += dy;
      }
      if (this.st.back) this.st.back = [this.st.back[0] + dx, this.st.back[1] + dy];
      this.emit('rode', { dx, dy });
    }
    for (const f of this.feet) {
      const off = f.planted && (f.x < p.x0 || f.x > p.x1);
      const offTarget = f.swing && (f.swing.x1 < p.x0 + 1.4 * k || f.swing.x1 > p.x1 - 1.4 * k);
      if (off || offTarget) {
        const [hx, hy] = this.clampFoot(...this.homeFloor(f.i));
        this.startSwing(f.i, hx, hy, 0.12, offTarget ? 1 : 2.2, this.h);
      }
    }
    this.composePose();
  }
}

module.exports = { Crow, ANIM_STATES, TRANSITIONS, REACH, REACH_SAFE, GROUND_STATES: GROUND };
