-- Sydney, Side by Side: schema (plan §10).
-- Column names are the snake_case form of lib/types.ts fields.
-- No trip data lives here: the trip row, its two members and the initial
-- content are loaded from a private seed kept outside this repository.

create schema if not exists private;
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;

-- ── pure helpers (no table access) ─────────────────────────────────────────

create or replace function private.is_valid_timezone(p_tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_tz is null or (p_tz !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' and p_tz <> 'UTC') then
    return false;
  end if;
  perform pg_catalog.now() at time zone p_tz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.try_uuid(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end
$$;

-- ── trip, members, sessions ────────────────────────────────────────────────

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text not null default '',
  start_date date not null,
  end_date date not null,
  timezone text not null default 'Australia/Sydney',
  home_timezone text not null default 'Asia/Seoul',
  display_currency_first text not null default 'AUD',
  prelude_goal text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint trips_dates_check check (end_date >= start_date),
  constraint trips_timezone_check check (private.is_valid_timezone(timezone)),
  constraint trips_home_timezone_check check (private.is_valid_timezone(home_timezone)),
  constraint trips_display_currency_first_check check (display_currency_first in ('AUD', 'KRW'))
);

-- Two fixed profiles per trip. Not tied to auth users (plan §8.1).
create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  profile_key text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint trip_members_trip_id_id_key unique (trip_id, id),
  constraint trip_members_trip_id_profile_key_key unique (trip_id, profile_key),
  constraint trip_members_profile_check check (
    (profile_key = 'eren' and display_name = 'Eren') or (profile_key = 'amy' and display_name = 'Amy')
  )
);

alter table public.trips
  add constraint trips_updated_by_fkey foreign key (id, updated_by) references public.trip_members (trip_id, id);

-- One row per (trip, anonymous auth user). Written only by enter_trip / leave_trip.
create table public.trip_sessions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid not null,
  admitted_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  constraint trip_sessions_trip_id_id_key unique (trip_id, id),
  constraint trip_sessions_trip_id_auth_user_id_key unique (trip_id, auth_user_id),
  constraint trip_sessions_member_fkey foreign key (trip_id, member_id)
    references public.trip_members (trip_id, id) on delete cascade
);
create index trip_sessions_active_user_idx on public.trip_sessions (auth_user_id) where revoked_at is null;

-- Which trip enter_trip() admits into. Set by the private seed.
create table private.app_settings (
  id boolean primary key default true check (id),
  active_trip_id uuid references public.trips (id) on delete set null
);
alter table private.app_settings enable row level security;

-- ── budget and exchange rates ──────────────────────────────────────────────

create table public.trip_budgets (
  trip_id uuid not null references public.trips (id) on delete cascade,
  scope text not null,
  amount_minor bigint not null,
  currency text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (trip_id, scope),
  constraint trip_budgets_scope_check check (scope in ('shared', 'eren', 'amy')),
  constraint trip_budgets_amount_minor_check check (amount_minor >= 0),
  constraint trip_budgets_currency_check check (currency in ('AUD', 'KRW')),
  constraint trip_budgets_updated_by_fkey foreign key (trip_id, updated_by) references public.trip_members (trip_id, id)
);

-- Written by a scheduled server job only; members read (plan §7.5.1).
create table public.fx_rates (
  rate_date date not null,
  base text not null default 'AUD',
  quote text not null default 'KRW',
  rate numeric(18, 6) not null,
  source text not null default 'ECB',
  fetched_at timestamptz not null default now(),
  primary key (rate_date, base, quote),
  constraint fx_rates_pair_check check (base = 'AUD' and quote = 'KRW'),
  constraint fx_rates_rate_check check (rate > 0)
);

-- ── content tables ─────────────────────────────────────────────────────────
-- Every content table carries: id, trip_id, created_by, updated_by, created_at,
-- updated_at, version, deleted_at, plus unique (trip_id, id) so children can
-- reference it with a composite FK that pins them to the same trip.

