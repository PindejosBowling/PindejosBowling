# Push Broadcasts — admin push notifications with user opt-out

**"Broadcast" = an admin-composed push notification** (send-now or scheduled), delivered to iOS devices via the Expo Push Service. Deliberately distinct from the in-app badge **notification framework** ([notifications.md](notifications.md)) — that system counts pending actions inside the app; this one sends real APNs pushes. Nothing in this feature uses the bare word "notification" except the user-facing screen title.

Design contract (grilled 2026-07-07): broadcasts only in v1 (event-driven pushes later slot in via `broadcasts.source='event'` + new catalog rows); three fixed categories; defaults ON after iOS permission; **opt-out always wins, including targeted sends**.

## Why the DB is involved at all

A push is delivered by Apple to a *device token*, not a user — tokens must live somewhere central the sender can read. And iOS displays a remote push before app code runs, so an opted-out user can't be filtered client-side: **opt-out must be enforced server-side at send time.** Hence tokens + preferences + the queue all live in Postgres, and one Edge Function does the sending.

## Tables (migrations `20260708010131` / `010231` / `010718`)

| Table | Purpose | RLS posture |
|---|---|---|
| `broadcast_categories` | Catalog users toggle / admins pick (`league`, `economy`, `reminders` seeded). Future event types = new rows | authenticated SELECT; writes are migrations |
| `push_tokens` | One row per device (`expo_push_token` UNIQUE; upsert steals the row on owner change). `last_registered_at` = per-launch heartbeat | **RLS on, zero policies** — tokens are secrets; writes via `register_push_token`/`unregister_push_token` (definer RPCs), reads service-role only |
| `push_preferences` | Master switch, one row per player. **Absent row = ON** (defaults-on, no backfill) | own-row R/W + admin |
| `push_category_prefs` | Per-category toggles, rows not jsonb. **Absent row = ON** | own-row R/W + admin |
| `broadcasts` | Queue + history + audit in one. `target_player_ids NULL` = whole category. Lifecycle `pending → sending → sent \| failed`, `pending → canceled` (via `broadcast_cancel` RPC only) | admin SELECT/INSERT; no client UPDATE/DELETE |
| `broadcast_push_tickets` | One row per Expo message; receipts resolve `pending_receipt → ok \| error` | RLS on, zero policies (service-role only) |

## The one recipient predicate

`broadcast_recipients(category_id, targets)` (definer, **no grants**) returns `(player_id, token)` for: active player ∧ has token ∧ master not false ∧ category not false ∧ (in targets if given). Both `broadcast_reach` (the composer's "4 targeted · 3 reachable" preview, admin-gated, counts only) and the Edge Function send path call it — **preview and send can never disagree**. Never re-implement this filter anywhere else.

## The sender — `supabase/functions/send-broadcasts`

Two invoke paths, both under gateway `verify_jwt`:

1. **Admin send-now** — `{ broadcastId }` with the admin's user JWT (role read from `players.role` via service client, lanetalk-import pattern). The app inserts the row (`scheduled_for = now()`) then invokes directly — no waiting for the cron tick; if the invoke fails, the sweep picks the row up anyway.
2. **Cron sweep** — `{ sweep: true }` with `Authorization: Bearer <service_role_key>` (compared against the function's own env secret). Processes every due pending row **and** the receipt pass.

Per broadcast: **idempotent claim** (`pending → sending` guarded UPDATE; a row stuck in `sending` >10 min is reclaimed — self-healing), resolve recipients, ≤100-message batches to `exp.host/--/api/v2/push/send`, one ticket row per message, finalize counts. Zero recipients = a valid `sent` with counts 0, not a failure. Per-broadcast error isolation (mirrors `sweep_auctions`): a failure marks that row `failed` and moves on.

**Receipt pass** (every sweep): tickets `pending_receipt` older than 15 min → `getReceipts` (≤300/batch); `DeviceNotRegistered` (at send OR receipt time) deletes the token row — the staleness prune.

## The scheduler tick (pg_cron + pg_net)

`invoke_broadcast_sender()` (definer, zero grants, cron-only by ownership) runs every minute as `send_broadcasts_every_minute`. It probes the partial indexes (`broadcasts_due_idx`, pending-receipt index) and returns without any HTTP call on a quiet minute; otherwise `net.http_post` (async, fire-and-forget) to the Edge Function with the service key.

**Vault secrets (one-time manual, never committed):** `project_url` and `service_role_key` via `vault.create_secret(...)` in the SQL editor. **Rotating the service-role key requires `vault.update_secret` here too** — otherwise the cron path 401s silently; failures surface in `net._http_response` and `cron.job_run_details`.

## App layer

- **`app/src/utils/pushTokens.ts`** — the ONLY file touching `expo-notifications` (dynamic imports + web guards; the GitHub Pages bundle never evaluates the native module). `syncPushToken()` runs on every authenticated app open (`App.tsx`): prompts once when `undetermined`, no-ops when denied/web/simulator/read-only, otherwise registers via RPC (the heartbeat). Sign-out best-effort unregisters (dynamic import from `authStore` to avoid the import cycle).
- **`db.ts`** — `push` (token RPCs, categories, pref upserts) and `broadcasts` (listRecent/create/cancel/reach/sendNow; `sendNow` normalizes Edge-Function errors like `lanetalkImports`).
- **`NotificationSettingsScreen`** (More → league tools 🔔) — master + per-category `SettingToggleRow`s, optimistic writes, absent-row-=-ON derivation, iOS-permission banners (`undetermined` → enable CTA; `denied` → `Linking.openSettings()`; web → informational, toggles still editable since prefs are cross-device).
- **`BroadcastAdminScreen`** (More → admin 📣) — composer (category `ToggleGroup`, title/body, whole-category vs targeted via `PlayerPickerModal` chips), debounced reach line (red at 0 reachable), **Send Now** / **Schedule…** (datetime picker; the sweep fires it), history with status badges + cancel-pending confirm.
- **Deep links**: `${BASE}/more/notifications`, `${BASE}/more/broadcasts`.

## Build requirement

`expo-notifications` is a native module: **push requires an EAS dev/prod build — Expo Go cannot receive remote pushes (SDK 53+).** EAS Build manages the APNs key on the first iOS build. iOS-only in v1 (the `platform` column and plugin already accommodate Android; no FCM configured).

## Adding an event-driven push later (the v2 seam)

1. New `broadcast_categories` row (users are default-ON for it; the settings screen renders it automatically).
2. Publisher inserts a `broadcasts` row with `source='event'`, the category, and `scheduled_for = now()` — the sweep delivers within a minute. Do NOT call Expo from SQL; the row *is* the send request.
3. Optional `data` payload for client-side routing (`broadcastId`/`categoryKey` already ride in every push).

## Debugging a send

`broadcasts.status/error` → `broadcast_push_tickets.error_code` → Edge Function logs (grep by `reqId`) → `net._http_response` / `cron.job_run_details` for the tick. Reach preview ≠ recipient_count should be impossible (same predicate); if you see it, something bypassed `broadcast_recipients`.
