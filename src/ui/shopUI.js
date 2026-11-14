// The Item Shop: today's 6 daily items, this season's limited-time sets, and
// your recent purchases (returns within 24 hours, 3 per account). Everything
// is priced in FROST, which is earned only by riding. Tap Preview to see an
// item (or a whole set) on your rider; the server does every purchase.
import { account } from '../online/account.js';
import { economy } from '../online/economy.js';
import { wallet } from '../online/wallet.js';
import { itemById, setById, wear, KINDS, itemColor, hex } from '../economy/catalog.js';
import { esc } from './accountUI.js';
import { gifts, GIFT_STATUS } from '../online/gifts.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const STATUS = {
  not_enough_frost: "Not enough FROST yet. Ride to earn more: every finished run pays FROST.",
  owned: 'You already own that.',
  not_in_shop: "That isn't in the Shop any more.",
  no_gamertag: 'Pick a gamertag first.',
  too_late: 'Returns are only possible within 24 hours of buying.',
  no_returns_left: "You've used all 3 returns on this account.",
  already_returned: 'That was already returned.',
  not_owned: "You don't have that item any more, so it can't be returned.",
  not_found: "Couldn't find that purchase.",
};

export class Shop {
  /** model: the Basecamp rider; look(): your saved look; onSaveLook(look); onClose(); onAccount(); gifting: show Gift buttons */
  constructor({ model, look, onSaveLook, onClose, onAccount, gifting = true }) {
    this.model = model;
    this.look = look;
    this.onSaveLook = onSaveLook;
    this.onClose = onClose;
    this.onAccount = onAccount;
    this.gifting = gifting;
    this.giftItem = null; // the item being gifted (the friend picker is open)
    this.giftInfo = null;
    this.tab = 'daily';
    this.stock = null;
    this.purchases = null;
    this.confirm = null; // 'item:<id>' | 'set:<id>' waiting for a second tap
    this.previewing = null;
    this.focus = 'locker';
    $('shop-close').addEventListener('click', () => this.close());
    economy.onChange(() => this.isOpen && this.render());
    wallet.onChange(() => this.isOpen && this.render());
  }

  get isOpen() {
    return !$('shop').classList.contains('hidden');
  }

  async open(tab = 'daily') {
    this.tab = tab;
    this.msg = '';
    this.confirm = null;
    this.previewing = null;
    $('shop').classList.remove('hidden');
    this.render();
    clearInterval(this.timer);
    this.timer = setInterval(() => this._tick(), 1000);
    await this.load();
  }

  async load() {
    try {
      this.stock = await economy.shopToday();
      this.purchases = account.ready ? await economy.myPurchases() : null;
      this.err = null;
    } catch (e) {
      this.err = e.message;
    }
    this.render();
  }

  close() {
    clearInterval(this.timer);
    this.model.applyLook(this.look());
    $('shop').classList.add('hidden');
    this.onClose();
  }

  _tick() {
    if (!this.isOpen) return clearInterval(this.timer);
    if (this.stock && Date.parse(this.stock.ends_at) <= Date.now()) {
      this.stock = null;
      this.load(); // a new day: new daily items
    }
    this._info();
  }

  _info() {
    const bal = account.ready ? (wallet.frost === null ? '—' : fmt(wallet.frost)) : '—';
    const left = this.stock ? clock(Date.parse(this.stock.ends_at) - Date.now()) : '…';
    $('shop-info').innerHTML = `<b class="shop-bal">❄ ${bal} FROST</b><br>New daily items in ${left}<br><span class="small">FROST is earned only by riding. Nothing here costs real money.</span>`;
  }

  preview(ids) {
    let lk = this.look();
    for (const id of ids) {
      const it = itemById(id);
      if (it) lk = wear(lk, it);
    }
    this.previewing = ids.join(',');
    const first = itemById(ids[0]);
    this.focus = first && (first.slot === 'ride' || first.slot === 'gear') ? 'low' : first && (first.slot === 'head' || first.slot === 'goggles') ? 'close' : 'locker';
    this.model.applyLook(lk);
    this.render();
  }

