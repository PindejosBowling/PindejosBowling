-- RLS is_admin() dedup (TODO_DB_SECURITY §2).
--
-- 83 policies repeated the inline admin JWT expression (108 initplan-wrapped
-- occurrences + 4 bare per-row ones on registrations). Every occurrence is
-- replaced by ( SELECT public.is_admin()) — the SECURITY DEFINER STABLE
-- helper from db_assert_helpers, EXECUTE-granted to authenticated. The
-- (SELECT …) wrapper keeps the initplan optimization and, as a side effect,
-- fixes the four registrations policies that called bare auth.jwt() per row.
--
-- Semantics are intentionally identical: this file was GENERATED from the
-- live pg_policies catalog (supabase/verify/generate-rls-dedup.py) and is
-- verified by diffing before/after catalog dumps with the admin expression
-- normalized (supabase/verify/diff-policies.sh) — the diff must be empty.

DROP POLICY "admin can delete" ON public.activity_feed_events;
CREATE POLICY "admin can delete" ON public.activity_feed_events
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.activity_feed_events;
CREATE POLICY "admin can insert" ON public.activity_feed_events
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can read all" ON public.activity_feed_events;
CREATE POLICY "admin can read all" ON public.activity_feed_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.activity_feed_events;
CREATE POLICY "admin can update" ON public.activity_feed_events
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bet_legs;
CREATE POLICY "admin can delete" ON public.bet_legs
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bet_legs;
CREATE POLICY "admin can insert" ON public.bet_legs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bet_legs;
CREATE POLICY "admin can update" ON public.bet_legs
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bet_markets;
CREATE POLICY "admin can delete" ON public.bet_markets
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bet_markets;
CREATE POLICY "admin can insert" ON public.bet_markets
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bet_markets;
CREATE POLICY "admin can update" ON public.bet_markets
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bet_selections;
CREATE POLICY "admin can delete" ON public.bet_selections
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bet_selections;
CREATE POLICY "admin can insert" ON public.bet_selections
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bet_selections;
CREATE POLICY "admin can update" ON public.bet_selections
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bets;
CREATE POLICY "admin can delete" ON public.bets
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bets;
CREATE POLICY "admin can insert" ON public.bets
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bets;
CREATE POLICY "admin can update" ON public.bets
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "authenticated can delete own" ON public.board_posts;
CREATE POLICY "authenticated can delete own" ON public.board_posts
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (((player_id = ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT public.is_admin())));

DROP POLICY "admin can delete" ON public.bounty_hunter_stakes;
CREATE POLICY "admin can delete" ON public.bounty_hunter_stakes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bounty_hunter_stakes;
CREATE POLICY "admin can insert" ON public.bounty_hunter_stakes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bounty_hunter_stakes;
CREATE POLICY "admin can update" ON public.bounty_hunter_stakes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bounty_payouts;
CREATE POLICY "admin can delete" ON public.bounty_payouts
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bounty_payouts;
CREATE POLICY "admin can insert" ON public.bounty_payouts
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bounty_payouts;
CREATE POLICY "admin can update" ON public.bounty_payouts
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bounty_post;
CREATE POLICY "admin can delete" ON public.bounty_post
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bounty_post;
CREATE POLICY "admin can insert" ON public.bounty_post
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bounty_post;
CREATE POLICY "admin can update" ON public.bounty_post
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.bounty_settlements;
CREATE POLICY "admin can delete" ON public.bounty_settlements
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.bounty_settlements;
CREATE POLICY "admin can insert" ON public.bounty_settlements
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.bounty_settlements;
CREATE POLICY "admin can update" ON public.bounty_settlements
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.custom_lines;
CREATE POLICY "admin can delete" ON public.custom_lines
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.custom_lines;
CREATE POLICY "admin can insert" ON public.custom_lines
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.custom_lines;
CREATE POLICY "admin can update" ON public.custom_lines
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.games;
CREATE POLICY "admin can delete" ON public.games
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.games;
CREATE POLICY "admin can insert" ON public.games
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.lanetalk_game_imports;
CREATE POLICY "admin can update" ON public.lanetalk_game_imports
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.loan_ledger;
CREATE POLICY "admin can delete" ON public.loan_ledger
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.loan_ledger;
CREATE POLICY "admin can insert" ON public.loan_ledger
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.loan_ledger;
CREATE POLICY "admin can update" ON public.loan_ledger
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.loan_products;
CREATE POLICY "admin can delete" ON public.loan_products
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.loan_products;
CREATE POLICY "admin can insert" ON public.loan_products
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.loan_products;
CREATE POLICY "admin can update" ON public.loan_products
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.loans;
CREATE POLICY "admin can delete" ON public.loans
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.loans;
CREATE POLICY "admin can insert" ON public.loans
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.loans;
CREATE POLICY "admin can update" ON public.loans
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.pin_ledger;
CREATE POLICY "admin can delete" ON public.pin_ledger
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.pin_ledger;
CREATE POLICY "admin can insert" ON public.pin_ledger
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.players;
CREATE POLICY "admin can insert" ON public.players
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.players;
CREATE POLICY "admin can update" ON public.players
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can write" ON public.playoff_draft_captains;
CREATE POLICY "admin can write" ON public.playoff_draft_captains
  AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can write" ON public.playoff_draft_picks;
