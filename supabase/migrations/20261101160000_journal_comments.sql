-- Journal comments and the day's own photo (owner, 2026-11-01).
--
-- 1. Each photo takes one comment from each of us: journal_entries rows with an
--    asset_id. The author is whoever is signed in (set here, never by the
--    client), and only the author edits or deletes it. A photo's text so far
--    (file_assets.caption, written by whoever added it) becomes that person's
--    comment; the caption column stays for older clients but is no longer used.
-- 2. The day's own Nine Notes photo is filed the first time a member opens the
--    Journal (is_default), as if that member had added it, chosen it as the
--    day cover and written "No photos yet." under it (owner, 2026-11-01): from
--    then on it is a photo like any other. Once deleted it stays gone
--    (trip_days.default_photo_removed).
-- 3. Partner updates leave out what other triggers write (a derived status,
--    the filed photo's cover and comment): the change that caused them is news.

-- ── comments ───────────────────────────────────────────────────────────────
-- Written to run again safely (a first push stopped part way).
alter table public.journal_entries add column if not exists asset_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_asset_fkey') then
    alter table public.journal_entries add constraint journal_entries_asset_fkey foreign key (trip_id, asset_id)
      references public.file_assets (trip_id, id);
  end if;
end;
$$;
create index if not exists journal_entries_trip_asset_idx on public.journal_entries (trip_id, asset_id);

-- Day notes (no photo) keep one per day and author; comments one per photo and author.
drop index if exists public.journal_entries_day_author_key;
create unique index journal_entries_day_author_key on public.journal_entries (day_id, author_id)
  where deleted_at is null and asset_id is null;
create unique index if not exists journal_entries_asset_author_key on public.journal_entries (asset_id, author_id)
  where deleted_at is null and asset_id is not null;

-- Author is the caller; a comment belongs to its photo's day. Neither moves later.
create or replace function private.journal_entry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_day uuid;
  v_kind text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.author_id := private.current_member(new.trip_id);
    end if;
    if new.asset_id is not null then
      select a.day_id, a.kind into v_day, v_kind
      from public.file_assets a
      where a.id = new.asset_id and a.trip_id = new.trip_id and a.deleted_at is null;
      if v_kind is distinct from 'photo' or v_day is null then
        raise exception 'invalid_asset' using errcode = '23514';
      end if;
      new.day_id := v_day;
    end if;
  else
    new.author_id := old.author_id;
    new.asset_id := old.asset_id;
    new.day_id := old.day_id;
  end if;
  return new;
end;
$$;
drop trigger if exists journal_entry_guard on public.journal_entries;
create trigger journal_entry_guard before insert or update on public.journal_entries
  for each row execute function private.journal_entry_guard();

-- Only the author edits (and soft-deletes) a comment.
drop policy if exists journal_entries_update on public.journal_entries;
create policy journal_entries_update on public.journal_entries for update to authenticated
  using (private.is_trip_member(trip_id) and author_id = private.current_member(trip_id))
  with check (private.is_trip_member(trip_id) and author_id = private.current_member(trip_id));

-- A photo's text so far becomes its uploader's comment (no JWT here: no notifications).
insert into public.journal_entries (trip_id, day_id, author_id, asset_id, body, created_by, updated_by)
select a.trip_id, a.day_id, a.created_by, a.id, btrim(a.caption), a.created_by, a.created_by
from public.file_assets a
where a.kind = 'photo' and a.deleted_at is null and a.day_id is not null
  and a.created_by is not null and btrim(a.caption) <> ''
  and not exists (
    select 1 from public.journal_entries j
    where j.asset_id = a.id and j.author_id = a.created_by and j.deleted_at is null
  );

-- ── the day's own photo ────────────────────────────────────────────────────
alter table public.file_assets add column if not exists is_default boolean not null default false;
alter table public.trip_days add column if not exists default_photo_removed boolean not null default false;

-- Deleting the day's own photo keeps it from being filed again.
create or replace function private.default_photo_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default and old.deleted_at is null and new.deleted_at is not null and new.day_id is not null then
    update public.trip_days set default_photo_removed = true where id = new.day_id and trip_id = new.trip_id;
  end if;
  return null;
end;
$$;
revoke all on function private.default_photo_removed() from public, anon, authenticated;
drop trigger if exists default_photo_removed on public.file_assets;
create trigger default_photo_removed after update on public.file_assets
  for each row execute function private.default_photo_removed();

-- Filing the day's own photo: it becomes the day cover (unless one is chosen) and
-- carries its filer's comment "No photos yet.".
create or replace function private.default_photo_filed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default and new.day_id is not null and new.deleted_at is null then
    update public.trip_days set cover_asset_id = new.id
    where id = new.day_id and trip_id = new.trip_id and cover_asset_id is null;
    if new.created_by is not null then
      insert into public.journal_entries (trip_id, day_id, author_id, asset_id, body, created_by, updated_by)
      values (new.trip_id, new.day_id, new.created_by, new.id, 'No photos yet.', new.created_by, new.created_by)
      on conflict do nothing;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.default_photo_filed() from public, anon, authenticated;
drop trigger if exists default_photo_filed on public.file_assets;
create trigger default_photo_filed after insert on public.file_assets
  for each row execute function private.default_photo_filed();

-- Partner updates: as before, except that filing the day's own photo and whatever
-- other triggers write are not news.
create or replace function private.queue_partner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_meta constant text[] := array['version', 'updated_at', 'updated_by'];
  v_actor uuid := coalesce((v_new ->> 'updated_by')::uuid, (v_new ->> 'created_by')::uuid);
  v_trip uuid := case when tg_table_name = 'trips' then (v_new ->> 'id')::uuid else (v_new ->> 'trip_id')::uuid end;
  v_entity text;
  v_action text := 'edited';
  v_label text;
  v_day date;
begin
  -- Written by another trigger (a derived status, the filed photo's cover and comment):
  -- the change that caused it is already queued.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if v_actor is null or auth.uid() is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and (v_new - v_meta) = (v_old - v_meta) then
    return null;
  end if;

  case tg_table_name
    when 'itinerary_items' then v_entity := 'itinerary'; v_label := v_new ->> 'title'; v_day := (v_new ->> 'date')::date;
    when 'bookings' then v_entity := 'booking'; v_label := v_new ->> 'title';
    when 'checklist_items' then v_entity := 'checklist'; v_label := v_new ->> 'title';
    when 'documents' then v_entity := 'document'; v_label := v_new ->> 'title';
    when 'prelude_activities' then v_entity := 'prelude'; v_label := v_new ->> 'title';
    when 'resources' then v_entity := 'library'; v_label := v_new ->> 'title';
    when 'expenses' then v_entity := 'expense'; v_label := v_new ->> 'title'; v_day := (v_new ->> 'date')::date;
    when 'settlements' then v_entity := 'settlement';
    when 'trip_budgets' then v_entity := 'budget'; v_label := v_new ->> 'scope';
    when 'journal_entries' then
      v_entity := 'journal';
      select d.date into v_day from public.trip_days d where d.id = (v_new ->> 'day_id')::uuid;
    when 'file_assets' then
      -- Journal photos only; booking and document files are not news on their own.
      if v_new ->> 'day_id' is null then
        return null;
      end if;
      -- The day's own photo is filed by whoever opens the Journal first: not news.
      if tg_op = 'INSERT' and coalesce((v_new ->> 'is_default')::boolean, false) then
        return null;
      end if;
      v_entity := 'photo';
      if tg_op = 'UPDATE' and (v_new - v_meta - 'sort_order') = (v_old - v_meta - 'sort_order') then
        v_label := 'order';
      end if;
      select d.date into v_day from public.trip_days d where d.id = (v_new ->> 'day_id')::uuid;
    when 'trip_days' then
      -- Days come with the trip; members only change them.
      if tg_op <> 'UPDATE' then
        return null;
      end if;
      v_day := (v_new ->> 'date')::date;
      if (v_new -> 'title', v_new -> 'highlight') is distinct from (v_old -> 'title', v_old -> 'highlight') then
        v_entity := 'day';
        v_label := v_new ->> 'title';
      elsif (v_new -> 'cover_asset_id') is distinct from (v_old -> 'cover_asset_id') then
        v_entity := 'photo';
        v_label := 'cover';
      elsif (v_new -> 'collage_variant') is distinct from (v_old -> 'collage_variant') then
        v_entity := 'photo';
        v_label := 'layout';
      else
        return null;
      end if;
    when 'trips' then
      -- Of the trip's own fields only the Prelude goal is shared news.
      if tg_op <> 'UPDATE' or (v_new -> 'prelude_goal') is not distinct from (v_old -> 'prelude_goal') then
        return null;
      end if;
      v_entity := 'goal';
    else
      return null;
  end case;

  if tg_op = 'INSERT' then
    v_action := 'added';
  elsif (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
    v_action := 'deleted';
  elsif (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
    v_action := 'added';
  elsif tg_table_name = 'checklist_items'
    and (v_new -> 'checked') is distinct from (v_old -> 'checked')
    and (v_new - v_meta - 'checked') = (v_old - v_meta - 'checked') then
    v_action := case when (v_new ->> 'checked')::boolean then 'checked' else 'unchecked' end;
  end if;

  begin
    insert into public.partner_changes (trip_id, actor_member_id, entity, entity_id, day_date, action, label)
    values (v_trip, v_actor, v_entity, (v_new ->> 'id')::uuid, v_day, v_action, nullif(left(btrim(v_label), 120), ''));
  exception when others then
    raise warning 'queue_partner_change: %', sqlstate;
  end;
  return null;
end;
$$;
revoke all on function private.queue_partner_change() from public, anon, authenticated;
