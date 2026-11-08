// Live rooms (DESIGN.md, Modes and multiplayer): up to 30 riders on one park in
// numbered rooms. New riders go to the lowest-numbered room with space; a new
// room opens once a room has 20 riders (14 on BIG AIR). SHIRAKUMO and BELLEVUE
// rooms hold 20 at most.
//
// Each rider sends their position, pose and trick state several times a second
// (Broadcast) and their name and look once (Presence). Other screens buffer
// those updates and draw riders slightly in the past, blending between updates
// so movement stays smooth however the network behaves.
import { STRIDE, writeFrame } from '../render/pose.js';
import { openChannel } from './net.js';

export function roomRules(park) {
  if (park === 'bigair') return { openAt: 14, max: 30 };
  if (park === 'shirakumo' || park === 'bellevue') return { openAt: 20, max: 20 };
  return { openAt: 20, max: 30 };
}

// Lowest-numbered room that hasn't reached the "open a new room" mark.
// counts: Map(room number -> riders)
export function pickRoom(counts, rules) {
  for (let n = 1; n < 10000; n++) if ((counts.get(n) || 0) < rules.openAt) return n;
  return 1;
}

// How often to send your position (per second). Up to 12 a second, shared out
// so the whole room stays within the project's Realtime budget (messages sent
// per second, REALTIME_BUDGET in config.js). Alone in a room: nobody to send to.
export function sendRate(riders, budget) {
  if (riders <= 1) return 0;
  return Math.max(2, Math.min(12, budget / riders));
}

// ------------------------------------------------------------ pose packets
// A frame (render/pose.js layout) rounded to what the eye can see.
const DECIMALS = [2, 2, 2, 4, 4, 4, 4, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 2, 1, 1, 0];
const frameBuf = new Float32Array(STRIDE);

export function packPose(rider) {
  writeFrame(rider, frameBuf, 0);
  const out = new Array(STRIDE);
  for (let i = 0; i < STRIDE; i++) {
    const d = DECIMALS[i];
    const m = d === 0 ? 1 : d === 1 ? 10 : d === 2 ? 100 : 10000;
    out[i] = Math.round(frameBuf[i] * m) / m;
  }
  return out;
}

// Fields that blend smoothly between updates (the rest switch at the midpoint).
const BLEND = new Set([0, 1, 2, 8, 10, 14, 17, 19, 20, 21]);

// Buffer of one remote rider's updates, sampled a little in the past.
export class Snapshots {
  constructor() {
    this.buf = []; // { t (sender ms), f: number[] }
    this.offset = null; // local ms - sender ms, tracking the fastest arrival
    this.lastLocal = 0;
  }

