import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { park as YARD } from '../src/parks/yard.js';
import { park as BELLEVUE } from '../src/parks/bellevue.js';
import { park as SHIRAKUMO } from '../src/parks/shirakumo.js';
import { railPoints, butterPoints } from '../src/sim/scoring.js';

// Start `back` metres above (s0, u0) heading down the course at `speed`, then let `ctl` drive.
function ride(park, s0, u0, speed, ctl, seconds = 12) {
  const t = new Terrain(park);
  const run = new Run(t);
  const r = run.rider;
  const s = s0 - 40;
  const x = t.center(s) + u0;
  r.pos.set(x, t.height(x, -s), -s);
  r.courseDir(s, r.skiDir);
  r.vel.copy(r.skiDir).multiplyScalar(speed);
  r._groundOrientation();
  const msgs = [];
  const st = { railTime: 0 };
  for (let i = 0; i < seconds / DT; i++) {
    const ss = -r.pos.z;
    const k = { steer: 0, tuck: false, brake: false, roll: 0, up: false, pop: false, grab: [false, false, false], butter: false };
    if (r.mode === 'ground') {
      const tx = t.center(ss + 15) + u0;
      const want = Math.atan2(-(tx - r.pos.x), 15);
      const head = Math.atan2(-r.skiDir.x, -r.skiDir.z);
      const d = Math.atan2(Math.sin(want - head), Math.cos(want - head));
      k.steer = Math.abs(d) < 0.04 ? 0 : -Math.sign(d);
      k.brake = r.speed > speed + 2;
      k.tuck = r.speed < speed - 2;
    }
    if (r.mode === 'rail') st.railTime += DT;
    ctl(r, k, st, ss);
    run.step(k);
    msgs.push(...run.messages);
    run.messages.length = 0;
  }
  return msgs;
}

test('rail scoring: 750 per second on the bar, +450 per swap or hop', () => {
  assert.equal(railPoints(2, 0, 0), 1500);
  assert.equal(railPoints(1, 1, 1), 750 + 900);
});

test('butter scoring: 150 held, 300 for a 180, 600 for a 360', () => {
  assert.equal(butterPoints(0.2, 0), 0);
  assert.equal(butterPoints(0.5, 20), 150);
  assert.equal(butterPoints(0.9, -175), 300);
  assert.equal(butterPoints(1.2, 360), 600);
});

test('a lined-up lip puts you on the pop-on rail and the slide scores', () => {
  const msgs = ride(YARD, 305, -10, 11, () => {});
  const rail = msgs.find((m) => m.type === 'rail');
  assert.ok(rail, 'got on the rail');
  assert.ok(rail.points >= 750, `points ${rail?.points}`);
  assert.ok(msgs.some((m) => m.type === 'bank'), 'line banks after riding away');
});

test('aim away from the lip and you pass by', () => {
  const msgs = ride(YARD, 305, -4.5, 11, () => {});
  assert.equal(msgs.filter((m) => m.type === 'rail').length, 0);
});

test('swap and hop on a rail, then spin off the end', () => {
  const msgs = ride(BELLEVUE, 443, 0, 10, (r, k, st) => {
    if (r.mode === 'rail') {
      if (Math.abs(st.railTime - 0.4) < DT / 2) k.steer = 1; // swap
      if (st.railTime > 0.9 && st.railTime < 1.0) k.pop = true; // hop
      if (r.rail && r.rail.rail.length - r.rail.d < 1.0) k.steer = 1; // spin off
    }
    if (r.mode === 'air' && r.air.fromRail && Math.abs(r.air.spin) < 60) k.steer = 1;
  });
  const rail = msgs.find((m) => m.type === 'rail');
  assert.match(rail.name, /SWAP/);
  assert.match(rail.name, /HOP/);
  const out = msgs.find((m) => m.type === 'trick' && m.name);
  assert.match(out.name, /OUT$/);
});

test('a nose butter turned 180 scores BUTTER 180', () => {
  const msgs = ride(SHIRAKUMO, 110, 0, 10, (r, k, st, s) => {
    if (r.mode === 'ground' && s > 80 && s < 92) {
      k.butter = true;
      k.steer = -1;
    }
  });
  const b = msgs.find((m) => m.type === 'butter');
  assert.equal(b.name, 'BUTTER 180');
  assert.equal(b.points, 300);
});
