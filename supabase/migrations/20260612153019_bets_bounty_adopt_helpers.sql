-- Batch D: bets + bounty RPCs adopt the shared helpers, and pin_ledger sheds
-- its granular bounty ref columns (TODO_DB_CONSOLIDATION §2 batch D + §4,
-- TODO_DB_FUNCTION_HYGIENE §1 adoption).
--
-- place_house_bet, finalize_bets_for_market, settle_betting_for_week,
-- create_sponsor_bounty, enter_bounty_as_hunter, settle_bounty rewritten onto
-- pin_ledger_double_entry() / current_player_id() / assert_admin() /
-- pin_balance(). Ledger amounts/types/descriptions are unchanged — proven by
-- the rollback-probe (supabase/verify/probe-bets-bounty.sql).
--
-- §4: bounty rows now carry ONLY bounty_post_id (the root ref the
-- cancel-refund path deletes by; bounty_payouts keeps payout granularity).
-- bounty_hunter_stake_id / bounty_settlement_id / bounty_payout_id are dropped
-- at the end. Policy: one root-entity ref column per economy feature.

CREATE OR REPLACE FUNCTION public.place_house_bet(p_selection_ids uuid[], p_stake integer, p_custom_line_id uuid DEFAULT NULL::uuid)
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

  -- Validate every selection, gather odds, resolve + assert a single season, and
  -- enforce anti-tanking. Each selection must belong to a distinct open market.
  v_n := 0;
  FOR v_sel IN
    SELECT s.id AS selection_id, s.key, s.odds, s.line,
           m.id AS market_id, m.status, m.subject_player_id, m.week_id
    FROM public.bet_selections s
    JOIN public.bet_markets    m ON m.id = s.market_id
    WHERE s.id = ANY (p_selection_ids)
  LOOP
    v_n := v_n + 1;
    IF v_sel.status <> 'open' THEN
      RAISE EXCEPTION 'A selected market is not open';
    END IF;

    DECLARE v_mseason uuid;
    BEGIN
      SELECT season_id INTO v_mseason FROM public.weeks WHERE id = v_sel.week_id;
      IF v_mseason IS NULL THEN
        RAISE EXCEPTION 'Selected market has no season';
      END IF;
      IF v_season_id IS NULL THEN
        v_season_id := v_mseason;
      ELSIF v_season_id <> v_mseason THEN
        RAISE EXCEPTION 'All selections must be in the same season';
      END IF;
    END;

    -- Capture week_id from the first selection (all O/U legs share the same week).
    IF v_week_id IS NULL THEN
      v_week_id := v_sel.week_id;
    END IF;

    -- Anti-tank (trigger is the backstop): no backing 'under' on your own market.
    IF v_sel.subject_player_id = v_player_id AND v_sel.key = 'under' THEN
      RAISE EXCEPTION 'A player cannot bet the under on their own line';
    END IF;

    v_odds := v_odds * v_sel.odds;
  END LOOP;

  IF v_n <> array_length(p_selection_ids, 1) THEN
    RAISE EXCEPTION 'One or more selections not found';
  END IF;

  v_payout := FLOOR(p_stake * v_odds);

  v_balance := public.pin_balance(v_player_id, v_season_id);
  IF p_stake > v_balance THEN
    RAISE EXCEPTION 'Wager exceeds your balance';
  END IF;

  INSERT INTO public.bets (player_id, season_id, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category)
    VALUES (v_player_id, v_season_id, p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category)
    RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_legs (bet_id, selection_id, side, odds_at_placement, line_at_placement)
    SELECT v_bet_id, s.id, 'back', s.odds, s.line
    FROM public.bet_selections s
    WHERE s.id = ANY (p_selection_ids);

  -- Double-entry stake: player -stake, house +stake (nets to zero).
  PERFORM public.pin_ledger_double_entry(
    v_player_id, v_season_id, v_week_id,
    -p_stake, 'bet_stake', 'Bet placed', NULL, v_bet_id);

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
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  ELSIF v_n > 1 THEN
    -- Parlay placed.
    PERFORM public.publish_activity_event(
      'sportsbook', 'sportsbook_parlay_placed',
      v_season_id, v_week_id, v_player_id, NULL, NULL,
      v_bet_id, NULL,
      'sportsbook.parlay_placed',
      jsonb_build_object('stake', p_stake, 'payout', v_payout, 'legs', v_n),
      jsonb_build_object('bet_id', v_bet_id),
      NULL, now());
  -- else: normal single — normal_bet_placement_enabled = false in v1, so nothing posts (§10.4).
  END IF;

  RETURN v_bet_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_bets_for_market(p_market_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bet     record;
  v_leg     record;
  v_odds    numeric;
  v_payout  integer;
  v_week_id uuid;
BEGIN
  SELECT week_id INTO v_week_id FROM public.bet_markets WHERE id = p_market_id;

  FOR v_bet IN
    SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake
    FROM public.bets b
    JOIN public.bet_legs       l ON l.bet_id = b.id
    JOIN public.bet_selections s ON s.id = l.selection_id
    WHERE s.market_id = p_market_id AND b.status = 'pending'
  LOOP
    -- Copy result onto every now-resolved leg of this bet (back/lay truth table).
    UPDATE public.bet_legs l
      SET result = CASE
        WHEN sel.result IN ('push', 'void') THEN sel.result
        WHEN l.side = 'back' THEN sel.result
        WHEN l.side = 'lay'  THEN CASE sel.result WHEN 'won' THEN 'lost' WHEN 'lost' THEN 'won' END
      END
      FROM public.bet_selections sel
      WHERE l.bet_id = v_bet.id AND l.selection_id = sel.id AND sel.result IS NOT NULL;

    -- A leg still unresolved (other market of a parlay) → leave bet pending.
    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result IS NULL) THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') THEN
      -- Lost: stake already debited / house already holds it. No ledger.
      UPDATE public.bets SET status = 'lost', settled_at = now() WHERE id = v_bet.id;

    ELSIF NOT EXISTS (
      SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result NOT IN ('push', 'void')
    ) THEN
      -- All legs push/void → refund the stake (double-entry).
      UPDATE public.bets SET status = 'push', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, v_week_id,
        v_bet.stake, 'bet_refund', 'Push refund', NULL, v_bet.id);

    ELSE
      -- Won: payout = floor(stake × product(won-leg odds)). Push/void legs drop out.
      v_odds := 1;
      FOR v_leg IN
        SELECT odds_at_placement FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'won'
      LOOP
        v_odds := v_odds * v_leg.odds_at_placement;
      END LOOP;
      v_payout := FLOOR(v_bet.stake * v_odds);

      UPDATE public.bets
        SET status = 'won', potential_payout = v_payout, settled_at = now()
        WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, v_week_id,
        v_payout, 'bet_payout', 'Bet won', NULL, v_bet.id);
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_betting_for_week(p_week_id uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_season_id   uuid;
  v_week_number integer;
  v_mkt         record;
  v_score       integer;
  v_house_net   integer;
  v_n_pending   integer;
  v_titles      text;
  v_bet         record;
BEGIN
  PERFORM public.assert_admin();

  SELECT season_id, week_number INTO v_season_id, v_week_number
    FROM public.weeks WHERE id = p_week_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Week not found';
  END IF;

  -- Score credits (player-only mints), once per week. Stamp week_id so the entry
  -- groups under the correct week in the per-player ledger.
  IF NOT EXISTS (
    SELECT 1 FROM public.pin_ledger
    WHERE season_id = v_season_id AND type = 'score_credit'
      AND description LIKE 'Week ' || v_week_number || ' %'
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

  -- Settle every open/closed (non-settled) over_under market in the week.
  FOR v_mkt IN
    SELECT id, subject_player_id, game_number
    FROM public.bet_markets
    WHERE week_id = p_week_id AND market_type = 'over_under' AND status <> 'settled'
  LOOP
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

    IF v_score IS NULL THEN
      -- No score -> close without a result (bets caught by the backstop below).
      UPDATE public.bet_markets SET status = 'closed' WHERE id = v_mkt.id;
    ELSE
      PERFORM public.settle_market_internal(v_mkt.id, v_score);
    END IF;
  END LOOP;

  -- Settle every non-settled moneyline market whose game has scores.
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

  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);

  -- PvP: auto-settle locked contracts for this week (settle_pvp_for_week expires
  -- stale offers internally before settling), same transaction as score_credit mint.
  PERFORM public.settle_pvp_for_week(p_week_id);

  -- --------------------------------------------------------------------------
  -- Backstop: settlement must leave NO pending sportsbook bet, whatever market
  -- type or roster disconnect produced it. Without force: abort (the whole
  -- archive transaction rolls back) and name the unsettleable markets. With
  -- force: void those bets and refund their stakes. The void is snapshot-
  -- reversible — bets/bet_legs pre-images are captured by archive_week, and the
  -- bet_refund rows are bet-linked (and week-stamped) so unarchive deletes them.
  --
  -- EXEMPTION: bets with ≥1 leg on an UNSETTLED prop market (LaneTalk stat
  -- bets) are deliberately left pending — their data lands after archive and
  -- settle_lanetalk_props_for_week settles them on the Confirm clock.
  -- --------------------------------------------------------------------------
  SELECT count(DISTINCT b.id) INTO v_n_pending
  FROM public.bets b
  JOIN public.bet_legs l       ON l.bet_id = b.id
  JOIN public.bet_selections s ON s.id = l.selection_id
  JOIN public.bet_markets m    ON m.id = s.market_id
  WHERE m.week_id = p_week_id AND b.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.bet_legs l2
      JOIN public.bet_selections s2 ON s2.id = l2.selection_id
      JOIN public.bet_markets m2    ON m2.id = s2.market_id
      WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
    );

  IF v_n_pending > 0 THEN
    IF NOT p_force THEN
      SELECT string_agg(DISTINCT m.title, ', ') INTO v_titles
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND b.status = 'pending' AND m.status <> 'settled'
        AND m.market_type <> 'prop'
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
        );

      RAISE EXCEPTION '% bet(s) would remain pending after settlement — unsettleable market(s): %. Re-run with force to void and refund them.',
        v_n_pending, COALESCE(v_titles, 'unknown');
    END IF;

    FOR v_bet IN
      SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake
      FROM public.bets b
      JOIN public.bet_legs l       ON l.bet_id = b.id
      JOIN public.bet_selections s ON s.id = l.selection_id
      JOIN public.bet_markets m    ON m.id = s.market_id
      WHERE m.week_id = p_week_id AND b.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM public.bet_legs l2
          JOIN public.bet_selections s2 ON s2.id = l2.selection_id
          JOIN public.bet_markets m2    ON m2.id = s2.market_id
          WHERE l2.bet_id = b.id AND m2.market_type = 'prop' AND m2.status <> 'settled'
        )
    LOOP
      UPDATE public.bet_legs SET result = 'void' WHERE bet_id = v_bet.id AND result IS NULL;
      UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, p_week_id,
        v_bet.stake, 'bet_refund', 'Voided at archive — market never settled', NULL, v_bet.id);
    END LOOP;
  END IF;

  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  -- house_net > 0 = House won the week; < 0 = players beat the House (§10.3 copy).
  -- Summed via bet_id through the week's markets: payout/refund rows are now also
  -- week-stamped, but bet_id remains the authoritative link for bet money.
  SELECT COALESCE(SUM(pl.amount), 0) INTO v_house_net
    FROM public.pin_ledger pl
    WHERE pl.is_house = true
      AND pl.type IN ('bet_stake','bet_payout','bet_refund')
      AND pl.bet_id IN (
        SELECT DISTINCT l.bet_id
        FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        JOIN public.bet_markets m    ON m.id = s.market_id
        WHERE m.week_id = p_week_id
      );

  -- Idempotency: no source FK exists, so guard on (season, week, event_type).
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_feed_events
     WHERE season_id = v_season_id AND week_id = p_week_id
       AND event_type = 'sportsbook_weekly_house_result'
  ) THEN
    PERFORM public.publish_activity_event(
      'system', 'sportsbook_weekly_house_result',
      v_season_id, p_week_id, NULL, NULL, NULL, NULL, NULL,
      'sportsbook.weekly_house_result',
      jsonb_build_object('house_net', v_house_net),
      '{}'::jsonb, NULL, now());
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sponsor_bounty(p_week_id uuid, p_title text, p_description text, p_reward_per_hunter integer, p_hunter_stake_amount integer, p_max_hunters integer, p_closes_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sponsor_id uuid;
  v_season_id  uuid;
  v_escrow     int;
  v_bounty_id  uuid;
BEGIN
  v_sponsor_id := public.current_player_id();
  v_season_id  := public.current_season_id();

  IF p_week_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.weeks
      WHERE id = p_week_id AND season_id = v_season_id AND is_archived = false
    ) THEN
      RAISE EXCEPTION 'Invalid or archived week';
    END IF;
  END IF;

  IF length(coalesce(p_title, '')) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;
  IF length(coalesce(p_description, '')) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;
  IF p_reward_per_hunter < 25 THEN
    RAISE EXCEPTION 'Reward per hunter must be at least 25 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_max_hunters < 1 OR p_max_hunters > 100 THEN
    RAISE EXCEPTION 'Max hunters must be between 1 and 100';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  v_escrow := p_reward_per_hunter * p_max_hunters;

  IF public.pin_balance(v_sponsor_id, v_season_id) < v_escrow THEN
    RAISE EXCEPTION 'Insufficient balance: sponsoring up to % hunters at % each requires % pins',
      p_max_hunters, p_reward_per_hunter, v_escrow;
  END IF;

  -- sponsor_bounty_amount holds the TOTAL escrow (R*m) so the escrow plumbing and
  -- cancel/refund-by-bounty_post_id logic are unchanged.
  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, reward_per_hunter, max_hunters,
    hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'sponsor_bounty', v_sponsor_id, p_title, p_description,
    v_escrow, p_reward_per_hunter, p_max_hunters,
    p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- Escrow the full max liability (player -R*m, house +R*m). Both rows carry
  -- bounty_post_id so cancel deletes them together.
  PERFORM public.pin_ledger_double_entry(
    v_sponsor_id, v_season_id, p_week_id,
    -v_escrow, 'bounty_sponsor_stake', 'Bounty sponsor stake escrowed',
    NULL, NULL, v_bounty_id);

  -- Activity Feed: a sponsor bounty is on the board. Actor = sponsor (leads the card).
  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    v_sponsor_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'reward_per_hunter', p_reward_per_hunter,
                       'hunter_stake_amount', p_hunter_stake_amount, 'max_hunters', p_max_hunters,
                       'bounty_type', 'sponsor_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enter_bounty_as_hunter(p_bounty_post_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_hunter_id    uuid;
  v_bounty       public.bounty_post;
  v_entry_number int;
  v_count        int;
  v_stake_id     uuid;
