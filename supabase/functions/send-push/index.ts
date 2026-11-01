// Push notifications (plan §8.5). Called every minute by pg_cron (see the
// *_push.sql migration) with the shared x-cron-secret header; deployed with
// --no-verify-jwt because the caller is the database, not a user.
//
// 1. Loads each trip's snapshot and asks plan.ts what is due now.
// 2. Claims every (notification, member) pair in notification_log; a pair that
//    already exists was handled by an earlier run and is skipped, unless that
//    run failed for a reason worth retrying (then it is retried while due).
// 3. Sends to each of that member's devices that has the kind switched on.
//    404/410 → the subscription is gone and is deleted.
// 4. Marks the partner changes it reported and prunes old ones.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { KIND_GROUP, TIMED_KINDS, planNotifications, type DueNotification, type Snapshot } from './plan.ts';
import { buildPushRequest, isPushService, type VapidKeys } from './webpush.ts';

const TTL_S = 3600;
const PRUNE_AFTER_MS = 14 * 86_400_000;
const STALE_CLAIM_MS = 2 * 60_000; // a 'pending' claim this old belongs to a run that stopped
const ID_CHUNK = 100; // ids per `in` filter (request URL length)

/** A reminder sent as one of these is not sent again as the other when the day's plan changes. */
const TWIN: Partial<Record<DueNotification['kind'], DueNotification['kind']>> = {
  schedule: 'meet_up',
  meet_up: 'schedule',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time comparison of the shared secret. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Device {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled_kinds: string[];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameSecret(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }
  const vapid: VapidKeys = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? '',
  };
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ error: 'vapid_not_configured' }, 500);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const now = new Date();
  const stats = { due: 0, sent: 0, failed: 0, removed: 0 };

  /**
   * Sends one notification to a member's devices. 'sent' when at least one
   * device accepted it; 'failed' when one may still accept it on a retry
   * (network error, 429, 5xx); otherwise 'skipped' (switched off, gone or rejected).
   */
  const deliver = async (n: DueNotification, list: Device[]): Promise<'sent' | 'failed' | 'skipped'> => {
    const group = KIND_GROUP[n.kind];
    const targets = list.filter((d) => d.enabled_kinds?.includes(group) && isPushService(d.endpoint));
    if (!targets.length) return 'skipped';
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag });
    let ok = 0;
    let retry = 0;
    for (const d of targets) {
      try {
        const r = await buildPushRequest(d, payload, vapid, {
          ttl: TTL_S,
          urgency: TIMED_KINDS.has(n.kind) ? 'high' : 'normal',
          topic: n.kind === 'partner_update' ? 'partner-updates' : undefined,
        });
        const res = await fetch(r.url, {
          method: 'POST',
          headers: r.headers,
          body: r.body,
          signal: AbortSignal.timeout(10_000),
        });
        await res.body?.cancel();
        if (res.ok) {
          ok++;
          stats.sent++;
          await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', d.id);
        } else if (res.status === 404 || res.status === 410) {
          stats.removed++;
          await db.from('push_subscriptions').delete().eq('id', d.id);
          list.splice(list.indexOf(d), 1);
        } else {
          stats.failed++;
          if (res.status === 429 || res.status >= 500) retry++;
          console.warn(`push ${n.kind} → ${res.status}`);
        }
      } catch (e) {
        stats.failed++;
        retry++;
        console.warn(`push ${n.kind} → ${e instanceof Error ? e.name : 'error'}`);
      }
    }
    return ok ? 'sent' : retry ? 'failed' : 'skipped';
  };

  /** Marks partner changes as reported, in chunks that keep the request URL short. */
  const markReported = async (ids: string[]): Promise<void> => {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const r = await db
        .from('partner_changes')
        .update({ notified_at: new Date().toISOString() })
        .in('id', ids.slice(i, i + ID_CHUNK));
      if (r.error) {
        console.warn('partner_changes: mark failed'); // the next run finds the batch done and marks it again
        return;
      }
    }
  };

  const trips = await db.from('trips').select('id, start_date, end_date, timezone, home_timezone');
  if (trips.error) return json({ error: 'read_failed' }, 500);

  for (const trip of trips.data ?? []) {
    // Item reminders fire 30 min before the start; ±2 calendar days covers every zone.
    const [members, items, bookings, tasks, changes] = await Promise.all([
      db.from('trip_members').select('id, profile_key, display_name').eq('trip_id', trip.id),
      db
        .from('itinerary_items')
        .select('id, date, time_kind, start_time, timezone, status, participants, title, place, sort_order, is_example, deleted_at')
        .eq('trip_id', trip.id)
        .eq('time_kind', 'timed')
        .is('deleted_at', null)
        .gte('date', isoDay(now.getTime() - 2 * 86_400_000))
        .lte('date', isoDay(now.getTime() + 2 * 86_400_000)),
      // `reference` and `notes` are never selected.
      db
        .from('bookings')
        .select('id, kind, status, deleted_at, detail')
        .eq('trip_id', trip.id)
        .in('kind', ['flight', 'car'])
        .eq('status', 'booked')
        .is('deleted_at', null),
      db
        .from('checklist_items')
        .select('id, kind, title, assignee, due_date, checked, is_applicable, booking_id, deleted_at')
        .eq('trip_id', trip.id)
        .eq('kind', 'task')
        .eq('checked', false)
        .is('deleted_at', null)
        .not('booking_id', 'is', null),
      db
        .from('partner_changes')
        .select('id, actor_member_id, entity, entity_id, day_date, changed_at, notified_at')
        .eq('trip_id', trip.id)
        .is('notified_at', null)
        .order('changed_at')
        .limit(500),
    ]);
    if (members.error || items.error || bookings.error || tasks.error || changes.error) {
      return json({ error: 'read_failed' }, 500);
    }
    const snapshot: Snapshot = {
      trip,
      members: members.data ?? [],
      items: items.data ?? [],
      bookings: bookings.data ?? [],
      tasks: tasks.data ?? [],
      changes: changes.data ?? [],
    };

    let due: DueNotification[];
    try {
      due = planNotifications(snapshot, now);
    } catch (e) {
      console.warn(`plan failed: ${e instanceof Error ? e.message : 'error'}`); // skip this trip, keep the others
      continue;
    }

    /** A member's devices; null when they could not be read (the claim is then retried). */
    const devices = new Map<string, Device[]>();
    const devicesOf = async (memberId: string): Promise<Device[] | null> => {
      if (!devices.has(memberId)) {
        const r = await db
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth, enabled_kinds')
          .eq('trip_id', trip.id)
          .eq('member_id', memberId);
        if (r.error) return null;
        devices.set(memberId, r.data ?? []);
      }
      return devices.get(memberId)!;
    };

    const keyOf = (n: DueNotification, memberId: string) => ({
      member_id: memberId,
      kind: n.kind,
      target_id: n.targetId,
      scheduled_for: n.scheduledFor,
    });

    /**
     * Claims one (notification, member) pair in notification_log and returns its
     * row id: a new pair, or one an earlier run marked 'failed' or left 'pending'
     * for over 2 min (created_at doubles as the claim time). Null when it is done,
     * held by another run, or already sent as its schedule / meet-up twin.
     */
    const claim = async (n: DueNotification, memberId: string): Promise<string | null> => {
      const key = keyOf(n, memberId);
      const twin = TWIN[n.kind];
      if (twin) {
        const seen = await db
          .from('notification_log')
          .select('id')
          .match({ ...key, kind: twin })
          .in('status', ['pending', 'sent'])
          .limit(1);
        if (seen.error || seen.data?.length) return null;
      }
      const fresh = await db
        .from('notification_log')
        .upsert({ trip_id: trip.id, ...key }, { onConflict: 'member_id,kind,target_id,scheduled_for', ignoreDuplicates: true })
        .select('id');
      if (fresh.error) return null;
      if (fresh.data?.length) return fresh.data[0].id;
      const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      const again = await db
        .from('notification_log')
        .update({ status: 'pending', created_at: new Date().toISOString() })
        .match(key)
        .or(`status.eq.failed,and(status.eq.pending,created_at.lt."${stale}")`)
        .select('id');
      return again.data?.[0]?.id ?? null;
    };

    /** True when the pair was sent (or had nowhere to go) in an earlier run. */
    const isDone = async (n: DueNotification, memberId: string): Promise<boolean> => {
      const r = await db.from('notification_log').select('status').match(keyOf(n, memberId)).maybeSingle();
      return r.data?.status === 'sent' || r.data?.status === 'skipped';
    };

    for (const n of due) {
      for (const memberId of n.memberIds) {
        const id = await claim(n, memberId);
        if (!id) {
          // A partner batch an earlier run handled but could not mark: mark it now.
          if (n.changeIds && (await isDone(n, memberId))) await markReported(n.changeIds);
          continue;
        }
        stats.due++;
        const list = await devicesOf(memberId);
        const status = list ? await deliver(n, list) : 'failed';
        await db
          .from('notification_log')
          .update({ status, sent_at: status === 'sent' ? new Date().toISOString() : null })
          .eq('id', id);
        // A failed batch stays pending and is sent again (with any newer changes) next run.
        if (n.changeIds && status !== 'failed') await markReported(n.changeIds);
      }
    }
  }

  await db
    .from('partner_changes')
    .delete()
    .lt('notified_at', new Date(now.getTime() - PRUNE_AFTER_MS).toISOString());

  return json({ ok: true, ...stats });
});
