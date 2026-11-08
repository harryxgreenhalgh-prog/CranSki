// delete-account: a signed-in rider deletes their own account.
//
// Deleting the Supabase Auth user removes everything stored about them in
// CranSki's database too (every table references the account with ON DELETE
// CASCADE): profile and gamertag, cloud save, friends and requests, online
// status, leaderboard scores and their recorded inputs.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/**
 * @param {Request} req
 * @param {{ userFromToken(token: string): Promise<string|null>, deleteUser(uid: string): Promise<void> }} auth
 */
export async function handle(req, auth) {
  if (req.method === 'OPTIONS') {
    const asked = req.headers.get('Access-Control-Request-Headers');
    return new Response('ok', { headers: { ...CORS, ...(asked ? { 'Access-Control-Allow-Headers': asked } : {}) } });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const uid = token ? await auth.userFromToken(token) : null;
  if (!uid) return json({ error: 'not_signed_in' }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }
  // A deliberate confirmation from the game, so a stray request can't do it.
  if (!body || body.confirm !== 'DELETE') return json({ error: 'not_confirmed' }, 400);
  await auth.deleteUser(uid);
  return json({ ok: true });
}
