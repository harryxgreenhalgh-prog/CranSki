// chat: every chat message goes through here, never straight from one rider
// to another (DESIGN.md, Safety):
//   - the filter (filter.js) masks crude words and removes links and contact
//     details; a message with a hate word reaches nobody;
//   - strikes add up, and 3 within 15 minutes mute that rider's chat for 15
//     minutes; a rate limit stops spam;
//   - the message is signed and broadcast to the room (or party) over
//     Realtime. It isn't stored anywhere.
// Reports send the reporter's last 10 minutes of the room's messages; only
// messages carrying this server's signature are saved, so they can't be faked.
// Plain JavaScript so the Node tests can run it too; index.ts wires it up.
import { filterChat, strikeWeight, PHRASES } from './filter.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const ROOM_TOPIC = /^chat:[a-z]+:[0-9]+$/;
export const PARTY_TOPIC = /^pchat:[0-9a-f-]{36}$/;
export const REASONS = ['hate', 'bullying', 'sexual', 'spam', 'name', 'cheating', 'other'];
const REPORT_WINDOW = 10 * 60 * 1000;

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// HMAC key for signing messages, derived from a server-only secret.
export async function signingKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('cranski-chat-v1:' + secret));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const canonical = (m) => [m.id, m.topic, m.u, m.tag, m.text, m.ts, m.q ?? ''].join('\u0001');

export async function sign(key, m) {
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(canonical(m))));
}

export async function verify(key, m) {
  if (!m || typeof m.sig !== 'string') return false;
  return (await sign(key, m)) === m.sig;
}

/**
 * @param {Request} req
 * @param {{
 *   key: CryptoKey,
 *   userFromToken(token: string): Promise<string|null>,
 *   gamertagOf(uid: string): Promise<string|null>,
 *   inParty?(uid: string, partyId: string): Promise<boolean>,
 *   gate(uid: string): Promise<{ ok: boolean, reason?: string, until?: string }>,
 *   strike(uid: string, weight: number): Promise<{ muted_until?: string|null }>,
 *   broadcast(topic: string, event: string, payload: object): Promise<void>,
 *   saveReport(row: object): Promise<{ ok: boolean, error?: string }>,
 *   now?(): number,
 * }} d
 */
export async function handle(req, d) {
  if (req.method === 'OPTIONS') {
    const asked = req.headers.get('Access-Control-Request-Headers');
    return new Response('ok', { headers: { ...CORS, ...(asked ? { 'Access-Control-Allow-Headers': asked } : {}) } });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const uid = token ? await d.userFromToken(token) : null;
  if (!uid) return json({ error: 'not_signed_in' }, 401);
  const tag = await d.gamertagOf(uid);
  if (!tag) return json({ error: 'no_gamertag' }, 403);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const topic = String(body?.topic || '');
  const party = PARTY_TOPIC.test(topic);
  if (!ROOM_TOPIC.test(topic) && !party) return json({ error: 'bad_topic' }, 400);
  if (party && !(d.inParty && (await d.inParty(uid, topic.slice(6))))) return json({ error: 'not_in_party' }, 403);
  const now = d.now ? d.now() : Date.now();

  if (body.action === 'send') {
    const gate = await d.gate(uid);
    if (!gate.ok) return json({ error: gate.reason === 'muted' ? 'muted' : 'slow_down', until: gate.until || null }, gate.reason === 'muted' ? 403 : 429);
    let text;
    let q = null;
    let flags = { hate: false, crude: false, link: false, contact: false };
    if (body.phrase !== undefined && body.phrase !== null) {
      q = Number(body.phrase);
      if (!Number.isInteger(q) || q < 0 || q >= PHRASES.length) return json({ error: 'bad_request' }, 400);
      text = PHRASES[q];
    } else {
      const f = filterChat(body.text);
      flags = f.flags;
      if (f.blocked) {
        if (!flags.hate) return json({ error: 'empty' }, 400);
        const s = await d.strike(uid, strikeWeight(flags));
        return json({ error: 'blocked', muted_until: s.muted_until || null }, 422);
      }
      text = f.text;
    }
    const weight = strikeWeight(flags);
    const s = weight ? await d.strike(uid, weight) : {};
    const msg = { id: crypto.randomUUID(), topic, u: uid, tag, text, ts: now, q };
    msg.sig = await sign(d.key, msg);
    await d.broadcast(topic, 'msg', msg);
    return json({ ok: true, msg, filtered: weight > 0, muted_until: s.muted_until || null });
  }

  if (body.action === 'report') {
    const reason = String(body.reason || '');
    if (!REASONS.includes(reason)) return json({ error: 'bad_reason' }, 400);
    const reported = String(body.reported || '');
    if (!/^[0-9a-f-]{36}$/.test(reported) || reported === uid) return json({ error: 'bad_request' }, 400);
    const list = Array.isArray(body.messages) ? body.messages.slice(-400) : [];
    const kept = [];
    for (const m of list) {
      if (!m || m.topic !== topic || typeof m.ts !== 'number' || m.ts < now - REPORT_WINDOW - 60000 || m.ts > now + 60000) continue;
      if (await verify(d.key, m)) kept.push({ id: m.id, u: m.u, tag: m.tag, text: m.text, ts: m.ts, q: m.q ?? null });
    }
    const note = String(body.note || '').slice(0, 300);
    const r = await d.saveReport({ p_reporter: uid, p_reported: reported, p_topic: topic, p_reason: reason, p_note: note, p_messages: kept });
    if (!r.ok) return json({ error: r.error || 'save_failed' }, r.error === 'slow_down' ? 429 : 500);
    return json({ ok: true, kept: kept.length });
  }
  return json({ error: 'bad_request' }, 400);
}
