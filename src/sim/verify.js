// Re-ride a recorded run from its inputs alone and score it.
//
// This is the leaderboard referee. The submit-run Edge Function runs exactly
// this code (bundled into supabase/functions/submit-run/sim.js by
// `npm run build:sim`), so a run only counts if the server, starting from the
// same inputs, gets the same score the player saw.
import { Terrain } from './terrain.js';
import { Run } from './run.js';
import { DT } from './constants.js';
import { InputStream, SIM_VERSION, unpackRuns } from '../replay/record.js';
import { park as bigair } from '../parks/bigair.js';
import { park as yard } from '../parks/yard.js';
import { park as apex } from '../parks/apex.js';
import { park as forest } from '../parks/forest.js';
import { park as pipe } from '../parks/pipe.js';
import { park as bellevue } from '../parks/bellevue.js';

export { SIM_VERSION };

// Parks with a leaderboard (SHIRAKUMO is ghosts-only).
export const LEADERBOARD_PARKS = { bigair, yard, apex, forest, pipe, bellevue };

export const GRABS = ['mute', 'tail', 'japan', 'safety', 'blunt', 'rocket', 'truenose', 'backscratcher'];
export const MAX_STEPS = Math.round(15 * 60 / DT); // 15 minutes at 120 Hz
const MAX_MARKS = 100;
const MAX_AFTER_FINISH = 24; // a frame can record a few steps past the line

const terrains = new Map();
function terrainFor(id) {
  if (!terrains.has(id)) terrains.set(id, new Terrain(LEADERBOARD_PARKS[id]));
  return terrains.get(id);
}

// Check a submission's shape. Returns null if fine, else a reason.
export function checkSubmission(sub) {
  if (!sub || typeof sub !== 'object') return 'bad_request';
  if (sub.version !== SIM_VERSION) return 'old_version';
  if (!Object.hasOwn(LEADERBOARD_PARKS, sub.park)) return 'no_leaderboard';
  if (!Number.isInteger(sub.steps) || sub.steps < 1 || sub.steps > MAX_STEPS) return 'bad_inputs';
  if (typeof sub.inputs !== 'string' || sub.inputs.length > 400000) return 'bad_inputs';
  if (!Array.isArray(sub.grabSlots) || sub.grabSlots.length !== 3 || !sub.grabSlots.every((g) => GRABS.includes(g))) return 'bad_inputs';
  if (typeof sub.board !== 'boolean') return 'bad_inputs';
  if (!Array.isArray(sub.marks) || sub.marks.length > MAX_MARKS) return 'bad_inputs';
  for (const m of sub.marks) {
    if (!m || m.type !== 'reset' || !Number.isInteger(m.step) || m.step < 0 || m.step > sub.steps) return 'bad_inputs';
  }
  if (!sub.claimed || !Number.isFinite(sub.claimed.total)) return 'bad_request';
  return null;
}

// Re-ride a submission. Returns { ok, reason, results, steps }.
// reason: 'bad_inputs' | 'not_finished' | 'mismatch' (ok is true only when
// the run reached the finish line and the score matches what was claimed).
export function rerun(sub) {
  const problem = checkSubmission(sub);
  if (problem) return { ok: false, reason: problem };
  let runs;
  try {
    runs = unpackRuns(sub.inputs);
  } catch {
    return { ok: false, reason: 'bad_inputs' };
  }
  if (runs.length % 2 !== 0) return { ok: false, reason: 'bad_inputs' };
  let total = 0;
  for (let i = 0; i < runs.length; i += 2) {
    if (runs[i] >= 4096 || runs[i + 1] === 0) return { ok: false, reason: 'bad_inputs' };
    total += runs[i + 1];
  }
  if (total !== sub.steps) return { ok: false, reason: 'bad_inputs' };

  const run = new Run(terrainFor(sub.park));
  run.rider.grabSlots = sub.grabSlots.slice();
  run.rider.board = sub.board;
  const stream = new InputStream({ runs, steps: sub.steps, marks: sub.marks });
  let step = 0;
  while (!run.finished) {
    for (const m of stream.marksAt(step)) if (m.type === 'reset') run.resetPosition();
    const inp = stream.next();
    if (!inp) break;
    run.step(inp);
    run.messages.length = 0;
    step++;
  }
  const results = run.results();
  if (!run.finished) return { ok: false, reason: 'not_finished', results, steps: step };
  if (sub.steps - step > MAX_AFTER_FINISH) return { ok: false, reason: 'bad_inputs', results, steps: step };
  if (results.total !== sub.claimed.total) return { ok: false, reason: 'mismatch', results, steps: step };
  return { ok: true, results, steps: step };
}