create table public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  date date not null,
  day_number integer not null,
  title text not null default '',
  highlight text not null default '',
  cover_asset_id uuid,
  collage_variant integer not null default 0,
  constraint trip_days_trip_id_id_key unique (trip_id, id),
  constraint trip_days_day_number_check check (day_number between 1 and 99),
  constraint trip_days_collage_variant_check check (collage_variant >= 0)
);
create unique index trip_days_trip_date_key on public.trip_days (trip_id, date) where deleted_at is null;
create unique index trip_days_trip_day_number_key on public.trip_days (trip_id, day_number) where deleted_at is null;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  kind text not null,
  title text not null default '',
  status text not null default 'considering',
  payment_status text not null default 'unpaid',
  reference text,
  notes text not null default '',
  detail jsonb not null,
  constraint bookings_trip_id_id_key unique (trip_id, id),
  constraint bookings_kind_check check (kind in ('flight', 'stay', 'car')),
  constraint bookings_status_check check (status in ('considering', 'booked', 'cancelled')),
  constraint bookings_payment_status_check check (payment_status in ('unpaid', 'paid')),
  constraint bookings_detail_check check (jsonb_typeof(detail) = 'object' and detail ->> 'kind' = kind)
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  day_id uuid not null,
  date date not null, -- copied from the day by trigger
  time_kind text not null default 'timed',
  start_time text, -- 'HH:mm' in `timezone`
  end_time text,
  end_date date,
  timezone text not null default 'Australia/Sydney',
  category text not null,
  status text not null default 'idea',
  title text not null,
  summary text not null default '',
  detail text not null default '',
  place text not null default '',
  map_url text,
  map_lat double precision,
  map_lng double precision,
  map_source text,
  travel_mode text,
  participants text not null default 'together',
  booking_id uuid,
  continues_from_previous_day boolean not null default false,
  sort_order integer not null default 0,
  is_example boolean not null default false,
  constraint itinerary_items_trip_id_id_key unique (trip_id, id),
  constraint itinerary_items_day_fkey foreign key (trip_id, day_id) references public.trip_days (trip_id, id),
  constraint itinerary_items_booking_fkey foreign key (trip_id, booking_id)
    references public.bookings (trip_id, id) on delete set null (booking_id),
  constraint itinerary_items_time_kind_check check (time_kind in ('timed', 'all_day', 'unscheduled')),
  constraint itinerary_items_start_time_check check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint itinerary_items_end_time_check check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint itinerary_items_timed_check check (time_kind <> 'timed' or start_time is not null),
  constraint itinerary_items_end_date_check check (end_date is null or end_date >= date),
  constraint itinerary_items_timezone_check check (private.is_valid_timezone(timezone)),
  constraint itinerary_items_category_check check (category in ('transport', 'explore', 'dining', 'rest', 'business')),
  constraint itinerary_items_status_check check (status in ('idea', 'planned', 'confirmed', 'completed', 'cancelled')),
  constraint itinerary_items_title_check check (btrim(title) <> ''),
  constraint itinerary_items_map_url_check check (map_url ~* '^https://'),
  constraint itinerary_items_map_lat_check check (map_lat between -90 and 90),
  constraint itinerary_items_map_lng_check check (map_lng between -180 and 180),
  constraint itinerary_items_map_source_check check (map_source in ('link', 'search', 'pin')),
  constraint itinerary_items_travel_mode_check check (travel_mode in ('walk', 'transit', 'drive')),
  constraint itinerary_items_participants_check check (participants in ('together', 'eren', 'amy'))
);
create index itinerary_items_trip_date_idx on public.itinerary_items (trip_id, date);
create index itinerary_items_trip_day_idx on public.itinerary_items (trip_id, day_id);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  title text not null,
  url text not null,
  category text not null default 'other',
  note text not null default '',
  pinned_order integer,
  constraint resources_trip_id_id_key unique (trip_id, id),
  constraint resources_title_check check (btrim(title) <> ''),
  constraint resources_url_check check (url ~* '^https?://'),
  constraint resources_category_check check (
    category in ('maps_transport', 'places_dining', 'booking_guides', 'music_connections', 'other')
  ),
  constraint resources_pinned_order_check check (pinned_order between 1 and 4)
);

