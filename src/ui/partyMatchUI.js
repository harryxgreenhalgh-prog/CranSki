// The party leader's setup for a private match or the CRANSKI CUP: type,
// teams (2v2 or free-for-all), map(s), runs and scoring, then START.
import { MATCH_PARKS, RUN_CHOICES, CUP_MAX_MAPS, cleanConfig, cleanRoster, describe } from '../online/partyMatch.js';
import { esc } from './accountUI.js';

const NAMES = { apex: 'APEX', bigair: 'BIG AIR', yard: 'THE YARD', forest: 'FOREST LINE', pipe: 'ASPEN PIPE', bellevue: 'BELLEVUE' };
// Remembered between openings.
const ui = { kind: 'match', teams: 'ffa', park: 'apex', runs: 3, scoring: 'best', cupScoring: 'total', maps: ['apex', 'yard', 'bigair'], teamOf: {} };

/**
 * state(): { signedIn, inParty, leader, members: [{ id, gamertag, online }], meId, busy }
 * onStart(cfg, roster), onFriends()
 */
export function mountPartyMatch(el, { state, onStart, onFriends }) {
  let last = '';
  const render = (force = true) => {
    const s = state();
    const next = html(s);
    // The timer only redraws when something changed, so it never swallows a click.
    if (!force && next === last) return;
    last = next;
    el.innerHTML = next;
    const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach((b) => b.addEventListener(ev, fn));
    on('[data-a="friends"]', 'click', onFriends);
    on('[data-kind]', 'click', (e) => {
      ui.kind = e.currentTarget.dataset.kind;
      render();
    });
    on('[data-teams]', 'click', (e) => {
      ui.teams = e.currentTarget.dataset.teams;
      render();
    });
    on('[data-runs]', 'click', (e) => {
      ui.runs = Number(e.currentTarget.dataset.runs);
      render();
    });
    on('[data-scoring]', 'click', (e) => {
      if (ui.kind === 'cup') ui.cupScoring = e.currentTarget.dataset.scoring;
      else ui.scoring = e.currentTarget.dataset.scoring;
      render();
    });
    on('[name="park"]', 'change', (e) => (ui.park = e.target.value));
    on('[data-map]', 'change', (e) => {
      const i = Number(e.target.dataset.map);
      const maps = ui.maps.slice();
      maps[i] = e.target.value;
      ui.maps = maps.filter(Boolean);
      render();
    });
    on('[data-team-of]', 'click', (e) => {
      const id = e.currentTarget.dataset.teamOf;
      ui.teamOf[id] = ui.teamOf[id] === 1 ? 0 : 1;
      render();
    });
    on('[data-a="start"]', 'click', () => {
      const { cfg, roster, err } = build(state());
      if (err) return;
      onStart(cfg, roster);
    });
  };
  render();
  const timer = setInterval(() => (el.isConnected ? render(false) : clearInterval(timer)), 3000);
}

// Members in order (leader first), with teams for 2v2: alternate unless swapped.
function members(s) {
  const list = [...s.members].sort((a, b) => (a.id === s.meId ? -1 : b.id === s.meId ? 1 : 0));
  list.forEach((m, i) => {
    if (ui.teamOf[m.id] === undefined) ui.teamOf[m.id] = i % 2;
  });
  return list;
}

function build(s) {
  const list = members(s);
  const cfg = cleanConfig(
    ui.kind === 'cup'
      ? { kind: 'cup', teams: ui.teams, maps: ui.maps, scoring: ui.cupScoring }
      : { kind: 'match', teams: ui.teams, maps: [ui.park], runs: ui.runs, scoring: ui.scoring }
  );
  if (list.length < 3) return { err: 'Party matches are for parties of 3 or 4. Invite more friends in Friends.' };
  const offline = list.filter((m) => !m.online && m.id !== s.meId);
  if (offline.length) return { err: `${offline.map((m) => m.gamertag).join(', ')} ${offline.length === 1 ? 'is' : 'are'} offline.` };
  if (ui.teams === '2v2' && list.length !== 4) return { err: '2v2 needs exactly 4 riders. Pick free-for-all for 3.' };
  const roster = cleanRoster(
    list.map((m) => ({ uid: m.id, tag: m.gamertag, team: ui.teamOf[m.id] })),
    ui.teams
  );
  if (!roster) return { err: 'Put two riders on each team.' };
  if (!cfg) return { err: 'Pick at least one map.' };
  return { cfg, roster };
}

