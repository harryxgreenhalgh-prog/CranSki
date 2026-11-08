// The Friends panel: find riders by gamertag, answer requests, see who's online.
import { account } from '../online/account.js';
import { friends, onFriends, refreshFriends, searchRiders, sendRequest, respond, removeFriend, appearOffline, setAppearOffline } from '../online/friends.js';
import { parkMeta } from '../parks/index.js';
import { tidyTag } from '../online/names.js';
import { esc } from './accountUI.js';
import { party, PARTY_MAX } from '../online/party.js';
import { PARKS } from '../parks/index.js';

export function whereText(f) {
  if (!f.online) return 'Offline';
  const park = f.park ? parkMeta(f.park)?.name : null;
  if (f.location === 'riding') return park ? `Riding ${park}` : 'Riding';
  if (f.location === 'lift') return park ? `On the lift at ${park}` : 'On a lift';
  if (f.location === 'replay') return 'Watching a replay';
  return 'In Basecamp';
}

const ui = { q: '', results: null, searching: false, msg: null, confirm: null };

export function mountFriends(el, { onAccount, onPartyGo }) {
  ui.q = '';
  ui.results = null;
  ui.msg = null;
  ui.confirm = null;
  let off = null;
  let offAcct = null;
  let poll = 0;
  const render = () => {
    if (!el.isConnected) {
      off?.();
      offAcct?.();
      clearTimeout(poll);
      return;
    }
    el.innerHTML = html();
    wire(el, render, onAccount, onPartyGo);
  };
  off = onFriends(render);
  offAcct = account.onChange(render);
  const offParty = party.onChange(() => (el.isConnected ? render() : offParty()));
  render();
  // Faster updates while the panel is open.
  const tick = () => {
    if (!el.isConnected) return;
    refreshFriends();
    party.refresh();
    poll = setTimeout(tick, 20000);
  };
  tick();
}

function relationButton(r) {
  if (r.relation === 'friend') return '<span class="muted">Friends</span>';
  if (r.relation === 'outgoing') return '<span class="muted">Requested</span>';
  if (r.relation === 'incoming') return `<button class="btn sm primary" data-accept="${r.id}">Accept</button>`;
  return `<button class="btn sm" data-add="${r.id}">Add friend</button>`;
}

function html() {
  if (!account.signedIn)
    return `<p>Sign in to add friends, see who's online and where they're riding.</p><p><button class="btn primary" data-a="account">Sign in</button></p><p class="muted small">Solo play never needs an account.</p>`;
  if (!account.ready) return `<p>Pick a gamertag first: it's the name friends search for.</p><p><button class="btn primary" data-a="account">Pick a gamertag</button></p>`;

  const list = friends.list;
  const mine = list.filter((f) => f.relation === 'friend');
  const incoming = list.filter((f) => f.relation === 'incoming');
  const outgoing = list.filter((f) => f.relation === 'outgoing');
  const msg = ui.msg ? `<p class="acct-msg ${ui.msg.bad ? 'bad' : 'good'}">${esc(ui.msg.text)}</p>` : '';

  let results = '';
  if (ui.searching) results = '<p class="muted">Searching…</p>';
  else if (ui.results && !ui.results.length) results = '<p class="muted">No riders with a gamertag starting like that.</p>';
  else if (ui.results)
    results = `<ul class="flist">${ui.results.map((r) => `<li><span class="fname">${esc(r.gamertag)}</span>${relationButton(r)}</li>`).join('')}</ul>`;

  const canInvite = party.info && !party.full;
  const row = (f) => {
    const removing = ui.confirm === f.id;
    const invite = canInvite && !party.has(f.id) ? `<button class="btn sm" data-pinvite="${f.id}">Invite</button>` : '';
    return `<li><span class="fdot ${f.online ? 'on' : ''}"></span><span class="fname">${esc(f.gamertag)}</span><span class="fwhere muted">${esc(whereText(f))}</span>${invite}${
      removing
        ? `<button class="btn sm" data-unfriend="${f.id}">Remove ${esc(f.gamertag)}?</button><button class="btn sm" data-a="keep">Keep</button>`
        : `<button class="btn sm ghost" data-confirm="${f.id}" title="Remove friend">✕</button>`
    }</li>`;
  };

  return `
    <form class="acct-form" data-a="search" role="search">
      <input type="search" name="q" value="${esc(ui.q)}" placeholder="Find a rider by gamertag" autocomplete="off" spellcheck="false" aria-label="Find a rider by gamertag" />
      <button class="btn" type="submit">Search</button>
    </form>
    ${results}
    ${msg}
    ${partyHtml()}
    ${
      incoming.length
        ? `<h3>REQUESTS</h3><ul class="flist">${incoming
            .map((f) => `<li><span class="fname">${esc(f.gamertag)}</span><span class="fwhere muted">wants to be friends</span><button class="btn sm primary" data-accept="${f.id}">Accept</button><button class="btn sm" data-decline="${f.id}">Decline</button></li>`)
            .join('')}</ul>`
        : ''
    }
    <h3>FRIENDS ${mine.length ? `· ${mine.filter((f) => f.online).length} ONLINE` : ''}</h3>
    ${
      mine.length
        ? `<ul class="flist">${mine.map(row).join('')}</ul>`
        : `<p class="muted">${friends.loaded ? 'No friends yet. Search for a gamertag above to send a request.' : friends.error ? esc(friends.error) : 'Loading…'}</p>`
    }
    ${
      outgoing.length
        ? `<h3>SENT</h3><ul class="flist">${outgoing.map((f) => `<li><span class="fname">${esc(f.gamertag)}</span><span class="fwhere muted">waiting for them to accept</span><button class="btn sm" data-cancel="${f.id}">Cancel</button></li>`).join('')}</ul>`
        : ''
    }
    <label class="fcheck"><input type="checkbox" data-a="offline" ${appearOffline() ? 'checked' : ''}/> Appear offline</label>
    <p class="muted small">Friends see that you're online and where you're riding only after you've both accepted. Riders who aren't your friends only ever see your gamertag.</p>`;
}

