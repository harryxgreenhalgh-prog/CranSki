// Supabase Edge Function entry point for submit-run (see handler.js).
//
// It uses the project's secret key, which Supabase provides to Edge Functions
// on its own servers. The key never appears in this repository or in the game.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle, CORS } from './handler.js';

function secretKey(): string {
  // Projects on the new API keys get a JSON object of named secret keys.
  const named = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (named) {
    try {
      const keys = JSON.parse(named) as Record<string, string>;
      const key = keys.default ?? Object.values(keys)[0];
      if (key) return key;
    } catch {
      // fall through to the single-key variables
    }
  }
  return Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const url = Deno.env.get('SUPABASE_URL') ?? '';
const key = secretKey();
const admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;

const db = {
  async userFromToken(token: string): Promise<string | null> {
    const { data, error } = await admin!.auth.getUser(token);
    return error || !data?.user ? null : data.user.id;
  },
  async hasGamertag(uid: string): Promise<boolean> {
    const { data, error } = await admin!.from('profiles').select('id').eq('id', uid).maybeSingle();
    if (error) throw error;
    return !!data;
  },
  async noteSubmission(uid: string): Promise<boolean> {
    const { data, error } = await admin!.rpc('note_submission', { p_user: uid });
    if (error) throw error;
    return data === true;
  },
  async recordMatchRun(args: Record<string, unknown>) {
    const { data, error } = await admin!.rpc('ranked_record_run', args);
    if (error) throw error;
    return data;
  },
  async recordScore(args: Record<string, unknown>) {
    const { data, error } = await admin!.rpc('record_score', args);
    if (error) throw error;
    return data;
  },
};

Deno.serve(async (req: Request) => {
  if (!admin) {
    console.error('submit-run: SUPABASE_URL or the secret key is missing from the function environment');
    return new Response(JSON.stringify({ error: 'server_not_configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  try {
    return await handle(req, db);
  } catch (e) {
    console.error('submit-run failed', e);
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
