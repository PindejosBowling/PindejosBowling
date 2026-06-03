-- App auth is now handled entirely via Supabase Phone OTP (see supabase/AUTH.md).
-- The legacy app_credentials table (role/password_hash lookup) is obsolete.
-- Dropping it cascades its RLS policy, triggers, and column grants.

DROP TABLE IF EXISTS public.app_credentials CASCADE;
