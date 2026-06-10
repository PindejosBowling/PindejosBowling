-- ============================================================================
-- Per-game participation — eager materialization + participation-keyed O/U lines
-- ============================================================================
-- The app's true roster model is per-game (the week editor's convention): a
-- (team_slot, game) `scores` row means "in the lineup for that game", and
-- `scores.score` is nullable — null = "present, not yet scored". A player can
-- bowl game 1 but not game 2, or bowl for Team 1 in game 1 and Team 2 in game 2
-- (two slots).
--
-- Until now that primitive was LAZY: rows appeared only when a score was entered
-- or the week editor saved, so row-absence was ambiguous ("not in the lineup" vs
-- "hasn't bowled yet") and the betting layer had to key O/U lines to week-level
-- slots — letting per-game lineup edits strand lines that only the archive
-- backstop could catch.
--
-- This migration makes participation EAGER and unambiguous:
--   1. A seeding trigger on `games` inserts null-score rows for every existing
--      slot of both teams the moment a matchup is created (team-gen inserts
--      slots before games, so this covers the whole roster). The week editor's
--      per-game adds keep writing exactly the rows it means (its new slots are
--      deliberately NOT seeded across all games).
--   2. Backfill: unarchived weeks get rows for EVERY missing (slot × its
--      team's games) pair — full coverage, so a week mid-score-entry at cutover
--      can't have its unscored games misread as "not in the lineup". (No
--      editor-made per-game removals exist pre-cutover to preserve: lazy rows
--      only ever appeared with scores.) Archived history is untouched.
--   3. `sync_over_under_markets_for_week` keys lines to participation when the
--      week has games: line (player, game N) exists iff the player participates
--      in game N. Statement triggers on `scores` INSERT/DELETE resync, so a
--      per-game lineup edit prunes (refunds) or creates lines AT EDIT TIME.
--
-- The archive backstop remains, now only for genuinely unknowable outcomes
-- (a participant whose score was never entered) — not for known lineup edits.
--
-- Safety audit (why null rows are inert everywhere else): every stats query
-- filters `.not('score','is',null)` server-side (listBySeason/listAllArchived/
-- listForStandings/H2H/LeagueRecords/History); settlement, score_credit minting,
-- moneyline totals and the line-derivation averages all require
-- `score IS NOT NULL`; useMatchupsData maps null → ''. The one app-side change:
-- clearing a score inline must UPDATE to null, not DELETE the row (deleting now
-- means "out of the lineup") — see MatchupsScreen.flushScores.
-- ============================================================================


-- ============================================================================
-- 1. Seed participation when matchups are created.
--    Name sorts before games_resync_markets_* (triggers fire alphabetically),
--    so the resync that follows sees the seeded rows.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_seed_participation_games()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.scores (team_slot_id, game_id, score)
  SELECT ts.id, nr.id, NULL
  FROM new_rows nr
  JOIN public.team_slots ts ON ts.team_id IN (nr.team_a_id, nr.team_b_id)
  ON CONFLICT (team_slot_id, game_id) DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS games_participation_seed_ins ON public.games;
CREATE TRIGGER games_participation_seed_ins AFTER INSERT ON public.games
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_seed_participation_games();


