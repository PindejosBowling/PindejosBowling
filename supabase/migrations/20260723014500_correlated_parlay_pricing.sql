-- ─────────────────────────────────────────────────────────────────────────────
-- Correlated-parlay joint pricing (same-game-parlay haircut/boost).
--
-- Parlays paid the PRODUCT of marginal leg odds even when legs were strongly
-- correlated — e.g. "over 219.5 total pins G1" × "over 4.5 clean frames G1"
-- on the SAME player, where the first leg practically implies the second.
-- With fair unclamped tails that was an unbounded +EV exploit. Now:
--   • legs cluster by shared subject + overlapping scope (same game, or
--     night↔game — night contains every game; combo members count);
--   • each 2-leg cluster is repriced off the joint bivariate normal built
--     from the engine's per-player models + a new league-wide stat-pair
--     correlation table (empirically seeded); anti-correlated pairs (e.g.
--     strikes↔spares) get a fair BOOST, symmetric with the haircut;
--   • ≥3-leg clusters are rejected ('CORRELATED_LEGS|<player>' — the UI
--     forces singles);
--   • the ratio is folded into the stored bet_legs odds (geometric split, √f
--     per leg), so settlement's product recompute + Winner's Crutch leg
--     drops + unsettle/resettle all work UNCHANGED;
--   • specials (admin-priced bundles) are exempt; engine off → legacy
--     product (probe-combo-lines' even-money math depends on this);
--   • parlay_price (client RPC) previews the same joint price for the slip.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Stat-pair correlations ──────────────────────────────────────────────────
-- League-wide per-game correlations between the engine's modeled stats,
-- seeded empirically from official LaneTalk imports (fallback constants when
-- the sample is thin). Admin-tunable like odds_engine_config. total_pins is
-- canonicalized to 'score' before lookup.
CREATE TABLE public.odds_engine_stat_corr (
  stat_a     text NOT NULL,
  stat_b     text NOT NULL,
  rho        numeric NOT NULL CHECK (rho > -1 AND rho < 1),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (stat_a, stat_b),
  CHECK (stat_a < stat_b)
);

ALTER TABLE public.odds_engine_stat_corr ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin can manage" ON public.odds_engine_stat_corr AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
CREATE POLICY "authenticated can read" ON public.odds_engine_stat_corr AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- Empirical seed: per-game Pearson correlations over official imports
-- (clean_frames = strikes + spares). Empirical value used only with a
-- meaningful sample (>= 60 official games); clamped to ±0.95.
WITH g AS (
  SELECT score::numeric  AS s,
         strikes::numeric AS st,
         spares::numeric  AS sp,
         (strikes + spares)::numeric AS cf
  FROM public.lanetalk_game_imports
  WHERE classification = 'official' AND frames > 0
    AND score IS NOT NULL AND strikes IS NOT NULL AND spares IS NOT NULL
), c AS (
  SELECT corr(cf, s)  AS cf_s,  corr(cf, sp) AS cf_sp, corr(cf, st) AS cf_st,
         corr(s,  sp) AS s_sp,  corr(s,  st) AS s_st,  corr(sp, st) AS sp_st,
         count(*) AS n
  FROM g
)
INSERT INTO public.odds_engine_stat_corr (stat_a, stat_b, rho)
SELECT v.a, v.b,
       GREATEST(-0.95, LEAST(0.95, COALESCE(
         CASE WHEN c.n >= 60 THEN
           (CASE v.a || '|' || v.b
              WHEN 'clean_frames|score'   THEN c.cf_s
              WHEN 'clean_frames|spares'  THEN c.cf_sp
              WHEN 'clean_frames|strikes' THEN c.cf_st
              WHEN 'score|spares'         THEN c.s_sp
              WHEN 'score|strikes'        THEN c.s_st
              WHEN 'spares|strikes'       THEN c.sp_st
            END)::numeric
         END,
         v.fallback)))
FROM c
CROSS JOIN (VALUES
  ('clean_frames', 'score',   0.65::numeric),
  ('clean_frames', 'spares',  0.50::numeric),
  ('clean_frames', 'strikes', 0.60::numeric),
  ('score',        'spares',  0.05::numeric),
  ('score',        'strikes', 0.60::numeric),
  ('spares',       'strikes', -0.35::numeric)
) AS v(a, b, fallback);

-- Symmetric lookup (1.0 on the diagonal, 0 for unknown pairs — unknown never
-- haircuts, matching the independence default).
CREATE OR REPLACE FUNCTION public.odds_engine_stat_rho(p_a text, p_b text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_a = p_b THEN 1.0::numeric
              ELSE COALESCE((SELECT c.rho FROM public.odds_engine_stat_corr c
                             WHERE c.stat_a = LEAST(p_a, p_b)
                               AND c.stat_b = GREATEST(p_a, p_b)), 0) END;
$function$;

REVOKE ALL ON FUNCTION public.odds_engine_stat_rho(text, text) FROM PUBLIC, anon, authenticated;

-- 2. Bivariate normal CDF ────────────────────────────────────────────────────
-- Φ2(h, k, ρ) = P(Z1 ≤ h, Z2 ≤ k) via the tetrachoric integral
--   Φ(h)Φ(k) + (1/2π) ∫₀^ρ exp(−(h²−2thk+k²)/(2(1−t²)))/√(1−t²) dt
-- integrated with composite Simpson (32 subintervals; smooth integrand for
-- |ρ| ≤ 0.95, error ≪ the 0.05 odds grid). Result clamped to the Fréchet
-- bounds [max(0, Φh+Φk−1), min(Φh, Φk)].
CREATE OR REPLACE FUNCTION public.odds_engine_bvn_cdf(p_h double precision, p_k double precision, p_rho double precision)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_r   double precision := LEAST(0.95, GREATEST(-0.95, p_rho));
  v_ph  double precision := public.odds_engine_norm_cdf(p_h);
  v_pk  double precision := public.odds_engine_norm_cdf(p_k);
  v_sum double precision := 0;
  v_t   double precision;
  v_f   double precision;
  v_w   double precision;
  n     integer := 32;
  i     integer;
BEGIN
  IF v_r <> 0 THEN
    FOR i IN 0 .. n LOOP
      v_t := v_r * i / n;
      v_f := exp(-(p_h * p_h - 2 * v_t * p_h * p_k + p_k * p_k) / (2 * (1 - v_t * v_t)))
             / sqrt(1 - v_t * v_t);
      v_w := CASE WHEN i = 0 OR i = n THEN 1 WHEN i % 2 = 1 THEN 4 ELSE 2 END;
      v_sum := v_sum + v_w * v_f;
    END LOOP;
    v_sum := v_sum * v_r / (3 * n) / (2 * pi());
  END IF;
  RETURN GREATEST(GREATEST(0, v_ph + v_pk - 1),
                  LEAST(LEAST(v_ph, v_pk), v_ph * v_pk + v_sum));
END;
$function$;

REVOKE ALL ON FUNCTION public.odds_engine_bvn_cdf(double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;

-- 3. Cluster + factor engine ─────────────────────────────────────────────────
-- Legs: [{subjects: [uuid…], stat, game_number|null, n_games, mu, sigma,
-- line, side}]. Two legs correlate when they share a subject AND scopes
-- overlap (same game, or either night — night contains every game). Each
-- connected component: size 1 → factor 1; size 2 → the pair is repriced off
-- the joint bivariate normal and the ratio joint/product is split
-- geometrically across the two legs (each × √f — keeps every scaled leg > 1
-- since joint odds ≥ each marginal); size ≥ 3 → 'CORRELATED_LEGS|<player>'
-- (exact ≥3-dim orthant probabilities need numeric integration — v1 rejects,
-- the UI forces singles). Negative correlation (e.g. strikes↔spares) yields
-- f > 1: a fair BOOST, symmetric with the haircut.
-- Leg covariance is closed-form under the engine's cross-player/cross-game
-- independence: Σ over shared (player, game) cells of ρ(stat_a, stat_b)·σa·σb.
CREATE OR REPLACE FUNCTION public.odds_engine_parlay_factors_internal(p_legs jsonb, p_season_id uuid)
 RETURNS numeric[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n       integer := COALESCE(jsonb_array_length(p_legs), 0);
  v_parent  integer[];
  v_roots   integer[] := '{}';
  v_factors numeric[];
  v_members integer[];
  v_la jsonb; v_lb jsonb;
  a integer; b integer; ra integer; rb integer; v_root integer;
  v_pl text;
  v_h_a double precision; v_h_b double precision;
  v_s_a integer; v_s_b integer;
  v_sg_a double precision; v_sg_b double precision;
  v_p_a double precision; v_p_b double precision;
  v_cov double precision; v_games integer;
  v_sig_pa double precision; v_sig_pb double precision;
  v_rho double precision;
  v_pp double precision;
  v_f numeric;
BEGIN
  IF v_n < 2 THEN RETURN NULL; END IF;
  v_parent  := ARRAY(SELECT generate_series(1, v_n));
  v_factors := array_fill(1.0::numeric, ARRAY[v_n]);

  FOR a IN 1 .. v_n LOOP
    FOR b IN a + 1 .. v_n LOOP
      v_la := p_legs -> (a - 1);
      v_lb := p_legs -> (b - 1);
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_la -> 'subjects') sa(x)
                 WHERE sa.x IN (SELECT sb.y FROM jsonb_array_elements_text(v_lb -> 'subjects') sb(y)))
         AND ((v_la ->> 'game_number') IS NULL OR (v_lb ->> 'game_number') IS NULL
              OR (v_la ->> 'game_number') = (v_lb ->> 'game_number')) THEN
        ra := a; WHILE v_parent[ra] <> ra LOOP ra := v_parent[ra]; END LOOP;
        rb := b; WHILE v_parent[rb] <> rb LOOP rb := v_parent[rb]; END LOOP;
        IF ra <> rb THEN v_parent[rb] := ra; END IF;
      END IF;
    END LOOP;
  END LOOP;

  FOR a IN 1 .. v_n LOOP
    ra := a; WHILE v_parent[ra] <> ra LOOP ra := v_parent[ra]; END LOOP;
    v_roots := v_roots || ra;
  END LOOP;

  FOR v_root IN SELECT DISTINCT t.r FROM unnest(v_roots) AS t(r) LOOP
    v_members := ARRAY(SELECT i FROM generate_subscripts(v_roots, 1) i WHERE v_roots[i] = v_root);
    IF array_length(v_members, 1) = 1 THEN CONTINUE; END IF;
    IF array_length(v_members, 1) > 2 THEN
      v_pl := p_legs -> (v_members[1] - 1) -> 'subjects' ->> 0;
      RAISE EXCEPTION 'CORRELATED_LEGS|%', COALESCE(v_pl, '');
    END IF;

    a := v_members[1];
    b := v_members[2];
    v_la := p_legs -> (a - 1);
    v_lb := p_legs -> (b - 1);
    v_sg_a := (v_la ->> 'sigma')::double precision;
    v_sg_b := (v_lb ->> 'sigma')::double precision;
    IF v_sg_a IS NULL OR v_sg_b IS NULL OR v_sg_a <= 0 OR v_sg_b <= 0 THEN CONTINUE; END IF;

    -- Event as a lower-orthant: over X≥ℓ ⇔ (−Z) ≤ −z (s = −1), under ⇔ Z ≤ z.
    v_s_a := CASE WHEN v_la ->> 'side' = 'under' THEN 1 ELSE -1 END;
    v_s_b := CASE WHEN v_lb ->> 'side' = 'under' THEN 1 ELSE -1 END;
    v_h_a := v_s_a * (((v_la ->> 'line')::double precision - (v_la ->> 'mu')::double precision) / v_sg_a);
    v_h_b := v_s_b * (((v_lb ->> 'line')::double precision - (v_lb ->> 'mu')::double precision) / v_sg_b);
    v_p_a := public.odds_engine_norm_cdf(v_h_a);
    v_p_b := public.odds_engine_norm_cdf(v_h_b);

    -- Shared cells: overlapping scope means 1 shared game unless both night.
    v_games := CASE WHEN (v_la ->> 'game_number') IS NULL AND (v_lb ->> 'game_number') IS NULL
                    THEN LEAST(GREATEST((v_la ->> 'n_games')::integer, 1),
                               GREATEST((v_lb ->> 'n_games')::integer, 1))
                    ELSE 1 END;
    v_cov := 0;
    FOR v_pl IN SELECT sa.x FROM jsonb_array_elements_text(v_la -> 'subjects') sa(x)
                WHERE sa.x IN (SELECT sb.y FROM jsonb_array_elements_text(v_lb -> 'subjects') sb(y))
    LOOP
      SELECT sqrt(GREATEST(ps.variance, 0)) INTO v_sig_pa
        FROM public.odds_engine_player_stat(v_pl::uuid, p_season_id, v_la ->> 'stat') ps;
      SELECT sqrt(GREATEST(ps.variance, 0)) INTO v_sig_pb
        FROM public.odds_engine_player_stat(v_pl::uuid, p_season_id, v_lb ->> 'stat') ps;
      v_cov := v_cov + v_games
               * public.odds_engine_stat_rho(v_la ->> 'stat', v_lb ->> 'stat')::double precision
               * COALESCE(v_sig_pa, 0) * COALESCE(v_sig_pb, 0);
    END LOOP;

    v_rho := GREATEST(-0.95, LEAST(0.95, v_cov / (v_sg_a * v_sg_b)));
    v_rho := v_rho * v_s_a * v_s_b;

    v_pp := GREATEST(public.odds_engine_bvn_cdf(v_h_a, v_h_b, v_rho), 1e-12);
    v_f  := (v_p_a * v_p_b / v_pp)::numeric;
    v_factors[a] := sqrt(v_f);
    v_factors[b] := v_factors[a];
  END LOOP;

  RETURN v_factors;
END;
$function$;

REVOKE ALL ON FUNCTION public.odds_engine_parlay_factors_internal(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- 4. Market-shaped wrapper (placement path) ──────────────────────────────────
-- Normalizes a ticket's (market, line, side) legs into descriptors for the
-- factor engine. Engine off → NULL (legacy product). Markets without a model
-- (moneyline, legacy team_prop/first_ball_avg, degenerate variance) become
-- inert subjectless legs — factor 1, never cluster.
CREATE OR REPLACE FUNCTION public.odds_engine_parlay_market_factors(p_market_ids uuid[], p_lines numeric[], p_sides text[])
 RETURNS numeric[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer := COALESCE(array_length(p_market_ids, 1), 0);
  v_season uuid;
  v_cfg public.odds_engine_config;
  v_legs jsonb := '[]'::jsonb;
  v_m record;
  v_d record;
  v_stat text;
  v_subjects jsonb;
  i integer;
BEGIN
  IF v_n < 2 THEN RETURN NULL; END IF;
  SELECT w.season_id INTO v_season
    FROM public.bet_markets m JOIN public.weeks w ON w.id = m.week_id
    WHERE m.id = p_market_ids[1];
  v_cfg := public.odds_engine_get_config(v_season);
  IF NOT v_cfg.is_enabled THEN RETURN NULL; END IF;

  FOR i IN 1 .. v_n LOOP
    SELECT m.market_type, m.subject_player_id, m.game_number, m.params INTO v_m
      FROM public.bet_markets m WHERE m.id = p_market_ids[i];
    v_stat := NULL; v_subjects := '[]'::jsonb;
    IF v_m.market_type = 'over_under' AND v_m.subject_player_id IS NOT NULL THEN
      v_stat := 'score';
      v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'prop' AND v_m.subject_player_id IS NOT NULL
          AND (v_m.params ->> 'stat') IN ('strikes', 'spares', 'clean_frames') THEN
      v_stat := v_m.params ->> 'stat';
      v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'combo'
          AND (v_m.params ->> 'stat') IN ('total_pins', 'strikes', 'spares', 'clean_frames') THEN
      v_stat := CASE WHEN v_m.params ->> 'stat' = 'total_pins' THEN 'score' ELSE v_m.params ->> 'stat' END;
      v_subjects := COALESCE(v_m.params -> 'member_ids', '[]'::jsonb);
    END IF;

    IF v_stat IS NOT NULL AND p_lines[i] IS NOT NULL THEN
      SELECT d.mean, d.variance, d.n_games INTO v_d
        FROM public.odds_engine_market_distribution(p_market_ids[i]) d;
      IF v_d.mean IS NOT NULL AND v_d.variance IS NOT NULL AND v_d.variance > 0 THEN
        v_legs := v_legs || jsonb_build_array(jsonb_build_object(
          'subjects', v_subjects, 'stat', v_stat,
          'game_number', v_m.game_number, 'n_games', v_d.n_games,
          'mu', v_d.mean * GREATEST(v_d.n_games, 1),
          'sigma', sqrt(v_d.variance * GREATEST(v_d.n_games, 1)),
          'line', p_lines[i], 'side', COALESCE(p_sides[i], 'over')));
        CONTINUE;
      END IF;
    END IF;
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'subjects', '[]'::jsonb, 'stat', 'none', 'game_number', v_m.game_number,
      'n_games', 1, 'mu', 0, 'sigma', 0, 'line', 0, 'side', 'over'));
  END LOOP;

  RETURN public.odds_engine_parlay_factors_internal(v_legs, v_season);
END;
$function$;

REVOKE ALL ON FUNCTION public.odds_engine_parlay_market_factors(uuid[], numeric[], text[]) FROM PUBLIC, anon, authenticated;

-- 5. parlay_price — the slip's preview RPC ───────────────────────────────────
-- Prices a prospective parlay: picks {market_id, line, quoted_odds} + combo
-- specs {member_ids, stat, scope, game_number, line, quoted_odds} (a combo
-- may have no market yet — its distribution sums member stats, mirroring
-- combo_price_line). Returns {odds, correlated, factors} — the product of
-- quoted legs × correlation factors — or {blocked_player_id} when a ≥3-leg
-- correlated cluster would be rejected at placement. Display-only; placement
-- recomputes authoritatively in place_house_bet.
CREATE OR REPLACE FUNCTION public.parlay_price(p_week_id uuid DEFAULT NULL, p_picks jsonb DEFAULT NULL, p_combos jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_week uuid := p_week_id;
  v_season uuid;
  v_cfg public.odds_engine_config;
  v_legs jsonb := '[]'::jsonb;
  v_quoted numeric[] := '{}';
  v_pick jsonb;
  v_combo jsonb;
  v_mid uuid;
  v_m record;
  v_d record;
  v_stat text;
  v_subjects jsonb;
  v_members uuid[];
  v_cn integer;
  v_week_games integer;
  v_mu numeric;
  v_var numeric;
  v_factors numeric[];
  v_odds numeric := 1;
  v_corr boolean := false;
  v_n integer;
  i integer;
BEGIN
  IF v_week IS NULL AND p_picks IS NOT NULL AND jsonb_array_length(p_picks) > 0 THEN
    SELECT m.week_id INTO v_week FROM public.bet_markets m
      WHERE m.id = ((p_picks -> 0) ->> 'market_id')::uuid;
  END IF;
  IF v_week IS NULL THEN
    RAISE EXCEPTION 'A week (or at least one pick) is required';
  END IF;
  SELECT w.season_id INTO v_season FROM public.weeks w WHERE w.id = v_week;
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'Week has no season';
  END IF;
  v_cfg := public.odds_engine_get_config(v_season);

  SELECT COUNT(DISTINCT g.game_number) INTO v_week_games
    FROM public.games g JOIN public.teams t ON t.id = g.team_a_id
    WHERE t.week_id = v_week;
  IF v_week_games IS NULL OR v_week_games = 0 THEN v_week_games := 2; END IF;

  FOR v_pick IN SELECT value FROM jsonb_array_elements(COALESCE(p_picks, '[]'::jsonb)) LOOP
    v_mid := (v_pick ->> 'market_id')::uuid;
    IF v_mid IS NULL OR (v_pick ->> 'quoted_odds') IS NULL THEN
      RAISE EXCEPTION 'Every pick needs a market_id and quoted_odds';
    END IF;
    SELECT m.market_type, m.subject_player_id, m.game_number, m.params INTO v_m
      FROM public.bet_markets m WHERE m.id = v_mid;
    v_stat := NULL; v_subjects := '[]'::jsonb;
    IF v_m.market_type = 'over_under' AND v_m.subject_player_id IS NOT NULL THEN
      v_stat := 'score'; v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'prop' AND v_m.subject_player_id IS NOT NULL
          AND (v_m.params ->> 'stat') IN ('strikes', 'spares', 'clean_frames') THEN
      v_stat := v_m.params ->> 'stat'; v_subjects := jsonb_build_array(v_m.subject_player_id::text);
    ELSIF v_m.market_type = 'combo'
          AND (v_m.params ->> 'stat') IN ('total_pins', 'strikes', 'spares', 'clean_frames') THEN
      v_stat := CASE WHEN v_m.params ->> 'stat' = 'total_pins' THEN 'score' ELSE v_m.params ->> 'stat' END;
      v_subjects := COALESCE(v_m.params -> 'member_ids', '[]'::jsonb);
    END IF;
    IF v_stat IS NOT NULL AND (v_pick ->> 'line') IS NOT NULL THEN
      SELECT d.mean, d.variance, d.n_games INTO v_d
        FROM public.odds_engine_market_distribution(v_mid) d;
      IF v_d.mean IS NOT NULL AND v_d.variance IS NOT NULL AND v_d.variance > 0 THEN
        v_legs := v_legs || jsonb_build_array(jsonb_build_object(
          'subjects', v_subjects, 'stat', v_stat,
          'game_number', v_m.game_number, 'n_games', v_d.n_games,
          'mu', v_d.mean * GREATEST(v_d.n_games, 1),
          'sigma', sqrt(v_d.variance * GREATEST(v_d.n_games, 1)),
          'line', (v_pick ->> 'line')::numeric, 'side', 'over'));
      ELSE
        v_stat := NULL;
      END IF;
    END IF;
    IF v_stat IS NULL THEN
      v_legs := v_legs || jsonb_build_array(jsonb_build_object(
        'subjects', '[]'::jsonb, 'stat', 'none', 'game_number', v_m.game_number,
        'n_games', 1, 'mu', 0, 'sigma', 0, 'line', 0, 'side', 'over'));
    END IF;
    v_quoted := v_quoted || (v_pick ->> 'quoted_odds')::numeric;
  END LOOP;

  FOR v_combo IN SELECT value FROM jsonb_array_elements(COALESCE(p_combos, '[]'::jsonb)) LOOP
    IF (v_combo ->> 'quoted_odds') IS NULL OR (v_combo ->> 'line') IS NULL THEN
      RAISE EXCEPTION 'Every combo needs a line and quoted_odds';
    END IF;
    SELECT array_agg(DISTINCT m::uuid) INTO v_members
      FROM jsonb_array_elements_text(v_combo -> 'member_ids') m;
    IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN
      RAISE EXCEPTION 'A combo needs at least two distinct players';
    END IF;
    v_stat := CASE WHEN v_combo ->> 'stat' = 'total_pins' THEN 'score' ELSE v_combo ->> 'stat' END;
    IF v_stat NOT IN ('score', 'strikes', 'spares', 'clean_frames') THEN
      RAISE EXCEPTION 'Unknown combo stat %', COALESCE(v_combo ->> 'stat', '(null)');
    END IF;
    v_cn := CASE WHEN v_combo ->> 'scope' = 'game' THEN 1 ELSE v_week_games END;
    SELECT COALESCE(SUM(ps.mean), 0), COALESCE(SUM(ps.variance), 0) INTO v_mu, v_var
      FROM unnest(v_members) mem(m)
      CROSS JOIN LATERAL public.odds_engine_player_stat(mem.m, v_season, v_stat) ps;
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'subjects', (SELECT jsonb_agg(m::text ORDER BY m) FROM unnest(v_members) m),
      'stat', v_stat,
      'game_number', CASE WHEN v_combo ->> 'scope' = 'game'
                          THEN (v_combo ->> 'game_number')::integer END,
      'n_games', v_cn,
      'mu', COALESCE(v_mu, 0) * v_cn,
      'sigma', CASE WHEN v_var > 0 THEN sqrt(v_var * v_cn) ELSE 0 END,
      'line', (v_combo ->> 'line')::numeric, 'side', 'over'));
    v_quoted := v_quoted || (v_combo ->> 'quoted_odds')::numeric;
  END LOOP;

  v_n := jsonb_array_length(v_legs);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Nothing to price';
  END IF;

  IF v_cfg.is_enabled AND v_n >= 2 THEN
    v_factors := public.odds_engine_parlay_factors_internal(v_legs, v_season);
  END IF;

  FOR i IN 1 .. v_n LOOP
    v_odds := v_odds * v_quoted[i] * COALESCE(v_factors[i], 1);
    IF v_factors[i] IS NOT NULL AND v_factors[i] <> 1 THEN v_corr := true; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'odds', round(v_odds, 2),
    'correlated', v_corr,
    'factors', COALESCE(to_jsonb(v_factors), 'null'::jsonb));
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'CORRELATED_LEGS|%' THEN
    RETURN jsonb_build_object('blocked_player_id', NULLIF(split_part(SQLERRM, '|', 2), ''));
  END IF;
  RAISE;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.parlay_price(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.parlay_price(uuid, jsonb, jsonb) TO authenticated;

-- 6. place_house_bet — fold factors into stored leg odds ────────────────────
CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer, p_custom_line_id uuid DEFAULT NULL::uuid, p_insurance_item_id uuid DEFAULT NULL::uuid, p_crutch_item_id uuid DEFAULT NULL::uuid, p_boost_item_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_season_id uuid;
  v_week_id   uuid;
  v_balance   integer;
  v_odds      numeric := 1;
  v_payout    integer;
  v_bet_id    uuid;
  v_sel       record;
  v_n         integer;
  v_line      public.custom_lines%ROWTYPE;
  v_boost_pct numeric := NULL;
  v_total_payout integer;
  v_leg_ids   uuid[]    := '{}';
  v_leg_mkts  uuid[]    := '{}';
  v_leg_odds  numeric[] := '{}';
  v_leg_lines numeric[] := '{}';
  v_leg_sides text[]    := '{}';
  v_factors   numeric[];
  i           integer;
BEGIN
  v_player_id := public.current_player_id();

  IF p_selection_ids IS NULL OR array_length(p_selection_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No selections provided';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'Minimum wager is 10 pins';
  END IF;

  -- Custom line ("Special") tag: snapshot its display identity onto the bet.
  -- The selections themselves are client-resolved (same trust as the parlay
  -- slip); the line must simply exist and be live.
  IF p_custom_line_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.custom_lines WHERE id = p_custom_line_id;
    IF v_line.id IS NULL OR NOT v_line.is_active THEN
      RAISE EXCEPTION 'This special is no longer available';
    END IF;
  END IF;

  -- Validate every selection, gather odds, resolve + assert a single season AND
  -- a single week, and enforce anti-tanking. Each selection must belong to a
  -- distinct open market.
  v_n := 0;
  FOR v_sel IN
    SELECT s.id AS selection_id, s.key, s.side, s.odds, s.line,
           m.id AS market_id, m.status, m.subject_player_id, m.week_id
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = ANY (p_selection_ids)
  LOOP
    v_n := v_n + 1;
    IF v_sel.status <> 'open' THEN
      RAISE EXCEPTION 'A selected market is not open';
    END IF;

    DECLARE
      v_mseason   uuid;
      v_marchived boolean;
    BEGIN
      SELECT season_id, is_archived INTO v_mseason, v_marchived
        FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      -- A locked week (advanced or fully archived) takes no new stakes even if a
      -- prop market is still 'open' pending its next-day settlement clock.
      IF v_marchived THEN
        RAISE EXCEPTION 'This week is locked — no new bets can be placed';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Single-week invariant: bets.week_id is single-valued, so every leg must
    -- share the first leg's week.
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    ELSIF v_week_id <> v_sel.week_id THEN
      RAISE EXCEPTION 'All selections must be in the same week';
    END IF;

    -- Anti-tank (trigger is the backstop): no backing 'under' on your own market.
    IF v_sel.subject_player_id = v_player_id AND v_sel.side = 'under' THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own line';
    END IF;

    v_leg_ids   := v_leg_ids   || v_sel.selection_id;
    v_leg_mkts  := v_leg_mkts  || v_sel.market_id;
    v_leg_odds  := v_leg_odds  || v_sel.odds;
    v_leg_lines := v_leg_lines || v_sel.line;
    v_leg_sides := v_leg_sides || v_sel.side;

    v_odds := v_odds * v_sel.odds;
  END LOOP;

  IF v_n <> array_length(p_selection_ids, 1) THEN
    RAISE EXCEPTION 'One or more selections not found';
  END IF;

  -- Correlated-parlay repricing (SGP): legs on the same player in
  -- overlapping scopes (same game, or night↔game) cannot pay the product of
  -- marginals — each correlated pair is repriced off the joint bivariate
  -- model and the ratio folded into the STORED leg odds, so settlement's
  -- product recompute (incl. Winner's Crutch leg drops) needs no change.
  -- Specials are admin-priced bundles — exempt. Engine off → NULL → legacy
  -- product. A ≥3-leg correlated cluster raises CORRELATED_LEGS|<player>.
  IF v_n >= 2 AND p_custom_line_id IS NULL THEN
    v_factors := public.odds_engine_parlay_market_factors(v_leg_mkts, v_leg_lines, v_leg_sides);
    IF v_factors IS NOT NULL THEN
      v_odds := 1;
      FOR i IN 1 .. v_n LOOP
        v_leg_odds[i] := round(v_leg_odds[i] * v_factors[i], 4);
        v_odds := v_odds * v_leg_odds[i];
      END LOOP;
    END IF;
  END IF;

  v_payout := FLOOR(p_stake * v_odds);

  v_balance := public.pin_balance(v_player_id, v_season_id);
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  -- Safety Ticket: validate the catalog contract, then consume the atomic item
  -- in one guarded UPDATE (owner + unconsumed + current season — rowcount 0
  -- means one of those failed). Spent at placement, win or lose; deliberately
  -- NO is_active check (retirement stops grants, never confiscates).
  IF p_insurance_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_insurance_item_id
         AND c.effect_type = 'bet_insurance'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not attachable bet insurance';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_insurance_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Safety Ticket is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Winner's Crutch: same consume posture as the Safety Ticket, but its own
  -- effect_type and a parlay floor — a crutch on a single can never help (cancel
  -- the only leg = nothing survives). Spent at placement, win or lose.
  IF p_crutch_item_id IS NOT NULL THEN
    IF v_n < 2 THEN
      RAISE EXCEPTION 'A Winner''s Crutch can only be attached to a parlay (2 or more legs)';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_crutch_item_id
         AND c.effect_type = 'parlay_crutch'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Winner''s Crutch';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_crutch_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Winner''s Crutch is not usable (already spent, wrong season, or not yours)';
    END IF;
  END IF;

  -- Energy Drink: same consume posture; its own effect_type, no leg floor (a
  -- boost helps any winning bet, single or parlay). Spent at placement, win or
  -- lose; the bonus is paid at settlement on a win. Its boost_pct is snapshotted
  -- onto the bet below so display + settlement share one locked-at-placement value.
  IF p_boost_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.player_inventory_items i
        JOIN public.item_catalog c ON c.id = i.catalog_item_id
       WHERE i.id = p_boost_item_id
         AND c.effect_type = 'odds_boost'
         AND c.activation_mode = 'attach_to_bet'
    ) THEN
      RAISE EXCEPTION 'That item is not an attachable Energy Drink';
    END IF;

    UPDATE public.player_inventory_items
       SET consumed_at = now()
     WHERE id = p_boost_item_id
       AND player_id = v_player_id
       AND season_id = v_season_id
       AND consumed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Energy Drink is not usable (already spent, wrong season, or not yours)';
    END IF;

    -- Lock the flavor's boost magnitude onto the bet (defaults to 1.0 if a row
    -- somehow omits it).
    SELECT COALESCE((c.effect_params ->> 'boost_pct')::numeric, 1.0) INTO v_boost_pct
      FROM public.player_inventory_items i
      JOIN public.item_catalog c ON c.id = i.catalog_item_id
     WHERE i.id = p_boost_item_id;
  END IF;

  INSERT INTO public.bets (player_id, season_id, week_id, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category,
                           insurance_item_id, crutch_item_id, boost_item_id, boost_pct)
    VALUES (v_player_id, v_season_id, v_week_id, p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category,
            p_insurance_item_id, p_crutch_item_id, p_boost_item_id, v_boost_pct)
    RETURNING id INTO v_bet_id;

  -- Legs snapshot the (possibly correlation-repriced) odds gathered above —
  -- NOT re-read from bet_selections, so the stored product always equals the
  -- payout basis.
  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, u.sel_id, 'back', u.o, u.l
    FROM unnest(v_leg_ids, v_leg_odds, v_leg_lines) AS u(sel_id, o, l);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  PERFORM public.pin_ledger_double_entry(
    v_player_id, v_season_id, v_week_id,
    -p_stake, 'bet_stake', 'Bet placed', NULL, v_bet_id);

  -- Max possible payout INCLUSIVE of an attached boost — mirrors the settlement
  -- bonus formula (floor(payout × boost_pct) on top of the total payout).
  v_total_payout := v_payout
    + CASE WHEN v_boost_pct IS NOT NULL THEN FLOOR(v_payout * v_boost_pct)::integer ELSE 0 END;

  -- Activity Feed: post at most ONE placement event by priority (§3, §10.3).
  -- v_balance here is the pre-bet balance; v_n is the leg count; v_payout is the
  -- total potential payout (the "to win" figure surfaced on the feed card).
  IF p_stake >= GREATEST(250, FLOOR(0.10 * v_balance)) THEN
    -- Big ticket.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_big_ticket_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.big_ticket_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n,
                         'total_payout', v_total_payout),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$
;
