# PLAN — Email-driven LaneTalk ingestion

**Goal:** Forward a LaneTalk "shared session" email (or send a one-line email with the
link) to a dedicated inbound address and have the games auto-ingest into
`lanetalk_game_imports` — eliminating the app-switch + copy/paste step. The admin
still returns to the app to review classification/mapping and run **Confirm LaneTalk
Data** as today.

**Channel:** Email. **Provider:** Postmark inbound (hosted address, zero DNS).
**Authorization:** sender email allowlist + Postmark webhook secret.

---

## 1. Guiding constraints (non-negotiable for this work)

1. **Do not modify the existing `lanetalk-import` Edge Function or the in-app flow.**
   The app screen ([LanetalkImportAdminScreen](app/src/screens/LanetalkImportAdminScreen.tsx)),
   its hook, `db.ts` `lanetalkImports.run`, and the `lanetalk-import` function stay
   **byte-for-byte unchanged**. We accept duplication to protect what works.
2. **Email path does ingest only — never settlement.** It writes
   `lanetalk_game_imports` rows exactly like the app import does. It never calls
   `settle_lanetalk_props_for_week` or touches `bet_*` / `pin_ledger`. Confirmation
   stays a manual in-app step (see [context/lanetalk-stat-bets.md](context/lanetalk-stat-bets.md)).
3. **All DB writes via the service role inside the Edge Function**, same as today.
   No new migrations required (see §7 for the one optional table we are *not* adding in v1).
4. **Same SSRF posture:** only `shared.lanetalk.com` URLs are ever fetched.

---

## 2. Why a second function instead of refactoring a shared core

