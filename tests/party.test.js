import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Party, PARTY_MAX } from '../src/online/party.js';
import { memoryNet } from './helpers/memnet.js';

// A tiny stand-in for the party functions in the database (same rules).
function fakeDb() {
  const parties = new Map(); // id -> { id, leader, park, private_room, members: [uid], invites: Set, bans: Map }
  const tags = { a: 'Alpha', b: 'Beta', c: 'Ceta', d: 'Delta', e: 'Echo' };
  const mine = (u) => [...parties.values()].find((p) => p.members.includes(u));
  return (u) => async (name, args = {}) => {
    const p = mine(u);
    switch (name) {
      case 'create_party': {
        if (p) return p.id;
        const id = `p${parties.size + 1}`;
        parties.set(id, { id, leader: u, park: null, private_room: false, members: [u], invites: new Set(), bans: new Map() });
        return id;
      }
      case 'invite_to_party':
        if (!p) return 'no_party';
        if (p.members.length >= PARTY_MAX) return 'full';
        p.invites.add(args.friend);
        return 'invited';
      case 'join_party': {
        const q = parties.get(args.p_party);
        if (!q) return 'gone';
        if ((q.bans.get(u) || 0) > Date.now()) return 'removed';
        if (!q.invites.has(u)) return 'not_invited';
        if (q.members.length >= PARTY_MAX) return 'full';
        q.members.push(u);
        q.invites.delete(u);
        return 'joined';
      }
      case 'remove_from_party':
        if (!p || p.leader !== u) return 'not_leader';
        p.members = p.members.filter((m) => m !== args.member);
        p.bans.set(args.member, Date.now() + 600000);
        return 'removed';
      case 'set_party':
        if (!p || p.leader !== u) return 'not_leader';
        if (args.p_park) p.park = args.p_park;
        if (args.p_private !== null && args.p_private !== undefined) p.private_room = args.p_private;
        return 'ok';
      case 'leave_party':
        if (p) p.members = p.members.filter((m) => m !== u);
        return null;
      case 'decline_party_invite':
        parties.get(args.p_party)?.invites.delete(u);
        return null;
      case 'my_party':
        return p ? { id: p.id, leader: p.leader, park: p.park, private_room: p.private_room, members: p.members.map((m) => ({ id: m, gamertag: tags[m] })) } : null;
      case 'my_party_invites':
        return [...parties.values()].filter((q) => q.invites.has(u)).map((q) => ({ party: q.id, inviter: tags[q.leader], leader: tags[q.leader], members: q.members.length }));
    }
    throw new Error('unknown ' + name);
  };
}

async function setup() {
  const db = fakeDb();
  const net = memoryNet();
  const events = [];
  const mk = (u) => {
    const p = new Party({ api: db(u), open: net(), hooks: { onGo: (m) => events.push(`${u} go ${m.park} ${m.room} ${m.priv}`), onRemoved: () => events.push(`${u} removed`) } });
    p.setMe({ uid: u, tag: u.toUpperCase() });
    return p;
  };
  return { A: mk('a'), B: mk('b'), C: mk('c'), events };
}

test('invite, join, and the leader sends everyone a GO prompt', async () => {
  const { A, B, events } = await setup();
  await A.create();
  assert.ok(A.isLeader);
  assert.equal(await A.invite('b'), 'invited');
  await B.refresh();
  assert.equal(B.invites.length, 1);
  assert.equal(await B.join(B.invites[0].party), 'joined');
  await A.refresh();
  assert.equal(A.members.length, 2);
  assert.ok(A.members.find((m) => m.id === 'b').online, 'Beta is online on the party channel');
  await A.set('apex', true);
  A.go({ park: 'apex', room: 0, priv: true });
  assert.deepEqual(events, ['b go apex 0 true']);
  // Only the leader's GO counts.
  B.go({ park: 'yard', room: 3, priv: false });
  assert.equal(events.length, 1);
});

test("the leader can remove someone, who is told and can't rejoin for 10 minutes", async () => {
  const { A, B, events } = await setup();
  await A.create();
  await A.invite('b');
  await B.refresh();
  await B.join(B.invites[0].party);
  await A.refresh();
  assert.equal(await A.remove('b'), 'removed');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(events.includes('b removed'));
  assert.equal(B.info, null);
  await A.invite('b');
  await B.refresh();
  assert.equal(await B.join(B.invites[0].party), 'removed');
  assert.equal(await B.remove('a'), 'not_leader');
});

test('parties hold at most 4', async () => {
  const db = fakeDb();
  const net = memoryNet();
  const riders = ['a', 'b', 'c', 'd', 'e'].map((u) => {
    const p = new Party({ api: db(u), open: net() });
    p.setMe({ uid: u, tag: u });
    return p;
  });
  await riders[0].create();
  for (const u of ['b', 'c', 'd', 'e']) await riders[0].invite(u);
  const results = [];
  for (const p of riders.slice(1)) {
    await p.refresh();
    results.push(await p.join(p.invites[0].party));
  }
  assert.deepEqual(results, ['joined', 'joined', 'joined', 'full']);
});
