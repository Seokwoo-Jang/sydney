-- Partner updates for every part of the trip, sent at once (owner, 2026-11-01).
-- Every content table queues a change when a member edits it, with what happened
-- (added / edited / deleted / checked / unchecked) and the record's title at that
-- moment, and each queued change wakes send-push straight away. send-push no
-- longer batches for 5 minutes or holds changes overnight.
--
-- The queue never carries journal text, notes or amounts: only titles, which
-- send-push still cleans of coordinates before they reach a lock screen.

alter table public.partner_changes
  drop constraint partner_changes_entity_check,
  add column action text not null default 'edited',
  add column label text,
  -- Set by the send-push run that reports the change, so two runs never report it twice.
  add column claimed_at timestamptz,
  add constraint partner_changes_entity_check check (entity in (
    'itinerary', 'day', 'booking', 'checklist', 'document', 'prelude', 'goal',
    'journal', 'photo', 'library', 'expense', 'settlement', 'budget')),
  add constraint partner_changes_action_check check (action in ('added', 'edited', 'deleted', 'checked', 'unchecked')),
  add constraint partner_changes_label_check check (label is null or char_length(label) <= 120);

-- AFTER trigger on every content table. Queues a change only when a member made
-- it through the API (auth.uid() set; seeds, maintenance SQL and server jobs stay
-- silent) and something visible changed: an update that only moves version /
-- updated_at / updated_by is ignored. A soft delete counts. Never fails the save:
-- a problem here only costs the notification.
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

-- itinerary_items and bookings already have the trigger (20261101140000_push.sql).
create trigger queue_partner_change after insert or update on public.trips
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.trip_days
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.trip_budgets
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.checklist_items
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.documents
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.prelude_activities
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.journal_entries
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.file_assets
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.resources
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.expenses
  for each row execute function private.queue_partner_change();
create trigger queue_partner_change after insert or update on public.settlements
  for each row execute function private.queue_partner_change();

-- Each queued change wakes send-push at once (pg_net sends after the commit) instead
-- of waiting for the next minute. The request says why, so send-push waits a moment
-- for the rest of the same save. Never fails the save.
create or replace function private.wake_send_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is not null and v_secret is not null then
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/send-push',
      body := '{"reason":"change"}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      timeout_milliseconds := 15000
    );
  end if;
  return null;
exception when others then
  raise warning 'wake_send_push: %', sqlstate;
  return null;
end;
$$;
revoke all on function private.wake_send_push() from public, anon, authenticated;

create trigger wake_send_push after insert on public.partner_changes
  for each statement execute function private.wake_send_push();
