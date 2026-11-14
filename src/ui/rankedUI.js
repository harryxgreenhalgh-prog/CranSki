// The Ranked panel: your rating, tier and placement progress, FIND MATCH, any
// leave cooldown, and the top 25. The server does the matching.
import { account } from '../online/account.js';
import { ranked, PLACEMENTS } from '../online/ranked.js';
import { esc } from './accountUI.js';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ui = { mode: '1v1', partner: '' };

export const MODE_INFO = {
  '1v1': 'APEX · 2 runs each, taking turns · best run wins · leaving costs a 1, 5, then 15 minute cooldown',
  '2v2': 'APEX · one run each · best team total wins · teammates within 500 rating · leaving counts as a loss plus a 5, 15, then 30 minute break',
};

/**
 * queue(): { mode, waited } while searching, else null.
 * onFind(mode, partner), onCancel(), onAccount(), partnerOptions(): [{ id, gamertag }] (2v2 pairs)
 */
export function mountRanked(el, { queue, onFind, onCancel, onAccount, partnerOptions = () => [] }) {
  let me = null;
  let board = [];
  let err = null;
  let timer = 0;
  const load = async () => {
    try {
      [me, board] = await Promise.all([ranked.me(), ranked.board(ui.mode)]);
      err = null;
    } catch (e) {
      err = e.message;
    }
    render();
  };
  const render = () => {
    if (!el.isConnected) {
      clearInterval(timer);
      return;
    }
    el.innerHTML = html(me, board, err, queue(), partnerOptions());
    el.querySelectorAll('[data-rmode]').forEach((b) =>
      b.addEventListener('click', () => {
        ui.mode = b.dataset.rmode;
        load();
      })
    );
    el.querySelector('[data-a="account"]')?.addEventListener('click', onAccount);
    el.querySelector('[name="partner"]')?.addEventListener('change', (e) => (ui.partner = e.target.value));
    el.querySelector('[data-a="find"]')?.addEventListener('click', () => {
      const partner = el.querySelector('[name="partner"]')?.value || null;
      onFind(ui.mode, partner);
      setTimeout(load, 600);
    });
    el.querySelector('[data-a="cancel"]')?.addEventListener('click', () => {
      onCancel();
      setTimeout(load, 300);
    });
  };
  if (!account.ready) {
    el.innerHTML = `<p>Ranked needs an account and a gamertag.</p><p><button class="btn primary" data-a="account">${account.signedIn ? 'Pick a gamertag' : 'Sign in'}</button></p>`;
    el.querySelector('[data-a="account"]').addEventListener('click', onAccount);
    return;
  }
  render();
  load();
  timer = setInterval(render, 1000);
}

function html(me, board, err, q, partners) {
  const r = me?.ratings?.[ui.mode];
  const penalty = me?.penalties?.[ui.mode] ? Math.max(0, (Date.parse(me.penalties[ui.mode]) - Date.now()) / 1000) : 0;
  const tabs = `<nav class="seg">${['1v1', '2v2'].map((m) => `<button class="${m === ui.mode ? 'on' : ''}" data-rmode="${m}">RANKED ${m.toUpperCase()}</button>`).join('')}</nav>`;
  let mine = '<p class="muted">Loading…</p>';
  if (err) mine = `<p class="acct-msg bad">${esc(err)}</p>`;
  else if (r)
    mine =
      r.placements < PLACEMENTS
        ? `<div class="rk-me"><span class="rk-tier unranked">PLACEMENTS</span><b>${r.placements}/${PLACEMENTS}</b><span class="muted">Play ${PLACEMENTS - r.placements} more to get your tier</span></div>`
        : `<div class="rk-me"><span class="rk-tier ${r.tier.toLowerCase()}">${r.tier.toUpperCase()}</span><b>${r.rating}</b><span class="muted">${r.wins} W · ${r.losses} L${r.draws ? ` · ${r.draws} D` : ''}</span></div>`;
  let action;
  if (q && q.mode === ui.mode)
    action = `<p class="acct-row"><span class="rk-search">${q.partnerTag && !q.partnerReady ? `Waiting for ${esc(q.partnerTag)} to queue with you…` : 'Searching…'} ${fmtTime(q.waited || 0)}</span><button class="btn" data-a="cancel">Cancel</button></p>`;
  else if (q) action = `<p class="muted">You're searching for ranked ${q.mode} right now.</p>`;
  else if (penalty > 0) action = `<p class="acct-msg bad">You left a ranked match. You can queue again in ${fmtTime(penalty)}.</p>`;
  else {
    if (!partners.some((p) => p.id === ui.partner)) ui.partner = '';
    action = `<p class="acct-row">${
      ui.mode === '2v2' && partners.length
        ? `<select name="partner" aria-label="Partner"><option value="">Queue solo</option>${partners.map((p) => `<option value="${p.id}"${p.id === ui.partner ? ' selected' : ''}>With ${esc(p.gamertag)}</option>`).join('')}</select>`
        : ''
    }<button class="btn primary" data-a="find">FIND MATCH</button></p>${
      ui.mode === '2v2' ? `<p class="muted small">${partners.length ? 'Pick a party member to queue as a pair. They get a prompt to join you.' : 'Queue solo and get a teammate near your rating, or start a party with a friend to queue as a pair.'}</p>` : ''
    }`;
  }
  const rows = board?.length
    ? `<table class="board"><thead><tr><th>#</th><th>Rider</th><th>Rating</th><th>Tier</th><th class="hide-narrow">W-L</th></tr></thead><tbody>${board
        .map((b) => `<tr class="${b.user_id === account.user?.id ? 'me' : ''}"><td>${b.rank}</td><td><b>${esc(b.gamertag)}</b></td><td>${b.rating}</td><td><span class="rk-tier ${b.tier.toLowerCase()}">${b.tier}</span></td><td class="hide-narrow muted">${b.wins}-${b.losses}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Nobody has finished their placement matches yet.</p>';
  return `${tabs}<p class="muted small">${MODE_INFO[ui.mode]}</p>${mine}${action}<h3>TOP 25</h3>${rows}
    <p class="muted small">Tiers after ${PLACEMENTS} placement matches: Bronze, Silver (1050), Gold (1200), Platinum (1350), Diamond (1500). Your opponent is revealed when the match starts. If they don't show within 45 seconds you go straight back to the front of the queue.</p>`;
}
