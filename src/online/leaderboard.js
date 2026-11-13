// Leaderboards: post a finished run (as its recorded inputs) to the
// submit-run Edge Function, which re-rides it and saves the score only if it
// matches; and read the boards.
import { account, notSetUp } from './account.js';
import { getClient } from './client.js';
import { packRuns, SIM_VERSION } from '../replay/record.js';
import { PARKS } from '../parks/index.js';
import { wallet } from './wallet.js';

export const BOARD_PARKS = PARKS.filter((p) => p.leaderboard).map((p) => p.id);

// Leaderboard parks.
export function canPost(record) {
  return !!record && BOARD_PARKS.includes(record.park) && record.version === SIM_VERSION;
}

// Any park: every finished run the server re-rides earns FROST.
export function canSubmit(record) {
  return !!record && PARKS.some((p) => p.id === record.park) && record.version === SIM_VERSION;
}

export const SUBMIT_ERRORS = {
  mismatch: "The server re-rode your run and got a different score, so it wasn't posted.",
  not_finished: "The server's re-ride didn't reach the finish line, so it wasn't posted.",
  old_version: 'Your game is out of date. Reload the page to post runs.',
  slow_down: "You've posted a lot of runs. Wait a few minutes and try again.",
  no_gamertag: 'Pick a gamertag first.',
  not_signed_in: 'Sign in to post runs.',
  bad_inputs: "This run's recording couldn't be read.",
  no_leaderboard: 'This park has no leaderboard.',
  server_not_configured: "The leaderboard server isn't set up yet.",
  not_your_turn: "It isn't your turn in this match.",
  not_live: 'That match has ended.',
  wrong_park: 'Ranked runs are on APEX.',
  server_error: 'The leaderboard server had a problem, so this run wasn\'t posted. Try again later.',
};

// { ok: true, total, best, improved, rank } or { ok: false, error, message, serverTotal }
export async function submitRun(record) {
  if (!account.ready) return { ok: false, error: 'not_signed_in', message: SUBMIT_ERRORS.not_signed_in };
  return send({
    park: record.park,
    version: record.version,
    steps: record.inputs.steps,
    inputs: packRuns(record.inputs.runs),
    marks: record.inputs.marks || [],
    grabSlots: record.grabSlots,
    board: !!record.board,
    claimed: { total: record.total },
  });
}

// A run already packed for sending (duels and ranked keep runs this way),
// optionally as a turn in a ranked match.
export async function submitPacked(rec, total, match = null) {
  if (!account.ready) return { ok: false, error: 'not_signed_in', message: SUBMIT_ERRORS.not_signed_in };
  return send({
    park: rec.park,
    version: rec.version,
    steps: rec.steps,
    inputs: rec.inputs,
    marks: rec.marks || [],
    grabSlots: rec.grabSlots,
    board: !!rec.board,
    claimed: { total },
    ...(match ? { match } : {}),
  });
}

async function send(body) {
  try {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke('submit-run', { body });
    if (!error) {
      if (data?.frost) wallet.set(data.frost);
      return { ok: true, ...data };
    }
    let info = {};
    try {
      info = await error.context?.json?.();
    } catch {
      /* not JSON */
    }
    const code = info?.error || 'server_error';
    return { ok: false, error: code, serverTotal: info?.server_total ?? null, message: SUBMIT_ERRORS[code] || "Couldn't reach the leaderboard server. Try again later." };
  } catch (e) {
    console.warn('submit-run failed', e);
    return { ok: false, error: 'network', message: "Couldn't reach the leaderboard server. Try again later." };
  }
}

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.warn(name, error);
    throw new Error(notSetUp(error) ? "Leaderboards aren't set up on the server yet." : "Couldn't load the leaderboard. Try again later.");
  }
  return data || [];
}

// scope: 'top' | 'friends'
export async function fetchBoard(park, scope = 'top') {
  if (scope === 'friends') return account.ready ? rpc('leaderboard_friends', { p_park: park }) : [];
  return rpc('leaderboard_top', { p_park: park, p_limit: 50 });
}

export async function fetchMine(park) {
  if (!account.ready) return null;
  const rows = await rpc('leaderboard_me', { p_park: park });
  return rows[0] || null;
}
