import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerMatch } from '../src/online/ranked.js';
import { memoryNet } from './helpers/memnet.js';

const view = (over = {}) => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  mode: '1v1',
  park: 'apex',
  status: 'live',
  me: 1,
  players: [
    { id: 'a', tag: 'Alpha', team: 0 },
    { id: 'b', tag: 'Beta', team: 1 },
  ],
  runs_each: 2,
  run_index: 0,
  scores: {},
  result: null,
  ...over,
});

function make(v = view(), submit) {
  const events = [];
  const m = new ServerMatch({
    view: v,
    me: { uid: 'b', tag: 'Beta' },
    submit: submit || (async () => ({ ok: false })),
    api: { poll: async () => ({}), claim: async () => null, forfeit: async () => null },
    open: memoryNet()(),
  });
  m.h = {
    onTurn: (u, r) => events.push(`turn ${r} ${u}`),
    onOppDone: (t, r, u) => events.push(`opp ${u} ${t}`),
    onOver: (res) => events.push(`over ${res.winner}`),
    onCountdown: (u) => events.push(`count ${u}`),
    onError: (e) => events.push(`error ${e}`),
  };
  return { m, events };
}

test('ranked match: turns alternate and follow the server', () => {
  const { m, events } = make();
  assert.deepEqual(m.order, ['a', 'b', 'a', 'b']);
  assert.equal(m.turn, 'a');
  assert.equal(m.myTurn, false);
  assert.equal(m.opp.uid, 'a');
  assert.equal(m.host, false);
  m.apply(view({ run_index: 1, scores: { a: [5000] } }));
  assert.equal(m.myTurn, true);
  assert.deepEqual(events, ['opp a 5000', 'turn 1 b']);
});

test('ranked match: my run goes to the server, which says what happens next', async () => {
  const sent = [];
  const { m, events } = make(view({ run_index: 1, scores: { a: [5000] } }), async (rec, total, id) => {
    sent.push({ total, id });
    return { ok: true, match: view({ run_index: 2, scores: { a: [5000], b: [4200] } }) };
  });
  m.go();
  assert.ok(events.includes('count b'));
  await m.finishRun(4200, { inputs: 'xx' });
  assert.deepEqual(sent, [{ total: 4200, id: m.id }]);
  assert.equal(m.turn, 'a');
  assert.deepEqual(m.scores.b, [4200]);
  assert.equal(m.records.b.length, 1);
});

test('ranked match: a refused run is reported, and the result comes from the server', async () => {
  const { m, events } = make(view({ run_index: 1 }), async () => ({ ok: false, message: 'Mismatch' }));
  await m.finishRun(1, {});
  assert.ok(events.includes('error Mismatch'));
  m.apply(view({ status: 'done', run_index: 4, scores: { a: [1, 2], b: [3, 4] }, result: { winner_team: 1, best: { a: 2, b: 4 }, changes: { b: { before: 1000, after: 1032 } } } }));
  assert.ok(events.includes('over b'));
  const r = m.result();
  assert.equal(r.winner, 'b');
  assert.equal(r.changes.b.after, 1032);
  assert.ok(m.over);
});

test('ranked match: 30 s of pause time, and leaving forfeits only an unfinished match', async () => {
  const forfeits = [];
  const { m } = make();
  m.api.forfeit = async (id) => forfeits.push(id);
  assert.equal(m.addPause(12), 18);
  assert.equal(m.addPause(20), 0);
  await m.leave();
  assert.deepEqual(forfeits, [m.id]);
  const { m: done } = make(view({ status: 'done' }));
  done.api.forfeit = async (id) => forfeits.push(id);
  await done.leave();
  assert.equal(forfeits.length, 1);
});
