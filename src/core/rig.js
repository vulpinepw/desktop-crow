'use strict';

const { clamp, lerp, smoothstep } = require('./math');
const { DIMS: D, CAM, WING_FOLDED, WING_SPREAD } = require('./dims');

const CHANNELS = Object.freeze([
  'hipH', 'pitch', 'headX', 'headY', 'headA', 'headYaw', 'beak', 'eye',
  'lookX', 'lookY', 'wing', 'flap', 'tailA', 'tailFan', 'fluff',
]);

function makeFoot(i) {
  const side = i === 0 ? 1 : -1;
  return { x: 0, y: 0, lx: side * D.stanceX, ly: -D.footLift, lz: side * D.stanceZ, th: 0, planted: true, curl: 0 };
}

function defaultPose() {
  return {
    x: 0,
    y: 0,
    z: 0,
    h: 0,
    k: 1,
    hipH: D.hipStand,
    pitch: 0.04,
    headX: D.headIdle.x,
    headY: D.headIdle.y,
    headA: 0.1,
    headYaw: 0,
    beak: 0,
    eye: 1,
    lookX: 0.3,
    lookY: 0,
    wing: 0,
    flap: 0,
    tailA: 0,
    tailFan: 0,
    fluff: 0,
    feet: [makeFoot(0), makeFoot(1)],
    carry: null,
    emote: null,
    shadow: 1,
  };
}

function clonePose(p) {
  const q = Object.assign({}, p);
  q.feet = p.feet.map((f) => Object.assign({}, f));
  q.carry = p.carry ? Object.assign({}, p.carry) : null;
  q.emote = p.emote ? Object.assign({}, p.emote) : null;
  return q;
}

function frameOf(h) {
  const c = Math.cos(h);
  const s = Math.sin(h);
  return {
    c,
    s,
    cx: CAM.H * s,
    cy: -CAM.F,
    cz: -CAM.H * c,
  };
}

function proj(fr, lx, ly, lz) {
  return [lx * fr.c + lz * fr.s, (lx * fr.s - lz * fr.c) * CAM.F + ly * CAM.H];
}

function depthOf(fr, lx, ly, lz) {
  return lx * fr.cx + ly * fr.cy + lz * fr.cz;
}

function projectEllipsoid(fr, center, axes) {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const v of axes) {
    const p = proj(fr, v[0], v[1], v[2]);
    a += p[0] * p[0];
    b += p[0] * p[1];
    c += p[1] * p[1];
  }
  const half = (a + c) / 2;
  const disc = Math.sqrt(Math.max(0, ((a - c) * (a - c)) / 4 + b * b));
  const pc = proj(fr, center[0], center[1], center[2]);
  return {
    cx: pc[0],
    cy: pc[1],
    rx: Math.sqrt(Math.max(1e-6, half + disc)),
    ry: Math.sqrt(Math.max(1e-6, half - disc)),
    rot: 0.5 * Math.atan2(2 * b, a - c),
  };
}

function bodyToLocal(pose, bx, by) {
  const c = Math.cos(pose.pitch);
  const s = Math.sin(pose.pitch);
  return [bx * c - by * s, -pose.hipH + bx * s + by * c];
}

