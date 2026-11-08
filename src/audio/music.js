// The soundtrack: nine original chill synthwave tracks, composed for CranSki and
// played live by a tiny in-browser synth (pads, bass, arpeggios, drums, leads).
import { audio, buses, noise } from './engine.js';
import { load, save } from '../store.js';

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

// Each track: tempo, key (MIDI root), scale, 4-chord progression (scale degrees),
// arpeggio shape, bass rhythm, drum feel, and whether a lead melody plays.
export const TRACKS = [
  { name: 'CranSki Theme', bpm: 96, root: 45, scale: 'minor', prog: [0, 5, 2, 6], arp: [0, 1, 2, 3, 2, 1], bass: [0, 6, 8, 14], drums: 'drive', lead: true, cut: 1500 },
  { name: 'Corduroy Dawn', bpm: 84, root: 43, scale: 'dorian', prog: [0, 3, 5, 4], arp: [0, 2, 1, 3], bass: [0, 8, 11], drums: 'chill', lead: false, cut: 1100 },
  { name: 'Neon Gondola', bpm: 104, root: 47, scale: 'minor', prog: [0, 6, 5, 4], arp: [0, 1, 2, 1, 3, 2], bass: [0, 3, 6, 8, 11, 14], drums: 'drive', lead: true, cut: 1800 },
  { name: 'Knuckle Glow', bpm: 92, root: 41, scale: 'lydian', prog: [0, 1, 5, 4], arp: [0, 2, 3, 2], bass: [0, 7, 10], drums: 'half', lead: true, cut: 1300 },
  { name: 'Powder Static', bpm: 78, root: 40, scale: 'minor', prog: [0, 2, 5, 3], arp: [0, 1, 2], bass: [0, 10], drums: 'chill', lead: false, cut: 900 },
  { name: 'Halfpipe Horizon', bpm: 110, root: 48, scale: 'major', prog: [5, 3, 0, 4], arp: [0, 1, 2, 3, 2, 1, 0, 2], bass: [0, 4, 8, 12], drums: 'drive', lead: true, cut: 2000 },
  { name: 'Floodlight Drive', bpm: 100, root: 44, scale: 'minor', prog: [0, 0, 5, 6], arp: [0, 2, 1, 2], bass: [0, 2, 6, 8, 10, 14], drums: 'drive', lead: false, cut: 1600 },
  { name: 'Village Aurora', bpm: 88, root: 46, scale: 'dorian', prog: [0, 4, 3, 5], arp: [2, 1, 0, 1, 3], bass: [0, 8], drums: 'half', lead: true, cut: 1200 },
  { name: 'Last Chair Home', bpm: 74, root: 42, scale: 'major', prog: [0, 5, 3, 4], arp: [0, 1, 2, 1], bass: [0, 8, 12], drums: 'chill', lead: true, cut: 1000 },
];

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor() {
    this.index = load('musicNext', 0) % TRACKS.length;
    // Each visit opens on a different track.
    save('musicNext', (this.index + 1) % TRACKS.length);
    this.playing = false;
    this.listeners = new Set();
    this.timer = null;
  }

  get track() {
    return TRACKS[this.index];
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  play() {
    const ctx = audio();
    if (!ctx) return;
    if (this.playing) return;
    this.playing = true;
    this._setupBus();
    this.step = 0;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._schedule(), 25);
    this._emit();
  }

  pause() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.out) this.out.gain.setTargetAtTime(0, audio().currentTime, 0.05);
    this.out = null;
    this._emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  skip() {
    const was = this.playing;
    if (was) this.pause();
    this.index = (this.index + 1) % TRACKS.length;
    if (was) this.play();
    else this._emit();
  }

  _setupBus() {
    const ctx = audio();
    const t = this.track;
    this.stepDur = 60 / t.bpm / 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(buses().music);
    this.send = ctx.createGain();
    this.send.gain.value = 0.6;
    this.send.connect(buses().reverb);
    // Echo for the arps and lead.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = this.stepDur * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createGain();
    dl.gain.value = 0.35;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delay.connect(dl);
    dl.connect(this.out);
    this.scale = SCALES[t.scale];
    // Seeded melody, so each track always plays the same tune.
    let seed = 7 + this.index * 131;
    this.rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.melody = Array.from({ length: 64 }, () => (this.rnd() < 0.42 ? null : Math.floor(this.rnd() * 7)));
  }

  _note(degree, octave = 0) {
    const s = this.scale;
    const d = ((degree % 7) + 7) % 7;
    const o = Math.floor(degree / 7);
    return this.track.root + s[d] + 12 * (o + octave);
  }

  _schedule() {
    const ctx = audio();
    if (!this.playing || !ctx) return;
    while (this.next < ctx.currentTime + 0.15) {
      this._play(this.step, this.next);
      this.step++;
      this.next += this.stepDur;
    }
  }

  _play(step, t) {
    const tr = this.track;
    const bar = Math.floor(step / 16) % 8;
    const s16 = step % 16;
    const chordDeg = tr.prog[bar % 4];
    const chord = [chordDeg, chordDeg + 2, chordDeg + 4];
    const intro = Math.floor(step / 16) < 2; // first two bars: pads and arps only
    if (s16 === 0) for (const d of chord) this._pad(midiHz(this._note(d, 1)), t, this.stepDur * 16);
    if (!intro && tr.bass.includes(s16)) this._bass(midiHz(this._note(chordDeg, -1)), t, this.stepDur * 1.6);
    const arpEvery = tr.bpm > 95 ? 1 : 2;
    if (s16 % arpEvery === 0) {
      const i = Math.floor(s16 / arpEvery) % tr.arp.length;
      const octave = bar >= 4 ? 3 : 2;
      this._pluck(midiHz(this._note(chord[0] + tr.arp[i] * 2, octave - 1)), t);
    }
    if (!intro) this._drums(s16, t, tr.drums);
    if (tr.lead && bar >= 4 && s16 % 2 === 0) {
      const m = this.melody[(bar * 8 + s16 / 2) % 64];
      if (m !== null) this._lead(midiHz(this._note(chordDeg + m, 2)), t, this.stepDur * 2);
    }
  }

  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _pad(f, t, len) {
    const ctx = audio();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(this.track.cut * 0.6, t);
    lp.frequency.linearRampToValueAtTime(this.track.cut, t + len * 0.5);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.send);
    for (const det of [-8, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.6);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.5);
    g.gain.setValueAtTime(0.035, t + len - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.5);
  }

  _bass(f, t, len) {
    const ctx = audio();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + len);
    const g = ctx.createGain();
    this._env(g, t, 0.01, 0.18, len);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + len + 0.1);
  }

  _pluck(f, t) {
    const ctx = audio();
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = ctx.createGain();
    this._env(g, t, 0.005, 0.03, 0.18);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + 0.25);
  }

  _lead(f, t, len) {
    const ctx = audio();
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ctx.createGain();
    vg.gain.value = f * 0.008;
    vib.connect(vg);
    vg.connect(o.frequency);
    const g = ctx.createGain();
    this._env(g, t, 0.03, 0.07, len * 1.4);
    o.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    g.connect(this.send);
    o.start(t);
    vib.start(t);
    o.stop(t + len * 1.6);
    vib.stop(t + len * 1.6);
  }

  _drums(s16, t, feel) {
    const kick = feel === 'drive' ? s16 % 4 === 0 : feel === 'half' ? s16 === 0 || s16 === 10 : s16 === 0 || s16 === 7;
    const snare = feel === 'half' ? s16 === 8 : s16 === 4 || s16 === 12;
    const hat = feel === 'chill' ? s16 % 4 === 2 : s16 % 2 === 1;
    if (kick) this._kick(t);
    if (snare) this._noise(t, 'bandpass', 1800, 0.12, 0.18, true);
    if (hat) this._noise(t, 'highpass', 7000, 0.035, 0.05, false);
  }

  _kick(t) {
    const ctx = audio();
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    this._env(g, t, 0.002, 0.45, 0.3);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.35);
  }

  _noise(t, type, freq, gain, len, verb) {
    const ctx = audio();
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, t, 0.002, gain, len);
    src.connect(f);
    f.connect(g);
    g.connect(this.out);
    if (verb) g.connect(this.send);
    src.start(t, Math.random() * 1.5);
    src.stop(t + len + 0.05);
  }
}
