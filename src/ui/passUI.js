// The Season Pass: level, XP, the free and premium reward strip (with the next
// unlock picked out), and buying premium with FROST. Also the small Basecamp
// card. The server decides everything; this only shows it.
import { account } from '../online/account.js';
import { economy } from '../online/economy.js';
import { wallet } from '../online/wallet.js';
import { PASS, PASS_REWARDS, itemById, nextReward, passLevel, itemColor, hex, KINDS } from '../economy/catalog.js';
import { esc } from './accountUI.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const daysLeft = (s) => (s ? Math.max(0, Math.ceil((Date.parse(s.ends_at) - Date.now()) / 86400000)) : 0);

// One reward tile.
export function tileHtml(r, { got = false, next = false, locked = false } = {}) {
  if (!r) return '<div class="ptile empty"></div>';
  const cls = `ptile ${got ? 'got' : ''} ${next ? 'next' : ''} ${locked ? 'locked' : ''}`;
  if (r.frost) return `<div class="${cls} frost" title="${r.frost} FROST"><b>${r.frost}</b><small>FROST</small></div>`;
  const it = itemById(r.item);
  if (!it) return '<div class="ptile empty"></div>';
  return `<div class="${cls} ${it.rarity}" title="${esc(it.name)} · ${KINDS[it.kind].label} · ${it.rarity}"><span class="psw" style="background:${hex(itemColor(it))}"></span><small>${esc(it.name)}</small></div>`;
}

// The Basecamp card: level, XP bar and the next unlock on each track.
export function passCardHtml() {
  const p = economy.pass;
  if (!account.ready) return '<h4>SEASON PASS</h4><p class="muted">Sign in to level up the Season Pass by riding.</p><div class="tierbar"><span style="width: 0%"></span></div>';
  if (!p) return '<h4>SEASON PASS</h4><p class="muted">Loading…</p><div class="tierbar"><span style="width: 0%"></span></div>';
  const { level, into, need } = passLevel(p.xp);
  const nf = nextReward(level, 'free');
  const np = nextReward(level, 'premium');
  return `<h4>SEASON PASS · ${esc(p.season?.name || '')}</h4>
    <p><b>Level ${level}</b>${level < PASS.levels ? ` <span class="muted">· ${into}/${need} XP</span>` : ' <span class="muted">· max</span>'}${p.premium ? ' <span class="pprem">PREMIUM</span>' : ''}</p>
    <div class="tierbar"><span style="width: ${level >= PASS.levels ? 100 : Math.round((into / need) * 100)}%"></span></div>
    <div class="pnext">${nf ? `<div><small class="muted">Next free · L${nf.level}</small>${tileHtml(nf, { next: true })}</div>` : ''}${np ? `<div><small class="muted">Next premium · L${np.level}</small>${tileHtml(np, { next: true, locked: !p.premium })}</div>` : ''}</div>`;
}

