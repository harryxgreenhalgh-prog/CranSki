import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';

// A scripted rider: tucks the inrun, pops at the lip, then runs `air(rider, keys)` each step.
function ride(air = () => {}, { maxSeconds = 60 } = {}) {
  const terrain = new Terrain();
  const run = new Run(terrain);
  const r = run.rider;
  const msgs = [];
  const log = { lipSpeed: 0, airTime: 0, belowSnow: 0, landed: false, trace: [] };
  let tookOff = false;
  for (let i = 0; i < maxSeconds / DT && !run.finished; i++) {
    const keys = { steer: 0, tuck: false, brake: false, roll: 0, up: false, pop: false, grab: [false, false, false] };
    const s = -r.pos.z;
    if (r.mode === 'ground') {
      if (!tookOff) {
        keys.tuck = s < 262;
        keys.pop = s > 262 && s < 283.9;
      } else keys.tuck = true;
    } else if (r.mode === 'air') {
      if (!tookOff) {
        tookOff = true;
        log.lipSpeed = r.speed;
      }
      air(r, keys);
    }
    run.step(keys);
    if (r.pos.y < terrain.height(r.pos.x, r.pos.z) - 1e-6) log.belowSnow++;
    if (i % 60 === 0) log.trace.push(r.pos.x, r.pos.y, r.pos.z);
    msgs.push(...run.messages);
    run.messages.length = 0;
  }
  return { run, msgs, log };
}

const turned = (a) => Math.hypot(a.spin, a.flip, a.roll);

test('full tuck reaches about 190 km/h and about 5 s of air off BIG AIR', () => {
  const { run, log } = ride();
  const kmh = log.lipSpeed * 3.6;
  assert.ok(kmh > 170 && kmh < 215, `lip speed ${kmh.toFixed(0)} km/h`);
  assert.ok(run.airtime > 4.3 && run.airtime < 6.3, `airtime ${run.airtime.toFixed(2)} s`);
  assert.equal(log.belowSnow, 0, 'rider never passes through the snow');
  assert.ok(run.finished, 'reaches the finish line');
});

test('a cork 720 mute lands clean, banks, and shows on the results', () => {
  const { run, msgs } = ride((r, k) => {
    const a = r.air;
    if (turned(a) < 660) k.steer = -1;
    if (a.time < 0.15) k.brake = true;
    if (a.time > 0.5 && turned(a) < 660) k.grab[0] = true;
  });
  const trick = msgs.find((m) => m.type === 'trick');
  assert.equal(trick.name, 'CORK 720 MUTE');
  assert.equal(trick.quality, 'clean');
  assert.ok(msgs.some((m) => m.type === 'bank'));
  const res = run.results();
  assert.ok(res.total > 9000, `total ${res.total}`);
  assert.equal(res.bestTrick.name, 'CORK 720 MUTE');
  assert.equal(res.tricksAndAir + res.grabsAndVariety + res.landings, res.total);
});

test('holding the spin into the snow is a bail that loses the line', () => {
  const { msgs } = ride((r, k) => {
    k.steer = 1;
  });
  const crash = msgs.find((m) => m.type === 'crash');
  assert.ok(crash, 'crashed');
  assert.equal(msgs.filter((m) => m.type === 'trick').length, 0);
});

test('the rider gets up after a crash and can still finish', () => {
  const { run } = ride((r, k) => {
    k.steer = 1;
  }, { maxSeconds: 90 });
  assert.ok(run.finished);
  assert.equal(run.results().total, 0);
});

test('double cork needs the flip key held longer', () => {
  const { msgs } = ride((r, k) => {
    const a = r.air;
    if (turned(a) < 1020) k.steer = -1;
    if (a.time < 1.2) k.brake = true;
  });
  const trick = msgs.find((m) => m.type === 'trick');
  assert.equal(trick.name, 'DOUBLE CORK 1080');
});

test('simulation is deterministic', () => {
  const plan = (r, k) => {
    if (turned(r.air) < 900) k.steer = 1;
    if (r.air.time > 0.4 && r.air.time < 1.6) k.grab[2] = true;
  };
  const a = ride(plan).log.trace;
  const b = ride(plan).log.trace;
  assert.deepEqual(a, b);
});
