// Public settings for CranSki's online features (Supabase).
//
// The publishable key is designed to be shipped in browser code: on its own it
// can only do what the Row Level Security policies in supabase/migrations allow.
// The secret (admin) key must NEVER appear in frontend code. Only the
// Edge Functions in supabase/functions use it, and they read it from Supabase's
// own environment on the server.
export const SUPABASE_URL = 'https://owlralulybcvgaaahjbs.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jphDkNXqeNMcgeF42q2ihg_em-WGzW7';

// Where the sign-in session is kept in this browser (localStorage key).
export const AUTH_STORAGE_KEY = 'cranski.auth';

// Live rooms: how many position updates per second a whole room may send
// between them. Supabase's Free plan allows about 100 Realtime messages a
// second for the entire project (Pro: 500), so this leaves room for chat,
// presence and other rooms. Each rider sends up to 12 a second, fewer in busy
// rooms. Raise it if you move to a bigger plan.
export const REALTIME_BUDGET = 60;
