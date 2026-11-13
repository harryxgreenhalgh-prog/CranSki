import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Terrain } from '../src/sim/terrain.js';
import { Run } from '../src/sim/run.js';
import { DT } from '../src/sim/constants.js';
import { Recorder, SIM_VERSION, blankInput, packRuns, unpackRuns } from '../src/replay/record.js';
import { rerun } from '../src/sim/verify.js';
import * as bundled from '../supabase/functions/submit-run/sim.js';
import { handle, runKey } from '../supabase/functions/submit-run/handler.js';
import { simSourceHash } from '../tools/sim-hash.mjs';
import { park as BIG_AIR } from '../src/parks/bigair.js';
import { park as SHIRAKUMO } from '../src/parks/shirakumo.js';

// Ride BIG AIR the way the game records it: a cork 720 mute, a pause-menu
// reset, and a few steps recorded past the finish line in the last frame.
function recordRun() {
  const run = new Run(new Terrain(BIG_AIR));
  run.rider.grabSlots = ['mute', 'tail', 'japan'];
  const r = run.rider;
  const rec = new Recorder();
  let resetDone = false;
  let extra = 0;
  for (let i = 0; i < 90 / DT && extra < 5; i++) {
    const k = blankInput();
    const s = -r.pos.z;
    if (r.mode === 'ground') {
      k.tuck = s < 262;
      k.pop = s > 262 && s < 283.9;
    } else if (r.mode === 'air') {
      const a = r.air;
      const done = Math.hypot(a.spin, a.flip) >= 660;
      if (!done) k.steer = -1;
      if (a.time < 0.15) k.brake = true;
      if (a.time > 0.5 && !done) k.grab[0] = true;
    }
    if (!resetDone && s > 600) {
      rec.mark('reset');
      run.resetPosition();
      resetDone = true;
    }
    rec.push(k);
    run.step(k);
    run.messages.length = 0;
    if (run.finished) extra++;
  }
  const data = rec.data();
  return {
    total: run.results().total,
    sub: {
      park: 'bigair',
      version: SIM_VERSION,
      steps: data.steps,
      inputs: packRuns(data.runs),
      marks: data.marks,
      grabSlots: ['mute', 'tail', 'japan'],
      board: false,
      claimed: { total: run.results().total },
    },
  };
}

test('inputs survive packing for the trip to the server', () => {
  const runs = Uint16Array.from([0, 3, 4095, 65535, 17, 1]);
  assert.deepEqual(unpackRuns(packRuns(runs)), runs);
});

test('the referee re-rides a run to exactly the score the player saw', () => {
  const { total, sub } = recordRun();
  assert.ok(total > 9000, `scored ${total}`);
  const r = rerun(sub);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.results.total, total);
});

test('the bundled server copy is up to date and scores the same', () => {
  const head = readFileSync('supabase/functions/submit-run/sim.js', 'utf8').slice(0, 300);
  assert.match(head, new RegExp(`sim-source-hash: ${simSourceHash()}`), 'run `npm run build:sim` and commit supabase/functions/submit-run/sim.js');
  assert.equal(bundled.SIM_VERSION, SIM_VERSION);
  const { total, sub } = recordRun();
  const r = bundled.rerun(sub);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.results.total, total);
});

test('runs whose result does not match are rejected', () => {
  const { sub } = recordRun();
  assert.equal(rerun({ ...sub, claimed: { total: sub.claimed.total + 1 } }).reason, 'mismatch');
  // Tampered inputs: never press pop, so no trick is landed and the score differs.
  const runs = unpackRuns(sub.inputs);
  for (let i = 0; i < runs.length; i += 2) runs[i] &= ~128;
  const tampered = rerun({ ...sub, inputs: packRuns(runs) });
  assert.equal(tampered.ok, false);
  assert.ok(['mismatch', 'not_finished'].includes(tampered.reason), tampered.reason);
  // Stopping short of the finish line.
  const short = unpackRuns(sub.inputs).slice(0, 2); // just the first input: tuck down the inrun
  const steps = short.reduce((a, v, i) => (i % 2 ? a + v : a), 0);
  assert.equal(rerun({ ...sub, inputs: packRuns(short), steps, marks: [] }).reason, 'not_finished');
  // Malformed submissions.
  assert.equal(rerun({ ...sub, steps: sub.steps + 1 }).reason, 'bad_inputs');
  assert.equal(rerun({ ...sub, park: 'nowhere' }).reason, 'no_leaderboard');
  assert.equal(rerun({ ...sub, grabSlots: ['mute', 'tail', 'nope'] }).reason, 'bad_inputs');
  assert.equal(rerun({ ...sub, version: SIM_VERSION - 1 }).reason, 'old_version');
});

// The Edge Function handler with a fake database.
function fakeDb() {
  const calls = { recordScore: [] };
  return {
    calls,
    async userFromToken(t) {
      return t === 'good-token' ? 'user-1' : null;
    },
    async hasGamertag() {
      return true;
    },
    async noteSubmission() {
      return true;
    },
    async recordScore(args) {
      calls.recordScore.push(args);
      return { best: args.p_total, improved: true, rank: 3 };
    },
  };
}

const post = (body, token = 'good-token') =>
  new Request('https://example.test/functions/v1/submit-run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('submit-run saves only the score it calculated', async () => {
  const { total, sub } = recordRun();
  const db = fakeDb();
  const res = await handle(post(sub), db);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total, total);
  assert.equal(body.rank, 3);
  assert.equal(db.calls.recordScore.length, 1);
  assert.equal(db.calls.recordScore[0].p_total, total);
  assert.equal(db.calls.recordScore[0].p_user, 'user-1');
});

