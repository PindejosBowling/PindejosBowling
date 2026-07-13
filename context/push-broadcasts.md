# Push Broadcasts — admin push notifications with user opt-out

**"Broadcast" = an admin-composed push notification** (send-now or scheduled), delivered to iOS devices via the Expo Push Service. Deliberately distinct from the in-app badge **notification framework** ([notifications.md](notifications.md)) — that system counts pending actions inside the app; this one sends real APNs pushes. Nothing in this feature uses the bare word "notification" except the user-facing screen title.

Design contract (grilled 2026-07-07): admin-composed broadcasts in v1; event-driven pushes via `broadcasts.source='event'` (now built — see "Automated event-driven pushes" below); fixed category catalog; defaults ON after iOS permission; **opt-out always wins, including targeted sends**.

## Why the DB is involved at all

A push is delivered by Apple to a *device token*, not a user — tokens must live somewhere central the sender can read. And iOS displays a remote push before app code runs, so an opted-out user can't be filtered client-side: **opt-out must be enforced server-side at send time.** Hence tokens + preferences + the queue all live in Postgres, and one Edge Function does the sending.

## Tables (migrations `20260708010131` / `010231` / `010718`)

| Table | Purpose | RLS posture |
|---|---|---|
| `broadcast_categories` | Catalog users toggle / admins pick. Live rows: `league` (announcements incl. reminders) and `pinsino` (economy incl. automated Market Moves). History: `economy`→`pinsino` rename `20260712201406`; `market_moves` consolidated into `pinsino` `20260713130611`; `reminders` consolidated into `league` `20260713132059`. Future push types = new rows | authenticated SELECT; writes are migrations |
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

- **`app/src/utils/pushTokens.ts`** — the ONLY file touching `expo-notifications` (dynamic imports + web guards; the GitHub Pages bundle never evaluates the native module). `syncPushToken()` runs on every authenticated app open (`App.tsx`): prompts once when `undetermined`, no-ops when denied/web/simulator/read-only, otherwise registers via RPC (the heartbeat). Sign-out best-effort unregisters (dynamic import from `authStore` to avoid the import cycle). Also installs the **tap handler** (see "Tap destinations" below).
- **`db.ts`** — `push` (token RPCs, categories, pref upserts) and `broadcasts` (listRecent/create/cancel/reach/sendNow; `sendNow` normalizes Edge-Function errors like `lanetalkImports`).
- **`NotificationSettingsScreen`** (More → league tools 🔔) — master + per-category `SettingToggleRow`s, optimistic writes, absent-row-=-ON derivation, iOS-permission banners (`undetermined` → enable CTA; `denied` → `Linking.openSettings()`; web → informational, toggles still editable since prefs are cross-device).
- **`BroadcastAdminScreen`** (More → admin 📣) — composer (category `ToggleGroup`, title/body, whole-category vs targeted via `PlayerPickerModal` chips), debounced reach line (red at 0 reachable), **Send Now** / **Schedule…** (datetime picker; the sweep fires it), history with status badges + cancel-pending confirm.
- **Deep links**: `${BASE}/more/notifications`, `${BASE}/more/broadcasts`.

## Tap destinations (push deep links)

An admin can pick a **landing page** per broadcast — tapping the push navigates there (e.g. an RSVP nag lands on RSVP, an auction announcement lands on Auction House). No schema or Edge-Function change was needed: the composer stores a catalog key in `broadcasts.data.route`, and the sender already spreads `data` into every push payload.

- **`app/src/utils/broadcastTargets.ts`** — the catalog: `key → { label, tab, screen? }`. Keys are a **wire format** (they live in sent pushes and DB rows) — never rename one; add a new entry instead. Unknown/absent keys are a silent no-op (the push just opens the app), so old builds tolerate new targets. **Adding a target = adding one row here** (plus nothing else).
- **`app/src/navigation/navigationRef.ts`** — module-level `createNavigationContainerRef` (wired in `App.tsx`) + `openBroadcastTarget(key)`, which queues the navigation until the container's `onReady` when a cold-start tap arrives before the navigator mounts.
- **Tap handling** lives in `pushTokens.ts`: `addNotificationResponseReceivedListener` (foreground/background taps) + `getLastNotificationResponseAsync` (cold start from a killed app), deduped by notification identifier so a tap navigates exactly once.
- **Composer**: the "TAP DESTINATION" pill row (default "None (opens app)"); history rows show `→ <label>`.
- **Event-driven pushes (v2)** get this for free: insert the `broadcasts` row with `data: {'route': '<catalog key>'}`.

