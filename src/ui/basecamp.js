// Basecamp lobby: tabs, cards, lift pass, mode picker and footer links.
import { parkMeta } from '../parks/index.js';
import { profile } from '../store.js';
import { account } from '../online/account.js';
import { UPDATES } from './pages.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// A rotating solo challenge, checked against your local bests.
const CHALLENGES = [
  { park: 'bigair', target: 30000, text: 'Bank 30,000 in one run on BIG AIR' },
  { park: 'yard', target: 60000, text: 'Bank 60,000 in one run on THE YARD' },
  { park: 'apex', target: 40000, text: 'Bank 40,000 in one run on APEX' },
  { park: 'forest', target: 50000, text: 'Bank 50,000 in one run on FOREST LINE' },
  { park: 'pipe', target: 20000, text: 'Bank 20,000 in one run in ASPEN PIPE' },
  { park: 'bellevue', target: 45000, text: 'Bank 45,000 in one run on BELLEVUE' },
];

export class Basecamp {
  constructor({ onRide, onTab, onPage, onGear, onMusic, onAccount, onFriends, onMode }) {
    $('ride').addEventListener('click', onRide);
    document.querySelectorAll('#basecamp .tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#basecamp .tabs button').forEach((x) => x.classList.toggle('on', x === b));
        onTab(b.dataset.tab);
      })
    );
    document.querySelectorAll('#basecamp .footlinks button').forEach((b) => b.addEventListener('click', () => onPage(b.dataset.page)));
    $('gear-btn').addEventListener('click', onGear);
    $('music-btn').addEventListener('click', onMusic);
    $('friends-btn').addEventListener('click', () => (onFriends ? onFriends() : onPage('online')));
    $('account-btn').addEventListener('click', onAccount);
    document.querySelectorAll('#basecamp .mode').forEach((b) =>
      b.addEventListener('click', () => onMode?.(b.dataset.mode === 'multi' ? 'live' : b.dataset.mode === 'ranked' ? 'ranked' : 'solo'))
    );
    const name = $('rider-name');
    // Signed in, the lift pass shows your gamertag; change it from Account.
    name.addEventListener('click', () => {
      if (account.ready) onAccount();
    });
    name.addEventListener('change', () => {
      if (account.ready) return;
      profile.name = name.value;
      name.value = profile.name;
    });
    name.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name must not drive the game
      if (e.key === 'Enter') name.blur();
    });
    name.addEventListener('input', () => {
      const c = name.value.replace(/[^\p{L} -]/gu, '');
      if (c !== name.value) name.value = c;
    });
  }

  show() {
    $('basecamp').classList.remove('hidden');
    document.querySelectorAll('#basecamp .tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'ride'));
    this.refresh();
  }

  hide() {
    $('basecamp').classList.add('hidden');
  }

  get visible() {
    return !$('basecamp').classList.contains('hidden');
  }

  refreshAccount() {
    const btn = $('account-btn');
    const s = account.status;
    btn.textContent = s === 'starting' ? '…' : account.ready ? account.gamertag : account.signedIn ? 'Pick a gamertag' : 'Sign in';
    btn.classList.toggle('on', account.signedIn);
    const name = $('rider-name');
    name.readOnly = account.ready;
    name.title = account.ready ? 'Your gamertag (change it in Account)' : 'Rider name';
    if (document.activeElement !== name) name.value = account.ready ? account.gamertag : profile.name;
    $('pc-mode').textContent = account.ready ? 'ONLINE' : 'SOLO';
  }

  setMode(mode, note) {
    document.querySelectorAll('#basecamp .mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === (mode === 'live' ? 'multi' : 'solo')));
    $('mode-note').textContent = note;
  }

  refreshFriends(f) {
    const btn = $('friends-btn');
    const online = f.online.length;
    const asks = f.incoming.length + (this.partyInvites ? this.partyInvites() : 0);
    btn.innerHTML = `Friends${online ? ` <span class="fcount" title="Friends online">${online}</span>` : ''}${asks ? ` <span class="fbadge" title="Friend requests">${asks}</span>` : ''}`;
  }

  refresh() {
    $('frost').textContent = fmt(profile.frost);
    this.refreshAccount();
    const runs = profile.runs;
    $('pc-runs').textContent = `${runs.length} run${runs.length === 1 ? '' : 's'}`;
    const u = UPDATES[0];
    $('news-body').innerHTML = `<b>${u.title}</b><p class="muted">${u.items[0]}</p>`;
    const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    const ch = CHALLENGES[week % CHALLENGES.length];
    const best = profile.best(ch.park);
    const pct = Math.min(100, (best / ch.target) * 100);
    $('event-body').innerHTML = `<b>${ch.text}</b><p class="muted">Solo challenge · changes weekly · best ${fmt(best)}</p><div class="bar"><span style="width:${pct}%"></span></div>`;
    const top = [...runs].sort((a, b) => b.total - a.total).slice(0, 3);
    $('podium').innerHTML = top.length
      ? top.map((r) => `<li><b>${fmt(r.total)}</b> · ${parkMeta(r.park).name}</li>`).join('')
      : '<li class="muted">Finish a run to get on your podium.</li>';
  }
}