  _card(it, { price = null, buy = null, inSet = false } = {}) {
    const owned = economy.owned.has(it.id);
    const key = `item:${it.id}`;
    const on = this.previewing === it.id;
    let action = '';
    if (!inSet) {
      if (owned) action = `<span class="owned">Owned ✓</span><button class="btn sm" data-wear="${it.id}">Wear</button>`;
      else if (buy) action = `<button class="btn sm ${this.confirm === key ? 'primary' : ''}" data-buy="${key}">${this.confirm === key ? `Confirm ${fmt(price)} FROST` : `Buy · ${fmt(price)}`}</button>`;
      if (this.gifting && !inSet && it.source === 'shop' && account.ready) action += `<button class="btn sm" data-gift="${it.id}" title="Buy it for a friend">Gift</button>`;
    } else if (owned) action = '<span class="owned">Owned ✓</span>';
    return `<div class="shop-card ${it.rarity} ${on ? 'on' : ''}">
      <button class="shop-sw" data-preview="${it.id}" title="Preview on your rider" style="background:${hex(itemColor(it))}"></button>
      <div class="shop-txt"><b>${esc(it.name)}</b><small>${KINDS[it.kind].label} · <span class="rar ${it.rarity}">${it.rarity}</span>${price && !inSet ? ` · ${fmt(price)} FROST` : ''}</small></div>
      <div class="shop-act"><button class="btn sm" data-preview="${it.id}">Preview</button>${action}</div>
    </div>`;
  }

