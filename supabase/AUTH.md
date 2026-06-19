# Authentication Architecture

## Overview

Auth is Supabase Phone OTP via Twilio. Users receive a 6-digit SMS code, verify it, and get a Supabase session. There is no email/password auth.

## SMS provider: Twilio Verify

OTP SMS are sent through **Twilio Verify** (`twilio_verify`), not Twilio Programmable
Messaging. Verify is purpose-built for OTP and is **exempt from US A2P 10DLC / toll-free
verification**, and it requires **no purchased Twilio number** — Twilio runs the carrier and
compliance layer. (The Programmable Messaging path forces A2P/toll-free verification, which
repeatedly rejected with error 30530.)

The app code is provider-agnostic: `LoginScreen` just calls
`supabase.auth.signInWithOtp({ phone })` then `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`.
Swapping providers is config-only — no app or DB changes.

Configuration:
- **Live (hosted) project:** Supabase Dashboard → Authentication → Phone → SMS provider =
  **Twilio Verify**. Fill: Account SID (`AC…`), Auth Token, and **Message Service SID =
  the Verify Service SID (`VA…`)**. Keep "Enable phone signup" off (login-only).
- **Local dev / repo parity:** the `[auth.sms.twilio_verify]` block in
  [config.toml](./config.toml). For this provider, `message_service_sid` holds the **Verify
  Service SID**, not a Messaging Service SID. The auth token comes from
  `env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)` — never commit it.

Note: the OTP message text/template is owned by the **Twilio Verify Service** (Twilio
Console), so Supabase's `auth.sms.template` is ignored under this provider. Verify is metered
per attempt; on a trial account it only delivers to Twilio-verified caller-ID numbers until a
balance is added. General (non-OTP) SMS would still require A2P 10DLC and is out of scope.

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

## Anon posture (locked down 2026-06-12)

**Anon may execute exactly one function — `is_registered_player(text)` — and nothing else. All table reads require `authenticated`.** The pre-login phone check is the app's only unauthenticated DB call, and the function is `SECURITY DEFINER`, so anon needs no table access at all.

Enforced in layers (migrations `anon_lockdown` + `anon_lockdown_public_execute`):

1. **No anon policies** — every `TO anon` RLS policy was dropped.
2. **No anon grants** — all table/sequence privileges revoked from `anon`, and EXECUTE revoked from **`PUBLIC`** (not just anon — anon inherits from PUBLIC) on every public function. A stray future `TO anon` policy is therefore inert: RLS only filters what GRANTs allow.
3. **Future objects covered** — default privileges for tables/sequences/functions created by `postgres` (i.e. every migration) no longer include anon or PUBLIC. New RPCs default to `postgres` + `authenticated` + `service_role`. **Gotcha (caught live by the assertion, fixed in `anon_lockdown_global_default_acl`):** per-schema `ALTER DEFAULT PRIVILEGES` entries only *add* to global defaults — they cannot remove the built-in "EXECUTE to PUBLIC" every new function gets. The PUBLIC revoke must be **global** (no `IN SCHEMA`). Verified by creating a throwaway function in a rolled-back transaction: anon=false, authenticated=true.
4. **Posture assertion** — [refresh-schema-snapshot.sh](refresh-schema-snapshot.sh) runs [anon-posture-assert.sql](anon-posture-assert.sql) after every push (privilege checks are inheritance-aware via `has_*_privilege`). Any regression fails the push ritual that introduced it, naming the offending policy/grant/function.

Known residual, accepted: `supabase_admin`'s default ACL still names anon for public-schema objects it creates (platform-managed; `postgres` cannot alter another role's default privileges). The assertion catches any concrete object that ever materializes that way.

### The phone-number oracle (accepted trade-off)

`is_registered_player` lets anyone holding the anon key confirm whether a phone number belongs to the league — inherent to the pre-login UX ("is this phone registered?"). After the lockdown this oracle is the *entire* anon attack surface, which is the right shape. Accepted because the league is ~dozens of known members whose numbers are not secret within the league; it returns only a boolean. Revisit only if registration ever opens to strangers.

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
