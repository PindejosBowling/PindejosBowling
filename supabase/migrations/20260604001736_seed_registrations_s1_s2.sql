-- Backfill registrations for the two existing seasons from players who actually
-- played: distinct non-fill team_slots on archived weeks. Both seasons remain
-- registration_open = false (column default) since their rosters are already set.

insert into public.registrations (season_id, player_id)
select distinct w.season_id, ts.player_id
from public.team_slots ts
join public.teams t on t.id = ts.team_id
join public.weeks w on w.id = t.week_id
where w.is_archived = true
  and ts.player_id is not null
  and w.season_id in (1, 2)
on conflict (season_id, player_id) do nothing;
