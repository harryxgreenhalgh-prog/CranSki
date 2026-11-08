// Re-ride a recorded run and keep everything needed to play it back with any
// camera: rider frames at 60 Hz, trick messages, and where every air and rail was.
import { DT } from '../sim/constants.js';
import { Run } from '../sim/run.js';
import { InputStream, SIM_VERSION } from './record.js';
import { STRIDE, writeFrame } from '../render/pose.js';

export const FRAME_DT = DT * 2; // 60 Hz

export function simulateReplay(terrain, data) {
  if (data.version !== SIM_VERSION) throw new Error('This replay was recorded with an older version of the game.');
  const run = new Run(terrain);
  const r = run.rider;
  if (data.grabSlots) r.grabSlots = data.grabSlots.slice();
  r.board = !!data.board;
  const stream = new InputStream(data.inputs);
  const maxFrames = Math.ceil(stream.steps / 2) + 200;
  const frames = new Float32Array(maxFrames * STRIDE);
  const events = [];
  const airs = [];
  const rails = [];
  let count = 0;
  let step = 0;
  let prevMode = r.mode;
  let air = null;
  let rail = null;
  writeFrame(r, frames, 0);
  count = 1;
  for (;;) {
    for (const m of stream.marksAt(step)) if (m.type === 'reset') run.resetPosition();
    const inp = stream.next();
    if (!inp) break;
    run.step(inp);
    step++;
    const t = step * DT;
    for (const m of run.messages) events.push({ t, msg: m });
    run.messages.length = 0;
    if (r.mode !== prevMode) {
      if (r.mode === 'air') air = { t0: t, p0: r.pos.clone(), apexT: t, apex: r.pos.clone(), fromRail: prevMode === 'rail' };
      if (prevMode === 'air' && air) {
        air.t1 = t;
        air.p1 = r.pos.clone();
        air.time = air.t1 - air.t0;
        airs.push(air);
        air = null;
      }
      if (r.mode === 'rail') rail = { t0: t, p0: r.pos.clone() };
      if (prevMode === 'rail' && rail) {
        rail.t1 = t;
        rail.p1 = r.pos.clone();
        rails.push(rail);
        rail = null;
      }
      prevMode = r.mode;
    }
    if (air && r.pos.y > air.apex.y) {
      air.apex.copy(r.pos);
      air.apexT = t;
    }
    if (step % 2 === 0 && count < maxFrames) {
      writeFrame(r, frames, count * STRIDE);
      count++;
    }
  }
  // Points for each air (from the trick message that followed it).
  for (const a of airs) {
    const ev = events.find((e) => e.t >= a.t1 - 1e-6 && e.t <= a.t1 + 0.05 && (e.msg.type === 'trick' || e.msg.type === 'crash'));
    a.points = ev && ev.msg.type === 'trick' ? ev.msg.points : 0;
    a.name = ev && ev.msg.type === 'trick' ? ev.msg.name : null;
  }
  return { frames, count, duration: (count - 1) * FRAME_DT, events, airs, rails, results: run.results() };
}

// A ghost: your best run on this park, re-ridden alongside you step by step.
export class Ghost {
  constructor(terrain, data) {
    this.run = new Run(terrain);
    if (data.grabSlots) this.run.rider.grabSlots = data.grabSlots.slice();
    this.run.rider.board = !!data.board;
    this.stream = new InputStream(data.inputs);
    this.step = 0;
    this.done = false;
    this.total = data.total;
  }

  advance() {
    if (this.done) return;
    for (const m of this.stream.marksAt(this.step)) if (m.type === 'reset') this.run.resetPosition();
    const inp = this.stream.next();
    if (!inp) {
      this.done = true;
      return;
    }
    this.run.step(inp);
    this.run.messages.length = 0;
    this.step++;
    if (this.run.finished) this.done = true;
  }

  get rider() {
    return this.run.rider;
  }
}
