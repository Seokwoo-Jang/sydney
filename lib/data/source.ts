// Picks the data source.
//   production                               → Supabase when the public env vars are set, else "unconnected"
//   development                              → mock (default)
//   development + NEXT_PUBLIC_DATA_SOURCE=supabase → Supabase (live checks against the remote project)
// The mock is reachable ONLY inside the `NODE_ENV === 'development'` branch:
// NODE_ENV is inlined at build time, so the dynamic import is dropped from
// production bundles (verified by grepping `out/`).
import type { TripRepository } from './repository';
import { createUnconnectedRepository } from './unconnected';

export async function loadRepository(): Promise<TripRepository> {
  if (process.env.NODE_ENV === 'development') {
    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'supabase') {
      const mock = await import('./mock/repository');
      return mock.getMockRepository();
    }
  }
  // Publishable URL + key only (public by design, RLS-protected). No secret keys in client code.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const { createSupabaseRepository } = await import('./supabase/repository');
    return createSupabaseRepository();
  }
  return createUnconnectedRepository();
}
