-- A Prelude plan links several Library entries (owner, 2026-11-01). Its links are its
-- resource_links rows (prelude_activity_id), which were already many-to-many; the single
-- prelude_activities.resource_id is no longer read or written by the app. Any plan whose
-- single link has no row yet gets one, so nothing is lost. Written to run again safely.

insert into public.resource_links (trip_id, resource_id, prelude_activity_id, created_by)
select a.trip_id, a.resource_id, a.id, a.updated_by
from public.prelude_activities a
join public.resources r on r.trip_id = a.trip_id and r.id = a.resource_id and r.deleted_at is null
where a.resource_id is not null
  and a.deleted_at is null
  and not exists (
    select 1 from public.resource_links l
    where l.trip_id = a.trip_id and l.prelude_activity_id = a.id and l.resource_id = a.resource_id
  );
