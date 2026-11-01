// Daily AUD→KRW reference rate (plan §7.5.1). Called by pg_cron (see the
// *_schedules.sql migration) with the shared x-cron-secret header; deployed
// with --no-verify-jwt because the caller is the database, not a user.
//
// 1. Fetches ECB rates from Frankfurter for every business day since the last
//    stored one (first run: the last 60 days) and upserts them into fx_rates.
// 2. Confirms paid expenses that were saved with a provisional rate: once a
//    rate exists on or after the payment date, the rate in force on that date
//    (latest business day ≤ date) is stored once and locked. Manual rates are
//    never touched.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SOURCE = 'https://api.frankfurter.dev/v1';
const FIRST_RUN_DAYS = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Constant-time comparison of the shared secret. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** One function so the rate source can change later (plan §7.5.1). */
async function fetchRates(from: string): Promise<Array<{ date: string; rate: number }>> {
  const res = await fetch(`${SOURCE}/${from}..?base=AUD&symbols=KRW`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`rates ${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, { KRW?: number }> };
  return Object.entries(body.rates ?? {})
    .map(([date, r]) => ({ date, rate: Number(r?.KRW) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.rate) && r.rate > 0);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameSecret(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // ── 1. rates ──
  const last = await db.from('fx_rates').select('rate_date').order('rate_date', { ascending: false }).limit(1);
  if (last.error) return json({ error: 'read_failed' }, 500);
  const start = last.data?.[0]?.rate_date
    ? new Date(Date.parse(`${last.data[0].rate_date}T00:00:00Z`) + 86_400_000)
    : new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000);
  let fetched: Array<{ date: string; rate: number }> = [];
  if (isoDay(start) <= isoDay(new Date())) {
    try {
      fetched = await fetchRates(isoDay(start));
    } catch (e) {
      return json({ error: 'source_failed', detail: String(e) }, 502);
    }
  }
  if (fetched.length) {
    const up = await db.from('fx_rates').upsert(
      fetched.map((r) => ({ rate_date: r.date, base: 'AUD', quote: 'KRW', rate: r.rate, source: 'ECB', fetched_at: new Date().toISOString() })),
      { onConflict: 'rate_date,base,quote' },
    );
    if (up.error) return json({ error: 'write_failed' }, 500);
  }

  // ── 2. confirm provisional rates on paid expenses ──
  const newest = await db.from('fx_rates').select('rate_date').order('rate_date', { ascending: false }).limit(1);
  const newestDate: string | undefined = newest.data?.[0]?.rate_date;
  let confirmed = 0;
  if (newestDate) {
    const open = await db
      .from('expenses')
      .select('id, date, version')
      .eq('status', 'paid')
      .eq('fx_locked', false)
      .eq('fx_manual', false)
      .is('deleted_at', null)
      .lte('date', newestDate);
    for (const e of open.data ?? []) {
      const r = await db
        .from('fx_rates')
        .select('rate, rate_date')
        .lte('rate_date', e.date)
        .order('rate_date', { ascending: false })
        .limit(1);
      const rate = r.data?.[0];
      if (!rate) continue;
      // Only if still provisional and unchanged since read (the version guards against a concurrent edit).
      const u = await db
        .from('expenses')
        .update({ fx_rate: rate.rate, fx_rate_date: rate.rate_date, fx_locked: true })
        .eq('id', e.id)
        .eq('version', e.version)
        .eq('fx_locked', false)
        .eq('fx_manual', false)
        .select('id');
      if (!u.error && u.data?.length) confirmed++;
    }
  }

  return json({ ok: true, fetched: fetched.length, newest: newestDate ?? null, confirmed });
});
