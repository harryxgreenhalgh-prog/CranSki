// Your Season Pass and the items you own, as the server has them. Like FROST
// (wallet.js), the game only reads these and shows what the server reports:
// XP comes from submit-run after a re-ridden run, and items arrive from Pass
// levels, the Shop and gifts through database functions.
import { account, OnlineError, notSetUp } from './account.js';
import { getClient } from './client.js';
import { wallet } from './wallet.js';

const listeners = new Set();

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.warn(name, error);
    throw new OnlineError(notSetUp(error) ? "The Season Pass isn't set up on the server yet." : 'Something went wrong. Try again.');
  }
  return data;
}

export const economy = {
  pass: null, // { season: { id, name, starts_at, ends_at }, xp, level, premium, full_left }
  owned: new Set(), // item ids
  ownedInfo: new Map(), // item id -> { source, at, paid }
  lastRun: null, // the latest run's { gained, level, granted, ... }

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  _emit() {
    for (const fn of [...listeners]) fn(this);
  },

  async refresh() {
    if (!account.ready) {
      this.pass = null;
      this.owned = new Set();
      this.ownedInfo = new Map();
      this._emit();
      return;
    }
    try {
      const [pass, inv] = await Promise.all([rpc('my_pass'), rpc('my_inventory')]);
      this.pass = pass;
      this._setInventory(inv);
    } catch (e) {
      console.warn(e);
    }
    this._emit();
  },

  _setInventory(inv) {
    this.owned = new Set((inv || []).map((r) => r.item));
    this.ownedInfo = new Map((inv || []).map((r) => [r.item, r]));
  },

  async refreshInventory() {
    if (!account.ready) return;
    try {
      this._setInventory(await rpc('my_inventory'));
      this._emit();
    } catch (e) {
      console.warn(e);
    }
  },

  // What submit-run says about the Pass after a run.
  applyRun(xp) {
    if (!xp) return;
    this.lastRun = xp;
    if (this.pass && this.pass.season?.id === xp.season) Object.assign(this.pass, { xp: xp.xp, level: xp.level, premium: xp.premium, full_left: xp.full_left });
    else this.refresh();
    if (xp.granted?.some((g) => g.item)) this.refreshInventory();
    this._emit();
  },

  async buyPremium() {
    const r = await rpc('buy_premium_pass');
    if (r?.status === 'ok') {
      wallet.refresh();
      await this.refresh();
    }
    return r;
  },
};

let readyFor = null;
account.onChange(() => {
  const id = account.ready ? account.user.id : null;
  if (id === readyFor) return;
  readyFor = id;
  economy.refresh();
});
