-- Snapshot the Energy Drink's boost_pct onto the bet at placement.
--
-- boost_pct is intentionally catalog-configurable (effect_params.boost_pct) so
-- different Energy Drink "flavors" can boost by different amounts. To surface the
-- boosted payout in the client — including on the shared Sportsbook board where
-- you view OTHER players' bets and their owner-RLS'd inventory item is invisible —
-- we snapshot the pct onto the bet itself at placement, exactly like
-- odds_at_placement / custom_line_title. Settlement then reads the same snapshot,
-- so the displayed payout and the paid bonus can never diverge across flavors or
-- if a catalog row is later retuned.

ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS boost_pct numeric;

COMMENT ON COLUMN public.bets.boost_pct IS
  'Energy Drink boost multiplier snapshotted from item_catalog.effect_params at placement (NULL when no boost attached). Bonus on a win = floor(potential_payout * boost_pct).';

-- Backfill existing boosted bets from their attached item''s catalog value so
-- already-pending bets settle and display against a concrete pct.
UPDATE public.bets b
   SET boost_pct = COALESCE((
     SELECT (c.effect_params ->> 'boost_pct')::numeric
       FROM public.player_inventory_items i
       JOIN public.item_catalog c ON c.id = i.catalog_item_id
      WHERE i.id = b.boost_item_id), 1.0)
 WHERE b.boost_item_id IS NOT NULL
   AND b.boost_pct IS NULL;

