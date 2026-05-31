-- anon SELECT on all tables (publishable key / unauthenticated web users)
create policy "anon can read" on board_posts      for select to anon using (true);
create policy "anon can read" on game_schedule    for select to anon using (true);
create policy "anon can read" on players          for select to anon using (true);
create policy "anon can read" on rsvp             for select to anon using (true);
create policy "anon can read" on scores           for select to anon using (true);
create policy "anon can read" on season_champions for select to anon using (true);
create policy "anon can read" on seasons          for select to anon using (true);
create policy "anon can read" on team_slots       for select to anon using (true);
create policy "anon can read" on weeks            for select to anon using (true);

-- anon write access — app has no auth layer, all mutations use the anon key

-- board_posts: insert + delete (trash board)
create policy "anon can insert" on board_posts for insert to anon with check (true);
create policy "anon can delete" on board_posts for delete to anon using (true);

-- rsvp: upsert + delete
create policy "anon can insert" on rsvp for insert to anon with check (true);
create policy "anon can update" on rsvp for update to anon using (true) with check (true);
create policy "anon can delete" on rsvp for delete to anon using (true);

-- scores: insert + upsert + update + delete (live scoring)
create policy "anon can insert" on scores for insert to anon with check (true);
create policy "anon can update" on scores for update to anon using (true) with check (true);
create policy "anon can delete" on scores for delete to anon using (true);

-- players: insert + update (admin)
create policy "anon can insert" on players for insert to anon with check (true);
create policy "anon can update" on players for update to anon using (true) with check (true);

-- weeks: insert + update (admin archive / generate teams)
create policy "anon can insert" on weeks for insert to anon with check (true);
create policy "anon can update" on weeks for update to anon using (true) with check (true);

-- seasons: insert + update (admin end season)
create policy "anon can insert" on seasons for insert to anon with check (true);
create policy "anon can update" on seasons for update to anon using (true) with check (true);

-- season_champions: insert + delete (admin end season)
create policy "anon can insert" on season_champions for insert to anon with check (true);
create policy "anon can delete" on season_champions for delete to anon using (true);

-- game_schedule: insert + delete (admin generate teams)
create policy "anon can insert" on game_schedule for insert to anon with check (true);
create policy "anon can delete" on game_schedule for delete to anon using (true);

-- team_slots: insert + update + delete (admin generate teams)
create policy "anon can insert" on team_slots for insert to anon with check (true);
create policy "anon can update" on team_slots for update to anon using (true) with check (true);
create policy "anon can delete" on team_slots for delete to anon using (true);

-- write access for authenticated role (mirrors anon — no auth layer today)
create policy "authenticated can insert" on board_posts      for insert to authenticated with check (true);
create policy "authenticated can delete" on board_posts      for delete to authenticated using (true);
create policy "authenticated can insert" on rsvp             for insert to authenticated with check (true);
create policy "authenticated can update" on rsvp             for update to authenticated using (true) with check (true);
create policy "authenticated can delete" on rsvp             for delete to authenticated using (true);
create policy "authenticated can insert" on scores           for insert to authenticated with check (true);
create policy "authenticated can update" on scores           for update to authenticated using (true) with check (true);
create policy "authenticated can delete" on scores           for delete to authenticated using (true);
create policy "authenticated can insert" on players          for insert to authenticated with check (true);
create policy "authenticated can update" on players          for update to authenticated using (true) with check (true);
create policy "authenticated can insert" on weeks            for insert to authenticated with check (true);
create policy "authenticated can update" on weeks            for update to authenticated using (true) with check (true);
create policy "authenticated can insert" on seasons          for insert to authenticated with check (true);
create policy "authenticated can update" on seasons          for update to authenticated using (true) with check (true);
create policy "authenticated can insert" on season_champions for insert to authenticated with check (true);
create policy "authenticated can delete" on season_champions for delete to authenticated using (true);
create policy "authenticated can insert" on game_schedule    for insert to authenticated with check (true);
create policy "authenticated can delete" on game_schedule    for delete to authenticated using (true);
create policy "authenticated can insert" on team_slots       for insert to authenticated with check (true);
create policy "authenticated can update" on team_slots       for update to authenticated using (true) with check (true);
create policy "authenticated can delete" on team_slots       for delete to authenticated using (true);
