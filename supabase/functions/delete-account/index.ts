// Supabase Edge Function entry point for delete-account (see handler.js).
// Uses the project's secret key, provided by Supabase on its servers only.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle, CORS } from './handler.js';

function secretKey(): string {
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

const auth = {
  async userFromToken(token: string): Promise<string | null> {
    const { data, error } = await admin!.auth.getUser(token);
    return error || !data?.user ? null : data.user.id;
  },
  async deleteUser(uid: string): Promise<void> {
    const { error } = await admin!.auth.admin.deleteUser(uid);
    if (error) throw error;
  },
};

Deno.serve(async (req: Request) => {
  if (!admin) {
    console.error('delete-account: SUPABASE_URL or the secret key is missing from the function environment');
    return new Response(JSON.stringify({ error: 'server_not_configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  try {
    return await handle(req, auth);
  } catch (e) {
    console.error('delete-account failed', e);
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
