// Player settings, saved locally. Everything is applied live where possible.
import { load, save } from './store.js';
import { BINDINGS } from './input.js';

const DEFAULT_KEYS = JSON.parse(JSON.stringify(BINDINGS.keyboard));
const DEFAULT_PAD = JSON.parse(JSON.stringify(BINDINGS.gamepad));

export const DEFAULTS = {
  graphics: 'high', // ultra | high | performance
  frameCap: 0, // 0 = uncapped, 30
  camera: {
    speedFov: true,
    fov: 66,
    stiffness: 1, // multiplier on how tightly the camera follows
    tilt: 0, // degrees, positive looks further down
    distance: 5.8,
    height: 2.0,
    angle: 0, // degrees around the rider (side view)
    firstPerson: false,
  },
  sound: { music: 60, effects: 80 },
  stats: 'off', // off | basic | detailed
  keys: DEFAULT_KEYS,
  pad: DEFAULT_PAD,
  touch: null, // touch layout (step 6)
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(base)) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
  return out;
}

const listeners = new Set();

export const settings = merge(JSON.parse(JSON.stringify(DEFAULTS)), load('settings', null));

export function applyBindings() {
  for (const k of Object.keys(DEFAULT_KEYS)) BINDINGS.keyboard[k] = settings.keys[k] ? [...settings.keys[k]] : [...DEFAULT_KEYS[k]];
  for (const k of Object.keys(DEFAULT_PAD)) BINDINGS.gamepad[k] = settings.pad[k] ?? DEFAULT_PAD[k];
}
applyBindings();

export function saveSettings() {
  save('settings', settings);
  applyBindings();
  for (const fn of listeners) fn(settings);
}

export function onSettings(fn) {
  listeners.add(fn);
}

export function resetSection(section) {
  if (section === 'keys') settings.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
  else if (section === 'pad') settings.pad = JSON.parse(JSON.stringify(DEFAULT_PAD));
  else settings[section] = JSON.parse(JSON.stringify(DEFAULTS[section]));
  saveSettings();
}

// Phones and weaker machines start in Performance (the player can undo it).
export function looksLowEnd() {
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const touchFirst = matchMedia('(pointer: coarse)').matches;
  return touchFirst || mem <= 4 || cores <= 4;
}
