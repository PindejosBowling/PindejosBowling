-- ============================================================================
-- Bounty Board — RPCs (economy/BOUNTIES_DB.md §3).
-- ============================================================================
-- Modeled on the as-built accept_pvp_challenge / settle_pvp_challenge: every RPC
-- is SECURITY DEFINER with a pinned search_path and fully-qualified objects;
-- caller identity comes from auth.uid() (never a client-supplied player id).
-- Balances are always derived:
--   balance = SUM(pin_ledger.amount) WHERE player_id = X AND season_id = Y
-- Every bounty event is a balanced player+house pair that nets to 0 (there is no
-- rake). Both rows of every pair carry bounty_post_id so cancel_bounty deletes all
-- of them with one DELETE … WHERE bounty_post_id = X.
--
-- Current season = is_active = true AND registration_open = false (seasons.getCurrent()).
--
-- The Activity Feed publish calls are added in the next migration
-- (activity_feed_bounty) which CREATE OR REPLACEs these RPCs once publish_activity_event
-- knows the bounty event types.
-- ============================================================================


-- ============================================================================
-- 1. create_sponsor_bounty — a player posts + escrows a sponsor bounty (§3).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_sponsor_bounty(
  p_week_id               uuid,
  p_title                 text,
  p_description           text,
  p_sponsor_bounty_amount int,
  p_hunter_stake_amount   int,
  p_closes_at             timestamptz
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

  -- Validate the week (if given) belongs to the current season and is not archived.
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
  IF p_sponsor_bounty_amount < 50 THEN
    RAISE EXCEPTION 'Sponsor bounty must be at least 50 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_sponsor_id AND season_id = v_season_id;
  IF v_balance < p_sponsor_bounty_amount THEN
    RAISE EXCEPTION 'Insufficient balance to sponsor this bounty';
  END IF;

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'sponsor_bounty', v_sponsor_id, p_title, p_description,
    p_sponsor_bounty_amount, p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- Escrow the sponsor amount (double-entry: player -S, house +S). Both rows carry
  -- bounty_post_id (design §23.3).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (v_sponsor_id, v_season_id, p_week_id, false, -p_sponsor_bounty_amount,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed', v_bounty_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id)
    VALUES (NULL, v_season_id, p_week_id, true, p_sponsor_bounty_amount,
            'bounty_sponsor_stake', 'Bounty sponsor stake escrowed (house)', v_bounty_id);

  RETURN v_bounty_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_sponsor_bounty(uuid, text, text, int, int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_sponsor_bounty(uuid, text, text, int, int, timestamptz) TO authenticated;


-- ============================================================================
-- 2. create_house_bounty — admin posts a House bounty (no escrow) (§3).
-- ============================================================================
-- The House is the sponsor; admins act on behalf of the Pinsino (design §25.2).
-- No ledger movement — the House funds the bounty only if hunters win (§23.4).
CREATE OR REPLACE FUNCTION public.create_house_bounty(
  p_week_id               uuid,
  p_title                 text,
  p_description           text,
  p_sponsor_bounty_amount int,
  p_hunter_stake_amount   int,
  p_closes_at             timestamptz
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
  IF p_sponsor_bounty_amount < 50 THEN
    RAISE EXCEPTION 'Sponsor bounty must be at least 50 pins';
  END IF;
  IF p_hunter_stake_amount < 25 THEN
    RAISE EXCEPTION 'Hunter stake must be at least 25 pins';
  END IF;
  IF p_closes_at <= now() THEN
    RAISE EXCEPTION 'closes_at must be in the future';
  END IF;

  INSERT INTO public.bounty_post (
    season_id, week_id, bounty_type, sponsor_player_id, title, description,
    sponsor_bounty_amount, hunter_stake_amount, house_seed_mode, closes_at, status
  ) VALUES (
    v_season_id, p_week_id, 'house_bounty', NULL, p_title, p_description,
    p_sponsor_bounty_amount, p_hunter_stake_amount, 'early_hunter_anti_dilution', p_closes_at, 'open'
  )
  RETURNING id INTO v_bounty_id;

  -- No ledger movement (design §23.4) — the promise lives on sponsor_bounty_amount.
  RETURN v_bounty_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_house_bounty(uuid, text, text, int, int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_house_bounty(uuid, text, text, int, int, timestamptz) TO authenticated;


-- ============================================================================
-- 3. enter_bounty_as_hunter — escrow + anti-dilution snapshot (§3).
-- ============================================================================
-- Serialized per bounty via FOR UPDATE so entry_number is unique and
-- protected_hunter_profit is deterministic (design §32.1).
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
  v_protected    int;
  v_stake_id     uuid;
BEGIN
  SELECT id INTO v_hunter_id FROM public.players WHERE user_id = auth.uid();
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

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

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.pin_ledger WHERE player_id = v_hunter_id AND season_id = v_bounty.season_id;
  IF v_balance < v_bounty.hunter_stake_amount THEN
    RAISE EXCEPTION 'Insufficient balance to enter this bounty';
  END IF;

  -- Order of entry + snapshotted anti-dilution profit (integer division), safe
  -- under the FOR UPDATE lock.
  SELECT COALESCE(MAX(entry_number), 0) + 1 INTO v_entry_number
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_protected := v_bounty.sponsor_bounty_amount / v_entry_number;  -- floor (integer division)

  INSERT INTO public.bounty_hunter_stakes (
    bounty_post_id, player_id, stake_amount, entry_number, protected_hunter_profit, status
  ) VALUES (
    p_bounty_post_id, v_hunter_id, v_bounty.hunter_stake_amount, v_entry_number, v_protected, 'active'
  )
  RETURNING id INTO v_stake_id;

  -- Escrow the hunter stake (player -H, house +H). Both rows carry bounty_post_id
  -- + the granular stake id (design §23.5).
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (v_hunter_id, v_bounty.season_id, v_bounty.week_id, false, -v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed', p_bounty_post_id, v_stake_id);
  INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description, bounty_post_id, bounty_hunter_stake_id)
    VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, v_bounty.hunter_stake_amount,
            'bounty_hunter_stake', 'Bounty hunter stake escrowed (house)', p_bounty_post_id, v_stake_id);

  RETURN v_stake_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enter_bounty_as_hunter(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enter_bounty_as_hunter(uuid) TO authenticated;


-- ============================================================================
-- 4. close_bounty — admin flips an open bounty to closed (§3).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.close_bounty(p_bounty_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bounty public.bounty_post;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'Only an open bounty can be closed';
  END IF;

  UPDATE public.bounty_post SET status = 'closed' WHERE id = p_bounty_post_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_bounty(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_bounty(uuid) TO authenticated;


-- ============================================================================
-- 5. settle_bounty — manual admin settlement with two outcomes (§3, §26).
-- ============================================================================
-- Idempotent: returns early if already settled. Requires the bounty to be closed
-- and to have ≥1 hunter.
CREATE OR REPLACE FUNCTION public.settle_bounty(
  p_bounty_post_id            uuid,
  p_outcome                   text,
  p_admin_settlement_reasoning text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bounty         public.bounty_post;
  v_admin_id       uuid;
  v_hunter_count   int;
  v_S              int;
  v_total_stakes   int;
  v_total_protected int;
  v_total_seed     int;
  v_total_pot      int;
  v_settlement_id  uuid;
  v_payout_id      uuid;
  v_stake          record;
  v_payout         int;
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

  -- Idempotency.
  IF v_bounty.status = 'settled' THEN
    RETURN;
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

  -- Snapshot economics (design §26).
  v_S := v_bounty.sponsor_bounty_amount;
  SELECT COALESCE(SUM(stake_amount), 0), COALESCE(SUM(protected_hunter_profit), 0)
    INTO v_total_stakes, v_total_protected
    FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id;
  v_total_seed := GREATEST(0, v_total_protected - v_S);
  v_total_pot  := v_S + v_total_stakes + v_total_seed;

  INSERT INTO public.bounty_settlements (
    bounty_post_id, settlement_outcome, settlement_source,
    total_sponsor_bounty, total_hunter_stakes, total_protected_hunter_profit,
    total_house_seed, total_pot, winner_count,
    settled_by_admin_id, admin_settlement_reasoning
  ) VALUES (
    p_bounty_post_id, p_outcome, 'admin',
    v_S, v_total_stakes, v_total_protected,
    v_total_seed, v_total_pot,
    CASE WHEN p_outcome = 'sponsor_win' THEN 1 ELSE v_hunter_count END,
    v_admin_id, p_admin_settlement_reasoning
  )
  RETURNING id INTO v_settlement_id;

  IF p_outcome = 'sponsor_win' THEN
    IF v_bounty.bounty_type = 'sponsor_bounty' THEN
      -- Sponsor takes the whole pot; all hunter stakes are lost.
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, v_bounty.sponsor_player_id, false, v_total_pot)
        RETURNING id INTO v_payout_id;

      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (v_bounty.sponsor_player_id, v_bounty.season_id, v_bounty.week_id, false, v_total_pot,
                'bounty_payout', 'Bounty sponsor won', p_bounty_post_id, v_settlement_id, v_payout_id);
      INSERT INTO public.pin_ledger (player_id, season_id, week_id, is_house, amount, type, description,
                                     bounty_post_id, bounty_settlement_id, bounty_payout_id)
        VALUES (NULL, v_bounty.season_id, v_bounty.week_id, true, -v_total_pot,
                'bounty_payout', 'Bounty sponsor won (house)', p_bounty_post_id, v_settlement_id, v_payout_id);
    ELSE
      -- House bounty: no player payout (House retains the hunter stakes, §22.3).
      -- Optional reporting-only House row; no ledger movement (House-to-House).
      INSERT INTO public.bounty_payouts (bounty_settlement_id, bounty_post_id, player_id, is_house, payout_amount)
        VALUES (v_settlement_id, p_bounty_post_id, NULL, true, v_total_pot);
    END IF;

    UPDATE public.bounty_hunter_stakes
      SET status = 'lost', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;

  ELSE  -- hunter_win
    FOR v_stake IN
      SELECT * FROM public.bounty_hunter_stakes WHERE bounty_post_id = p_bounty_post_id
    LOOP
      v_payout := v_stake.stake_amount + v_stake.protected_hunter_profit;

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

    UPDATE public.bounty_hunter_stakes
      SET status = 'won', resolved_at = now()
      WHERE bounty_post_id = p_bounty_post_id;
  END IF;

  UPDATE public.bounty_post SET status = 'settled' WHERE id = p_bounty_post_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_bounty(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_bounty(uuid, text, text) TO authenticated;


-- ============================================================================
-- 6. cancel_bounty — destructive admin rollback / hard delete (§3, §27).
-- ============================================================================
-- Makes it as if the bounty never existed. Mirror cancel_pvp_challenge: delete the
-- pin rows first (by bounty_post_id), then the root row so children + feed rows
-- cascade. No compensating refund events are written (design §27.2).
CREATE OR REPLACE FUNCTION public.cancel_bounty(p_bounty_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bounty public.bounty_post;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT * INTO v_bounty FROM public.bounty_post WHERE id = p_bounty_post_id;
  IF v_bounty.id IS NULL THEN
    RAISE EXCEPTION 'Bounty not found';
  END IF;

  -- Delete all bounty pin rows first (they are ON DELETE CASCADE against
  -- bounty_post, but deleting by bounty_post_id catches both sides of every pair
  -- regardless of the granular FK columns).
  DELETE FROM public.pin_ledger WHERE bounty_post_id = p_bounty_post_id;

  -- Delete the root; hunter_stakes, settlements, payouts, and activity_feed_events
  -- rows all cascade ON DELETE CASCADE from bounty_post.
  DELETE FROM public.bounty_post WHERE id = p_bounty_post_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_bounty(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_bounty(uuid) TO authenticated;
