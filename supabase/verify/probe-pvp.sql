-- Rollback-probe for the PvP flow (CONSOLIDATION §2 batch C verification).
--
-- Two custom-contract lifecycles:
--   #1 create → accept (escrow ×2) → admin settle w/ winner (payout) → void
--      (settled path: payout reversal + stake refunds)
--   #2 create → accept → void (locked path: stake refunds only)
-- Captures all rows written, normalized; raises to abort — nothing persists.
--
-- Inputs (live data, re-check before reuse):
--   player1 c985c0ad… (user c811c7df…), player2 3bf2c262… (user fef642dc…),
--   week b78cfe24… (current non-archived), stakes 50/50.
DO $$
DECLARE
  v_ch1 uuid;
  v_ch2 uuid;
  v_result jsonb;
BEGIN
  -- #1: player1 creates, player2 accepts, admin settles + voids.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"player"}}', true);
  SELECT public.create_pvp_challenge('custom', '3bf2c262-2524-4c7b-b5cb-d6e73c0d0689',
    'b78cfe24-f931-45d1-81ab-65fad9c7135d', NULL, 50, 50, NULL, NULL,
    'probe', 'Probe duel', 'probe description', NULL, NULL) INTO v_ch1;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"fef642dc-49ad-445c-b2ad-a2a6b8108283","role":"authenticated","app_metadata":{"role":"player"}}', true);
  PERFORM public.accept_pvp_challenge(v_ch1);

  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.settle_pvp_challenge(v_ch1, 'admin', 'c985c0ad-5fd1-407b-bbd8-fe62d7d0e127', 'probe settle');
  PERFORM public.void_pvp_challenge(v_ch1, 'probe void after settle');

  -- #2: locked → void.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"player"}}', true);
  SELECT public.create_pvp_challenge('custom', '3bf2c262-2524-4c7b-b5cb-d6e73c0d0689',
    'b78cfe24-f931-45d1-81ab-65fad9c7135d', NULL, 50, 50, NULL, NULL,
    'probe', 'Probe duel 2', 'probe description', NULL, NULL) INTO v_ch2;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"fef642dc-49ad-445c-b2ad-a2a6b8108283","role":"authenticated","app_metadata":{"role":"player"}}', true);
  PERFORM public.accept_pvp_challenge(v_ch2);

  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.void_pvp_challenge(v_ch2, 'probe void from locked');

  SELECT jsonb_build_object(
    'pin_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', player_id, 'season_id', season_id, 'week_id', week_id,
        'is_house', is_house, 'amount', amount, 'type', type,
        'description', description,
        'linked_to_pvp_ledger', pvp_ledger_id IS NOT NULL,
        'other_refs', (bet_id IS NOT NULL OR loan_ledger_id IS NOT NULL OR bounty_post_id IS NOT NULL))
        ORDER BY type, description, is_house, amount, player_id)
      FROM public.pin_ledger WHERE created_at = now()),
    'pvp_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', player_id, 'amount', amount, 'type', type,
        'description', description, 'pin_ledger_linked', pin_ledger_id IS NOT NULL)
        ORDER BY type, description, amount, player_id)
      FROM public.pvp_ledger WHERE created_at = now()),
    'backlink_integrity', (
      SELECT jsonb_agg(jsonb_build_object('pvp_type', pl.type, 'pvp_desc', pl.description, 'pin_rows', c.cnt)
                       ORDER BY pl.type, pl.description, pl.amount)
      FROM public.pvp_ledger pl
      JOIN LATERAL (SELECT count(*) AS cnt FROM public.pin_ledger x
                    WHERE x.pvp_ledger_id = pl.id AND x.created_at = now()) c ON true
      WHERE pl.created_at = now()),
    'challenge_status', (
      SELECT jsonb_agg(jsonb_build_object(
        'status', status, 'winner_set', winner_player_id IS NOT NULL,
        'pot', total_pot, 'admin_note', admin_note) ORDER BY admin_note)
      FROM public.pvp_challenges WHERE created_at = now()),
    'events', (
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'public_payload', public_payload)
                       ORDER BY event_type, public_payload::text)
      FROM public.activity_feed_events WHERE created_at = now())
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
