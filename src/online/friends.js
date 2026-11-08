// Friends: search by gamertag, requests, and who's online where.
// Your location is only ever shown to riders you've both accepted (the
// database enforces this; see supabase/migrations/*_friends.sql).
import { load, save } from '../store.js';
import { account, OnlineError, beforeSignOut } from './account.js';
import { getClient } from './client.js';

export const friends = {
  list: [], // { id, gamertag, relation: friend|incoming|outgoing, online, location, park }
  loaded: false,
  error: null,
  get online() {
    return this.list.filter((f) => f.relation === 'friend' && f.online);
  },
  get incoming() {
    return this.list.filter((f) => f.relation === 'incoming');
  },
};

const listeners = new Set();
export function onFriends(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of [...listeners]) fn(friends);
}

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    console.warn(name, error);
    throw new OnlineError(/fetch|network/i.test(error.message || '') ? "Can't reach the CranSki servers right now." : 'Something went wrong. Try again.');
  }
  return data;
}

export async function refreshFriends() {
  if (!account.ready) {
    friends.list = [];
    friends.loaded = false;
    emit();
    return;
  }
  try {
    friends.list = (await rpc('my_friends')) || [];
    friends.loaded = true;
    friends.error = null;
  } catch (e) {
    friends.error = e.message;
  }
  emit();
}

export async function searchRiders(q) {
  if (!account.ready) return [];
  return (await rpc('search_riders', { q })) || [];
}

export async function sendRequest(id) {
  const r = await rpc('send_friend_request', { target: id });
  await refreshFriends();
  return r;
}

export async function respond(id, accept) {
  const r = await rpc('respond_friend_request', { other: id, accept });
  await refreshFriends();
  return r;
}

export async function removeFriend(id) {
  const r = await rpc('remove_friend', { other: id });
  await refreshFriends();
  return r;
}

// ------------------------------------------------------------ your presence
const HEARTBEAT_MS = 45000;
let where = { location: 'basecamp', park: null };
let beat = 0;

export function appearOffline() {
  return !!load('appearOffline', false);
}

export async function setAppearOffline(on) {
  save('appearOffline', !!on);
  if (on) {
    stopBeat();
    if (account.ready) await rpc('go_offline').catch(() => {});
  } else sendBeat();
}

// Called by the game whenever you move between Basecamp, a lift, a run or a replay.
export function setLocation(location, park = null) {
  if (where.location === location && where.park === park) return;
  where = { location, park };
  sendBeat();
}

function sendBeat() {
  clearTimeout(beat);
  if (!account.ready || appearOffline() || document.visibilityState === 'hidden') return;
  rpc('heartbeat', { p_location: where.location, p_park: where.park }).catch(() => {});
  beat = setTimeout(sendBeat, HEARTBEAT_MS);
}

function stopBeat() {
  clearTimeout(beat);
  beat = 0;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    sendBeat();
    refreshFriends();
  } else stopBeat();
});

// Keep the list fresh while signed in (the Friends panel polls faster).
let poll = 0;
let readyFor = null;
function pollFriends() {
  clearTimeout(poll);
  if (!account.ready) return;
  if (document.visibilityState !== 'hidden') refreshFriends();
  poll = setTimeout(pollFriends, 60000);
}

account.onChange(() => {
  const id = account.ready ? account.user.id : null;
  if (id === readyFor) return;
  readyFor = id;
  if (id) {
    sendBeat();
    pollFriends();
  } else {
    stopBeat();
    clearTimeout(poll);
    friends.list = [];
    friends.loaded = false;
    emit();
  }
});

// Signing out: stop showing as online first.
beforeSignOut(async () => {
  stopBeat();
  if (account.ready) await rpc('go_offline').catch(() => {});
});
