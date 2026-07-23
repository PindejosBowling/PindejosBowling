-- Mixed-stat combo legs (owner spec 2026-07-21).
--
-- A combo is no longer one stat across N members — it is a set of
-- (player, stat) LEGS summed against one line: "Player A total pins +
-- Player B spares". Rules grilled with the owner:
--   • ≥2 legs, DISTINCT PLAYERS ONLY (a player can appear on one leg; a
--     same-player multi-stat aggregate is near-redundant with their solo
--     line, so it is rejected).
--   • The combined line stays Σ(per-leg whole bases) + ONE half point
--     (…234333's single-half-point rule, now per leg).
--   • Scope stays uniform for the whole combo (game N or night).
--
-- Storage: params gains `legs` [{player_id, stat}] (sorted by player id).
-- `member_ids`/`member_names` stay (RSVP-out pruning, anti-tank, app
-- membership filters are per-player and unchanged). `stat` is kept ONLY for
-- uniform combos (display + legacy settle path); mixed combos omit it.
-- `clock` = 'lanetalk' when ANY leg is a frame stat, else 'archive'.
-- `combo_key`: uniform combos keep the legacy `stat|scope|game|members`
-- format (dedup compat with existing markets and deployed clients); mixed
-- combos use `mixed|scope|game|player:stat,…`.
--
-- Settlement/preview now share ONE leg-aware helper (combo_market_status):
-- complete only when EVERY leg's (player, stat) has its data (score for a
-- total_pins leg, official imports for a frame leg — the same per-member
-- predicates as before, applied per leg). Legacy markets without `legs`
-- expand member_ids × stat inside the helper, so nothing already open
-- changes behavior.
--
-- compose_combo_bet accepts BOTH spec shapes: new `{legs:[{player_id,stat}],
-- scope, game_number?}` and legacy `{member_ids, stat, scope, game_number?}`
-- (deployed clients keep working — legacy expands to uniform legs).

