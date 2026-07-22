-- OddsEngine probe — self-contained, assertion-grade (see
-- context/db-verification.md). Exercises the fair-book pricing core: the
-- normal CDF, zero-vig price pairs + clamps, recency-weighted player
-- estimation, the ladder minter, side-aware grading, and the PvP prop-duel
-- same-rung counterparty derivation. Zero persistence (final RAISE aborts).
--
-- Fixtures: 2 probe players (one with a hot-streak official import history,
-- one import-less cold start), pins seeded on the live open week, one probe
-- team pair + game, hand-inserted over_under markets laddered via
-- odds_engine_mint_ladder (generator rewrites are probed in their own
-- vectors once migration 2 lands — this file probes the engine itself).
--
-- Vectors:
--   O1  norm_cdf: Φ(0)=0.5, Φ(±1.96)≈0.975/0.025 (A&S 7.1.26 accuracy band).
--   O2  price_pair at the median line → both sides ≈ evens; zero-vig identity
--       1/over + 1/under ≈ 1 within rounding tolerance.
--   O3  clamp: a runaway-favorite rung returns NULL unforced; forced (seed)
--       returns odds clamped into [odds_min, odds_max].
--   O4  monotonicity: over odds non-decreasing as the line rises.
--   O5  mint_ladder: seed rung keeps canonical 'over'/'under' keys at the seed
--       line; every over rung has an under twin at the same line; ≤ 7 pairs;
--       all odds in clamp; sides + distinct sort_orders set; alt keys
--       'over:<line>'.
--   O6  is_enabled=false (season override row) → exactly one 2.000
--       over/under pair — byte-for-byte the legacy shape.
--   O7  estimation: cold start = league prior mean; a hot recent streak pulls
--       the recency-weighted mean above the unweighted lifetime average.
--   O8  side backfill: no over/under-keyed selection anywhere disagrees with
--       its side column.
--   O9  side-aware grading: settle a laddered market; each over rung grades
--       against its OWN line (below result → won, above → lost, equal → push).
--   O10 PvP prop_duel on an ALT rung: counterparty selection = same line,
--       opposite side (the old `key <> sel LIMIT 1` picked an arbitrary rung).
--   G1  RSVP-driven O/U generation mints priced ladders (≥2 pairs, sides set,
--       odds in clamp) for a cold-start player; no LaneTalk props before any
--       official import exists (the gate).
--   G2  resync after imports mints stat-prop ladders; the hot-streak player's
--       seed strikes rung (line 3.5 = lifetime formula) prices ABOVE evens —
--       the recency-weighted mean (≈2.4) sits under the unweighted seed line.
--   G3  id stability: a no-change resync leaves every selection id untouched
--       (churn guard), so staged-but-unplaced slips survive quiet resyncs.
--   G4  freeze: once a bet lands on any rung, new imports + resync leave the
--       whole ladder untouched.
--   CB1 combo_preview_ladder returns a priced multi-rung ladder; composing at
--       a chosen ALT rung mints the full ladder and bets that rung (leg
--       snapshots the chosen line + preview odds).
--   CB2 preview pass-through: with the market now open, preview returns its
--       posted rungs; dedup-composing an unposted line RAISES; the seed rung
--       dedup-composes fine.
--   P1  norm_ppf: cdf(ppf(p)) ≈ p across the central and tail regions.
--   P2  market_price_line posted echo: NULL line → the seed rung's posted
--       odds verbatim (posted=true); band edges are half-points bracketing
--       the seed.
--   P3  fresh-line parity: an unposted in-band line prices exactly what a
--       direct price_pair call on the same distribution says (posted=false).
--   P4  rejections: non-half-point lines RAISE; a far-out-of-range line
--       returns odds NULL ("line unavailable"); settled markets RAISE.
--   P5  engine-off degradation (season override): min=max=seed, seed still
--       quotable at its posted price, unposted lines return odds NULL.
--   P6  combo_price_line fresh path: seed anchor = combo_seed_line, seed
--       prices in-band; posted echo on the CB1 market's seed; an UNPOSTED
--       in-band line on that existing market prices fresh (odds non-NULL) —
--       the compose-time mint contract.
--   M1  place_bet_at_lines at an unposted line: mints EXACTLY one over/under
--       pair at the fresh (= quoted) zero-vig price with convention keys,
--       and the leg snapshots the chosen line + quote.
--   M2  same line again (by the market's own subject — over on self is
--       legal): rung REUSED, both bets share one selection id.
--   M3  drifted quote → 'ODDS_MOVED|…' contract, nothing minted.
--   M4  out-of-band line rejected; an over-balance placement rolls its
--       freshly minted rung back (no betless custom rung persists).
--   M5  settlement grades the custom rung per its own line; both bets pay.
--   CB3 quoted combo spec at an UNPOSTED line on the existing (bet-frozen)
--       market mints the rung and composes (dedup path).
--   CB4 combo + line-shaped extra pick (p_extra_picks) → ONE bet, two legs.
-- Always aborts via the final RAISE.
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_p1 uuid; v_p2 uuid;
  v_season uuid; v_week uuid;
  v_t1 uuid; v_t2 uuid; v_slot1 uuid; v_slot2 uuid; v_game uuid;
  v_cdf double precision;
  v_over numeric; v_under numeric; v_prev numeric;
  v_line numeric;
  v_mkt uuid; v_mkt2 uuid; v_mkt3 uuid;
  v_n int; v_n2 int;
  v_seed_over uuid;
  v_cfg_row uuid;
  v_prior_mean numeric; v_prior_var numeric;
  v_mean numeric; v_var numeric; v_w numeric;
  v_cold_mean numeric;
  v_hot_mean numeric;
  v_cold_order_mean numeric;
  v_alt_key text; v_alt_line numeric;
  v_challenge uuid; v_cp_sel text;
  v_ladder_pairs int;
  v_gmkt uuid; v_pmkt uuid; v_n3 int;
  v_ids_before uuid[]; v_ids_after uuid[];
  v_ladder jsonb; v_choice jsonb; v_res jsonb;
  v_custom_line numeric; v_q numeric; v_bet_m uuid; v_bet_m2 uuid;
  v_combo_mkt uuid; v_combo_bet uuid; v_leg record;
  v_seed_cnt int;
  c_seed constant int := 1000;
  i int;
