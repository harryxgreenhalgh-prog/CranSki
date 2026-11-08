// The Supabase client, loaded only when it's needed: a rider who never signs in
// never downloads it and the game never talks to any server.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AUTH_STORAGE_KEY } from './config.js';

let clientPromise = null;

export function getClient() {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'implicit', // the emailed link works even if opened in another browser
        },
      })
    );
  }
  return clientPromise;
}

export function clientLoaded() {
  return clientPromise !== null;
}

// True if this browser was signed in before, or has just come back from a
// sign-in link, so the client should start straight away.
export function hasSessionHint() {
  try {
    if (localStorage.getItem(AUTH_STORAGE_KEY)) return true;
  } catch {
    /* storage blocked */
  }
  const h = location.hash || '';
  return /access_token=|error_description=|error_code=/.test(h);
}
