import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PartyMatch, cleanConfig, cleanRoster, turnOrder, describe } from '../src/online/partyMatch.js';
import { memoryNet } from './helpers/memnet.js';

const PARTY = 'cccccccc-0000-0000-0000-000000000001';
const roster = (teams) =>
  [
    { uid: 'lead', tag: 'Lead', team: 0 },
    { uid: 'b', tag: 'Bee', team: 1 },
    { uid: 'c', tag: 'Cee', team: 0 },
    { uid: 'd', tag: 'Dee', team: 1 },
  ].map((r, i) => ({ ...r, team: teams === '2v2' ? r.team : i }));

// Everyone's game, on one in-memory network. The clock is ours to move.
function party(cfg, { riders = 4, join = riders } = {}) {
  const net = memoryNet();
  let t = 1000;
  const now = () => t;
  const list = roster(cfg.teams).slice(0, riders);
  const games = list.map((r) => {
    const log = [];
    const g = new PartyMatch({ id: 'm1', partyId: PARTY, cfg, roster: list, me: { uid: r.uid, tag: r.tag }, leader: 'lead', open: net(), verify: (rec) => rec.score, now });
    g.h = {
      onBegin: () => log.push('begin'),
      onCancel: (why) => log.push(`cancel ${why}`),
      onTurn: (u, run) => log.push(`turn ${run} ${u}`),
      onCountdown: (u, k) => log.push(`count ${u ?? 'all'} ${k}`),
      onMap: (k) => log.push(`map ${k}`),
      onOver: (res) => log.push(`over ${res.winner}`),
      onRiderLeft: (u) => log.push(`left ${u}`),
    };
    g.log = log;
    return g;
  });
  return {
    games,
    advance: (ms) => (t += ms),
    async connect() {
      for (const g of games.slice(0, join)) await g.connect();
    },
    tickAll() {
      for (const g of games) if (g.ch) g.tick();
    },
  };
}

const rec = (park, score) => ({ park, score });

test('configs and rosters from the network are checked', () => {
  assert.equal(cleanConfig({ kind: 'match', maps: ['shirakumo'] }), null);
  assert.deepEqual(cleanConfig({ kind: 'match', maps: ['apex'], runs: 4, scoring: 'x', teams: '2v2' }), { kind: 'match', teams: '2v2', maps: ['apex'], runs: 3, scoring: 'best' });
  assert.deepEqual(cleanConfig({ kind: 'cup', maps: ['apex', 'yard', 'nope', 'pipe', 'bigair', 'forest', 'bellevue'], scoring: 'rounds' }).maps, ['apex', 'yard', 'pipe', 'bigair', 'forest']);
  assert.equal(cleanRoster([{ uid: 'a', team: 0 }, { uid: 'b', team: 0 }, { uid: 'c', team: 1 }], '2v2'), null);
  assert.deepEqual(turnOrder(roster('2v2'), '2v2'), ['lead', 'b', 'c', 'd']);
  assert.match(describe(cleanConfig({ kind: 'cup', maps: ['apex', 'yard'], teams: 'ffa' })), /CRANSKI CUP · Free-for-all · APEX, THE YARD · total score/);
});

test('private free-for-all: everyone joins, takes turns, runs are re-ridden, best run wins', async () => {
  const cfg = cleanConfig({ kind: 'match', maps: ['apex'], runs: 1, teams: 'ffa', scoring: 'best' });
  const P = party(cfg, { riders: 3 });
  await P.connect();
  P.tickAll();
  for (const g of P.games) assert.equal(g.status, 'playing', g.me.uid);
  for (const g of P.games) g.ready();
  P.tickAll();
  const [L, B, C] = P.games;
  assert.equal(B.turn, 'lead');
  assert.ok(B.log.includes('turn 0 lead'));
  L.go();
  L.startRun();
  // The leader claims 9999, but re-riding the inputs gives 500.
  L.finishRun(9999, rec('apex', 500));
  assert.equal(B.scores.lead[0], 500);
  assert.equal(L.scores.lead[0], 9999); // (your own game trusts your own run)
  B.go();
  B.finishRun(700, rec('apex', 700));
  C.go();
  C.finishRun(650, rec('yard', 650)); // wrong park: 0
  for (const g of [L, B]) assert.equal(g.scores.c[0], 0);
  assert.ok(B.log.includes('over b'));
  assert.equal(B.result().standings.sides[0].key, 'b');
});

