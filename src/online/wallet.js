// Your FROST balance, as the server has it. The game never changes FROST
// itself: runs are paid by the submit-run Edge Function after it re-rides
// them, and the Shop and Season Pass spend it through database functions.
// This only reads the balance and passes on what the server reports.
import { account } from './account.js';
import { getClient } from './client.js';

const listeners = new Set();

export const wallet = {
  frost: null, // null until known (or signed out)
  today: 0, // FROST from runs today (UTC)
  cap: 100,
  recent: [],

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  _emit() {
    for (const fn of [...listeners]) fn(this);
  },

  // What the server says after a payment or purchase: { balance, today, cap }.
  set(info) {
    if (!info) return;
    if (Number.isFinite(info.balance)) this.frost = info.balance;
    if (Number.isFinite(info.frost)) this.frost = info.frost;
    if (Number.isFinite(info.today)) this.today = info.today;
    if (Number.isFinite(info.cap)) this.cap = info.cap;
    if (Array.isArray(info.recent)) this.recent = info.recent;
    this._emit();
  },

  async refresh() {
    if (!account.ready) {
      this.frost = null;
      this.today = 0;
      this.recent = [];
      this._emit();
      return;
    }
    try {
      const sb = await getClient();
      const { data, error } = await sb.rpc('my_wallet');
      if (error) throw error;
      this.set(data);
    } catch (e) {
      console.warn('my_wallet', e);
    }
  },
};

let readyFor = null;
account.onChange(() => {
  const id = account.ready ? account.user.id : null;
  if (id === readyFor) return;
  readyFor = id;
  wallet.refresh();
});

// "+12 FROST · 34/100 today", or why nothing was paid.
export function frostText(f) {
  if (!f) return '';
  if (f.duplicate) return 'FROST was already paid for this run';
  if (f.awarded > 0) return `+${f.awarded} FROST earned · ${f.today}/${f.cap} today`;
  return `Daily FROST cap reached (${f.cap} a day)`;
}
