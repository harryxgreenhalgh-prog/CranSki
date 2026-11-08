import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { PARKS } from '../src/parks/index.js';

// Lines the bot takes around features it can't clear without popping (s range -> u offset).
const DETOURS = { forest: [[835, 945, 13]] };

// A simple bot that follows the course centre line, keeps its speed in check and never pops.
function rideThrough(park, targetSpeed = 24) {
  const terrain = new Terrain(park);
  const run = new Run(terrain);
  const r = run.rider;
  let below = 0;
  for (let i = 0; i < 400 / DT && !run.finished; i++) {
    const s = -r.pos.z;
    let off = 0;
    for (const [a, b, u] of DETOURS[park.id] || []) if (s > a && s < b) off = u;
    const tx = terrain.center(s + 18) + off;
    const tz = -(s + 18);
    const want = Math.atan2(-(tx - r.pos.x), -(tz - r.pos.z));
    const head = Math.atan2(-r.skiDir.x, -r.skiDir.z);
    let d = want - head;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const keys = { steer: 0, tuck: false, brake: false, roll: 0, up: false, pop: false, grab: [false, false, false] };
    if (r.mode === 'ground') {
      keys.steer = Math.abs(d) < 0.05 ? 0 : -Math.sign(d);
      keys.tuck = r.speed < targetSpeed;
      keys.brake = r.speed > targetSpeed + 6;
    }
    run.step(keys);
    if (r.pos.y < terrain.height(r.pos.x, r.pos.z) - 0.02) below++;
    run.messages.length = 0;
  }
  return { run, below };
}

for (const meta of PARKS) {
  test(`${meta.name}: builds, has a lift, start and finish, and a bot can ride it to the finish`, async () => {
    const { park } = await meta.load();
    assert.equal(park.id, meta.id);
    assert.ok(park.lift && park.lift.type, 'has a lift');
    assert.ok(park.finishS > park.startS);
    const terrain = new Terrain(park);
    if (meta.id !== 'pipe' && meta.id !== 'shirakumo') {
      assert.ok(terrain.lipLines().length > 0, 'has blue-painted lips');
    }
    const { run, below } = rideThrough(park);
    assert.ok(run.finished, `reached the finish (stopped at s=${(-run.rider.pos.z).toFixed(0)})`);
    assert.equal(below, 0, 'never below the snow');
  });
}
