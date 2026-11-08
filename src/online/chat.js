// Room and party chat. Messages go out through the chat Edge Function (which
// filters, rate-limits and signs them) and arrive over a Realtime channel that
// riders can only listen on. Nothing is stored: the game keeps the last 10
// minutes in memory, only so a report can include them.
import { load, save } from '../store.js';
import { getClient } from './client.js';
import { openChannel, LOCAL } from './net.js';
import { filterChat, PHRASES } from './chatFilter.js';

const KEEP_MS = 10 * 60 * 1000;

export const REPORT_REASONS = [
  ['hate', 'Hate or discrimination'],
  ['bullying', 'Bullying or threats'],
  ['sexual', 'Sexual or rude'],
  ['spam', 'Spam'],
  ['name', 'Offensive gamertag'],
  ['cheating', 'Cheating'],
  ['other', 'Something else'],
];

// Riders you've muted (kept on this device).
export function mutedRiders() {
  return new Set(load('mutedRiders', []));
}
export function setMuted(uid, on) {
  const s = mutedRiders();
  if (on) s.add(uid);
  else s.delete(uid);
  save('mutedRiders', [...s].slice(-500));
}

async function callChat(body) {
  if (LOCAL) return localChat(body);
  const sb = await getClient();
  const { data, error } = await sb.functions.invoke('chat', { body });
  if (!error) return data;
  let info = {};
  try {
    info = await error.context?.json?.();
  } catch {
    /* not JSON */
  }
  return { error: info?.error || 'network', until: info?.until || info?.muted_until || null };
}

export class ChatChannel {
  constructor({ me, onMessage = () => {}, onSystem = () => {} }) {
    this.me = me;
    this.onMessage = onMessage;
    this.onSystem = onSystem;
    this.topic = null;
    this.ch = null;
    this.buffer = []; // signed messages from the last 10 minutes
    this.seen = new Set();
    this.mutedUntil = 0;
  }

  async attach(topic) {
    if (this.topic === topic && this.ch) return;
    await this.detach();
    this.topic = topic;
    this.ch = await openChannel(topic, { onBroadcast: { msg: (m) => this._receive(m) } });
  }

  async detach() {
    const ch = this.ch;
    this.ch = null;
    this.topic = null;
    this.buffer = [];
    this.seen.clear();
    if (ch) await ch.close().catch(() => {});
  }

  _receive(m) {
    if (!m || !m.id || this.seen.has(m.id)) return;
    this.seen.add(m.id);
    const now = Date.now();
    this.buffer.push(m);
    while (this.buffer.length && this.buffer[0].ts < now - KEEP_MS) this.seen.delete(this.buffer.shift().id);
    if (m.u !== this.me.uid && mutedRiders().has(m.u)) return;
    this.onMessage(m);
  }

  get muted() {
    return this.mutedUntil > Date.now();
  }

  async send(text) {
    return this._send({ action: 'send', topic: this.topic, text });
  }

  async sendPhrase(i) {
    return this._send({ action: 'send', topic: this.topic, phrase: i });
  }

  async _send(body) {
    if (!this.topic) return;
    if (this.muted) {
      this.onSystem(`You can chat again in ${Math.ceil((this.mutedUntil - Date.now()) / 60000)} min.`);
      return;
    }
    const r = await callChat(body);
    if (r?.ok) {
      this._receive(r.msg); // show it now; the broadcast copy is ignored
      if (r.filtered) this.onSystem('Part of your message was filtered.');
      if (r.muted_until) this._muted(r.muted_until);
      return;
    }
    const e = r?.error;
    if (e === 'blocked') {
      this.onSystem("Your message wasn't sent: it broke the chat rules.");
      if (r.until) this._muted(r.until);
    } else if (e === 'muted') this._muted(r.until);
    else if (e === 'slow_down') this.onSystem("You're sending messages too fast.");
    else if (e === 'empty') return;
    else if (e === 'server_not_configured' || e === 'network') this.onSystem("Chat isn't available right now.");
    else this.onSystem("Couldn't send that message.");
  }

  _muted(until) {
    this.mutedUntil = until ? Date.parse(until) || Date.now() + 15 * 60000 : Date.now() + 15 * 60000;
    this.onSystem(`Your chat is muted for ${Math.ceil((this.mutedUntil - Date.now()) / 60000)} min for breaking the chat rules.`);
  }

  // Report a rider: sends this room's last 10 minutes; the server keeps only
  // messages it signed itself.
  async report(uid, reason, note = '') {
    if (!this.topic) return { ok: false, error: 'not_in_room' };
    const cutoff = Date.now() - KEEP_MS;
    const messages = this.buffer.filter((m) => m.ts >= cutoff);
    return callChat({ action: 'report', topic: this.topic, reported: uid, reason, note, messages });
  }
}

// ?localnet testing: filter locally and pass messages between tabs (no server,
// no signatures, nothing saved).
const localState = { strikes: 0, mutedUntil: 0 };
async function localChat(body) {
  const { localDeliver } = await import('./localnet.js');
  const me = JSON.parse(sessionStorage.getItem('cranski.localme') || '{}');
  if (body.action === 'report') return { ok: true, kept: body.messages.length };
  if (localState.mutedUntil > Date.now()) return { error: 'muted', until: new Date(localState.mutedUntil).toISOString() };
  let text;
  let q = null;
  let filtered = false;
  if (body.phrase !== undefined) {
    q = body.phrase;
    text = PHRASES[q];
  } else {
    const f = filterChat(body.text);
    if (f.blocked) return f.flags.hate ? { error: 'blocked' } : { error: 'empty' };
    text = f.text;
    filtered = f.flags.crude || f.flags.link || f.flags.contact;
  }
  const msg = { id: crypto.randomUUID(), topic: body.topic, u: me.uid, tag: me.tag, text, ts: Date.now(), q, sig: 'local' };
  localDeliver(body.topic, 'msg', msg);
  return { ok: true, msg, filtered };
}
