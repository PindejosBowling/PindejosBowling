-- Combo Lines (core): player-composed aggregate over/under markets on an
-- explicit set of players — the team-prop replacement with zero FK to
-- teams/games, so team regeneration can never delete-refund a combo bet.
--
-- This migration adds:
--   1. market_type 'combo' + the dedup unique index
--   2. combo_seed_line()          — seed a line for an arbitrary player set
--   3. compose_combo_bet()        — atomic market + selections + bet (parlay-able)
--   4. prevent_self_tank()        — combo branch (no under on a combo containing you)
--   5. sync_combo_markets_for_week() — RSVP-out auto-void prune, wired into
--      resync_week_markets (reads ONLY rsvp — team churn cannot kill a combo)
--   6. activity feed catalog row for compose events
--
-- Settlement branches land in the follow-up migration (combo_lines_settlement).

-- ---------------------------------------------------------------------------
-- 1. Market type + dedup index
-- ---------------------------------------------------------------------------

ALTER TABLE public.bet_markets DROP CONSTRAINT bet_markets_market_type_check;
ALTER TABLE public.bet_markets ADD CONSTRAINT bet_markets_market_type_check
  CHECK ((market_type = ANY (ARRAY['over_under'::text, 'moneyline'::text, 'prop'::text, 'team_prop'::text, 'combo'::text])));

-- One live market per identical combo per week. combo_key is the canonical
-- identity: '<stat>|<scope>|<game_number|n>|<sorted uuid,uuid,…>'. Settled and
-- void combos never block a recompose.
CREATE UNIQUE INDEX bet_markets_combo_dedup
  ON public.bet_markets (week_id, (params ->> 'combo_key'))
  WHERE market_type = 'combo' AND status IN ('open', 'closed');

-- ---------------------------------------------------------------------------
-- 2. Seed line for an arbitrary member set (team_prop_seed_line generalized
--    from a team roster to an explicit player-id array).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.combo_seed_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n_members integer;
  v_sum       numeric;
