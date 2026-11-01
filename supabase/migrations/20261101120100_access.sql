-- Sydney, Side by Side: session helpers, row triggers, privileges, RLS,
-- Storage and Realtime (plan §8.1–8.3).
-- Access rule: auth.uid() must have a non-revoked trip_sessions row for the
-- row's trip. Being `authenticated` (an anonymous sign-in) is not enough.

-- ── session helpers (security definer: they read trip_sessions under RLS) ──

create or replace function private.current_session(p_trip uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.trip_sessions s
  where s.trip_id = p_trip and s.auth_user_id = auth.uid() and s.revoked_at is null
$$;

create or replace function private.current_member(p_trip uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.member_id
  from public.trip_sessions s
  where s.trip_id = p_trip and s.auth_user_id = auth.uid() and s.revoked_at is null
$$;

create or replace function private.is_trip_member(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_sessions s
    where s.trip_id = p_trip and s.auth_user_id = auth.uid() and s.revoked_at is null
  )
$$;

create or replace function private.has_active_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_sessions s where s.auth_user_id = auth.uid() and s.revoked_at is null
  )
$$;

-- The trip enter_trip() admits into: private.app_settings, else the only trip.
create or replace function private.configured_trip()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.active_trip_id from private.app_settings c where c.id),
    (select case when count(*) = 1 then (array_agg(t.id))[1] end from public.trips t)
  )
$$;

-- The caller's active trip (prefers the configured trip).
create or replace function private.my_trip()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.trip_id
  from public.trip_sessions s
  left join private.app_settings c on c.active_trip_id = s.trip_id
  where s.auth_user_id = auth.uid() and s.revoked_at is null
  order by (c.active_trip_id is not null) desc, s.admitted_at desc
  limit 1
$$;

-- Creates the two fixed profiles for a trip (used by the private seed).
create or replace function private.ensure_members(p_trip uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.trip_members (trip_id, profile_key, display_name)
  values (p_trip, 'eren', 'Eren'), (p_trip, 'amy', 'Amy')
  on conflict (trip_id, profile_key) do nothing
$$;

-- ── row triggers ───────────────────────────────────────────────────────────

-- Content rows: server owns id, trip_id, created_*, updated_*, version.
-- For API callers created_by / updated_by come from the caller's active session;
-- SQL run without a JWT (seed, maintenance) may set them explicitly.
create or replace function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_api boolean := auth.uid() is not null;
  v_member uuid;
begin
  if v_api then
    v_member := private.current_member(new.trip_id);
  end if;
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    if v_api then
      new.created_by := v_member;
      new.updated_by := v_member;
    else
      new.updated_by := coalesce(new.updated_by, new.created_by);
    end if;
  else
    new.id := old.id;
    new.trip_id := old.trip_id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.version := old.version + 1;
    new.updated_at := now();
    if v_api then
      new.updated_by := v_member;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'trip_days', 'bookings', 'itinerary_items', 'resources', 'prelude_activities', 'documents',
    'checklist_items', 'expenses', 'settlements', 'journal_entries', 'file_assets'
  ] loop
    execute format(
      'create trigger touch_row before insert or update on public.%I for each row execute function private.touch_row()', t);
  end loop;
end;
$$;

create or replace function private.touch_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.version := old.version + 1;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := private.current_member(new.id);
  end if;
  return new;
end;
$$;
create trigger touch_trip before update on public.trips for each row execute function private.touch_trip();

create or replace function private.touch_budget()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := private.current_member(new.trip_id);
  end if;
  return new;
end;
$$;
create trigger touch_budget before insert or update on public.trip_budgets
  for each row execute function private.touch_budget();

create or replace function private.touch_resource_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  if auth.uid() is not null then
    new.created_by := private.current_member(new.trip_id);
  end if;
  return new;
end;
$$;
create trigger touch_resource_link before insert on public.resource_links
  for each row execute function private.touch_resource_link();

