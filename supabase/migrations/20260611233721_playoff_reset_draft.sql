-- Admin reset that works in EVERY draft status, including materialized.
--
-- The UI's old reset was a direct DELETE on playoff_drafts, which (a) was
-- hidden once status = materialized and (b) left the materialized artifacts
-- behind: the week's teams/team_slots and the weeks.is_playoff/is_confirmed
-- flags. This RPC is the full teardown:
--   - materialized: delete the week's teams (cascades team_slots/games/scores)
--     and unconfirm the week
--   - always: unflag weeks.is_playoff and delete the draft (cascades
--     captains/pool/picks)
-- Refuses if the playoff week is already archived — that week's teams/scores
-- are settled history and must go through unarchive_week first.

CREATE OR REPLACE FUNCTION public.playoff_reset_draft(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_draft    public.playoff_drafts;
BEGIN
  v_is_admin := ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin';
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
$$;

REVOKE ALL ON FUNCTION public.playoff_reset_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.playoff_reset_draft(uuid) TO authenticated;