/** The Pass page. onAccount(): open sign-in. */
export function mountPass(el, { onAccount }) {
  let msg = '';
  let busy = false;
  const render = () => {
    if (!el.isConnected) return off();
    if (!account.ready) {
      el.innerHTML = `<p>Sign in and pick a gamertag to level up the Season Pass. Every run you finish earns XP.</p><p><button class="btn primary" data-a="account">${account.signedIn ? 'Pick a gamertag' : 'Sign in'}</button></p>`;
      el.querySelector('[data-a="account"]').addEventListener('click', onAccount);
      return;
    }
    const p = economy.pass;
    if (!p) {
      el.innerHTML = '<p class="muted">Loading…</p>';
      return;
    }
    const { level, into, need } = passLevel(p.xp);
    const nf = nextReward(level, 'free');
    const np = nextReward(level, 'premium');
    const cols = [];
    for (let L = 1; L <= PASS.levels; L++) {
      const f = PASS_REWARDS.find((r) => r.level === L && r.track === 'free');
      const pr = PASS_REWARDS.find((r) => r.level === L && r.track === 'premium');
      cols.push(`<div class="pcol ${L <= level ? 'reached' : ''} ${L === level + 1 ? 'up' : ''}" data-l="${L}"><span class="plv">${L}</span>${tileHtml(f, { got: L <= level, next: nf && nf.level === L })}${tileHtml(pr, { got: p.premium && L <= level, next: np && np.level === L, locked: !p.premium })}</div>`);
    }
    const days = daysLeft(p.season);
    const keep = el.querySelector('.pstrip')?.scrollLeft;
    el.innerHTML = `
      <div class="pass-head">
        <div><h3>${esc(p.season?.name || 'SEASON')} · LEVEL ${level}</h3>
          <div class="tierbar big"><span style="width: ${level >= PASS.levels ? 100 : Math.round((into / need) * 100)}%"></span></div>
          <p class="muted small">${level < PASS.levels ? `${into}/${need} XP to level ${level + 1}` : 'Level 100: the whole pass is yours'} · ${fmt(p.full_left)} full-rate XP left (rolls over) · ${days} day${days === 1 ? '' : 's'} left in the season</p></div>
        <div class="pass-buy">${
          p.premium
            ? '<span class="pprem big">PREMIUM</span>'
            : `<button class="btn primary" data-a="buy" ${busy ? 'disabled' : ''}>Get premium · ${fmt(PASS.premiumPrice)} FROST</button><small class="muted">Pays back ${fmt(PASS.premiumPrice)} FROST across its levels · you have ${wallet.frost === null ? '—' : fmt(wallet.frost)}</small>`
        }${msg ? `<p class="acct-msg ${/not enough|wrong/i.test(msg) ? 'bad' : 'good'}">${esc(msg)}</p>` : ''}</div>
      </div>
      <div class="pnext row">${nf ? `<div><small class="muted">NEXT FREE UNLOCK · LEVEL ${nf.level}</small>${tileHtml(nf, { next: true })}</div>` : ''}${np ? `<div><small class="muted">NEXT PREMIUM UNLOCK · LEVEL ${np.level}</small>${tileHtml(np, { next: true, locked: !p.premium })}</div>` : ''}</div>
      <div class="pstrip-wrap"><div class="plabels"><span></span><span>FREE</span><span>PREMIUM</span></div><div class="pstrip">${cols.join('')}</div></div>
      <p class="muted small">Every run you finish: ${PASS.xpPerRun} XP + 1 per ${fmt(PASS.pointsPerXp)} points. Full XP for ${PASS.fullLevelsPerDay} levels (${fmt(PASS.fullLevelsPerDay * PASS.xpPerLevel)} XP) a day, and days you miss roll over; after that, runs give 1/${PASS.reducedDivisor} XP. Rewards unlock as soon as you reach their level. A new season starts the pass again; you keep your items.</p>`;
    el.querySelector('[data-a="buy"]')?.addEventListener('click', async () => {
      busy = true;
      msg = '';
      render();
      try {
        const r = await economy.buyPremium();
        msg = r?.status === 'ok' ? 'Premium unlocked! Rewards for the levels you have reached are yours.' : r?.status === 'not_enough_frost' ? `Not enough FROST yet: premium costs ${fmt(PASS.premiumPrice)}.` : r?.status === 'owned' ? 'You already have premium.' : 'Something went wrong. Try again.';
      } catch (e) {
        msg = e.message;
      }
      busy = false;
      render();
    });
    // Show the current level in the strip (and keep the place when it redraws).
    const strip = el.querySelector('.pstrip');
    const cur = el.querySelector(`.pcol[data-l="${Math.max(1, level)}"]`);
    if (keep !== undefined) strip.scrollLeft = keep;
    else if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - strip.clientWidth / 3);
  };
  const offE = economy.onChange(render);
  const offW = wallet.onChange(render);
  const off = () => {
    offE();
    offW();
  };
  render();
  economy.refresh();
}
