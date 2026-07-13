-- Automated event-driven pushes — Market Moves → Push Broadcasts coupling.
--
-- This is the "v2 seam" push-broadcasts.md reserved: a publisher inserts a
-- broadcasts row with source='event' and scheduled_for=now(), and the existing
-- per-minute cron sweep + send-broadcasts Edge Function deliver it. The
-- publisher here is an AFTER INSERT trigger on activity_feed_events driven by
-- an admin-configured rules table keyed by event_type. Future-proofing is
-- structural: a new activity_event_catalog row automatically appears in the
-- Broadcast Admin UI (rule-less = off) and needs zero changes here.

-- ---------------------------------------------------------------------------
-- 1a. Dedicated opt-out category. Users are default-ON (absent pref row = ON);
-- the settings screen renders it automatically. Admins pick a category per
-- rule — this is just the natural default choice.
-- ---------------------------------------------------------------------------
INSERT INTO public.broadcast_categories (key, label, description, sort_order)
VALUES ('market_moves', 'Market Moves', 'Automatic alerts for big plays in the Pinsino.', 4)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1b. Event-driven broadcasts have no admin author.
-- ---------------------------------------------------------------------------
ALTER TABLE public.broadcasts ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_created_by_required
  CHECK (created_by IS NOT NULL OR source = 'event');

-- ---------------------------------------------------------------------------
-- 1c. broadcast_event_rules — one optional rule per catalog event type.
-- Admin-RLS direct writes (same posture as broadcasts INSERT). route_key is a
-- broadcastTargets.ts wire key; NULL = the push just opens the app. Unknown
-- keys are a documented silent no-op client-side, so no FK.
-- ---------------------------------------------------------------------------
CREATE TABLE public.broadcast_event_rules (
  event_type     text        NOT NULL PRIMARY KEY
                 REFERENCES public.activity_event_catalog(event_type) ON DELETE CASCADE,
  enabled        boolean     NOT NULL DEFAULT false,
  category_id    uuid        NOT NULL REFERENCES public.broadcast_categories(id),
  -- Templates render server-side at event time: {actor}/{subject}/{secondary}
  -- → players.first_name, {payload.<key>} → public_payload->>key.
  title_template text        NOT NULL CHECK (char_length(title_template) BETWEEN 1 AND 120),
  body_template  text        NOT NULL CHECK (char_length(body_template) BETWEEN 1 AND 1000),
  route_key      text        DEFAULT 'market_moves',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- (set_updated_at is auto-attached by the enforce_audit_columns event trigger.)

ALTER TABLE public.broadcast_event_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin can manage event rules" ON public.broadcast_event_rules
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- No seeded rules, deliberately: the admin UI must handle rule-less catalog
-- rows anyway (that IS the future-proofing contract), notification copy stays
-- out of migrations, and a deploy can never spam the league by default.

-- ---------------------------------------------------------------------------
-- 1d. Template renderer. Missing player → 'Someone' (requires_actor=false
-- events stay grammatical); missing payload key → ''; unrecognized token
-- shapes (e.g. {typo}) pass through verbatim — visible to the admin in the
-- delivered push, self-correcting.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.render_broadcast_event_template(
  p_template text,
  p_event public.activity_feed_events
) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
DECLARE
  v_out  text := p_template;
  v_name text;
  v_key  text;
BEGIN
  IF position('{actor}' IN v_out) > 0 THEN
    SELECT first_name INTO v_name FROM public.players WHERE id = p_event.actor_player_id;
    v_out := replace(v_out, '{actor}', COALESCE(v_name, 'Someone'));
  END IF;
  IF position('{subject}' IN v_out) > 0 THEN
    SELECT first_name INTO v_name FROM public.players WHERE id = p_event.subject_player_id;
    v_out := replace(v_out, '{subject}', COALESCE(v_name, 'Someone'));
  END IF;
  IF position('{secondary}' IN v_out) > 0 THEN
    SELECT first_name INTO v_name FROM public.players WHERE id = p_event.secondary_player_id;
    v_out := replace(v_out, '{secondary}', COALESCE(v_name, 'Someone'));
  END IF;

  FOR v_key IN
    SELECT DISTINCT m[1]
      FROM regexp_matches(v_out, '\{payload\.([a-zA-Z0-9_]+)\}', 'g') AS m
  LOOP
    v_out := replace(v_out, '{payload.' || v_key || '}',
                     COALESCE(p_event.public_payload ->> v_key, ''));
  END LOOP;

  RETURN v_out;
END;
$function$;

-- Definer-context callers only (the trigger below); nothing to grant.
REVOKE EXECUTE ON FUNCTION public.render_broadcast_event_template(text, public.activity_feed_events)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1e. The publisher trigger. AFTER INSERT only — restore_activity_event
-- (suppressed→published UPDATE) must not push a stale event late, and the
-- publisher's ON CONFLICT DO NOTHING dedup means replays never insert a row,
-- so exactly one push per real event.
--
-- Execution context: publish_activity_event is SECURITY DEFINER (owner
-- postgres), so this trigger already runs as the broadcasts table owner;
-- DEFINER here keeps the rarer direct-admin-insert path identical.
--
-- The body is wrapped in an EXCEPTION guard: a push failure must NEVER roll
-- back the economy transaction that published the event.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enqueue_broadcast_for_activity_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_rule  public.broadcast_event_rules;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.visibility <> 'public' OR NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rule
    FROM public.broadcast_event_rules
   WHERE event_type = NEW.event_type AND enabled;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_title := left(btrim(public.render_broadcast_event_template(v_rule.title_template, NEW)), 120);
    v_body  := left(btrim(public.render_broadcast_event_template(v_rule.body_template, NEW)), 1000);
    -- Satisfy the broadcasts length CHECKs even if a template renders empty.
    v_title := COALESCE(NULLIF(v_title, ''), 'Market Moves');
    v_body  := COALESCE(NULLIF(v_body, ''), 'Something just happened in the Pinsino.');

    INSERT INTO public.broadcasts (category_id, title, body, target_player_ids, data, source, scheduled_for)
    VALUES (
      v_rule.category_id,
      v_title,
      v_body,
      NULL,
      -- event_type + activity_event_id are the audit thread back to the feed
      -- row (and what suppress_activity_event uses to cancel a pending push).
      (CASE WHEN v_rule.route_key IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('route', v_rule.route_key) END)
        || jsonb_build_object('event_type', NEW.event_type, 'activity_event_id', NEW.id),
      'event',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_broadcast_for_activity_event: event % (%) not pushed: %',
      NEW.id, NEW.event_type, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER enqueue_event_broadcast
  AFTER INSERT ON public.activity_feed_events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_broadcast_for_activity_event();

-- ---------------------------------------------------------------------------
-- 1f. Suppressing a feed event also cancels its still-pending push (an admin
-- acting within the ≤60s pre-sweep window stops the notification too; after
-- the sweep it is sent — accepted v1 limitation). Body copied from the live
-- definition + the broadcasts UPDATE appended.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suppress_activity_event(p_event_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT id INTO v_admin_id FROM public.players WHERE user_id = auth.uid();

  UPDATE public.activity_feed_events
    SET status = 'suppressed',
        suppressed_by_admin_id = v_admin_id,
        suppressed_at = now(),
        suppression_reason = p_reason
    WHERE id = p_event_id;

  -- Cancel the coupled push if it hasn't been claimed by the sweep yet.
  UPDATE public.broadcasts
     SET status = 'canceled'
   WHERE source = 'event'
     AND status = 'pending'
     AND data ->> 'activity_event_id' = p_event_id::text;
END;
$function$;
