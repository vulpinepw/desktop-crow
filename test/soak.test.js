'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSoak } = require('./soak');
const { LAYOUTS } = require('./helpers');

for (const name of Object.keys(LAYOUTS)) {
  test(`4 minutes of random use on the '${name}' layout`, () => {
    const r = runSoak({ displays: LAYOUTS[name], seconds: 240, seed: 31, displayChanges: name === 'dualEqual' ? [LAYOUTS.dualEqual, LAYOUTS.single, LAYOUTS.autoHide] : null });
    assert.ok(r.summary.ok, JSON.stringify(r.summary.first.slice(0, 3)));
    assert.equal(r.counts.errors, 0);
    const moving = ['walk', 'hop', 'fly'].filter((s) => (r.stateTime[s] || 0) > 1);
    assert.ok(moving.length >= 2, `only moved by ${moving.join(', ')}`);
    assert.ok(r.save.stats.itemsEaten > 0, 'never ate anything');
    assert.ok(r.counts.grabs > 0 && (r.stateTime.held || 0) > 1, 'was picked up and carried about');
    assert.ok(r.longest.t < 60, `stuck in ${r.longest.state} for ${r.longest.t.toFixed(0)} s`);
  });
}
