-- Admin-guard negative probe (see context/db-verification.md).
--
-- Calls every admin-gated RPC under PLAYER claims and asserts each one rejects
-- with exactly 'Admin only' — the guard must fire before any validation, so
-- dummy uuids suffice. Catches a future RPC that loses its guard, and any
-- drift in the canonical error text. Always aborts via the final RAISE.
DO $$
DECLARE
  v_stmt text;
  v_failures text[] := '{}';
  v_calls constant text[] := ARRAY[
    'public.process_weekly_loans(gen_random_uuid())',
    'public.settle_loans_for_season_close(gen_random_uuid())',
    'public.cancel_loan(gen_random_uuid())',
    'public.settle_betting_for_week(gen_random_uuid(), false)',
    'public.settle_market(gen_random_uuid(), 1)',
    'public.settle_moneyline_market(gen_random_uuid())',
    'public.settle_lanetalk_props_for_week(gen_random_uuid(), false)',
    'public.void_pvp_challenge(gen_random_uuid(), ''x'')',
    'public.settle_pvp_challenge(gen_random_uuid(), ''admin'', NULL, NULL)',
    'public.settle_pvp_for_week(gen_random_uuid())',
    'public.close_open_pvp_challenges(gen_random_uuid(), NULL)',
    'public.settle_bounty(gen_random_uuid(), ''hunter_win'', ''x'')',
    'public.create_house_bounty(NULL, ''t'', ''d'', 25, 25, 1, now() + interval ''1 hour'')',
    'public.cancel_bounty(gen_random_uuid())',
    'public.close_bounty(gen_random_uuid())',
    'public.archive_week(gen_random_uuid(), false)',
    'public.unarchive_week(gen_random_uuid(), false)',
    'public.suppress_activity_event(gen_random_uuid(), ''x'')',
    'public.restore_activity_event(gen_random_uuid())',
    'public.create_system_activity_event(''system'', ''x'', ''y'', ''{}'')'
  ];
BEGIN
  -- player claims: every call below must bounce off the admin guard
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                      'app_metadata', json_build_object('role', 'player'))::text, true);

  FOREACH v_stmt IN ARRAY v_calls LOOP
    BEGIN
      EXECUTE 'SELECT ' || v_stmt;
      v_failures := v_failures || (v_stmt || ' → no exception');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Admin only' THEN
        v_failures := v_failures || (v_stmt || ' → ' || SQLERRM);
      END IF;
    END;
  END LOOP;

  IF array_length(v_failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE_FAIL: % guard violations: %',
      array_length(v_failures, 1), array_to_string(v_failures, ' | ');
  END IF;

  RAISE EXCEPTION 'PROBE_RESULT %',
    jsonb_build_object('guarded_rpcs_tested', array_length(v_calls, 1), 'all_rejected', true);
END $$;
