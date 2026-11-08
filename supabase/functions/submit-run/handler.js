// submit-run: the leaderboard referee.
//
// The game sends a finished run as its recorded inputs plus the score the
// player saw. This re-rides the inputs through the same deterministic
// simulation (sim.js, bundled from src/sim/verify.js) and:
//   - rejects the run if the re-ride doesn't reach the finish line or its score
//     doesn't match the claimed one;
//   - otherwise saves the score it calculated itself (never the claimed one).
//
// Plain JavaScript so the Node tests can run it too; index.ts wires it to
// Supabase.
import { rerun, SIM_VERSION } from './sim.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_BODY = 600000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/**
 * @param {Request} req
 * @param {{
 *   userFromToken(token: string): Promise<string|null>,
 *   hasGamertag(uid: string): Promise<boolean>,
 *   noteSubmission(uid: string): Promise<boolean>,
 *   recordScore(args: object): Promise<{best: number, improved: boolean, rank: number}>,
 * }} db
 */
export async function handle(req, db) {
  if (req.method === 'OPTIONS') {
    // Allow whatever headers the browser's client library asks to send.
    const asked = req.headers.get('Access-Control-Request-Headers');
    return new Response('ok', { headers: { ...CORS, ...(asked ? { 'Access-Control-Allow-Headers': asked } : {}) } });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Who is submitting? The game sends the rider's own session token.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const uid = token ? await db.userFromToken(token) : null;
  if (!uid) return json({ error: 'not_signed_in' }, 401);
  if (!(await db.hasGamertag(uid))) return json({ error: 'no_gamertag' }, 403);

  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: 'too_big' }, 413);
  let sub;
  try {
    sub = JSON.parse(text);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!sub || sub.version !== SIM_VERSION) return json({ error: 'old_version', sim_version: SIM_VERSION }, 409);
  if (!(await db.noteSubmission(uid))) return json({ error: 'slow_down' }, 429);

  // Re-ride the run from its inputs.
  const r = rerun(sub);
  if (!r.ok) {
    const status = r.reason === 'mismatch' || r.reason === 'not_finished' ? 422 : 400;
    return json({ error: r.reason, server_total: r.results ? r.results.total : null }, status);
  }

  // Save only what the server calculated.
  const res = r.results;
  const saved = await db.recordScore({
    p_user: uid,
    p_park: sub.park,
    p_total: res.total,
    p_time: res.time,
    p_best_trick: res.bestTrick ? res.bestTrick.name : null,
    p_top_speed: res.topSpeedKmh,
    p_airtime: res.airtime,
    p_sim_version: SIM_VERSION,
    p_steps: sub.steps,
    p_inputs: sub.inputs,
    p_marks: sub.marks,
    p_grab_slots: sub.grabSlots,
    p_board: sub.board,
  });
  return json({ ok: true, total: res.total, best: saved.best, improved: saved.improved, rank: saved.rank });
}
