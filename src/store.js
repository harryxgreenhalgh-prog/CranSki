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
  get frost() {
    return load('frost', 0);
  },
  // FROST is earned only by riding: 10 per finished run plus 1 per 10,000 points,
  // capped at 100 a day.
  awardFrost(points) {
    const today = new Date().toISOString().slice(0, 10);
    const day = load('frostDay', { date: today, earned: 0 });
    if (day.date !== today) {
      day.date = today;
      day.earned = 0;
    }
    const want = 10 + Math.floor(points / 10000);
    const give = Math.max(0, Math.min(want, 100 - day.earned));
    day.earned += give;
    save('frostDay', day);
    save('frost', load('frost', 0) + give);
    return give;
  },
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
