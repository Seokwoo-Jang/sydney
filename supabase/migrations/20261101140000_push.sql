-- Push notifications (plan §8.5): device subscription RPC, the partner-change
-- queue and the per-minute sender job. The VAPID private key lives only in
-- Supabase secrets (read by the send-push Edge Function); nothing secret here.

-- ── subscriptions ──────────────────────────────────────────────────────────

-- Saves this browser's push subscription for the caller's profile and session.
-- An endpoint identifies one browser, so any earlier row with the same endpoint
-- (another profile or an old session on this browser) is replaced.
-- Returns the saved push_subscriptions row (snake_case JSON).
-- Errors: not_entered, invalid_subscription, invalid_kinds.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text,
  p_enabled_kinds text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all constant text[] := array['schedule', 'flights_car', 'partner_updates', 'countdown'];
  v_trip uuid := private.my_trip();
  v_member uuid;
  v_kinds text[] := coalesce(p_enabled_kinds, v_all);
  v_row public.push_subscriptions;
begin
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  v_member := private.current_member(v_trip);
  if v_member is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  -- Endpoint: a known push service only (FCM, Mozilla, Apple, Windows), since
  -- send-push POSTs to it; same list as webpush.ts isPushService.
  -- p256dh: 65-byte point, auth: 16 bytes, both base64(url).
  if p_endpoint is null or length(p_endpoint) > 2048
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*(push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com))/'
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_+/-]{86,88}={0,2}$'
     or coalesce(p_auth, '') !~ '^[A-Za-z0-9_+/-]{22,24}={0,2}$' then
    raise exception 'invalid_subscription' using errcode = '22023';
  end if;
  if array_position(v_kinds, null) is not null or not (v_kinds <@ v_all) then
    raise exception 'invalid_kinds' using errcode = '22023';
  end if;

  delete from public.push_subscriptions p where p.endpoint = p_endpoint;
  insert into public.push_subscriptions
    (trip_id, member_id, session_id, endpoint, p256dh, auth, device_label, enabled_kinds)
  values (
    v_trip, v_member, private.current_session(v_trip), p_endpoint, p_p256dh, p_auth,
    left(btrim(coalesce(p_device_label, '')), 80),
    array(select k from unnest(v_all) k where k = any (v_kinds)) -- canonical order, no duplicates
  )
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text, text[]) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, text[]) to authenticated;

-- Subscriptions are created only through the RPC above (endpoint and key
-- checks, session link for Leave). Directly, a member may still read its rows,
-- switch kinds and delete them (existing policies).
revoke insert, update on public.push_subscriptions from authenticated;
grant update (enabled_kinds) on public.push_subscriptions to authenticated;

-- ── partner-change queue ───────────────────────────────────────────────────
-- One row per member edit of an itinerary item or booking. send-push batches a
-- partner's rows for 5 minutes (held overnight), notifies the other profile and
-- sets notified_at; notified rows are pruned after 14 days. Server only.

create table public.partner_changes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  actor_member_id uuid not null,
  entity text not null,
  entity_id uuid not null,
  day_date date, -- itinerary rows: the item's day after the change
  changed_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint partner_changes_actor_fkey foreign key (trip_id, actor_member_id)
    references public.trip_members (trip_id, id) on delete cascade,
  constraint partner_changes_entity_check check (entity in ('itinerary', 'booking'))
);
create index partner_changes_pending_idx on public.partner_changes (trip_id, changed_at) where notified_at is null;

alter table public.partner_changes enable row level security; -- no policies: no client access
revoke all on public.partner_changes from public, anon, authenticated;
grant select, insert, update, delete on public.partner_changes to service_role;

-- AFTER trigger on itinerary_items / bookings. Queues a change only when a
-- member made it through the API (auth.uid() set; seeds, maintenance SQL and
-- server jobs stay silent) and something visible changed: an update that only
-- moves version / updated_at / updated_by is ignored. A soft delete counts.
-- Security definer: content writes run as `authenticated`, which has no
-- privileges on the queue.
create or replace function private.queue_partner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(new.updated_by, new.created_by);
  v_meta constant text[] := array['version', 'updated_at', 'updated_by'];
begin
  if v_actor is null or auth.uid() is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_meta) = (to_jsonb(old) - v_meta) then
    return null;
  end if;
  insert into public.partner_changes (trip_id, actor_member_id, entity, entity_id, day_date)
  values (
    new.trip_id,
    v_actor,
    case tg_table_name when 'itinerary_items' then 'itinerary' else 'booking' end,
    new.id,
    -- read through jsonb: bookings have no `date` column
    case tg_table_name when 'itinerary_items' then (to_jsonb(new) ->> 'date')::date end
  );
  return null;
end;
$$;
revoke all on function private.queue_partner_change() from public, anon, authenticated;

create trigger queue_partner_change after insert or update on public.itinerary_items
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.bookings
  for each row execute function private.queue_partner_change();

-- ── sender job ─────────────────────────────────────────────────────────────
-- Every minute. Re-running cron.schedule with the same name replaces the job.
select cron.schedule('send-push', '* * * * *', $$select private.call_function('send-push')$$);
