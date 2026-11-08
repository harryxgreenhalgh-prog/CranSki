import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { park as BIG_AIR } from '../src/parks/bigair.js';

const keys = () => ({ steer: 0, tuck: false, brake: false, roll: 0, up: false, pop: false, grab: [false, false, false], butter: false });

// Tuck the BIG AIR inrun, launch, then let `air(t, k)` drive. Returns samples of spin speed.
function launch(air) {
  const run = new Run(new Terrain(BIG_AIR));
  const r = run.rider;
  const out = [];
  for (let i = 0; i < 40 / DT; i++) {
    const k = keys();
    if (r.mode === 'ground' && !out.length) k.tuck = -r.pos.z < 262;
    if (r.mode === 'air') {
      air(r.air.time, k);
      out.push({ t: r.air.time, w: Math.abs(r.omega.y), spin: Math.abs(r.air.spin) });
    } else if (out.length) break;
    run.step(k);
    run.messages.length = 0;
  }
  return out;
}
const at = (s, t) => s.find((x) => x.t >= t);

test('holding a grab speeds the spin up', () => {
  const plain = launch((t, k) => (k.steer = t < 1 ? -1 : 0));
  const grab = launch((t, k) => {
    k.steer = t < 1 ? -1 : 0;
    k.grab[0] = t > 0.05 && t < 1;
  });
  assert.ok(at(grab, 0.9).w > at(plain, 0.9).w * 1.2, `${at(grab, 0.9).w} vs ${at(plain, 0.9).w}`);
});

test('a held grab keeps the rotation going after you let go of the spin key', () => {
  const s = launch((t, k) => {
    k.steer = t < 0.6 ? -1 : 0;
    k.grab[0] = t > 0.05 && t < 1.6;
  });
  assert.ok(at(s, 1.4).w > at(s, 0.55).w * 0.6, `still spinning at ${at(s, 1.4).w.toFixed(0)} deg/s`);
});

test('letting go of the grab slows the rotation right down so you can open up', () => {
  const s = launch((t, k) => {
    k.steer = t < 0.6 ? -1 : 0;
    k.grab[0] = t > 0.05 && t < 1.2;
  });
  const before = at(s, 1.15).w;
  const after = at(s, 1.5).w;
  assert.ok(before > 300, `spinning fast while grabbed (${before.toFixed(0)})`);
  assert.ok(after < before * 0.2, `slowed from ${before.toFixed(0)} to ${after.toFixed(0)} deg/s`);
});
