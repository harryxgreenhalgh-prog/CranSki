import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings, sideScore } from '../src/online/scoring.js';

const ffa = [
  { uid: 'a', tag: 'A', team: 0 },
  { uid: 'b', tag: 'B', team: 1 },
  { uid: 'c', tag: 'C', team: 2 },
];
const duo = [
  { uid: 'a', tag: 'A', team: 0 },
  { uid: 'b', tag: 'B', team: 1 },
  { uid: 'c', tag: 'C', team: 0 },
  { uid: 'd', tag: 'D', team: 1 },
];

test('free-for-all, best run: highest single run wins', () => {
  const st = standings({ riders: ffa, scores: { a: [100, 900], b: [800, 850], c: [950, 0] }, teams: 'ffa', scoring: 'best' });
  assert.deepEqual(st.sides.map((s) => s.key), ['c', 'a', 'b']);
  assert.equal(st.winner.key, 'c');
  assert.equal(st.sides[0].points, 950);
});

test('free-for-all, round wins: each round to the top score, ties go to both, then total points', () => {
  // Round 1: c; round 2: a and b tie; round 3: a. a=2, b=1, c=1 (c's total beats b's).
  const st = standings({ riders: ffa, scores: { a: [1, 5, 9], b: [2, 5, 1], c: [3, 4, 2] }, teams: 'ffa', scoring: 'rounds' });
  assert.deepEqual(st.sides.map((s) => `${s.key}${s.rounds}`), ['a2', 'c1', 'b1']);
  assert.equal(st.winner.key, 'a');
  assert.equal(sideScore(st.sides[0], 'rounds'), '2 rounds');
});

test('2v2, best run: a team adds up its riders’ bests', () => {
  const st = standings({ riders: duo, scores: { a: [10, 30], b: [25], c: [5], d: [12, 1] }, teams: '2v2', scoring: 'best' });
  const t0 = st.sides.find((s) => s.team === 0);
  const t1 = st.sides.find((s) => s.team === 1);
  assert.equal(t0.points, 35);
  assert.equal(t1.points, 37);
  assert.equal(st.winner.team, 1);
});

test('2v2, total score (the Cup): every run counts; a dead heat is a draw', () => {
  const st = standings({ riders: duo, scores: { a: [10, 10], b: [5, 5], c: [0, 5], d: [10, 5] }, teams: '2v2', scoring: 'total' });
  assert.equal(st.sides[0].points, 25);
  assert.equal(st.sides[1].points, 25);
  assert.equal(st.winner, null);
  assert.equal(st.sides[1].place, 1);
});

test('round wins only count rounds everyone has finished', () => {
  const st = standings({ riders: ffa, scores: { a: [5, 7], b: [4, 9], c: [1] }, teams: 'ffa', scoring: 'rounds' });
  assert.equal(st.sides.find((s) => s.key === 'a').rounds, 1);
  assert.equal(st.sides.find((s) => s.key === 'b').rounds, 0);
});
