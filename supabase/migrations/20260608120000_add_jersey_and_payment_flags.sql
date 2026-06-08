-- Registration flags split across the two registration concerns:
--   * jersey_purchased  — player-level, season-independent (bought once on league entry)
--   * payment_received  — season-specific (marks a season registration as paid = complete)

-- 1. Player-level jersey flag.
alter table public.players
  add column jersey_purchased boolean not null default false;

-- 2. Season-specific payment flag on the registration row.
alter table public.registrations
  add column payment_received boolean not null default false;

-- 3. Allow admins to flip payment_received.
--    registrations currently grants only select/insert/delete, so add update + a policy.
grant update on public.registrations to authenticated;

create policy registrations_update on public.registrations
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
