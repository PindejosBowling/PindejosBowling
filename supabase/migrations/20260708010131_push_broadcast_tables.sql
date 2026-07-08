-- Push Broadcasts M1 — the tables + token RPCs.
--
-- "Broadcast" = an admin-composed push notification (send-now or scheduled),
-- delivered via the Expo Push Service by the send-broadcasts Edge Function.
-- Deliberately distinct from the in-app badge "notification framework"
-- (context/notifications.md) — nothing here uses the bare word "notification".
--
-- Opt-out is enforced SERVER-SIDE at send time (iOS displays a remote push
-- before app code runs, so the client can never filter): the recipient set is
-- resolved in-DB (M2's broadcast_recipients) against these preference tables.
-- Opt-out always wins, including for targeted sends.

-- ---------------------------------------------------------------------------
-- broadcast_categories — the catalog users toggle and admins pick from.
-- Future event-driven push types land as new rows (no schema change).
-- ---------------------------------------------------------------------------
CREATE TABLE public.broadcast_categories (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key         text        NOT NULL UNIQUE,
  label       text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  sort_order  integer     NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- (set_updated_at is auto-attached by the enforce_audit_columns event trigger
-- on every new table here — never added manually.)

ALTER TABLE public.broadcast_categories ENABLE ROW LEVEL SECURITY;
-- Read-only catalog: clients render the settings screen from it; changes are
-- migrations (activity_event_catalog / item_catalog posture).
CREATE POLICY "authenticated can read categories" ON public.broadcast_categories
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

INSERT INTO public.broadcast_categories (key, label, description, sort_order) VALUES
  ('league',    'League Announcements', 'Schedule changes, standings news, and league-wide announcements.', 1),
  ('economy',   'Pinsino & Economy',    'Auctions, bounties, betting, and everything pin-economy.',         2),
  ('reminders', 'Reminders',            'RSVP nudges and bowl-night reminders.',                            3)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- push_tokens — one row per registered device. Tokens are SECRETS (holding one
-- lets you push to that phone): RLS is enabled with ZERO client policies, and
-- all writes go through the two SECURITY DEFINER RPCs below. A token can never
-- leave the DB through PostgREST; only the Edge Function (service role) and
-- the M2 definer functions read it.
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_tokens (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id          uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  expo_push_token    text        NOT NULL UNIQUE,
  platform           text        NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android')),
  -- Bumped on every app launch (the staleness heartbeat).
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_tokens_player_idx ON public.push_tokens (player_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: RPC-only writes, service-role-only reads.

-- Upsert the caller's device token. Keyed on the token itself: the same device
-- re-registering under a different player (handed-down phone, account switch)
-- steals the row — the token always points at its CURRENT owner.
CREATE FUNCTION public.register_push_token(p_token text, p_platform text DEFAULT 'ios')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_player_id uuid;
BEGIN
  v_player_id := public.current_player_id();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'No player for the current user';
  END IF;
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'A push token is required';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Unknown platform %', p_platform;
  END IF;

  INSERT INTO public.push_tokens (player_id, expo_push_token, platform)
  VALUES (v_player_id, btrim(p_token), p_platform)
  ON CONFLICT (expo_push_token)
  DO UPDATE SET player_id = EXCLUDED.player_id,
                platform = EXCLUDED.platform,
                last_registered_at = now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;

-- Delete the caller's own token (best-effort on sign-out). Someone else's
-- token is silently untouched (rowcount 0) — never an information leak.
CREATE FUNCTION public.unregister_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.push_tokens
   WHERE expo_push_token = btrim(p_token)
     AND player_id = public.current_player_id();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- push_preferences — the master switch, one row per player. ABSENCE of a row
-- means everything is ON: defaults-on with zero backfill, and future players
-- are opted in automatically. The row is only created when a player first
-- flips something off.
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_preferences (
  player_id      uuid        NOT NULL PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  master_enabled boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prefs or admin can read" ON public.push_preferences
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_admin())
         OR player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY "own prefs insert" ON public.push_preferences
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY "own prefs update" ON public.push_preferences
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- push_category_prefs — per-category toggles, rows not jsonb (FK to the
-- catalog + clean join in recipient resolution; an absent row = ON, so new
-- categories are opted-in with no backfill).
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_category_prefs (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id   uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  category_id uuid        NOT NULL REFERENCES public.broadcast_categories(id) ON DELETE CASCADE,
  enabled     boolean     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, category_id)
);

CREATE INDEX push_category_prefs_player_idx ON public.push_category_prefs (player_id);

ALTER TABLE public.push_category_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own category prefs or admin can read" ON public.push_category_prefs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_admin())
         OR player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY "own category prefs insert" ON public.push_category_prefs
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY "own category prefs update" ON public.push_category_prefs
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (player_id IN (SELECT p.id FROM public.players p WHERE p.user_id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- broadcasts — queue, history, and audit log in one table.
-- Lifecycle: pending → sending → sent | failed, plus pending → canceled
-- (broadcast_cancel below — the only legal cancel edge). A failed broadcast is
-- re-sent by composing a new one (no retry state).
-- ---------------------------------------------------------------------------
CREATE TABLE public.broadcasts (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id       uuid        NOT NULL REFERENCES public.broadcast_categories(id),
  title             text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body              text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  -- NULL = whole-category audience; non-empty = only these players (still
  -- intersected with opt-in — opt-out ALWAYS wins).
  target_player_ids uuid[],
  -- Future deep-link payload; rides into the Expo message's data field.
  data              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- 'event' reserved for future event-driven publishers.
  source            text        NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'event')),
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  scheduled_for     timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL REFERENCES public.players(id),
  claimed_at        timestamptz,
  sent_at           timestamptz,
  -- Players resolved after the opt-out filter / Expo-accepted tickets / errors.
  recipient_count   integer,
  delivered_count   integer,
  failed_count      integer,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (target_player_ids IS NULL OR cardinality(target_player_ids) > 0)
);

-- The per-minute sweep's probe: due pending work only.
CREATE INDEX broadcasts_due_idx ON public.broadcasts (scheduled_for) WHERE status = 'pending';

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin can read broadcasts" ON public.broadcasts
  AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "admin can insert broadcasts" ON public.broadcasts
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
-- No UPDATE/DELETE policies: status transitions belong to the Edge Function
-- (service role) and broadcast_cancel (definer RPC); history is never deleted.

-- Cancel a scheduled broadcast — the only client-reachable status write, so
-- the pending-only guard lives server-side.
CREATE FUNCTION public.broadcast_cancel(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.broadcasts
     SET status = 'canceled'
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a pending broadcast can be canceled';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.broadcast_cancel(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- broadcast_push_tickets — one row per message handed to Expo. Expo reports
-- DeviceNotRegistered mostly in RECEIPTS (~15 min after send), so tickets are
-- kept 'pending_receipt' until the sweep's receipt pass resolves them and
-- prunes dead tokens. Links tokens to players → service-role only.
-- ---------------------------------------------------------------------------
CREATE TABLE public.broadcast_push_tickets (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_id  uuid        NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  push_token_id uuid        REFERENCES public.push_tokens(id) ON DELETE SET NULL,
  -- Expo receipt id; NULL when the ticket itself errored at send time.
  ticket_id     text,
  status        text        NOT NULL DEFAULT 'pending_receipt'
                CHECK (status IN ('pending_receipt', 'ok', 'error')),
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX broadcast_push_tickets_pending_idx
  ON public.broadcast_push_tickets (created_at) WHERE status = 'pending_receipt';
CREATE INDEX broadcast_push_tickets_broadcast_idx
  ON public.broadcast_push_tickets (broadcast_id);

ALTER TABLE public.broadcast_push_tickets ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
