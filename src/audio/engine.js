// One AudioContext for the whole game, with separate music and effects buses.
// Everything you hear is synthesised in the browser: no audio files.
import { settings, onSettings } from '../settings.js';

let ctx = null;
let music = null;
let effects = null;
let reverb = null;
let noiseBuf = null;

const vol = (v) => Math.pow(Math.max(0, Math.min(100, v)) / 100, 1.6);

export function audio() {
  return ctx;
}

// Browsers only allow sound after a click or key press.
export function startAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -12;
  master.connect(ctx.destination);
  music = ctx.createGain();
  effects = ctx.createGain();
  music.connect(master);
  effects.connect(master);
  reverb = ctx.createConvolver();
  reverb.buffer = impulse(2.4, 2.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  reverb.connect(wet);
  wet.connect(master);
  applyVolumes();
  onSettings(applyVolumes);
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  music.gain.setTargetAtTime(vol(settings.sound.music) * 0.55, ctx.currentTime, 0.05);
  effects.gain.setTargetAtTime(vol(settings.sound.effects), ctx.currentTime, 0.05);
}

export function buses() {
  return { music, effects, reverb };
}

// Decaying noise as a reverb impulse response.
function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 3;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export function noise() {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let seed = 11;
  for (let i = 0; i < len; i++) {
    seed = (seed * 16807) % 2147483647;
    d[i] = (seed / 2147483647) * 2 - 1;
  }
  return noiseBuf;
}
