import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { park as SHIRAKUMO } from '../src/parks/shirakumo.js';
import { park as PIPE } from '../src/parks/pipe.js';

function straight(park, s0, u0, seconds) {
  const t = new Terrain(park);
  const run = new Run(t);
  const r = run.rider;
  const x = t.center(s0) + u0;
  r.pos.set(x, t.height(x, -s0), -s0);
  r.courseDir(s0, r.skiDir);
  r.vel.copy(r.skiDir).multiplyScalar(10);
  r._groundOrientation();
  let sink = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const s = -r.pos.z;
    const tx = t.center(s + 15) + u0;
    const want = Math.atan2(-(tx - r.pos.x), 15);
    const head = Math.atan2(-r.skiDir.x, -r.skiDir.z);
    const d = Math.atan2(Math.sin(want - head), Math.cos(want - head));
    run.step({ steer: r.mode === 'ground' ? (Math.abs(d) < 0.04 ? 0 : -Math.sign(d)) : 0, tuck: r.mode === 'ground', brake: false, roll: 0, up: false, pop: false, grab: [false, false, false], butter: false });
    sink = Math.max(sink, r.sink);
    run.messages.length = 0;
  }
  return { r, sink };
}

test('SHIRAKUMO powder: you sink in and it slows you down', () => {
  const groomed = straight(SHIRAKUMO, 380, 0, 8);
  const powder = straight(SHIRAKUMO, 380, -52, 8);
  assert.equal(groomed.sink, 0);
  assert.ok(powder.sink > 0.2, `sank ${powder.sink.toFixed(2)} m`);
  assert.ok(powder.r.speed < groomed.r.speed * 0.6, `powder ${powder.r.speed.toFixed(1)} vs groomed ${groomed.r.speed.toFixed(1)} m/s`);
});

test('ASPEN PIPE: a straight air off the wall lands back in the pipe and keeps its speed', () => {
  const t = new Terrain(PIPE);
  const run = new Run(t);
  const r = run.rider;
  let landed = null;
  let speedUp = 0;
  for (let i = 0; i < 20 / DT && !landed; i++) {
    const s = -r.pos.z;
    const u = r.pos.x - t.center(s);
    const k = { steer: 0, tuck: false, brake: false, roll: 0, up: false, pop: false, grab: [false, false, false], butter: false };
    if (r.mode === 'ground') {
      const go = s > 70;
      const tx = t.center(s) + (go ? 30 : 0);
      const want = Math.atan2(-(tx - r.pos.x), 22);
      const head = Math.atan2(-r.skiDir.x, -r.skiDir.z);
      const d = Math.atan2(Math.sin(want - head), Math.cos(want - head));
      if (Math.abs(u) < 6 || !go) k.steer = Math.abs(d) < 0.05 ? 0 : -Math.sign(d);
      k.tuck = true;
    }
    const wasAir = r.mode === 'air';
    if (r.mode === 'air' && speedUp === 0) speedUp = r.speed;
    run.step(k);
    for (const m of run.messages) if (m.type === 'trick' || m.type === 'crash') landed = { m, u: r.pos.x - t.center(-r.pos.z), speed: r.speed, wasAir };
    run.messages.length = 0;
  }
  assert.ok(landed, 'took off from the wall and landed');
  assert.notEqual(landed.m.type, 'crash');
  assert.ok(Math.abs(landed.u) < t.cross.lipU, `landed inside the pipe (u=${landed.u.toFixed(1)})`);
  assert.ok(landed.speed >= speedUp, `kept speed: ${landed.speed.toFixed(1)} >= ${speedUp.toFixed(1)}`);
});
