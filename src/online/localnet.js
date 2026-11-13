// A stand-in for Supabase Realtime that links the tabs of one browser with
// BroadcastChannel. Only used when the page address has ?localnet, for trying
// live rooms (and tests) without a server. Same interface as net.js.
const bus = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cranski-localnet') : null;
const me = Math.random().toString(36).slice(2);
const channels = new Set();

bus?.addEventListener('message', (e) => {
  for (const c of channels) c._receive(e.data);
});

// Server-only messages (chat from the filter, see chat.js) can be injected here.
export function localDeliver(topic, event, payload) {
  const msg = { from: 'server', topic, type: 'b', event, payload };
  bus?.postMessage(msg);
  for (const c of channels) c._receive(msg);
}

export async function openLocalChannel(topic, { key, onBroadcast = {}, onPresence, onStatus } = {}) {
  const members = new Map(); // tab id -> { payload, seen }
  let mine = null;
  let beat = 0;
  const chan = {
    topic,
    _receive(m) {
      if (m.topic !== topic || m.from === me) return;
      if (m.type === 'b') onBroadcast[m.event]?.(m.payload);
      else if (m.type === 'p') {
        const had = members.has(m.from);
        members.set(m.from, { payload: m.payload, seen: performance.now() });
        if (!had || m.changed) sync();
      } else if (m.type === 'leave') {
        if (members.delete(m.from)) sync();
      } else if (m.type === 'hello' && mine) announce(true);
    },
  };
  const sync = () => onPresence?.(list());
  const list = () => {
    const out = [];
    if (mine) out.push({ ...mine, key: key || me });
    for (const [, v] of members) out.push({ ...v.payload, key: v.payload.__key });
    return out;
  };
  const announce = (changed) => mine && bus?.postMessage({ from: me, topic, type: 'p', payload: { ...mine, __key: key || me }, changed });
  channels.add(chan);
  beat = setInterval(() => {
    announce(false);
    const now = performance.now();
    let gone = false;
    // Long expiry: background tabs' timers get throttled, and closing a channel says 'leave' anyway.
    for (const [id, v] of members) if (now - v.seen > 90000) gone = members.delete(id) || gone;
    if (gone) sync();
  }, 1500);
  bus?.postMessage({ from: me, topic, type: 'hello' });
  await new Promise((r) => setTimeout(r, 150));
  onStatus?.('SUBSCRIBED');
  sync();
  return {
    topic,
    async track(payload) {
      mine = payload;
      announce(true);
      sync();
    },
    async untrack() {
      mine = null;
      bus?.postMessage({ from: me, topic, type: 'leave' });
      sync();
    },
    send(event, payload) {
      bus?.postMessage({ from: me, topic, type: 'b', event, payload });
    },
    members: list,
    async close() {
      clearInterval(beat);
      bus?.postMessage({ from: me, topic, type: 'leave' });
      channels.delete(chan);
    },
  };
}
