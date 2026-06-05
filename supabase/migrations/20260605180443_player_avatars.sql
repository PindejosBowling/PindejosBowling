-- Player profile pictures.
-- Admins set/delete photos on behalf of players (no self-service uploads).
-- Images live in a PRIVATE storage bucket: readable by any authenticated user
-- (via signed URLs), writable only by the admin role.

-- ------------------------------------------------------------
-- players.avatar_path — storage key for the player's photo (e.g. "<player_id>.jpg")
-- NULL = no photo (fall back to initials in the UI).
-- ------------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS avatar_path text;

-- ------------------------------------------------------------
-- Private "avatars" bucket
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- RLS on storage.objects, scoped to the avatars bucket.
-- Mirrors the JWT-claim admin pattern used elsewhere
-- (see 20260602204537_security_hardening_rls.sql).
-- ------------------------------------------------------------

-- Read: any authenticated user (enables signed-url downloads). NOT public/anon.
DROP POLICY IF EXISTS "avatars authenticated read" ON storage.objects;
CREATE POLICY "avatars authenticated read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- Write: admin only. Upsert needs INSERT + UPDATE (+ the SELECT above).
DROP POLICY IF EXISTS "avatars admin insert" ON storage.objects;
CREATE POLICY "avatars admin insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );

DROP POLICY IF EXISTS "avatars admin update" ON storage.objects;
CREATE POLICY "avatars admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );

DROP POLICY IF EXISTS "avatars admin delete" ON storage.objects;
CREATE POLICY "avatars admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );
