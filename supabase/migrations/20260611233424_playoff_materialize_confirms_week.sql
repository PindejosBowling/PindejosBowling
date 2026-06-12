-- Materializing playoff teams must also confirm the week.
--
-- MatchupsScreen resolves "the week in play" via weeks.getActive(), which
-- filters is_confirmed = true — the flag the normal generate-teams flow sets
-- after writing teams. playoff_materialize_teams created the teams but left
-- the week unconfirmed, so Matchups never showed them. Mirror the generate-
-- teams flow: confirm the week as part of materialization.

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

  -- Matchups (weeks.getActive) only surfaces confirmed weeks — same flag the
  -- admin generate-teams flow sets once teams are locked.
  UPDATE weeks SET is_confirmed = true, updated_at = now() WHERE id = v_draft.week_id;

  UPDATE playoff_drafts SET status = 'materialized', updated_at = now() WHERE id = p_draft_id;
END;
$$;
