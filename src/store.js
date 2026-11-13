// Local saves in this browser. When you're signed in, src/online/cloud.js
// also copies settings, bests and Locker choices to your account.

const PREFIX = 'cranski.';
const saveListeners = new Set();

// Called with (key, value) after every local save.
export function onSave(fn) {
  saveListeners.add(fn);
}

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: just don't persist */
  }
  for (const fn of saveListeners) fn(key, value);
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing stored */
  }
}

// Rider name on the lift pass: letters, spaces and dashes only.
export function cleanName(name) {
  return (
    String(name || '')
      .replace(/[^\p{L} -]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18) || 'Rider'
  );
}

export const profile = {
  get name() {
    return load('name', 'Rider');
  },
  set name(v) {
    save('name', cleanName(v));
  },
  get park() {
    return load('park', 'bigair');
  },
  set park(v) {
    save('park', v);
  },
  best(parkId) {
    return load(`best.${parkId}`, 0);
  },
  setBest(parkId, v) {
    save(`best.${parkId}`, v);
  },
  get look() {
    return load('look', {});
  },
  set look(v) {
    save('look', v);
  },
  // (FROST lives on the server only: see online/wallet.js.)
  // Recent finished runs (for the podium and stats).
  get runs() {
    return load('runs', []);
  },
  addRun(run) {
    const runs = load('runs', []);
    runs.push(run);
    while (runs.length > 50) runs.shift();
    save('runs', runs);
  },
};
