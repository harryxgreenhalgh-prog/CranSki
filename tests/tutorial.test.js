// The BIG AIR tutorial, driven by the real simulation: a scripted rider pops,
// spins, grabs and lands, and the tutorial ticks each step, judges the landing
// and asks for a restart until everything is done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { park as BIG_AIR } from '../src/parks/bigair.js';
import { Tutorial } from '../src/ui/tutorial.js';

// Just enough of a DOM element for the tutorial's card.
function fakeEl() {
  const classes = new Set();
  return {
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    addEventListener() {},
    querySelector() {
      return fakeEl();
    },
  };
}

const keys = () => ({ steer: 0, tuck: false, brake: false, roll: 0, up: false, pop: false, grab: [false, false, false], butter: false });

// One run down BIG AIR. plan(r, k) sets the keys each step. Returns what the
// tutorial said and whether it asked to restart.
// perFrame: simulation steps per drawn frame (the game runs several when frames are slow).
function ride(tut, plan, perFrame = 1) {
  const run = new Run(new Terrain(BIG_AIR));
  tut.newRun();
  let restart = false;
  let done = false;
  for (let i = 0; i < 60 / DT && !restart; i++) {
    const k = keys();
    plan(run.rider, k);
    run.step(k);
    if ((i + 1) % perFrame) continue;
    restart = tut.update(DT * perFrame, run, k, 'keyboard', run.messages) === 'restart';
    run.messages.length = 0;
    if (tut.finished) {
      done = true;
      break;
    }
  }
  return { restart, done, feedback: tut.feedback };
}

// A good attempt: tuck, load the pop and let go on the kicker face, a 360,
// wait for the spin to settle, a short grab, then everything released.
function goodJump({ pop = true, spin = true, grab = true } = {}) {
  let phase = 'spin';
  return (r, k) => {
    const s = -r.pos.z;
    if (r.mode === 'ground' && s < 200) k.tuck = true;
    if (r.mode === 'ground' && pop && s > 240 && s < 272) k.pop = true;
    if (r.mode !== 'air') return;
    const a = r.air;
    if (phase === 'spin') {
      if (spin && Math.abs(a.spin) < 300) k.steer = 1;
      else phase = 'settle';
    } else if (phase === 'settle') {
      if (Math.abs(r.omega.y) < 60) phase = 'grab';
    } else if (phase === 'grab') {
      const held = Math.max(0, ...Object.values(a.grabTimes));
      if (grab && held < 0.4) k.grab[0] = true;
      else phase = 'land';
    }
  };
}

test('the tutorial ticks pop, spin, grab and a clean landing on one good jump', () => {
  let doneCalls = 0;
  const tut = new Tutorial(fakeEl(), { onDone: () => doneCalls++, onSkip() {}, onBasecamp() {} });
  tut.start();
  const res = ride(tut, goodJump());
  assert.deepEqual(tut.done, { pop: true, spin: true, grab: true, land: true });
  assert.ok(res.done, 'finished');
  assert.equal(doneCalls, 1);
  assert.equal(res.feedback.text, 'Clean landing!');
});

test('on a slow device (12 steps a frame) the same jump still ticks everything', () => {
  const tut = new Tutorial(fakeEl(), { onDone() {}, onSkip() {}, onBasecamp() {} });
  tut.start();
  const res = ride(tut, goodJump(), 12);
  assert.deepEqual(tut.done, { pop: true, spin: true, grab: true, land: true });
  assert.ok(res.done);
});

test('steps carry over between attempts, and a restart is asked for until all are done', () => {
  const tut = new Tutorial(fakeEl(), { onDone() {}, onSkip() {}, onBasecamp() {} });
  tut.start();
  // No pop, no grab: only the spin and the landing tick; go again.
  let res = ride(tut, goodJump({ pop: false, grab: false }));
  assert.deepEqual(tut.done, { pop: false, spin: true, grab: false, land: true });
  assert.ok(res.restart, 'restarts');
  assert.ok(!res.done);
  // Second go with everything: done.
  res = ride(tut, goodJump());
  assert.ok(res.done);
});

test('holding the grab into the landing is a crash the tutorial explains', () => {
  const tut = new Tutorial(fakeEl(), { onDone() {}, onSkip() {}, onBasecamp() {} });
  tut.start();
  const res = ride(tut, (r, k) => {
    const s = -r.pos.z;
    if (r.mode === 'ground' && s < 200) k.tuck = true;
    if (r.mode === 'air') k.grab[0] = true; // never lets go
  });
  assert.ok(res.restart);
  assert.match(res.feedback.text, /still holding a button/);
  assert.equal(tut.done.land, false);
});

test('flying off the lip without popping does not count as a pop', () => {
  const tut = new Tutorial(fakeEl(), { onDone() {}, onSkip() {}, onBasecamp() {} });
  tut.start();
  ride(tut, goodJump({ pop: false }));
  assert.equal(tut.done.pop, false);
  // Holding the pop over the lip (never letting go) doesn't count either.
  ride(tut, (r, k) => {
    const s = -r.pos.z;
    if (r.mode === 'ground' && s < 200) k.tuck = true;
    if (s > 240 && r.mode !== 'crash') k.pop = r.mode === 'ground' || (r.air && r.air.time < 0.3);
  });
  assert.equal(tut.done.pop, false);
});
