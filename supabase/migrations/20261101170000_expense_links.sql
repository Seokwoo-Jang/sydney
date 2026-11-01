-- An expense links to several bookings and several itinerary plans (owner, 2026-11-01).
-- Arrays on the expense row keep one version for the whole expense (optimistic locking)
-- and go through create_row / update_row like any other column. The single
-- booking_id / itinerary_item_id columns stay for history; the app no longer writes them.
-- Written to run again safely.

alter table public.expenses add column if not exists booking_ids uuid[] not null default '{}';
alter table public.expenses add column if not exists itinerary_item_ids uuid[] not null default '{}';

-- Copy the existing single links over, quietly (no partner notification for a data move).
alter table public.expenses disable trigger queue_partner_change;
update public.expenses
set booking_ids = array[booking_id]
where booking_id is not null and cardinality(booking_ids) = 0;
update public.expenses
set itinerary_item_ids = array[itinerary_item_id]
where itinerary_item_id is not null and cardinality(itinerary_item_ids) = 0;
alter table public.expenses enable trigger queue_partner_change;

create index if not exists expenses_booking_ids_idx on public.expenses using gin (booking_ids);
create index if not exists expenses_item_ids_idx on public.expenses using gin (itinerary_item_ids);
