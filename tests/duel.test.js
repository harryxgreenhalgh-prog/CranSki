import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuelSession, runOrder, decide, DUEL_PARKS, PAUSE_CAP } from '../src/online/duel.js';
import { memoryNet } from './helpers/memnet.js';

test('duels are on APEX, BIG AIR, FOREST LINE, ASPEN PIPE and BELLEVUE', () => {
  assert.deepEqual(DUEL_PARKS.sort(), ['apex', 'bellevue', 'bigair', 'forest', 'pipe']);
  assert.equal(PAUSE_CAP, 30);
});

test('alternate drops, 2 runs each, best run wins', () => {
  assert.deepEqual(runOrder('h', 'g'), ['h', 'g', 'h', 'g']);
  assert.equal(decide({ h: [100, 900], g: [800, 850] }, 'h', 'g').winner, 'h');
  assert.equal(decide({ h: [100, 800], g: [800, 0] }, 'h', 'g').winner, null);
});

async function pair(verify) {
  const net = memoryNet();
  const log = [];
  const hooks = (who) => ({
    onTurn: (u, run) => log.push(`${who} turn ${run} ${u}`),
    onCountdown: (u, run) => log.push(`${who} countdown ${run} ${u}`),
    onOppDone: (total) => log.push(`${who} sees opp ${total}`),
    onOver: (r) => log.push(`${who} over ${r.winner}`),
    onRestart: (park) => log.push(`${who} restart ${park}`),
    onOppLeft: () => log.push(`${who} opp left`),
  });
  const A = { uid: 'a', tag: 'Alpha' };
  const B = { uid: 'b', tag: 'Beta' };
  const host = new DuelSession({ id: 'd1', me: A, opp: B, host: true, park: 'apex', open: net(), verify, hooks: hooks('A') });
  const guest = new DuelSession({ id: 'd1', me: B, opp: A, host: false, park: 'apex', open: net(), verify, hooks: hooks('B') });
  await host.connect();
  await guest.connect();
  return { host, guest, log };
}

test('a full duel: ready, four runs in turn, the opponent re-checks each score', async () => {
  // The "re-ride" here just reads a score hidden in the record.
  const { host, guest, log } = await pair((rec) => rec.realScore);
  host.ready();
  guest.ready();
  assert.equal(host.turn, 'a');
  assert.ok(host.myTurn && !guest.myTurn);
  host.go();
  assert.ok(log.includes('B countdown 0 a'));
  host.finishRun(5000, { realScore: 5000 });
  assert.equal(guest.turn, 'b');
  guest.go();
  // Beta claims 99,999 but the re-ride says 4,000.
  guest.finishRun(99999, { realScore: 4000 });
  assert.deepEqual(host.scores, { a: [5000], b: [4000] });
  host.go();
  host.finishRun(7000, { realScore: 7000 });
  guest.go();
  guest.finishRun(6500, { realScore: 6500 });
  assert.ok(host.over && guest.over);
  // The honest side re-rode Beta's runs, so Alpha's screen has Alpha winning
  // (Beta's own screen still believes its inflated claim).
  assert.equal(host.result().winner, 'a');
  assert.ok(log.includes('A over a'));
  assert.equal(host.records.b.length, 2);
});

test('only the rider whose turn it is can start or finish a run', async () => {
  const { host, guest } = await pair(null);
  host.ready();
  guest.ready();
  guest.go(); // not Beta's turn
  assert.equal(host.phase, 'waiting');
  guest.finishRun(10, {});
  assert.deepEqual(host.scores.b, []);
});

test('a rider who runs out of time forfeits their run; leaving is announced', async () => {
  const { host, guest, log } = await pair(null);
  host.ready();
  guest.ready();
  host.go();
  host.finishRun(3000, {});
  host.forfeitTurn(); // Beta gone too long
  assert.deepEqual(host.scores.b, [0]);
  assert.equal(host.turn, 'a');
  await guest.leave();
  assert.ok(log.includes('A opp left'));
});

test('rematch and change map need both riders to agree on the park', async () => {
  const { host, guest, log } = await pair(null);
  host.proposeAgain('bigair');
  assert.ok(!log.some((l) => l.includes('restart')));
  guest.proposeAgain('apex'); // different park: no restart yet
  assert.ok(!log.some((l) => l.includes('restart')));
  guest.proposeAgain('bigair');
  assert.ok(log.includes('A restart bigair') && log.includes('B restart bigair'));
  assert.equal(host.park, 'bigair');
  assert.equal(host.run, 0);
});