-- itinerary_items.date is always the date of its day.
create or replace function private.sync_item_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_date date;
begin
  select d.date into v_date from public.trip_days d where d.id = new.day_id and d.trip_id = new.trip_id;
  if found then
    new.date := v_date;
  end if;
  return new;
end;
$$;
create trigger sync_item_date before insert or update on public.itinerary_items
  for each row execute function private.sync_item_date();

-- Prelude activity status follows its linked itinerary item (plan §7.3):
--   linked to a planned/confirmed item -> 'planned'; linked to anything else -> 'idea';
--   unlinked -> 'idea'. 'done' is set by hand and never overwritten.
create or replace function private.prelude_link_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    return new;
  end if;
  if new.itinerary_item_id is null then
    if tg_op = 'UPDATE' and old.itinerary_item_id is not null then
      new.status := 'idea';
    end if;
  elsif tg_op = 'INSERT' or new.itinerary_item_id is distinct from old.itinerary_item_id then
    new.status := case
      when exists (
        select 1 from public.itinerary_items i
        where i.id = new.itinerary_item_id and i.trip_id = new.trip_id
          and i.deleted_at is null and i.status in ('planned', 'confirmed')
      ) then 'planned'
      else 'idea'
    end;
  end if;
  return new;
end;
$$;
create trigger prelude_link_status before insert or update on public.prelude_activities
  for each row execute function private.prelude_link_status();

-- Item side: soft delete unlinks activities (-> 'idea'); adopting an item
-- (idea -> planned/confirmed) promotes 'idea' activities to 'planned';
-- returning an item to 'idea' demotes 'planned' activities to 'idea'.
create or replace function private.item_to_prelude()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.prelude_activities p
    set itinerary_item_id = null
    where p.trip_id = new.trip_id and p.itinerary_item_id = new.id;
  elsif new.deleted_at is null and new.status is distinct from old.status then
    if new.status in ('planned', 'confirmed') and old.status not in ('planned', 'confirmed') then
      update public.prelude_activities p
      set status = 'planned'
      where p.trip_id = new.trip_id and p.itinerary_item_id = new.id and p.deleted_at is null and p.status = 'idea';
    elsif new.status = 'idea' then
      update public.prelude_activities p
      set status = 'idea'
      where p.trip_id = new.trip_id and p.itinerary_item_id = new.id and p.deleted_at is null and p.status = 'planned';
    end if;
  end if;
  return null;
end;
$$;
create trigger item_to_prelude after update on public.itinerary_items
  for each row execute function private.item_to_prelude();

-- ── privileges ─────────────────────────────────────────────────────────────
-- "Automatically expose new tables" is off: grant explicitly, anon gets nothing.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- Helpers called from RLS policies, check constraints and invoker triggers.
grant execute on function
  private.is_valid_timezone(text),
  private.try_uuid(text),
  private.current_session(uuid),
  private.current_member(uuid),
  private.is_trip_member(uuid),
  private.has_active_session(),
  private.my_trip()
to authenticated, service_role;

grant select on
  public.trips, public.trip_members, public.trip_sessions, public.trip_budgets, public.fx_rates,
  public.trip_days, public.bookings, public.itinerary_items, public.resources, public.prelude_activities,
  public.documents, public.checklist_items, public.expenses, public.settlements, public.journal_entries,
  public.file_assets, public.resource_links, public.live_locations, public.push_subscriptions
to authenticated;

grant insert, update on
  public.trip_days, public.bookings, public.itinerary_items, public.resources, public.prelude_activities,
  public.documents, public.checklist_items, public.expenses, public.settlements, public.journal_entries,
  public.file_assets
to authenticated;

grant update (title, subtitle, start_date, end_date, timezone, home_timezone, display_currency_first, prelude_goal, updated_at)
  on public.trips to authenticated;
grant insert, delete on public.resource_links to authenticated;
grant delete on public.live_locations to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;

-- Server jobs (Edge Functions with the secret key) bypass RLS but still need privileges.
grant select, insert, update, delete on all tables in schema public to service_role;

