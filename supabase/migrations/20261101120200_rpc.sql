-- Sydney, Side by Side: RPCs called by the browser (plan §8).
-- Errors are raised with the machine-readable code as the message
-- (supabase-js: error.message === 'invalid_name', etc.).
--
-- Write results use one shape: {"status": "ok" | "conflict" | "not_found", "row": <row json | null>}
-- Rows are returned as snake_case JSON (to_jsonb of the table row).

-- ── table name resolution and payload checks ──────────────────────────────

-- Accepts the repository entity name or the table name.
create or replace function private.resolve_table(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_name
    when 'days' then 'trip_days'
    when 'trip_days' then 'trip_days'
    when 'itinerary' then 'itinerary_items'
    when 'itinerary_items' then 'itinerary_items'
    when 'prelude' then 'prelude_activities'
    when 'prelude_activities' then 'prelude_activities'
    when 'checklist' then 'checklist_items'
    when 'checklist_items' then 'checklist_items'
    when 'bookings' then 'bookings'
    when 'documents' then 'documents'
    when 'expenses' then 'expenses'
    when 'settlements' then 'settlements'
    when 'journal' then 'journal_entries'
    when 'journal_entries' then 'journal_entries'
    when 'resources' then 'resources'
    when 'assets' then 'file_assets'
    when 'file_assets' then 'file_assets'
    when 'resourceLinks' then 'resource_links'
    when 'resource_links' then 'resource_links'
  end
$$;

-- Client-writable columns present in p_payload. Server columns are dropped;
-- unknown keys raise 'unknown_column' (detail lists them).
create or replace function private.payload_columns(p_table text, p_payload jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_server constant text[] := array['id', 'trip_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'version', 'deleted_at'];
  v_client_only text[] := case when p_table = 'file_assets' then array['url', 'thumb_url'] else '{}'::text[] end;
  v_known text[];
  v_bad text;
  v_cols text[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select array_agg(a.attname::text) into v_known
  from pg_catalog.pg_attribute a
  where a.attrelid = format('public.%I', p_table)::regclass and a.attnum > 0 and not a.attisdropped;

  select string_agg(k, ', ' order by k) into v_bad
  from jsonb_object_keys(p_payload) k
  where k <> all (v_known) and k <> all (v_client_only);
  if v_bad is not null then
    raise exception 'unknown_column' using errcode = '22023', detail = v_bad;
  end if;

  select coalesce(array_agg(k order by k), '{}') into v_cols
  from jsonb_object_keys(p_payload) k
  where k = any (v_known) and k <> all (v_server);
  return v_cols;
end;
$$;

grant execute on function private.resolve_table(text), private.payload_columns(text, jsonb) to authenticated;

-- ── session ────────────────────────────────────────────────────────────────

-- Name entry (plan §8.1-2/3). Links auth.uid() to the fixed profile of the
-- configured trip. Idempotent; re-admits a revoked session.
-- Returns {"id", "trip_id", "profile_key", "display_name"}.
-- Errors: not_signed_in, invalid_name, trip_not_configured.
create or replace function public.enter_trip(p_name text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_name, '')));
  v_trip uuid;
  v_member public.trip_members;
  v_prev public.trip_sessions;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_key not in ('eren', 'amy') then
    raise exception 'invalid_name' using errcode = '22023', hint = 'Enter Eren or Amy.';
  end if;
  v_trip := private.configured_trip();
  select * into v_member from public.trip_members m where m.trip_id = v_trip and m.profile_key = v_key;
  if v_trip is null or v_member.id is null then
    raise exception 'trip_not_configured' using errcode = 'P0001';
  end if;

  select * into v_prev from public.trip_sessions s
  where s.trip_id = v_trip and s.auth_user_id = v_uid
  for update;
  if found and v_prev.member_id <> v_member.id then
    -- This browser switches profile: drop what it held for the previous one.
    delete from public.push_subscriptions p where p.session_id = v_prev.id;
    update public.live_locations l set is_sharing = false, sharing_session_id = null
    where l.sharing_session_id = v_prev.id;
  end if;

  insert into public.trip_sessions as s (trip_id, auth_user_id, member_id)
  values (v_trip, v_uid, v_member.id)
  on conflict (trip_id, auth_user_id) do update
  set member_id = excluded.member_id,
      revoked_at = null,
      admitted_at = case
        when s.revoked_at is not null or s.member_id <> excluded.member_id then now()
        else s.admitted_at
      end,
      last_seen_at = now();

  return json_build_object(
    'id', v_member.id,
    'trip_id', v_member.trip_id,
    'profile_key', v_member.profile_key,
    'display_name', v_member.display_name
  );
end;
$$;

-- Member for the caller's active session, or null.
create or replace function public.my_member()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('id', m.id, 'trip_id', m.trip_id, 'profile_key', m.profile_key, 'display_name', m.display_name)
  from public.trip_sessions s
  join public.trip_members m on m.id = s.member_id and m.trip_id = s.trip_id
  where s.auth_user_id = auth.uid() and s.revoked_at is null and s.trip_id = private.my_trip()
  limit 1
$$;

-- Leave (plan §8.1-6): revokes this browser's session, removes its push
-- subscriptions and stops location sharing from it. The last location stays.
create or replace function public.leave_trip()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then
    return;
  end if;
  with revoked as (
    update public.trip_sessions s set revoked_at = now()
    where s.auth_user_id = auth.uid() and s.revoked_at is null
    returning s.id
  )
  select array_agg(id) into v_ids from revoked;
  if v_ids is null then
    return;
  end if;
  delete from public.push_subscriptions p where p.session_id = any (v_ids);
  update public.live_locations l set is_sharing = false, sharing_session_id = null
  where l.sharing_session_id = any (v_ids);
end;
$$;

create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select statement_timestamp()
$$;

-- ── generic content writes (security invoker: RLS still applies) ──────────

-- Idempotent create with a client UUID (plan §8.2-7). trip_id is forced to the
-- caller's trip. Returns the stored row (existing row on retry).
-- Errors: unknown_table, not_entered, invalid_id, unknown_column, id_conflict,
-- plus constraint violations (23xxx) from the table.
create or replace function public.create_row(p_table text, p_row jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table text := private.resolve_table(p_table);
  v_trip uuid := private.my_trip();
  v_id uuid;
  v_list text;
  v_row jsonb;
begin
  if v_table is null then
    raise exception 'unknown_table' using errcode = '22023', detail = coalesce(p_table, '');
  end if;
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  v_id := private.try_uuid(p_row ->> 'id');
  if v_id is null then
    raise exception 'invalid_id' using errcode = '22023';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into v_row using v_id;
  if v_row is not null then
    if (v_row ->> 'trip_id')::uuid <> v_trip then
      raise exception 'id_conflict' using errcode = '23505';
    end if;
    return v_row;
  end if;

  select string_agg(format('%I', c), ', ')
  into v_list
  from unnest(private.payload_columns(v_table, p_row) || array['id', 'trip_id']) c;

  execute format(
    'insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) '
    'on conflict (id) do nothing returning to_jsonb(t)',
    v_table, v_list)
  into v_row
  using p_row || jsonb_build_object('id', v_id, 'trip_id', v_trip);

  if v_row is null then -- lost a race with the same id
    execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into v_row using v_id;
    if v_row is null or (v_row ->> 'trip_id')::uuid <> v_trip then
      raise exception 'id_conflict' using errcode = '23505';
    end if;
  end if;
  return v_row;
end;
$$;

-- Shared tail of update_row / soft_delete_row when no row was written.
create or replace function private.miss_result(p_table text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into v_row using p_id;
  return jsonb_build_object('status', case when v_row is null then 'not_found' else 'conflict' end, 'row', v_row);
end;
$$;
grant execute on function private.miss_result(text, uuid) to authenticated;

-- Optimistic update (plan §8.2-4). Applies p_patch only when the stored version
-- equals p_expected_version and the row is not soft-deleted. Server columns in
-- the patch are ignored. On a version mismatch or a soft-deleted row returns
-- status 'conflict' with the latest row; an unknown or invisible id → 'not_found'.
create or replace function public.update_row(p_table text, p_id uuid, p_patch jsonb, p_expected_version integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table text := private.resolve_table(p_table);
  v_set text;
  v_row jsonb;
begin
  if v_table is null or v_table = 'resource_links' then
    raise exception 'unknown_table' using errcode = '22023', detail = coalesce(p_table, '');
  end if;
  if private.my_trip() is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;

  select string_agg(format('%I = r.%I', c, c), ', ')
  into v_set
  from unnest(private.payload_columns(v_table, p_patch)) c;

  execute format(
    'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r '
    'where t.id = $2 and t.version = $3 and t.deleted_at is null returning to_jsonb(t)',
    v_table, coalesce(v_set, 'updated_at = now()'))
  into v_row
  using p_patch, p_id, p_expected_version;

  if v_row is not null then
    return jsonb_build_object('status', 'ok', 'row', v_row);
  end if;
  return private.miss_result(v_table, p_id);
end;
$$;

-- Soft delete (plan §8.2-8): sets deleted_at with the same version check.
-- Deleting an itinerary item unlinks its Prelude activities (status -> 'idea'
-- unless 'done') via trigger.
create or replace function public.soft_delete_row(p_table text, p_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table text := private.resolve_table(p_table);
  v_row jsonb;
begin
  if v_table is null or v_table = 'resource_links' then
    raise exception 'unknown_table' using errcode = '22023', detail = coalesce(p_table, '');
  end if;
  if private.my_trip() is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;

  execute format(
    'update public.%I t set deleted_at = now() '
    'where t.id = $1 and t.version = $2 and t.deleted_at is null returning to_jsonb(t)',
    v_table)
  into v_row
  using p_id, p_expected_version;

  if v_row is not null then
    return jsonb_build_object('status', 'ok', 'row', v_row);
  end if;
  return private.miss_result(v_table, p_id);
end;
$$;

-- Trip settings with the same version check. Allowed keys: title, subtitle,
-- start_date, end_date, timezone, home_timezone, display_currency_first, prelude_goal.
create or replace function public.update_trip(p_patch jsonb, p_expected_version integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip uuid := private.my_trip();
  v_allowed constant text[] := array[
    'title', 'subtitle', 'start_date', 'end_date', 'timezone', 'home_timezone', 'display_currency_first', 'prelude_goal'];
  v_server constant text[] := array['id', 'version', 'created_at', 'updated_at', 'updated_by'];
  v_bad text;
  v_set text;
  v_row jsonb;
begin
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select string_agg(k, ', ' order by k) into v_bad
  from jsonb_object_keys(p_patch) k
  where k <> all (v_allowed) and k <> all (v_server);
  if v_bad is not null then
    raise exception 'unknown_column' using errcode = '22023', detail = v_bad;
  end if;

  select string_agg(format('%I = r.%I', k, k), ', ') into v_set
  from jsonb_object_keys(p_patch) k
  where k = any (v_allowed);

  execute format(
    'update public.trips t set %s from jsonb_populate_record(null::public.trips, $1) r '
    'where t.id = $2 and t.version = $3 returning to_jsonb(t)',
    coalesce(v_set, 'updated_at = now()'))
  into v_row
  using p_patch, v_trip, p_expected_version;

  if v_row is not null then
    return jsonb_build_object('status', 'ok', 'row', v_row);
  end if;
  select to_jsonb(t) into v_row from public.trips t where t.id = v_trip;
  return jsonb_build_object('status', case when v_row is null then 'not_found' else 'conflict' end, 'row', v_row);
end;
$$;

-- Upsert the budget for one scope; a null amount removes it.
-- Returns {"status": "ok", "row": <trip_budgets row | null>}.
-- Errors: not_entered, invalid_scope, invalid_amount, invalid_currency.
create or replace function public.set_budget(p_scope text, p_amount_minor bigint, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := private.my_trip();
  v_row jsonb;
begin
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('shared', 'eren', 'amy') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  if p_amount_minor is null then
    delete from public.trip_budgets b where b.trip_id = v_trip and b.scope = p_scope;
    return jsonb_build_object('status', 'ok', 'row', null);
  end if;
  if p_amount_minor < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_currency is null or p_currency not in ('AUD', 'KRW') then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  insert into public.trip_budgets as b (trip_id, scope, amount_minor, currency)
  values (v_trip, p_scope, p_amount_minor, p_currency)
  on conflict (trip_id, scope) do update
  set amount_minor = excluded.amount_minor, currency = excluded.currency
  returning to_jsonb(b) into v_row;
  return jsonb_build_object('status', 'ok', 'row', v_row);
end;
$$;

-- ── live location (plan §7.8) ──────────────────────────────────────────────

-- p_takeover = true: this browser becomes the sharing device (turn on / take
-- over from another device) and the position is stored unconditionally.
-- p_takeover = false: stored only if this browser's session is the sharing
-- session and p_measured_at is newer than the stored one.
-- Returns {"status": "ok" | "stale" | "not_sharing_device", "row": <live_locations row | null>}.
-- Errors: not_entered, invalid_location.
create or replace function public.share_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_measured_at timestamptz,
  p_takeover boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := private.my_trip();
  v_member uuid;
  v_session uuid;
  v_row public.live_locations;
begin
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_measured_at is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m < 0 or p_measured_at > now() + interval '5 minutes' then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  v_member := private.current_member(v_trip);
  v_session := private.current_session(v_trip);

  if coalesce(p_takeover, false) then
    insert into public.live_locations as l
      (trip_id, member_id, lat, lng, accuracy_m, measured_at, updated_at, is_sharing, sharing_session_id)
    values (v_trip, v_member, p_lat, p_lng, p_accuracy_m, p_measured_at, now(), true, v_session)
    on conflict (trip_id, member_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
        measured_at = excluded.measured_at, updated_at = now(),
        is_sharing = true, sharing_session_id = excluded.sharing_session_id
    returning * into v_row;
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(v_row));
  end if;

  update public.live_locations l
  set lat = p_lat, lng = p_lng, accuracy_m = p_accuracy_m, measured_at = p_measured_at, updated_at = now()
  where l.trip_id = v_trip and l.member_id = v_member
    and l.is_sharing and l.sharing_session_id = v_session and l.measured_at < p_measured_at
  returning * into v_row;
  if found then
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(v_row));
  end if;

  select * into v_row from public.live_locations l where l.trip_id = v_trip and l.member_id = v_member;
  if not found then
    return jsonb_build_object('status', 'not_sharing_device', 'row', null);
  end if;
  return jsonb_build_object(
    'status', case when v_row.is_sharing and v_row.sharing_session_id = v_session then 'stale' else 'not_sharing_device' end,
    'row', to_jsonb(v_row));
end;
$$;

-- Turn sharing off for the caller's profile (any device). Keeps the last position.
-- Returns {"status": "ok", "row": <live_locations row | null>}.
create or replace function public.stop_sharing()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := private.my_trip();
  v_row public.live_locations;
begin
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  update public.live_locations l
  set is_sharing = false, sharing_session_id = null
  where l.trip_id = v_trip and l.member_id = private.current_member(v_trip)
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'row', case when found then to_jsonb(v_row) end);
end;
$$;

-- "Clear my last location": deletes the caller's profile row.
create or replace function public.clear_my_location()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := private.my_trip();
begin
  if v_trip is null then
    raise exception 'not_entered' using errcode = '42501';
  end if;
  delete from public.live_locations l
  where l.trip_id = v_trip and l.member_id = private.current_member(v_trip);
end;
$$;

-- ── privileges ─────────────────────────────────────────────────────────────

revoke all on function
  public.enter_trip(text),
  public.my_member(),
  public.leave_trip(),
  public.server_now(),
  public.create_row(text, jsonb),
  public.update_row(text, uuid, jsonb, integer),
  public.soft_delete_row(text, uuid, integer),
  public.update_trip(jsonb, integer),
  public.set_budget(text, bigint, text),
  public.share_location(double precision, double precision, double precision, timestamptz, boolean),
  public.stop_sharing(),
  public.clear_my_location()
from public, anon;

grant execute on function
  public.enter_trip(text),
  public.my_member(),
  public.leave_trip(),
  public.server_now(),
  public.create_row(text, jsonb),
  public.update_row(text, uuid, jsonb, integer),
  public.soft_delete_row(text, uuid, integer),
  public.update_trip(jsonb, integer),
  public.set_budget(text, bigint, text),
  public.share_location(double precision, double precision, double precision, timestamptz, boolean),
  public.stop_sharing(),
  public.clear_my_location()
to authenticated;

grant execute on function public.server_now() to anon;
