-- Auction House open/closed state — an admin kill-switch. When closed, the
-- Pinsino "Auction House" tile paints a stylized status overlay and stops
-- players from entering the screen (the app gates the tap). Season-scoped: one
-- row per season, so every new season starts open with no message.
--
-- The pledge/bid mechanics themselves are untouched — this is an entry gate, not
-- a settlement change. State changes only through set_auction_house_closed
-- (admin-guarded); the table takes no direct writes.

CREATE TABLE IF NOT EXISTS public.auction_house_state (
  season_id      uuid PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  is_closed      boolean NOT NULL DEFAULT false,
  -- Admin-authored closed copy shown on the tile; NULL falls back to the app's
  -- default house-voice message.
  closed_message text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.players(id)
);

ALTER TABLE public.auction_house_state ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated reads the state (drives the tile overlay + entry gate).
CREATE POLICY "authenticated can read auction house state"
  ON public.auction_house_state AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
-- No write policy: the state changes only through set_auction_house_closed.

-- Admin toggle. Upserts the current season's row. The message is trimmed to
-- NULL when blank so the client falls back to the default copy.
CREATE OR REPLACE FUNCTION public.set_auction_house_closed(
  p_is_closed boolean,
  p_closed_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_season uuid;
  v_msg    text;
BEGIN
  PERFORM public.assert_admin();

  v_season := public.current_season_id();
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'No active season';
  END IF;

  v_msg := NULLIF(btrim(COALESCE(p_closed_message, '')), '');

  INSERT INTO public.auction_house_state (season_id, is_closed, closed_message, updated_at, updated_by)
    VALUES (v_season, COALESCE(p_is_closed, false), v_msg, now(), public.current_player_id())
  ON CONFLICT (season_id) DO UPDATE
    SET is_closed      = EXCLUDED.is_closed,
        closed_message = EXCLUDED.closed_message,
        updated_at     = now(),
        updated_by     = EXCLUDED.updated_by;
END;
$function$
;
