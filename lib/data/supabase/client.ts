// Browser Supabase client. Uses the PUBLISHABLE key only (public by design,
// protected by RLS). Never reference a secret / service-role key in client code.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Literal property access so Next.js inlines the values at build time.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const AUTH_STORAGE_KEY = 'sydney.auth';
export const BUCKET = 'trip-files';

export function hasSupabaseConfig(): boolean {
  return Boolean(URL && PUBLISHABLE_KEY);
}

let client: SupabaseClient | null = null;

/** One client per page (auth session persisted in localStorage, refreshed automatically). */
export function getSupabase(): SupabaseClient {
  client ??= createClient(URL, PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
    },
  });
  return client;
}
