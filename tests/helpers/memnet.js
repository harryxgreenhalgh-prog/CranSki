// An in-memory stand-in for Realtime channels, for tests.
export function memoryNet() {
  const topics = new Map(); // topic -> Set(client)
  return () =>
    async (topic, { key, onBroadcast = {}, onPresence, onStatus }) => {
      const set = topics.get(topic) || new Set();
      topics.set(topic, set);
      const me = { key, payload: null, onBroadcast, onPresence };
      set.add(me);
      const members = () => [...set].filter((c) => c.payload).map((c) => ({ ...c.payload, key: c.key }));
      const sync = () => set.forEach((c) => c.onPresence?.(members()));
      onStatus?.('SUBSCRIBED');
      return {
        topic,
        track: async (p) => {
          me.payload = p;
          sync();
        },
        untrack: async () => {
          me.payload = null;
          sync();
        },
        send: (event, payload) => set.forEach((c) => c !== me && c.onBroadcast[event]?.(JSON.parse(JSON.stringify(payload)))),
        members,
        close: async () => {
          set.delete(me);
          sync();
        },
      };
    };
}