## Build requirement

`expo-notifications` is a native module: **push requires an EAS dev/prod build — Expo Go cannot receive remote pushes (SDK 53+).** EAS Build manages the APNs key on the first iOS build. iOS-only in v1 (the `platform` column and plugin already accommodate Android; no FCM configured).

## Automated event-driven pushes — Market Moves rules (the v2 seam, as built)

The v2 seam is now implemented (migration `20260713122551_broadcast_event_rules`): admins couple individual Activity Feed event types to automatic pushes. **Future-proofing is structural** — the UI enumerates the live `activity_event_catalog` and the trigger looks rules up by `event_type`, so a new Market Moves event type (activity-feed.md Recipe A) appears in the admin UI automatically (rule-less = off) with zero changes to this layer.

- **`broadcast_event_rules`** — one optional rule per catalog `event_type` (PK + FK → `activity_event_catalog` ON DELETE CASCADE): `enabled`, `category_id` (admin-picked; default choice = the `pinsino` category — all Market Moves are Pinsino activity, so one category covers admin-composed economy pushes and automated ones), `title_template`/`body_template`, `route_key` (a `broadcastTargets.ts` wire key, NULL = push just opens the app; not FK'd — unknown keys are the documented client no-op). Admin-RLS direct writes, same posture as `broadcasts` INSERT. **No seeded rules**: all couplings ship off, and notification copy never lives in migrations.
- **Templates** render server-side at event time via `render_broadcast_event_template(template, event)`: `{actor}`/`{subject}`/`{secondary}` → `players.first_name` (missing player → `Someone`), `{payload.<key>}` → `public_payload->>key` (missing key → empty string). Unrecognized token shapes (`{typo}`) pass through verbatim — visible in the delivered push, self-correcting. Output is trimmed + clamped to the `broadcasts` length CHECKs, with hardcoded fallbacks if a template renders empty.
- **The publisher is a trigger**: `enqueue_broadcast_for_activity_event()` (SECURITY DEFINER), AFTER INSERT on `activity_feed_events`. Skips non-`public`/non-`published` rows and rule-less/disabled types; otherwise inserts a `broadcasts` row with `source='event'`, `created_by = NULL` (column now nullable, CHECK `created_by IS NOT NULL OR source='event'`), `scheduled_for = now()` (the sweep delivers within a minute — the row *is* the send request, never call Expo from SQL), and `data = {route, event_type, activity_event_id}` (the audit thread back to the feed row). **Exactly-once**: `publish_activity_event`'s `ON CONFLICT DO NOTHING` dedup means replays never insert a row, so the trigger never re-fires. **Non-fatal by construction**: the body is wrapped in an `EXCEPTION WHEN OTHERS → RAISE WARNING` guard — a push failure can never roll back the economy transaction that published the event. AFTER **INSERT only**, deliberately: `restore_activity_event` (suppressed→published UPDATE) must not push a stale event late.
- **Suppress cancels pending**: `suppress_activity_event` also flips the coupled broadcast `pending → canceled` (matched via `data->>'activity_event_id'`). Only within the ≤60 s pre-sweep window — after the sweep the push is sent (accepted).
- **Admin UI**: `BroadcastAdminScreen` → collapsible "AUTOMATED — MARKET MOVES" section between composer and history: every catalog type grouped by feature (`featureMeta` icons), a Switch per type, tap → `RuleEditModal` (templates with placeholder hint, category `ToggleGroup`, tap-destination pills, enabled toggle). First enable on an unconfigured type routes through the editor so templates/category are confirmed before anything can fire. History rows for `source='event'` show an **AUTO** badge (`created_by` is NULL, so the `by <name>` fragment self-hides); pending ones keep the normal Cancel affordance. Data path: `db.ts broadcastEventRules` (`listCatalog` = catalog LEFT JOIN rules to-one embed, `upsert`, `setEnabled`) via `useBroadcastAdminData.rawEventRules`.
- **Caveats**: an `unarchive_week` → re-archive re-publishes non-auction feed rows (unarchive *deletes* them, so the dedup indexes don't protect) and therefore re-pushes — rare admin op, accepted. High-volume types (`sportsbook_bet_placed` = one push per bet) are the admin's toggle choice; the rule editor says so.

## Debugging a send

`broadcasts.status/error` → `broadcast_push_tickets.error_code` → Edge Function logs (grep by `reqId`) → `net._http_response` / `cron.job_run_details` for the tick. Reach preview ≠ recipient_count should be impossible (same predicate); if you see it, something bypassed `broadcast_recipients`.