create table public.prelude_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  kind text not null default 'other',
  title text not null,
  notes text not null default '',
  people_note text not null default '',
  status text not null default 'idea',
  itinerary_item_id uuid,
  resource_id uuid,
  sort_order integer not null default 0,
  is_example boolean not null default false,
  constraint prelude_activities_trip_id_id_key unique (trip_id, id),
  constraint prelude_activities_item_fkey foreign key (trip_id, itinerary_item_id)
    references public.itinerary_items (trip_id, id) on delete set null (itinerary_item_id),
  constraint prelude_activities_resource_fkey foreign key (trip_id, resource_id)
    references public.resources (trip_id, id) on delete set null (resource_id),
  constraint prelude_activities_kind_check check (kind in ('networking', 'performance', 'venue_visit', 'lesson', 'other')),
  constraint prelude_activities_status_check check (status in ('idea', 'planned', 'done')),
  constraint prelude_activities_title_check check (btrim(title) <> '')
);
create index prelude_activities_trip_item_idx on public.prelude_activities (trip_id, itinerary_item_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  title text not null,
  subject_member_id uuid,
  status text not null default 'needed',
  expiry_or_due_date date,
  asset_id uuid, -- FK added after file_assets
  reference_url text,
  constraint documents_trip_id_id_key unique (trip_id, id),
  constraint documents_subject_member_fkey foreign key (trip_id, subject_member_id)
    references public.trip_members (trip_id, id) on delete set null (subject_member_id),
  constraint documents_title_check check (btrim(title) <> ''),
  constraint documents_status_check check (status in ('needed', 'in_progress', 'ready')),
  constraint documents_reference_url_check check (reference_url ~* '^https?://')
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  kind text not null,
  category text not null,
  title text not null,
  assignee text,
  quantity integer,
  due_date date,
  priority text not null default 'normal',
  checked boolean not null default false,
  is_applicable boolean not null default true,
  notes text not null default '',
  booking_id uuid,
  document_id uuid,
  resource_id uuid,
  sort_order integer not null default 0,
  constraint checklist_items_trip_id_id_key unique (trip_id, id),
  constraint checklist_items_booking_fkey foreign key (trip_id, booking_id)
    references public.bookings (trip_id, id) on delete set null (booking_id),
  constraint checklist_items_document_fkey foreign key (trip_id, document_id)
    references public.documents (trip_id, id) on delete set null (document_id),
  constraint checklist_items_resource_fkey foreign key (trip_id, resource_id)
    references public.resources (trip_id, id) on delete set null (resource_id),
  -- category keys mirror lib/data/constants.ts
  constraint checklist_items_category_check check (
    (kind = 'packing' and category in ('travel_essentials', 'toiletries', 'everyday_items', 'music_essentials'))
    or (kind = 'task' and category in ('bookings_documents', 'payments_connectivity', 'before_leaving', 'music_connections'))
  ),
  constraint checklist_items_title_check check (btrim(title) <> ''),
  constraint checklist_items_assignee_check check (assignee in ('eren', 'amy', 'both')),
  constraint checklist_items_quantity_check check (quantity > 0),
  constraint checklist_items_priority_check check (priority in ('low', 'normal', 'high'))
);
create index checklist_items_trip_due_idx on public.checklist_items (trip_id, due_date);

-- Amounts are integers in minor units (AUD cents, KRW won).
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  date date not null,
  kind text not null default 'expense',
  status text not null default 'planned',
  title text not null,
  amount_minor bigint not null,
  currency text not null,
  payer_id uuid,
  split_mode text not null default 'equal',
  split_eren bigint not null default 0,
  split_amy bigint not null default 0,
  budget_scope text not null default 'shared',
  fx_rate numeric(18, 6),
  fx_rate_date date,
  fx_locked boolean not null default false,
  fx_manual boolean not null default false,
  krw_charged_minor bigint,
  category text not null default 'other',
  booking_id uuid,
  itinerary_item_id uuid,
  refund_of_id uuid, -- self FK added below
  constraint expenses_trip_id_id_key unique (trip_id, id),
  constraint expenses_payer_fkey foreign key (trip_id, payer_id)
    references public.trip_members (trip_id, id) on delete set null (payer_id),
  constraint expenses_booking_fkey foreign key (trip_id, booking_id)
    references public.bookings (trip_id, id) on delete set null (booking_id),
  constraint expenses_item_fkey foreign key (trip_id, itinerary_item_id)
    references public.itinerary_items (trip_id, id) on delete set null (itinerary_item_id),
  constraint expenses_kind_check check (kind in ('expense', 'refund')),
  constraint expenses_status_check check (status in ('planned', 'paid', 'cancelled')),
  constraint expenses_title_check check (btrim(title) <> ''),
  constraint expenses_amount_minor_check check (amount_minor >= 0),
  constraint expenses_currency_check check (currency in ('AUD', 'KRW')),
  constraint expenses_split_mode_check check (split_mode in ('equal', 'eren', 'amy', 'custom')),
  constraint expenses_split_check check (split_eren >= 0 and split_amy >= 0 and split_eren + split_amy = amount_minor),
  constraint expenses_budget_scope_check check (budget_scope in ('shared', 'eren', 'amy')),
  constraint expenses_fx_rate_check check (fx_rate > 0),
  constraint expenses_krw_charged_minor_check check (krw_charged_minor >= 0),
  constraint expenses_category_check check (
    category in ('flights', 'stays', 'food', 'transport', 'sightseeing', 'business', 'shopping', 'other')
  ),
  constraint expenses_refund_of_self_check check (refund_of_id <> id)
);
alter table public.expenses
  add constraint expenses_refund_of_fkey foreign key (trip_id, refund_of_id)
    references public.expenses (trip_id, id) on delete set null (refund_of_id);
