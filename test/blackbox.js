'use strict';

const { MotionChecker } = require('../src/core/qa');
const { computeRig, keyPoints } = require('../src/core/rig');
const { runSoak } = require('./soak');
const { LAYOUTS } = require('./helpers');

const [layout = 'single', kind = 'pop', secs = '900', seed = '5', point = 'toeR'] = process.argv.slice(2);
const ring = [];
let frame = 0;
let dumped = false;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const orig = MotionChecker.prototype.check;
MotionChecker.prototype.check = function (crow, world, dt) {
  frame++;
  const st = crow.st || {};
  const p = crow.pose;
  const kp = crow.visible && crow.state !== 'away' ? keyPoints(computeRig(p)) : null;
  const last = crow.transitions[crow.transitions.length - 1];
  ring.push({
    frame,
    state: crow.state,
    phase: st.phase || (st.hop && st.hop.phase) || '',
    mode: st.mode || '',
    air: crow.airborne,
    xyz: `${f1(crow.x)},${f1(crow.y)},${f1(crow.z)}`,
    h: f2(crow.h),
    hipH: f2(p.hipH),
    perch: crow.perchId,
    shift: crow.shift.dx || crow.shift.dy ? `${f1(crow.shift.dx)},${f1(crow.shift.dy)}` : '',
    feet: p.feet.map((f) => `${f1(f.x)},${f1(f.y)} l(${f1(f.lx)},${f1(f.ly)},${f1(f.lz)}) th${f2(f.th)} c${f2(f.curl)}${f.planted ? 'P' : '-'}`).join(' | '),
    pt: kp && kp[point] ? `${point} ${f1(kp[point][0])},${f1(kp[point][1])}` : '',
    tgt: st.target ? `${f1(st.target.x)},${f1(st.target.y)} ${st.target.perchId || ''}` : st.hop ? `hop->${f1(st.hop.tx)},${f1(st.hop.ty)} ${st.hop.perchId || ''}` : '',
    trs: last ? `${last.from}->${last.to}@${last.t.toFixed(2)}` : '',
    wing: `${f2(p.wing)} flap=${f2(p.flap)} f=${crow.flapFreq}`,
  });
  if (ring.length > 30) ring.shift();
  const before = this.violations.length;
  const r = orig.call(this, crow, world, dt);
  if (!dumped && this.violations.slice(before).some((v) => v.kind === kind)) {
    dumped = true;
    console.log(`--- first '${kind}' violation at frame ${frame}:`);
    for (const v of this.violations.slice(before)) console.log('   ', v.kind, v.msg);
    for (const e of ring) console.log(JSON.stringify(e));
    console.log('perches near:', JSON.stringify(world.perches.filter((s) => Math.abs(s.y - crow.y) < 200).map((s) => [s.id, s.y, Math.round(s.x0), Math.round(s.x1)])));
    console.log('areas:', JSON.stringify(world.areas));
  }
  return r;
};
runSoak({ displays: LAYOUTS[layout], seconds: +secs, seed: +seed, displayChanges: layout === 'dualEqual' ? [LAYOUTS.dualEqual, LAYOUTS.single, LAYOUTS.autoHide] : null });
if (!dumped) console.log(`no '${kind}' violation`);
