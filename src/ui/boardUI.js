// The Leaderboard panel: this season's board for each park, top 50 or you and
// your friends. THE YARD, APEX and BIG AIR are prize boards; #1 wears the crown.
// Also last season's winners.
import { account } from '../online/account.js';
import { BOARD_PARKS, fetchBoard, fetchMine } from '../online/leaderboard.js';
import { parkMeta } from '../parks/index.js';
import { esc } from './accountUI.js';
import { seasons } from '../online/seasons.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ui = { park: 'bigair', scope: 'top' };
const PRIZE_PARKS = ['yard', 'apex', 'bigair'];

export function mountBoard(el, { park, onAccount }) {
  if (park && BOARD_PARKS.includes(park)) ui.park = park;
  if (ui.scope === 'friends' && !account.ready) ui.scope = 'top';
  let ticket = 0;
  const load = async () => {
    const my = ++ticket;
    if (ui.scope === 'hall') return render({ rows: [] }); // last season: already in seasons.info
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
        if (ui.scope === 'hall') render({ rows: [] });
        else load();
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
  }${seasons.info?.last ? `<button class="${ui.scope === 'hall' ? 'on' : ''}" data-scope="hall">Last season</button>` : ''}`;
  const info = seasons.info?.season ? seasons.info : null;
  const days = info ? Math.max(0, Math.ceil((Date.parse(info.season.ends_at) - Date.now()) / 86400000)) : null;
  const prizes = info?.rules?.prizes || [2500, 1500, 750, 250];
  const head = info
    ? `<div class="season-head"><b>${esc(info.season.name)}</b><span class="muted small">${days} day${days === 1 ? '' : 's'} left · boards reset when the season ends</span></div>`
    : '';
  const prizeLine = PRIZE_PARKS.includes(ui.park)
    ? `<div class="prizeboard">🏆 <b>Prize board</b>: at the end of the season, the top 10 win ${fmt(prizes[0])} / ${fmt(prizes[1])} / ${fmt(prizes[2])} FROST, then ${fmt(prizes[3])} for 4th–10th. To win, your account must be ${info?.rules?.account_days ?? 7}+ days old with ${info?.rules?.runs_needed ?? 20}+ finished runs.</div>`
    : '';
  let body;
  if (ui.scope === 'hall') {
    const last = info?.last;
    const rows = (last?.podiums || []).filter((r) => r.park === ui.park);
    body = rows.length
      ? `<p class="muted small">${esc(last.name)} · ${esc(parkMeta(ui.park).name)}</p><table class="board hall"><tbody>${rows
          .map((r) => `<tr><td>${r.rank === 1 ? '👑 ' : ''}${r.rank}</td><td><b>${esc(r.gamertag)}</b></td><td>${fmt(r.total)}</td><td class="muted">${r.prize ? `+${fmt(r.prize)} FROST` : ''}</td></tr>`)
          .join('')}</tbody></table>`
      : `<p class="muted">Nobody finished on ${esc(parkMeta(ui.park).name)} last season.</p>`;
    return `<nav class="seg">${parks}</nav><nav class="seg small">${scopes}</nav>${head}${body}`;
  }
  if (loading) body = '<p class="muted">Loading…</p>';
  else if (error) body = `<p class="acct-msg bad">${esc(error)}</p>`;
  else if (!rows.length)
    body = `<p class="muted">${ui.scope === 'friends' ? 'You and your friends have no runs on this board yet.' : 'No runs posted yet. Be the first!'}</p>`;
  else
    body = `<table class="board"><thead><tr><th>#</th><th>Rider</th><th>Score</th><th class="hide-narrow">Best trick</th><th class="hide-narrow">When</th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr class="${r.user_id === me ? 'me' : ''}"><td>${r.rank}</td><td>${Number(r.rank) === 1 ? '<span title="Season leader">👑</span> ' : ''}<b>${esc(r.gamertag)}</b></td><td>${fmt(r.total)}</td><td class="hide-narrow muted">${esc(r.best_trick || '—')}</td><td class="hide-narrow muted">${new Date(r.achieved_at).toLocaleDateString()}</td></tr>`
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
    ${head}${prizeLine}
    ${body}
    ${mineLine}
    ${signIn}
    <p class="muted small">Every score here was re-ridden by the server from the run's recorded inputs and only counted because it came out the same. Beat a board's season best and everyone online sees RECORD; the leader wears a crown. SHIRAKUMO is for ghosts only and has no board.</p>`;
}
