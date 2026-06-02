-- Enable RLS (eliminates the Supabase dashboard warning and blocks direct table access)
ALTER TABLE app_credentials ENABLE ROW LEVEL SECURITY;

-- Allow anon to perform the credential lookup.
-- The app sends a hash and reads back only `role` — this policy enables that.
-- PostgreSQL allows filtering on a column (password_hash) even without SELECT
-- privilege on it, so .eq('password_hash', hash) in PostgREST continues to work.
CREATE POLICY "anon_credential_lookup"
  ON app_credentials
  FOR SELECT
  TO anon
  USING (true);

-- Prevent the hash values from being projected in any query by public roles.
-- Anon can still filter on password_hash (WHERE), but cannot SELECT it.
REVOKE SELECT (password_hash) ON app_credentials FROM anon, authenticated;
