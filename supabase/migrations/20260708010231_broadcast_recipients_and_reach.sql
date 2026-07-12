-- Push Broadcasts M2 — recipient resolution + the admin reach preview.
--
-- broadcast_recipients is THE opt-out predicate, factored into one place so
-- the composer's reach preview and the Edge Function's actual send can never
-- disagree. A player is reachable for a category iff:
--   • they are active and have at least one registered device token,
--   • no push_preferences row says master_enabled = false (absent row = ON),
--   • no push_category_prefs row for the category says enabled = false, and
--   • when targets are given, they are in the target list.
-- Opt-out ALWAYS wins — targeted sends pass through the same predicate.

-- Returns (player_id, token) pairs — tokens included, so NO grants: only the
-- service role (Edge Function) and the definer reach RPC below may call it.
CREATE FUNCTION public.broadcast_recipients(p_category_id uuid, p_target_player_ids uuid[] DEFAULT NULL)
RETURNS TABLE (player_id uuid, expo_push_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT t.player_id, t.expo_push_token
    FROM public.push_tokens t
    JOIN public.players pl ON pl.id = t.player_id
   WHERE pl.is_active
     AND (p_target_player_ids IS NULL OR t.player_id = ANY (p_target_player_ids))
     AND NOT EXISTS (
       SELECT 1 FROM public.push_preferences pp
        WHERE pp.player_id = t.player_id AND pp.master_enabled = false
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.push_category_prefs cp
        WHERE cp.player_id = t.player_id
          AND cp.category_id = p_category_id
          AND cp.enabled = false
     );
$function$;

REVOKE ALL ON FUNCTION public.broadcast_recipients(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- The composer's pre-send reach line ("4 targeted · 3 reachable"). Counts
-- only — tokens never leave the DB. Admin-gated.
CREATE FUNCTION public.broadcast_reach(p_category_id uuid, p_target_player_ids uuid[] DEFAULT NULL)
RETURNS TABLE (targeted integer, reachable integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();
  RETURN QUERY
    SELECT
      CASE WHEN p_target_player_ids IS NULL
           THEN (SELECT count(*) FROM public.players WHERE is_active)::integer
           ELSE cardinality(p_target_player_ids) END,
      (SELECT count(DISTINCT r.player_id)
         FROM public.broadcast_recipients(p_category_id, p_target_player_ids) r)::integer;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.broadcast_reach(uuid, uuid[]) TO authenticated;
