-- Anon lockdown (TODO_DB_SECURITY §1, confirmed directive 2026-06-11).
--
-- The app's only pre-login DB call is rpc('is_registered_player', …); the
-- function is SECURITY DEFINER and needs no table access. Everything else anon
-- could do — SELECT on 17 economy tables, EXECUTE on every public function —
-- is surface area with no consumer. After this migration anon's sole
-- capability is invoking is_registered_player(text).
--
-- Defense in depth: beyond dropping today's policies, we revoke anon's
-- table/sequence/function privileges (current AND default-for-future), so a
-- stray future "TO anon" policy is inert — RLS only filters what GRANTs allow,
-- it never grants by itself. A posture assertion in
-- refresh-schema-snapshot.sh fails the push ritual if anon ever regains
-- anything beyond the allowlist.

-- 1. Drop every anon SELECT policy.
DROP POLICY "anon can read" ON public.bet_legs;
DROP POLICY "anon can read" ON public.bet_markets;
DROP POLICY "anon can read" ON public.bet_selections;
DROP POLICY "anon can read" ON public.bets;
DROP POLICY "anon can read" ON public.bounty_hunter_stakes;
DROP POLICY "anon can read" ON public.bounty_payouts;
DROP POLICY "anon can read" ON public.bounty_post;
DROP POLICY "anon can read" ON public.bounty_settlements;
DROP POLICY "anon can read" ON public.custom_lines;
DROP POLICY "anon can read" ON public.loan_ledger;
DROP POLICY "anon can read" ON public.loan_products;
DROP POLICY "anon can read" ON public.loans;
DROP POLICY "anon can read" ON public.pin_ledger;
DROP POLICY "anon can read" ON public.pvp_challenge_offers;
DROP POLICY "anon can read" ON public.pvp_challenges;
DROP POLICY "anon can read" ON public.pvp_ledger;
DROP POLICY "anon can read public published" ON public.activity_feed_events;

-- 2. Revoke anon's table and sequence privileges — existing objects and the
-- Supabase default grants that would cover future ones. With no GRANT, an
-- anon-targeted policy can never re-open reads on its own.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 3. Revoke anon EXECUTE on every public function. Postgres grants EXECUTE to
-- PUBLIC by default, so anon can currently *call* place_house_bet, take_loan,
-- etc. (they only fail because no player resolves from auth.uid()). Make the
-- boundary structural. Trigger/hook functions are unaffected — they never run
-- under anon (custom_access_token runs as supabase_auth_admin).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f.sig);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- 4. Keep the single allowlisted anon entry point.
GRANT EXECUTE ON FUNCTION public.is_registered_player(text) TO anon;
