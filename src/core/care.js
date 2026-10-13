'use strict';

const DROP = Object.freeze({ max: 5, r: 7.5, scrubPx: 230, clickWipe: 0.34, splatTime: 0.18, cleanTime: 0.5, maxStep: 60 });

const GUT = Object.freeze({ perMeal: 0.6, perSecond: 1 / 4800, gap: 480, max: 1.6, start: 0.25, at: Object.freeze([0.9, 1.3]) });

const CARE = Object.freeze({
  grace: 150,
  happyLoss: 1 / 2400,
  healthLoss: 1 / 12000,
  healthGain: 1 / 10000,
  sleepGain: 1 / 5000,
  awayGain: 0.2,
  mealGain: 0.02,
  cleanGain: 0.03,
  cleanHappy: 0.06,
  sickLoss: 1 / 3600,
  sickTire: 1 / 1800,
  floor: 0.08,
  sick: 0.4,
  unwell: 0.5,
});

function sickness(health) {
  return Math.max(0, Math.min(1, (CARE.unwell - health) / (CARE.unwell - 0.1)));
}

function isMessy(d) {
  return !d.gone && !(d.z > 0) && d.age >= CARE.grace;
}

function messCount(droppings) {
  let n = 0;
  for (const d of droppings) if (isMessy(d)) n++;
  return n;
}

module.exports = { DROP, GUT, CARE, sickness, isMessy, messCount };
