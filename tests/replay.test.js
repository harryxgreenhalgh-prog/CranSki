import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { Recorder, InputStream, SIM_VERSION, encodeInput, decodeInput, blankInput } from '../src/replay/record.js';
import { simulateReplay, Ghost } from '../src/replay/player.js';
import { autoEdit } from '../src/replay/clip.js';
import { park as BIG_AIR } from '../src/parks/bigair.js';

test('input encoding round-trips', () => {
  const i = { steer: -1, roll: 1, tuck: true, brake: false, up: true, pop: true, grab: [false, true, false], butter: true };
  assert.deepEqual(decodeInput(encodeInput(i), blankInput()), i);
});

// Ride BIG AIR with a cork 720, recording inputs, including a pause-menu reset.
function recordRun() {
  const terrain = new Terrain(BIG_AIR);
  const run = new Run(terrain);
  const r = run.rider;
  const rec = new Recorder();
  let resetDone = false;
  for (let i = 0; i < 70 / DT && !run.finished; i++) {
    const k = blankInput();
    const s = -r.pos.z;
    if (r.mode === 'ground') {
      k.tuck = s < 262;
      k.pop = s > 262 && s < 283.9;
    } else if (r.mode === 'air') {
      const a = r.air;
      if (Math.hypot(a.spin, a.flip) < 660) k.steer = -1;
      if (a.time < 0.15) k.brake = true;
      if (a.time > 0.5 && Math.hypot(a.spin, a.flip) < 660) k.grab[0] = true;
    }
    if (!resetDone && s > 600) {
      rec.mark('reset');
      run.resetPosition();
      resetDone = true;
    }
    rec.push(k);
    run.step(k);
    run.messages.length = 0;
  }
  return { terrain, total: run.results().total, data: { version: SIM_VERSION, inputs: rec.data(), total: run.results().total } };
}

test('a recorded run re-rides to exactly the same score', () => {
  const { terrain, total, data } = recordRun();
  assert.ok(total > 9000);
  const replay = simulateReplay(new Terrain(BIG_AIR), data);
  assert.equal(replay.results.total, total);
  assert.ok(replay.count > 100);
  assert.ok(replay.airs.some((a) => a.name === 'CORK 720 MUTE'));
  void terrain;
});

test('the ghost follows the recorded run', () => {
  const { data } = recordRun();
  const g = new Ghost(new Terrain(BIG_AIR), data);
  let steps = 0;
  while (!g.done && steps < 70 / DT) {
    g.advance();
    steps++;
  }
  assert.ok(g.run.finished);
  assert.equal(g.run.results().total, data.total);
});

test('clip auto edit cuts in before every jump', () => {
  const { data } = recordRun();
  const replay = simulateReplay(new Terrain(BIG_AIR), data);
  const segs = autoEdit(replay);
  assert.ok(segs.length >= 1);
  const big = replay.airs.find((a) => a.time > 3);
  assert.ok(segs.some((s) => s.t0 <= big.t0 - 1 && s.t1 >= big.t1));
});

test('old replays are refused instead of re-riding wrongly', () => {
  assert.throws(() => simulateReplay(new Terrain(BIG_AIR), { version: SIM_VERSION - 1, inputs: { runs: new Uint16Array(), steps: 0 } }));
  void InputStream;
});