  render() {
    if (!this.isOpen) return;
    const tabs = [
      ['daily', 'Daily'],
      ['sets', 'Limited sets'],
      ['mine', 'Purchases'],
    ];
    $('shop-tabs').innerHTML = tabs.map(([id, label]) => `<button class="${this.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('');
    $('shop-tabs').querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.confirm = null;
        this.giftItem = null;
        this.render();
      })
    );
    this._info();
    const body = $('shop-body');
    $('shop-msg').textContent = this.msg || '';
    const signIn = account.ready ? '' : `<p class="muted">Browse and preview freely. <button class="btn sm" data-a="account">${account.signedIn ? 'Pick a gamertag' : 'Sign in'}</button> to buy with FROST.</p>`;
    if (this.giftItem) {
      $('shop-title').textContent = 'SEND A GIFT';
      body.innerHTML = this._giftView();
    } else if (this.err) {
      $('shop-title').textContent = 'ITEM SHOP';
      body.innerHTML = `<p class="acct-msg bad">${esc(this.err)}</p>`;
    } else if (!this.stock) {
      $('shop-title').textContent = 'ITEM SHOP';
      body.innerHTML = '<p class="muted">Loading…</p>';
    } else if (this.tab === 'daily') {
      $('shop-title').textContent = 'DAILY';
      const items = (this.stock.daily || []).map(itemById).filter(Boolean);
      body.innerHTML = `${signIn}<p class="muted small">Six items, a new six every day at midnight UTC.</p>${items.map((it) => this._card(it, { price: it.price, buy: account.ready })).join('')}`;
    } else if (this.tab === 'sets') {
      $('shop-title').textContent = 'LIMITED SETS';
      const sets = (this.stock.sets || []).map(setById).filter(Boolean);
      const until = this.stock.season_ends_at ? new Date(this.stock.season_ends_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'the end of the season';
      body.innerHTML = `${signIn}<p class="muted small">Whole themed sets, on sale this season only (until ${esc(until)}).</p>${sets
        .map((s) => {
          const ownedAll = s.items.every((it) => economy.owned.has(it.id));
          const key = `set:${s.id}`;
          return `<div class="shop-set"><div class="shop-set-head"><div><b>${esc(s.name)}</b><small class="muted">${esc(s.blurb)}</small></div>
            <div class="shop-act"><button class="btn sm" data-preview-set="${s.id}">Preview set</button>${
              ownedAll ? '<span class="owned">Owned ✓</span>' : account.ready ? `<button class="btn sm ${this.confirm === key ? 'primary' : ''}" data-buy="${key}">${this.confirm === key ? `Confirm ${fmt(s.price)} FROST` : `Buy set · ${fmt(s.price)}`}</button>` : ''
            }</div></div>${s.items.map((it) => this._card(it, { inSet: true })).join('')}</div>`;
        })
        .join('')}`;
    } else {
      $('shop-title').textContent = 'PURCHASES';
      if (!account.ready) body.innerHTML = signIn;
      else {
        const p = this.purchases;
        const rows = (p?.recent || []).map((r) => {
          const name = r.kind === 'set' ? `${setById(r.ref)?.name || r.ref} set` : itemById(r.ref)?.name || r.ref;
          const until = r.returnable_until ? Date.parse(r.returnable_until) - Date.now() : 0;
          const can = !r.returned_at && until > 0 && p.returns_left > 0;
          return `<tr><td><b>${esc(name)}</b><br><small class="muted">${fmt(r.price)} FROST · ${new Date(r.bought_at).toLocaleString()}</small></td><td>${
            r.returned_at ? '<span class="muted">Returned</span>' : can ? `<button class="btn sm" data-return="${r.id}">Return · ${clock(until)} left</button>` : '<span class="muted">Kept</span>'
          }</td></tr>`;
        });
        body.innerHTML = `<p class="muted small">Changed your mind? Return anything within 24 hours for all its FROST back. <b>${p ? p.returns_left : '…'} of 3</b> returns left on this account.</p>${
          rows.length ? `<table class="rlist">${rows.join('')}</table>` : '<p class="muted">Nothing bought in the last week.</p>'
        }`;
      }
    }
    this._wire(body);
  }

  _wire(body) {
    body.querySelector('[data-a="account"]')?.addEventListener('click', () => this.onAccount());
    body.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => this.preview([b.dataset.preview])));
    body.querySelectorAll('[data-preview-set]').forEach((b) => b.addEventListener('click', () => this.preview(setById(b.dataset.previewSet).items.map((it) => it.id))));
    body.querySelectorAll('[data-wear]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = itemById(b.dataset.wear);
        if (!it || !economy.owned.has(it.id)) return;
        this.onSaveLook(wear(this.look(), it));
        this.model.applyLook(this.look());
        this.msg = `Wearing ${it.name}`;
        this.render();
      })
    );
    body.querySelectorAll('[data-gift]').forEach((b) => b.addEventListener('click', () => this._openGift(b.dataset.gift)));
    body.querySelector('[data-a="gift-back"]')?.addEventListener('click', () => {
      this.giftItem = null;
      this.render();
    });
    body.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => this._sendGift(b.dataset.send)));
    body.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => this._buy(b.dataset.buy)));
    body.querySelectorAll('[data-return]').forEach((b) => b.addEventListener('click', () => this._return(Number(b.dataset.return))));
  }

  // ---- gifting: pick a friend for one of today's items
  async _openGift(id) {
    this.giftItem = id;
    this.giftInfo = null;
    this.confirm = null;
    this.msg = '';
    this.preview([id]);
    try {
      this.giftInfo = await gifts.status();
    } catch (e) {
      this.giftInfo = { status: 'error', message: e.message };
    }
    this.render();
  }

  _giftView() {
    const it = itemById(this.giftItem);
    const g = this.giftInfo;
    const head = `<p><b>${esc(it.name)}</b> · ${KINDS[it.kind].label} · ${fmt(it.price)} FROST, from your balance.</p>`;
    const back = '<p><button class="btn sm" data-a="gift-back">← Back to the Shop</button></p>';
    if (!g) return `${head}<p class="muted">Loading…</p>${back}`;
    if (g.status === 'error') return `${head}<p class="acct-msg bad">${esc(g.message)}</p>${back}`;
    if (g.status !== 'ok') return `${head}<p class="acct-msg bad">${esc(GIFT_STATUS[g.status] || 'Gifting is unavailable.')}</p>${back}`;
    const r = g.rules;
    const why = [];
    if (g.account_days < r.account_days) why.push(`your account is ${g.account_days} day${g.account_days === 1 ? '' : 's'} old (needs ${r.account_days})`);
    if (g.runs < r.runs_needed) why.push(`you've finished ${g.runs} of ${r.runs_needed} runs`);
    const rows = (g.friends || []).map((f) => {
      let btn;
      if (!g.can_send || g.gifts_left <= 0) btn = '';
      else if (f.friends_days < r.friend_days) btn = `<span class="muted small">Friends for ${r.friend_days}+ days only</span>`;
      else if (!f.accepts) btn = '<span class="muted small">Gifts turned off</span>';
      else {
        const key = `${f.id}`;
        btn = `<button class="btn sm ${this.confirm === `gift:${key}` ? 'primary' : ''}" data-send="${key}">${this.confirm === `gift:${key}` ? `Confirm · ${fmt(it.price)} FROST` : 'Send'}</button>`;
      }
      return `<tr><td><b>${esc(f.gamertag)}</b><br><small class="muted">friends for ${f.friends_days} day${f.friends_days === 1 ? '' : 's'}</small></td><td>${btn}</td></tr>`;
    });
    return `${head}
      <p class="muted small"><b>${g.gifts_left} of ${r.per_day}</b> gifts left today. Gifts go to friends of ${r.friend_days}+ days, can't be returned, and are only possible once your account is ${r.account_days} days old with ${r.runs_needed} finished runs.</p>
      ${why.length ? `<p class="acct-msg bad">Not yet: ${esc(why.join(' and '))}.</p>` : ''}
      ${rows.length ? `<table class="rlist">${rows.join('')}</table>` : '<p class="muted">Add friends in Friends to send them gifts.</p>'}
      ${back}`;
  }

  async _sendGift(friend) {
    const key = `gift:${friend}`;
    if (this.confirm !== key) {
      this.confirm = key;
      this.render();
      return;
    }
    this.confirm = null;
    const it = itemById(this.giftItem);
    const f = this.giftInfo?.friends?.find((x) => x.id === friend);
    this.msg = 'Sending…';
    this.render();
    try {
      const r = await gifts.send(friend, it.id);
      this.msg = r?.status === 'ok' ? `Sent ${it.name} to ${f?.gamertag || 'your friend'}! ${r.gifts_left} gift${r.gifts_left === 1 ? '' : 's'} left today.` : GIFT_STATUS[r?.status] || 'Something went wrong. Try again.';
      this.giftInfo = await gifts.status().catch(() => this.giftInfo);
    } catch (e) {
      this.msg = e.message;
    }
    this.render();
  }

  async _buy(key) {
    if (this.confirm !== key) {
      this.confirm = key; // first tap asks, second tap buys
      this.render();
      return;
    }
    this.confirm = null;
    const [kind, id] = key.split(':');
    this.msg = 'Buying…';
    this.render();
    try {
      const r = kind === 'set' ? await economy.buySet(id) : await economy.buyItem(id);
      if (r?.status === 'ok') {
        const name = kind === 'set' ? `the ${setById(id).name} set` : itemById(id).name;
        this.msg = `Bought ${name}! It's in your Locker. You can return it within 24 hours.`;
        this.purchases = await economy.myPurchases().catch(() => this.purchases);
      } else this.msg = STATUS[r?.status] || 'Something went wrong. Try again.';
    } catch (e) {
      this.msg = e.message;
    }
    this.render();
  }

  async _return(id) {
    this.msg = 'Returning…';
    this.render();
    try {
      const r = await economy.returnPurchase(id);
      this.msg = r?.status === 'ok' ? `Returned: your FROST is back. ${r.returns_left} return${r.returns_left === 1 ? '' : 's'} left.` : STATUS[r?.status] || 'Something went wrong.';
      this.purchases = await economy.myPurchases().catch(() => this.purchases);
      this.model.applyLook(this.look());
    } catch (e) {
      this.msg = e.message;
    }
    this.render();
  }
}
