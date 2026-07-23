-- Retire team-anchored market GENERATION (team_prop + moneyline). Combo lines
-- (player-composed member-set aggregates) replaced team props; moneyline goes
-- with them (no replacement — PvP covers head-to-head; accepted gap).
--
-- Retirement means: stop creating, keep settling. Everything needed to settle
-- open team/moneyline bets at cutover and to unarchive/resettle HISTORICAL
-- weeks stays: the market_type CHECK values, the settle_week (c)/(c')/(c'')
-- branches, settle_moneyline_market[_internal], team_prop_seed_line, the
-- prevent_self_tank team branch, and the app's status toggles.
--
--   1. resync_week_markets: drop the team_prop PERFORM + the moneyline branch
--      body. The p_moneyline parameter SURVIVES (four statement-trigger fns
--      pass it) but is now inert.
--   2. sync_team_prop_markets_for_week: DROPPED (server-trigger-only — no
--      client ever called it directly).
--   3. sync_moneyline_markets_for_week: NO-OP STUB, not dropped — deployed app
--      builds still call it from team generation / add-game / playoff
--      materialization; a missing RPC would error those flows. Drop it in a
--      later cleanup once every client is past the retirement build.
--   4. Cutover hygiene: delete BETLESS open/closed team_prop + moneyline
--      markets on unarchived weeks (the refund trigger no-ops on betless
--      markets, so no money moves). Night team_props have no games FK and
--      their prune just died with the sync — this closes that orphan window.
--      Bet-carrying markets stay and settle normally.

-- 1. The fan-out, minus team-anchored generation.
CREATE OR REPLACE FUNCTION public.resync_week_markets(p_week_id uuid, p_moneyline boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_week_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = p_week_id AND w.is_archived = false) THEN
    RETURN;
  END IF;
  PERFORM public.sync_over_under_markets_for_week(p_week_id);
  PERFORM public.sync_lanetalk_prop_markets_for_week(p_week_id);
  PERFORM public.sync_combo_markets_for_week(p_week_id);
  -- team_prop + moneyline generation retired (combos replaced them);
  -- p_moneyline is kept in the signature for the games trigger but is inert.
END;
$function$;

-- 2. Team-prop sync: gone (nothing calls it now).
DROP FUNCTION IF EXISTS public.sync_team_prop_markets_for_week(uuid);

-- 3. Moneyline sync: inert stub for deployed clients.
CREATE OR REPLACE FUNCTION public.sync_moneyline_markets_for_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Retired: moneyline markets are no longer generated. Kept as a no-op so
  -- app builds that still call it (team gen / add game / playoffs) don't
  -- error. Safe to DROP once every client is past the combo-lines release.
  NULL;
END;
$function$;

-- 4. Cutover hygiene: clear the board of betless team-anchored markets on
--    live (unarchived) weeks. Bet-carrying ones ride to settlement.
DELETE FROM public.bet_markets m
 WHERE m.market_type IN ('team_prop', 'moneyline')
   AND m.status IN ('open', 'closed')
   AND EXISTS (SELECT 1 FROM public.weeks w WHERE w.id = m.week_id AND w.is_archived = false)
   AND NOT EXISTS (
     SELECT 1 FROM public.bet_legs l
     JOIN public.bet_selections s ON s.id = l.selection_id
     WHERE s.market_id = m.id);