test('private 2v2: a rider who left has their turns skipped by the referee', async () => {
  const cfg = cleanConfig({ kind: 'match', maps: ['bigair'], runs: 1, teams: '2v2', scoring: 'best' });
  const P = party(cfg);
  await P.connect();
  P.tickAll();
  for (const g of P.games) g.ready();
  P.tickAll();
  const [L, B, C, D] = P.games;
  L.go();
  L.finishRun(300, rec('bigair', 300));
  await B.leave(); // B's turn: gone
  assert.ok(L.log.includes('left b'));
  P.tickAll(); // referee skips B
  assert.equal(C.turn, 'c');
  assert.deepEqual(D.scores.b, [0]);
  C.go();
  C.finishRun(100, rec('bigair', 100));
  D.go();
  D.finishRun(350, rec('bigair', 350));
  // Team 0: 300 + 100 = 400; team 1: 0 + 350 = 350.
  assert.equal(L.result().winnerTeam, 0);
  assert.equal(D.result().winnerTeam, 0);
});

test('2v2 is called off if someone does not join', async () => {
  const cfg = cleanConfig({ kind: 'match', maps: ['apex'], runs: 1, teams: '2v2' });
  const P = party(cfg, { join: 3 });
  await P.connect();
  P.tickAll();
  assert.equal(P.games[0].status, 'joining');
  P.advance(26000);
  P.tickAll();
  assert.equal(P.games[0].status, 'cancelled');
  assert.match(P.games[1].log.join('|'), /cancel 2v2 needs all four riders/);
});

test('CRANSKI CUP: everyone drops in together on each map; total score over the maps', async () => {
  const cfg = cleanConfig({ kind: 'cup', maps: ['apex', 'yard'], teams: 'ffa', scoring: 'total' });
  const P = party(cfg, { riders: 3 });
  await P.connect();
  P.tickAll();
  const [L, B, C] = P.games;
  for (const g of P.games) g.ready();
  P.tickAll();
  for (const g of P.games) assert.ok(g.log.includes('count all 0'), g.me.uid);
  for (const g of P.games) g.startRun();
  L.finishRun(100, rec('apex', 100));
  B.finishRun(400, rec('apex', 400));
  P.tickAll(); // C is still riding: no move yet
  assert.equal(L.run, 0);
  C.finishRun(50, rec('apex', 50));
  P.tickAll();
  for (const g of P.games) assert.ok(g.log.includes('map 1'), g.me.uid);
  // Map 2: C never finishes (crashed out of the game); the referee moves on after the time limit.
  for (const g of P.games) g.ready();
  P.tickAll();
  L.finishRun(500, rec('yard', 500));
  B.finishRun(100, rec('yard', 100));
  P.advance(210000);
  P.tickAll();
  for (const g of P.games) assert.equal(g.status, 'over', g.me.uid);
  const st = B.result().standings;
  assert.deepEqual(st.sides.map((s) => `${s.key}:${s.points}`), ['lead:600', 'b:500', 'c:50']);
});

test('CRANSKI CUP: if the leader drops out, the next rider referees', async () => {
  const cfg = cleanConfig({ kind: 'cup', maps: ['apex'], teams: 'ffa', scoring: 'rounds' });
  const P = party(cfg, { riders: 3 });
  await P.connect();
  P.tickAll();
  const [L, B, C] = P.games;
  await L.leave();
  assert.equal(B.referee, 'b');
  B.ready();
  C.ready();
  P.tickAll();
  B.startRun();
  C.startRun();
  B.finishRun(10, rec('apex', 10));
  C.finishRun(20, rec('apex', 20));
  P.tickAll();
  assert.equal(C.status, 'over');
  assert.equal(C.result().winner, 'c');
});

test('CRANSKI CUP: a rider who drops out briefly is waited for; one gone for good is not', async () => {
  const cfg = cleanConfig({ kind: 'cup', maps: ['apex'], teams: 'ffa', scoring: 'total' });
  const P = party(cfg, { riders: 3 });
  await P.connect();
  P.tickAll();
  const [L, B, C] = P.games;
  for (const g of P.games) g.ready();
  P.tickAll();
  for (const g of P.games) g.startRun();
  // C's connection drops (a stall, not a leave).
  await C.ch.untrack();
  L.finishRun(100, rec('apex', 100));
  B.finishRun(200, rec('apex', 200));
  P.advance(5000);
  L.tick();
  assert.equal(L.status, 'playing'); // still waiting for C
  P.advance(11000);
  L.tick();
  assert.equal(L.status, 'over');
  assert.deepEqual(L.scores.c, [0]);
});
