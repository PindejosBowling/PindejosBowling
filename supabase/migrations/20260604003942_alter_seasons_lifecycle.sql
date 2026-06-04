-- Season config cleanup + lifecycle marker.
--   * league_name is not per-season configuration -> drop it.
--   * started_at/ended_at are admin-configured, user-facing season dates -> rename
--     to start_date/end_date.
--   * is_active marks a season whose registration has closed but is still ongoing.
--     Lifecycle: registration_open = true        -> signup window open
--                registration_open = false, is_active = true  -> ongoing
--                registration_open = false, is_active = false -> completed

alter table public.seasons drop column league_name;

alter table public.seasons rename column started_at to start_date;
alter table public.seasons rename column ended_at to end_date;

alter table public.seasons add column is_active boolean not null default false;

-- Backfill: Season 2 is the current ongoing season (registration already closed),
-- ending 2026-06-29. Season 1 is already completed (end_date set, is_active false).
update public.seasons set is_active = true, end_date = '2026-06-29' where number = 2;
