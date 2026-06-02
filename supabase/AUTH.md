# Authentication Architecture

## Overview

Auth is Supabase Phone OTP via Twilio. Users receive a 6-digit SMS code, verify it, and get a Supabase session. There is no email/password auth.

## Roles

Two roles exist: `player` (default) and `admin`. Role assignment is manual — insert a row into `user_roles` in the Supabase dashboard:

```sql
INSERT INTO user_roles (user_id, role) VALUES ('<auth.users uuid>', 'admin');
```

All authenticated users who have no row in `user_roles` are treated as `player`.

## Key Tables

| Table | Purpose |
|---|---|
| `auth.users` | Managed by Supabase. Phone is the identity. |
| `public.user_roles` | One row per user who has an explicit role. Absence = `player`. |

`user_roles` has RLS enabled. Authenticated users can only `SELECT` their own row.

## JWT Hook — `public.custom_access_token`

A `custom_access_token` hook is registered in the Supabase dashboard under **Authentication → Hooks**. It points to `pg-functions://postgres/public/custom_access_token`.

**This function must exist or every login and token refresh will fail with:**
```
Error running hook URI: pg-functions://postgres/public/custom_access_token
```

The function (`20260602170000_custom_access_token_hook.sql`) runs on every JWT issue/refresh. It reads `user_roles` and embeds the role into `app_metadata`:

```json
{ "app_metadata": { "role": "player" } }
```

This means RLS policies can use the JWT claim directly without a table join:
```sql
(auth.jwt()->'app_metadata'->>'role') = 'admin'
```

The function is `SECURITY DEFINER` and executable only by `supabase_auth_admin`. It must be granted that permission explicitly — the migration handles this, but if you recreate the function manually, re-run the `GRANT`.

## Client-Side (authStore)

`app/src/stores/authStore.ts` sets up `supabase.auth.onAuthStateChange` in `hydrate()`. On any session event it fetches the role from `user_roles` and stores it in the Zustand store. The app shows `LoginScreen` when `role` is `null`.

`signOut()` clears `role` and `userId` in the store immediately, then calls `supabase.auth.signOut()` to revoke the server-side session. State is cleared directly rather than waiting on the `SIGNED_OUT` listener event, which is unreliable in React Native.

## If You Add a New Auth Hook

1. Create the PostgreSQL function in a migration.
2. Grant execute to `supabase_auth_admin` and revoke from `PUBLIC`/`anon`/`authenticated`.
3. Register the hook URI in the Supabase dashboard under Authentication → Hooks.
4. The hook will silently break logins if the function is missing or throws — test with a real OTP flow after deploying.
