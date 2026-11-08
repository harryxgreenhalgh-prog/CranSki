// The Leaderboard panel: one board per park, top 50 or you and your friends.
import { account } from '../online/account.js';
import { BOARD_PARKS, fetchBoard, fetchMine } from '../online/leaderboard.js';
import { parkMeta } from '../parks/index.js';
import { esc } from './accountUI.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ui = { park: 'bigair', scope: 'top' };

export function mountBoard(el, { park, onAccount }) {
  if (park && BOARD_PARKS.includes(park)) ui.park = park;
  if (ui.scope === 'friends' && !account.ready) ui.scope = 'top';
  let ticket = 0;
  const load = async () => {
    const my = ++ticket;
    render({ loading: true });
    try {
      const [rows, mine] = await Promise.all([fetchBoard(ui.park, ui.scope), fetchMine(ui.park).catch(() => null)]);
      if (my === ticket && el.isConnected) render({ rows, mine });
    } catch (e) {
      if (my === ticket && el.isConnected) render({ error: e.message });
    }
  };
  const render = (st) => {
    el.innerHTML = html(st);
    el.querySelectorAll('[data-park]').forEach((b) =>
      b.addEventListener('click', () => {
        ui.park = b.dataset.park;
        load();
      })
    );
    el.querySelectorAll('[data-scope]').forEach((b) =>
      b.addEventListener('click', () => {
        ui.scope = b.dataset.scope;
        load();
      })
    );
    el.querySelector('[data-a="account"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      onAccount();
    });
  };
  load();
}

function html({ loading, rows, mine, error }) {
  const me = account.user?.id;
  const parks = BOARD_PARKS.map((id) => `<button class="${id === ui.park ? 'on' : ''}" data-park="${id}">${esc(parkMeta(id).name)}</button>`).join('');
  const scopes = `<button class="${ui.scope === 'top' ? 'on' : ''}" data-scope="top">Top 50</button>${
    account.ready ? `<button class="${ui.scope === 'friends' ? 'on' : ''}" data-scope="friends">Friends</button>` : ''
  }`;
  let body;
  if (loading) body = '<p class="muted">Loading…</p>';
  else if (error) body = `<p class="acct-msg bad">${esc(error)}</p>`;
  else if (!rows.length)
    body = `<p class="muted">${ui.scope === 'friends' ? 'You and your friends have no runs on this board yet.' : 'No runs posted yet. Be the first!'}</p>`;
  else
    body = `<table class="board"><thead><tr><th>#</th><th>Rider</th><th>Score</th><th class="hide-narrow">Best trick</th><th class="hide-narrow">When</th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr class="${r.user_id === me ? 'me' : ''}"><td>${r.rank}</td><td><b>${esc(r.gamertag)}</b></td><td>${fmt(r.total)}</td><td class="hide-narrow muted">${esc(r.best_trick || '—')}</td><td class="hide-narrow muted">${new Date(r.achieved_at).toLocaleDateString()}</td></tr>`
      )
      .join('')}</tbody></table>`;
  const inList = rows && rows.some((r) => r.user_id === me);
  const mineLine = mine && !inList && !loading ? `<p class="board-me">You: <b>#${mine.rank}</b> · ${fmt(mine.total)}</p>` : '';
  const signIn = account.ready
    ? ''
    : `<p class="muted small">${account.signedIn ? 'Pick a gamertag' : '<a href="#" data-a="account">Sign in</a>'} to post your runs. Signed in, every run you finish on these parks is checked and posted automatically.</p>`;
  return `
    <nav class="seg">${parks}</nav>
    <nav class="seg small">${scopes}</nav>
    ${body}
    ${mineLine}
    ${signIn}
    <p class="muted small">Every score here was re-ridden by the server from the run's recorded inputs and only counted because it came out the same. SHIRAKUMO is for ghosts only and has no board.</p>`;
}
