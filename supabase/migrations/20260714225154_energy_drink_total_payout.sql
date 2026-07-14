-- Energy Drink: boost applies to the TOTAL payout, not just the profit.
--
-- Previously the House-funded bonus was floor((payout - stake) * boost_pct) — a
-- profit doubler (1:1 → 2:1). Now it is floor(payout * boost_pct): boost_pct = 1.0
-- doubles the TOTAL payout (stake + winnings). A 50-pin 1:1 bet paid 100 + a 50
-- bonus (=150); it now pays 100 + a 100 bonus (=200).
--
-- Only the boost magnitude + the catalog metadata/copy change. The bonus stays a
-- separate 'bet_odds_boost' double-entry ledger row on top of 'bet_payout' (same
-- idempotency guard, same sportsbook_boost_hit feed event, still always credits
-- the OWNER even on a haunted win). This is a straight CREATE OR REPLACE of
-- finalize_bets_for_market carried over verbatim from 20260623200500, changing
-- only the one boost line + its comment.

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
    SELECT DISTINCT b.id, b.player_id, b.season_id, b.stake, b.insurance_item_id, b.crutch_item_id, b.boost_item_id
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
      -- the whole payout (a 1:1 bet returns payout + an equal bonus). ALWAYS credits
      -- the OWNER — their own item, their reward — even when ghosts ate the base
      -- profit. Bet-linked + week-stamped; NOT-EXISTS guard idempotent.
      IF v_bet.boost_item_id IS NOT NULL THEN
        SELECT COALESCE((c.effect_params ->> 'boost_pct')::numeric, 1.0) INTO v_boost_pct
          FROM public.player_inventory_items i
          JOIN public.item_catalog c ON c.id = i.catalog_item_id
         WHERE i.id = v_bet.boost_item_id;

        v_bonus := FLOOR(v_payout * COALESCE(v_boost_pct, 1.0));

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

-- Retune the catalog row: the boost now applies to the total payout, not profit.
UPDATE public.item_catalog
   SET effect_params = '{"boost_pct": 1.0, "base": "total"}'::jsonb,
       description = 'Attach it to any bet in the Sportsbook. Win and your total payout is doubled — your stake and your winnings. Spent the moment you attach it, win or lose.'
 WHERE key = 'energy_drink';
