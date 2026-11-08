import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomRules, pickRoom, sendRate, Snapshots, packPose, LiveRoom } from '../src/online/rooms.js';
import { STRIDE } from '../src/render/pose.js';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { park as YARD } from '../src/parks/yard.js';
import { memoryNet } from './helpers/memnet.js';

test('room sizes follow the design: new room at 20 (14 on BIG AIR), 20 max on SHIRAKUMO and BELLEVUE', () => {
  assert.deepEqual(roomRules('yard'), { openAt: 20, max: 30 });
  assert.deepEqual(roomRules('bigair'), { openAt: 14, max: 30 });
  assert.deepEqual(roomRules('shirakumo'), { openAt: 20, max: 20 });
  assert.deepEqual(roomRules('bellevue'), { openAt: 20, max: 20 });
});

test('riders go to the lowest room with space; a new room opens at the mark', () => {
  const r = roomRules('yard');
  assert.equal(pickRoom(new Map(), r), 1);
  assert.equal(pickRoom(new Map([[1, 19]]), r), 1);
  assert.equal(pickRoom(new Map([[1, 20]]), r), 2);
  assert.equal(pickRoom(new Map([[1, 20], [2, 5]]), r), 2);
  assert.equal(pickRoom(new Map([[1, 12], [2, 20]]), r), 1);
  assert.equal(pickRoom(new Map([[1, 14]]), roomRules('bigair')), 2);
});

test('send rate: 12 a second in small rooms, shared out in busy ones, never below 2', () => {
  assert.equal(sendRate(1, 60), 0);
  assert.equal(sendRate(2, 60), 12);
  assert.equal(sendRate(5, 60), 12);
  assert.equal(sendRate(10, 60), 6);
  assert.equal(sendRate(30, 60), 2);
  assert.equal(sendRate(30, 400), 12);
});

const frameAt = (x, yaw = 0) => {
  const f = new Array(STRIDE).fill(0);
  f[0] = x;
  f[3] = 0;
  f[4] = Math.sin(yaw / 2);
  f[5] = 0;
  f[6] = Math.cos(yaw / 2);
  return f;
};

test('snapshots blend smoothly between updates, a little in the past', () => {
  const s = new Snapshots();
  // Sender clock is 5 s behind ours; updates every 100 ms, arriving 40 ms late.
  for (let i = 0; i <= 10; i++) s.push(i * 100 + 5000, frameAt(i), i * 100 + 10040);
  const out = new Array(STRIDE);
  assert.ok(s.sample(10040 + 1000, 150, out)); // = sender time 5850
  assert.ok(Math.abs(out[0] - 8.5) < 1e-9, `x=${out[0]}`);
  // Out-of-order and duplicate updates are handled.
  const t = new Snapshots();
  t.push(100, frameAt(1), 1000);
  t.push(300, frameAt(3), 1200);
  t.push(200, frameAt(2), 1210);
  t.push(200, frameAt(2), 1211);
  assert.deepEqual(t.buf.map((b) => b.t), [100, 200, 300]);
});

test('snapshots carry on briefly past the last update, then hold', () => {
  const s = new Snapshots();
  s.push(0, frameAt(0), 1000);
  s.push(100, frameAt(1), 1100);
  const out = new Array(STRIDE);
  s.sample(1100 + 200, 0, out); // 200 ms past the last update
  assert.ok(Math.abs(out[0] - 3) < 1e-9, `x=${out[0]}`);
  s.sample(1100 + 5000, 0, out); // capped at 250 ms ahead
  assert.ok(Math.abs(out[0] - 3.5) < 1e-9, `x=${out[0]}`);
});

test('orientation blends along the short way and stays a unit quaternion', () => {
  const s = new Snapshots();
  const a = frameAt(0, 0.2);
  const b = frameAt(0, 0.6).map((v, i) => (i >= 3 && i <= 6 ? -v : v)); // same rotation, flipped sign
  s.push(0, a, 0);
  s.push(100, b, 100);
  const out = new Array(STRIDE);
  s.sample(50, 0, out);
  const len = Math.hypot(out[3], out[4], out[5], out[6]);
  assert.ok(Math.abs(len - 1) < 1e-9);
  const yaw = 2 * Math.atan2(Math.abs(out[4]), Math.abs(out[6]));
  assert.ok(Math.abs(yaw - 0.4) < 0.01, `yaw=${yaw}`);
});

test('a pose packet is small and rounds to millimetres', () => {
  const run = new Run(new Terrain(YARD));
  for (let i = 0; i < 300; i++) run.step({ steer: 0, roll: 0, tuck: true, brake: false, up: false, pop: false, grab: [false, false, false], butter: false });
  const p = packPose(run.rider);
  assert.equal(p.length, STRIDE);
  assert.ok(Math.abs(p[2] - run.rider.pos.z) < 0.006);
  assert.ok(JSON.stringify(p).length < 220, `packet ${JSON.stringify(p).length} chars`);
});

test('two riders join the same room, see each other move, and leave cleanly', async () => {
  const net = memoryNet();
  const tricks = [];
  const a = new LiveRoom({ me: { uid: 'a', tag: 'Alpha', look: {}, board: false }, open: net('a') });
  const b = new LiveRoom({ me: { uid: 'b', tag: 'Beta', look: { topColor: 1 }, board: true }, open: net('b'), onTrick: (r) => tricks.push(r.trick.name) });
  assert.equal(await a.join('yard'), 1);
  assert.equal(await b.join('yard'), 1);
  assert.equal(a.counts('yard').get(1), 2);
  assert.equal(a.remotes.get('b').tag, 'Beta');
  assert.equal(b.remotes.get('a').tag, 'Alpha');
  const run = new Run(new Terrain(YARD));
  a.tick(run.rider, 'riding', 1000);
  a.tick(run.rider, 'riding', 1010); // too soon: not sent
  a.tick(run.rider, 'riding', 1100);
  const ra = b.remotes.get('a');
  assert.equal(ra.snaps.buf.length, 2);
  assert.equal(ra.status, 'riding');
  a.sendTrick('CORK 720 MUTE', 10006);
  assert.deepEqual(tricks, ['CORK 720 MUTE']);
  await a.leaveRoom();
  assert.equal(b.remotes.size, 0);
  assert.equal(b.counts('yard').get(1), 1);
});
