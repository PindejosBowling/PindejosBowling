-- ============================================================================
-- Bounty Board — admin may settle a bounty at any time (no pre-close required).
-- ============================================================================
-- Previously settle_bounty required status = 'closed', forcing the admin to run
-- close_bounty first. Admins asked to be able to settle directly from 'open'
-- (the bounty is set to 'settled' at the end either way, so the intermediate
-- 'closed' hop adds nothing). This relaxes the guard to allow settling an 'open'
-- OR 'closed' bounty; 'settled' stays idempotent.
--
-- Destructive cancel post-settlement already works: cancel_bounty has no status
-- guard and deletes by bounty_post_id, so it erases a settled bounty's pin rows
-- and root row regardless of status. No change needed there.
--
-- Body is otherwise copied verbatim from 20260607220000_bounty_all_comers.sql
-- (All Comers payout math); only the status guard changed.
-- ============================================================================

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
