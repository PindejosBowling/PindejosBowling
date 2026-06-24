-- Ghost in the Slip — the league's first ADVERSARIAL Sportsbook item.
--
-- A player secretly attaches a Ghost to ANOTHER player's already-placed, still-
-- pending bet. If that bet WINS, the ghost steals the profit: the original winner
-- is credited only their stake back, and the haunter(s) split the profit
-- (payout - stake). The House pays exactly what it always would — no pins minted
-- or burned (House-neutral, odds-agnostic).
--
-- Diverges from the self-only attach_to_bet items (Safety Ticket / Winner's Crutch
-- / Energy Drink, see 20260623193000_energy_drink.sql) in three ways:
--   1. a NEW link table bet_haunts (who haunted whose bet) — not a column on bets,
--      because a bet can carry MANY ghosts, each from a different player;
--   2. a NEW activation_mode 'attach_to_foreign_bet' (post-placement, foreign bet);
--   3. a NEW dedicated RPC haunt_bet — the attach happens away from place_house_bet.
--
-- Consumed on attach (win or lose), like every other consumable; restored only by
-- cancel_bet (admin-only). Loss/push/void leave the ticket spent with no payout.
--
-- Authored against the current bodies of finalize_bets_for_market / cancel_bet as
-- left by the Energy Drink migration.

-- ---------------------------------------------------------------------------
-- Part 1: schema + catalog + feed catalog.
-- ---------------------------------------------------------------------------

-- New effect_type ('haunt') and activation_mode ('attach_to_foreign_bet'), so the
-- Ghost is type-safe and distinct from every self-attach item.
ALTER TABLE public.item_catalog DROP CONSTRAINT item_catalog_effect_type_check;
ALTER TABLE public.item_catalog ADD CONSTRAINT item_catalog_effect_type_check
  CHECK ((effect_type = ANY (ARRAY['bet_insurance'::text, 'parlay_crutch'::text, 'odds_boost'::text, 'haunt'::text, 'cosmetic'::text, 'access_pass'::text, 'custom'::text])));

ALTER TABLE public.item_catalog DROP CONSTRAINT item_catalog_activation_mode_check;
ALTER TABLE public.item_catalog ADD CONSTRAINT item_catalog_activation_mode_check
  CHECK ((activation_mode = ANY (ARRAY['attach_to_bet'::text, 'attach_to_foreign_bet'::text, 'passive'::text, 'admin_honored'::text])));

-- New ledger type for the stolen profit credited to each haunter. Bet-linked +
-- week-stamped, so the archive engine captures/reverses it exactly like every
-- other bet movement. The victim's stake-back stays on 'bet_payout' so existing
-- balance/unarchive tooling treats it identically — only the ghost credits are new.
ALTER TABLE public.pin_ledger DROP CONSTRAINT pin_ledger_type_check;
ALTER TABLE public.pin_ledger ADD CONSTRAINT pin_ledger_type_check
  CHECK ((type = ANY (ARRAY['bonus'::text, 'score_credit'::text, 'bet_stake'::text, 'bet_payout'::text, 'bet_refund'::text, 'loan_issued'::text, 'loan_manual_repayment'::text, 'loan_weekly_garnishment'::text, 'loan_season_close_settlement'::text, 'pvp_stake'::text, 'pvp_payout'::text, 'pvp_refund'::text, 'pvp_rake'::text, 'bounty_sponsor_stake'::text, 'bounty_hunter_stake'::text, 'bounty_payout'::text, 'auction_purchase'::text, 'auction_check_bounce'::text, 'bet_insurance_refund'::text, 'bet_odds_boost'::text, 'bet_haunt_steal'::text])));

-- The link: one row per (bet, haunter). All writes via the SECURITY DEFINER RPCs
-- below — no write policies (the all-RPC posture of the item framework).
CREATE TABLE public.bet_haunts (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bet_id            uuid        NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  haunter_player_id uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- The exact ticket consumed at attach (the cancel_bet restore key).
  inventory_item_id uuid        NOT NULL REFERENCES public.player_inventory_items(id),
  season_id         uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  -- The target bet's week, for archive symmetry with the steal ledger rows.
  week_id           uuid        REFERENCES public.weeks(id) ON DELETE SET NULL,
  -- Drives the +1-remainder "earliest haunters" ordering at settlement.
  attached_at       timestamptz NOT NULL DEFAULT now(),
  -- Filled at settlement: the pins this ghost actually received (NULL until won).
  payout_amount     integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One haunt per haunter per bet (N = distinct ghosts; no single-player stacking).
  UNIQUE (bet_id, haunter_player_id)
);

CREATE INDEX bet_haunts_bet_idx     ON public.bet_haunts (bet_id);
CREATE INDEX bet_haunts_haunter_idx ON public.bet_haunts (haunter_player_id);
CREATE INDEX bet_haunts_season_idx  ON public.bet_haunts (season_id);

-- (The set_updated_at trigger is auto-attached by the enforce_audit_columns
-- event trigger on any new table with created_at/updated_at — do not add it here.)

-- RLS: the secret. A pending haunt is visible only to its haunter (and admins).
-- It becomes public ONLY once the target bet has WON — that is the moment the
-- named reveal + feed event land. A failed haunt (bet lost/push/void/cancelled)
-- stays haunter-only forever (no public whiffs). No write policies (RPC-only).
ALTER TABLE public.bet_haunts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "haunter, admin, or revealed-on-win can read" ON public.bet_haunts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR haunter_player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.bets b WHERE b.id = bet_id AND b.status = 'won')
  );

