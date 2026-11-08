// Cloud saves: while you're signed in, your settings, personal bests and Locker
// choices are copied to your account and merged with your other devices.
// Signed out, everything keeps working from this browser's local saves.
//
// Merging (done by the sync_save function in the database):
//   settings and Locker: whichever was changed most recently wins;
//   personal bests: the higher score for each park wins.
import { load, save, remove, onSave, profile } from '../store.js';
import { settings, saveSettings } from '../settings.js';
import { PARKS } from '../parks/index.js';
import { account, notifyAccount, notSetUp } from './account.js';
import { getClient } from './client.js';

// Settings that follow you. Graphics level, frame cap and touch layout are
// about the device, so they stay on it.
export const SYNCED_SETTINGS = ['camera', 'sound', 'stats', 'keys', 'pad'];

export const cloud = {
  state: 'idle', // idle · syncing · synced · error · missing (not set up on the server)
  lastSync: 0,
  onApplied: null, // ({ look, settings, bests }) => void, set by main.js
};

const META = 'sync'; // { settingsAt, settingsJson, lockerAt, user }
let applying = 0;
let timer = 0;
let running = null;
let again = false;
let syncedFor = null;

function meta() {
  return { settingsAt: 0, settingsJson: null, lockerAt: 0, user: null, ...load(META, {}) };
}

function setMeta(m) {
  applying++;
  try {
    save(META, m);
  } finally {
    applying--;
  }
}

function syncedSettings() {
  const out = {};
  for (const k of SYNCED_SETTINGS) out[k] = settings[k];
  return out;
}

function localBests() {
  const out = {};
  for (const p of PARKS) {
    const v = profile.best(p.id);
    if (v > 0) out[p.id] = Math.round(v);
  }
  return out;
}

// First run after updating: existing local settings and Locker count as
// "changed long ago", so they fill an empty account but never override a newer
// cloud save.
if (load(META, null) === null) {
  const m = meta();
  m.settingsJson = JSON.stringify(syncedSettings());
  if (load('settings', null)) m.settingsAt = 1;
  if (Object.keys(profile.look || {}).length) m.lockerAt = 1;
  setMeta(m);
}

// Note when something that syncs changes locally, then push it shortly after.
onSave((key) => {
  if (applying) return;
  const m = meta();
  if (key === 'settings') {
    const json = JSON.stringify(syncedSettings());
    if (json === m.settingsJson) return; // e.g. only the graphics level changed
    m.settingsAt = Date.now();
    m.settingsJson = json;
  } else if (key === 'look') m.lockerAt = Date.now();
  else if (!key.startsWith('best.')) return;
  setMeta(m);
  schedule(1500);
});

function schedule(ms) {
  clearTimeout(timer);
  if (!account.signedIn) return;
  timer = setTimeout(syncNow, ms);
}

export function syncNow() {
  if (!account.signedIn) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = run().finally(() => {
    running = null;
    if (again) {
      again = false;
      schedule(0);
    }
  });
  return running;
}

async function run() {
  const uid = account.user.id;
  cloud.state = 'syncing';
  notifyAccount();
  try {
    const sb = await getClient();
    const m = meta();
    // Another account was synced on this browser before: take this account's
    // save as it is rather than mixing the two riders' progress.
    const switching = !!m.user && m.user !== uid;
    const payload = switching
      ? {}
      : {
          p_settings: m.settingsAt ? syncedSettings() : null,
          p_settings_at: m.settingsAt ? new Date(m.settingsAt).toISOString() : null,
          p_locker: m.lockerAt ? profile.look : null,
          p_locker_at: m.lockerAt ? new Date(m.lockerAt).toISOString() : null,
          p_bests: localBests(),
        };
    const { data, error } = await sb.rpc('sync_save', payload);
    if (error) throw error;
    if (account.user?.id !== uid) return; // signed out meanwhile
    apply(data, uid, switching);
    cloud.state = 'synced';
    cloud.lastSync = Date.now();
  } catch (e) {
    console.warn('Cloud save failed', e);
    cloud.state = notSetUp(e) ? 'missing' : 'error';
    schedule(30000);
  }
  notifyAccount();
}

function apply(row, uid, switching) {
  const changed = { look: false, settings: false, bests: false };
  const m = meta();
  applying++;
  try {
    const sAt = row.settings_at ? Date.parse(row.settings_at) : 0;
    if (row.settings && (switching || sAt > m.settingsAt)) {
      for (const k of SYNCED_SETTINGS) {
        const v = row.settings[k];
        if (v === undefined || v === null || typeof v !== typeof settings[k]) continue;
        settings[k] = typeof v === 'object' && !Array.isArray(v) ? { ...settings[k], ...v } : v;
      }
      saveSettings();
      m.settingsAt = sAt;
      m.settingsJson = JSON.stringify(syncedSettings());
      changed.settings = true;
    }
    const lAt = row.locker_at ? Date.parse(row.locker_at) : 0;
    if (row.locker && (switching || lAt > m.lockerAt)) {
      profile.look = row.locker;
      m.lockerAt = lAt;
      changed.look = true;
    }
    const remote = row.bests || {};
    for (const p of PARKS) {
      const r = Number(remote[p.id]) || 0;
      const l = profile.best(p.id);
      if (switching && r !== l) {
        if (r > 0) profile.setBest(p.id, r);
        else remove(`best.${p.id}`);
        changed.bests = true;
      } else if (r > l) {
        profile.setBest(p.id, r);
        changed.bests = true;
      }
    }
    m.user = uid;
    save(META, m);
  } finally {
    applying--;
  }
  if (changed.look || changed.settings || changed.bests) cloud.onApplied?.(changed);
}

// Start syncing when someone signs in; stop when they sign out.
account.onChange(() => {
  const uid = account.signedIn ? account.user.id : null;
  if (uid === syncedFor) return;
  syncedFor = uid;
  clearTimeout(timer);
  if (uid) syncNow();
  else cloud.state = 'idle';
});

// Coming back to the tab: pick up changes made on another device.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && account.signedIn && Date.now() - cloud.lastSync > 60000) syncNow();
});

export function cloudStatusText() {
  if (cloud.state === 'syncing') return 'Saving to your account…';
  if (cloud.state === 'missing') return "Cloud saves aren't set up on the server yet. Everything is safe on this device.";
  if (cloud.state === 'error') return "Couldn't reach your cloud save. Everything is safe on this device and will sync when you're back online.";
  if (cloud.state === 'synced') {
    const s = Math.round((Date.now() - cloud.lastSync) / 1000);
    const when = s < 10 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
    return `Settings, personal bests and Locker saved to your account · ${when}`;
  }
  return '';
}