function hull(pts) {
  const p = pts.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function quad3(a, c, b, t) {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
}

const FL = (pose) => clamp(pose.fluff, 0, 1.2);

function bodyAxes(pose) {
  const fl = FL(pose);
  const r = D.body.rot + pose.pitch;
  const rx = D.body.rx + fl * 2.2;
  const ry = D.body.ry + fl * 2.6;
  const rz = D.body.rz + fl * 2.2;
  return {
    center: [...bodyToLocal(pose, D.body.cx, D.body.cy), 0],
    axes: [
      [Math.cos(r) * rx, Math.sin(r) * rx, 0],
      [-Math.sin(r) * ry, Math.cos(r) * ry, 0],
      [0, 0, rz],
    ],
    rx,
    ry,
    rz,
  };
}

function bodyHalfWidthAt(pose, bx, by) {
  const fl = FL(pose);
  const rx = D.body.rx + fl * 2.2;
  const ry = D.body.ry + fl * 2.6;
  const rz = D.body.rz + fl * 2.2;
  const r0 = D.body.rot;
  const dx = bx - D.body.cx;
  const dy = by - D.body.cy;
  const u = (dx * Math.cos(r0) + dy * Math.sin(r0)) / rx;
  const v = (-dx * Math.sin(r0) + dy * Math.cos(r0)) / ry;
  const q = 1 - u * u - v * v;
  return rz * Math.sqrt(Math.max(0, q)) * 0.94 + 1.1;
}

function wingPoints(pose, side) {
  const spread = clamp(pose.wing, 0, 1);
  const elev = clamp(pose.flap, -1, 1) * 1.3;
  const elevSin = Math.sin(elev);
  const elevCos = Math.cos(elev);
  const span = D.wingSpan;
  const out = new Array(WING_FOLDED.length);
  for (let i = 0; i < WING_FOLDED.length; i++) {
    const f = WING_FOLDED[i];
    const w = WING_SPREAD[i];
    const fz = bodyHalfWidthAt(pose, f[0], f[1]);
    const sx = D.shoulder.x + w[0] + D.wingSweep * w[1];
    const sy = D.shoulder.y - w[1] * span * elevSin;
    const sz = D.shoulderZ + w[1] * span * elevCos;
    const bx = lerp(f[0], sx, spread);
    const by = lerp(f[1], sy, spread);
    const [lx, ly] = bodyToLocal(pose, bx, by);
    out[i] = [lx, ly, lerp(fz, sz, spread) * side];
  }
  return out;
}

function tailParts(pose) {
  const fan = clamp(pose.tailFan, 0, 1);
  const a = D.tailAngle + pose.tailA;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const mx = (D.tailTop.x + D.tailBottom.x) / 2;
  const my = (D.tailTop.y + D.tailBottom.y) / 2;
  const len = D.tailLen + fan * 2;
  const halfW = D.tailTipZ + fan * 5.2;
  const cx = mx + dx * len;
  const cy = my + dy * len;
  const L = (bx, by, z) => [...bodyToLocal(pose, bx, by), z];
  const pts = [
    L(D.tailTop.x, D.tailTop.y, D.tailRootZ),
    L(D.tailTop.x, D.tailTop.y, -D.tailRootZ),
    L(D.tailBottom.x, D.tailBottom.y, D.tailRootZ),
    L(D.tailBottom.x, D.tailBottom.y, -D.tailRootZ),
  ];
  const edge = [];
  for (let i = 0; i <= 6; i++) {
    const t = lerp(-1, 1, i / 6);
    const bulge = Math.cos(t * Math.PI * 0.5) * (2.2 + fan * 1.5);
    const ex = cx + dx * bulge;
    const ey = cy + dy * bulge;
    edge.push(L(ex - dy * 0.8, ey + dx * 0.8, t * halfW));
    edge.push(L(ex + dy * 0.8, ey - dx * 0.8, t * halfW));
  }
  const tip = L(cx + dx * (2.2 + fan * 1.5), cy + dy * (2.2 + fan * 1.5), 0);
  const root = L(mx, my, 0);
  const lines = [-0.55, 0, 0.55].map((t) => [root, L(cx + dx * 1.4, cy + dy * 1.4, t * halfW)]);
  return { pts: pts.concat(edge), tip, root, lines };
}

function headFrame(pose) {
  const fl = FL(pose);
  const yaw = pose.headYaw || 0;
  const a = pose.headA;
  return {
    c: [pose.headX, -pose.hipH + pose.headY, 0],
    r: D.headR + fl * 0.7,
    cyaw: Math.cos(yaw),
    syaw: Math.sin(yaw),
    ca: Math.cos(a),
    sa: Math.sin(a),
    a,
    yaw,
  };
}

function headLocal(hf, px, py, pz = 0) {
  const f = px * hf.ca - py * hf.sa;
  const d = px * hf.sa + py * hf.ca;
  return [hf.c[0] + f * hf.cyaw - pz * hf.syaw, hf.c[1] + d, hf.c[2] + f * hf.syaw + pz * hf.cyaw];
}

function headDir(hf, px, py, pz = 0) {
  const f = px * hf.ca - py * hf.sa;
  const d = px * hf.sa + py * hf.ca;
  return [f * hf.cyaw - pz * hf.syaw, d, f * hf.syaw + pz * hf.cyaw];
}

function beakParts(hf, open) {
  const tip = D.beakTip;
  const hinge = D.beakHinge;
  const upper = [
    [tip.x, tip.y, 0],
    [4.4, -4.7, 0],
    [5.0, -1.4, 3.1],
    [5.0, -1.4, -3.1],
    [hinge.x, hinge.y, 2.5],
    [hinge.x, hinge.y, -2.5],
  ];
  const ridge = [];
  for (let i = 0; i <= 6; i++) {
    const p = quad3([4.4, -4.7, 0], [13.5, -5.0, 0], [tip.x, tip.y, 0], i / 6);
    ridge.push(p);
    const w = 3.0 * (1 - i / 6) + 0.25;
    upper.push([p[0], p[1] + 2.4 * (1 - i / 6), w], [p[0], p[1] + 2.4 * (1 - i / 6), -w]);
  }
  const oa = clamp(open, 0, 1) * 0.5;
  const rot = (x, y, z) => {
    const dx = x - hinge.x;
    const dy = y - hinge.y;
    const c = Math.cos(oa);
    const s = Math.sin(oa);
    return [hinge.x + dx * c - dy * s, hinge.y + dx * s + dy * c, z];
  };
  const lowerRaw = [[hinge.x, hinge.y, 2.3], [hinge.x, hinge.y, -2.3], [tip.x - 1.2, tip.y + 0.6, 0]];
  for (let i = 1; i < 5; i++) {
    const p = quad3([tip.x - 1.2, tip.y + 0.6, 0], [12.5, 4.0, 0], [4.6, 3.9, 0], i / 5);
    const w = 2.1 * (i / 5) + 0.2;
    lowerRaw.push([p[0], p[1], w], [p[0], p[1], -w]);
  }
  const lower = lowerRaw.map((p) => rot(p[0], p[1], p[2]));
  return {
    upper: upper.map((p) => headLocal(hf, p[0], p[1], p[2])),
    lower: lower.map((p) => headLocal(hf, p[0], p[1], p[2])),
    ridge: ridge.map((p) => headLocal(hf, p[0], p[1], p[2])),
    tip: headLocal(hf, tip.x, tip.y, 0),
    lowerTip: headLocal(hf, lower[2][0], lower[2][1], lower[2][2]),
  };
}

function solveIK3(h, f, a, b, pole) {
  let dx = f[0] - h[0];
  let dy = f[1] - h[1];
  let dz = f[2] - h[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) {
    dx = 0;
    dy = 1;
    dz = 0;
  } else {
    dx /= d;
    dy /= d;
    dz /= d;
  }
  const dc = clamp(d, Math.abs(a - b) + 1e-6, a + b - 1e-6);
  const along = (a * a - b * b + dc * dc) / (2 * dc);
  const hh = Math.sqrt(Math.max(0, a * a - along * along));
  const pd = pole[0] * dx + pole[1] * dy + pole[2] * dz;
  let px = pole[0] - pd * dx;
  let py = pole[1] - pd * dy;
  let pz = pole[2] - pd * dz;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    px = -dy;
    py = dx;
    pz = 0;
    pl = Math.hypot(px, py, pz) || 1;
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  return {
    knee: [h[0] + dx * along + px * hh, h[1] + dy * along + py * hh, h[2] + dz * along + pz * hh],
    d,
    reach: d <= a + b + 1e-9,
  };
}

const LEG_POLE = [-1, 0.25, 0];

function hipLocal(pose, i) {
  const side = i === 0 ? 1 : -1;
  return [side * D.hipX, -pose.hipH, side * D.hipZ];
}

function toeLines(foot, h) {
  const curl = clamp(foot.curl, 0, 1);
  const d = Number.isFinite(foot.th) ? foot.th - h : 0;
  const f = [foot.lx, foot.ly, foot.lz];
  const af = curl * 1.15;
  const ab = Math.PI - curl * 0.85;
  const toe = (ang, len, knuckle, curlA) => {
    const tx = Math.cos(ang);
    const tz = -Math.sin(ang);
    const pts = [f];
    if (knuckle) {
      const kx = 3.4 * Math.cos(curlA) + 0.35 * Math.sin(curlA);
      const ky = 3.4 * Math.sin(curlA) - 0.35 * Math.cos(curlA);
      pts.push([f[0] + tx * kx, f[1] + ky, f[2] + tz * kx]);
    }
    const ex = len * Math.cos(curlA);
    const ey = len * Math.sin(curlA);
    pts.push([f[0] + tx * ex, f[1] + ey, f[2] + tz * ex]);
    return pts;
  };
  const back = [f, [f[0] + Math.cos(d) * Math.cos(ab) * D.toeBack, f[1] + Math.sin(ab) * D.toeBack, f[2] - Math.sin(d) * Math.cos(ab) * D.toeBack]];
  return {
    front: toe(d + D.toeSplay * 0.5, D.toeFront, true, af),
    front2: toe(d - D.toeSplay, D.toeFront - 1.8, false, af + 0.18 * curl),
    back,
  };
}

function computeRig(pose) {
  const fr = frameOf(pose.h);
  const P = (p) => proj(fr, p[0], p[1], p[2]);
  const Z = (p) => depthOf(fr, p[0], p[1], p[2]);
  const fl = FL(pose);

  const ba = bodyAxes(pose);
  const body = projectEllipsoid(fr, ba.center, ba.axes);
  const sheenC = bodyToLocal(pose, D.body.cx - 2, D.body.cy - ba.ry * 0.5);
  const r = D.body.rot + pose.pitch;
  const sheen = projectEllipsoid(fr, [sheenC[0], sheenC[1], 0], [
    [Math.cos(r) * ba.rx * 0.78, Math.sin(r) * ba.rx * 0.78, 0],
    [-Math.sin(r) * ba.ry * 0.36, Math.cos(r) * ba.ry * 0.36, 0],
    [0, 0, ba.rz * 0.62],
  ]);

  const hf = headFrame(pose);
  const headC = hf.c;
  const hv = P(headC);
  const head = { x: hv[0], y: hv[1], r: hf.r };
  const nbL = bodyToLocal(pose, D.neckBase.x, D.neckBase.y);
  const nb = [nbL[0], nbL[1], 0];
  const nbv = P(nb);
  const neck = { x0: nbv[0], y0: nbv[1], x1: head.x, y1: head.y, w: D.neckWidth + fl * 1.6 };
  const bp = beakParts(hf, pose.beak);
  const fwd = headDir(hf, 1, 0, 0);
  const faceToCam = fwd[0] * fr.cx + fwd[1] * fr.cy + fwd[2] * fr.cz;
  const up = headDir(hf, 0, -1, 0);
  const beak = {
    upper: hull(bp.upper.map(P)),
    lower: hull(bp.lower.map(P)),
    ridge: bp.ridge.map(P),
    tip: P(bp.tip),
    lowerTip: P(bp.lowerTip),
    faceToCam,
    ridgeVis: clamp((up[0] * fr.cx + up[1] * fr.cy + up[2] * fr.cz) * 1.6 + 0.2, 0, 1),
  };
  const lookX = clamp(pose.lookX, -1, 1);
  const lookY = clamp(pose.lookY, -1, 1);
  const gaze = headDir(hf, Math.cos(lookX * 0.5) * Math.cos(lookY * 0.5), Math.sin(lookY * 0.5) * 0.9, Math.sin(lookX * 0.5) * 0.9);
  const eyes = [1, -1].map((side) => {
    const e = D.eye;
    const c = headLocal(hf, e.x, e.y, e.z * side);
    const nRaw = headDir(hf, e.x * 0.6, e.y * 0.6, e.z * side);
    const nl = Math.hypot(nRaw[0], nRaw[1], nRaw[2]) || 1;
    const n = [nRaw[0] / nl, nRaw[1] / nl, nRaw[2] / nl];
    const facing = n[0] * fr.cx + n[1] * fr.cy + n[2] * fr.cz;
    const cv = P(c);
    const pn = proj(fr, n[0], n[1], n[2]);
    const squash = clamp(Math.abs(facing), 0.35, 1);
    const gd = gaze[0] * n[0] + gaze[1] * n[1] + gaze[2] * n[2];
    const gt = proj(fr, gaze[0] - gd * n[0], gaze[1] - gd * n[1], gaze[2] - gd * n[2]);
    const gl = Math.hypot(gt[0], gt[1]);
    const pm = Math.min(0.95, gl * 1.3);
    return {
      x: cv[0],
      y: cv[1],
      r: e.r,
      rot: Math.atan2(pn[1], pn[0]),
      squash,
      open: clamp(pose.eye, 0, 1),
      vis: smoothstep(0.02, 0.4, facing),
      px: gl > 1e-6 ? (gt[0] / gl) * pm * squash : 0,
      py: gl > 1e-6 ? (gt[1] / gl) * pm : 0,
      depth: Z(c),
      side,
    };
  });

  const tp = tailParts(pose);
  const tail = hull(tp.pts.map(P));
  const tailLines = tp.lines.map(([a, b]) => [P(a), P(b)]);

  const wl3 = wingPoints(pose, 1);
  const wr3 = wingPoints(pose, -1);
  const wingL = wl3.map(P);
  const wingR = wr3.map(P);
  const centroid = (pts) => {
    const c = [0, 0, 0];
    for (const p of pts) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    return c.map((v) => v / pts.length);
  };
  const wingFace = (pts, side) => {
    const a = pts[0];
    const b = pts[4];
    const c = pts[8];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((q) => (q / nl) * side);
    return n[0] * fr.cx + n[1] * fr.cy + n[2] * fr.cz;
  };

  const legs = [];
  for (let i = 0; i < 2; i++) {
    const f = pose.feet[i];
    const hip = hipLocal(pose, i);
    const foot = [f.lx, f.ly, f.lz];
    const ik = solveIK3(hip, foot, D.legUpper, D.legLower, LEG_POLE);
    const tl = toeLines(f, pose.h);
    legs.push({
      hip: P(hip),
      knee: P(ik.knee),
      foot: P(foot),
      hip3: hip,
      knee3: ik.knee,
      foot3: foot,
      reach: ik.reach,
      d: ik.d,
      planted: !!f.planted,
      side: i === 0 ? 1 : -1,
      toes: { front: tl.front.map(P), front2: tl.front2.map(P), back: tl.back.map(P) },
      toes3: tl,
      depth: Z([(hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2, (hip[2] + foot[2]) / 2]),
    });
  }

  const dBody = Z(ba.center);
  const dNeckHead = Z([(nb[0] + headC[0]) / 2, (nb[1] + headC[1]) / 2, 0]) + 0.35 * (Z(headC) - Z(nb));
  const parts = [
    { name: 'tail', d: Z(centroid(tp.pts)) },
    { name: 'body', d: dBody },
    { name: 'wingL', d: Z(centroid(wl3)) },
    { name: 'wingR', d: Z(centroid(wr3)) },
    { name: 'head', d: dNeckHead },
  ];
  parts.sort((p, q) => p.d - q.d);
  const legOrder = legs[0].depth <= legs[1].depth ? [0, 1] : [1, 0];

  const cp = headLocal(hf, D.carryPoint.x, D.carryPoint.y, 0);
  const carryPt = P(cp);
  const cf = proj(fr, fwd[0], fwd[1], fwd[2]);
  const carryAng = Math.atan2(cf[1], Math.abs(cf[0]) < 1e-6 ? 1e-6 : cf[0]);
  const emotePt = [head.x + 5, head.y - head.r - 13];

  const z = pose.z || 0;
  const k = pose.k || 1;
  const sh = projectEllipsoid(fr, [0, 0, 0], [[14.5, 0, 0], [0, 0, 9.5], [0, 0, 0]]);
  sh.cy += (z * CAM.H) / k;
  const shadow = Object.assign(sh, { a: clamp(pose.shadow == null ? 1 : pose.shadow, 0, 1) * (1 - smoothstep(10 * k, 260 * k, z)) });

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (p) => {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  };
  const er = Math.max(body.rx, body.ry);
  add([body.cx - er, body.cy - er]);
  add([body.cx + er, body.cy + er]);
  add([head.x - head.r, head.y - head.r]);
  add([head.x + head.r, head.y + head.r]);
  beak.upper.forEach(add);
  beak.lower.forEach(add);
  tail.forEach(add);
  wingL.forEach(add);
  wingR.forEach(add);
  for (const l of legs) {
    add(l.knee);
    add(l.foot);
    l.toes.front.forEach(add);
    l.toes.back.forEach(add);
  }

  const sideSep = clamp(Math.abs(fr.cz) * 1.6, 0, 1);

  return {
    pose,
    fr,
    hip: P([0, -pose.hipH, 0]),
    body,
    sheen,
    neck,
    head,
    headFrame: hf,
    beak,
    eyes,
    eye: eyes[0].vis >= eyes[1].vis ? eyes[0] : eyes[1],
    tail,
    tailTip: P(tp.tip),
    tailLines,
    wingL,
    wingR,
    wingFaceL: wingFace(wl3, 1),
    wingFaceR: wingFace(wr3, -1),
    wing3: { L: wl3, R: wr3 },
    legs,
    legOrder,
    parts,
    depth: { body: dBody, head: Z(headC) },
    sideSep,
    carryPt,
    carryAng,
    emotePt,
    shadow,
    bbox: { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 },
  };
}

function toWorld(pose, vx, vy) {
  return [pose.x + pose.k * vx, pose.y - (pose.z || 0) * CAM.H + pose.k * vy];
}

function worldToView(pose, wx, wy) {
  return [(wx - pose.x) / pose.k, (wy - (pose.y - (pose.z || 0) * CAM.H)) / pose.k];
}

function worldBounds(rig, margin = 0) {
  const p = rig.pose;
  const s = rig.shadow;
  const x0 = Math.min(rig.bbox.x0, s.cx - s.rx);
  const x1 = Math.max(rig.bbox.x1, s.cx + s.rx);
  const y0 = Math.min(rig.bbox.y0, s.cy - s.ry);
  const y1 = Math.max(rig.bbox.y1, s.cy + s.ry);
  const a = toWorld(p, x0, y0);
  const b = toWorld(p, x1, y1);
  return { x: a[0] - margin, y: a[1] - margin, width: b[0] - a[0] + margin * 2, height: b[1] - a[1] + margin * 2 };
}

function keyPoints(rig) {
  const p = rig.pose;
  const w = (pt) => toWorld(p, pt[0], pt[1]);
  return {
    hip: w(rig.hip),
    body: w([rig.body.cx, rig.body.cy]),
    neck: w([rig.neck.x0, rig.neck.y0]),
    head: w([rig.head.x, rig.head.y]),
    beakTip: w(rig.beak.tip),
    eye: w([rig.eyes[0].x, rig.eyes[0].y]),
    tailTip: w(rig.tailTip),
    wingLTip: w(rig.wingL[4]),
    wingRTip: w(rig.wingR[4]),
    kneeL: w(rig.legs[0].knee),
    kneeR: w(rig.legs[1].knee),
    footL: w(rig.legs[0].foot),
    footR: w(rig.legs[1].foot),
    toeL: w(rig.legs[0].toes.front[2]),
    toeR: w(rig.legs[1].toes.front[2]),
  };
}

function pointInEllipse(px, py, e, pad) {
  const c = Math.cos(-e.rot);
  const s = Math.sin(-e.rot);
  const dx = px - e.cx;
  const dy = py - e.cy;
  const x = dx * c - dy * s;
  const y = dx * s + dy * c;
  const rx = e.rx + pad;
  const ry = e.ry + pad;
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function hitTest(rig, wx, wy, pad = 4) {
  const p = rig.pose;
  const [vx, vy] = worldToView(p, wx, wy);
  const lp = pad / p.k;
  if (pointInEllipse(vx, vy, rig.body, lp)) return true;
  const h = rig.head;
  if (Math.hypot(vx - h.x, vy - h.y) <= h.r + lp) return true;
  const n = rig.neck;
  const ax = n.x1 - n.x0;
  const ay = n.y1 - n.y0;
  const len2 = ax * ax + ay * ay || 1;
  const t = clamp(((vx - n.x0) * ax + (vy - n.y0) * ay) / len2, 0, 1);
  if (Math.hypot(vx - (n.x0 + ax * t), vy - (n.y0 + ay * t)) <= n.w / 2 + lp) return true;
  if (pointInPoly(vx, vy, rig.tail)) return true;
  if (p.wing > 0.3 && (pointInPoly(vx, vy, rig.wingL) || pointInPoly(vx, vy, rig.wingR))) return true;
  return false;
}

module.exports = {
  CHANNELS,
  defaultPose,
  clonePose,
  makeFoot,
  frameOf,
  proj,
  depthOf,
  projectEllipsoid,
  bodyToLocal,
  bodyAxes,
  headFrame,
  headLocal,
  headDir,
  hipLocal,
  solveIK3,
  LEG_POLE,
  computeRig,
  toWorld,
  worldToView,
  worldBounds,
  keyPoints,
  hitTest,
  hull,
};