-- Seed the catalog row. Flows through the existing auction + admin-grant rails
-- with no extra code. activation_mode drives the UI affordance (attach to a
-- foreign pending bet, surfaced in BetDetailModal).
INSERT INTO public.item_catalog (key, name, description, icon, effect_type, effect_params, activation_mode)
VALUES (
  'ghost_in_the_slip',
  'Ghost in the Slip',
  'Secretly haunt another player''s pending bet from the Sportsbook. If their bet wins, you steal the profit — they keep only their stake. If more than one ghost is on the same bet, the profit is split evenly. Spent the moment you attach it, win or lose.',
  '👻',
  'haunt',
  '{}'::jsonb,
  'attach_to_foreign_bet'
);

-- New feed event: a haunt that actually cashed. ONE aggregate row per haunted
-- winning bet (the haunters live in the payload, since a feed row has a single
-- subject). requires_actor=false — the subject is the VICTIM; there is no single
-- actor. Deduped per (bet, event_type) by activity_feed_unique_bet_event, so
-- re-settlement (force re-archive) never doubles up.
INSERT INTO public.activity_event_catalog
  (event_type, source_feature, template_key, requires_actor, allowed_fk, default_visibility) VALUES
  ('sportsbook_haunt_hit', 'sportsbook', 'sportsbook.haunt_hit', false, 'sportsbook_bet_id', 'public');

-- ---------------------------------------------------------------------------
-- Part 2: haunt_bet — attach a Ghost to a foreign pending bet.
-- Consumes the atomic item and records the link, both or neither (one txn).
-- No pin movement here (nothing to leak in the public pin_ledger during pending).
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.haunt_bet(p_target_bet_id uuid, p_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
  v_bet       public.bets%ROWTYPE;
  v_haunt_id  uuid;
BEGIN
  v_player_id := public.current_player_id();

  SELECT * INTO v_bet FROM public.bets WHERE id = p_target_bet_id;
  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'You can only haunt a pending bet';
  END IF;
  IF v_bet.player_id = v_player_id THEN
    RAISE EXCEPTION 'You cannot haunt your own bet';
  END IF;

  -- One haunt per haunter per bet (nice message before the consume; the UNIQUE
  -- constraint is the structural backstop).
  IF EXISTS (
    SELECT 1 FROM public.bet_haunts
     WHERE bet_id = p_target_bet_id AND haunter_player_id = v_player_id
  ) THEN
    RAISE EXCEPTION 'You have already haunted this bet';
  END IF;

  -- Validate the catalog contract before spending the item.
  IF NOT EXISTS (
    SELECT 1
      FROM public.player_inventory_items i
      JOIN public.item_catalog c ON c.id = i.catalog_item_id
     WHERE i.id = p_item_id
       AND c.effect_type = 'haunt'
       AND c.activation_mode = 'attach_to_foreign_bet'
  ) THEN
    RAISE EXCEPTION 'That item is not a Ghost in the Slip';
  END IF;

  -- Consume the atomic ticket in one guarded UPDATE (owner + unconsumed + the
  -- bet's season — rowcount 0 means one of those failed). Spent win or lose.
  UPDATE public.player_inventory_items
     SET consumed_at = now()
   WHERE id = p_item_id
     AND player_id = v_player_id
     AND season_id = v_bet.season_id
     AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ghost in the Slip is not usable (already spent, wrong season, or not yours)';
  END IF;

  INSERT INTO public.bet_haunts (bet_id, haunter_player_id, inventory_item_id, season_id, week_id)
    VALUES (p_target_bet_id, v_player_id, p_item_id, v_bet.season_id, v_bet.week_id)
    RETURNING id INTO v_haunt_id;

  RETURN v_haunt_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.haunt_bet(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Part 3: finalize_bets_for_market — the Ghost diversion in the WON branch.
--
-- When a bet wins WITH haunts attached, the owner is credited only their stake
-- (still type 'bet_payout'), and the profit (payout - stake) is split across the
-- N ghosts ordered by attached_at: each gets floor(profit/N), the earliest r get
-- +1 (remainder), so the owner lands EXACTLY their stake and the ledger nets to
-- zero. One aggregate feed event fires. NOT-EXISTS guard on bet_haunt_steal keeps
-- re-settlement idempotent. The Energy Drink boost branch is unchanged — its bonus
-- is computed off (payout - stake) and still credits the OWNER (their own item).
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

      -- Energy Drink: House-funded bonus on the win = floor(profit × boost_pct),
      -- where profit = payout - stake (boost_pct = 1.0 ⇒ profit doubled, 1:1 → 2:1).
      -- ALWAYS credits the OWNER — their own item, their reward — even when ghosts
      -- ate the base profit. Bet-linked + week-stamped; NOT-EXISTS guard idempotent.
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
-- Part 4: cancel_bet — also dissolve haunts and REFUND each ghost's ticket
-- ("as if it never happened"). Mirrors the existing item-restore logic; the
-- bet_haunts rows then vanish via ON DELETE CASCADE when the bet is deleted.
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

  -- Restore every ghost's ticket too — a haunt on a cancelled bet never resolved,
  -- so the haunter gets their Ghost back. The bet_haunts rows themselves cascade
  -- away with the bet delete below.
  UPDATE public.player_inventory_items
     SET consumed_at = NULL
   WHERE id IN (SELECT inventory_item_id FROM public.bet_haunts WHERE bet_id = p_bet_id)
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