const seg = (attr, items, cur) => `<nav class="seg">${items.map(([v, label]) => `<button class="${String(v) === String(cur) ? 'on' : ''}" data-${attr}="${v}">${label}</button>`).join('')}</nav>`;
const parkSelect = (name, cur, attrs = '', none = false) =>
  `<select ${name ? `name="${name}"` : ''} ${attrs}>${none ? `<option value="">—</option>` : ''}${MATCH_PARKS.map((p) => `<option value="${p}"${p === cur ? ' selected' : ''}>${NAMES[p]}</option>`).join('')}</select>`;

function html(s) {
  if (!s.signedIn) return '<p>Party matches need an account and a gamertag.</p>';
  if (!s.inParty)
    return `<p>Start a party with 2 or 3 friends, then the leader sets up a private 2v2 or free-for-all, or a CRANSKI CUP over up to 5 maps.</p><p><button class="btn primary" data-a="friends">Open Friends</button></p>`;
  if (!s.leader) return `<p>Your party leader sets up party matches. You'll get a JOIN prompt when they start one.</p>`;
  const list = members(s);
  const scoring = ui.kind === 'cup' ? ui.cupScoring : ui.scoring;
  const teamRows =
    ui.teams === '2v2'
      ? `<div class="pm-teams">${[0, 1]
          .map(
            (t) =>
              `<div><h4>TEAM ${t ? 'B' : 'A'}</h4>${list
                .filter((m) => ui.teamOf[m.id] === t)
                .map((m) => `<button class="btn sm" data-team-of="${m.id}" title="Swap team">${esc(m.gamertag)} ⇄</button>`)
                .join('')}</div>`
          )
          .join('')}</div>`
      : '';
  const where =
    ui.kind === 'cup'
      ? `<div class="pm-maps">${Array.from({ length: Math.min(CUP_MAX_MAPS, ui.maps.length + 1) }, (_, i) => `<label>Map ${i + 1} ${parkSelect('', ui.maps[i] || '', `data-map="${i}"`, i > 0)}</label>`).join('')}</div>`
      : `<p class="acct-row"><label>Map ${parkSelect('park', ui.park)}</label></p>${seg('runs', RUN_CHOICES.map((n) => [n, `${n} ${n === 1 ? 'RUN' : 'RUNS'} EACH`]), ui.runs)}`;
  const { cfg, err } = build(s);
  return `
    ${seg('kind', [['match', 'PRIVATE MATCH'], ['cup', 'CRANSKI CUP']], ui.kind)}
    <p class="muted small">${ui.kind === 'cup' ? 'Up to 5 maps. On each map everyone drops in together and sees each other ride.' : 'Riders take turns while everyone else watches.'}</p>
    ${seg('teams', [['ffa', 'FREE-FOR-ALL'], ['2v2', '2V2']], ui.teams)}
    ${teamRows}
    ${where}
    ${seg('scoring', ui.kind === 'cup' ? [['total', 'TOTAL SCORE'], ['rounds', 'ROUND WINS']] : [['best', 'BEST RUN'], ['rounds', 'ROUND WINS']], scoring)}
    <p class="muted small">${scoring === 'rounds' ? `Each ${ui.kind === 'cup' ? 'map' : 'round of runs'} goes to the top ${ui.teams === '2v2' ? 'team' : 'rider'}; most rounds wins, ties broken on total points.` : scoring === 'best' ? `Each rider's best run counts${ui.teams === '2v2' ? ', added up per team' : ''}.` : `Every run counts${ui.teams === '2v2' ? ', added up per team' : ''}.`}</p>
    <p class="acct-row"><button class="btn primary" data-a="start" ${err || s.busy ? 'disabled' : ''}>START</button>${err ? `<span class="acct-msg bad">${esc(err)}</span>` : `<span class="muted small">${esc(describe(cfg))}</span>`}</p>
    <p class="muted small">Everyone gets a JOIN prompt. Party matches are just for fun: the result doesn't change any rating.</p>`;
}
