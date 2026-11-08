// Realtime channels for live rooms, duels and parties: a thin layer over
// Supabase Realtime (Broadcast + Presence on private channels, so the Row Level
// Security policies in supabase/migrations decide who may join, listen and send).
//
// With ?localnet in the page address, a stand-in (localnet.js) links the tabs of
// one browser instead, so multiplayer can be tried without a server.
import { getClient } from './client.js';

export const LOCAL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('localnet');

// Flatten Supabase's presence state ({ key: [payload, ...] }) to one entry per key.
export function flattenPresence(state) {
  return Object.entries(state || {}).map(([key, list]) => ({ ...list[list.length - 1], key }));
}

/**
 * Join a channel.
 * @param {string} topic
 * @param {{ key?: string, onBroadcast?: Record<string, (payload: any) => void>,
 *           onPresence?: (members: any[]) => void, onStatus?: (status: string) => void }} opts
 * @returns {Promise<{ topic: string, track(p: object): Promise<any>, untrack(): Promise<any>,
 *           send(event: string, payload: any): void, members(): any[], close(): Promise<void> }>}
 */
export async function openChannel(topic, opts = {}) {
  if (LOCAL) return (await import('./localnet.js')).openLocalChannel(topic, opts);
  const { key, onBroadcast = {}, onPresence, onStatus } = opts;
  const sb = await getClient();
  const ch = sb.channel(topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: key || '' } } });
  for (const [event, fn] of Object.entries(onBroadcast)) ch.on('broadcast', { event }, ({ payload }) => fn(payload));
  if (onPresence) ch.on('presence', { event: 'sync' }, () => onPresence(flattenPresence(ch.presenceState())));
  let joined = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out joining ' + topic)), 12000);
    ch.subscribe((status, err) => {
      if (!joined && status === 'SUBSCRIBED') {
        joined = true;
        clearTimeout(timer);
        resolve();
      } else if (!joined && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
        clearTimeout(timer);
        reject(err || new Error(`${status} joining ${topic}`));
      }
      if (joined) onStatus?.(status);
    });
  });
  return {
    topic,
    track: (payload) => ch.track(payload),
    untrack: () => ch.untrack(),
    send: (event, payload) => {
      ch.send({ type: 'broadcast', event, payload });
    },
    members: () => flattenPresence(ch.presenceState()),
    close: async () => {
      await sb.removeChannel(ch);
    },
  };
}
