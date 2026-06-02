# Authentication Architecture

## Overview

Auth is Supabase Phone OTP via Twilio. Users receive a 6-digit SMS code, verify it, and get a Supabase session. There is no email/password auth.

## Roles

Two roles exist: `player` (default) and `admin`. Role is stored directly on the `players` table as `players.role`. To promote a player to admin:

```sql
UPDATE players SET role = 'admin' WHERE phone = '+1xxxxxxxxxx';
```

## Key Tables

| Table | Purpose |
|---|---|
| `auth.users` | Managed by Supabase. Phone is the identity. Stores no app data. |
| `public.players` | App player records. `user_id` FK links to `auth.users.id`. `role` column holds `'player'` or `'admin'`. |

## Linking auth.users to players

When a player completes OTP verification for the first time, the `on_auth_user_linked` trigger fires on `auth.users` and stamps `players.user_id` automatically:

```sql
UPDATE players SET user_id = NEW.id WHERE phone = '+' || NEW.phone AND user_id IS NULL;
```

Note: `auth.users` stores phone without the leading `+` (e.g. `17703552520`), while `players.phone` uses full E.164 format (e.g. `+17703552520`). The trigger accounts for this.

The `players.isRegistered()` RPC (`is_registered_player`) is called before sending the OTP to reject phone numbers that aren't in the league roster. This is a `SECURITY DEFINER` function callable by `anon` — it returns only a boolean and exposes no PII.

## JWT Hook — `public.custom_access_token`

A `custom_access_token` hook is registered in the Supabase dashboard under **Authentication → Hooks**. It points to `pg-functions://postgres/public/custom_access_token`.

**This function must exist or every login and token refresh will fail with:**
```
Error running hook URI: pg-functions://postgres/public/custom_access_token
```

The function (`20260602170000_custom_access_token_hook.sql`, updated by `20260602210000_consolidate_role_into_players.sql`) runs on every JWT issue/refresh. It reads `players.role` and embeds it into `app_metadata`:

```json
{ "app_metadata": { "role": "player" } }
```

This means RLS policies can use the JWT claim directly without a table join:
```sql
(auth.jwt()->'app_metadata'->>'role') = 'admin'
```

The function is `SECURITY DEFINER` and executable only by `supabase_auth_admin`. It must be granted that permission explicitly — the migration handles this, but if you recreate the function manually, re-run the `GRANT`.

## Client-Side (authStore)

`app/src/stores/authStore.ts` sets up `supabase.auth.onAuthStateChange` in `hydrate()`. On any session event it calls `players.getByUserId(userId)` — a single query that returns `id`, `name`, and `role` — and stores all three on the Zustand store alongside `userId`:

| Field | Source |
|---|---|
| `userId` | `auth.users.id` — used for auth operations and RLS |
| `playerId` | `players.id` — used for all app data writes (RSVPs, posts, etc.) |
| `playerName` | `players.name` — used for display and personalization |
| `role` | `players.role` — used to gate admin UI |

The app shows `LoginScreen` when `role` is `null`.

`signOut()` clears all four fields in the store immediately, then calls `supabase.auth.signOut()` to revoke the server-side session. State is cleared directly rather than waiting on the `SIGNED_OUT` listener event, which is unreliable in React Native.

## If You Add a New Auth Hook

1. Create the PostgreSQL function in a migration.
2. Grant execute to `supabase_auth_admin` and revoke from `PUBLIC`/`anon`/`authenticated`.
3. Register the hook URI in the Supabase dashboard under Authentication → Hooks.
4. The hook will silently break logins if the function is missing or throws — test with a real OTP flow after deploying.
