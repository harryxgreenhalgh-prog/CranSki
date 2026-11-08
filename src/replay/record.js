// Replays store only the inputs for each 120 Hz step. The simulation is
// deterministic, so re-running the inputs reproduces the run exactly.

// Bump this whenever the simulation changes in a way that alters runs:
// replays and ghosts from an older version can't be re-ridden.
export const SIM_VERSION = 7;

export function encodeInput(i) {
  let v = 0;
  if (i.steer < 0) v |= 1;
  else if (i.steer > 0) v |= 2;
  if (i.roll < 0) v |= 4;
  else if (i.roll > 0) v |= 8;
  if (i.tuck) v |= 16;
  if (i.brake) v |= 32;
  if (i.up) v |= 64;
  if (i.pop) v |= 128;
  if (i.grab[0]) v |= 256;
  if (i.grab[1]) v |= 512;
  if (i.grab[2]) v |= 1024;
  if (i.butter) v |= 2048;
  return v;
}

export function decodeInput(v, out) {
  out.steer = v & 1 ? -1 : v & 2 ? 1 : 0;
  out.roll = v & 4 ? -1 : v & 8 ? 1 : 0;
  out.tuck = !!(v & 16);
  out.brake = !!(v & 32);
  out.up = !!(v & 64);
  out.pop = !!(v & 128);
  out.grab[0] = !!(v & 256);
  out.grab[1] = !!(v & 512);
  out.grab[2] = !!(v & 1024);
  out.butter = !!(v & 2048);
  return out;
}

export function blankInput() {
  return { steer: 0, roll: 0, tuck: false, brake: false, up: false, pop: false, grab: [false, false, false], butter: false };
}

// Collects inputs during a run; run-length encoded so a 3-minute run is tiny.
export class Recorder {
  constructor() {
    this.reset();
  }

  reset() {
    this.runs = []; // [value, count, value, count, ...]
    this.steps = 0;
    this.marks = []; // { step, type: 'reset' } pause-menu resets
  }

  push(input) {
    const v = encodeInput(input);
    const n = this.runs.length;
    if (n && this.runs[n - 2] === v && this.runs[n - 1] < 65535) this.runs[n - 1]++;
    else this.runs.push(v, 1);
    this.steps++;
  }

  mark(type) {
    this.marks.push({ step: this.steps, type });
  }

  data() {
    return { runs: Uint16Array.from(this.runs), steps: this.steps, marks: this.marks.slice() };
  }
}

// Iterates the recorded inputs step by step.
export class InputStream {
  constructor(data) {
    this.runs = data.runs;
    this.steps = data.steps;
    this.marks = data.marks || [];
    this.i = 0;
    this.left = this.runs.length ? this.runs[1] : 0;
    this.step = 0;
    this.input = blankInput();
  }

  // Next step's input, or null at the end.
  next() {
    if (this.step >= this.steps) return null;
    while (this.left === 0) {
      this.i += 2;
      if (this.i >= this.runs.length) return null;
      this.left = this.runs[this.i + 1];
    }
    this.left--;
    this.step++;
    return decodeInput(this.runs[this.i], this.input);
  }

  marksAt(step) {
    return this.marks.filter((m) => m.step === step);
  }
}
