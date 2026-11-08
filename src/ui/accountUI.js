// The Account panel (in the page modal): sign in with an emailed link, pick a
// gamertag, rename, sign out. There is no password field anywhere.
import { account, startAccount, sendSignInLink, signOut, gamertagStatus, setGamertag } from '../online/account.js';
import { TAG_MAX, TAG_STATUS, tidyTag, cleanTag } from '../online/names.js';
import { profile } from '../store.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ui = { sentTo: null, renaming: false, error: null, draftTag: null, extra: [] };

// Other steps (cloud saves, friends) add their own sections to the signed-in view.
export function addAccountSection(fn) {
  ui.extra.push(fn);
}

export function mountAccount(el, { onPrivacy } = {}) {
  let off = null;
  ui.error = null;
  if (account.notice) {
    ui.error = account.notice;
    account.notice = null;
  }
  const render = () => {
    if (!el.isConnected) {
      off?.();
      return;
    }
    el.innerHTML = html();
    wire(el, render, onPrivacy);
  };
  off = account.onChange(render);
  render();
}

function html() {
  const s = account.status;
  const err = ui.error ? `<p class="acct-msg bad">${esc(ui.error)}</p>` : '';
  if (s === 'starting') return '<p class="muted">Connecting…</p>';
  if (s === 'offline')
    return `<p>Can't reach the CranSki servers right now. Solo play, your bests and replays all still work on this device.</p>${err}<p><button class="btn" data-a="retry">Try again</button></p>`;

  if (s === 'signedIn' && !account.profile) return claimHtml(err, true);
  if (s === 'signedIn') {
    if (ui.renaming) return claimHtml(err, false);
    return `
      <div class="acct-who"><span class="acct-tag">${esc(account.gamertag)}</span><span class="muted">${esc(account.email || '')}</span></div>
      ${err}
      <p class="acct-row"><button class="btn" data-a="rename">Change gamertag</button><button class="btn" data-a="signout">Sign out on this device</button></p>
      ${ui.extra.map((fn) => fn()).join('')}
      <p class="muted small">Your email is only used to sign you in; other riders only ever see your gamertag. <a href="#" data-a="privacy">What's stored and where</a>.</p>`;
  }

  // Signed out (or never started).
  if (ui.sentTo)
    return `
      <h3>CHECK YOUR EMAIL</h3>
      <p>We sent a sign-in link to <b>${esc(ui.sentTo)}</b>. Open it on this device to finish signing in. It works once and expires after an hour.</p>
      <p class="muted">Nothing there? Check spam, or wait a minute and send another.</p>
      ${err}
      <p class="acct-row"><button class="btn" data-a="resend">Send again</button><button class="btn" data-a="other">Use a different email</button></p>`;
  return `
    <p>Sign in to keep your settings, personal bests and Locker in your account, add friends, and post runs to the leaderboards.</p>
    <p><b>No password.</b> Enter your email and we'll send you a one-time sign-in link.</p>
    <form class="acct-form" data-a="send" novalidate>
      <input type="email" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" spellcheck="false" required aria-label="Email address" />
      <button class="btn primary" type="submit">Email me a sign-in link</button>
    </form>
    ${err}
    <p class="muted small">Solo play never needs an account. <a href="#" data-a="privacy">What's stored and where</a>.</p>`;
}

function claimHtml(err, first) {
  const start = ui.draftTag ?? (first ? cleanTag(profile.name === 'Rider' ? '' : profile.name) : account.gamertag || '');
  return `
    <h3>${first ? 'PICK YOUR GAMERTAG' : 'CHANGE GAMERTAG'}</h3>
    <p>${first ? `You're signed in as <b>${esc(account.email || '')}</b>. ` : ''}Your gamertag is the name other riders see on leaderboards and in friends lists.</p>
    <form class="acct-form" data-a="claim" novalidate>
      <input name="tag" maxlength="${TAG_MAX}" value="${esc(start)}" spellcheck="false" autocomplete="off" aria-label="Gamertag" />
      <button class="btn primary" type="submit" disabled>${first ? 'Claim gamertag' : 'Save'}</button>
    </form>
    <p class="acct-msg" data-status></p>
    ${err}
    <p class="muted small">Letters, spaces and dashes; one rider per name, ignoring case, spaces and dashes; offensive names are blocked.</p>
    <p class="acct-row">${first ? '<button class="btn" data-a="signout">Sign out</button>' : '<button class="btn" data-a="cancel">Cancel</button>'}</p>`;
}

function wire(el, render, onPrivacy) {
  const on = (a, fn) => el.querySelectorAll(`[data-a="${a}"]`).forEach((b) => b.addEventListener(b.tagName === 'FORM' ? 'submit' : 'click', fn));
  const busy = async (btn, job) => {
    ui.error = null;
    if (btn) btn.disabled = true;
    try {
      await job();
    } catch (e) {
      ui.error = e.message || String(e);
    }
    render();
  };

  on('privacy', (e) => {
    e.preventDefault();
    onPrivacy?.();
  });
  on('retry', (e) => busy(e.currentTarget, () => startAccount()));
  on('send', (e) => {
    e.preventDefault();
    const email = e.currentTarget.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ui.error = "That email address doesn't look right.";
      render();
      return;
    }
    account.notice = null;
    busy(e.currentTarget.querySelector('button'), async () => {
      await sendSignInLink(email);
      ui.sentTo = email;
    });
  });
  on('resend', (e) => busy(e.currentTarget, () => sendSignInLink(ui.sentTo)));
  on('other', () => {
    ui.sentTo = null;
    ui.error = null;
    render();
  });
  on('signout', (e) =>
    busy(e.currentTarget, async () => {
      await signOut();
      ui.sentTo = null;
      ui.renaming = false;
    })
  );
  on('rename', () => {
    ui.renaming = true;
    ui.error = null;
    render();
  });
  on('cancel', () => {
    ui.renaming = false;
    ui.draftTag = null;
    ui.error = null;
    render();
  });

  const form = el.querySelector('[data-a="claim"]');
  if (form) {
    const input = form.tag;
    const btn = form.querySelector('button');
    const status = el.querySelector('[data-status]');
    let timer = 0;
    let ticket = 0;
    const show = (code) => {
      status.textContent = TAG_STATUS[code] || '';
      status.className = `acct-msg ${code === 'ok' ? 'good' : code === 'yours' ? '' : 'bad'}`;
      btn.disabled = code !== 'ok';
    };
    const check = () => {
      const my = ++ticket;
      const v = input.value;
      if (!v.trim()) {
        status.textContent = '';
        btn.disabled = true;
        return;
      }
      status.textContent = 'Checking…';
      status.className = 'acct-msg';
      gamertagStatus(v)
        .then((code) => my === ticket && show(code))
        .catch((e) => {
          if (my !== ticket) return;
          status.textContent = e.message;
          status.className = 'acct-msg bad';
        });
    };
    input.addEventListener('input', () => {
      const t = tidyTag(input.value);
      if (t !== input.value) input.value = t;
      ui.draftTag = t;
      btn.disabled = true;
      clearTimeout(timer);
      timer = setTimeout(check, 350);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        const code = await setGamertag(input.value);
        if (code === 'ok') {
          ui.renaming = false;
          ui.draftTag = null;
        }
        else ui.error = TAG_STATUS[code] || 'Could not save that gamertag.';
      });
    });
    if (input.value) check();
    setTimeout(() => input.focus(), 0);
  }
  const email = el.querySelector('input[name="email"]');
  if (email) {
    email.addEventListener('keydown', (e) => e.stopPropagation());
    setTimeout(() => email.focus(), 0);
  }
}