  push(senderT, frame, localT) {
    const d = localT - senderT;
    // Follow the quickest delivery, but drift up slowly so clock drift and a
    // slower route don't freeze the rider.
    this.offset = this.offset === null ? d : Math.min(d, this.offset + Math.max(0, localT - this.lastLocal) * 0.002);
    this.lastLocal = localT;
    const b = this.buf;
    if (b.length && senderT <= b[b.length - 1].t) {
      if (senderT === b[b.length - 1].t) return;
      // Out of order: insert in place.
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > senderT) i--;
      if (i > 0 && b[i - 1].t === senderT) return; // already have it
      b.splice(i, 0, { t: senderT, f: frame });
    } else b.push({ t: senderT, f: frame });
    while (b.length > 2 && b[0].t < senderT - 3000) b.shift();
  }

  // Fill `out` (a frame) for local time `localT`, drawn `delay` ms in the past.
  // Returns false if there's nothing to draw yet.
  sample(localT, delay, out) {
    const b = this.buf;
    if (!b.length) return false;
    const t = localT - this.offset - delay;
    if (b.length === 1 || t <= b[0].t) {
      copy(b[0].f, out);
      return true;
    }
    const last = b[b.length - 1];
    if (t >= last.t) {
      copy(last.f, out);
      // Carry on a little past the last update (at most a quarter second).
      const prev = b[b.length - 2];
      const span = last.t - prev.t;
      const ahead = Math.min(t - last.t, 250);
      if (span > 0 && span < 1000 && ahead > 0) {
        const k = ahead / span;
        for (let i = 0; i < 3; i++) out[i] = last.f[i] + (last.f[i] - prev.f[i]) * k;
      }
      return true;
    }
    let i = 1;
    while (b[i].t < t) i++;
    const a = b[i - 1];
    const c = b[i];
    const k = (t - a.t) / (c.t - a.t);
    for (let j = 0; j < STRIDE; j++) out[j] = BLEND.has(j) ? a.f[j] + (c.f[j] - a.f[j]) * k : k < 0.5 ? a.f[j] : c.f[j];
    // Orientation: blend the quaternions along the short way, then normalise.
    let dot = a.f[3] * c.f[3] + a.f[4] * c.f[4] + a.f[5] * c.f[5] + a.f[6] * c.f[6];
    const s = dot < 0 ? -1 : 1;
    let len = 0;
    for (let j = 3; j < 7; j++) {
      out[j] = a.f[j] + (s * c.f[j] - a.f[j]) * k;
      len += out[j] * out[j];
    }
    len = Math.sqrt(len) || 1;
    for (let j = 3; j < 7; j++) out[j] /= len;
    dot = 0;
    return true;
  }

  get newest() {
    return this.buf.length ? this.buf[this.buf.length - 1] : null;
  }
}

function copy(src, out) {
  for (let i = 0; i < STRIDE; i++) out[i] = src[i];
}

// ------------------------------------------------------------ the session
const LOBBY = 'lobby';

/**
 * Your place in the live rooms. One per park visit.
 * me: { uid, tag, look, board }
 */
export class LiveRoom {
  constructor({ me, budget = 60, onChange = () => {}, onTrick = () => {}, onEvent = () => {}, open = openChannel }) {
    this.me = me;
    this.open = open; // channel opener (net.js; tests pass a stand-in)
    this.budget = budget;
    this.onChange = onChange;
    this.onTrick = onTrick;
    this.onEvent = onEvent; // (event, payload) for other features (duels, chat signals)
    this.lobby = null;
    this.lobbyMembers = [];
    this.room = null; // channel
    this.park = null;
    this.number = 0;
    this.privateKey = null;
    this.remotes = new Map(); // uid -> { uid, tag, look, board, status, snaps, heard, trick }
    this.lastSend = 0;
    this.status = 'lift';
    this.joining = null;
    this.extraEvents = {};
  }

  // Riders per park and room, from everyone's lobby presence.
  counts(park) {
    const m = new Map();
    for (const p of this.lobbyMembers) if (p.park === park && !p.priv) m.set(p.room, (m.get(p.room) || 0) + 1);
    return m;
  }

  parkCount(park) {
    return this.lobbyMembers.filter((p) => p.park === park).length;
  }

  async openLobby() {
    if (this.lobby) return;
    let first;
    const synced = new Promise((r) => (first = r));
    this.lobby = await this.open(LOBBY, {
      key: this.me.uid,
      onPresence: (members) => {
        this.lobbyMembers = members;
        first();
        this.onChange();
      },
    });
    await Promise.race([synced, new Promise((r) => setTimeout(r, 1500))]);
  }

  // Join a room on `park`: a given room number, a party's private room
  // (privateKey), or the best open room.
  async join(park, { room = null, privateKey = null } = {}) {
    if (this.joining) await this.joining.catch(() => {});
    this.joining = this._join(park, room, privateKey);
    return this.joining;
  }

