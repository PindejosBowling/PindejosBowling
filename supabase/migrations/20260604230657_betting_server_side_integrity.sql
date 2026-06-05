-- Server-side integrity for the pin economy.
--
-- Until now the pin economy was enforced entirely in the client: pin_ledger,
-- placed_bets and bet_lines all had blanket anon/authenticated INSERT/UPDATE
-- policies. A crafted request (not the app) could therefore:
--   • insert any pin_ledger row  → mint itself unlimited pins
--   • insert/alter placed_bets   → bet without paying, set its own payout
--   • insert/alter bet_lines     → set a favorable line on itself / self-settle
--   • call cancel_bet_lines_for_players with no caller check → wipe anyone's lines
--
-- This migration moves the two player-driven write paths (placing a bet, and the
-- RSVP-driven bet-line sync) into SECURITY DEFINER RPCs that validate and write
-- atomically, then locks the three tables down to admin-only direct writes. All
-- existing admin flows (archive settlement, manual settle, line editing, team-gen
-- game-3 lines, champion bonus, cancel bet) already run as the admin role and
-- keep working through the admin policies below.

-- ============================================================================
-- 1. place_bet — atomic, balance-checked bet placement for the calling player.
-- ============================================================================
-- Resolves the bettor from auth.uid() (never trusts a client-supplied player_id),
-- validates the line is open, enforces the min wager + balance + anti-tanking
-- rules, then inserts the placed_bet and its -wager bet_placed ledger entry in
-- one transaction. The pin_ledger insert bypasses the locked-down RLS because the
-- function is SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.place_bet(
  p_bet_line_id uuid,
  p_pick        text,
  p_wager       integer
)
RETURNS public.placed_bets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id  uuid;
  v_line       public.bet_lines;
  v_subject    text;
  v_season_id  uuid;
  v_balance    integer;
  v_bet        public.placed_bets;