-- ── row level security ─────────────────────────────────────────────────────

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_sessions enable row level security;
alter table public.trip_budgets enable row level security;
alter table public.fx_rates enable row level security;
alter table public.resource_links enable row level security;
alter table public.live_locations enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log enable row level security; -- no policies: no client access

create policy trips_select on public.trips for select to authenticated
  using (private.is_trip_member(id));
create policy trips_update on public.trips for update to authenticated
  using (private.is_trip_member(id)) with check (private.is_trip_member(id));

-- Profiles and sessions: read-only for members; written only by enter_trip / leave_trip.
create policy trip_members_select on public.trip_members for select to authenticated
  using (private.is_trip_member(trip_id));
create policy trip_sessions_select on public.trip_sessions for select to authenticated
  using (auth_user_id = (select auth.uid()) and revoked_at is null);

-- Budgets are written by set_budget(); exchange rates by a server job.
create policy trip_budgets_select on public.trip_budgets for select to authenticated
  using (private.is_trip_member(trip_id));
create policy fx_rates_select on public.fx_rates for select to authenticated
  using (private.has_active_session());

-- Content: members of the row's trip can read, add and edit. Deletion is soft
-- (deleted_at via soft_delete_row); there is no DELETE privilege.
do $$
declare
  t text;
begin
  foreach t in array array[
    'trip_days', 'bookings', 'itinerary_items', 'resources', 'prelude_activities', 'documents',
    'checklist_items', 'expenses', 'settlements', 'journal_entries', 'file_assets'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_trip_member(trip_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.is_trip_member(trip_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.is_trip_member(trip_id)) with check (private.is_trip_member(trip_id))',
      t || '_update', t);
  end loop;
end;
$$;

create policy resource_links_select on public.resource_links for select to authenticated
  using (private.is_trip_member(trip_id));
create policy resource_links_insert on public.resource_links for insert to authenticated
  with check (private.is_trip_member(trip_id));
create policy resource_links_delete on public.resource_links for delete to authenticated
  using (private.is_trip_member(trip_id));

-- Locations: every member reads; a profile may delete only its own row.
-- Writes go through share_location / stop_sharing.
create policy live_locations_select on public.live_locations for select to authenticated
  using (private.is_trip_member(trip_id));
create policy live_locations_delete on public.live_locations for delete to authenticated
  using (member_id = private.current_member(trip_id));

-- Push subscriptions: a profile sees and manages only its own devices.
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (member_id = private.current_member(trip_id));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (
    member_id = private.current_member(trip_id)
    and (session_id is null or session_id = private.current_session(trip_id))
  );
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (member_id = private.current_member(trip_id))
  with check (member_id = private.current_member(trip_id));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (member_id = private.current_member(trip_id));

-- ── storage: private bucket, path '<trip_id>/<random>/<file>' ───────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-files', 'trip-files', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy trip_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'trip-files'
    and private.is_trip_member(private.try_uuid((storage.foldername(name))[1]))
  );
create policy trip_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'trip-files'
    and array_length(storage.foldername(name), 1) >= 2
    and private.is_trip_member(private.try_uuid((storage.foldername(name))[1]))
  );
create policy trip_files_update on storage.objects for update to authenticated
  using (
    bucket_id = 'trip-files'
    and private.is_trip_member(private.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'trip-files'
    and private.is_trip_member(private.try_uuid((storage.foldername(name))[1]))
  );
create policy trip_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'trip-files'
    and private.is_trip_member(private.try_uuid((storage.foldername(name))[1]))
  );

-- ── realtime ───────────────────────────────────────────────────────────────

alter publication supabase_realtime add table
  public.trips, public.trip_budgets, public.fx_rates,
  public.trip_days, public.bookings, public.itinerary_items, public.resources, public.prelude_activities,
  public.documents, public.checklist_items, public.expenses, public.settlements, public.journal_entries,
  public.file_assets, public.resource_links, public.live_locations;
