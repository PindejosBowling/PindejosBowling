-- ============================================================================
-- Bounty Board — "All Comers" mechanic redesign (replaces early-hunter anti-dilution).
-- ============================================================================
-- The original model treated the sponsor bounty S as a FIXED pie that hunters
-- divided (floor(S / entry_number) per hunter). That rewarded early hunters by
-- making every *next* hunter's offer worse — a land-grab for early slots that
-- killed group participation.
--
-- New model — the sponsor takes the SAME bet against each of up to `max_hunters`:
--   • Sponsor sets reward_per_hunter (R), hunter_stake_amount (H), max_hunters (m).
--   • Sponsor escrows R*m up front (their bounded, known max liability).
--   • Each hunter escrows H to join (capacity capped at m).
--   • hunter_win  → every hunter gets H + R, identical regardless of join order or
--                   count; the sponsor's unused escrow (m-n)*R is returned.
--   • sponsor_win → sponsor collects every H and gets their escrow back.
-- Properties: no dilution, no race, zero House cost for sponsor bounties, and —
-- with the collective win rule (any hunter satisfying the bounty pays the whole
-- pack) — more hunters raise everyone's win odds, so recruiting is a dominant
-- strategy. The House seed only applies to a House-sponsored bounty that loses.
--
-- This migration:
--   1. Adds bounty_post.reward_per_hunter + max_hunters (sponsor_bounty_amount is
--      repurposed to hold the total escrow R*m so the escrow plumbing is unchanged).
--   2. Rebuilds the create RPCs (new arg list → DROP + CREATE) and CREATE OR
--      REPLACEs enter/settle with the all-comers logic. The Activity Feed publish
--      calls (added in 20260607215740) are preserved, with updated payloads.
-- close_bounty / cancel_bounty are unchanged and are not touched here.
-- ============================================================================


-- ── 1. Schema: reward_per_hunter + max_hunters ───────────────────────────────
ALTER TABLE public.bounty_post ADD COLUMN reward_per_hunter int;
ALTER TABLE public.bounty_post ADD COLUMN max_hunters       int;

-- Backfill any pre-existing (test) rows: treat the old sponsor bounty as the
-- per-hunter reward and pick a sane default cap.
UPDATE public.bounty_post SET reward_per_hunter = sponsor_bounty_amount WHERE reward_per_hunter IS NULL;
UPDATE public.bounty_post SET max_hunters = 8 WHERE max_hunters IS NULL;

ALTER TABLE public.bounty_post ALTER COLUMN reward_per_hunter SET NOT NULL;
ALTER TABLE public.bounty_post ALTER COLUMN max_hunters       SET NOT NULL;
ALTER TABLE public.bounty_post ADD CONSTRAINT bounty_post_reward_positive   CHECK (reward_per_hunter > 0);
ALTER TABLE public.bounty_post ADD CONSTRAINT bounty_post_max_hunters_range CHECK (max_hunters >= 1 AND max_hunters <= 100);


-- ── 2. create_sponsor_bounty — escrow R*m up front (new arg list) ────────────
DROP FUNCTION IF EXISTS public.create_sponsor_bounty(uuid, text, text, int, int, timestamptz);