create index expenses_trip_date_idx on public.expenses (trip_id, date);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  from_member uuid not null,
  to_member uuid not null,
  amount_minor bigint not null,
  currency text not null,
  date date not null,
  fx_rate numeric(18, 6),
  note text not null default '',
  constraint settlements_trip_id_id_key unique (trip_id, id),
  constraint settlements_from_member_fkey foreign key (trip_id, from_member) references public.trip_members (trip_id, id),
  constraint settlements_to_member_fkey foreign key (trip_id, to_member) references public.trip_members (trip_id, id),
  constraint settlements_members_check check (from_member <> to_member),
  constraint settlements_amount_minor_check check (amount_minor > 0),
  constraint settlements_currency_check check (currency in ('AUD', 'KRW')),
  constraint settlements_fx_rate_check check (fx_rate > 0)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  day_id uuid not null,
  author_id uuid not null,
  body text not null default '',
  constraint journal_entries_trip_id_id_key unique (trip_id, id),
  constraint journal_entries_day_fkey foreign key (trip_id, day_id) references public.trip_days (trip_id, id),
  constraint journal_entries_author_fkey foreign key (trip_id, author_id) references public.trip_members (trip_id, id)
);
create unique index journal_entries_day_author_key on public.journal_entries (day_id, author_id) where deleted_at is null;

create table public.file_assets (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  storage_path text not null, -- '<trip_id>/<random>/<file>' in bucket trip-files
  display_path text,
  thumb_path text,
  width integer,
  height integer,
  focal_x double precision not null default 0.5,
  focal_y double precision not null default 0.4,
  zoom double precision not null default 1,
  mime text not null,
  bytes bigint not null default 0,
  kind text not null,
  day_id uuid,
  booking_id uuid,
  document_id uuid,
  caption text not null default '',
  sort_order integer not null default 0,
  constraint file_assets_trip_id_id_key unique (trip_id, id),
  constraint file_assets_storage_path_key unique (storage_path),
  constraint file_assets_day_fkey foreign key (trip_id, day_id)
    references public.trip_days (trip_id, id) on delete set null (day_id),
  constraint file_assets_booking_fkey foreign key (trip_id, booking_id)
    references public.bookings (trip_id, id) on delete set null (booking_id),
  constraint file_assets_document_fkey foreign key (trip_id, document_id)
    references public.documents (trip_id, id) on delete set null (document_id),
  constraint file_assets_paths_check check (
    split_part(storage_path, '/', 1) = trip_id::text
    and (display_path is null or split_part(display_path, '/', 1) = trip_id::text)
    and (thumb_path is null or split_part(thumb_path, '/', 1) = trip_id::text)
  ),
  constraint file_assets_size_check check (width > 0 and height > 0),
  constraint file_assets_focal_check check (focal_x between 0 and 1 and focal_y between 0 and 1),
  constraint file_assets_zoom_check check (zoom between 1 and 8),
  constraint file_assets_mime_check check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint file_assets_kind_check check (kind in ('photo', 'document')),
  constraint file_assets_bytes_check check (
    bytes >= 0 and bytes <= case kind when 'document' then 10485760 else 20971520 end
  )
);
create index file_assets_trip_day_idx on public.file_assets (trip_id, day_id);

alter table public.trip_days
  add constraint trip_days_cover_asset_fkey foreign key (trip_id, cover_asset_id)
    references public.file_assets (trip_id, id) on delete set null (cover_asset_id);
