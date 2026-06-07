-- ============================================================================
-- Activity Feed — admin RPCs (§6, design §18).
-- ============================================================================
-- suppress / restore a feed row, and post a sourceless system/admin event. All
-- admin-gated, SECURITY DEFINER, pinned search_path. EXECUTE revoked from PUBLIC +
-- anon and granted to authenticated (the body re-checks the admin role).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- suppress_activity_event — hide a row from the public read policy (§14.2, §18.1).
-- Does NOT touch the source action.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suppress_activity_event(p_event_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_admin_id uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();

  UPDATE public.activity_feed_events
    SET status = 'suppressed',
        suppressed_by_admin_id = v_admin_id,
        suppressed_at = now(),
        suppression_reason = p_reason
    WHERE id = p_event_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- restore_activity_event — un-suppress (§14.3). Only meaningful while the source
-- row still exists (a cancelled source already cascade-deleted the feed row).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_activity_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.activity_feed_events
    SET status = 'published',
        suppressed_by_admin_id = NULL,
        suppressed_at = NULL,
        suppression_reason = NULL
    WHERE id = p_event_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- create_system_activity_event — admin wrapper over the writer for aggregate /
-- announcement events with NO source FK (§19.1). v1 use: loan_shark_special_offer
-- (§11.3) and generic admin posts. Resolves the current season + latest live week;
-- the writer rejects any event_type that requires a source FK.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_system_activity_event(
  p_source_feature text,
  p_event_type     text,
  p_template_key   text,
  p_public_payload jsonb,
  p_importance     text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_season_id uuid;
  v_week_id   uuid;
BEGIN
  IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  SELECT id INTO v_season_id
    FROM public.seasons
    WHERE is_active = true AND registration_open = false;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  -- Week is optional — latest non-archived week of the current season.
  SELECT id INTO v_week_id
    FROM public.weeks WHERE season_id = v_season_id AND is_archived = false
    ORDER BY week_number DESC LIMIT 1;

  RETURN public.publish_activity_event(
    p_source_feature, p_event_type,
    v_season_id, v_week_id, NULL, NULL, NULL, NULL, NULL,
    p_template_key, p_public_payload, '{}'::jsonb,
    p_importance, 'public', now());
END;
$function$;

-- ----------------------------------------------------------------------------
-- Grants — authenticated only (body re-checks admin); never anon/public.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.suppress_activity_event(uuid, text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_activity_event(uuid)                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_system_activity_event(text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.suppress_activity_event(uuid, text)            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_activity_event(uuid)                   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.create_system_activity_event(text, text, text, jsonb, text) TO authenticated;