const PARTY_WHERE = { basecamp: 'In Basecamp', lift: 'On a lift', riding: 'Riding', paused: 'Paused', results: 'Just finished', replay: 'Watching a replay', duel: 'In a duel' };

function partyHtml() {
  const p = party;
  if (!p.info) {
    const inv = p.invites.length
      ? `<ul class="flist">${p.invites
          .map((i) => `<li><span class="fname">${esc(i.leader)}'s party</span><span class="fwhere muted">invited by ${esc(i.inviter)} · ${i.members}/${PARTY_MAX}</span><button class="btn sm primary" data-pjoin="${i.party}">Join</button><button class="btn sm" data-pdecline="${i.party}">Decline</button></li>`)
          .join('')}</ul>`
      : '';
    return `<h3>PARTY</h3>${inv}<p class="muted">Ride together with up to ${PARTY_MAX - 1} friends: the leader picks the park and everyone gets a GO / STAY prompt.</p><p><button class="btn" data-a="party-create">Start a party</button></p>${p.error ? `<p class="acct-msg bad">${esc(p.error)}</p>` : ''}`;
  }
  const lead = p.isLeader;
  const park = p.info.park ? PARKS.find((x) => x.id === p.info.park)?.name : null;
  const members = p.members
    .map(
      (m) =>
        `<li><span class="fdot ${m.online ? 'on' : ''}"></span><span class="fname">${m.leader ? '👑 ' : ''}${esc(m.gamertag)}</span><span class="fwhere muted">${m.online ? PARTY_WHERE[m.where] || 'Online' : 'Offline'}${m.online && m.park ? ` · ${esc(PARKS.find((x) => x.id === m.park)?.name || '')}` : ''}</span>${
          lead && !m.leader ? `<button class="btn sm" data-premove="${m.id}" title="Remove for 10 minutes">Remove</button>` : ''
        }</li>`
    )
    .join('');
  const controls = lead
    ? `<div class="party-ctl">
        <label>Park <select data-a="party-park">${PARKS.map((x) => `<option value="${x.id}" ${x.id === p.info.park ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="fcheck"><input type="checkbox" data-a="party-private" ${p.info.private_room ? 'checked' : ''}/> Private room (party only)</label>
        <button class="btn primary" data-a="party-go">GO${park ? ` to ${esc(park)}` : ''}</button>
      </div>`
    : `<p class="muted">${park ? `The leader picked ${esc(park)}${p.info.private_room ? ' (private room)' : ''}.` : 'The leader picks the park.'} You'll get a GO / STAY prompt when they head off.</p>`;
  return `<h3>PARTY · ${p.info.members.length}/${PARTY_MAX}</h3><ul class="flist">${members}</ul>${controls}<p class="acct-row"><button class="btn sm" data-a="party-leave">Leave party</button></p>${
    p.full ? '' : '<p class="muted small">Invite friends from your list below.</p>'
  }`;
}

function wire(el, render, onAccount, onPartyGo) {
  const all = (sel, fn) => el.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => fn(b)));
  const act = async (job, okText) => {
    ui.msg = null;
    try {
      const r = await job();
      ui.msg = okText ? { text: okText(r) } : null;
    } catch (e) {
      ui.msg = { text: e.message, bad: true };
    }
    render();
  };
  all('[data-a="account"]', () => onAccount());
  const form = el.querySelector('[data-a="search"]');
  if (form) {
    const input = form.q;
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      const t = tidyTag(input.value);
      if (t !== input.value) input.value = t;
      ui.q = t;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ui.q = input.value.trim();
      if (ui.q.replace(/[ -]/g, '').length < 2) {
        ui.msg = { text: 'Type at least 2 letters of a gamertag.', bad: true };
        render();
        return;
      }
      ui.searching = true;
      ui.msg = null;
      render();
      try {
        ui.results = await searchRiders(ui.q);
      } catch (err) {
        ui.results = null;
        ui.msg = { text: err.message, bad: true };
      }
      ui.searching = false;
      render();
      el.querySelector('input[name="q"]')?.focus();
    });
  }
  const updateResult = (id, relation) => {
    const r = ui.results?.find((x) => x.id === id);
    if (r) r.relation = relation;
  };
  const SENT = {
    requested: 'Request sent.',
    accepted: "You're now friends.",
    friends: 'Already friends.',
    too_many: 'Too many pending requests or friends.',
    unknown: 'That rider no longer exists.',
    no_gamertag: 'Pick a gamertag first.',
    self: "That's you!",
  };
  all('[data-add]', (b) =>
    act(async () => {
      const r = await sendRequest(b.dataset.add);
      updateResult(b.dataset.add, r === 'accepted' || r === 'friends' ? 'friend' : r === 'requested' ? 'outgoing' : 'none');
      return r;
    }, (r) => SENT[r] || r)
  );
  all('[data-accept]', (b) =>
    act(async () => {
      const r = await respond(b.dataset.accept, true);
      updateResult(b.dataset.accept, 'friend');
      return r;
    }, (r) => (r === 'friends' ? "You're now friends." : 'That request was withdrawn.'))
  );
  all('[data-decline]', (b) => act(() => respond(b.dataset.decline, false)));
  all('[data-cancel]', (b) => act(() => removeFriend(b.dataset.cancel)));
  all('[data-confirm]', (b) => {
    ui.confirm = b.dataset.confirm;
    render();
  });
  all('[data-a="keep"]', () => {
    ui.confirm = null;
    render();
  });
  all('[data-unfriend]', (b) => {
    ui.confirm = null;
    act(() => removeFriend(b.dataset.unfriend));
  });
  // Party
  const pact = async (job, okText) => {
    ui.msg = null;
    try {
      const r = await job();
      if (okText) ui.msg = { text: okText(r), bad: r && !['invited', 'joined', 'removed', 'ok', undefined, null].includes(r) };
    } catch (e) {
      ui.msg = { text: e.message, bad: true };
    }
    render();
  };
  const PARTY_MSG = {
    invited: 'Invite sent.',
    not_friends: 'You can only invite riders who are your friends.',
    full: 'The party is full.',
    already: 'Already in the party.',
    joined: "You're in the party.",
    not_invited: 'That invite has gone.',
    removed: 'Removed for 10 minutes.',
    gone: 'That party has ended.',
    not_leader: 'Only the leader can do that.',
  };
  el.querySelector('[data-a="party-create"]')?.addEventListener('click', () => pact(() => party.create()));
  all('[data-pinvite]', (b) => pact(() => party.invite(b.dataset.pinvite), (r) => PARTY_MSG[r] || r));
  all('[data-pjoin]', (b) => pact(() => party.join(b.dataset.pjoin), (r) => (r === 'removed' ? "The leader removed you; you can rejoin in 10 minutes." : PARTY_MSG[r] || r)));
  all('[data-pdecline]', (b) => pact(() => party.decline(b.dataset.pdecline)));
  all('[data-premove]', (b) => pact(() => party.remove(b.dataset.premove), (r) => PARTY_MSG[r] || r));
  el.querySelector('[data-a="party-leave"]')?.addEventListener('click', () => pact(() => party.leave()));
  el.querySelector('[data-a="party-park"]')?.addEventListener('change', (e) => pact(() => party.set(e.target.value, null)));
  el.querySelector('[data-a="party-private"]')?.addEventListener('change', (e) => pact(() => party.set(null, e.target.checked)));
  el.querySelector('[data-a="party-go"]')?.addEventListener('click', () => onPartyGo?.());
  const off = el.querySelector('[data-a="offline"]');
  off?.addEventListener('change', () => act(() => setAppearOffline(off.checked), () => (off.checked ? 'Friends now see you as offline.' : 'Friends can see you online again.')));
}