test('submit-run rejects mismatches, strangers and old versions without saving', async () => {
  const { sub } = recordRun();
  const db = fakeDb();
  const lie = await handle(post({ ...sub, claimed: { total: 999999 } }), db);
  assert.equal(lie.status, 422);
  assert.equal((await lie.json()).error, 'mismatch');
  assert.equal((await handle(post(sub, 'bad-token'), db)).status, 401);
  assert.equal((await handle(post({ ...sub, version: 1 }), db)).status, 409);
  assert.equal((await handle(new Request('https://x.test', { method: 'OPTIONS' }), db)).status, 200);
  assert.equal(db.calls.recordScore.length, 0);
});

test('submit-run: a ranked run is recorded with the server score, even if it ended early', async () => {
  const { sub } = recordRun();
  const db = fakeDb();
  const matchCalls = [];
  db.recordMatchRun = async (a) => (matchCalls.push(a), { ok: true, match: { id: 'm', run_index: 1 } });
  const match = '11111111-2222-3333-4444-555555555555';
  // Finished: recorded for the match and on the board.
  const res = await handle(post({ ...sub, match }), db);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).match.run_index, 1);
  assert.equal(matchCalls[0].p_total, sub.claimed.total);
  assert.equal(db.calls.recordScore.length, 1);
  // Cut short (out of pause time): still counts for the match, not the board.
  const runs = unpackRuns(sub.inputs).slice(0, 2);
  const steps = runs[1];
  const shortRun = rerun({ ...sub, inputs: packRuns(runs), steps, marks: [], claimed: { total: 0 } });
  const short = { ...sub, inputs: packRuns(runs), steps, marks: [], claimed: { total: shortRun.results.total }, match };
  const res2 = await handle(post(short), db);
  assert.equal(res2.status, 200);
  assert.equal(matchCalls.length, 2);
  assert.equal(db.calls.recordScore.length, 1);
  // A wrong claim is still refused.
  const res3 = await handle(post({ ...short, claimed: { total: 12345 } }), db);
  assert.equal(res3.status, 422);
  // The database refuses out-of-turn runs.
  db.recordMatchRun = async () => ({ error: 'not_your_turn' });
  assert.equal((await handle(post({ ...sub, match }), db)).status, 409);
});

// SHIRAKUMO has no leaderboard, but its runs earn FROST, so the server re-rides them too.
function recordShirakumo() {
  const run = new Run(new Terrain(SHIRAKUMO));
  run.rider.grabSlots = ['mute', 'tail', 'japan'];
  const rec = new Recorder();
  const r = run.rider;
  // Follow the groomed piste's zigzag: steer towards its centre line 25 m ahead.
  const c = SHIRAKUMO.center;
  const cx = (s) => {
    for (let i = 1; i < c.length; i++) if (s <= c[i][0]) return c[i - 1][1] + ((s - c[i - 1][0]) / (c[i][0] - c[i - 1][0])) * (c[i][1] - c[i - 1][1]);
    return 0;
  };
  let extra = 0;
  for (let i = 0; i < 150 / DT && extra < 3; i++) {
    const k = blankInput();
    const s = -r.pos.z;
    const dx = cx(s + 25) - r.pos.x;
    const turn = r.vel.x * -25 - r.vel.z * dx;
    k.steer = Math.abs(turn) < 4 ? 0 : Math.sign(turn); // digital, like the game
    k.tuck = Math.abs(r.pos.x - cx(s)) < 8;
    rec.push(k);
    run.step(k);
    run.messages.length = 0;
    if (run.finished) extra++;
  }
  const data = rec.data();
  const total = run.results().total;
  return {
    finished: run.finished,
    sub: { park: 'shirakumo', version: SIM_VERSION, steps: data.steps, inputs: packRuns(data.runs), marks: data.marks, grabSlots: ['mute', 'tail', 'japan'], board: false, claimed: { total } },
  };
}

test('SHIRAKUMO runs can be re-ridden (for FROST), the same way every time', () => {
  const { finished, sub } = recordShirakumo();
  assert.equal(finished, true);
  const r = rerun(sub);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.results.total, sub.claimed.total);
  assert.equal(bundled.rerun(sub).ok, true);
});

test('submit-run pays FROST once per finished run, and only posts board parks', async () => {
  const { sub } = recordRun();
  const rewards = [];
  const db = {
    ...fakeDb(),
    async rewardRun(args) {
      rewards.push(args);
      return { frost: { awarded: 10, balance: 10, today: 10, cap: 100 } };
    },
  };
  const body = await (await handle(post(sub), db)).json();
  assert.deepEqual(body.frost, { awarded: 10, balance: 10, today: 10, cap: 100 });
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].p_total, body.total);
  assert.equal(rewards[0].p_run_key, await runKey(sub));
  // Same run, same key (the database refuses to pay it twice); a different run, a different key.
  assert.equal(await runKey({ ...sub, claimed: { total: 1 } }), await runKey(sub));
  assert.notEqual(await runKey({ ...sub, steps: sub.steps - 1 }), await runKey(sub));
  // A run that doesn't match earns nothing.
  rewards.length = 0;
  const bad = await handle(post({ ...sub, claimed: { total: sub.claimed.total + 5 } }), db);
  assert.equal(bad.status, 422);
  assert.equal(rewards.length, 0);
  // SHIRAKUMO: FROST (if it finished) but never the leaderboard.
  const sh = recordShirakumo();
  const before = db.calls.recordScore.length;
  const res = await handle(post(sh.sub), db);
  assert.equal(res.status, 200);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].p_park, 'shirakumo');
  assert.equal(db.calls.recordScore.length, before);
});
