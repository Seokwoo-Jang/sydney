-- A checklist item links several Library entries (owner, 2026-11-01), like an itinerary
-- plan or an expense. An array on the row keeps one version for the whole item and goes
-- through create_row / update_row like any column. The single resource_id column stays
-- for history; the app no longer writes it. Written to run again safely.

alter table public.checklist_items add column if not exists resource_ids uuid[] not null default '{}';

-- Copy the existing single links over, quietly (no partner notification for a data move).
alter table public.checklist_items disable trigger queue_partner_change;
update public.checklist_items
set resource_ids = array[resource_id]
where resource_id is not null and cardinality(resource_ids) = 0;
alter table public.checklist_items enable trigger queue_partner_change;

create index if not exists checklist_items_resource_ids_idx on public.checklist_items using gin (resource_ids);
