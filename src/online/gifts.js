// Gifting to friends (DESIGN.md, Progression and economy): buy one of today's
// Shop items for a friend with your FROST. The database checks every rule
// (5 a day, friends of 2+ days, your account a week old with 20 runs, their
// opt-out) and does the transfer; this only asks and shows.
import { account, OnlineError, notSetUp } from './account.js';
import { getClient } from './client.js';
import { wallet } from './wallet.js';
import { economy } from './economy.js';

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.warn(name, error);
    throw new OnlineError(notSetUp(error) ? "Gifting isn't set up on the server yet." : 'Something went wrong. Try again.');
  }
  return data;
}

export const GIFT_STATUS = {
  account_too_new: 'Your account needs to be a week old before you can send gifts.',
  not_enough_runs: 'Finish 20 runs (signed in) before you can send gifts.',
  not_friends: 'You can only send gifts to friends.',
  friends_too_new: 'You can send gifts to friends of 2 days or more.',
  gifts_off: "That rider has turned gifts off.",
  daily_limit: "You've sent 5 gifts today. More tomorrow.",
  not_in_shop: "That item isn't in today's Shop any more.",
  already_owned: 'They already have that item.',
  not_enough_frost: 'Not enough FROST for that gift.',
  no_gamertag: 'Pick a gamertag first.',
};

export const gifts = {
  status: () => rpc('gift_status'),
  async send(friend, item) {
    const r = await rpc('send_gift', { p_friend: friend, p_item: item });
    if (r?.status === 'ok' && Number.isFinite(r.balance)) wallet.set({ balance: r.balance });
    return r;
  },
  mine: () => rpc('my_gifts'),
  markSeen: () => rpc('mark_gifts_seen'),
  getAccept: () => rpc('my_gift_setting'),
  setAccept: (on) => rpc('set_accept_gifts', { p_accept: !!on }),
  onReceived: null, // (gifts) => …, for gifts not seen yet
};

// Look for new gifts after signing in and every minute while the game is open.
let timer = 0;
let readyFor = null;
async function check() {
  clearTimeout(timer);
  if (!account.ready) return;
  if (document.visibilityState !== 'hidden') {
    try {
      const g = await gifts.mine();
      const fresh = (g?.recent || []).filter((x) => !x.seen);
      if (fresh.length) {
        await gifts.markSeen();
        await economy.refreshInventory();
        gifts.onReceived?.(fresh);
      }
    } catch {
      /* try again later */
    }
  }
  timer = setTimeout(check, 60000);
}
account.onChange(() => {
  const id = account.ready ? account.user.id : null;
  if (id === readyFor) return;
  readyFor = id;
  if (id) setTimeout(check, 3000);
  else clearTimeout(timer);
});
