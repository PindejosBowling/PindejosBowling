-- Rollback-probe for the loans flow (CONSOLIDATION §2 batch B verification).
--
-- Impersonates a linked player, runs take_loan → repay_loan(partial) →
-- repay_loan(full payoff), then captures every row the flow wrote — fully
-- normalized (volatile uuids reduced to presence booleans) — and RAISES with
-- the capture as the message. The exception aborts the transaction, so the
-- probe NEVER persists anything (there is no COMMIT path). Run before and
-- after the batch-B rewrite; the two captures must be identical.
--
-- Inputs (live data, re-check before reuse):
--   player  c985c0ad-5fd1-407b-bbd8-fe62d7d0e127 (user c811c7df-…, no active loan)
--   product f341fa95-e54c-4385-a913-0a276accdd74 (Minnow Loan, borrow 250)
DO $$
DECLARE
  v_loan_id uuid;
  v_result  jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"player"}}',
    true);

  SELECT public.take_loan('f341fa95-e54c-4385-a913-0a276accdd74') INTO v_loan_id;
  PERFORM public.repay_loan(v_loan_id, 100);
  PERFORM public.repay_loan(v_loan_id, 150);

  -- Admin leg: a fresh loan, then the weekly tick (garnish/interest) and the
  -- season-close sweep over it. Claims switch to admin mid-transaction.
  SELECT public.take_loan('f341fa95-e54c-4385-a913-0a276accdd74') INTO v_loan_id;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c811c7df-be32-418a-b992-76c819148437","role":"authenticated","app_metadata":{"role":"admin"}}',
    true);
  PERFORM public.process_weekly_loans(
    (SELECT id FROM public.weeks
     WHERE season_id = 'fe73b724-97fd-4e7b-9507-09e6c6120c42' AND is_archived = false
     ORDER BY week_number DESC LIMIT 1));
  PERFORM public.settle_loans_for_season_close('fe73b724-97fd-4e7b-9507-09e6c6120c42');

  SELECT jsonb_build_object(
    'pin_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', player_id, 'season_id', season_id, 'week_id', week_id,
        'is_house', is_house, 'amount', amount, 'type', type,
        'description', description,
        'linked_to_loan_ledger', loan_ledger_id IS NOT NULL,
        'other_refs', (bet_id IS NOT NULL OR pvp_ledger_id IS NOT NULL OR bounty_post_id IS NOT NULL))
        ORDER BY type, is_house, amount)
      FROM public.pin_ledger WHERE created_at = now()),
    'loan_ledger', (
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', player_id, 'season_id', season_id, 'week_id', week_id,
        'amount', amount, 'type', type, 'description', description,
        'pin_ledger_linked', pin_ledger_id IS NOT NULL)
        ORDER BY type, amount)
      FROM public.loan_ledger WHERE created_at = now()),
    'backlink_integrity', (
      -- every pin row of this tx that claims a loan_ledger link points at a
      -- loan_ledger row of this tx, and each loan_ledger row is pointed at by
      -- exactly one player row + one house row
      SELECT jsonb_agg(jsonb_build_object('loan_ledger_type', ll.type, 'pin_rows', c.cnt) ORDER BY ll.type)
      FROM public.loan_ledger ll
      JOIN LATERAL (SELECT count(*) AS cnt FROM public.pin_ledger pl
                    WHERE pl.loan_ledger_id = ll.id AND pl.created_at = now()) c ON true
      WHERE ll.created_at = now()),
    'loan_status', (
      SELECT jsonb_agg(jsonb_build_object('status', status, 'paid_off', paid_off_at IS NOT NULL))
      FROM public.loans WHERE created_at = now()),
    'events', (
      SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'public_payload', public_payload) ORDER BY event_type)
      FROM public.activity_feed_events WHERE created_at = now())
  ) INTO v_result;

  RAISE EXCEPTION 'PROBE_RESULT %', v_result;
END $$;
