-- Guard against destroying real game data: a season may only be deleted while it
-- is still in the "Open" (registration) state. Once registration closes the season
-- accrues weeks, scores, standings, pin_ledger, etc., and deleting it would cascade
-- away tons of actual history. Enforce in the DB so no caller can bypass it.

create or replace function public.prevent_non_open_season_delete()
returns trigger
language plpgsql
as $$
begin
  if old.registration_open is not true then
    raise exception
      'Season % cannot be deleted: only seasons with open registration may be removed.',
      old.number
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_non_open_season_delete on public.seasons;
create trigger prevent_non_open_season_delete
  before delete on public.seasons
  for each row
  execute function public.prevent_non_open_season_delete();
