// Replays and ghosts in IndexedDB (this browser only).
//   replays: the last 5 runs auto-saved, plus any you chose to keep
//   ghosts:  your best run per park

const DB = 'cranski';
const AUTO_KEEP = 5;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('replays')) db.createObjectStore('replays', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ghosts')) db.createObjectStore('ghosts', { keyPath: 'park' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        t.onerror = () => reject(t.error);
      })
  );
}

export const replayDB = {
  async all() {
    try {
      const list = await tx('replays', 'readonly', (s) => s.getAll());
      return (list || []).sort((a, b) => b.date - a.date);
    } catch {
      return [];
    }
  },

  async get(id) {
    try {
      return await tx('replays', 'readonly', (s) => s.get(id));
    } catch {
      return null;
    }
  },

  // Auto-save a finished run, then trim auto-saves to the last 5.
  async add(replay) {
    try {
      await tx('replays', 'readwrite', (s) => s.put(replay));
      const list = await this.all();
      const autos = list.filter((r) => !r.saved);
      for (const r of autos.slice(AUTO_KEEP)) await tx('replays', 'readwrite', (s) => s.delete(r.id));
      return true;
    } catch {
      return false;
    }
  },

  async setSaved(id, saved) {
    try {
      const r = await this.get(id);
      if (!r) return false;
      r.saved = saved;
      await tx('replays', 'readwrite', (s) => s.put(r));
      return true;
    } catch {
      return false;
    }
  },

  async remove(id) {
    try {
      await tx('replays', 'readwrite', (s) => s.delete(id));
    } catch {
      /* ignore */
    }
  },

  async ghost(park) {
    try {
      return await tx('ghosts', 'readonly', (s) => s.get(park));
    } catch {
      return null;
    }
  },

  // Keep the best run per park as its ghost.
  async offerGhost(replay) {
    try {
      const cur = await this.ghost(replay.park);
      if (cur && cur.version === replay.version && cur.total >= replay.total) return false;
      await tx('ghosts', 'readwrite', (s) => s.put({ ...replay, id: undefined }));
      return true;
    } catch {
      return false;
    }
  },
};