-- ---------------------------------------------------------------------------
-- place_house_bet: capture the boost pct at placement (unchanged otherwise).
-- Carried over verbatim from the current definition; the only edits are the
-- v_boost_pct declaration, the SELECT that captures it, and the two new bets
-- INSERT column/value slots.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- finalize_bets_for_market: read the snapshotted boost_pct off the bet instead
-- of re-joining the catalog, so the paid bonus matches exactly what was shown at
-- placement. Carried over verbatim from 20260714225154; only the SELECT DISTINCT
-- adds b.boost_pct and the boost branch reads v_bet.boost_pct.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_bets_for_market(p_market_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_bet       record;
  v_leg       record;
  v_odds      numeric;
  v_payout    integer;
  v_week_id   uuid;
  v_share     numeric;
  v_refund    integer;
  v_crutched  boolean;
  v_won_legs  integer;
  v_boost_pct numeric;
  v_bonus     integer;
  v_haunt_n   integer;
  v_profit    integer;
  v_haunt     record;
  v_idx       integer;
  v_cut       integer;
  v_haunters  jsonb;
BEGIN
  SELECT week_id INTO v_week_id FROM public.bet_markets WHERE id = p_market_id;

  FOR v_bet IN
    SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake, b.insurance_item_id, b.crutch_item_id, b.boost_item_id, b.boost_pct
    FROM public.bets b
    JOIN public.bet_legs       l ON l.bet_id = b.id
    JOIN public.bet_selections s ON s.id = l.selection_id
    WHERE s.market_id = p_market_id AND b.status = 'pending'
  LOOP
    v_crutched := false;

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

    -- Winner's Crutch: a parlay that misses by exactly one leg is salvaged —
    -- cancel the lone losing leg (→ 'crutched', a drop-out) so the bet pays on
    -- the survivors. Only fires when precisely one leg lost (2+ losses = a real
    -- loss the crutch can't fix).
    IF v_bet.crutch_item_id IS NOT NULL
       AND (SELECT count(*) FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') = 1 THEN
      UPDATE public.bet_legs
         SET result = 'crutched'
       WHERE id = (SELECT id FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost' LIMIT 1);
      v_crutched := true;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'lost') THEN
      -- Lost: stake already debited / house already holds it. No ledger…
      UPDATE public.bets SET status = 'lost', settled_at = now() WHERE id = v_bet.id;

      -- …unless insured. Safety Ticket: House-funded stake refund of
      -- floor(stake × refund_share), read from the item's catalog params.
      -- Bet-linked AND week-stamped → captured/reversed by the archive engine
      -- exactly like every other bet movement. NOT-EXISTS guard makes
      -- re-settlement (force re-archive) idempotent. Lost branch ONLY: pushes
      -- refund normally below and the ticket stays spent; force-void pays only
      -- bet_refund (this function never runs for voids).
      IF v_bet.insurance_item_id IS NOT NULL THEN
        SELECT COALESCE((c.effect_params ->> 'refund_share')::numeric, 1.0) INTO v_share
          FROM public.player_inventory_items i
          JOIN public.item_catalog c ON c.id = i.catalog_item_id
         WHERE i.id = v_bet.insurance_item_id;

        v_refund := FLOOR(v_bet.stake * COALESCE(v_share, 1.0));

        IF v_refund > 0 AND NOT EXISTS (
          SELECT 1 FROM public.pin_ledger
           WHERE bet_id = v_bet.id AND type = 'bet_insurance_refund'
        ) THEN
          PERFORM public.pin_ledger_double_entry(
            v_bet.player_id, v_bet.season_id, v_week_id,
            v_refund, 'bet_insurance_refund', 'Safety Ticket refund', NULL, v_bet.id);
        END IF;
      END IF;

    ELSIF NOT EXISTS (
      SELECT 1 FROM public.bet_legs WHERE bet_id = v_bet.id AND result NOT IN ('push', 'void', 'crutched')
    ) THEN
      -- All legs push/void/crutched → refund the stake (double-entry). A Crutch
      -- that removes the only loss but leaves no survivor lands here. Any haunts
      -- get nothing (no profit existed); their tickets stay spent.
      UPDATE public.bets SET status = 'push', settled_at = now() WHERE id = v_bet.id;
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, v_week_id,
        v_bet.stake, 'bet_refund', 'Push refund', NULL, v_bet.id);

    ELSE
      -- Won: payout = floor(stake × product(won-leg odds)). Push/void/crutched
      -- legs drop out → the Crutch's "reduced odds" is exactly this recompute.
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

      SELECT count(*) INTO v_haunt_n FROM public.bet_haunts WHERE bet_id = v_bet.id;

      IF v_haunt_n > 0 THEN
        -- Haunted win: the owner keeps only their stake; the ghosts eat the profit.
        -- Owner stake-back stays on 'bet_payout' (identical accounting/tooling).
        PERFORM public.pin_ledger_double_entry(
          v_bet.player_id, v_bet.season_id, v_week_id,
          v_bet.stake, 'bet_payout', 'Bet won (haunted — stake returned)', NULL, v_bet.id);

        v_profit := v_payout - v_bet.stake;

        -- Split the profit across the N ghosts ordered by attached_at: each gets
        -- floor(profit/N); the earliest r = profit mod N get +1. Owner ends at
        -- EXACTLY stake; the books net to zero. Guard keeps re-settlement idempotent.
        IF v_profit > 0 AND NOT EXISTS (
          SELECT 1 FROM public.pin_ledger WHERE bet_id = v_bet.id AND type = 'bet_haunt_steal'
        ) THEN
          v_idx := 0;
          FOR v_haunt IN
            SELECT id, haunter_player_id
              FROM public.bet_haunts
             WHERE bet_id = v_bet.id
             ORDER BY attached_at, id
          LOOP
            v_cut := v_profit / v_haunt_n;                 -- integer floor (profit > 0)
            IF v_idx < (v_profit % v_haunt_n) THEN
              v_cut := v_cut + 1;                          -- remainder to the earliest
            END IF;
            v_idx := v_idx + 1;

            IF v_cut > 0 THEN
              PERFORM public.pin_ledger_double_entry(
                v_haunt.haunter_player_id, v_bet.season_id, v_week_id,
                v_cut, 'bet_haunt_steal', 'Ghost in the Slip — profit stolen', NULL, v_bet.id);
            END IF;
            UPDATE public.bet_haunts SET payout_amount = v_cut WHERE id = v_haunt.id;
          END LOOP;

          -- One aggregate reveal per haunted win. The haunters ride in the payload
          -- (a feed row has a single subject = the victim). Deduped per (bet,
          -- event_type) by activity_feed_unique_bet_event → no double-up.
          SELECT jsonb_agg(jsonb_build_object('name', p.name, 'cut', bh.payout_amount) ORDER BY bh.attached_at, bh.id)
            INTO v_haunters
            FROM public.bet_haunts bh
            JOIN public.players p ON p.id = bh.haunter_player_id
           WHERE bh.bet_id = v_bet.id;

          PERFORM public.publish_activity_event(
            'sportsbook', 'sportsbook_haunt_hit',
            v_bet.season_id, v_week_id, NULL, v_bet.player_id, NULL,
            v_bet.id, NULL,
            'sportsbook.haunt_hit',
            jsonb_build_object('payout', v_payout, 'stake', v_bet.stake, 'profit', v_profit,
                               'ghost_count', v_haunt_n, 'haunters', v_haunters),
            jsonb_build_object('bet_id', v_bet.id),
            NULL, now());
        END IF;
      ELSE
        -- Unhaunted win: full payout to the owner.
        PERFORM public.pin_ledger_double_entry(
          v_bet.player_id, v_bet.season_id, v_week_id,
          v_payout, 'bet_payout', 'Bet won', NULL, v_bet.id);
      END IF;

      -- Energy Drink: House-funded bonus on the win = floor(payout × boost_pct),
      -- applied to the TOTAL payout (stake + winnings), so boost_pct = 1.0 doubles
      -- the whole payout. Reads the pct snapshotted onto the bet at placement (its
      -- flavor's value, locked in) so the paid bonus equals what the slip showed.
      -- ALWAYS credits the OWNER — their own item, their reward — even when ghosts
      -- ate the base profit. Bet-linked + week-stamped; NOT-EXISTS guard idempotent.
      IF v_bet.boost_item_id IS NOT NULL THEN
        v_boost_pct := COALESCE(v_bet.boost_pct, 1.0);
        v_bonus := FLOOR(v_payout * v_boost_pct);

        IF v_bonus > 0 AND NOT EXISTS (
          SELECT 1 FROM public.pin_ledger
           WHERE bet_id = v_bet.id AND type = 'bet_odds_boost'
        ) THEN
          PERFORM public.pin_ledger_double_entry(
            v_bet.player_id, v_bet.season_id, v_week_id,
            v_bonus, 'bet_odds_boost', 'Energy Drink bonus', NULL, v_bet.id);

          -- A boost that actually paid out → news. Deduped per (bet, event_type)
          -- by activity_feed_unique_bet_event, so re-settlement never doubles up.
          PERFORM public.publish_activity_event(
            'sportsbook', 'sportsbook_boost_hit',
            v_bet.season_id, v_week_id, v_bet.player_id, NULL, NULL,
            v_bet.id, NULL,
            'sportsbook.boost_hit',
            jsonb_build_object('payout', v_payout, 'bonus', v_bonus),
            jsonb_build_object('bet_id', v_bet.id),
            NULL, now());
        END IF;
      END IF;

      -- The Crutch actually saved a payout → news. Deduped per (bet, event_type)
      -- by activity_feed_unique_bet_event, so re-settlement never doubles up.
      IF v_crutched THEN
        SELECT count(*) INTO v_won_legs FROM public.bet_legs WHERE bet_id = v_bet.id AND result = 'won';
        PERFORM public.publish_activity_event(
          'sportsbook', 'sportsbook_crutch_save',
          v_bet.season_id, v_week_id, v_bet.player_id, NULL, NULL,
          v_bet.id, NULL,
          'sportsbook.crutch_save',
          jsonb_build_object('payout', v_payout, 'legs', v_won_legs),
          jsonb_build_object('bet_id', v_bet.id),
          NULL, now());
      END IF;
    END IF;
  END LOOP;
END;
$function$;
