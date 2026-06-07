-- ============================================================================
-- Activity Feed — publish_activity_event(...) internal writer (§2).
-- ============================================================================
-- The single validated write path into activity_feed_events (§3.6, §13.1). It is
-- INTERNAL: EXECUTE is revoked from everyone and granted to nobody — it is only
-- invoked via PERFORM from the other SECURITY DEFINER economic RPCs (which run as
-- the definer and so can call it). No feature inserts feed rows directly.
--
-- The event catalog (§2.2, design §7) is encoded as a CASE block below: per
-- event_type it defines default_importance, default_visibility, requires_actor,
-- allowed_source_fk, and the canonical template_key. Validation rejects unknown
-- features/events, source-FK ↔ feature mismatches (§5.4), missing required
-- actors, and template_key drift.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_activity_event(
  p_source_feature      text,
  p_event_type          text,
  p_season_id           uuid,
  p_week_id             uuid,
  p_actor_player_id     uuid,
  p_subject_player_id   uuid,
  p_secondary_player_id uuid,
  p_sportsbook_bet_id   uuid,
  p_loan_id             uuid,
  p_template_key        text,
  p_public_payload      jsonb,
  p_admin_payload       jsonb,
  p_importance          text,        -- NULL → catalog default
  p_visibility          text,        -- NULL → catalog default
  p_occurred_at         timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_def_importance text;
  v_def_visibility text;
  v_requires_actor boolean;
  v_allowed_fk     text;   -- 'sportsbook_bet_id' | 'loan_id' | 'none'
  v_template       text;
  v_importance     text;
  v_visibility     text;
  v_id             uuid;
BEGIN
  -- 1. Validate source_feature.
  IF p_source_feature NOT IN ('sportsbook','loan_shark','system','admin') THEN
    RAISE EXCEPTION 'Unknown source_feature: %', p_source_feature;
  END IF;

  -- 2. Event catalog lookup (§2.2). RAISE on unknown event_type.
  CASE p_event_type
    WHEN 'sportsbook_bet_placed' THEN
      v_def_importance := 'low';       v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.bet_placed';
    WHEN 'sportsbook_parlay_placed' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_placed';
    WHEN 'sportsbook_big_ticket_placed' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_ticket_placed';
    WHEN 'sportsbook_big_win' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.big_win';
    WHEN 'sportsbook_parlay_hit' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'sportsbook_bet_id'; v_template := 'sportsbook.parlay_hit';
    WHEN 'sportsbook_weekly_house_result' THEN
      v_def_importance := 'major';     v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'sportsbook.weekly_house_result';
    WHEN 'loan_shark_loan_taken' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_taken';
    WHEN 'loan_shark_loan_repaid' THEN
      v_def_importance := 'highlight'; v_def_visibility := 'public'; v_requires_actor := true;
      v_allowed_fk := 'loan_id';           v_template := 'loan_shark.loan_repaid';
    WHEN 'loan_shark_special_offer' THEN
      v_def_importance := 'normal';    v_def_visibility := 'public'; v_requires_actor := false;
      v_allowed_fk := 'none';              v_template := 'loan_shark.special_offer';
    ELSE
      RAISE EXCEPTION 'Unknown event_type: %', p_event_type;
  END CASE;

  -- 3. Source-FK ↔ feature consistency (§5.4). The catalog's allowed_source_fk
  --    must match exactly which FK arg is non-NULL.
  IF v_allowed_fk = 'sportsbook_bet_id' THEN
    IF p_sportsbook_bet_id IS NULL OR p_loan_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires sportsbook_bet_id and forbids loan_id', p_event_type;
    END IF;
  ELSIF v_allowed_fk = 'loan_id' THEN
    IF p_loan_id IS NULL OR p_sportsbook_bet_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % requires loan_id and forbids sportsbook_bet_id', p_event_type;
    END IF;
  ELSE  -- 'none' → no source FK permitted
    IF p_sportsbook_bet_id IS NOT NULL OR p_loan_id IS NOT NULL THEN
      RAISE EXCEPTION 'Event % must not carry a source FK', p_event_type;
    END IF;
  END IF;

  -- 4. Actor requirement.
  IF v_requires_actor AND p_actor_player_id IS NULL THEN
    RAISE EXCEPTION 'Event % requires an actor_player_id', p_event_type;
  END IF;

  -- 5. template_key must match the catalog (keeps copy controlled, §3.7).
  IF p_template_key IS DISTINCT FROM v_template THEN
    RAISE EXCEPTION 'template_key % does not match catalog template % for event %',
      p_template_key, v_template, p_event_type;
  END IF;

  -- 6. Apply catalog defaults.
  v_importance := COALESCE(p_importance, v_def_importance);
  v_visibility := COALESCE(p_visibility, v_def_visibility);

  -- 7. Insert (idempotent via the partial unique dedup indexes).
  INSERT INTO public.activity_feed_events (
    season_id, week_id, source_feature, event_type,
    actor_player_id, subject_player_id, secondary_player_id,
    sportsbook_bet_id, loan_id,
    visibility, importance, status,
    template_key, public_payload, admin_payload, occurred_at
  ) VALUES (
    p_season_id, p_week_id, p_source_feature, p_event_type,
    p_actor_player_id, p_subject_player_id, p_secondary_player_id,
    p_sportsbook_bet_id, p_loan_id,
    v_visibility, v_importance, 'published',
    v_template, COALESCE(p_public_payload, '{}'::jsonb), COALESCE(p_admin_payload, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  -- Conflict skipped the insert → idempotent no-op; caller ignores the NULL.
  RETURN v_id;
END;
$$;

-- Internal only: no client (anon/authenticated) may call it directly.
REVOKE EXECUTE ON FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
