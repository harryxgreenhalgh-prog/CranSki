import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterChat, strikeWeight, PHRASES } from '../src/online/chatFilter.js';
import { handle, signingKey, sign } from '../supabase/functions/chat/handler.js';
import { COPIES, copied } from '../tools/build-functions.mjs';

const f = (t) => filterChat(t);

test('crude words are masked, even disguised', () => {
  assert.equal(f('what the f u c k').text, 'what the * * * *');
  assert.equal(f('what the fuuuuck').text, 'what the *******');
  assert.equal(f('thats so 5h!t').text, 'thats so ****');
  assert.equal(f('big ass air').text, 'big *** air');
  assert.ok(f('big ass air').flags.crude);
});

test('innocent words are left alone', () => {
  for (const t of ['as if', 'pros and con', 'k see you', 'class assist cocktail Dickens raccoon', 'Bobs pass', 'GG', 'Yamashita is fast', 'Nice line, that was sick!']) {
    const r = f(t);
    assert.equal(r.text, t, t);
    assert.equal(strikeWeight(r.flags), 0, t);
  }
});

test('links and contact details are removed', () => {
  assert.equal(f('go to www.example.com now').text, 'go to [link removed] now');
  assert.equal(f('join discord.gg/abc123').text, 'join [link removed]');
  assert.equal(f('example dot com').text, '[link removed]');
  assert.equal(f('my email is bob@mail.com').text, 'my email is [removed]');
  assert.equal(f('call me 07700 900123').text, 'call me [removed]');
  assert.equal(f('follow @rider_kid').text, 'follow [removed]');
  assert.ok(f('add me on snap: coolrider99').flags.contact);
});

test('hate words, even disguised, block the whole message', () => {
  for (const t of ['kkk', 'n.a.z.i', 'N A Z I', 'h1tl3r rules', 'nаzi' /* Cyrillic a */]) {
    const r = f(t);
    assert.equal(r.blocked, true, t);
    assert.equal(r.text, '');
    assert.equal(strikeWeight(r.flags), 2);
  }
});

test('the chat function uses an up-to-date copy of the filter', () => {
  for (const [src, dst] of COPIES) assert.equal(readFileSync(dst, 'utf8'), copied(src), 'run `npm run build:functions`');
});

// The Edge Function handler with fake services.
async function fakes() {
  const key = await signingKey('test-secret');
  const sent = [];
  const strikes = [];
  const reports = [];
  let muted = false;
  return {
    sent,
    strikes,
    reports,
    mute: () => (muted = true),
    d: {
      key,
      userFromToken: async (t) => ({ ta: '00000000-0000-0000-0000-00000000000a', tb: '00000000-0000-0000-0000-00000000000b' })[t] || null,
      gamertagOf: async (u) => (u.endsWith('a') ? 'Alpha Wolf' : 'Beta Ray'),
      gate: async () => (muted ? { ok: false, reason: 'muted', until: '2030-01-01T00:00:00Z' } : { ok: true }),
      strike: async (uid, w) => {
        strikes.push(w);
        return { muted_until: strikes.reduce((a, b) => a + b, 0) >= 3 ? '2030-01-01T00:00:00Z' : null };
      },
      broadcast: async (topic, event, payload) => sent.push({ topic, event, payload }),
      saveReport: async (row) => (reports.push(row), { ok: true }),
      now: () => 1_800_000_000_000,
    },
  };
}
const post = (token, body) => new Request('https://x.test/functions/v1/chat', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

test('chat: messages are filtered, signed and broadcast; nothing else is kept', async () => {
  const x = await fakes();
  const r = await handle(post('ta', { action: 'send', topic: 'chat:bigair:1', text: 'nice one sh1t' }), x.d);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.msg.text, 'nice one ****');
  assert.equal(body.filtered, true);
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0].topic, 'chat:bigair:1');
  assert.equal(x.sent[0].payload.tag, 'Alpha Wolf');
  assert.ok(x.sent[0].payload.sig.length > 20);
  assert.deepEqual(x.strikes, [1]);
  // Quick phrases skip the filter.
  const p = await (await handle(post('ta', { action: 'send', topic: 'chat:bigair:1', phrase: 6 }), x.d)).json();
  assert.equal(p.msg.text, PHRASES[6]);
  assert.equal(p.msg.q, 6);
});

test('chat: a hate word reaches nobody, and repeat offenders are muted', async () => {
  const x = await fakes();
  const r = await handle(post('tb', { action: 'send', topic: 'chat:bigair:1', text: 'n a z i' }), x.d);
  assert.equal(r.status, 422);
  assert.equal(x.sent.length, 0);
  const r2 = await (await handle(post('tb', { action: 'send', topic: 'chat:bigair:1', text: 'go to www.spam.com' }), x.d)).json();
  assert.equal(r2.muted_until, '2030-01-01T00:00:00Z'); // 2 + 1 strikes
  x.mute();
  const r3 = await handle(post('tb', { action: 'send', topic: 'chat:bigair:1', text: 'hello' }), x.d);
  assert.equal(r3.status, 403);
  assert.equal((await r3.json()).error, 'muted');
});

test('chat: strangers, bad topics and party chat outsiders are refused', async () => {
  const x = await fakes();
  assert.equal((await handle(post('nope', { action: 'send', topic: 'chat:bigair:1', text: 'hi' }), x.d)).status, 401);
  assert.equal((await handle(post('ta', { action: 'send', topic: 'room:bigair:1', text: 'hi' }), x.d)).status, 400);
  assert.equal((await handle(post('ta', { action: 'send', topic: 'pchat:11111111-1111-1111-1111-111111111111', text: 'hi' }), x.d)).status, 403);
  assert.equal(x.sent.length, 0);
});

test('reports keep only messages the server signed, from that room, in the last 10 minutes', async () => {
  const x = await fakes();
  const now = x.d.now();
  const real = { id: 'm1', topic: 'chat:bigair:1', u: '00000000-0000-0000-0000-00000000000b', tag: 'Beta Ray', text: 'you are rubbish', ts: now - 60000, q: null };
  real.sig = await sign(x.d.key, real);
  const forged = { ...real, id: 'm2', text: 'something they never said' }; // old signature
  const otherRoom = { ...real, id: 'm3', topic: 'chat:yard:2' };
  otherRoom.sig = await sign(x.d.key, otherRoom);
  const old = { ...real, id: 'm4', ts: now - 30 * 60000 };
  old.sig = await sign(x.d.key, old);
  const r = await handle(post('ta', { action: 'report', topic: 'chat:bigair:1', reported: real.u, reason: 'bullying', messages: [real, forged, otherRoom, old] }), x.d);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).kept, 1);
  assert.equal(x.reports[0].p_messages.length, 1);
  assert.equal(x.reports[0].p_messages[0].text, 'you are rubbish');
  assert.equal(x.reports[0].p_reported, real.u);
  assert.equal((await handle(post('ta', { action: 'report', topic: 'chat:bigair:1', reported: real.u, reason: 'meh', messages: [] }), x.d)).status, 400);
});