-- ============================================================================
-- 2. Backfill unarchived weeks: every missing (slot × its team's games) pair.
-- ============================================================================
INSERT INTO public.scores (team_slot_id, game_id, score)
SELECT ts.id, g.id, NULL
FROM public.team_slots ts
JOIN public.teams t ON t.id = ts.team_id
JOIN public.weeks w ON w.id = t.week_id AND w.is_archived = false
JOIN public.games g ON (g.team_a_id = t.id OR g.team_b_id = t.id)
ON CONFLICT (team_slot_id, game_id) DO NOTHING;


-- ============================================================================
-- 3. sync_over_under_markets_for_week — participation-keyed lines.
--    Eligibility ladder for line (player P, game N):
--      * week has games  → P has a non-fill participation row for game N
--      * teams, no games → P has a non-fill slot (mid-team-gen transient)
--      * no teams        → P is RSVP'd in
--    Target games unchanged (games table authoritative once a schedule exists).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_over_under_markets_for_week(p_week_id uuid, p_extra_games integer[] DEFAULT '{}'::integer[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_season_id    uuid;
  v_has_teams    boolean;
  v_has_games    boolean;
  v_target_games integer[];
  v_league_avg   numeric;
  v_avg          numeric;
  v_line         numeric;
  v_market_id    uuid;
  v_rec          record;
BEGIN
  SELECT season_id INTO v_season_id FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.week_id = p_week_id)
    INTO v_has_teams;
  SELECT EXISTS (
    SELECT 1 FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
  ) INTO v_has_games;

  -- Target games: once a schedule exists the games table is authoritative
  -- (∪ p_extra_games for a just-inserted game in the same client flow).
  -- Before teams: existing market numbers ∪ extras, defaulting to {1, 2}.
  IF v_has_games THEN
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT g.game_number AS x FROM public.games g
          JOIN public.teams t ON t.id = g.team_a_id
         WHERE t.week_id = p_week_id
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
  ELSE
    SELECT ARRAY(
      SELECT DISTINCT x FROM (
        SELECT game_number AS x FROM public.bet_markets
          WHERE week_id = p_week_id AND market_type = 'over_under' AND game_number IS NOT NULL
        UNION
        SELECT UNNEST(COALESCE(p_extra_games, '{}'))
      ) u
    ) INTO v_target_games;
    IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
      v_target_games := ARRAY[1, 2];
    END IF;
  END IF;

  -- --- Prune: refund + remove every O/U market whose subject is no longer ---
  -- eligible (per the ladder above) or whose game number is no longer
  -- scheduled. The BEFORE DELETE trigger (refund_bets_before_market_delete)
  -- refunds every touched bet whole (ledger pair + bet row), including parlays
  -- spanning other markets. Settled/void markets are immutable — never pruned.
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'over_under'
     AND m.status IN ('open', 'closed')
     AND (
       m.game_number <> ALL (v_target_games)
       OR (v_has_games AND NOT EXISTS (
             SELECT 1 FROM public.scores s
             JOIN public.team_slots ts ON ts.id = s.team_slot_id
             JOIN public.teams t       ON t.id = ts.team_id
             JOIN public.games g       ON g.id = s.game_id
             WHERE t.week_id = p_week_id
               AND ts.player_id = m.subject_player_id
               AND g.game_number = m.game_number))
       OR (NOT v_has_games AND v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.team_slots ts
             JOIN public.teams t ON t.id = ts.team_id
             WHERE t.week_id = p_week_id AND ts.player_id = m.subject_player_id))
       OR (NOT v_has_teams AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
             WHERE r.week_id = p_week_id AND r.status = 'in'
               AND r.player_id = m.subject_player_id))
     );

  -- --- League average (mean of per-player current-season archived averages) ---
  SELECT COALESCE(AVG(pa.avg_score), 130) INTO v_league_avg
  FROM (
    SELECT AVG(s.score) AS avg_score
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id IS NOT NULL AND s.score IS NOT NULL
    GROUP BY ts.player_id
  ) pa;

  -- --- Create missing markets for eligible (player, game) pairs ---------------
  FOR v_rec IN
    SELECT ep.player_id, ep.game_number, p.name
    FROM (
      -- games exist → participation rows are the authority, per game
      SELECT DISTINCT ts.player_id, g.game_number
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      JOIN public.games g       ON g.id = s.game_id
      WHERE v_has_games AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
        AND g.game_number = ANY (v_target_games)
      UNION
      -- teams but no games yet (mid-team-gen) → slots × target
      SELECT ts.player_id, gt.game_number
      FROM public.team_slots ts
      JOIN public.teams t ON t.id = ts.team_id
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE v_has_teams AND NOT v_has_games
        AND t.week_id = p_week_id AND ts.player_id IS NOT NULL
      UNION
      -- no teams → RSVP × target
      SELECT r.player_id, gt.game_number
      FROM public.rsvp r
      CROSS JOIN UNNEST(v_target_games) AS gt(game_number)
      WHERE NOT v_has_teams AND r.week_id = p_week_id AND r.status = 'in'
    ) ep
    JOIN public.players p ON p.id = ep.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bet_markets m
      WHERE m.week_id = p_week_id AND m.market_type = 'over_under'
        AND m.game_number = ep.game_number AND m.subject_player_id = ep.player_id
    )
  LOOP
    SELECT AVG(s.score) INTO v_avg
    FROM public.scores s
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    JOIN public.weeks w       ON w.id = t.week_id
    WHERE w.season_id = v_season_id AND w.is_archived = true
      AND ts.player_id = v_rec.player_id AND s.score IS NOT NULL;

    v_line := FLOOR(COALESCE(v_avg, v_league_avg)) + 0.5;

    INSERT INTO public.bet_markets (market_type, title, week_id, game_number, subject_player_id, status)
      VALUES ('over_under', v_rec.name || ' · Game ' || v_rec.game_number,
              p_week_id, v_rec.game_number, v_rec.player_id, 'open')
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);
  END LOOP;
END;
$$;


-- ============================================================================
-- 4. Resync on participation changes. INSERT/DELETE only — score-value updates
--    (the upsert's conflict path) don't change membership. The INSERT transition
--    table of an upsert contains only genuinely-new rows, so routine score
--    entry resolves to a no-op resync. Week resolution joins through team_slots;
--    cascaded deletes (slot/team wipes) resolve to no week and fall through to
--    the team_slots/games triggers.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_resync_markets_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_week uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM new_rows nr
      JOIN public.team_slots ts ON ts.id = nr.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  ELSE
    FOR v_week IN
      SELECT DISTINCT t.week_id FROM old_rows o
      JOIN public.team_slots ts ON ts.id = o.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
    LOOP
      PERFORM public.resync_week_markets(v_week);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS scores_resync_markets_ins ON public.scores;
DROP TRIGGER IF EXISTS scores_resync_markets_del ON public.scores;
CREATE TRIGGER scores_resync_markets_ins AFTER INSERT ON public.scores
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_scores();
CREATE TRIGGER scores_resync_markets_del AFTER DELETE ON public.scores
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_resync_markets_scores();
