import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTrick, grabMultiplier, repeatFactor, airtimePoints, Line, RunScore } from '../src/sim/scoring.js';
import { describeTrick } from '../src/sim/tricks.js';

const noAir = { airTime: 0, height: 0 };
const pts = (air, history = []) => scoreTrick(describeTrick(air), noAir, history).points;

test('base is 1500 x turns squared', () => {
  assert.equal(pts({ family: 'spin', spin: 360 }), 1500);
  assert.equal(pts({ family: 'spin', spin: 720 }), 6000);
  assert.equal(pts({ family: 'spin', spin: 1080 }), 13500);
});

test('worked example: 720 with two different grabs = 7,800', () => {
  const air = { family: 'spin', spin: 720, grabs: [{ name: 'mute', time: 0.5 }, { name: 'tail', time: 0.4 }] };
  assert.equal(pts(air), 7800);
});

test('worked example: cork 720 = 6,900, or 8,625 with a full one-second grab', () => {
  const cork = { family: 'cork', spin: 620, flip: 360 }; // ~720 of rotation around a tilted axis
  assert.equal(describeTrick(cork).name, 'CORK 720');
  assert.equal(pts(cork), 6900);
  assert.equal(pts({ ...cork, grabs: [{ name: 'mute', time: 1.0 }] }), 8625);
});

test('grab multiplier rises to x1.25 at 1 s; variety pays x1.30 / x1.35', () => {
  assert.equal(grabMultiplier(0, 0), 1);
  assert.equal(grabMultiplier(1, 1), 1.25);
  assert.equal(grabMultiplier(1, 2.5), 1.25);
  assert.ok(Math.abs(grabMultiplier(1, 0.5) - 1.125) < 1e-9);
  assert.equal(grabMultiplier(2, 0.3), 1.3);
  assert.equal(grabMultiplier(3, 0.3), 1.35);
});

test('a grab with no spin scores 300; a grab under 0.25 s does not count', () => {
  assert.equal(pts({ family: null, grabs: [{ name: 'japan', time: 0.6 }] }), 300);
  assert.equal(describeTrick({ family: null, grabs: [{ name: 'japan', time: 0.2 }] }), null);
});

test('straight flips count as turns, with x1.15 per flip', () => {
  assert.equal(pts({ family: 'flip', flip: 360 }), Math.round(1500 * 1.15));
  assert.equal(pts({ family: 'flip', flip: 720 }), Math.round(6000 * 1.15 * 1.15));
});

test('switch pays x1.25 on spin points', () => {
  assert.equal(pts({ family: 'spin', spin: 720, switchStance: true }), 7500);
});

test('repeats pay 75%, then 55%, then 40%; direction or switch resets', () => {
  const t = describeTrick({ family: 'spin', spin: 720 });
  assert.equal(repeatFactor(t.key, []), 1);
  assert.equal(repeatFactor(t.key, [t.key]), 0.75);
  assert.equal(repeatFactor(t.key, [t.key, t.key]), 0.55);
  assert.equal(repeatFactor(t.key, [t.key, t.key, t.key]), 0.4);
  const other = describeTrick({ family: 'spin', spin: -720 });
  assert.equal(repeatFactor(other.key, [t.key, t.key, t.key]), 1);
  const sw = describeTrick({ family: 'spin', spin: 720, switchStance: true });
  assert.equal(repeatFactor(sw.key, [t.key]), 1);
  // Only the last 3 airs count.
  assert.equal(repeatFactor(t.key, [t.key, 'x', 'y', 'z']), 1);
});

test('airtime: +135 per second, +36 per metre', () => {
  assert.equal(airtimePoints(2, 10), 270 + 360);
});

test('line multiplier +0.25 per feature after the first; clean landing +450 +15%', () => {
  const line = new Line();
  const s = scoreTrick(describeTrick({ family: 'spin', spin: 720 }), noAir);
  line.addTrick(s);
  assert.equal(line.multiplier, 1);
  assert.equal(line.addCleanLanding(), 450 + 900);
  line.addTrick(s);
  line.addTrick(s);
  assert.equal(line.multiplier, 1.5);
});

test('sideways landings keep part of the trick; crashes lose the unbanked line', () => {
  const s = scoreTrick(describeTrick({ family: 'spin', spin: 720 }), noAir);
  const line = new Line();
  line.addTrick(s, 0.5);
  assert.equal(line.value, 3000);
  const run = new RunScore();
  assert.equal(run.lose(line), 3000);
  assert.equal(run.total, 0);
  const banked = new Line();
  banked.addTrick(s);
  run.bank(banked);
  assert.equal(run.total, 6000);
  assert.equal(run.tricksAndAir + run.grabsAndVariety + run.landings, run.total);
});