The existing function gates on a logged-in admin's JWT
([index.ts:229-248](supabase/functions/lanetalk-import/index.ts#L229)). An inbound
email carries no JWT, so the new entry point must authenticate by **who sent the
email** instead. Two ways to share the import logic:

| Option | Touches existing function? | Drift risk | Decision |
|---|---|---|---|
| **A. Duplicate orchestration, reuse pure helpers unchanged** | No | Two copies of orchestration can drift | **Chosen (v1)** — honors constraint #1 |
| B. Extract shared `runImport()` module, both call it | Yes (edits `index.ts`) | None | Rejected for v1; revisit if drift bites |

**Chosen approach (A):** the new function **imports `parseLanetalk.ts` and `match.ts`
as-is** (they are already standalone modules with no auth in them — read-only reuse,
zero edits) and **re-implements the orchestration body** currently in
[index.ts:336-462](supabase/functions/lanetalk-import/index.ts#L336) (week resolve →
candidate slots → `matchPlayer` → night assembly across links → `loadSlotScores` /
`chooseSlot` → `buildNightRows` → delete+insert). That orchestration plus the helpers
`loadSlotScores` / `rowToNight` / `buildNightRows` get copied into a new file the
email function owns.

> **For the dev partner to weigh:** Option A duplicates ~150 lines of matching
> orchestration. If we expect to keep evolving the matching logic, Option B (one
> shared `_shared/runImport.ts` both functions import) removes the drift risk at the
> cost of editing the existing `index.ts` once. The plan below assumes A per the
> stated constraint; switching to B later is mechanical.

---

## 3. New components

```
supabase/functions/
  lanetalk-import/            # UNCHANGED
    index.ts
    parseLanetalk.ts          # reused unchanged by both
    match.ts                  # reused unchanged by both
  lanetalk-ingest-email/      # NEW — Postmark inbound webhook target
    index.ts                  # webhook auth + sender allowlist + URL extract + reply
    importCore.ts             # duplicated orchestration (week→match→classify→write)
```

`importCore.ts` exports e.g. `importFromUrl(admin, url, log): Promise<ImportResult>`
— the body of [index.ts:268-462](supabase/functions/lanetalk-import/index.ts#L268)
with the **auth gate and the reprocess branch removed** (email path is import-only).
It imports `parseLanetalk` from `../lanetalk-import/parseLanetalk.ts` and the match
helpers from `../lanetalk-import/match.ts`.

---

## 4. `lanetalk-ingest-email` request flow

Postmark POSTs a JSON body for each inbound email
([Postmark inbound payload](https://postmarkapp.com/developer/webhooks/inbound-webhook):
`From`, `FromFull.Email`, `Subject`, `TextBody`, `HtmlBody`, `StrippedTextReply`,
`MessageID`, …).

1. **Method/secret gate.** `POST` only. Authenticate the webhook itself via
   **HTTP Basic Auth embedded in the webhook URL** (`https://user:pass@…`) — Postmark's
   standard mechanism — compared against `LANETALK_INGEST_SECRET`. Reject otherwise
   with 401. (This stops anyone who guesses the function URL.)
2. **Sender allowlist.** Lower-case `FromFull.Email`; require membership in
   `LANETALK_ADMIN_EMAILS` (comma-separated env var). Reject non-members with 403 and
   log the attempt. *(Note: From can be spoofed; the Basic-Auth secret is the real
   guard, the allowlist is defense-in-depth. SPF/DKIM enforcement is a phase-2 option,
   §7.)*
3. **Extract links.** Regex **all** unique `https?://shared.lanetalk.com/…` URLs from
   `TextBody` first, falling back to `HtmlBody`. This handles both a forwarded LaneTalk
   email and a bare pasted link. Zero links → reply "no LaneTalk link found", 200.
4. **Import each link in order** via `importFromUrl(admin, url, log)`. Multiple links
   (a lane-split night sent as several emails, or several links in one forward) compose
   correctly because the orchestration re-reads prior `lanetalk_game_imports` rows for
   the player/week and re-numbers across links — identical to running them one-by-one
   in the app.
5. **Idempotency.** The import is delete-then-insert keyed on (week, player) — safe to
   replay, so a Postmark retry of the same email cannot double-insert. (Optional
   `MessageID` dedup table is §7; not needed for correctness in v1.)
6. **Reply (optional but recommended).** Send a summary back via Postmark's outbound
   API: per link, `"Imported 3 games for Jordan · 3 official"`, or the failure reason
   (`No league week found for 2026-06-22`, `No player match`, `No games found`). Always
   return HTTP 200 to Postmark so it does not retry recoverable cases. **The reply is a
   convenience; the source of truth remains the in-app review screen.**

---

## 5. Configuration

Edge-function secrets (via `supabase secrets set …`, never committed):

| Secret | Purpose |
|---|---|
| `LANETALK_INGEST_SECRET` | Basic-Auth value Postmark must present in the webhook URL |
| `LANETALK_ADMIN_EMAILS` | Comma-separated allowlist of sender addresses |
| `POSTMARK_SERVER_TOKEN` | Outbound token for the summary reply (only if §4.6 enabled) |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are already available to functions.

**Deploy:** `supabase functions deploy lanetalk-ingest-email` (the existing function is
not redeployed). Confirm the new function is in the project's function list.

---

## 6. One-time Postmark setup (≈5 min, done in Postmark UI)

1. Create a Postmark account + a Server.
2. Enable the **inbound stream**; copy the hosted inbound address
   `<hash>@inbound.postmarkapp.com`.
3. Set the inbound **webhook URL** to
   `https://<user>:<LANETALK_INGEST_SECRET>@<project-ref>.functions.supabase.co/lanetalk-ingest-email`.
4. (If replies enabled) verify a sender signature / from-address for outbound.
5. Save the inbound address somewhere handy (or alias it from your normal mail so you
   can just forward LaneTalk's share email to it).

> If we'd rather use an address on a domain we own (e.g. `lanetalk@<ourdomain>`), the
> only change is adding MX records pointing at Postmark and using an inbound domain
> instead of the hosted hash address — same function, same webhook.

---

## 7. Explicitly out of scope for v1 (parked)

- **No shared-core refactor** of the existing function (Option B above).
- **No settlement / confirm automation** — stays manual in-app by design.
- **No `MessageID` dedup table / migration** — import idempotency already covers retries.
- **No SPF/DKIM enforcement** beyond Postmark's own — allowlist + Basic-Auth secret is
  the v1 guard. Can add `FromFull`-vs-DKIM checks later.
- **No SMS path.**
- **No handling of the "needs admin decision" cases beyond a reply** (no-week,
  no-player, lane-split reprocess) — those are resolved in the app as today.

---

## 8. Test plan

Edge functions have no unit suite here; verify against the live function + a real
inbound email, mirroring the existing manual-verification posture.

1. **Happy path:** forward a real LaneTalk share email from an allowlisted address →
   rows appear in `lanetalk_game_imports` for the right week/player; app screen shows
   them identically to an in-app import; reply summary matches.
2. **Multi-link night:** send two share links (separate emails and both-in-one-email) →
   official/recreational classification and game numbering match an in-app two-link
   import.
3. **Auth negatives:** (a) request without the Basic-Auth secret → 401; (b) email from a
   non-allowlisted address → 403, no DB write; (c) email with no LaneTalk URL → 200 +
   "no link" reply, no write.
4. **Recoverable cases:** date with no league week, and a session whose bowler doesn't
   match a slot → 200 + descriptive reply, behaves like the app's `ok:false` toasts.
5. **Replay:** re-deliver the same email → no duplicate rows (idempotent delete+insert).
6. **Regression:** in-app import still works unchanged (existing function untouched).

---

## 9. Work breakdown / sequencing

1. Scaffold `supabase/functions/lanetalk-ingest-email/` with `importCore.ts`
   (duplicated orchestration, auth + reprocess stripped) importing the unchanged
   `parseLanetalk.ts` / `match.ts`.
2. Implement `index.ts`: Basic-Auth gate → allowlist → URL extraction → loop import →
   (optional) reply.
3. Set secrets; deploy the new function only.
4. Postmark account + inbound webhook wiring (§6).
5. Run the §8 test plan end-to-end; confirm in-app flow unaffected.

**Branch:** continue on `url-fixing` or cut a fresh `lanetalk-email-ingest` branch →
PR to `main` via `/pr`.
