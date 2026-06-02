-- Revoke all anon read access from bowling data tables.
-- The app requires login before showing any data; anon only needs
-- to call is_registered_player() (SECURITY DEFINER RPC) before OTP.
-- app_credentials retains its anon_credential_lookup policy (intentional).

DROP POLICY IF EXISTS "anon can read" ON public.board_posts;
DROP POLICY IF EXISTS "anon can read" ON public.game_schedule;
DROP POLICY IF EXISTS "anon can read" ON public.players;
DROP POLICY IF EXISTS "anon can read" ON public.rsvp;
DROP POLICY IF EXISTS "anon can read" ON public.scores;
DROP POLICY IF EXISTS "anon can read" ON public.season_champions;
DROP POLICY IF EXISTS "anon can read" ON public.seasons;
DROP POLICY IF EXISTS "anon can read" ON public.team_slots;
DROP POLICY IF EXISTS "anon can read" ON public.weeks;
