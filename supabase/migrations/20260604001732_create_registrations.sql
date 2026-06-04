-- Season registration: a season-scoped enrollment of players.
-- Adds a registration-window flag to seasons and a players<->seasons junction table.

-- 1. Registration-window flag on seasons (closed by default).
alter table public.seasons
  add column registration_open boolean not null default false;

-- 2. registrations: one row per (season, player) who is enrolled for that season.
--    The row's existence is the registration; created_at is when it happened.
create table public.registrations (
  id         uuid primary key default gen_random_uuid(),
  season_id  integer not null references public.seasons(id) on delete cascade,
  player_id  uuid    not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, player_id)
);

create index registrations_season_id_idx on public.registrations (season_id);
create index registrations_player_id_idx on public.registrations (player_id);

-- 3. Row Level Security.
alter table public.registrations enable row level security;

-- Read: any signed-in user can see who is registered.
create policy registrations_select on public.registrations
  for select to authenticated
  using (true);

-- Register: a player may add only their own row; an admin may add anyone.
create policy registrations_insert on public.registrations
  for insert to authenticated
  with check (
    player_id in (select id from public.players where user_id = (select auth.uid()))
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Withdraw: a player may delete only their own row; an admin may delete anyone's.
create policy registrations_delete on public.registrations
  for delete to authenticated
  using (
    player_id in (select id from public.players where user_id = (select auth.uid()))
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 4. Data API exposure (new tables are not auto-granted).
grant select, insert, delete on public.registrations to authenticated;
