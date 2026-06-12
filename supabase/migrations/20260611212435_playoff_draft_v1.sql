-- Playoff draft v1: captains draft playoff teams from the season's active players.
--
-- Model:
--   playoff_drafts          one per season; lifecycle setup → drafting → completed → materialized
--   playoff_draft_captains  the captains + their seed (1..N, drives pick order)
--   playoff_draft_pool      snapshot of draftable players (seeded at create, admin-prunable)
--   playoff_draft_picks     append-only pick log; whose-turn is DERIVED from this log
--                           (count picks + draft_type + captain count), never stored.
--
-- Writes: captains pick only via playoff_make_pick (SECURITY DEFINER, row lock on the
-- draft serializes concurrent picks). Admin has full direct CRUD via RLS for fixes;
-- status-coupled mutations (undo, materialize) get RPCs so state stays consistent.

-- ── weeks.is_playoff ─────────────────────────────────────────────────────────
-- The playoff week is an ordinary week (RSVP / betting sync / archive untouched);
-- the flag exists for labeling and so the draft can find "its" week.

ALTER TABLE public.weeks ADD COLUMN is_playoff boolean NOT NULL DEFAULT false;

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE public.playoff_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid NOT NULL UNIQUE REFERENCES public.seasons(id) ON DELETE CASCADE,
  week_id     uuid NOT NULL REFERENCES public.weeks(id),
  draft_type  text NOT NULL DEFAULT 'snake' CHECK (draft_type IN ('snake', 'straight')),
  status      text NOT NULL DEFAULT 'setup'
              CHECK (status IN ('setup', 'drafting', 'completed', 'materialized')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.playoff_draft_captains (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id   uuid NOT NULL REFERENCES public.playoff_drafts(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES public.players(id),
  seed       integer NOT NULL CHECK (seed >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, player_id),
  UNIQUE (draft_id, seed)
);

CREATE TABLE public.playoff_draft_pool (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id   uuid NOT NULL REFERENCES public.playoff_drafts(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES public.players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, player_id)
);

CREATE TABLE public.playoff_draft_picks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES public.playoff_drafts(id) ON DELETE CASCADE,
  pick_number       integer NOT NULL CHECK (pick_number >= 1),
  captain_player_id uuid NOT NULL REFERENCES public.players(id),
  picked_player_id  uuid NOT NULL REFERENCES public.players(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, pick_number),
  UNIQUE (draft_id, picked_player_id)
);

CREATE INDEX playoff_draft_captains_draft_idx ON public.playoff_draft_captains (draft_id);
CREATE INDEX playoff_draft_pool_draft_idx     ON public.playoff_draft_pool (draft_id);
CREATE INDEX playoff_draft_picks_draft_idx    ON public.playoff_draft_picks (draft_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Reads: any authenticated user. Writes: admin only (captain picks go through
-- the SECURITY DEFINER RPC, which bypasses RLS).

ALTER TABLE public.playoff_drafts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_draft_captains  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_draft_pool      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_draft_picks     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['playoff_drafts','playoff_draft_captains','playoff_draft_pool','playoff_draft_picks'] LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated can read" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format(
      'CREATE POLICY "admin can write" ON public.%I FOR ALL TO authenticated
         USING  ((((SELECT auth.jwt()) -> ''app_metadata'' ->> ''role'') = ''admin''))
         WITH CHECK ((((SELECT auth.jwt()) -> ''app_metadata'' ->> ''role'') = ''admin''))', t);
  END LOOP;
END $$;

-- ── Turn derivation ──────────────────────────────────────────────────────────
-- Pure function of the pick log: pick k (1-based) over N seeds.
--   straight: seed = ((k-1) % N) + 1
--   snake:    odd rounds run 1..N, even rounds N..1
-- Returns the player_id of the captain on the clock, or NULL if the pool is empty
-- (draft over) or the draft is not in 'drafting'.

CREATE OR REPLACE FUNCTION public.playoff_current_turn(p_draft_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- ── playoff_create_draft ─────────────────────────────────────────────────────
-- Admin only. p_captain_player_ids is seed-ordered (the app orders captains by
-- current standings before calling). Seeds the pool from the season's
-- registrations ∩ players.is_active, minus the captains, and flags the week.

CREATE OR REPLACE FUNCTION public.playoff_create_draft(
  p_season_id uuid,
  p_week_id uuid,
  p_draft_type text,
  p_captain_player_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_draft_id uuid;
  v_i        integer;
BEGIN
  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
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
$$;

-- ── playoff_make_pick ────────────────────────────────────────────────────────
-- Captain on the clock (or an admin, picking on the clock-holder's behalf)
-- records a pick. The FOR UPDATE lock on the draft row serializes concurrent
-- picks so turn derivation + uniqueness checks can't race. Flips the draft to
-- 'completed' when the pool drains.

CREATE OR REPLACE FUNCTION public.playoff_make_pick(p_draft_id uuid, p_player_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id  uuid;
  v_is_admin   boolean;
  v_draft      public.playoff_drafts;
  v_on_clock   uuid;
  v_picks      integer;
  v_remaining  integer;
BEGIN
  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
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
$$;

-- ── playoff_undo_pick ────────────────────────────────────────────────────────
-- Admin: delete the latest pick. Because turn order is derived from the log,
-- deleting the last row rewinds the clock for free; also reopens a 'completed'
-- draft back to 'drafting'.

CREATE OR REPLACE FUNCTION public.playoff_undo_pick(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
  v_last     uuid;
BEGIN
  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
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
$$;

-- ── playoff_materialize_teams ────────────────────────────────────────────────
-- Admin: turn the drafted rosters into real teams/team_slots on the playoff
-- week so the existing matchup/scoring infrastructure takes over. Team numbers
-- follow seed order; slot 1 is the captain, then picks in pick order. Refuses
-- if the week already has teams (clear them via the week editor first).

CREATE OR REPLACE FUNCTION public.playoff_materialize_teams(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
  v_captain  record;
  v_team_id  uuid;
  v_slot     integer;
  v_pick     record;
BEGIN
  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
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

  UPDATE playoff_drafts SET status = 'materialized', updated_at = now() WHERE id = p_draft_id;
END;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.playoff_current_turn(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.playoff_create_draft(uuid, uuid, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.playoff_make_pick(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.playoff_undo_pick(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.playoff_materialize_teams(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.playoff_current_turn(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_create_draft(uuid, uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_make_pick(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_undo_pick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_materialize_teams(uuid) TO authenticated;

-- Realtime: captains' devices subscribe to pick/draft changes (useWeekClock pattern).
ALTER PUBLICATION supabase_realtime ADD TABLE public.playoff_draft_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.playoff_drafts;
