// Your CranSki account: an email sign-in link (Supabase Auth, no passwords) and
// a gamertag. Solo play never needs any of this; nothing here runs until the
// rider asks to sign in, or this browser was signed in before.
import { getClient, hasSessionHint } from './client.js';
import { cleanTag, tagProblem } from './names.js';

const listeners = new Set();

export const account = {
  // off: never started (solo) · starting · signedOut · signedIn · offline
  status: 'off',
  user: null,
  profile: null, // { id, gamertag }
  notice: null, // a message to show once (e.g. an expired sign-in link)
  justSignedIn: false, // came back from a sign-in link on this page load
  get signedIn() {
    return this.status === 'signedIn';
  },
  get ready() {
    return this.status === 'signedIn' && !!this.profile;
  },
  get gamertag() {
    return this.profile?.gamertag || null;
  },
  get email() {
    return this.user?.email || null;
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn(account);
    } catch (e) {
      console.error(e);
    }
  }
}

export class OnlineError extends Error {}

function friendly(error) {
  const status = error?.status;
  const msg = String(error?.message || '');
  if (status === 429 || /rate limit|too many/i.test(msg)) return new OnlineError('Too many sign-in emails. Wait a minute, then try again.');
  if (/fetch|network|load failed|NetworkError/i.test(msg) || error instanceof TypeError)
    return new OnlineError("Can't reach the CranSki servers right now. Solo play still works.");
  if (/invalid.*email|email.*invalid|validate email/i.test(msg)) return new OnlineError("That email address doesn't look right.");
  return new OnlineError(msg || 'Something went wrong. Try again.');
}

let starting = null;
let profileFor = null;

// Start the client (and pick up a session from a sign-in link in the URL).
export function startAccount() {
  if (starting) return starting;
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const fromLink = hash.has('access_token');
  const linkError = hash.get('error_description');
  account.status = 'starting';
  emit();
  starting = getClient()
    .then(async (sb) => {
      sb.auth.onAuthStateChange((event, session) => {
        // Never await other Supabase calls inside this callback.
        setTimeout(() => onSession(sb, session), 0);
      });
      const { data } = await sb.auth.getSession();
      await onSession(sb, data.session);
      if (linkError) {
        account.notice = /expired|invalid/i.test(linkError)
          ? 'That sign-in link has expired or was already used. Send yourself a new one.'
          : `Sign-in failed: ${linkError}`;
      }
      if (fromLink && account.user) account.justSignedIn = true;
      if (fromLink || linkError) history.replaceState(null, '', location.pathname + location.search);
      emit();
      return sb;
    })
    .catch((err) => {
      console.warn('Online features unavailable', err);
      starting = null;
      account.status = 'offline';
      emit();
      throw friendly(err);
    });
  return starting;
}

// Start automatically only when this browser has signed in before.
export function resumeAccount() {
  if (hasSessionHint()) startAccount().catch(() => {});
}

async function onSession(sb, session) {
  const user = session?.user || null;
  if (!user) {
    const was = account.status;
    account.user = null;
    account.profile = null;
    profileFor = null;
    account.status = 'signedOut';
    if (was !== 'signedOut') emit();
    return;
  }
  const changed = account.user?.id !== user.id || account.status !== 'signedIn';
  account.user = user;
  account.status = 'signedIn';
  if (profileFor !== user.id) {
    profileFor = user.id;
    const { data, error } = await sb.from('profiles').select('id, gamertag').eq('id', user.id).maybeSingle();
    if (error) console.warn('Could not load profile', error);
    account.profile = data || null;
    emit();
  } else if (changed) emit();
}

// Email a one-time sign-in link. Opening it signs this browser in.
export async function sendSignInLink(email) {
  const sb = await startAccount();
  const { error } = await sb.auth.signInWithOtp({
    email: String(email).trim(),
    options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
  });
  if (error) throw friendly(error);
}

export async function signOut() {
  const sb = await startAccount();
  await sb.auth.signOut({ scope: 'local' });
  account.user = null;
  account.profile = null;
  profileFor = null;
  account.status = 'signedOut';
  emit();
}

// 'ok' | 'yours' | 'taken' | 'length' | 'chars' | 'blocked'
export async function gamertagStatus(name) {
  const tag = cleanTag(name);
  const problem = tagProblem(tag);
  if (problem) return problem;
  const sb = await startAccount();
  const { data, error } = await sb.rpc('gamertag_status', { name: tag });
  if (error) throw friendly(error);
  return data;
}

// Claim (or change to) a gamertag. Returns 'ok' or the reason it was refused.
export async function setGamertag(name) {
  const tag = cleanTag(name);
  const problem = tagProblem(tag);
  if (problem) return problem;
  const sb = await startAccount();
  if (!account.user) return 'signedOut';
  const q = account.profile
    ? sb.from('profiles').update({ gamertag: tag }).eq('id', account.user.id)
    : sb.from('profiles').insert({ id: account.user.id, gamertag: tag });
  const { data, error } = await q.select('id, gamertag').single();
  if (error) {
    if (error.code === '23505') return 'taken';
    const m = /gamertag_(length|chars|blocked)/.exec(error.message || '');
    if (m) return m[1];
    throw friendly(error);
  }
  account.profile = data;
  emit();
  return 'ok';
}

// The name shown on your lift pass, ghost and replays.
export function displayName(localName) {
  return account.gamertag || localName;
}