CREATE FUNCTION public.create_sponsor_bounty(
  p_week_id             uuid,
  p_title               text,
  p_description         text,
  p_reward_per_hunter   int,
  p_hunter_stake_amount int,
  p_max_hunters         int,
  p_closes_at           timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sponsor_id uuid;
  v_season_id  uuid;
  v_balance    int;
  v_escrow     int;
  v_bounty_id  uuid;
BEGIN
  SELECT id INTO v_sponsor_id FROM public.players WHERE user_id = auth.uid();
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

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

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_sponsor_id AND season_id = v_season_id;
  IF v_balance < v_escrow THEN
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
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (v_sponsor_id, v_season_id, p_week_id, false, -v_escrow,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed', v_bounty_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (NULL, v_season_id, p_week_id, true, v_escrow,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed (house)', v_bounty_id);

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
    NULL, NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_sponsor_bounty(uuid, text, text, int, int, int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_sponsor_bounty(uuid, text, text, int, int, int, timestamptz) TO authenticated;


-- ── 3. create_house_bounty — same terms, no escrow (House funds on hunter win) ─
DROP FUNCTION IF EXISTS public.create_house_bounty(uuid, text, text, int, int, timestamptz);

CREATE FUNCTION public.create_house_bounty(
  p_week_id             uuid,
  p_title               text,
  p_description         text,
  p_reward_per_hunter   int,
  p_hunter_stake_amount int,
  p_max_hunters         int,
  p_closes_at           timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_season_id uuid;
  v_bounty_id uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

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

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, reward_per_hunter, max_hunters,
    hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'house_bounty', NULL, p_title, p_description,
    p_reward_per_hunter * p_max_hunters, p_reward_per_hunter, p_max_hunters,
    p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- No ledger movement — the House funds rewards only if hunters win (design §23.4).

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_bounty_posted',
    v_season_id, p_week_id,
    NULL, NULL, NULL,
    NULL, NULL,
    'bounty_board.bounty_posted',
    jsonb_build_object('bounty_title', p_title, 'reward_per_hunter', p_reward_per_hunter,
                       'hunter_stake_amount', p_hunter_stake_amount, 'max_hunters', p_max_hunters,
                       'bounty_type', 'house_bounty'),
    jsonb_build_object('bounty_post_id', v_bounty_id),
    NULL, NULL, now(),
    NULL, v_bounty_id);

  RETURN v_bounty_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_house_bounty(uuid, text, text, int, int, int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_house_bounty(uuid, text, text, int, int, int, timestamptz) TO authenticated;


-- ── 4. enter_bounty_as_hunter — capacity-capped; flat reward snapshot ────────
CREATE OR REPLACE FUNCTION public.enter_bounty_as_hunter(p_bounty_post_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hunter_id    uuid;
  v_bounty       public.bounty_post;
  v_balance      int;
  v_entry_number int;
  v_count        int;
  v_stake_id     uuid;
BEGIN
  SELECT id INTO v_hunter_id FROM public.players WHERE user_id = auth.uid();
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

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

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_hunter_id AND season_id = v_bounty.season_id;
  IF v_balance < v_bounty.hunter_stake_amount THEN
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

  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (v_hunter_id, v_bounty.season_id, v_bounty.week_id, false, -v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed', p_bounty_post_id, v_stake_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed (house)', p_bounty_post_id, v_stake_id);

  PERFORM public.publish_activity_event(
    'bounty_board', 'bounty_board_hunter_joined',
    v_bounty.season_id, v_bounty.week_id,
    v_hunter_id, NULL, NULL,
    NULL, NULL,
    'bounty_board.hunter_joined',
    jsonb_build_object('bounty_title', v_bounty.title, 'entry_number', v_entry_number),
    jsonb_build_object('bounty_post_id', p_bounty_post_id),
    NULL, NULL, now(),
    NULL, p_bounty_post_id);

  RETURN v_stake_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enter_bounty_as_hunter(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enter_bounty_as_hunter(uuid) TO authenticated;


-- ── 5. settle_bounty — fixed-reward payouts + unused-escrow return ───────────
CREATE OR REPLACE FUNCTION public.settle_bounty(
  p_bounty_post_id             uuid,
  p_outcome                    text,
  p_admin_settlement_reasoning text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  IF v_bounty.status = 'settled' THEN
    RETURN;  -- idempotent
  END IF;
  IF v_bounty.status <> 'closed' THEN
    RAISE EXCEPTION 'Bounty must be closed before settling';
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

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_total_stakes + v_escrow,
                'bounty_payout', 'Bounty sponsor won', p_bounty_post_id, v_settlement_id, v_payout_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -(v_total_stakes + v_escrow),
                'bounty_payout', 'Bounty sponsor won (house)', p_bounty_post_id, v_settlement_id, v_payout_id);
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

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id, bounty_hunter_stake_id)
        VALUES (v_stake.player_id, v_bounty.season_id, v_bounty.week_id, false, v_payout,
                'bounty_payout', 'Bounty hunter won', p_bounty_post_id, v_settlement_id, v_payout_id, v_stake.id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id, bounty_hunter_stake_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_payout,
                'bounty_payout', 'Bounty hunter won (house)', p_bounty_post_id, v_settlement_id, v_payout_id, v_stake.id);
    END LOOP;

    -- Return the sponsor's unused escrow ((max_hunters - n) * R) for a sponsor bounty.
    IF v_bounty.bounty_type = 'sponsor_bounty' AND v_unused_escrow > 0 THEN
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_unused_escrow,
                'bounty_payout', 'Bounty unused escrow returned', p_bounty_post_id, v_settlement_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_unused_escrow,
                'bounty_payout', 'Bounty unused escrow returned (house)', p_bounty_post_id, v_settlement_id);
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
      NULL, NULL, now(),
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
      NULL, NULL, now(),
      NULL, p_bounty_post_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_bounty(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_bounty(uuid, text, text) TO authenticated;
