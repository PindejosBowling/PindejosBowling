CREATE TABLE app_credentials (
  role          text PRIMARY KEY,
  password_hash text NOT NULL
);

-- Credential rows are seeded separately via supabase/seed_credentials.sql (gitignored).