CREATE POLICY "admin can write" ON public.playoff_draft_picks
  AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can write" ON public.playoff_draft_pool;
CREATE POLICY "admin can write" ON public.playoff_draft_pool
  AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can write" ON public.playoff_drafts;
CREATE POLICY "admin can write" ON public.playoff_drafts
  AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.pvp_challenge_offers;
CREATE POLICY "admin can delete" ON public.pvp_challenge_offers
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.pvp_challenge_offers;
CREATE POLICY "admin can insert" ON public.pvp_challenge_offers
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.pvp_challenge_offers;
CREATE POLICY "admin can update" ON public.pvp_challenge_offers
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.pvp_challenges;
CREATE POLICY "admin can delete" ON public.pvp_challenges
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.pvp_challenges;
CREATE POLICY "admin can insert" ON public.pvp_challenges
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.pvp_challenges;
CREATE POLICY "admin can update" ON public.pvp_challenges
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.pvp_ledger;
CREATE POLICY "admin can delete" ON public.pvp_ledger
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.pvp_ledger;
CREATE POLICY "admin can insert" ON public.pvp_ledger
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.pvp_ledger;
CREATE POLICY "admin can update" ON public.pvp_ledger
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "registrations_delete" ON public.registrations;
CREATE POLICY "registrations_delete" ON public.registrations
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (((player_id IN ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT public.is_admin())));

DROP POLICY "registrations_insert" ON public.registrations;
CREATE POLICY "registrations_insert" ON public.registrations
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((player_id IN ( SELECT players.id
   FROM players
  WHERE (players.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT public.is_admin())));

DROP POLICY "registrations_update" ON public.registrations;
CREATE POLICY "registrations_update" ON public.registrations
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can manage rsvp" ON public.rsvp;
CREATE POLICY "admin can manage rsvp" ON public.rsvp
  AS PERMISSIVE FOR ALL TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.scores;
CREATE POLICY "admin can delete" ON public.scores
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.scores;
CREATE POLICY "admin can insert" ON public.scores
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.scores;
CREATE POLICY "admin can update" ON public.scores
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.season_champions;
CREATE POLICY "admin can delete" ON public.season_champions
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.season_champions;
CREATE POLICY "admin can insert" ON public.season_champions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.seasons;
CREATE POLICY "admin can delete" ON public.seasons
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.seasons;
CREATE POLICY "admin can insert" ON public.seasons
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.seasons;
CREATE POLICY "admin can update" ON public.seasons
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.team_slots;
CREATE POLICY "admin can delete" ON public.team_slots
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.team_slots;
CREATE POLICY "admin can insert" ON public.team_slots
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.team_slots;
CREATE POLICY "admin can update" ON public.team_slots
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can delete" ON public.teams;
CREATE POLICY "admin can delete" ON public.teams
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.teams;
CREATE POLICY "admin can insert" ON public.teams
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.teams;
CREATE POLICY "admin can update" ON public.teams
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can read runs" ON public.week_archive_runs;
CREATE POLICY "admin can read runs" ON public.week_archive_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can read snapshot" ON public.week_archive_snapshot;
CREATE POLICY "admin can read snapshot" ON public.week_archive_snapshot
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (( SELECT public.is_admin()));

DROP POLICY "admin can insert" ON public.weeks;
CREATE POLICY "admin can insert" ON public.weeks
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (( SELECT public.is_admin()));

DROP POLICY "admin can update" ON public.weeks;
CREATE POLICY "admin can update" ON public.weeks
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (( SELECT public.is_admin()))
  WITH CHECK (( SELECT public.is_admin()));

