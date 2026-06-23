-- Energy Drink — a profit-doubling Sportsbook item (sibling of the Safety Ticket
-- and Winner's Crutch).
--
-- Attached to any bet (single or parlay) at placement. If the bet WINS, the House
-- pays a bonus of floor((payout - stake) * boost_pct) on top of the normal payout
-- — with boost_pct = 1.0 that doubles the profit (shifts the payout profile from
-- 1:1 to 2:1). Spent at placement win or lose, restored only by cancel_bet.
-- Stacks with a Safety Ticket and a Winner's Crutch (its own attach slot).
--
-- Authored against the current bodies of place_house_bet / finalize_bets_for_market
-- / cancel_bet (the Winner's Crutch migration is the template — see
-- 20260623180629_winners_crutch.sql).

-- ---------------------------------------------------------------------------
-- Part 1: schema + catalog.
-- ---------------------------------------------------------------------------

-- A dedicated attach slot, distinct from insurance_item_id / crutch_item_id so the
-- three items are independently validated and can ride the same bet.
ALTER TABLE public.bets
  ADD COLUMN boost_item_id uuid REFERENCES public.player_inventory_items(id);

-- New effect_type so the boost slot is mutually type-safe with the others.
ALTER TABLE public.item_catalog DROP CONSTRAINT item_catalog_effect_type_check;
ALTER TABLE public.item_catalog ADD CONSTRAINT item_catalog_effect_type_check
  CHECK ((effect_type = ANY (ARRAY['bet_insurance'::text, 'parlay_crutch'::text, 'odds_boost'::text, 'cosmetic'::text, 'access_pass'::text, 'custom'::text])));

-- New ledger type for the House-funded boost bonus. Bet-linked + week-stamped, so
-- the archive engine captures/reverses it exactly like every other bet movement.
ALTER TABLE public.pin_ledger DROP CONSTRAINT pin_ledger_type_check;
ALTER TABLE public.pin_ledger ADD CONSTRAINT pin_ledger_type_check
  CHECK ((type = ANY (ARRAY['bonus'::text, 'score_credit'::text, 'bet_stake'::text, 'bet_payout'::text, 'bet_refund'::text, 'loan_issued'::text, 'loan_manual_repayment'::text, 'loan_weekly_garnishment'::text, 'loan_season_close_settlement'::text, 'pvp_stake'::text, 'pvp_payout'::text, 'pvp_refund'::text, 'pvp_rake'::text, 'bounty_sponsor_stake'::text, 'bounty_hunter_stake'::text, 'bounty_payout'::text, 'auction_purchase'::text, 'auction_check_bounce'::text, 'bet_insurance_refund'::text, 'bet_odds_boost'::text])));

-- Seed the catalog row. Flows through the existing auction + admin-grant paths with
-- no extra code. effect_params carries the boost magnitude (1.0 = profit doubled)
-- and the base it applies to ('profit'), so future variants are catalog rows.
INSERT INTO public.item_catalog (key, name, description, icon, effect_type, effect_params, activation_mode)
VALUES (
  'energy_drink',
  'Energy Drink',
  'Attach it to any bet in the Sportsbook. Win and your profit doubles — 1:1 becomes 2:1. Spent the moment you attach it, win or lose.',
  '⚡',
  'odds_boost',
  '{"boost_pct": 1.0, "base": "profit"}'::jsonb,
  'attach_to_bet'
);

-- New feed event: a boost that actually paid out. requires_actor (the bettor),
-- keyed on the sportsbook bet. Deduped per (bet, event_type) by the existing
-- activity_feed_unique_bet_event index → re-settlement never doubles up.
INSERT INTO public.activity_event_catalog
  (event_type, source_feature, template_key, requires_actor, allowed_fk, default_visibility) VALUES
  ('sportsbook_boost_hit', 'sportsbook', 'sportsbook.boost_hit', true, 'sportsbook_bet_id', 'public');

-- ---------------------------------------------------------------------------
-- Part 2: place_house_bet — gains a 6th trailing arg p_boost_item_id.
-- CREATE OR REPLACE can't add a parameter → DROP + recreate + re-grant.
-- ---------------------------------------------------------------------------

DROP FUNCTION public.place_house_bet(uuid[], integer, uuid, uuid, uuid);

CREATE FUNCTION public.place_house_bet(
  p_selection_ids uuid[],
  p_stake integer,
  p_custom_line_id uuid DEFAULT NULL,
  p_insurance_item_id uuid DEFAULT NULL,
  p_crutch_item_id uuid DEFAULT NULL,
  p_boost_item_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
  -- lose; the bonus is paid at settlement on a win.
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
  END IF;

  INSERT INTO public.bets (player_id, season_id, week_id, stake, potential_payout, status,
                           custom_line_id, custom_line_title, custom_line_description, custom_line_category,
                           insurance_item_id, crutch_item_id, boost_item_id)
    VALUES (v_player_id, v_season_id, v_week_id, p_stake, v_payout, 'pending',
            v_line.id, v_line.title, v_line.description, v_line.category,
            p_insurance_item_id, p_crutch_item_id, p_boost_item_id)
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

GRANT EXECUTE ON FUNCTION public.place_house_bet(uuid[], integer, uuid, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Part 3: finalize_bets_for_market — the Energy Drink hook.
--
-- After a bet settles WON, if a boost is attached pay a House-funded bonus of
-- floor((payout - stake) * boost_pct) as a separate bet-linked, week-stamped
-- ledger row (type 'bet_odds_boost'). NOT-EXISTS guard makes re-settlement (force
-- re-archive) idempotent. Push/loss leave the item spent, no bonus — consistent
-- with the Safety Ticket / Winner's Crutch posture.
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
      -- that removes the only loss but leaves no survivor lands here.
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
      PERFORM public.pin_ledger_double_entry(
        v_bet.player_id, v_bet.season_id, v_week_id,
        v_payout, 'bet_payout', 'Bet won', NULL, v_bet.id);

      -- Energy Drink: House-funded bonus on the win = floor(profit × boost_pct),
      -- where profit = payout - stake (boost_pct = 1.0 ⇒ profit doubled, 1:1 → 2:1).
      -- Bet-linked + week-stamped, so archive/unarchive handle it like every other
      -- bet movement. NOT-EXISTS guard keeps re-settlement idempotent.
      IF v_bet.boost_item_id IS NOT NULL THEN
        SELECT COALESCE((c.effect_params ->> 'boost_pct')::numeric, 1.0) INTO v_boost_pct
          FROM public.player_inventory_items i
          JOIN public.item_catalog c ON c.id = i.catalog_item_id
         WHERE i.id = v_bet.boost_item_id;

        v_bonus := FLOOR((v_payout - v_bet.stake) * COALESCE(v_boost_pct, 1.0));

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

-- ---------------------------------------------------------------------------
-- Part 4: cancel_bet — un-spend the Energy Drink too ("as if it never happened").
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_bet(p_bet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_market_ids uuid[];
  v_mid        uuid;
BEGIN
  PERFORM public.assert_admin();

  -- Markets this bet touched (captured before the bet is deleted).
  SELECT ARRAY_AGG(DISTINCT s.market_id) INTO v_market_ids
  FROM public.bet_legs l
  JOIN public.bet_selections s ON s.id = l.selection_id
  WHERE l.bet_id = p_bet_id;

  -- Restore the attached items consumed at placement (consumed_at back to NULL on
  -- the exact rows the bet points at). The only sanctioned un-spend.
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT insurance_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT crutch_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id = (SELECT boost_item_id FROM public.bets WHERE id = p_bet_id)
     AND consumed_at IS NOT NULL;

  DELETE FROM public.pin_ledger WHERE bet_id = p_bet_id;
  DELETE FROM public.bets WHERE id = p_bet_id;

  -- Re-open any settled market that now has no bets at all.
  IF v_market_ids IS NOT NULL THEN
    FOREACH v_mid IN ARRAY v_market_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.bet_legs l
        JOIN public.bet_selections s ON s.id = l.selection_id
        WHERE s.market_id = v_mid
      ) AND EXISTS (
        SELECT 1 FROM public.bet_markets WHERE id = v_mid AND status = 'settled'
      ) THEN
        UPDATE public.bet_markets
          SET status = 'open', result_value = NULL, settled_at = NULL
          WHERE id = v_mid;
        UPDATE public.bet_selections SET result = NULL WHERE market_id = v_mid;
      END IF;
    END LOOP;
  END IF;
END;
$function$;
