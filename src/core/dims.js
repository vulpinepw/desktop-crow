'use strict';

const ELEVATION = (36 * Math.PI) / 180;
const CAM = Object.freeze({ elevation: ELEVATION, F: Math.sin(ELEVATION), H: Math.cos(ELEVATION) });

const DIMS = Object.freeze({
  legUpper: 10.5,
  legLower: 13.5,
  hipX: 0.6,
  hipZ: 2.3,
  footLift: 1.0,
  stanceX: 2.2,
  stanceZ: 3.0,

  hipStand: 21,
  hipWalk: 20.4,
  hipCrouch: 14,
  hipPerch: 8.5,
  hipSleep: 7.2,
  hipAir: 20.5,

  body: Object.freeze({ cx: 2, cy: -10.5, rx: 18, ry: 11.5, rz: 12.5, rot: -0.12 }),
  neckBase: Object.freeze({ x: 12.5, y: -14.5 }),
  neckWidth: 12.5,
  neckMax: 22,
  shoulder: Object.freeze({ x: 6, y: -14.5 }),
  shoulderZ: 7.8,
  tailTop: Object.freeze({ x: -12, y: -15 }),
  tailBottom: Object.freeze({ x: -14.5, y: -8.5 }),
  tailLen: 19,
  tailAngle: Math.PI - 0.34,
  tailRootZ: 3.4,
  tailTipZ: 4.6,

  headR: 9,
  headIdle: Object.freeze({ x: 19, y: -26 }),
  eye: Object.freeze({ x: 2.4, y: -2.9, z: 4.4, r: 2.5 }),
  beakTip: Object.freeze({ x: 21, y: 0.7 }),
  beakHinge: Object.freeze({ x: 5.2, y: 0.9 }),
  carryPoint: Object.freeze({ x: 17, y: 3.2 }),

  toeFront: 7.5,
  toeBack: 4.6,
  toeWidth: 2,
  toeSplay: 0.3,

  wingSpan: 38,
  wingSweep: -5,
});

const WING_FOLDED = Object.freeze([
  [9, -16.8], [4, -20.3], [-3, -21], [-10, -19.2], [-26, -10.8], [-21.5, -9.8],
  [-23.8, -8.4], [-18.5, -7.6], [-12.5, -6.9], [-5, -6.4], [2, -8], [7.2, -11.8],
]);

const WING_SPREAD = Object.freeze([
  [9, 0], [8.8, 0.3], [6.5, 0.62], [3.5, 0.84], [1.2, 1.0], [-2.2, 0.83],
  [-4.2, 0.98], [-7, 0.8], [-9.3, 0.9], [-11.2, 0.68], [-12.2, 0.38], [-9.5, 0],
]);

module.exports = { DIMS, CAM, WING_FOLDED, WING_SPREAD };
