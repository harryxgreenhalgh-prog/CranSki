// Parties of up to 4 friends (DESIGN.md, Modes): INVITE / JOIN, the leader
// picks the park and can switch to a private room, everyone else gets a GO /
// STAY prompt when the leader heads off, party chat, and the leader can remove
// someone for 10 minutes.
//
// Membership lives in the database (supabase/migrations/*_parties.sql); the
// party's own Realtime channel carries who's online and where, the leader's GO,
// and nudges to refresh when something changes.
import { getClient } from './client.js';
import { openChannel } from './net.js';
import { account, OnlineError, notSetUp, beforeSignOut } from './account.js';

export const PARTY_MAX = 4;

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.warn(name, error);
    throw new OnlineError(notSetUp(error) ? "Parties aren't set up on the server yet." : 'Something went wrong. Try again.');
  }
  return data;
}

export class Party {
  constructor({ api = rpc, open = openChannel, hooks = {} } = {}) {
    this.api = api;
    this.open = open;
    this.h = hooks;
    this.info = null; // { id, leader, park, private_room, members: [{ id, gamertag }] }
    this.invites = [];
    this.online = new Map(); // uid -> { where, park }
    this.ch = null;
    this.me = null;
    this.where = { where: 'basecamp', park: null };
    this.lastTrack = 0;
    this.error = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    this.h.onChange?.();
    for (const fn of [...this.listeners]) fn();
  }

  get id() {
    return this.info?.id || null;
  }

  get isLeader() {
    return !!this.info && this.me && this.info.leader === this.me.uid;
  }

  get members() {
    return (this.info?.members || []).map((m) => ({ ...m, leader: m.id === this.info.leader, online: this.online.has(m.id), ...(this.online.get(m.id) || {}) }));
  }

  get full() {
    return (this.info?.members?.length || 0) >= PARTY_MAX;
  }

  has(uid) {
    return !!this.info?.members?.some((m) => m.id === uid);
  }

  setMe(me) {
    this.me = me;
  }

  async refresh() {
    if (!this.me) return;
    try {
      const [info, invites] = await Promise.all([this.api('my_party'), this.api('my_party_invites')]);
      const wasIn = this.info?.id;
      this.info = info || null;
      this.invites = invites || [];
      this.error = null;
      if (wasIn && !this.info) this.h.onLeft?.(wasIn);
      await this._syncChannel();
    } catch (e) {
      this.error = e.message;
    }
    this._emit();
  }

  async _syncChannel() {
    const topic = this.info ? `party:${this.info.id}` : null;
    if (this.ch && this.ch.topic === topic) return;
    if (this.ch) {
      const old = this.ch;
      this.ch = null;
      this.online.clear();
      await old.close().catch(() => {});
    }
    if (!topic) return;
    this.ch = await this.open(topic, {
      key: this.me.uid,
      onBroadcast: {
        changed: () => this.refresh(),
        go: (m) => m?.u === this.info?.leader && m.u !== this.me.uid && this.h.onGo?.(m),
        removed: (m) => m?.target === this.me.uid && this._removed(),
        ranked: (m) => m?.partner === this.me.uid && this.has(m.u) && this.h.onRankedAsk?.(m),
      },
      onPresence: (list) => {
        this.online = new Map(list.filter((p) => p.u).map((p) => [p.u, { where: p.where, park: p.park }]));
        this._emit();
      },
    });
    this.lastTrack = 0;
    await this._track(true);
  }

  // Where I am, for my party (Presence allows only a few updates a minute).
  setWhere(where, park = null) {
    if (this.where.where === where && this.where.park === park) return;
    this.where = { where, park };
    this._track(false);
  }

  async _track(force) {
    if (!this.ch) return;
    const now = Date.now();
    if (!force && now - this.lastTrack < 8000) {
      clearTimeout(this._trackTimer);
      this._trackTimer = setTimeout(() => this._track(true), 8000 - (now - this.lastTrack));
      return;
    }
    this.lastTrack = now;
    await this.ch.track({ u: this.me.uid, tag: this.me.tag, ...this.where }).catch(() => {});
  }

  _nudge() {
    this.ch?.send('changed', { u: this.me.uid });
  }

  async create() {
    await this.api('create_party');
    await this.refresh();
  }

  async invite(uid) {
    const r = await this.api('invite_to_party', { friend: uid });
    return r;
  }

  async join(partyId) {
    const r = await this.api('join_party', { p_party: partyId });
    await this.refresh();
    if (r === 'joined') this._nudge();
    return r;
  }

  async decline(partyId) {
    await this.api('decline_party_invite', { p_party: partyId });
    await this.refresh();
  }

  async leave() {
    this._nudge();
    await this.api('leave_party');
    await this.refresh();
  }

  async remove(uid) {
    const r = await this.api('remove_from_party', { member: uid });
    if (r === 'removed') {
      this.ch?.send('removed', { u: this.me.uid, target: uid });
      this._nudge();
    }
    await this.refresh();
    return r;
  }

  async set(park, priv) {
    const r = await this.api('set_party', { p_park: park ?? null, p_private: priv ?? null });
    this._nudge();
    await this.refresh();
    return r;
  }

  // Leader: tell everyone where we're going (after joining the room).
  go({ park, room, priv }) {
    if (!this.isLeader) return;
    this.ch?.send('go', { u: this.me.uid, tag: this.me.tag, park, room, priv: !!priv, party: this.info.id });
  }

  // Ask a party member to queue for ranked 2v2 with me.
  askRanked(partner, mode = '2v2') {
    if (!this.has(partner)) return;
    this.ch?.send('ranked', { u: this.me.uid, tag: this.me.tag, partner, mode });
  }

  async _removed() {
    const id = this.info?.id;
    await this.refresh();
    this.h.onRemoved?.(id);
  }

  async close() {
    clearTimeout(this._trackTimer);
    const ch = this.ch;
    this.ch = null;
    this.info = null;
    this.invites = [];
    this.online.clear();
    if (ch) await ch.close().catch(() => {});
  }
}

// One party client for the signed-in rider, refreshed every 15 seconds.
export const party = new Party();
let poll = 0;
let readyFor = null;
function pollParty() {
  clearTimeout(poll);
  if (!account.ready) return;
  if (document.visibilityState !== 'hidden') party.refresh();
  poll = setTimeout(pollParty, 15000);
}
account.onChange(() => {
  const id = account.ready ? account.user.id : null;
  if (id === readyFor) return;
  readyFor = id;
  if (id) {
    party.setMe({ uid: id, tag: account.gamertag });
    pollParty();
  } else {
    clearTimeout(poll);
    party.me = null;
    party.close();
    party._emit();
  }
});
beforeSignOut(async () => {
  await party.close();
});