alter table public.documents
  add constraint documents_asset_fkey foreign key (trip_id, asset_id)
    references public.file_assets (trip_id, id) on delete set null (asset_id);

-- Join rows between a Library resource and exactly one target. Hard delete allowed.
create table public.resource_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  resource_id uuid not null,
  itinerary_item_id uuid,
  prelude_activity_id uuid,
  document_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint resource_links_resource_fkey foreign key (trip_id, resource_id)
    references public.resources (trip_id, id) on delete cascade,
  constraint resource_links_item_fkey foreign key (trip_id, itinerary_item_id)
    references public.itinerary_items (trip_id, id) on delete cascade,
  constraint resource_links_activity_fkey foreign key (trip_id, prelude_activity_id)
    references public.prelude_activities (trip_id, id) on delete cascade,
  constraint resource_links_document_fkey foreign key (trip_id, document_id)
    references public.documents (trip_id, id) on delete cascade,
  constraint resource_links_created_by_fkey foreign key (trip_id, created_by) references public.trip_members (trip_id, id),
  constraint resource_links_one_target_check check (num_nonnulls(itinerary_item_id, prelude_activity_id, document_id) = 1),
  constraint resource_links_target_key unique nulls not distinct (resource_id, itinerary_item_id, prelude_activity_id, document_id)
);
create index resource_links_trip_idx on public.resource_links (trip_id);

-- created_by / updated_by point at a member of the same trip.
do $$
declare
  t text;
begin
  foreach t in array array[
    'trip_days', 'bookings', 'itinerary_items', 'resources', 'prelude_activities', 'documents',
    'checklist_items', 'expenses', 'settlements', 'journal_entries', 'file_assets'
  ] loop
    execute format(
      'alter table public.%I add constraint %I foreign key (trip_id, created_by) references public.trip_members (trip_id, id)',
      t, t || '_created_by_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (trip_id, updated_by) references public.trip_members (trip_id, id)',
      t, t || '_updated_by_fkey');
  end loop;
end;
$$;

-- ── live location, push ────────────────────────────────────────────────────

-- Latest position only, one row per profile (plan §7.8). Written by RPCs.
create table public.live_locations (
  trip_id uuid not null references public.trips (id) on delete cascade,
  member_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  measured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  is_sharing boolean not null default false,
  sharing_session_id uuid,
  primary key (trip_id, member_id),
  constraint live_locations_member_fkey foreign key (trip_id, member_id)
    references public.trip_members (trip_id, id) on delete cascade,
  constraint live_locations_session_fkey foreign key (trip_id, sharing_session_id)
    references public.trip_sessions (trip_id, id) on delete set null (sharing_session_id),
  constraint live_locations_lat_check check (lat between -90 and 90),
  constraint live_locations_lng_check check (lng between -180 and 180),
  constraint live_locations_accuracy_check check (accuracy_m >= 0)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  member_id uuid not null,
  session_id uuid,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  device_label text not null default '',
  enabled_kinds text[] not null default array['schedule', 'flights_car', 'partner_updates', 'countdown'],
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_member_fkey foreign key (trip_id, member_id)
    references public.trip_members (trip_id, id) on delete cascade,
  constraint push_subscriptions_session_fkey foreign key (trip_id, session_id)
    references public.trip_sessions (trip_id, id) on delete cascade,
  constraint push_subscriptions_endpoint_check check (endpoint ~ '^https://'),
  constraint push_subscriptions_kinds_check check (
    enabled_kinds <@ array['schedule', 'flights_car', 'partner_updates', 'countdown']::text[]
  )
);
create index push_subscriptions_trip_member_idx on public.push_subscriptions (trip_id, member_id);

-- Server-side only (Edge Function / pg_cron). No client access.
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  member_id uuid not null,
  kind text not null,
  target_id text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint notification_log_dedupe_key unique (member_id, kind, target_id, scheduled_for),
  constraint notification_log_member_fkey foreign key (trip_id, member_id)
    references public.trip_members (trip_id, id) on delete cascade,
  constraint notification_log_kind_check check (
    kind in ('schedule', 'meet_up', 'flight', 'car', 'partner_update', 'countdown')
  ),
  constraint notification_log_status_check check (status in ('pending', 'sent', 'failed', 'skipped'))
);