BEGIN
  SELECT count(DISTINCT m) INTO v_n_members FROM unnest(p_member_ids) m;
  IF v_n_members = 0 THEN v_n_members := 1; END IF;

  IF p_stat IN ('clean_frames', 'strikes', 'spares') THEN
    SELECT COALESCE(SUM(pl.avg_stat), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem
    CROSS JOIN LATERAL (
      SELECT CASE p_stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END AS avg_stat
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = mem.player_id AND i.classification = 'official' AND i.frames > 0
    ) pl;
    -- Half-point, floored once; clamp to [0.5, 10 frames/game × games × members − 0.5].
    RETURN LEAST(10 * p_n_games * v_n_members - 0.5,
                 GREATEST(0.5, floor(COALESCE(v_sum, 0) * p_n_games) + 0.5));

  ELSIF p_stat = 'total_pins' THEN
    SELECT COALESCE(SUM(public.player_raw_avg_score(mem.player_id, p_season_id)), 0) INTO v_sum
    FROM (SELECT DISTINCT m AS player_id FROM unnest(p_member_ids) m) mem;
    RETURN GREATEST(0.5, floor(COALESCE(v_sum, 0) * p_n_games) + 0.5);

  ELSE
    RAISE EXCEPTION 'Unknown combo stat %', p_stat;
  END IF;
END;
$function$;

-- Granted to authenticated so the composer sheet can preview the exact line
-- the market will carry (read-only, STABLE).
REVOKE EXECUTE ON FUNCTION public.combo_seed_line(uuid[], text, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.combo_seed_line(uuid[], text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Feed catalog row (compose event; bet-linked so the RSVP-out delete-refund
--    cascade removes the card with the bet).
-- ---------------------------------------------------------------------------

INSERT INTO public.activity_event_catalog
  (event_type, source_feature, template_key, requires_actor, allowed_fk, default_visibility)
VALUES
  ('sportsbook_combo_composed', 'sportsbook', 'sportsbook.combo_composed', true, 'sportsbook_bet_id', 'public')
ON CONFLICT (event_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. compose_combo_bet — the single write path. Creates (or dedups into) the
--    combo market and places the composer's bet in one transaction, so a
--    combo market can never exist without a bet on it. p_extra_selection_ids
--    lets the composer parlay the fresh combo leg with already-staged lines.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compose_combo_bet(
  p_week_id            uuid,
  p_member_ids         uuid[],
  p_stat               text,
  p_scope              text,
  p_game_number        integer DEFAULT NULL,
  p_stake              integer DEFAULT NULL,
  p_extra_selection_ids uuid[] DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id    uuid;
  v_season_id    uuid;
  v_archived     boolean;
  v_members      uuid[];
  v_member_texts text[];
  v_member_names text[];
  v_n_named      integer;
  v_target_games integer[];
  v_n_games      integer;
  v_combo_key    text;
  v_existing     record;
  v_clock        text;
  v_label        text;
  v_line         numeric;
  v_market_id    uuid;
  v_over_id      uuid;
  v_bet_id       uuid;
  v_deduped      boolean := false;
BEGIN
  v_player_id := public.current_player_id();

  SELECT w.season_id, w.is_archived INTO v_season_id, v_archived
    FROM public.weeks w WHERE w.id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF v_archived THEN
    RAISE EXCEPTION 'This week is locked — no new bets can be placed';
  END IF;

  IF p_stat IS NULL OR p_stat NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins') THEN
    RAISE EXCEPTION 'Unknown combo stat %', COALESCE(p_stat, '(null)');
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('game', 'night') THEN
    RAISE EXCEPTION 'Combo scope must be game or night';
  END IF;

  -- Schedule games: the games table is authoritative once a schedule exists;
  -- before teams, default {1, 2} (the O/U sync's pre-teams convention).
  SELECT ARRAY(
    SELECT DISTINCT g.game_number FROM public.games g
    JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = p_week_id
    ORDER BY 1
  ) INTO v_target_games;
  IF v_target_games IS NULL OR array_length(v_target_games, 1) IS NULL THEN
    v_target_games := ARRAY[1, 2];
  END IF;
  v_n_games := COALESCE(array_length(v_target_games, 1), 2);

  IF p_scope = 'game' THEN
    IF p_game_number IS NULL OR NOT (p_game_number = ANY (v_target_games)) THEN
      RAISE EXCEPTION 'Game % is not on this week''s schedule', COALESCE(p_game_number::text, '(null)');
    END IF;
  ELSIF p_game_number IS NOT NULL THEN
    RAISE EXCEPTION 'A night combo cannot carry a game number';
  END IF;

  -- Members: sorted + deduped; at least two; every member RSVP''d in.
  SELECT array_agg(m ORDER BY m) INTO v_members
    FROM (SELECT DISTINCT m FROM unnest(p_member_ids) m WHERE m IS NOT NULL) d;
  IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
    RAISE EXCEPTION 'A combo needs at least two distinct players';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_members) mem
    WHERE NOT EXISTS (
      SELECT 1 FROM public.rsvp r
      WHERE r.week_id = p_week_id AND r.player_id = mem AND r.status = 'in')
  ) THEN
    RAISE EXCEPTION 'Every combo member must be RSVP''d in for this week';
  END IF;

  -- Display-name snapshot (also proves every id is a real player).
  SELECT array_agg(p.name ORDER BY mem.ord), count(p.id)
    INTO v_member_names, v_n_named
    FROM unnest(v_members) WITH ORDINALITY mem(id, ord)
    JOIN public.players p ON p.id = mem.id;
  IF v_n_named <> array_length(v_members, 1) THEN
    RAISE EXCEPTION 'Unknown player in combo';
  END IF;

  SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
  v_combo_key := p_stat || '|' || p_scope || '|' || COALESCE(p_game_number::text, 'n')
                 || '|' || array_to_string(v_member_texts, ',');

  -- Serialize identical composes; the partial unique index is the backstop.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_week_id::text || '|' || v_combo_key, 0));

  SELECT m.id, m.status INTO v_existing
    FROM public.bet_markets m
    WHERE m.week_id = p_week_id AND m.market_type = 'combo'
      AND m.status IN ('open', 'closed')
      AND m.params ->> 'combo_key' = v_combo_key;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status <> 'open' THEN
      RAISE EXCEPTION 'This combo is in progress — betting is closed';
    END IF;
    v_market_id := v_existing.id;
    v_deduped := true;
    SELECT s.id, s.line INTO v_over_id, v_line
      FROM public.bet_selections s
      WHERE s.market_id = v_market_id AND s.key = 'over';
  ELSE
    v_clock := CASE WHEN p_stat = 'total_pins' THEN 'archive' ELSE 'lanetalk' END;
    v_label := CASE p_stat
                 WHEN 'clean_frames' THEN 'Clean Frames'
                 WHEN 'strikes'      THEN 'Strikes'
                 WHEN 'spares'       THEN 'Spares'
                 ELSE 'Total Pins' END;
    v_line := public.combo_seed_line(v_members, p_stat, v_season_id,
                CASE WHEN p_scope = 'game' THEN 1 ELSE v_n_games END);

    INSERT INTO public.bet_markets
        (market_type, title, week_id, game_number, subject_game_id, params, status, created_by_player_id)
      VALUES ('combo',
              array_to_string(v_member_names, ' + ') || ' ' || v_label
                || ' — ' || CASE WHEN p_scope = 'game' THEN 'Game ' || p_game_number ELSE 'Night' END,
              p_week_id,
              CASE WHEN p_scope = 'game' THEN p_game_number ELSE NULL END,
              NULL,
              jsonb_build_object(
                'family', 'combo',
                'stat', p_stat,
                'scope', p_scope,
                'clock', v_clock,
                'member_ids', to_jsonb(v_member_texts),
                'member_names', to_jsonb(v_member_names),
                'combo_key', v_combo_key),
              'open',
              v_player_id)
      RETURNING id INTO v_market_id;

    INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
      (v_market_id, 'over',  'Over',  2.000, v_line, 0),
      (v_market_id, 'under', 'Under', 2.000, v_line, 1);

    SELECT s.id INTO v_over_id
      FROM public.bet_selections s
      WHERE s.market_id = v_market_id AND s.key = 'over';
  END IF;

  -- Parlay extras must be OTHER markets' selections (no self-referential legs).
  IF p_extra_selection_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bet_selections s
    WHERE s.id = ANY (p_extra_selection_ids) AND s.market_id = v_market_id
  ) THEN
    RAISE EXCEPTION 'A combo cannot parlay with its own selections';
  END IF;

  -- Compose = bet: place_house_bet re-validates every leg (open market, same
  -- season/week, min stake, balance, anti-tank) and writes the bet + legs +
  -- the bet_stake double entry. Any failure rolls the new market back too.
  v_bet_id := public.place_house_bet(
    ARRAY[v_over_id] || COALESCE(p_extra_selection_ids, '{}'::uuid[]),
    p_stake);

  -- Feed: one compose card per market birth (dedup joins post no card beyond
  -- place_house_bet's own big-ticket/parlay priority events).
  IF NOT v_deduped THEN
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_combo_composed',
      v_season_id, p_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.combo_composed',
      jsonb_build_object(
        'stat', p_stat, 'scope', p_scope, 'game_number', p_game_number,
        'member_count', array_length(v_members, 1),
        'member_names', to_jsonb(v_member_names),
        'line', v_line, 'stake', p_stake),
      jsonb_build_object('market_id', v_market_id, 'bet_id', v_bet_id,
                         'member_ids', to_jsonb(v_member_texts)),
      NULL, now());
  END IF;

  RETURN jsonb_build_object(
    'market_id', v_market_id, 'bet_id', v_bet_id,
    'line', v_line, 'deduped', v_deduped);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.compose_combo_bet(uuid, uuid[], text, text, integer, integer, uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compose_combo_bet(uuid, uuid[], text, text, integer, integer, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Anti-tank: no betting against a combo that contains you.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_self_tank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_bettor      uuid;
  v_subject     uuid;
  v_key         text;
  v_market_type text;
  v_params      jsonb;
BEGIN
  SELECT player_id INTO v_bettor FROM public.bets WHERE id = NEW.bet_id;

  SELECT m.subject_player_id, s.key, m.market_type, m.params
    INTO v_subject, v_key, v_market_type, v_params
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = NEW.selection_id;

  -- Player markets: no backing the under (or laying the over) on your OWN line.
  IF v_subject IS NOT NULL AND v_subject = v_bettor THEN
    IF (NEW.side = 'back' AND v_key = 'under')
       OR (NEW.side = 'lay' AND v_key = 'over') THEN
      RAISE EXCEPTION 'A player cannot bet against their own performance (anti-tanking)';
    END IF;
  END IF;

  -- Team markets: no backing the under (or laying the over) on a team the bettor
  -- is rostered on this week (betting your own team to do poorly).
  IF v_market_type = 'team_prop'
     AND ((NEW.side = 'back' AND v_key = 'under') OR (NEW.side = 'lay' AND v_key = 'over')) THEN
    IF EXISTS (
      SELECT 1 FROM public.team_slots ts
      WHERE ts.team_id = (v_params ->> 'team_id')::uuid
        AND ts.player_id = v_bettor
        AND ts.is_fill = false
    ) THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own team (anti-tanking)';
    END IF;
  END IF;

  -- Combo markets: no backing the under (or laying the over) on a combo whose
  -- member set contains the bettor. Backing your own over stays allowed.
  IF v_market_type = 'combo'
     AND ((NEW.side = 'back' AND v_key = 'under') OR (NEW.side = 'lay' AND v_key = 'over'))
     AND (v_params -> 'member_ids') ? v_bettor::text THEN
    RAISE EXCEPTION 'A player cannot bet against a combo containing themselves (anti-tanking)';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. RSVP-out auto-void: prune-only sync in the resync fan-out. The predicate
--    reads ONLY rsvp — team_slots/games/scores churn provably cannot kill a
--    combo. The BEFORE DELETE refund trigger makes every touched bet whole
--    (parlays refund whole, feed cards cascade away). Settled/void immutable.
--    Void is final: a member flipping back in does NOT resurrect the market.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_combo_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.bet_markets m
   WHERE m.week_id = p_week_id
     AND m.market_type = 'combo'
     AND m.status IN ('open', 'closed')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(m.params -> 'member_ids') mem(pid)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.rsvp r
         WHERE r.week_id = m.week_id
           AND r.player_id = mem.pid::uuid
           AND r.status = 'in'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_combo_markets_for_week(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.resync_week_markets(p_week_id uuid, p_moneyline boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_week_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = p_week_id AND w.is_archived = false) THEN
    RETURN;
  END IF;
  PERFORM public.sync_over_under_markets_for_week(p_week_id);
  PERFORM public.sync_lanetalk_prop_markets_for_week(p_week_id);
  PERFORM public.sync_team_prop_markets_for_week(p_week_id);
  PERFORM public.sync_combo_markets_for_week(p_week_id);
  IF p_moneyline THEN
    PERFORM public.sync_moneyline_markets_for_week(p_week_id);
  END IF;
END;
$function$;
