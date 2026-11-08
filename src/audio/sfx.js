// Sound effects, all synthesised: snow under the skis (changes with speed and
// surface), wind, rail grind, butter scrape, lift machinery, landings, pops,
// crashes and the ringing ball on FOREST LINE.
import { audio, buses, noise } from './engine.js';

function loopNoise(filterType, freq, q = 1) {
  const ctx = audio();
  const src = ctx.createBufferSource();
  src.buffer = noise();
  src.loop = true;
  src.playbackRate.value = 0.6 + Math.random() * 0.1;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f);
  f.connect(g);
  g.connect(buses().effects);
  src.start();
  return { src, f, g };
}

export class Sfx {
  constructor() {
    this.ready = false;
  }

  _init() {
    const ctx = audio();
    if (!ctx || this.ready) return !!ctx;
    this.snow = loopNoise('bandpass', 1200, 0.7);
    this.wind = loopNoise('lowpass', 500, 0.5);
    this.butter = loopNoise('bandpass', 420, 2.5);
    this.grindNoise = loopNoise('bandpass', 2600, 6);
    // Metallic ring for the rail: two inharmonic tones.
    this.grindTone = ctx.createGain();
    this.grindTone.gain.value = 0;
    this.grindTone.connect(buses().effects);
    for (const f of [612, 1497]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g);
      g.connect(this.grindTone);
      o.start();
    }
    // Lift machinery hum.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 52;
    o.connect(lp);
    lp.connect(this.hum);
    this.hum.connect(buses().effects);
    o.start();
    this.clack = 0;
    this.ready = true;
    return true;
  }

  _set(node, v, t = 0.06) {
    node.gain.setTargetAtTime(v, audio().currentTime, t);
  }

  // Called each frame with what the rider is doing.
  update(s, dt) {
    if (!this._init()) return;
    const sp = s.speed || 0;
    const ground = s.mode === 'ground';
    const k = Math.min(1, sp / 40);
    // Snow: brighter and louder with speed; duller and softer in powder.
    const pw = s.powder || 0;
    this._set(this.snow.g, ground && sp > 0.5 ? (0.05 + 0.25 * k) * (1 - 0.5 * pw) * (s.braking ? 1.6 : 1) : 0);
    this.snow.f.frequency.setTargetAtTime(pw > 0.5 ? 500 + 600 * k : 900 + 2600 * k, audio().currentTime, 0.1);
    // Wind rises with speed (and in the air).
    this._set(this.wind.g, s.active ? 0.02 + 0.35 * k * k : 0, 0.2);
    this.wind.f.frequency.setTargetAtTime(300 + 1400 * k, audio().currentTime, 0.2);
    // Steel rail grind scales with speed.
    const rail = s.mode === 'rail';
    this._set(this.grindNoise.g, rail ? 0.12 + 0.2 * k : 0, 0.03);
    this._set(this.grindTone, rail ? 0.04 + 0.05 * k : 0, 0.03);
    this._set(this.butter.g, s.butter ? 0.35 : 0, 0.05);
    // Lift: hum and a clack as each tower passes.
    this._set(this.hum, s.lift ? 0.25 : 0, 0.3);
    if (s.lift) {
      this.clack -= dt;
      if (this.clack <= 0) {
        this.clack = 1.6;
        this.thud(0.15, 180, 0.08);
      }
    }
  }

  // Landing thud; flat landings smack harder.
  thud(gain = 0.6, freq = 110, len = 0.25) {
    if (!this._init()) return;
    const ctx = audio();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(40, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g);
    g.connect(buses().effects);
    o.start(t);
    o.stop(t + len + 0.05);
    this._burst(gain * 0.6, 'lowpass', 900, len * 0.8);
  }

  land(impact) {
    const g = Math.min(1, 0.25 + impact / 25);
    this.thud(g, 90 + impact * 4, 0.3);
    this._burst(g * 0.5, 'highpass', 2500, 0.18);
  }

  pop() {
    this._burst(0.35, 'bandpass', 700, 0.12);
  }

  crash() {
    this.thud(0.9, 80, 0.4);
    this._burst(0.6, 'lowpass', 1400, 0.9);
    setTimeout(() => this.thud(0.4, 70, 0.25), 180);
  }

  tick() {
    if (!this._init()) return;
    const ctx = audio();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g);
    g.connect(buses().effects);
    o.start(t);
    o.stop(t + 0.08);
  }

  // The giant black ball rings like a bell.
  ring(strength = 1) {
    if (!this._init()) return;
    const ctx = audio();
    const t = ctx.currentTime;
    const base = 196;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, 0.15 + strength * 0.05), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4);
    g.connect(buses().effects);
    g.connect(buses().reverb);
    for (const [r, a] of [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.25],
      [8.93, 0.12],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * r;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + 4.1);
    }
  }

  ui() {
    this.tick();
  }

  _burst(gain, type, freq, len) {
    if (!this._init()) return;
    const ctx = audio();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f);
    f.connect(g);
    g.connect(buses().effects);
    src.start(t, Math.random());
    src.stop(t + len + 0.05);
  }
}
