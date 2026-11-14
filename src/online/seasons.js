// Seasons (DESIGN.md, Progression and economy): the season now under way, each
// board's leader (who wears a crown), RECORD alerts when a season best falls,
// last season's winners, and noticing when a new season begins (fresh boards
// and ghosts; items stay). The database runs the seasons; this only listens.
import { getClient } from './client.js';
import { openChannel } from './net.js';
import { account } from './account.js';

const listeners = new Set();
const seen = new Set(); // records already shown
const LS = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(`cranski.${k}`);
    localStorage.setItem(`cranski.${k}`, String(v));
  } catch {
    return null;
  }
  return null;
};

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

export const seasons = {
  info: null, // { season: { id, name, starts_at, ends_at }, rules, last }
  leaders: {}, // park -> { user_id, gamertag, total }
  onRecord: null, // ({ park, gamertag, total, previous, user_id }) => …
  onNewSeason: null, // (season, previousId) => …
  onPrizes: null, // (lastSeason, prizes) => …

  get id() {
    return this.info?.season?.id ?? null;
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  _emit() {
    for (const fn of [...listeners]) fn(this);
  },
  leaderOf(park) {
    return this.leaders[park]?.user_id || null;
  },
  leadsAny(uid) {
    return !!uid && Object.values(this.leaders).some((l) => l.user_id === uid);
  },

  async refresh() {
    try {
      const [info, leaders] = await Promise.all([rpc('season_info'), rpc('season_leaders')]);
      this.info = info?.season ? info : null;
      this.leaders = leaders && typeof leaders === 'object' && !Array.isArray(leaders) ? leaders : {};
      const id = info?.season?.id;
      const before = Number(LS('season')) || null;
      if (id && before && before !== id) this.onNewSeason?.(info.season, before);
      if (id) LS('season', id);
      const mine = info?.last?.mine;
      if (mine?.length && Number(LS('prizeSeen')) !== info.last.id) {
        LS('prizeSeen', info.last.id);
        this.onPrizes?.(info.last, mine);
      }
    } catch (e) {
      console.warn('season_info', e);
    }
    this._emit();
  },

  async refreshLeaders() {
    try {
      const l = await rpc('season_leaders');
      this.leaders = l && typeof l === 'object' && !Array.isArray(l) ? l : {};
      this._emit();
    } catch {
      /* next time */
    }
  },

  _record(m) {
    if (!m || !m.park) return;
    const key = `${m.park}:${m.user_id}:${m.total}`;
    if (seen.has(key)) return;
    seen.add(key);
    this.leaders = { ...this.leaders, [m.park]: { user_id: m.user_id, gamertag: m.gamertag, total: m.total } };
    this._emit();
    this.onRecord?.(m);
  },
};

// Live RECORD broadcasts from the database, plus a check every minute in case one is missed.
let since = new Date().toISOString();
let channel = null;
async function listen() {
  if (channel) return;
  try {
    channel = await openChannel('records', { onBroadcast: { record: (m) => seasons._record(m) } });
  } catch (e) {
    channel = null;
    console.warn('records channel', e);
  }
}
async function poll() {
  if (document.visibilityState !== 'hidden') {
    try {
      const list = await rpc('recent_records', { p_since: since });
      for (const r of list || []) {
        seasons._record(r);
        if (r.at > since) since = r.at;
      }
    } catch {
      /* not set up yet, or offline */
    }
  }
  setTimeout(poll, 60000);
}
let started = false;
export function startSeasons() {
  if (started) return;
  started = true;
  seasons.refresh();
  listen();
  setTimeout(poll, 60000);
  setInterval(() => document.visibilityState !== 'hidden' && seasons.refreshLeaders(), 120000);
  account.onChange(() => {
    // Signing in can change what we may hear and what we won.
    if (channel) {
      const c = channel;
      channel = null;
      c.close().catch(() => {});
    }
    listen();
    seasons.refresh();
  });
}