  async _join(park, room, privateKey) {
    await this.leaveRoom();
    await this.openLobby();
    const rules = roomRules(park);
    let n = privateKey ? 0 : room || pickRoom(this.counts(park), rules);
    for (let attempt = 0; attempt < 4; attempt++) {
      const topic = privateKey ? `room:${park}:p${privateKey}` : `room:${park}:${n}`;
      const ch = await this.open(topic, {
        key: this.me.uid,
        onBroadcast: {
          p: (m) => this._pose(m),
          t: (m) => this._trick(m),
          x: (m) => this.onEvent(m.e, m),
        },
        onPresence: (members) => this._members(members),
      });
      await ch.track({ u: this.me.uid, tag: this.me.tag, look: this.me.look, board: this.me.board });
      await new Promise((r) => setTimeout(r, 400));
      const here = ch.members().length;
      if (!privateKey && here > rules.max) {
        await ch.close();
        n++;
        continue;
      }
      this.room = ch;
      this.park = park;
      this.number = n;
      this.privateKey = privateKey;
      await this.lobby.track({ u: this.me.uid, tag: this.me.tag, park, room: n, priv: !!privateKey });
      this.onChange();
      return n;
    }
    throw new Error('All rooms are full right now.');
  }

  async leaveRoom() {
    const ch = this.room;
    this.room = null;
    this.park = null;
    this.number = 0;
    this.remotes.clear();
    if (ch) {
      await ch.close().catch(() => {});
      await this.lobby?.untrack().catch(() => {});
    }
    this.onChange();
  }

  async close() {
    await this.leaveRoom();
    const l = this.lobby;
    this.lobby = null;
    this.lobbyMembers = [];
    if (l) await l.close().catch(() => {});
  }

  get riders() {
    return this.room ? this.remotes.size + 1 : 0;
  }

  // ---------------------------------------------------- sending
  // Call every frame; sends at the room's current rate.
  // status: riding | lift | paused | results | replay | duel
  tick(rider, status, now = performance.now()) {
    if (!this.room) return;
    const rate = sendRate(this.riders, this.budget);
    const visible = status === 'riding' || status === 'results' || status === 'paused';
    // Off the slope (lift, replay): a slow heartbeat with just the status.
    const interval = visible && rate > 0 ? 1000 / rate : this.riders > 1 ? 2000 : Infinity;
    if (status !== this.status) {
      this.status = status;
      this.lastSend = 0;
    }
    if (now - this.lastSend < interval) return;
    this.lastSend = now;
    this.room.send('p', { u: this.me.uid, t: Math.round(now), s: status, f: visible ? packPose(rider) : null });
  }

  sendTrick(name, points) {
    this.room?.send('t', { u: this.me.uid, n: name, pts: points });
  }

  // Extra room events for other features: { e: 'challenge', to, ... }
  sendEvent(e, data = {}) {
    this.room?.send('x', { ...data, e, u: this.me.uid });
  }

  // ---------------------------------------------------- receiving
  _remote(uid) {
    let r = this.remotes.get(uid);
    if (!r) {
      r = { uid, tag: '…', look: null, board: false, status: 'lift', snaps: new Snapshots(), heard: 0, trick: null, interval: 100 };
      this.remotes.set(uid, r);
    }
    return r;
  }

  _members(members) {
    const seen = new Set();
    for (const m of members) {
      if (!m.u || m.u === this.me.uid) continue;
      seen.add(m.u);
      const r = this._remote(m.u);
      r.tag = m.tag || r.tag;
      r.look = m.look || r.look;
      r.board = !!m.board;
    }
    for (const uid of [...this.remotes.keys()]) if (!seen.has(uid)) this.remotes.delete(uid);
    this.onChange();
  }

  _pose(m) {
    if (!m || !m.u || m.u === this.me.uid) return;
    const r = this.remotes.get(m.u);
    if (!r) return; // not (yet) in the room's presence
    const now = performance.now();
    if (r.heard) r.interval = r.interval * 0.8 + Math.min(2000, now - r.heard) * 0.2;
    r.heard = now;
    if (r.status !== m.s) {
      r.status = m.s;
      this.onChange();
    }
    if (Array.isArray(m.f) && m.f.length === STRIDE) r.snaps.push(m.t, m.f, now);
  }

  _trick(m) {
    const r = this.remotes.get(m?.u);
    if (!r) return;
    r.trick = { name: String(m.n || '').slice(0, 60), points: Number(m.pts) || 0, at: performance.now() };
    this.onTrick(r);
  }
}
