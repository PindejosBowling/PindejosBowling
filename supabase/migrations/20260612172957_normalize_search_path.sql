-- search_path normalization (TODO_DB_FUNCTION_HYGIENE §4).
--
-- 8 functions pinned search_path to 'public' and one trigger had no pin at
-- all. The vulnerability is pg_temp: with search_path = 'public' (or unset),
-- pg_temp is implicitly FIRST, so session-local temp objects can shadow
-- tables/functions inside SECURITY DEFINER bodies. Appending pg_temp LAST
-- ('public', 'pg_temp' — the documented hardening) kills the shadowing
-- vector with zero body edits; unqualified refs still resolve to public.
--
-- Deliberate deviation from the audit's letter (TO '' + qualify every ref):
-- same security property, far less rewrite risk for the 6-function playoff
-- draft engine. GENERATED from the live catalog; only the SET clause changes
-- (playoff_create_draft also keeps its is_admin() guard from the previous
-- migration, which was generated from the same pre-push catalog).
--
-- ⚠ custom_access_token is the JWT claims hook (runs as supabase_auth_admin):
-- if login breaks, rollback = CREATE OR REPLACE with SET search_path TO 'public'.

CREATE OR REPLACE FUNCTION public.custom_access_token(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  claims     jsonb;
  user_role  text;
BEGIN
  SELECT role INTO user_role
  FROM players
  WHERE user_id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::jsonb)
      || jsonb_build_object('role', COALESCE(user_role, 'player'))
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_auth_user_to_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    UPDATE players
    SET user_id = NEW.id
    WHERE phone = '+' || NEW.phone
      AND user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.playoff_create_draft(p_season_id uuid, p_week_id uuid, p_draft_type text, p_captain_player_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft_id uuid;
  v_i        integer;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can create a playoff draft';
  END IF;

  IF array_length(p_captain_player_ids, 1) IS NULL OR array_length(p_captain_player_ids, 1) < 2 THEN
    RAISE EXCEPTION 'At least 2 captains are required';
  END IF;
  IF (SELECT count(DISTINCT c) FROM unnest(p_captain_player_ids) c)
     <> array_length(p_captain_player_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate captain';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM weeks WHERE id = p_week_id AND season_id = p_season_id AND is_archived = false) THEN
    RAISE EXCEPTION 'Playoff week must be an unarchived week of the season';
  END IF;

  INSERT INTO playoff_drafts (season_id, week_id, draft_type)
    VALUES (p_season_id, p_week_id, COALESCE(p_draft_type, 'snake'))
    RETURNING id INTO v_draft_id;

  FOR v_i IN 1 .. array_length(p_captain_player_ids, 1) LOOP
    INSERT INTO playoff_draft_captains (draft_id, player_id, seed)
      VALUES (v_draft_id, p_captain_player_ids[v_i], v_i);
  END LOOP;

  INSERT INTO playoff_draft_pool (draft_id, player_id)
    SELECT v_draft_id, r.player_id
      FROM registrations r
      JOIN players p ON p.id = r.player_id AND p.is_active = true
     WHERE r.season_id = p_season_id
       AND r.player_id <> ALL (p_captain_player_ids);

  UPDATE weeks SET is_playoff = true, updated_at = now() WHERE id = p_week_id;

  RETURN v_draft_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.playoff_current_turn(p_draft_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_draft      public.playoff_drafts;
  v_n          integer;
  v_picks      integer;
  v_remaining  integer;
  v_k          integer;
  v_idx        integer;  -- 0-based position within the round
  v_round      integer;  -- 0-based round
  v_seed       integer;
BEGIN
  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id;
  IF v_draft.id IS NULL OR v_draft.status <> 'drafting' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_n FROM playoff_draft_captains WHERE draft_id = p_draft_id;
  IF v_n = 0 THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_picks FROM playoff_draft_picks WHERE draft_id = p_draft_id;

  SELECT count(*) INTO v_remaining
    FROM playoff_draft_pool pool
   WHERE pool.draft_id = p_draft_id
     AND NOT EXISTS (SELECT 1 FROM playoff_draft_picks pk
                      WHERE pk.draft_id = p_draft_id AND pk.picked_player_id = pool.player_id);
  IF v_remaining = 0 THEN RETURN NULL; END IF;

  v_k     := v_picks + 1;
  v_round := (v_k - 1) / v_n;
  v_idx   := (v_k - 1) % v_n;

  IF v_draft.draft_type = 'snake' AND v_round % 2 = 1 THEN
    v_seed := v_n - v_idx;
  ELSE
    v_seed := v_idx + 1;
  END IF;

  RETURN (SELECT player_id FROM playoff_draft_captains
           WHERE draft_id = p_draft_id AND seed = v_seed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.playoff_make_pick(p_draft_id uuid, p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  uuid;
  v_is_admin   boolean;
  v_draft      public.playoff_drafts;
  v_on_clock   uuid;
  v_picks      integer;
  v_remaining  integer;
BEGIN
  v_is_admin := public.is_admin();
  SELECT id INTO v_caller_id FROM players WHERE user_id = auth.uid();
  IF v_caller_id IS NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'No player linked to the current user';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF v_draft.status <> 'drafting' THEN
    RAISE EXCEPTION 'Draft is not live';
  END IF;

  v_on_clock := playoff_current_turn(p_draft_id);
  IF v_on_clock IS NULL THEN
    RAISE EXCEPTION 'No pick is available';
  END IF;
  IF v_caller_id IS DISTINCT FROM v_on_clock AND NOT v_is_admin THEN
    RAISE EXCEPTION 'It is not your turn';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM playoff_draft_pool
                  WHERE draft_id = p_draft_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'Player is not in the draft pool';
  END IF;
  IF EXISTS (SELECT 1 FROM playoff_draft_picks
              WHERE draft_id = p_draft_id AND picked_player_id = p_player_id) THEN
    RAISE EXCEPTION 'Player has already been drafted';
  END IF;

  SELECT count(*) INTO v_picks FROM playoff_draft_picks WHERE draft_id = p_draft_id;

  INSERT INTO playoff_draft_picks (draft_id, pick_number, captain_player_id, picked_player_id)
    VALUES (p_draft_id, v_picks + 1, v_on_clock, p_player_id);

  SELECT count(*) INTO v_remaining
    FROM playoff_draft_pool pool
   WHERE pool.draft_id = p_draft_id
     AND NOT EXISTS (SELECT 1 FROM playoff_draft_picks pk
                      WHERE pk.draft_id = p_draft_id AND pk.picked_player_id = pool.player_id);

  IF v_remaining = 0 THEN
    UPDATE playoff_drafts SET status = 'completed', updated_at = now() WHERE id = p_draft_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.playoff_materialize_teams(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
  v_captain  record;
  v_team_id  uuid;
  v_slot     integer;
  v_pick     record;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can materialize playoff teams';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF v_draft.status <> 'completed' THEN
    RAISE EXCEPTION 'Draft must be completed before materializing (status %)', v_draft.status;
  END IF;
  IF EXISTS (SELECT 1 FROM teams WHERE week_id = v_draft.week_id) THEN
    RAISE EXCEPTION 'The playoff week already has teams';
  END IF;

  FOR v_captain IN
    SELECT player_id, seed FROM playoff_draft_captains
     WHERE draft_id = p_draft_id ORDER BY seed
  LOOP
    INSERT INTO teams (week_id, team_number)
      VALUES (v_draft.week_id, v_captain.seed)
      RETURNING id INTO v_team_id;

    INSERT INTO team_slots (team_id, slot, player_id)
      VALUES (v_team_id, 1, v_captain.player_id);

    v_slot := 1;
    FOR v_pick IN
      SELECT picked_player_id FROM playoff_draft_picks
       WHERE draft_id = p_draft_id AND captain_player_id = v_captain.player_id
       ORDER BY pick_number
    LOOP
      v_slot := v_slot + 1;
      INSERT INTO team_slots (team_id, slot, player_id)
        VALUES (v_team_id, v_slot, v_pick.picked_player_id);
    END LOOP;
  END LOOP;

  -- Matchups (weeks.getActive) only surfaces confirmed weeks — same flag the
  -- admin generate-teams flow sets once teams are locked.
  UPDATE weeks SET is_confirmed = true, updated_at = now() WHERE id = v_draft.week_id;

  UPDATE playoff_drafts SET status = 'materialized', updated_at = now() WHERE id = p_draft_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.playoff_reset_draft(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can reset a playoff draft';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  IF EXISTS (SELECT 1 FROM weeks WHERE id = v_draft.week_id AND is_archived = true) THEN
    RAISE EXCEPTION 'The playoff week is archived — unarchive it before resetting the draft';
  END IF;

  IF v_draft.status = 'materialized' THEN
    DELETE FROM teams WHERE week_id = v_draft.week_id;
    UPDATE weeks SET is_confirmed = false, updated_at = now() WHERE id = v_draft.week_id;
  END IF;

  UPDATE weeks SET is_playoff = false, updated_at = now() WHERE id = v_draft.week_id;

  DELETE FROM playoff_drafts WHERE id = p_draft_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.playoff_undo_pick(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
  v_last     uuid;
BEGIN
  v_is_admin := public.is_admin();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can undo a pick';
  END IF;

  SELECT * INTO v_draft FROM playoff_drafts WHERE id = p_draft_id FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF v_draft.status NOT IN ('drafting', 'completed') THEN
    RAISE EXCEPTION 'Draft is not undoable in status %', v_draft.status;
  END IF;

  SELECT id INTO v_last FROM playoff_draft_picks
   WHERE draft_id = p_draft_id ORDER BY pick_number DESC LIMIT 1;
  IF v_last IS NULL THEN
    RAISE EXCEPTION 'No picks to undo';
  END IF;

  DELETE FROM playoff_draft_picks WHERE id = v_last;

  IF v_draft.status = 'completed' THEN
    UPDATE playoff_drafts SET status = 'drafting', updated_at = now() WHERE id = p_draft_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_non_open_season_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.registration_open is not true then
    raise exception
      'Season % cannot be deleted: only seasons with open registration may be removed.',
      old.number
      using errcode = 'check_violation';
  end if;
  return old;
end;
$function$;

