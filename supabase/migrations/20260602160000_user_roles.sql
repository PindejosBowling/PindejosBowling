CREATE TABLE user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin'))
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read their own role row.
CREATE POLICY "users_read_own_role"
  ON user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
