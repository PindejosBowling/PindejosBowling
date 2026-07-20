-- Recurring Broadcast Schedules — admin-defined weekly push slots.
-- Each slot fires once per week at (day_of_week, send_time) in its timezone;
-- a SQL materializer (called from the existing per-minute broadcast tick)
-- resolves the slot's audience at fire time and inserts a normal `broadcasts`
-- row, which the existing sweep delivers. Zero Edge Function changes.
--
-- v1 audiences:
--   rsvp_non_responders — active players with no rsvp row for the current week
--                         (skips silently when no current week or everyone answered)
--   everyone            — whole category (target_player_ids NULL)
-- Adding a future audience = extend the CHECK + add a branch in
-- materialize_due_recurring_broadcasts().

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE public.recurring_broadcast_schedules (
  id            uuid        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  audience      text        NOT NULL CHECK (audience IN ('rsvp_non_responders', 'everyone')),
  -- 0=Sunday..6=Saturday — matches EXTRACT(DOW) and JS Date.getDay().
  day_of_week   smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  send_time     time        NOT NULL,
  timezone      text        NOT NULL DEFAULT 'America/New_York',
  category_id   uuid        NOT NULL REFERENCES public.broadcast_categories(id),
  -- A broadcastTargets.ts wire key (not FK'd — unknown keys are a client no-op).
  route_key     text,
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  enabled       boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  -- DEFAULT now() = only occurrences after creation fire.
  last_fired_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- (set_updated_at is auto-attached by the enforce_audit_columns event trigger.)

ALTER TABLE public.recurring_broadcast_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage recurring schedules"
  ON public.recurring_broadcast_schedules
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ── Edit-reset: rescheduling or re-enabling never fires a stale occurrence ─

CREATE FUNCTION public.reset_recurring_schedule_last_fired()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
     OR NEW.send_time IS DISTINCT FROM OLD.send_time
     OR NEW.timezone  IS DISTINCT FROM OLD.timezone
     OR (NEW.enabled AND NOT OLD.enabled) THEN
    NEW.last_fired_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reset_recurring_last_fired
  BEFORE UPDATE ON public.recurring_broadcast_schedules
  FOR EACH ROW EXECUTE FUNCTION public.reset_recurring_schedule_last_fired();

-- ── broadcasts: admit the new source (created_by stays NULL for it) ────────

ALTER TABLE public.broadcasts DROP CONSTRAINT broadcasts_source_check;
ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_source_check
  CHECK (source = ANY (ARRAY['admin'::text, 'event'::text, 'recurring'::text]));

ALTER TABLE public.broadcasts DROP CONSTRAINT broadcasts_created_by_required;
ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_created_by_required
  CHECK (created_by IS NOT NULL OR source IN ('event', 'recurring'));

-- ── The materializer — turns due slots into pending broadcasts rows ────────

CREATE FUNCTION public.materialize_due_recurring_broadcasts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  s           record;
  v_local_now timestamp;   -- wall clock in the slot's timezone
  v_occ_local timestamp;   -- this week's occurrence, local wall clock
  v_due       timestamptz; -- same instant, absolute
  v_days_back int;
  v_week_id   uuid;
  v_targets   uuid[];
  v_data      jsonb;
BEGIN
  FOR s IN SELECT * FROM public.recurring_broadcast_schedules WHERE enabled LOOP
    BEGIN
      -- Most recent occurrence of (day_of_week, send_time) at or before now,
      -- computed in local wall-clock space (DST-safe), converted once.
      v_local_now := now() AT TIME ZONE s.timezone;
      v_days_back := ((EXTRACT(DOW FROM v_local_now)::int - s.day_of_week) + 7) % 7;
      v_occ_local := (v_local_now::date - v_days_back) + s.send_time;
      IF v_occ_local > v_local_now THEN
        v_occ_local := v_occ_local - interval '7 days';
      END IF;
      v_due := v_occ_local AT TIME ZONE s.timezone;

      -- Each occurrence fires at most once (last_fired_at only moves forward).
      IF v_due <= s.last_fired_at THEN
        CONTINUE;
      END IF;

      -- Consume the occurrence before any skip: a skipped one never fires late.
      UPDATE public.recurring_broadcast_schedules
         SET last_fired_at = now()
       WHERE id = s.id;

      -- Lateness cap: downtime must never cause a middle-of-the-night nag.
      IF now() - v_due > interval '2 hours' THEN
        CONTINUE;
      END IF;

      v_data := jsonb_build_object('recurring_schedule_id', s.id);
      IF s.route_key IS NOT NULL THEN
        v_data := v_data || jsonb_build_object('route', s.route_key);
      END IF;

      IF s.audience = 'rsvp_non_responders' THEN
        -- Current week: latest unarchived week of the active, registration-closed
        -- season (same rule as weeks.getCurrent() / submit_own_rsvp).
        SELECT w.id INTO v_week_id
          FROM public.weeks w
          JOIN public.seasons se ON se.id = w.season_id
         WHERE se.is_active AND NOT se.registration_open AND NOT w.is_archived
         ORDER BY w.week_number DESC
         LIMIT 1;
        IF v_week_id IS NULL THEN
          CONTINUE;  -- offseason / registration / unarchive window
        END IF;

        SELECT array_agg(p.id) INTO v_targets
          FROM public.players p
         WHERE p.is_active
           AND NOT EXISTS (
             SELECT 1 FROM public.rsvp r
              WHERE r.week_id = v_week_id AND r.player_id = p.id
           );
        IF v_targets IS NULL THEN
          CONTINUE;  -- everyone has responded
        END IF;

        v_data := v_data || jsonb_build_object('week_id', v_week_id);
      ELSIF s.audience = 'everyone' THEN
        v_targets := NULL;  -- whole category (broadcast_recipients semantics)
      ELSE
        RAISE WARNING 'materialize_due_recurring_broadcasts: slot % has unknown audience %', s.id, s.audience;
        CONTINUE;
      END IF;

      INSERT INTO public.broadcasts
        (category_id, title, body, target_player_ids, data, source, scheduled_for)
      VALUES
        (s.category_id, s.title, s.body, v_targets, v_data, 'recurring', now());
    EXCEPTION WHEN OTHERS THEN
      -- Per-slot isolation (also contains an invalid timezone value).
      RAISE WARNING 'materialize_due_recurring_broadcasts: slot % skipped: %', s.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_due_recurring_broadcasts() FROM PUBLIC, anon, authenticated;

-- ── Wire into the per-minute tick, before the due-probe, so a freshly
--    materialized row is dispatched in the same tick ────────────────────────

CREATE OR REPLACE FUNCTION public.invoke_broadcast_sender()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Materialize due recurring slots first; a failure here can never block
  -- normal broadcast sending.
  BEGIN
    PERFORM public.materialize_due_recurring_broadcasts();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'invoke_broadcast_sender: recurring materialization failed: %', SQLERRM;
  END;

  -- Anything to do? Due pending sends, stale 'sending' reclaims, or receipts
  -- old enough to resolve (the Edge Function owns the exact cutoffs; these
  -- probes just avoid pointless invokes).
  IF NOT EXISTS (
       SELECT 1 FROM public.broadcasts
        WHERE (status = 'pending' AND scheduled_for <= now())
           OR (status = 'sending' AND claimed_at < now() - interval '10 minutes')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.broadcast_push_tickets
        WHERE status = 'pending_receipt' AND created_at < now() - interval '15 minutes'
     )
  THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'invoke_broadcast_sender: vault secrets project_url / service_role_key missing — scheduled broadcasts will not send';
    RETURN;
  END IF;

  -- Fire-and-forget (pg_net is async): the cron transaction never blocks on
  -- the send. Failures land in net._http_response.
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-broadcasts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{"sweep":true}'::jsonb,
    timeout_milliseconds := 10000
  );
END;
$$;