BEGIN
  ------------------------------------------------------------------ fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, phone) VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000081'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '10000000082');
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'OddsHot', '+10000000081', v_u1) RETURNING id INTO v_p1;
  INSERT INTO public.players (first_name, last_name, phone, user_id)
    VALUES ('Probe', 'OddsCold', '+10000000082', v_u2) RETURNING id INTO v_p2;

  v_season := public.current_season_id();
  SELECT id INTO v_week FROM public.weeks
    WHERE season_id = v_season AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'PROBE_SETUP_FAILED: no open week in the active season';
  END IF;

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, amount, type, description) VALUES
    (v_p1, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed'),
    (v_p2, v_season, v_week, c_seed, 'score_credit', 'PROBE FIXTURE seed');

  INSERT INTO public.rsvp (week_id, player_id, status) VALUES
    (v_week, v_p1, 'in'), (v_week, v_p2, 'in');

  ------------------------------------------------------------------ O1 norm_cdf
  v_cdf := public.odds_engine_norm_cdf(0);
  IF abs(v_cdf - 0.5) > 1e-6 THEN
    RAISE EXCEPTION 'PROBE_FAIL: Φ(0) = % (expected 0.5)', v_cdf;
  END IF;
  v_cdf := public.odds_engine_norm_cdf(1.959964);
  IF abs(v_cdf - 0.975) > 5e-4 THEN
    RAISE EXCEPTION 'PROBE_FAIL: Φ(1.96) = % (expected ≈0.975)', v_cdf;
  END IF;
  v_cdf := public.odds_engine_norm_cdf(-1.959964);
  IF abs(v_cdf - 0.025) > 5e-4 THEN
    RAISE EXCEPTION 'PROBE_FAIL: Φ(-1.96) = % (expected ≈0.025)', v_cdf;
  END IF;

  ------------------------------------------------------------------ O2 fair evens
  SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
    FROM public.odds_engine_price_pair(100, 225, 1, 100.5, 1.10, 8.00, false) pp;
  IF v_over IS NULL OR abs(v_over - 2.0) > 0.15 OR abs(v_under - 2.0) > 0.15 THEN
    RAISE EXCEPTION 'PROBE_FAIL: median-line pair (%, %) not ≈ evens', v_over, v_under;
  END IF;
  IF abs(1.0 / v_over + 1.0 / v_under - 1.0) > 0.05 THEN
    RAISE EXCEPTION 'PROBE_FAIL: vig detected: 1/% + 1/% <> 1', v_over, v_under;
  END IF;

  ------------------------------------------------------------------ O3 clamp
  SELECT pp.over_odds INTO v_over
    FROM public.odds_engine_price_pair(100, 225, 1, 40.5, 1.10, 8.00, false) pp;
  IF v_over IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: runaway-favorite rung minted unforced at odds %', v_over;
  END IF;
  SELECT pp.over_odds, pp.under_odds INTO v_over, v_under
    FROM public.odds_engine_price_pair(100, 225, 1, 40.5, 1.10, 8.00, true) pp;
  IF v_over IS DISTINCT FROM 1.10 OR v_under IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION 'PROBE_FAIL: forced clamp gave (%, %) expected (1.10, 8.00)', v_over, v_under;
  END IF;

  ------------------------------------------------------------------ O4 monotone
  v_prev := NULL;
  FOR i IN 0..6 LOOP
    v_line := 70.5 + i * 10;
    SELECT pp.over_odds INTO v_over
      FROM public.odds_engine_price_pair(100, 225, 1, v_line, 1.001, 1000, true) pp;
    IF v_prev IS NOT NULL AND v_over < v_prev THEN
      RAISE EXCEPTION 'PROBE_FAIL: over odds not monotone at line % (% < %)', v_line, v_over, v_prev;
    END IF;
    v_prev := v_over;
  END LOOP;

  ------------------------------------------------------------------ O5 mint ladder
  INSERT INTO public.bet_markets (market_type, title, week_id, subject_player_id, game_number, status)
    VALUES ('over_under', 'PROBE odds ladder', v_week, v_p1, 1, 'open')
    RETURNING id INTO v_mkt;
  PERFORM public.odds_engine_mint_ladder(v_mkt, 142.5, 140, 300, 1, 10, 0.5, 999, v_season);

  SELECT count(*) INTO v_n FROM public.bet_selections WHERE market_id = v_mkt;
  SELECT count(*) INTO v_ladder_pairs FROM public.bet_selections WHERE market_id = v_mkt AND side = 'over';
  IF v_n <> v_ladder_pairs * 2 OR v_ladder_pairs < 3 OR v_ladder_pairs > 7 THEN
    RAISE EXCEPTION 'PROBE_FAIL: ladder minted % selections / % over rungs', v_n, v_ladder_pairs;
  END IF;
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_mkt AND key = 'over' AND side = 'over' AND line = 142.5;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: seed over rung missing/misplaced';
  END IF;
  SELECT count(*) INTO v_n FROM public.bet_selections o
    WHERE o.market_id = v_mkt AND o.side = 'over'
      AND NOT EXISTS (SELECT 1 FROM public.bet_selections u
                      WHERE u.market_id = v_mkt AND u.side = 'under' AND u.line = o.line);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: % over rungs missing their under twin', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_mkt AND (odds < 1.05 OR odds > 8.00);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: % selections priced outside the clamp', v_n;
  END IF;
  SELECT count(*) - count(DISTINCT sort_order) INTO v_n FROM public.bet_selections WHERE market_id = v_mkt;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: duplicate sort_orders in ladder';
  END IF;
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_mkt AND key LIKE 'over:%' AND side = 'over';
  IF v_n <> v_ladder_pairs - 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: alt over keys % (expected %)', v_n, v_ladder_pairs - 1;
  END IF;

  ------------------------------------------------------------------ O6 disabled = legacy shape
  INSERT INTO public.odds_engine_config (season_id, is_enabled)
    VALUES (v_season, false) RETURNING id INTO v_cfg_row;
  INSERT INTO public.bet_markets (market_type, title, week_id, subject_player_id, game_number, status)
    VALUES ('over_under', 'PROBE odds legacy', v_week, v_p1, 1, 'open')
    RETURNING id INTO v_mkt2;
  PERFORM public.odds_engine_mint_ladder(v_mkt2, 142.5, 140, 300, 1, 10, 0.5, 999, v_season);
  SELECT count(*) INTO v_n FROM public.bet_selections WHERE market_id = v_mkt2;
  SELECT count(*) INTO v_n2 FROM public.bet_selections
    WHERE market_id = v_mkt2 AND odds = 2.000 AND line = 142.5
      AND key IN ('over', 'under') AND side = key;
  IF v_n <> 2 OR v_n2 <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: disabled engine minted %/% legacy selections', v_n, v_n2;
  END IF;
  DELETE FROM public.odds_engine_config WHERE id = v_cfg_row;

  ------------------------------------------------------------------ O7 estimation
  SELECT lp.mean, lp.variance INTO v_prior_mean, v_prior_var
    FROM public.odds_engine_league_prior(v_season, 'strikes') lp;
  SELECT ps.mean INTO v_cold_mean
    FROM public.odds_engine_player_stat(v_p2, v_season, 'strikes') ps;
  IF abs(v_cold_mean - v_prior_mean) > 1e-9 THEN
    RAISE EXCEPTION 'PROBE_FAIL: cold start mean % <> league prior %', v_cold_mean, v_prior_mean;
  END IF;

  -- Recency direction: p1 and p2 get the SAME ten-game history (five 1-strike
  -- games, five 5-strike games) in OPPOSITE order — p1 hot lately, p2 cold
  -- lately. Identical lifetime averages (3.0), identical league shrinkage;
  -- only the exponential recency weighting can separate their means.
  FOR i IN 1..10 LOOP
    INSERT INTO public.lanetalk_game_imports
        (source_url, player_id, week_id, game_number, classification, score, played_at, payload)
      VALUES ('probe://odds-engine/hot/' || i, v_p1, v_week, 1, 'official', 100,
              now() - (20 - i) * interval '1 day',
              (SELECT jsonb_build_object('frames', jsonb_agg(
                 CASE WHEN f <= CASE WHEN i <= 5 THEN 1 ELSE 5 END
                      THEN jsonb_build_object('is_strike', true)
                      ELSE jsonb_build_object() END))
               FROM generate_series(1, 10) f)),
             ('probe://odds-engine/cold/' || i, v_p2, v_week, 1, 'official', 100,
              now() - (20 - i) * interval '1 day',
              (SELECT jsonb_build_object('frames', jsonb_agg(
                 CASE WHEN f <= CASE WHEN i <= 5 THEN 5 ELSE 1 END
                      THEN jsonb_build_object('is_strike', true)
                      ELSE jsonb_build_object() END))
               FROM generate_series(1, 10) f));
  END LOOP;
  SELECT ps.mean, ps.variance, ps.w_total INTO v_hot_mean, v_var, v_w
    FROM public.odds_engine_player_stat(v_p1, v_season, 'strikes') ps;
  SELECT ps.mean INTO v_cold_order_mean
    FROM public.odds_engine_player_stat(v_p2, v_season, 'strikes') ps;
  IF v_hot_mean <= v_cold_order_mean + 0.5 THEN
    RAISE EXCEPTION 'PROBE_FAIL: recency direction: hot-order mean % not above cold-order mean % + 0.5',
      v_hot_mean, v_cold_order_mean;
  END IF;
  IF v_w <= 0 OR v_var < 0.75 THEN
    RAISE EXCEPTION 'PROBE_FAIL: estimation invariants (w_total=%, var=%)', v_w, v_var;
  END IF;

  ------------------------------------------------------------------ O8 side backfill
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE key IN ('over', 'under') AND side IS DISTINCT FROM key;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: % over/under selections with mismatched side', v_n;
  END IF;

  ------------------------------------------------------------------ O9 side-aware grading
  -- Engineered push rung at the exact result value.
  INSERT INTO public.bet_selections (market_id, key, label, odds, line, sort_order, side)
    VALUES (v_mkt, 'over:145', 'Over', 1.95, 145, 98, 'over'),
           (v_mkt, 'under:145', 'Under', 1.95, 145, 99, 'under');
  PERFORM public.settle_market_internal(v_mkt, 145);
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_mkt AND side = 'over' AND (
      (line < 145 AND result <> 'won') OR
      (line > 145 AND result <> 'lost') OR
      (line = 145 AND result <> 'push'));
  SELECT count(*) INTO v_n2 FROM public.bet_selections
    WHERE market_id = v_mkt AND side = 'under' AND (
      (line > 145 AND result <> 'won') OR
      (line < 145 AND result <> 'lost') OR
      (line = 145 AND result <> 'push'));
  IF v_n <> 0 OR v_n2 <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: per-rung grading wrong (over misses %, under misses %)', v_n, v_n2;
  END IF;

  ------------------------------------------------------------------ O10 PvP alt-rung duel
  INSERT INTO public.bet_markets (market_type, title, week_id, subject_player_id, game_number, status, params)
    VALUES ('prop', 'PROBE odds pvp', v_week, v_p1, 1, 'open',
            jsonb_build_object('stat', 'strikes', 'source', 'lanetalk'))
    RETURNING id INTO v_mkt3;
  PERFORM public.odds_engine_mint_ladder(v_mkt3, 4.5, 4.0, 2.0, 1, 1.0, 0.5, 9.5, v_season);
  SELECT key, line INTO v_alt_key, v_alt_line FROM public.bet_selections
    WHERE market_id = v_mkt3 AND side = 'over' AND key LIKE 'over:%'
    ORDER BY line DESC LIMIT 1;
  IF v_alt_key IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: pvp fixture ladder has no alt over rung';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_challenge := public.create_pvp_challenge(
    'prop_duel', v_p1, v_week, NULL, 50, 50, v_mkt3, v_alt_key, NULL, NULL, NULL, 0, 0);
  SELECT counterparty_selection INTO v_cp_sel FROM public.pvp_challenges WHERE id = v_challenge;
  IF v_cp_sel IS DISTINCT FROM ('under:' || v_alt_line) THEN
    RAISE EXCEPTION 'PROBE_FAIL: prop_duel counterparty % (expected under:%)', v_cp_sel, v_alt_line;
  END IF;

  ------------------------------------------------------------------ G1 O/U generation
  -- The fixture RSVP statement already fired resync via trigger → cold-start
  -- O/U markets exist for the probe players; props must NOT (no imports at
  -- that moment... but O7 added imports afterwards, so check the pre-import
  -- shape on the OTHER stat-less path: game markets only).
  SELECT count(*) INTO v_n FROM public.bet_markets m
    WHERE m.week_id = v_week AND m.market_type = 'over_under'
      AND m.subject_player_id = v_p1;
  IF v_n < 2 THEN  -- at least one game market + the night market
    RAISE EXCEPTION 'PROBE_FAIL: G1 expected O/U markets for probe player, found %', v_n;
  END IF;
  SELECT m.id INTO v_gmkt FROM public.bet_markets m
    WHERE m.week_id = v_week AND m.market_type = 'over_under'
      AND m.subject_player_id = v_p1 AND m.game_number IS NOT NULL
    ORDER BY m.game_number LIMIT 1;
  SELECT count(*) FILTER (WHERE side = 'over'),
         count(*) FILTER (WHERE side IS NULL OR odds < 1.05 OR odds > 8.00),
         count(*) FILTER (WHERE key = 'over')
    INTO v_n, v_n2, v_n3
    FROM public.bet_selections WHERE market_id = v_gmkt;
  IF v_n < 2 OR v_n2 <> 0 OR v_n3 <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: G1 O/U ladder shape (overs=%, bad=%, seed=%)', v_n, v_n2, v_n3;
  END IF;

  ------------------------------------------------------------------ G2 prop generation
  PERFORM public.resync_week_markets(v_week);
  SELECT m.id INTO v_pmkt FROM public.bet_markets m
    WHERE m.week_id = v_week AND m.market_type = 'prop'
      AND m.params ->> 'source' = 'lanetalk' AND m.params ->> 'stat' = 'strikes'
      AND m.subject_player_id = v_p1 AND m.game_number IS NOT NULL
    ORDER BY m.game_number LIMIT 1;
  IF v_pmkt IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: G2 no strikes prop minted after imports + resync';
  END IF;
  SELECT s.odds, s.line INTO v_over, v_line FROM public.bet_selections s
    WHERE s.market_id = v_pmkt AND s.key = 'over';
  IF v_line <> 3.5 THEN
    RAISE EXCEPTION 'PROBE_FAIL: G2 seed strikes line % (expected 3.5 = floor(3.0)+0.5)', v_line;
  END IF;
  IF v_over <= 2.0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: G2 seed over odds % — recency mean under the seed line must price above evens', v_over;
  END IF;

  ------------------------------------------------------------------ G3 id stability
  SELECT array_agg(s.id ORDER BY s.sort_order) INTO v_ids_before
    FROM public.bet_selections s WHERE s.market_id = v_pmkt;
  PERFORM public.resync_week_markets(v_week);
  SELECT array_agg(s.id ORDER BY s.sort_order) INTO v_ids_after
    FROM public.bet_selections s WHERE s.market_id = v_pmkt;
  IF v_ids_before IS DISTINCT FROM v_ids_after THEN
    RAISE EXCEPTION 'PROBE_FAIL: G3 no-change resync churned selection ids';
  END IF;

  ------------------------------------------------------------------ G4 bet freezes ladder
  SELECT s.id INTO v_seed_over FROM public.bet_selections s
    WHERE s.market_id = v_pmkt AND s.key = 'over';
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  PERFORM public.place_house_bet(ARRAY[v_seed_over], 20);
  INSERT INTO public.lanetalk_game_imports
      (source_url, player_id, week_id, game_number, classification, score, played_at, payload)
    VALUES ('probe://odds-engine/hot/extra', v_p1, v_week, 1, 'official', 250, now(),
            (SELECT jsonb_build_object('frames', jsonb_agg(jsonb_build_object('is_strike', true)))
             FROM generate_series(1, 10) f));
  PERFORM public.resync_week_markets(v_week);
  SELECT array_agg(s.id ORDER BY s.sort_order) INTO v_ids_after
    FROM public.bet_selections s WHERE s.market_id = v_pmkt;
  IF v_ids_before IS DISTINCT FROM v_ids_after THEN
    RAISE EXCEPTION 'PROBE_FAIL: G4 bet-bearing ladder was re-minted by resync';
  END IF;

  ------------------------------------------------------------------ CB1 combo alt-rung compose
  v_ladder := public.combo_preview_ladder(ARRAY[v_p1, v_p2], 'strikes', v_season, 2, v_week, NULL);
  IF jsonb_array_length(v_ladder) < 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB1 combo preview ladder has % rungs (expected ≥2)', jsonb_array_length(v_ladder);
  END IF;
  SELECT value INTO v_choice
    FROM jsonb_array_elements(v_ladder)
    WHERE NOT (value ->> 'is_seed')::boolean
    LIMIT 1;
  IF v_choice IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB1 preview ladder carries no alt rung';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'strikes', 'scope', 'night',
             'line', (v_choice ->> 'line')::numeric)), 25);
  v_combo_mkt := (v_res -> 'combos' -> 0 ->> 'market_id')::uuid;
  v_combo_bet := (v_res ->> 'bet_id')::uuid;
  IF (v_res -> 'combos' -> 0 ->> 'line')::numeric IS DISTINCT FROM (v_choice ->> 'line')::numeric THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB1 composed line % (chose %)', v_res -> 'combos' -> 0 ->> 'line', v_choice ->> 'line';
  END IF;
  SELECT bl.line_at_placement AS line, bl.odds_at_placement AS odds INTO v_leg
    FROM public.bet_legs bl WHERE bl.bet_id = v_combo_bet;
  IF v_leg.line IS DISTINCT FROM (v_choice ->> 'line')::numeric
     OR v_leg.odds IS DISTINCT FROM (v_choice ->> 'odds')::numeric THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB1 leg snapshot (%, %) vs preview (%, %)',
      v_leg.line, v_leg.odds, v_choice ->> 'line', v_choice ->> 'odds';
  END IF;
  SELECT count(*) INTO v_n FROM public.bet_selections WHERE market_id = v_combo_mkt AND side = 'over';
  IF v_n < 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB1 combo market minted % over rungs (expected full ladder)', v_n;
  END IF;

  ------------------------------------------------------------------ CB2 pass-through + dedup rungs
  v_ladder := public.combo_preview_ladder(ARRAY[v_p2, v_p1], 'strikes', v_season, 2, v_week, NULL);
  SELECT count(*) INTO v_n FROM public.bet_selections WHERE market_id = v_combo_mkt AND side = 'over';
  IF jsonb_array_length(v_ladder) <> v_n THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB2 preview pass-through % rungs vs % posted', jsonb_array_length(v_ladder), v_n;
  END IF;

  BEGIN
    PERFORM public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
      'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
      'stat', 'strikes', 'scope', 'night', 'line', 999.5)), 25);
    RAISE EXCEPTION 'PROBE_FAIL: CB2 unposted rung composed instead of raising';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_FAIL%' THEN RAISE; END IF;
  END;

  v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
             'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
             'stat', 'strikes', 'scope', 'night')), 25);
  IF NOT (v_res -> 'combos' -> 0 ->> 'deduped')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB2 seed-rung recompose did not dedup';
  END IF;
  SELECT count(*) INTO v_seed_cnt FROM public.bet_selections
    WHERE market_id = v_combo_mkt AND key = 'over';
  IF v_seed_cnt <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB2 seed over key count %', v_seed_cnt;
  END IF;

  ------------------------------------------------------------------ P1 norm_ppf
  FOREACH v_cdf IN ARRAY ARRAY[0.025, 0.3, 0.5, 0.7, 0.975]::double precision[] LOOP
    IF abs(public.odds_engine_norm_cdf(public.odds_engine_norm_ppf(v_cdf)) - v_cdf) > 1e-4 THEN
      RAISE EXCEPTION 'PROBE_FAIL: P1 cdf(ppf(%)) = %', v_cdf,
        public.odds_engine_norm_cdf(public.odds_engine_norm_ppf(v_cdf));
    END IF;
  END LOOP;

  ------------------------------------------------------------------ P2 posted echo + band
  SELECT s.odds, s.line INTO v_over, v_line FROM public.bet_selections s
    WHERE s.market_id = v_gmkt AND s.key = 'over';
  v_res := public.market_price_line(v_gmkt, NULL);
  IF (v_res ->> 'odds')::numeric IS DISTINCT FROM v_over
     OR NOT (v_res ->> 'posted')::boolean
     OR (v_res ->> 'line')::numeric IS DISTINCT FROM v_line
     OR (v_res ->> 'seed_line')::numeric IS DISTINCT FROM v_line THEN
    RAISE EXCEPTION 'PROBE_FAIL: P2 seed echo % (posted seed % @ %)', v_res, v_over, v_line;
  END IF;
  IF (v_res ->> 'min_line')::numeric <> floor((v_res ->> 'min_line')::numeric) + 0.5
     OR (v_res ->> 'max_line')::numeric <> floor((v_res ->> 'max_line')::numeric) + 0.5
     OR (v_res ->> 'min_line')::numeric > (v_res ->> 'max_line')::numeric THEN
    RAISE EXCEPTION 'PROBE_FAIL: P2 band not half-point-ordered: %', v_res;
  END IF;

  ------------------------------------------------------------------ P3 fresh-line parity
  -- An unposted half-point inside the band (ladder spacing is 10 on this
  -- score market, so seed+5 is never a posted rung).
  v_line := v_line + 5;
  IF v_line <= (v_res ->> 'max_line')::numeric THEN
    v_res := public.market_price_line(v_gmkt, v_line);
    IF (v_res ->> 'posted')::boolean OR (v_res ->> 'odds') IS NULL THEN
      RAISE EXCEPTION 'PROBE_FAIL: P3 fresh in-band line % not priced: %', v_line, v_res;
    END IF;
    SELECT ps.mean, ps.variance INTO v_mean, v_var
      FROM public.odds_engine_player_stat(v_p1, v_season, 'score') ps;
    SELECT pp.over_odds INTO v_over
      FROM public.odds_engine_price_pair(v_mean, v_var, 1, v_line, 1.10, 8.00, false) pp;
    IF (v_res ->> 'odds')::numeric IS DISTINCT FROM v_over THEN
      RAISE EXCEPTION 'PROBE_FAIL: P3 quote % <> direct price_pair %', v_res ->> 'odds', v_over;
    END IF;
  END IF;

  ------------------------------------------------------------------ P4 rejections
  BEGIN
    PERFORM public.market_price_line(v_gmkt, 142);
    RAISE EXCEPTION 'PROBE_FAIL: P4 whole-number line quoted instead of raising';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_FAIL%' THEN RAISE; END IF;
  END;
  v_res := public.market_price_line(v_gmkt, 299.5);
  IF (v_res ->> 'odds') IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: P4 out-of-band 299.5 priced at %', v_res ->> 'odds';
  END IF;
  BEGIN
    PERFORM public.market_price_line(v_mkt, NULL);  -- settled in O9
    RAISE EXCEPTION 'PROBE_FAIL: P4 settled market quoted instead of raising';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_FAIL%' THEN RAISE; END IF;
  END;

  ------------------------------------------------------------------ P5 engine-off degradation
  INSERT INTO public.odds_engine_config (season_id, is_enabled)
    VALUES (v_season, false) RETURNING id INTO v_cfg_row;
  -- v_mkt2 was re-laddered by the G-vector resyncs (open + betless), so its
  -- CURRENT posted seed is the reference — engine-off must echo it verbatim
  -- with the band collapsed onto it.
  SELECT s.odds, s.line INTO v_over, v_line FROM public.bet_selections s
    WHERE s.market_id = v_mkt2 AND s.key = 'over';
  v_res := public.market_price_line(v_mkt2, NULL);
  IF (v_res ->> 'odds')::numeric IS DISTINCT FROM v_over
     OR (v_res ->> 'min_line')::numeric IS DISTINCT FROM v_line
     OR (v_res ->> 'max_line')::numeric IS DISTINCT FROM v_line THEN
    RAISE EXCEPTION 'PROBE_FAIL: P5 engine-off seed quote % (posted % @ %)', v_res, v_over, v_line;
  END IF;
  -- Score ladders span seed ± 30, so seed+35 is a never-posted half-point.
  v_res := public.market_price_line(v_mkt2, LEAST(v_line + 35, 299.5));
  IF (v_res ->> 'odds') IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: P5 engine-off priced an unposted line: %', v_res;
  END IF;
  DELETE FROM public.odds_engine_config WHERE id = v_cfg_row;

  ------------------------------------------------------------------ P6 combo_price_line
  -- Fresh path (no spares combo market exists): seed anchor + in-band price.
  v_line := public.combo_seed_line(ARRAY[v_p1, v_p2], 'spares', v_season, 2);
  v_res := public.combo_price_line(ARRAY[v_p1, v_p2], 'spares', v_season, 2, v_week, NULL, NULL);
  IF (v_res ->> 'seed_line')::numeric IS DISTINCT FROM v_line
     OR (v_res ->> 'odds') IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: P6 fresh combo quote % (seed %)', v_res, v_line;
  END IF;
  -- Posted echo on the CB1 strikes market's seed rung.
  SELECT s.odds, s.line INTO v_over, v_line FROM public.bet_selections s
    WHERE s.market_id = v_combo_mkt AND s.key = 'over';
  v_res := public.combo_price_line(ARRAY[v_p2, v_p1], 'strikes', v_season, 2, v_week, NULL, v_line);
  IF (v_res ->> 'odds')::numeric IS DISTINCT FROM v_over OR NOT (v_res ->> 'posted')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: P6 posted combo echo % (posted % @ %)', v_res, v_over, v_line;
  END IF;
  -- An UNPOSTED in-band line on the existing market prices fresh (the rung is
  -- minted at compose, 2 of 2). Count ladders span seed±3 at 1.0 spacing, so
  -- seed+4 stays a half-point but is never posted.
  v_res := public.combo_price_line(ARRAY[v_p1, v_p2], 'strikes', v_season, 2, v_week, NULL, v_line + 4);
  IF (v_res ->> 'posted')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: P6 off-ladder rung unexpectedly posted: %', v_res;
  END IF;
  IF (v_line + 4) <= (v_res ->> 'max_line')::numeric AND (v_res ->> 'odds') IS NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: P6 unposted in-band combo line not priced: %', v_res;
  END IF;

  ------------------------------------------------------------------ M1 mint-on-demand placement
  -- Quote an unposted line on the betless open O/U market, place at it as u2:
  -- the rung pair mints at the fresh (= quoted) price and the bet attaches.
  SELECT s.line INTO v_line FROM public.bet_selections s
    WHERE s.market_id = v_gmkt AND s.key = 'over';
  v_custom_line := v_line + 5;
  v_res := public.market_price_line(v_gmkt, v_custom_line);
  v_q := (v_res ->> 'odds')::numeric;
  IF v_q IS NULL OR (v_res ->> 'posted')::boolean THEN
    RAISE EXCEPTION 'PROBE_FAIL: M1 fixture line % not freshly quotable: %', v_custom_line, v_res;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u2, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_bet_m := public.place_bet_at_lines(jsonb_build_array(jsonb_build_object(
               'market_id', v_gmkt, 'line', v_custom_line, 'quoted_odds', v_q)), 20);

  SELECT count(*) FILTER (WHERE side = 'over'),
         count(*) FILTER (WHERE side = 'under')
    INTO v_n, v_n2
    FROM public.bet_selections WHERE market_id = v_gmkt AND line = v_custom_line;
  IF v_n <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M1 minted %/% over/under rows at the custom line', v_n, v_n2;
  END IF;
  SELECT s.odds INTO v_over FROM public.bet_selections s
    WHERE s.market_id = v_gmkt AND s.line = v_custom_line AND s.side = 'over';
  SELECT s.odds INTO v_under FROM public.bet_selections s
    WHERE s.market_id = v_gmkt AND s.line = v_custom_line AND s.side = 'under';
  IF v_over IS DISTINCT FROM v_q THEN
    RAISE EXCEPTION 'PROBE_FAIL: M1 minted over odds % <> quoted %', v_over, v_q;
  END IF;
  IF abs(1.0 / v_over + 1.0 / v_under - 1.0) > 0.06 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M1 minted pair (%, %) is not zero-vig', v_over, v_under;
  END IF;
  SELECT count(*) INTO v_n FROM public.bet_selections s
    WHERE s.market_id = v_gmkt AND s.line = v_custom_line
      AND s.key NOT IN ('over:' || trim_scale(v_custom_line), 'under:' || trim_scale(v_custom_line));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M1 custom rung keys are off-convention';
  END IF;
  SELECT bl.line_at_placement, bl.odds_at_placement INTO v_leg
    FROM public.bet_legs bl WHERE bl.bet_id = v_bet_m;
  IF v_leg.line_at_placement IS DISTINCT FROM v_custom_line
     OR v_leg.odds_at_placement IS DISTINCT FROM v_q THEN
    RAISE EXCEPTION 'PROBE_FAIL: M1 leg snapshot (%, %) vs (%, %)',
      v_leg.line_at_placement, v_leg.odds_at_placement, v_custom_line, v_q;
  END IF;

  ------------------------------------------------------------------ M2 rung reuse + self-over
  -- u1 takes the SAME line (their own market — over on self is legal): the
  -- posted custom rung is reused, not re-minted.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_u1, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'player'))::text, true);
  v_bet_m2 := public.place_bet_at_lines(jsonb_build_array(jsonb_build_object(
                'market_id', v_gmkt, 'line', v_custom_line, 'quoted_odds', v_q)), 15);
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_gmkt AND line = v_custom_line;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M2 re-placement changed rung count to %', v_n;
  END IF;
  SELECT count(DISTINCT bl.selection_id) INTO v_n
    FROM public.bet_legs bl WHERE bl.bet_id IN (v_bet_m, v_bet_m2);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M2 both bets should share ONE selection (got %)', v_n;
  END IF;

  ------------------------------------------------------------------ M3 tolerance reject
  BEGIN
    PERFORM public.place_bet_at_lines(jsonb_build_array(jsonb_build_object(
      'market_id', v_gmkt, 'line', v_custom_line + 1, 'quoted_odds', 999)), 20);
    RAISE EXCEPTION 'PROBE_FAIL: M3 drifted quote placed instead of raising';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'ODDS_MOVED|%' THEN
      RAISE EXCEPTION 'PROBE_FAIL: M3 wrong error contract: %', SQLERRM;
    END IF;
  END;
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_gmkt AND line = v_custom_line + 1;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M3 rejected quote still minted % rows', v_n;
  END IF;

  ------------------------------------------------------------------ M4 out-of-band + rollback
  BEGIN
    PERFORM public.place_bet_at_lines(jsonb_build_array(jsonb_build_object(
      'market_id', v_gmkt, 'line', 299.5, 'quoted_odds', 8)), 20);
    RAISE EXCEPTION 'PROBE_FAIL: M4 out-of-band line placed instead of raising';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PROBE_FAIL%' THEN RAISE; END IF;
  END;
  -- Failed placement (stake > balance) leaves NO betless custom rung behind.
  v_res := public.market_price_line(v_gmkt, v_custom_line + 2);
  IF (v_res ->> 'odds') IS NOT NULL THEN
    BEGIN
      PERFORM public.place_bet_at_lines(jsonb_build_array(jsonb_build_object(
        'market_id', v_gmkt, 'line', v_custom_line + 2,
        'quoted_odds', (v_res ->> 'odds')::numeric)), 999999);
      RAISE EXCEPTION 'PROBE_FAIL: M4 over-balance stake placed instead of raising';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'PROBE_FAIL%' THEN RAISE; END IF;
    END;
    SELECT count(*) INTO v_n FROM public.bet_selections
      WHERE market_id = v_gmkt AND line = v_custom_line + 2;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'PROBE_FAIL: M4 failed placement left % orphan rung rows', v_n;
    END IF;
  END IF;

  ------------------------------------------------------------------ M5 custom rung settles
  PERFORM public.settle_market_internal(v_gmkt, v_custom_line + 0.5);
  SELECT count(*) INTO v_n FROM public.bet_selections
    WHERE market_id = v_gmkt AND line = v_custom_line
      AND ((side = 'over' AND result <> 'won') OR (side = 'under' AND result <> 'lost'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M5 custom rung graded wrong';
  END IF;
  SELECT count(*) INTO v_n FROM public.bets
    WHERE id IN (v_bet_m, v_bet_m2) AND status = 'won';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: M5 custom-rung bets did not settle won (% of 2)', v_n;
  END IF;

  ------------------------------------------------------------------ CB3 quoted combo mint
  -- A quoted spec at an UNPOSTED line on the EXISTING (bet-frozen) combo
  -- market mints the rung instead of raising.
  SELECT s.line INTO v_line FROM public.bet_selections s
    WHERE s.market_id = v_combo_mkt AND s.key = 'over';
  v_res := public.combo_price_line(ARRAY[v_p1, v_p2], 'strikes', v_season, 2, v_week, NULL, v_line + 4);
  IF (v_res ->> 'odds') IS NOT NULL THEN
    v_q := (v_res ->> 'odds')::numeric;
    v_res := public.compose_combo_bet(v_week, jsonb_build_array(jsonb_build_object(
               'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
               'stat', 'strikes', 'scope', 'night',
               'line', v_line + 4, 'quoted_odds', v_q)), 25);
    IF NOT (v_res -> 'combos' -> 0 ->> 'deduped')::boolean
       OR (v_res -> 'combos' -> 0 ->> 'line')::numeric IS DISTINCT FROM (v_line + 4)
       OR (v_res -> 'combos' -> 0 ->> 'odds')::numeric IS DISTINCT FROM v_q THEN
      RAISE EXCEPTION 'PROBE_FAIL: CB3 quoted dedup mint result %', v_res;
    END IF;
    SELECT count(*) INTO v_n FROM public.bet_selections
      WHERE market_id = v_combo_mkt AND line = v_line + 4;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'PROBE_FAIL: CB3 minted % rows at the quoted combo line', v_n;
    END IF;
  END IF;

  ------------------------------------------------------------------ CB4 combo + extra pick, one bet
  -- Seed-rung dedup combo parlayed with a line-shaped extra pick on the PvP
  -- prop fixture market → ONE bet with two legs.
  SELECT s.line, s.odds INTO v_alt_line, v_q FROM public.bet_selections s
    WHERE s.market_id = v_mkt3 AND s.key = 'over';
  v_res := public.compose_combo_bet(
    v_week,
    jsonb_build_array(jsonb_build_object(
      'member_ids', jsonb_build_array(v_p1::text, v_p2::text),
      'stat', 'strikes', 'scope', 'night')),
    25, NULL, NULL, NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'market_id', v_mkt3, 'line', v_alt_line, 'quoted_odds', v_q)));
  SELECT count(*) INTO v_n FROM public.bet_legs bl
    WHERE bl.bet_id = (v_res ->> 'bet_id')::uuid;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'PROBE_FAIL: CB4 combo+extra ticket has % legs (expected 2)', v_n;
  END IF;

  ------------------------------------------------------------------ result
  RAISE EXCEPTION 'PROBE_RESULT %', jsonb_build_object(
    'ladder_pairs', v_ladder_pairs,
    'seed_rung', 'over@142.5',
    'cold_start_mean', round(v_cold_mean, 3),
    'league_prior_mean', round(v_prior_mean, 3),
    'hot_streak_mean', round(v_hot_mean, 3),
    'hot_streak_w_total', round(v_w, 2),
    'grading', 'per_rung_ok',
    'pvp_counterparty', v_cp_sel,
    'disabled_legacy_shape', true,
    'zero_vig', true,
    'gen_seed_strikes_odds', v_over,
    'gen_id_stability', true,
    'gen_bet_freezes_ladder', true,
    'combo_alt_rung', v_choice,
    'combo_dedup_rungs', true,
    'ppf_roundtrip', true,
    'price_line_posted_echo', true,
    'price_line_fresh_parity', true,
    'price_line_rejections', true,
    'price_line_engine_off', true,
    'combo_price_line', v_res);
END $$;