BEGIN
  v_hunter_id := public.current_player_id();

  -- Serialize concurrent entries so entry_number + capacity are deterministic.
  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'Bounty is not open for entries';
  END IF;
  IF now() >= v_bounty.closes_at THEN
    RAISE EXCEPTION 'Bounty has closed';
  END IF;

  IF v_bounty.bounty_type = 'sponsor_bounty' AND v_bounty.sponsor_player_id = v_hunter_id THEN
    RAISE EXCEPTION 'You cannot hunt your own bounty';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bounty_hunter_stakes
    WHERE bounty_post_id = p_bounty_post_id AND player_id = v_hunter_id
  ) THEN
    RAISE EXCEPTION 'You have already entered this bounty';
  END IF;

  -- Capacity: the sponsor has only escrowed reward for max_hunters hunters.
  SELECT count(*) INTO v_count
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  IF v_count >= v_bounty.max_hunters THEN
    RAISE EXCEPTION 'Bounty is full';
  END IF;

  IF public.pin_balance(v_hunter_id, v_bounty.season_id) < v_bounty.hunter_stake_amount THEN
    RAISE EXCEPTION 'Insufficient balance to enter this bounty';
  END IF;

  v_entry_number := v_count + 1;

  -- Every hunter is offered the same fixed reward (no dilution). protected_hunter_profit
  -- now snapshots the flat reward_per_hunter (kept on the row for settlement + display).
  INSERT INTO public.bounty_hunter_stakes (
    bounty_post_id, player_id, stake_amount, entry_number, protected_hunter_profit, status
  ) VALUES (
    p_bounty_post_id, v_hunter_id, v_bounty.hunter_stake_amount, v_entry_number,
    v_bounty.reward_per_hunter, 'active'
  )
  RETURNING id INTO v_stake_id;

  PERFORM public.pin_ledger_double_entry(
    v_hunter_id, v_bounty.season_id, v_bounty.week_id,
    -v_bounty.hunter_stake_amount, 'bounty_hunter_stake', 'Bounty hunter stake escrowed',
    NULL, NULL, p_bounty_post_id);

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_hunter_joined',
    v_bounty.season_id, v_bounty.week_id,
    v_hunter_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.hunter_joined',
    jsonb_build_object('bounty_title', v_bounty.title, 'entry_number', v_entry_number),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, now(),
    NULL, p_bounty_post_id);

  RETURN v_stake_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_bounty(p_bounty_post_id uuid, p_outcome text, p_admin_settlement_reasoning text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bounty          public.bounty_post;
  v_admin_id        uuid;
  v_hunter_count    int;
  v_R               int;   -- reward per hunter
  v_escrow          int;   -- sponsor escrow held = R * max_hunters
  v_total_stakes    int;   -- SUM(stake_amount) = n * H
  v_total_reward    int;   -- SUM(protected_hunter_profit) = n * R
  v_unused_escrow   int;   -- (max_hunters - n) * R returned to sponsor
  v_total_house_seed int;
  v_total_pot       int;
  v_settlement_id   uuid;
  v_payout_id       uuid;
  v_stake           record;
  v_payout          int;
BEGIN
  PERFORM public.assert_admin();
  v_admin_id := public.current_player_id();

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  IF v_bounty.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;
  -- Settle at any time: an 'open' or 'closed' bounty may be settled directly.
  IF v_bounty.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Bounty cannot be settled in its current state';
  END IF;

  IF p_outcome NOT IN ('sponsor_win', 'hunter_win') THEN
    RAISE EXCEPTION 'Invalid outcome';
  END IF;
  IF length(coalesce(p_admin_settlement_reasoning, '')) = 0 THEN
    RAISE EXCEPTION 'Settlement reasoning is required';
  END IF;

  SELECT count(*) INTO v_hunter_count
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  IF v_hunter_count < 1 THEN
    RAISE EXCEPTION 'Bounty has no hunters — cancel it instead of settling';
  END IF;

  v_R      := v_bounty.reward_per_hunter;
  v_escrow := v_bounty.sponsor_bounty_amount;  -- R * max_hunters
  SELECT COALESCE(SUM(stake_amount), 0), COALESCE(SUM(protected_hunter_profit), 0)
    INTO v_total_stakes, v_total_reward
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_unused_escrow := GREATEST(0, v_escrow - (v_hunter_count * v_R));

  -- House seed = the House subsidy when a House bounty loses to the hunters
  -- (it funds n*R out of pocket). Zero for sponsor bounties (sponsor-funded).
  v_total_house_seed := CASE
    WHEN v_bounty.bounty_type = 'house_bounty' AND p_outcome = 'hunter_win' THEN v_total_reward
    ELSE 0 END;

  -- total_pot = the headline winnings transferred to the winning side.
  v_total_pot := CASE
    WHEN p_outcome = 'hunter_win' THEN v_total_stakes + v_total_reward  -- n*(H+R)
    ELSE v_total_stakes END;                                            -- sponsor_win: n*H

  INSERT INTO public.bounty_settlements (
    bounty_post_id, settlement_outcome, settlement_source,
    total_sponsor_bounty, total_hunter_stakes, total_protected_hunter_profit,
    total_house_seed, total_pot, winner_count,
    settled_by_admin_id, admin_settlement_reasoning
  ) VALUES (
    p_bounty_post_id, p_outcome, 'admin',
    v_escrow, v_total_stakes, v_total_reward,
    v_total_house_seed, v_total_pot,
    CASE WHEN p_outcome = 'sponsor_win' THEN 1 ELSE v_hunter_count END,
    v_admin_id, p_admin_settlement_reasoning
  )
  RETURNING id INTO v_settlement_id;

  IF p_outcome = 'sponsor_win' THEN
    IF v_bounty.bounty_type = 'sponsor_bounty' THEN
      -- Sponsor collects every hunter stake and gets the full escrow back.
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_bounty.sponsor_player_id, false, v_total_stakes + v_escrow)
        RETURNING id INTO v_payout_id;

      PERFORM public.pin_ledger_double_entry(
        v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id,
        v_total_stakes + v_escrow, 'bounty_payout', 'Bounty sponsor won',
        NULL, NULL, p_bounty_post_id);
    ELSE
      -- House bounty: the House keeps the hunter stakes (reporting-only payout row,
      -- no ledger movement — House-to-House is not ledgered, §22.3).
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, NULL, true, v_total_stakes);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'lost', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;

  ELSE  -- hunter_win
    FOR v_stake IN
      SELECT * FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id
    LOOP
      v_payout := v_stake.stake_amount + v_stake.protected_hunter_profit;  -- H + R (flat)

      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_stake.player_id, false, v_payout)
        RETURNING id INTO v_payout_id;

      PERFORM public.pin_ledger_double_entry(
        v_stake.player_id, v_bounty.season_id, v_bounty.week_id,
        v_payout, 'bounty_payout', 'Bounty hunter won',
        NULL, NULL, p_bounty_post_id);
    END LOOP;

    -- Return the sponsor's unused escrow ((max_hunters - n) * R) for a sponsor bounty.
    IF v_bounty.bounty_type = 'sponsor_bounty' AND v_unused_escrow > 0 THEN
      PERFORM public.pin_ledger_double_entry(
        v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id,
        v_unused_escrow, 'bounty_payout', 'Bounty unused escrow returned',
        NULL, NULL, p_bounty_post_id);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'won', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;
  END IF;

  UPDATE public.bounty_post SET status = 'settled' WHERE id = p_bounty_post_id;

  IF p_outcome = 'sponsor_win' THEN
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_sponsor_won',
      v_bounty.season_id, v_bounty.week_id,
      CASE WHEN v_bounty.bounty_type = 'sponsor_bounty' THEN v_bounty.sponsor_player_id ELSE NULL END,
      NULL, NULL,
      NULL, NULL,
      'bounty_board.sponsor_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_house_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, now(),
      NULL, p_bounty_post_id);
  ELSE
    PERFORM public.publish_activity_event(
      'bounty_board', 'bounty_board_hunters_won',
      v_bounty.season_id, v_bounty.week_id,
      NULL, NULL, NULL,
      NULL, NULL,
      'bounty_board.hunters_won',
      jsonb_build_object('bounty_title', v_bounty.title, 'total_pot', v_total_pot,
                         'total_house_seed', v_total_house_seed, 'outcome', p_outcome),
      jsonb_build_object('bounty_post_id', p_bounty_post_id),
      NULL, now(),
      NULL, p_bounty_post_id);
  END IF;
END;
$function$;

-- §4: drop the granular bounty ref columns. bounty_post_id stays (the root ref
-- the cancel-refund path deletes by); bounty_payouts preserves payout-level
-- granularity. Their indexes drop with the columns. No RPC writes them after
-- the rewrites above; the app never read them.
ALTER TABLE public.pin_ledger
  DROP COLUMN bounty_hunter_stake_id,
  DROP COLUMN bounty_settlement_id,
  DROP COLUMN bounty_payout_id;
