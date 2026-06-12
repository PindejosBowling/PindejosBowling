-- pin_ledger_double_entry() — kill the five-row dance (TODO_DB_CONSOLIDATION §2).
--
-- The pattern "insert player pin row → insert house mirror row" is hand-written
-- in ~10 RPCs. This helper makes the "every movement nets to zero" invariant
-- structural: one call inserts the player row (p_amount, signed) and the house
-- mirror (-p_amount) and returns both ids. Callers that maintain a domain
-- ledger (loan_ledger / pvp_ledger) insert their domain row referencing
-- player_entry_id, then back-link both pin rows in one UPDATE — exactly as
-- they do today.
--
-- Adoption lands in three reviewable batches (loans → pvp → bets/bounty);
-- this migration is additive only.

CREATE FUNCTION public.pin_ledger_double_entry(
  p_player_id uuid,
  p_season_id uuid,
  p_week_id uuid,
  p_amount integer,                       -- PLAYER-side signed amount; house mirrors -p_amount
  p_type text,
  p_description text,
  p_house_description text DEFAULT NULL,  -- default: p_description || ' (house)'
  p_bet_id uuid DEFAULT NULL,
  p_bounty_post_id uuid DEFAULT NULL
) RETURNS TABLE (player_entry_id uuid, house_entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_player uuid;
  v_house  uuid;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'pin_ledger_double_entry: player_id is required';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'pin_ledger_double_entry: amount must be non-zero';
  END IF;

  INSERT INTO public.pin_ledger
      (player_id, season_id, week_id, is_house, amount, type, description, bet_id, bounty_post_id)
    VALUES
      (p_player_id, p_season_id, p_week_id, false, p_amount, p_type, p_description, p_bet_id, p_bounty_post_id)
    RETURNING id INTO v_player;

  INSERT INTO public.pin_ledger
      (player_id, season_id, week_id, is_house, amount, type, description, bet_id, bounty_post_id)
    VALUES
      (NULL, p_season_id, p_week_id, true, -p_amount, p_type,
       COALESCE(p_house_description, p_description || ' (house)'), p_bet_id, p_bounty_post_id)
    RETURNING id INTO v_house;

  RETURN QUERY SELECT v_player, v_house;
END;
$$;

-- Internal accounting primitive: callable only by the SECURITY DEFINER RPCs
-- (they run as owner), never by clients.
REVOKE EXECUTE ON FUNCTION public.pin_ledger_double_entry(uuid, uuid, uuid, integer, text, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