BEGIN
  -- Caller's player identity (authorization: must be a linked, signed-in player).
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  IF p_pick NOT IN ('over', 'under') THEN
    RAISE EXCEPTION 'Invalid pick';
  END IF;
  IF p_wager IS NULL OR p_wager < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  SELECT * INTO v_line FROM public.bet_lines WHERE id = p_bet_line_id;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'Bet line not found';
  END IF;
  IF NOT v_line.is_open THEN
    RAISE EXCEPTION 'Bet line is closed';
  END IF;

  -- Anti-tanking (the placed_bets_no_self_under trigger is the hard backstop).
  IF p_pick = 'under' AND v_line.player_id = v_player_id THEN
    RAISE EXCEPTION 'A player cannot bet the under on their own line';
  END IF;

  SELECT w.season_id INTO v_season_id FROM public.weeks w WHERE w.id = v_line.week_id;
  SELECT name INTO v_subject FROM public.players WHERE id = v_line.player_id;

  -- Balance for the line's season = SUM(ledger). Enforced here, not just in UI.
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger
    WHERE player_id = v_player_id AND season_id = v_season_id;
  IF p_wager > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  -- UNIQUE (player_id, bet_line_id) enforces one bet per line.
  INSERT INTO public.placed_bets (player_id, bet_line_id, pick, wager, payout)
    VALUES (v_player_id, p_bet_line_id, p_pick, p_wager, p_wager)
    RETURNING * INTO v_bet;

  INSERT INTO public.pin_ledger (player_id, season_id, amount, type, description, placed_bet_id)
    VALUES (
      v_player_id, v_season_id, -p_wager, 'bet_placed',
      'Bet: ' || COALESCE(v_subject, 'Player') || ' ' || p_pick || ' ' || v_line.line
        || ' — Game ' || v_line.game_number,
      v_bet.id
    );

  RETURN v_bet;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_bet(uuid, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.place_bet(uuid, text, integer) TO authenticated;

-- ============================================================================
-- 2. sync_bet_lines_for_week — RSVP-driven bet-line create/refund, server-side.
-- ============================================================================
-- Replaces the client-side RsvpScreen.syncBetLines writes AND the old
-- cancel_bet_lines_for_players RPC. Derives everything from rsvp + scores (a
-- caller cannot inject arbitrary lines or values), so it is safe for any
-- authenticated user toggling their own RSVP. Idempotent.
--
--   • Refund + remove lines for players who currently have lines but are no
--     longer "in" (delete ledger → placed_bets → bet_lines, in that order:
--     pin_ledger.placed_bet_id is ON DELETE SET NULL, so deleting the bet first
--     would orphan its ledger rows and lose the refund).
--   • Create lines for "in" players missing any of the week's target games. The
--     target set is the distinct game_numbers already present (so late joiners
--     match the established set incl. game 3 post-gen), defaulting to {1,2}.
--   • Line value = floor(current-season avg) + 0.5, league-avg fallback (mean of
--     player averages, 130 if none) — the same rule as betLines.ts lineForAvg.
CREATE OR REPLACE FUNCTION public.sync_bet_lines_for_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id    uuid;
  v_target_games integer[];
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  SELECT ARRAY_AGG(DISTINCT game_number) INTO v_target_games
    FROM public.bet_lines WHERE week_id = p_week_id;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;

  -- --- Refund + remove lines for players no longer "in" ---------------------
  -- Ledger first (placed_bet_id is ON DELETE SET NULL).
  DELETE FROM public.pin_ledger pl
    USING public.placed_bets pb, public.bet_lines bl
    WHERE pl.placed_bet_id = pb.id
      AND pb.bet_line_id = bl.id
      AND bl.week_id = p_week_id
      AND bl.player_id NOT IN (
        SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
      );

  DELETE FROM public.placed_bets pb
    USING public.bet_lines bl
    WHERE pb.bet_line_id = bl.id
      AND bl.week_id = p_week_id
      AND bl.player_id NOT IN (
        SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
      );

  DELETE FROM public.bet_lines
    WHERE week_id = p_week_id
      AND player_id NOT IN (
        SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
      );

  -- --- Create missing lines for "in" players --------------------------------
  INSERT INTO public.bet_lines (week_id, player_id, game_number, line)
  SELECT p_week_id,
         ip.player_id,
         g.game_number,
         FLOOR(COALESCE(pa.avg_score, league.league_avg)) + 0.5
  FROM (
    SELECT player_id FROM public.rsvp WHERE week_id = p_week_id AND status = 'in'
  ) ip
  CROSS JOIN UNNEST(v_target_games) AS g(game_number)
  LEFT JOIN (
    SELECT ts.player_id, AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id
      AND w.is_archived = true
      AND ts.player_id IS NOT NULL
      AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa ON pa.player_id = ip.player_id
  CROSS JOIN (
    SELECT COALESCE(AVG(pa2.avg_score), 130) AS league_avg
    FROM (
      SELECT AVG(s.score) AS avg_score
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.weeks w       ON w.id = t.week_id
      WHERE w.season_id = v_season_id
        AND w.is_archived = true
        AND ts.player_id IS NOT NULL
        AND s.score IS NOT NULL
      GROUP BY ts.player_id
    ) pa2
  ) league
  ON CONFLICT (week_id, player_id, game_number) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_bet_lines_for_week(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_bet_lines_for_week(uuid) TO authenticated;

-- The old, caller-unchecked cleanup RPC is now fully superseded by the sync RPC.
DROP FUNCTION IF EXISTS public.cancel_bet_lines_for_players(uuid, uuid[]);

-- ============================================================================
-- 3. Lock down direct table writes to admin-only.
-- ============================================================================
-- Players write exclusively through place_bet / sync_bet_lines_for_week above
-- (SECURITY DEFINER, so they bypass these policies). Everything else is admin.

-- pin_ledger: append-only. Admin INSERT (archive credits, champion bonus, manual
-- settle); admin DELETE already exists (cancel bet). No UPDATE. Drop blanket.
DROP POLICY IF EXISTS "anon can insert"          ON public.pin_ledger;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.pin_ledger;
CREATE POLICY "admin can insert" ON public.pin_ledger
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- placed_bets: admin UPDATE (settlement payout/settled_at); admin DELETE exists
-- (cancel bet). Player INSERT is via place_bet only. Drop blanket insert/update.
DROP POLICY IF EXISTS "anon can insert"          ON public.placed_bets;
DROP POLICY IF EXISTS "anon can update"          ON public.placed_bets;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.placed_bets;
DROP POLICY IF EXISTS "authenticated can update"  ON public.placed_bets;
CREATE POLICY "admin can update" ON public.placed_bets
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- bet_lines: admin INSERT (team-gen game-3 lines), admin UPDATE (line editing,
-- settlement). Non-admin line creation is via sync_bet_lines_for_week only.
-- bet_lines has no DELETE policy (removal is via the sync RPC / cascade). Drop
-- blanket insert/update.
DROP POLICY IF EXISTS "anon can insert"          ON public.bet_lines;
DROP POLICY IF EXISTS "anon can update"          ON public.bet_lines;
DROP POLICY IF EXISTS "authenticated can insert"  ON public.bet_lines;
DROP POLICY IF EXISTS "authenticated can update"  ON public.bet_lines;
CREATE POLICY "admin can insert" ON public.bet_lines
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "admin can update" ON public.bet_lines
  FOR UPDATE TO authenticated
  USING     (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
