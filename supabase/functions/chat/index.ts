// Supabase Edge Function entry point for chat (see handler.js).
// Uses the project's secret key, provided by Supabase on its servers only.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle, signingKey, CORS } from './handler.js';

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
const secret = secretKey();
const admin = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
// Messages are signed with a key derived from the secret key (optionally a
// separate CHAT_SIGNING_SECRET), so riders can't forge them for reports.
const keyPromise = signingKey(Deno.env.get('CHAT_SIGNING_SECRET') ?? secret);

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin!.rpc(name, args);
  if (error) throw error;
  return data;
}

const deps = {
  key: null as unknown as CryptoKey,
  async userFromToken(token: string) {
    const { data, error } = await admin!.auth.getUser(token);
    return error || !data?.user ? null : data.user.id;
  },
  async gamertagOf(uid: string) {
    const { data } = await admin!.from('profiles').select('gamertag').eq('id', uid).maybeSingle();
    return data?.gamertag ?? null;
  },
  async inParty(uid: string, partyId: string) {
    return (await rpc('party_has_member', { p_party: partyId, p_user: uid })) === true;
  },
  gate: (uid: string) => rpc('chat_gate', { p_user: uid }),
  strike: (uid: string, weight: number) => rpc('chat_strike', { p_user: uid, p_weight: weight }),
  async broadcast(topic: string, event: string, payload: Record<string, unknown>) {
    const ch = admin!.channel(topic, { config: { private: true } });
    try {
      await ch.httpSend(event, payload);
    } finally {
      await admin!.removeChannel(ch);
    }
  },
  async saveReport(row: Record<string, unknown>) {
    const r = await rpc('submit_report', row);
    return r as { ok: boolean; error?: string };
  },
};

Deno.serve(async (req: Request) => {
  if (!admin) {
    console.error('chat: SUPABASE_URL or the secret key is missing from the function environment');
    return new Response(JSON.stringify({ error: 'server_not_configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  try {
    deps.key = await keyPromise;
    return await handle(req, deps);
  } catch (e) {
    console.error('chat failed', e);
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