-- ---------------------------------------------------------------------------
-- 1) combo_seed_line — legs overload: Σ per-leg floor(avg × n_games) + 0.5.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.combo_seed_line(p_legs jsonb, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_leg   record;
  v_sum   numeric := 0;
  v_cap   numeric := 0;
  v_avg   numeric;
  v_n     integer := 0;
BEGIN
  FOR v_leg IN
    SELECT (value ->> 'player_id')::uuid AS pid, value ->> 'stat' AS stat
    FROM jsonb_array_elements(COALESCE(p_legs, '[]'::jsonb))
  LOOP
    v_n := v_n + 1;
    IF v_leg.stat = 'total_pins' THEN
      v_sum := v_sum + floor(public.player_raw_avg_score(v_leg.pid, p_season_id) * p_n_games);
      v_cap := v_cap + 300 * p_n_games;
    ELSIF v_leg.stat IN ('strikes', 'spares', 'clean_frames') THEN
      SELECT CASE v_leg.stat
               WHEN 'strikes' THEN avg(i.strikes)
               WHEN 'spares'  THEN avg(i.spares)
               ELSE avg(i.strikes + i.spares)
             END
        INTO v_avg
      FROM public.lanetalk_game_imports i
      WHERE i.player_id = v_leg.pid AND i.classification = 'official' AND i.frames > 0;
      v_sum := v_sum + floor(COALESCE(v_avg, 0) * p_n_games);
      v_cap := v_cap + 10 * p_n_games;
    ELSE
      RAISE EXCEPTION 'Unknown combo stat %', COALESCE(v_leg.stat, '(null)');
    END IF;
  END LOOP;

  IF v_n = 0 THEN RETURN 0.5; END IF;
  -- One half point total, clamped to [0.5, Σ per-leg maxima − 0.5].
  RETURN LEAST(v_cap - 0.5, GREATEST(0.5, v_sum + 0.5));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.combo_seed_line(jsonb, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.combo_seed_line(jsonb, uuid, integer) TO authenticated;

-- Legacy uuid[] signature delegates (deployed clients' live preview + the
-- expand-members path both stay behavior-identical: uniform legs).
CREATE OR REPLACE FUNCTION public.combo_seed_line(p_member_ids uuid[], p_stat text, p_season_id uuid, p_n_games integer DEFAULT 1)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN public.combo_seed_line(
    (SELECT jsonb_agg(jsonb_build_object('player_id', d.m::text, 'stat', p_stat))
       FROM (SELECT DISTINCT unnest(p_member_ids) AS m) d),
    p_season_id, p_n_games);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) combo_market_status — the ONE leg-aware completeness + value computation,
--    shared by settle_week (c''') and preview_settle_week. Returns
--    {complete boolean, value numeric|null, reason text|null}. Legacy markets
--    (no params.legs) expand member_ids × params.stat.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.combo_market_status(p_week_id uuid, p_game_number integer, p_params jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_legs       jsonb;
  v_leg        record;
  v_total      numeric := 0;
  v_leg_value  numeric;
  v_official_n integer;
  v_scored_n   integer;
BEGIN
  v_legs := p_params -> 'legs';
  IF v_legs IS NULL OR jsonb_typeof(v_legs) <> 'array' OR jsonb_array_length(v_legs) = 0 THEN
    SELECT jsonb_agg(jsonb_build_object('player_id', mem.value, 'stat', p_params ->> 'stat'))
      INTO v_legs
      FROM jsonb_array_elements_text(COALESCE(p_params -> 'member_ids', '[]'::jsonb)) mem;
  END IF;
  IF v_legs IS NULL OR jsonb_array_length(v_legs) = 0 THEN
    RETURN jsonb_build_object('complete', false, 'value', NULL, 'reason', 'combo has no legs');
  END IF;

  FOR v_leg IN
    SELECT (value ->> 'player_id')::uuid AS pid, value ->> 'stat' AS stat
    FROM jsonb_array_elements(v_legs)
  LOOP
    v_leg_value := NULL;

    IF v_leg.stat = 'total_pins' THEN
      -- Archive data: the player's non-fill score(s) for the scope.
      IF p_game_number IS NOT NULL THEN
        SELECT SUM(s.score)::numeric INTO v_leg_value
        FROM public.scores s
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        JOIN public.games g       ON g.id = s.game_id
        WHERE t.week_id = p_week_id AND ts.player_id = v_leg.pid
          AND ts.is_fill = false AND g.game_number = p_game_number
          AND s.score IS NOT NULL;
      ELSE
        SELECT SUM(s.score)::numeric INTO v_leg_value
        FROM public.scores s
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = p_week_id AND ts.player_id = v_leg.pid
          AND ts.is_fill = false AND s.score IS NOT NULL;
      END IF;
      IF v_leg_value IS NULL THEN
        RETURN jsonb_build_object('complete', false, 'value', NULL,
          'reason', 'a combo member has no recorded score');
      END IF;

    ELSIF v_leg.stat IN ('strikes', 'spares', 'clean_frames') THEN
      -- LaneTalk data: official imports for the scope.
      IF p_game_number IS NOT NULL THEN
        SELECT SUM(CASE v_leg.stat
                     WHEN 'strikes' THEN i.strikes
                     WHEN 'spares'  THEN i.spares
                     ELSE i.strikes + i.spares
                   END)::numeric
          INTO v_leg_value
        FROM public.lanetalk_game_imports i
        WHERE i.week_id = p_week_id AND i.player_id = v_leg.pid
          AND i.game_number = p_game_number AND i.classification = 'official';
        IF v_leg_value IS NULL THEN
          RETURN jsonb_build_object('complete', false, 'value', NULL,
            'reason', 'a combo member is awaiting LaneTalk import');
        END IF;
      ELSE
        -- Night: official imports must exist AND cover every recorded score
        -- (the c'' player-night predicate, applied per leg).
        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        WHERE i.week_id = p_week_id AND i.player_id = v_leg.pid
          AND i.classification = 'official';
        SELECT count(*) INTO v_scored_n
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = p_week_id AND ts.player_id = v_leg.pid
          AND ts.is_fill = false AND s.score IS NOT NULL;
        IF v_official_n = 0 OR v_official_n < v_scored_n THEN
          RETURN jsonb_build_object('complete', false, 'value', NULL,
            'reason', 'a combo member is awaiting LaneTalk import');
        END IF;
        SELECT SUM(CASE v_leg.stat
                     WHEN 'strikes' THEN i.strikes
                     WHEN 'spares'  THEN i.spares
                     ELSE i.strikes + i.spares
                   END)::numeric
          INTO v_leg_value
        FROM public.lanetalk_game_imports i
        WHERE i.week_id = p_week_id AND i.player_id = v_leg.pid
          AND i.classification = 'official' AND i.frames > 0;
        v_leg_value := COALESCE(v_leg_value, 0);
      END IF;

    ELSE
      RAISE EXCEPTION 'Unknown combo stat % in combo legs', COALESCE(v_leg.stat, '(null)');
    END IF;

    v_total := v_total + v_leg_value;
  END LOOP;

  RETURN jsonb_build_object('complete', true, 'value', v_total, 'reason', NULL);
END;
$function$;

-- Internal helper — only the SECURITY DEFINER settle/preview paths call it.
REVOKE EXECUTE ON FUNCTION public.combo_market_status(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) compose_combo_bet — legs-aware rewrite (both spec shapes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compose_combo_bet(p_week_id uuid, p_combos jsonb, p_stake integer, p_extra_selection_ids uuid[] DEFAULT NULL::uuid[], p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id    uuid;
  v_season_id    uuid;
  v_archived     boolean;
  v_target_games integer[];
  v_n_games      integer;
  v_spec         jsonb;
  v_legs         jsonb;
  v_stat         text;
  v_uniform      boolean;
  v_scope        text;
  v_game_number  integer;
  v_members      uuid[];
  v_member_texts text[];
  v_member_names text[];
  v_n_named      integer;
  v_combo_key    text;
  v_leg_key      text;
  v_existing     record;
  v_clock        text;
  v_label        text;
  v_title        text;
  v_line         numeric;
  v_market_id    uuid;
  v_over_id      uuid;
  v_deduped      boolean;
  v_market_ids   uuid[] := '{}';
  v_over_ids     uuid[] := '{}';
  v_combos_out   jsonb := '[]'::jsonb;
  v_first_created jsonb := NULL;
  v_n_created    integer := 0;
  v_bet_id       uuid;
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

  IF p_combos IS NULL OR jsonb_typeof(p_combos) <> 'array' OR jsonb_array_length(p_combos) < 1 THEN
    RAISE EXCEPTION 'At least one combo is required';
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

  -- One coarse lock per week serializes identical composes without per-spec
  -- lock-ordering concerns; the partial unique index is the backstop.
  PERFORM pg_advisory_xact_lock(hashtextextended('combo|' || p_week_id::text, 0));

  FOR v_spec IN SELECT value FROM jsonb_array_elements(p_combos) LOOP
    v_scope := v_spec ->> 'scope';
    v_game_number := (v_spec ->> 'game_number')::integer;

    IF v_scope IS NULL OR v_scope NOT IN ('game', 'night') THEN
      RAISE EXCEPTION 'Combo scope must be game or night';
    END IF;
    IF v_scope = 'game' THEN
      IF v_game_number IS NULL OR NOT (v_game_number = ANY (v_target_games)) THEN
        RAISE EXCEPTION 'Game % is not on this week''s schedule', COALESCE(v_game_number::text, '(null)');
      END IF;
    ELSIF v_game_number IS NOT NULL THEN
      RAISE EXCEPTION 'A night combo cannot carry a game number';
    END IF;

    -- Legs: new shape [{player_id, stat}] (mixed stats allowed, one leg per
    -- player); legacy shape member_ids[] + stat expands to uniform legs.
    IF v_spec ? 'legs' THEN
      SELECT jsonb_agg(jsonb_build_object('player_id', l.pid, 'stat', l.stat) ORDER BY l.pid)
        INTO v_legs
        FROM (
          SELECT DISTINCT (value ->> 'player_id') AS pid, (value ->> 'stat') AS stat
          FROM jsonb_array_elements(v_spec -> 'legs')
          WHERE value ->> 'player_id' IS NOT NULL
        ) l;
    ELSE
      v_stat := v_spec ->> 'stat';
      SELECT jsonb_agg(jsonb_build_object('player_id', d.m, 'stat', v_stat) ORDER BY d.m)
        INTO v_legs
        FROM (SELECT DISTINCT (mem.value) AS m
                FROM jsonb_array_elements_text(COALESCE(v_spec -> 'member_ids', '[]'::jsonb)) mem
               WHERE mem.value IS NOT NULL) d;
    END IF;
    IF v_legs IS NULL OR jsonb_array_length(v_legs) < 2 THEN
      RAISE EXCEPTION 'A combo needs at least two distinct players';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_legs) l
      WHERE l.value ->> 'stat' IS NULL
         OR l.value ->> 'stat' NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins')
    ) THEN
      RAISE EXCEPTION 'Unknown combo stat %',
        (SELECT COALESCE(l.value ->> 'stat', '(null)') FROM jsonb_array_elements(v_legs) l
         WHERE l.value ->> 'stat' IS NULL
            OR l.value ->> 'stat' NOT IN ('clean_frames', 'strikes', 'spares', 'total_pins')
         LIMIT 1);
    END IF;

    -- Distinct players only: a player appears on at most one leg (a
    -- same-player multi-stat aggregate is near-redundant with their solo
    -- line — rejected by design).
    SELECT array_agg(m ORDER BY m) INTO v_members
      FROM (SELECT DISTINCT (l.value ->> 'player_id')::uuid AS m
              FROM jsonb_array_elements(v_legs) l) d;
    IF array_length(v_members, 1) <> jsonb_array_length(v_legs) THEN
      RAISE EXCEPTION 'A player can appear in a combo only once';
    END IF;
    IF array_length(v_members, 1) < 2 THEN
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

    -- Uniform combos keep the legacy key format (dedup compat with existing
    -- markets + deployed clients); mixed combos get a legs-shaped key.
    SELECT count(DISTINCT l.value ->> 'stat') = 1, min(l.value ->> 'stat')
      INTO v_uniform, v_stat
      FROM jsonb_array_elements(v_legs) l;
    IF NOT v_uniform THEN v_stat := NULL; END IF;

    SELECT array_agg(m::text ORDER BY m) INTO v_member_texts FROM unnest(v_members) m;
    IF v_uniform THEN
      v_combo_key := v_stat || '|' || v_scope || '|' || COALESCE(v_game_number::text, 'n')
                     || '|' || array_to_string(v_member_texts, ',');
    ELSE
      SELECT string_agg((l.value ->> 'player_id') || ':' || (l.value ->> 'stat'),
                        ',' ORDER BY l.value ->> 'player_id')
        INTO v_leg_key
        FROM jsonb_array_elements(v_legs) l;
      v_combo_key := 'mixed|' || v_scope || '|' || COALESCE(v_game_number::text, 'n')
                     || '|' || v_leg_key;
    END IF;

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
      v_deduped := false;
      -- Any frame-stat leg puts the whole combo on the LaneTalk clock.
      v_clock := CASE WHEN EXISTS (
                   SELECT 1 FROM jsonb_array_elements(v_legs) l
                   WHERE l.value ->> 'stat' <> 'total_pins')
                 THEN 'lanetalk' ELSE 'archive' END;
      IF v_uniform THEN
        v_label := CASE v_stat
                     WHEN 'clean_frames' THEN 'Clean Frames'
                     WHEN 'strikes'      THEN 'Strikes'
                     WHEN 'spares'       THEN 'Spares'
                     ELSE 'Total Pins' END;
        v_title := array_to_string(v_member_names, ' + ') || ' ' || v_label;
      ELSE
        -- Mixed: name each leg — "Alice Total Pins + Bob Spares".
        SELECT string_agg(p.name || ' ' ||
                 CASE l.value ->> 'stat'
                   WHEN 'clean_frames' THEN 'Clean Frames'
                   WHEN 'strikes'      THEN 'Strikes'
                   WHEN 'spares'       THEN 'Spares'
                   ELSE 'Total Pins' END,
                 ' + ' ORDER BY l.value ->> 'player_id')
          INTO v_title
          FROM jsonb_array_elements(v_legs) l
          JOIN public.players p ON p.id = (l.value ->> 'player_id')::uuid;
      END IF;
      v_line := public.combo_seed_line(v_legs, v_season_id,
                  CASE WHEN v_scope = 'game' THEN 1 ELSE v_n_games END);

      INSERT INTO public.bet_markets
          (market_type, title, week_id, game_number, subject_game_id, params, status, created_by_player_id)
        VALUES ('combo',
                v_title || ' — ' || CASE WHEN v_scope = 'game' THEN 'Game ' || v_game_number ELSE 'Night' END,
                p_week_id,
                CASE WHEN v_scope = 'game' THEN v_game_number ELSE NULL END,
                NULL,
                jsonb_build_object(
                  'family', 'combo',
                  'scope', v_scope,
                  'clock', v_clock,
                  'member_ids', to_jsonb(v_member_texts),
                  'member_names', to_jsonb(v_member_names),
                  'legs', v_legs,
                  'combo_key', v_combo_key)
                || CASE WHEN v_uniform THEN jsonb_build_object('stat', v_stat) ELSE '{}'::jsonb END,
                'open',
                v_player_id)
        RETURNING id INTO v_market_id;

      INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order) VALUES
        (v_market_id, 'over',  'Over',  2.000, v_line, 0),
        (v_market_id, 'under', 'Under', 2.000, v_line, 1);

      SELECT s.id INTO v_over_id
        FROM public.bet_selections s
        WHERE s.market_id = v_market_id AND s.key = 'over';

      v_n_created := v_n_created + 1;
      IF v_first_created IS NULL THEN
        v_first_created := jsonb_build_object(
          'stat', v_stat, 'scope', v_scope, 'game_number', v_game_number,
          'member_count', array_length(v_members, 1),
          'member_names', to_jsonb(v_member_names),
          'legs', v_legs,
          'line', v_line);
      END IF;
    END IF;

    -- One ticket cannot carry the same combo twice (place_house_bet expects
    -- each leg on a distinct market; two identical specs dedup to one market).
    IF v_market_id = ANY (v_market_ids) THEN
      RAISE EXCEPTION 'The same combo appears twice on this ticket';
    END IF;
    v_market_ids := v_market_ids || v_market_id;
    v_over_ids := v_over_ids || v_over_id;
    v_combos_out := v_combos_out || jsonb_build_object(
      'market_id', v_market_id, 'line', v_line, 'deduped', v_deduped);
  END LOOP;

  -- Parlay extras must be OTHER markets' selections (no self-referential legs).
  IF p_extra_selection_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bet_selections s
    WHERE s.id = ANY (p_extra_selection_ids) AND s.market_id = ANY (v_market_ids)
  ) THEN
    RAISE EXCEPTION 'A combo cannot parlay with its own selections';
  END IF;

  -- Compose = bet: place_house_bet re-validates every leg (open market, same
  -- season/week, min stake, balance, anti-tank, item contracts) and writes the
  -- bet + legs + the bet_stake double entry. Any failure rolls the new
  -- market(s) back too.
  v_bet_id := public.place_house_bet(
    v_over_ids || COALESCE(p_extra_selection_ids, '{}'::uuid[]),
    p_stake, NULL,
    p_insurance_item_id, p_crutch_item_id, p_boost_item_id);

  -- Feed: at most ONE compose card per bet (activity_feed_unique_bet_event is
  -- (bet, event_type)) — published only when this ticket minted ≥1 new market;
  -- payload carries the first created combo + how many were created. Dedup-only
  -- tickets post nothing beyond place_house_bet's own priority events.
  IF v_n_created > 0 THEN
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_combo_composed',
      v_season_id, p_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.combo_composed',
      v_first_created || jsonb_build_object('stake', p_stake, 'combo_count', v_n_created),
      jsonb_build_object('bet_id', v_bet_id, 'market_ids', to_jsonb(v_market_ids)),
      NULL, now());
  END IF;

  RETURN jsonb_build_object('bet_id', v_bet_id, 'combos', v_combos_out);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) settle_week — verbatim re-create except step (c'''), which now computes
--    each combo through the shared leg-aware helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_week(p_week_id uuid, p_void_missing boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_is_archived boolean;
  v_run_id      uuid;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
  v_n_pending   integer;
  v_titles      text;
  v_bet         record;
  -- LaneTalk fold locals
  v_stat        text;
  v_value       numeric;
  v_team_id     uuid;
  v_complete    boolean;
  v_official_n  integer;
  v_scored_n    integer;
  v_combo       jsonb;
  v_settled     integer := 0;
  v_voided      integer := 0;
  v_pending     integer := 0;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number, is_archived
    INTO v_season_id, v_week_number, v_is_archived
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;
  IF NOT v_is_archived THEN
    RAISE EXCEPTION 'Week must be advanced (locked) before it can be settled';
  END IF;

  SELECT id INTO v_run_id
    FROM public.week_archive_runs
   WHERE week_id = p_week_id AND status = 'active'
   ORDER BY archived_at DESC LIMIT 1;
  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'No active archive run for this week — advance it first';
  END IF;

  -- --------------------------------------------------------------------------
  -- Money snapshot capture, phase='settle', ONCE per run. Skipped on re-settle
  -- so the snapshot pins the pre-FIRST-settle state; re-settle is additive via
  -- the per-step guards and stays reversible by unsettle/unarchive.
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.week_archive_snapshot WHERE run_id = v_run_id AND phase = 'settle') THEN
    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'pin_ledger', pl.id, 'settle'
      FROM public.pin_ledger pl
     WHERE pl.week_id = p_week_id
        OR pl.bet_id IN (SELECT b.id FROM public.bets b WHERE b.week_id = p_week_id);

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'loan_ledger', ll.id, 'settle'
      FROM public.loan_ledger ll WHERE ll.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'pvp_ledger', pv.id, 'settle'
      FROM public.pvp_ledger pv WHERE pv.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, phase)
    SELECT v_run_id, 'preexisting_id', 'activity_feed_events', af.id, 'settle'
      FROM public.activity_feed_events af WHERE af.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_markets', m.id,
           jsonb_build_object('status', m.status, 'result_value', m.result_value, 'settled_at', m.settled_at), 'settle'
      FROM public.bet_markets m WHERE m.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_selections', s.id,
           jsonb_build_object('result', s.result), 'settle'
      FROM public.bet_selections s
      JOIN public.bet_markets m ON m.id = s.market_id
     WHERE m.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bets', b.id,
           jsonb_build_object('status', b.status, 'potential_payout', b.potential_payout, 'settled_at', b.settled_at), 'settle'
      FROM public.bets b WHERE b.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'bet_legs', l.id,
           jsonb_build_object('result', l.result), 'settle'
      FROM public.bet_legs l
      JOIN public.bets b ON b.id = l.bet_id
     WHERE b.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'pvp_challenges', c.id,
           jsonb_build_object('status', c.status, 'winner_player_id', c.winner_player_id,
                              'result_detail', c.result_detail, 'settled_at', c.settled_at,
                              'admin_note', c.admin_note), 'settle'
      FROM public.pvp_challenges c WHERE c.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'pvp_challenge_offers', o.id,
           jsonb_build_object('superseded_at', o.superseded_at, 'accepted_at', o.accepted_at,
                              'declined_at', o.declined_at), 'settle'
      FROM public.pvp_challenge_offers o
      JOIN public.pvp_challenges c ON c.id = o.challenge_id
     WHERE c.week_id = p_week_id;

    INSERT INTO public.week_archive_snapshot (run_id, kind, table_name, pk, payload, phase)
    SELECT v_run_id, 'preimage_row', 'loans', ln.id,
           jsonb_build_object('status', ln.status, 'paid_off_at', ln.paid_off_at), 'settle'
      FROM public.loans ln
     WHERE ln.season_id = v_season_id AND ln.status = 'active';
  END IF;

  -- (a) Score credits (player-only mints), once per week.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE week_id = p_week_id AND type = 'score_credit'
  ) THEN
    INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description)
    SELECT ts.player_id, v_season_id, p_week_id, s.score, 'score_credit',
           'Week ' || v_week_number || ' Game ' || g.game_number || ': ' || s.score || ' pins'
    FROM public.scores s
    JOIN public.games g       ON g.id = s.game_id
    JOIN public.team_slots ts ON ts.id = s.team_slot_id
    JOIN public.teams t       ON t.id = ts.team_id
    WHERE t.week_id = p_week_id
      AND ts.player_id IS NOT NULL
      AND ts.is_fill = false
      AND s.score IS NOT NULL;
  END IF;

  -- (b) O/U settlement. Game markets: subject's game score. Night markets
  --     (game_number NULL): Σ subject's non-fill scores across the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
    IF v_mkt.game_number IS NOT NULL THEN
      SELECT s.score INTO v_score
      FROM public.scores s
      JOIN public.games g       ON g.id = s.game_id
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND g.game_number = v_mkt.game_number
        AND s.score IS NOT NULL
      LIMIT 1;
    ELSE
      SELECT SUM(s.score)::integer INTO v_score
      FROM public.scores s
      JOIN public.team_slots ts ON ts.id = s.team_slot_id
      JOIN public.teams t       ON t.id = ts.team_id
      WHERE t.week_id = p_week_id
        AND ts.player_id = v_mkt.subject_player_id
        AND ts.is_fill = false
        AND s.score IS NOT NULL;
    END IF;

    IF v_score IS NULL THEN
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- (c) Moneyline settlement.
  FOR v_mkt IN
    SELECT id, subject_game_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'moneyline' AND status <> 'settled'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.scores
      WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
    ) THEN
      PERFORM public.settle_moneyline_market_internal(v_mkt.id);
    ELSE
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    END IF;
  END LOOP;

  -- (c') team_prop TOTAL PINS markets (archive clock).
  FOR v_mkt IN
    SELECT id, subject_game_id, (params ->> 'team_id')::uuid AS team_id
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'team_prop'
      AND params ->> 'stat' = 'total_pins' AND params ->> 'clock' = 'archive'
      AND status <> 'settled'
  LOOP
    IF v_mkt.subject_game_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.scores
        WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE sc.game_id = v_mkt.subject_game_id
          AND ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id AND sc.score IS NOT NULL
      ) THEN
        SELECT COALESCE(SUM(sc.score), 0) INTO v_score
        FROM public.scores sc
        JOIN public.team_slots ts ON ts.id = sc.team_slot_id
        WHERE ts.team_id = v_mkt.team_id
          AND sc.score IS NOT NULL;
        PERFORM public.settle_market_internal(v_mkt.id, v_score);
      ELSE
        UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
      END IF;
    END IF;
  END LOOP;

  -- (c'') LaneTalk player + team props (FOLDED IN from
  --       settle_lanetalk_props_for_week). Settles off official imports; markets
  --       with no gradable value are delete-refunded when p_void_missing, else
  --       left pending (exempt from the backstop below).
  FOR v_mkt IN
    SELECT id, market_type, subject_player_id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id
      AND status IN ('open', 'closed')
      AND ((market_type = 'prop' AND params ->> 'source' = 'lanetalk')
        OR (market_type = 'team_prop' AND params ->> 'clock' = 'lanetalk'))
  LOOP
    v_stat  := v_mkt.params ->> 'stat';
    v_value := NULL;

    IF v_mkt.market_type = 'team_prop' THEN
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames') THEN
        RAISE EXCEPTION 'Unknown LaneTalk team stat % on market %', v_stat, v_mkt.id;
      END IF;
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;

      IF v_mkt.game_number IS NOT NULL THEN
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.team_slots ts
          JOIN public.scores s ON s.team_slot_id = ts.id
          JOIN public.games g  ON g.id = s.game_id
          WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
            AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.lanetalk_game_imports i
              WHERE i.week_id = p_week_id
                AND i.player_id = ts.player_id
                AND i.game_number = g.game_number
                AND i.classification = 'official')
        ) INTO v_complete;

        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        JOIN public.team_slots ts ON ts.team_id = v_team_id
                                 AND ts.player_id = i.player_id
                                 AND ts.is_fill = false
        WHERE i.week_id = p_week_id
          AND i.game_number = v_mkt.game_number
          AND i.classification = 'official';

        IF v_complete AND v_official_n > 0 THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id
                                   AND ts.player_id = i.player_id
                                   AND ts.is_fill = false
          WHERE i.week_id = p_week_id
            AND i.game_number = v_mkt.game_number
            AND i.classification = 'official';
        END IF;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.team_slots ts
          WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
            AND (SELECT count(*) FROM public.scores s
                 WHERE s.team_slot_id = ts.id AND s.score IS NOT NULL)
              > (SELECT count(*) FROM public.lanetalk_game_imports i
                 WHERE i.week_id = p_week_id
                   AND i.player_id = ts.player_id
                   AND i.classification = 'official')
        ) INTO v_complete;

        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        JOIN public.team_slots ts ON ts.team_id = v_team_id
                                 AND ts.player_id = i.player_id
                                 AND ts.is_fill = false
        WHERE i.week_id = p_week_id
          AND i.classification = 'official';

        IF v_complete AND v_official_n > 0 THEN
          SELECT SUM(CASE v_stat
                       WHEN 'strikes' THEN i.strikes
                       WHEN 'spares'  THEN i.spares
                       ELSE i.strikes + i.spares
                     END)::numeric
            INTO v_value
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id
                                   AND ts.player_id = i.player_id
                                   AND ts.is_fill = false
          WHERE i.week_id = p_week_id
            AND i.classification = 'official'
            AND i.frames > 0;
        END IF;
      END IF;

    ELSE
      IF v_stat NOT IN ('strikes', 'spares', 'clean_frames', 'clean_pct', 'first_ball_avg') THEN
        RAISE EXCEPTION 'Unknown LaneTalk stat % on market %', v_stat, v_mkt.id;
      END IF;

      IF v_mkt.game_number IS NOT NULL THEN
        SELECT CASE v_stat
                 WHEN 'strikes'        THEN st.strikes::numeric
                 WHEN 'spares'         THEN st.spares::numeric
                 WHEN 'clean_frames'   THEN (st.strikes + st.spares)::numeric
                 WHEN 'clean_pct'      THEN st.clean_pct
                 WHEN 'first_ball_avg' THEN st.first_ball_avg
               END
          INTO v_value
        FROM public.lanetalk_game_imports i
        CROSS JOIN LATERAL (
          SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg
        ) st
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.game_number = v_mkt.game_number
          AND i.classification = 'official'
        LIMIT 1;
      ELSE
        SELECT count(*) INTO v_official_n
        FROM public.lanetalk_game_imports i
        WHERE i.week_id = p_week_id
          AND i.player_id = v_mkt.subject_player_id
          AND i.classification = 'official';

        SELECT count(*) INTO v_scored_n
        FROM public.scores s
        JOIN public.games g       ON g.id = s.game_id
        JOIN public.team_slots ts ON ts.id = s.team_slot_id
        JOIN public.teams t       ON t.id = ts.team_id
        WHERE t.week_id = p_week_id
          AND ts.player_id = v_mkt.subject_player_id
          AND ts.is_fill = false
          AND s.score IS NOT NULL;

        IF v_official_n > 0 AND v_official_n >= v_scored_n THEN
          SELECT CASE v_stat
                   WHEN 'strikes'        THEN SUM(st.strikes)::numeric
                   WHEN 'spares'         THEN SUM(st.spares)::numeric
                   WHEN 'clean_frames'   THEN (SUM(st.strikes) + SUM(st.spares))::numeric
                   WHEN 'clean_pct'      THEN SUM(st.clean_pct * st.frames) / NULLIF(SUM(st.frames), 0)
                   WHEN 'first_ball_avg' THEN SUM(st.first_ball_avg * st.frames) / NULLIF(SUM(st.frames), 0)
                 END
            INTO v_value
          FROM public.lanetalk_game_imports i
          CROSS JOIN LATERAL (
            SELECT i.strikes, i.spares, i.clean_pct, i.first_ball_avg, i.frames
          ) st
          WHERE i.week_id = p_week_id
            AND i.player_id = v_mkt.subject_player_id
            AND i.classification = 'official'
            AND st.frames > 0;
        END IF;
      END IF;
    END IF;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  -- (c''') Combo markets (BOTH clocks): Σ leg values vs the line — each leg is
  --        one (player, stat); legacy markets (params.stat + member_ids, no
  --        legs) expand inside combo_market_status. A combo settles only when
  --        EVERY leg has complete data for its scope — an absent member never
  --        silently settles the sum low. Missing data ⇒ delete-refund when
  --        p_void_missing (the refund-trigger rail), else left pending
  --        (exempt from the backstop below, both clocks: an archive-clock
  --        combo missing a member score will never self-heal, but preview
  --        flags it and voidMissing resolves it).
  FOR v_mkt IN
    SELECT id, game_number, params
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'combo'
      AND status IN ('open', 'closed')
  LOOP
    v_combo := public.combo_market_status(p_week_id, v_mkt.game_number, v_mkt.params);
    v_value := CASE WHEN (v_combo ->> 'complete')::boolean
                    THEN (v_combo ->> 'value')::numeric ELSE NULL END;

    IF v_value IS NOT NULL THEN
      PERFORM public.settle_market_internal(v_mkt.id, v_value);
      v_settled := v_settled + 1;
    ELSIF p_void_missing THEN
      DELETE FROM public.bet_markets WHERE id = v_mkt.id;
      v_voided := v_voided + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  -- (d) Loan garnishment + interest.
  PERFORM public.process_weekly_loans(p_week_id);

  -- (e) PvP: auto-settle locked contracts for this week.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- --------------------------------------------------------------------------
  -- (f) Backstop, NARROWED. Props now settle in (c'') above, so the exemption
  --     is no longer blanket: a bet is exempt from the pending-count/void ONLY
  --     when p_void_missing = false AND it has a leg on a still-unsettled
  --     next-day-clock market (LaneTalk player prop or LaneTalk-clock team_prop)
  --     — i.e. a market genuinely still lacking import data. With
  --     p_void_missing = true those markets were delete-refunded in (c''), so no
  --     such legs remain and the exemption is inert.
  -- --------------------------------------------------------------------------
  SELECT count(*) INTO v_n_pending
  FROM public.bets b
  WHERE b.week_id = p_week_id AND b.status = 'pending'
    AND (p_void_missing OR NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.status <> 'settled'
        AND (m2.market_type = 'prop'
             OR m2.market_type = 'combo'
             OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
    ));

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE b.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND (p_void_missing OR NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        ));

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      WHERE b.week_id = p_week_id AND b.status = 'pending'
        AND (p_void_missing OR NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.status <> 'settled'
            AND (m2.market_type = 'prop'
                 OR m2.market_type = 'combo'
                 OR (m2.market_type = 'team_prop' AND m2.params ->> 'clock' = 'lanetalk'))
        ))
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, p_week_id,
        v_bet.stake, 'bet_refund', 'Voided at settlement — market never settled', NULL, v_bet.id);
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- (g) UNIFIED House weekly P/L — computed once, over ALL week-anchored house
  --     ledger rows (bets incl. LaneTalk payouts, PvP, loan garnishment),
  --     EXCLUDING bounty/auction (own feed cards + own clocks). UPSERT so a
  --     re-settle after a late import refreshes it (stable row id).
  -- --------------------------------------------------------------------------
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
   WHERE pl.is_house = true
     AND pl.week_id = p_week_id
     AND pl.auction_id IS NULL
     AND pl.bounty_post_id IS NULL;

  IF EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    UPDATE public.activity_feed_events
       SET public_payload = jsonb_set(COALESCE(public_payload, '{}'::jsonb), '{house_net}', to_jsonb(v_house_net)),
           updated_at = now()
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result';
  ELSE
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;

  -- Mark settled (preserve first-settle time across re-settles).
  UPDATE public.weeks SET settled_at = now() WHERE id = p_week_id AND settled_at IS NULL;

  UPDATE public.week_archive_runs
     SET details = details || jsonb_build_object(
           'settled_at', now(),
           'settle_counts', jsonb_build_object(
             'settled', v_settled, 'voided', v_voided,
             'left_pending', v_pending, 'house_net', v_house_net))
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'settled', v_settled, 'voided', v_voided,
    'left_pending', v_pending, 'house_net', v_house_net);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) preview_settle_week — verbatim re-create except the combo branch, which
--    now mirrors settle_week (c''') through the same helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_settle_week(p_week_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_mkt          record;
  v_stat         text;
  v_team_id      uuid;
  v_has          boolean;
  v_complete     boolean;
  v_official_n   integer;
  v_scored_n     integer;
  v_combo        jsonb;
  v_reason       text;
  v_settleable   integer := 0;
  v_would_void   jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_admin();

  IF NOT EXISTS (SELECT 1 FROM public.weeks WHERE id = p_week_id) THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  FOR v_mkt IN
    SELECT id, market_type, subject_player_id, subject_game_id, game_number, title, params
    FROM public.bet_markets
    WHERE week_id = p_week_id AND status <> 'settled'
  LOOP
    v_has    := false;
    v_reason := NULL;

    IF v_mkt.market_type = 'over_under' THEN
      IF v_mkt.game_number IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.scores s
          JOIN public.games g       ON g.id = s.game_id
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
        ) INTO v_has;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.scores s
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND s.score IS NOT NULL
        ) INTO v_has;
      END IF;
      v_reason := 'no scores recorded';

    ELSIF v_mkt.market_type = 'moneyline' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.scores WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL
      ) INTO v_has;
      v_reason := 'no scores recorded for the game';

    ELSIF v_mkt.market_type = 'team_prop' AND v_mkt.params ->> 'stat' = 'total_pins'
          AND v_mkt.params ->> 'clock' = 'archive' THEN
      v_team_id := (v_mkt.params ->> 'team_id')::uuid;
      IF v_mkt.subject_game_id IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM public.scores WHERE game_id = v_mkt.subject_game_id AND score IS NOT NULL) INTO v_has;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.scores sc
          JOIN public.team_slots ts ON ts.id = sc.team_slot_id
          WHERE ts.team_id = v_team_id AND sc.score IS NOT NULL
        ) INTO v_has;
      END IF;
      v_reason := 'no scores recorded';

    ELSIF (v_mkt.market_type = 'prop' AND v_mkt.params ->> 'source' = 'lanetalk')
       OR (v_mkt.market_type = 'team_prop' AND v_mkt.params ->> 'clock' = 'lanetalk') THEN
      v_stat := v_mkt.params ->> 'stat';
      v_reason := 'awaiting LaneTalk import';

      IF v_mkt.market_type = 'team_prop' THEN
        v_team_id := (v_mkt.params ->> 'team_id')::uuid;
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT NOT EXISTS (
            SELECT 1 FROM public.team_slots ts
            JOIN public.scores s ON s.team_slot_id = ts.id
            JOIN public.games g  ON g.id = s.game_id
            WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
              AND g.game_number = v_mkt.game_number AND s.score IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.lanetalk_game_imports i
                WHERE i.week_id = p_week_id AND i.player_id = ts.player_id
                  AND i.game_number = g.game_number AND i.classification = 'official')
          ) INTO v_complete;
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id AND ts.player_id = i.player_id AND ts.is_fill = false
          WHERE i.week_id = p_week_id AND i.game_number = v_mkt.game_number AND i.classification = 'official';
        ELSE
          SELECT NOT EXISTS (
            SELECT 1 FROM public.team_slots ts
            WHERE ts.team_id = v_team_id AND ts.is_fill = false AND ts.player_id IS NOT NULL
              AND (SELECT count(*) FROM public.scores s WHERE s.team_slot_id = ts.id AND s.score IS NOT NULL)
                > (SELECT count(*) FROM public.lanetalk_game_imports i
                   WHERE i.week_id = p_week_id AND i.player_id = ts.player_id AND i.classification = 'official')
          ) INTO v_complete;
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          JOIN public.team_slots ts ON ts.team_id = v_team_id AND ts.player_id = i.player_id AND ts.is_fill = false
          WHERE i.week_id = p_week_id AND i.classification = 'official';
        END IF;
        v_has := (v_complete AND v_official_n > 0);
      ELSE
        IF v_mkt.game_number IS NOT NULL THEN
          SELECT EXISTS (
            SELECT 1 FROM public.lanetalk_game_imports i
            WHERE i.week_id = p_week_id AND i.player_id = v_mkt.subject_player_id
              AND i.game_number = v_mkt.game_number AND i.classification = 'official'
          ) INTO v_has;
        ELSE
          SELECT count(*) INTO v_official_n
          FROM public.lanetalk_game_imports i
          WHERE i.week_id = p_week_id AND i.player_id = v_mkt.subject_player_id AND i.classification = 'official';
          SELECT count(*) INTO v_scored_n
          FROM public.scores s
          JOIN public.games g       ON g.id = s.game_id
          JOIN public.team_slots ts ON ts.id = s.team_slot_id
          JOIN public.teams t       ON t.id = ts.team_id
          WHERE t.week_id = p_week_id AND ts.player_id = v_mkt.subject_player_id
            AND ts.is_fill = false AND s.score IS NOT NULL;
          v_has := (v_official_n > 0 AND v_official_n >= v_scored_n);
        END IF;
      END IF;

    ELSIF v_mkt.market_type = 'combo' THEN
      -- Mirrors settle_week (c''') through the shared leg-aware helper:
      -- complete only when EVERY leg's (player, stat) has its data.
      v_combo  := public.combo_market_status(p_week_id, v_mkt.game_number, v_mkt.params);
      v_has    := (v_combo ->> 'complete')::boolean;
      v_reason := v_combo ->> 'reason';

    ELSE
      -- Any other non-settled market (shouldn't reach settlement) — treat as
      -- settleable so it isn't flagged as a spurious void.
      v_has := true;
    END IF;

    IF v_has THEN
      v_settleable := v_settleable + 1;
    ELSE
      v_would_void := v_would_void || jsonb_build_object(
        'market_id', v_mkt.id,
        'market_type', v_mkt.market_type,
        'title', v_mkt.title,
        'reason', v_reason);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'settleable', v_settleable,
    'missing_count', jsonb_array_length(v_would_void),
    'would_void', v_would_void);
END;
$function$;
