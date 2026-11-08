// The Account panel (in the page modal): sign in with an emailed link, pick a
// gamertag, rename, sign out. There is no password field anywhere.
import { account, startAccount, sendSignInLink, verifySignInCode, signOut, gamertagStatus, setGamertag, deleteAccount } from '../online/account.js';
import { TAG_MAX, TAG_STATUS, tidyTag, cleanTag } from '../online/names.js';
import { profile } from '../store.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ui = { sentTo: null, renaming: false, deleting: false, deleted: false, error: null, draftTag: null, extra: [] };

// Other steps (cloud saves, friends) add their own sections to the signed-in view.
export function addAccountSection(fn) {
  ui.extra.push(fn);
}

export function mountAccount(el, { onPrivacy } = {}) {
  let off = null;
  ui.error = null;
  ui.deleting = false;
  ui.deleted = false;
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
    if (ui.deleting)
      return `
      <h3>DELETE YOUR ACCOUNT</h3>
      <p>This permanently deletes your CranSki account: your email sign-in, your gamertag <b>${esc(account.gamertag || '')}</b>, your cloud save, your friends and requests, and your leaderboard scores. It can't be undone.</p>
      <p>Your progress, settings and replays on this device stay; you can clear those from the Privacy page.</p>
      <form class="acct-form" data-a="delete" novalidate>
        <input name="confirm" placeholder="Type DELETE to confirm" autocomplete="off" spellcheck="false" aria-label="Type DELETE to confirm" />
        <button class="btn danger" type="submit">Delete my account</button>
      </form>
      ${err}
      <p class="acct-row"><button class="btn" data-a="keepacct">Keep my account</button></p>`;
    return `
      <div class="acct-who"><span class="acct-tag">${esc(account.gamertag)}</span><span class="muted">${esc(account.email || '')}</span></div>
      ${err}
      <p class="acct-row"><button class="btn" data-a="rename">Change gamertag</button><button class="btn" data-a="signout">Sign out on this device</button></p>
      ${ui.extra.map((fn) => fn()).join('')}
      <p class="acct-row"><button class="btn sm ghost" data-a="askdelete">Delete account…</button></p>
      <p class="muted small">Your email is only used to sign you in; other riders only ever see your gamertag. <a href="#" data-a="privacy">What's stored and where</a>.</p>`;
  }

  // Signed out (or never started).
  if (ui.deleted) return '<h3>ACCOUNT DELETED</h3><p>Your account and everything stored with it on the server are gone. Solo play still works as before, and you can make a new account any time.</p>';
  if (ui.sentTo)
    return `
      <h3>CHECK YOUR EMAIL</h3>
      <p>We sent a sign-in email to <b>${esc(ui.sentTo)}</b>. Type the code from it here:</p>
      <form class="acct-form" data-a="code" novalidate>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="Code from the email" spellcheck="false" aria-label="Sign-in code from the email" />
        <button class="btn primary" type="submit">Sign in</button>
      </form>
      ${err}
      <p class="muted">Or open the email's link on this device. The code and link work once and expire after an hour; if you ask for another email, only the newest one works.</p>
      <p class="muted">Nothing there? Check your spam folder. Gmail switches links off in spam, but the code still works.</p>
      <p class="acct-row"><button class="btn" data-a="resend">Send again</button><button class="btn" data-a="other">Use a different email</button></p>`;
  return `
    <p>Sign in to keep your settings, personal bests and Locker in your account, add friends, and post runs to the leaderboards.</p>
    <p><b>No password.</b> Enter your email and we'll send you a one-time sign-in code and link.</p>
    <form class="acct-form" data-a="send" novalidate>
      <input type="email" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" spellcheck="false" required aria-label="Email address" />
      <button class="btn primary" type="submit">Email me a sign-in code</button>
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
  on('code', (e) => {
    e.preventDefault();
    const code = e.currentTarget.code.value;
    busy(e.currentTarget.querySelector('button'), async () => {
      await verifySignInCode(ui.sentTo, code);
      ui.sentTo = null;
    });
  });
  const codeInput = el.querySelector('input[name="code"]');
  if (codeInput) {
    codeInput.addEventListener('keydown', (e) => e.stopPropagation());
    codeInput.addEventListener('input', () => {
      const v = codeInput.value.replace(/\D/g, '');
      if (v !== codeInput.value) codeInput.value = v;
    });
    setTimeout(() => codeInput.focus(), 0);
  }
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
  on('askdelete', () => {
    ui.deleting = true;
    ui.error = null;
    render();
  });
  on('keepacct', () => {
    ui.deleting = false;
    ui.error = null;
    render();
  });
  on('delete', (e) => {
    e.preventDefault();
    if (e.currentTarget.confirm.value.trim().toUpperCase() !== 'DELETE') {
      ui.error = 'Type DELETE to confirm.';
      render();
      return;
    }
    busy(e.currentTarget.querySelector('button'), async () => {
      await deleteAccount();
      ui.deleting = false;
      ui.deleted = true;
      ui.sentTo = null;
    });
  });
  el.querySelector('input[name="confirm"]')?.addEventListener('keydown', (e) => e.stopPropagation());
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
