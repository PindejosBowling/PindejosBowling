-- PR2 — schema scaffolding for the advance/settle split.
--
-- Additive only, no behavior change to the archive engine (that lands in PR3).
-- Introduces:
--   1. weeks.settled_at            — the second-clock timestamp + the flag the
--      client branches on to offer the Settle UI (is_archived && settled_at NULL
--      == "advanced, locked, not yet settled").
--   2. week_archive_snapshot.phase — 'advance' rows (fill-score preimages) vs
--      'settle' rows (money preimages/preexisting ids) so PR4's reversal can
--      target the right snapshot slice.
--   3. A bet-placement is_archived guard so a locked-but-unsettled week's
--      still-'open' prop markets cannot take new stakes between advance and
--      settle.
-- Plus one-time backfills so live data reads correctly the moment the column
-- exists (already-archived weeks read SETTLED; legacy monolithic snapshots get
-- their phase labels).

-- ---------------------------------------------------------------------------
-- 1. weeks.settled_at
-- ---------------------------------------------------------------------------
ALTER TABLE public.weeks ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- Partial index for the hot lookup: the advanced-but-unsettled week(s) of a
-- season (what the Settle UI and settle_week resolve to). Locked-unsettled is a
-- rare, transient state, so a partial index stays tiny.
CREATE INDEX IF NOT EXISTS weeks_advanced_unsettled_idx
  ON public.weeks (season_id)
  WHERE is_archived = true AND settled_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. week_archive_snapshot.phase
-- ---------------------------------------------------------------------------
ALTER TABLE public.week_archive_snapshot
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'advance';

ALTER TABLE public.week_archive_snapshot
  DROP CONSTRAINT IF EXISTS week_archive_snapshot_phase_check;
ALTER TABLE public.week_archive_snapshot
  ADD CONSTRAINT week_archive_snapshot_phase_check
  CHECK (phase = ANY (ARRAY['advance'::text, 'settle'::text]));

-- Forward-compat relabel of LEGACY monolithic-archive snapshots. Today's atomic
-- archive_week captures fill-score preimages AND money preimages/ids in one run;
-- after the split, 'advance' captures only the fill-score ('scores') preimages
-- and 'settle' captures all the money rows. Label the historical rows the same
-- way so PR4's phase-branched unarchive reverses legacy weeks correctly. Harmless
-- before PR4: the current unarchive_week ignores phase and reverses everything.
UPDATE public.week_archive_snapshot
   SET phase = 'settle'
 WHERE table_name <> 'scores'
   AND phase = 'advance';

-- ---------------------------------------------------------------------------
-- 3. Bet-placement guard: no new stakes on a locked week.
--    Only change vs the current body: the per-selection week lookup now also
--    reads is_archived and RAISEs if the week is locked (advanced/archived),
--    even when the prop market is still 'open' awaiting its settlement clock.
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
$function$
;

-- ---------------------------------------------------------------------------
-- 4. Backfill settled_at for already-archived weeks so they read as SETTLED and
--    don't show a spurious Settle button. Use the week's archive run timestamp
--    when present, else its scheduled bowl date, else now().
-- ---------------------------------------------------------------------------
UPDATE public.weeks w
   SET settled_at = COALESCE(
         (SELECT max(r.archived_at)
            FROM public.week_archive_runs r
           WHERE r.week_id = w.id AND r.status = 'active'),
         w.bowled_at::timestamptz,
         now())
 WHERE w.is_archived = true
   AND w.settled_at IS NULL;
