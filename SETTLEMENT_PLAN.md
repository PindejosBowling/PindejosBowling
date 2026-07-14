# SETTLEMENT_PLAN.md — Unify weekly settlement around the LaneTalk clock

> **Implementation handoff.** This document is the spec for splitting the weekly economy
> "clock tick" into **Advance** (bowl-night) + **Settle** (next-day, unified), fixing the
> `bowled_at` coupling that makes LaneTalk imports fail, and computing the House weekly P/L
> once, correctly. Read it top-to-bottom before writing code. All DB work is **new
> append-only migrations** in `supabase/migrations/` + a regenerated `supabase/schema.sql`
> snapshot — **never hand-edit `schema.sql`**. Companion as-built docs:
> [context/archive-and-settlement.md](context/archive-and-settlement.md),
> [context/lanetalk-stat-bets.md](context/lanetalk-stat-bets.md),
> [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md).

## 1. Why (problem statement)

Two stacked defects trace to one seam:

1. **The House weekly P/L feed card is wrong.** `sportsbook_weekly_house_result`
   ([schema.sql:6008-6029](supabase/schema.sql)) sums **only** `bet_stake/bet_payout/bet_refund`
   and fires inside `settle_betting_for_week` at archive time — before LaneTalk props settle.
   The admin Accounting view ([useHousePinsinoData.ts:131-139](app/src/hooks/useHousePinsinoData.ts))
   sums **all** `is_house` week rows. Observed: feed says **+400** (sportsbook slice), admin
   says **−292** (full week).

2. **The LaneTalk import "second clock" is structurally forced and fragile.** The import edge
   function binds a session to a week via `weeks.bowled_at = session.date`
   ([lanetalk-import/index.ts:347-361](supabase/functions/lanetalk-import/index.ts)) where
   `session.date` is **Monday-normalized** ([parseLanetalk.ts:94-104](supabase/functions/lanetalk-import/parseLanetalk.ts)),
   but `bowled_at` is stamped `= current_date` at archive
   ([schema.sql:2379](supabase/schema.sql)), **not** the scheduled Monday. So the next-day import
   only matches when the admin archived *on that Monday*; otherwise → `week_not_found`. This
   forces import-after-archive and splits settlement into two clocks.

**Root cause:** `bowled_at` is overloaded — migration comments call it "the scheduled bowl day"
(`20260607010000_pvp_remove_rake.sql:72`) yet archive overwrites it with the archive date.

## 2. Locked decisions (do NOT re-litigate)

| # | Decision |
|---|---|
| D1 | `bowled_at` becomes the **scheduled bowl-Monday**, set at week **creation** (derived from season schedule). Archive/Advance **stops** writing it. Unarchive **stops** nulling it. |
| D2 | Split atomic `archive_week` into **`advance_week`** (bowl-night: lock N + create N+1, **no money**) and **`settle_week`** (next-day: one atomic/idempotent/snapshot-reversible RPC doing **all** money incl. LaneTalk props). Introduces a **LOCKED-BUT-UNSETTLED** week state. |
| D3 | House weekly P/L computed **once** at end of `settle_week`, scope = **week-anchored clocks only** (bets + loans + pvp + lanetalk), **excluding** bounty/auction. Predicate: `is_house AND week_id=W AND auction_id IS NULL AND bounty_post_id IS NULL`. Keep `event_type='sportsbook_weekly_house_result'` + payload key `house_net` stable. Reframe copy off "Sportsbook". |
| D4 | Missing-data policy: `settle_week` voids (delete-refund) prop markets lacking data, **but** a **mandatory pre-settle warning** enumerates every would-void market (server dry-run RPC → confirm modal) so a forgotten import is caught before anything is wiped. |

## 3. New week-state model

| State | `is_archived` | `settled_at` | Meaning |
|---|---|---|---|
| OPEN | `false` | `NULL` | In play; scores editable; bets allowed |
| ADVANCED (locked-unsettled) | `true` | `NULL` | Bowl-night done, standings locked, N+1 open, **no money yet**. LaneTalk import binds here. |
| SETTLED | `true` | `NOT NULL` | All money derived. May be re-settled additively for late imports. |

- **Add `weeks.settled_at timestamptz NULL`** — single source of truth the client branches on to
  offer the Settle UI, and the timestamp of the second clock. Keep `is_archived` as the lock flag.
- **Add `week_archive_snapshot.phase text NOT NULL DEFAULT 'advance'`** CHECK `('advance','settle')`
  so unsettle/unarchive target the correct snapshot rows. `week_archive_runs` stays one row per
  advance→settle cycle: **Advance** creates it (`status='active'`), **Settle** appends `phase='settle'`
  rows + records `details.settled_at`.

**Invariant audit (must verify during impl — the model now has "N locked-unsettled + N+1 open"):**
- `weeks.getCurrent/getActive/getLatestOfCurrentSeason` ([db.ts:1314-1346](app/src/utils/supabase/db.ts))
  key off `is_archived=false` → resolve to N+1. **`settle_week` must target an explicit week id, never these.**
- Standings/history read `is_archived=true` → include N immediately after Advance (correct).
- `getActive` also requires `is_confirmed=true`; fresh N+1 is `is_confirmed=false` until team-gen
  ([AdminGenerateTeamsModal.tsx:272](app/src/components/admin/AdminGenerateTeamsModal.tsx)). The
  advance→team-gen window has a null "active" week — **verify** `RsvpScreen.tsx:51`,
  `AdminGenerateTeamsModal.tsx:96`, `useWeekClock.ts` treat null as "between weeks," not an error
  (they already tolerate the analogous soft-unarchive window).
- `unarchive_week` LIFO guard ([schema.sql:7971-7976](supabase/schema.sql)) checks for a later
  **archived** week; N+1 merely OPEN doesn't trip it (correct).

## 4. Schema changes (new migrations)

1. `weeks.settled_at timestamptz NULL` + partial index `(season_id, is_archived, settled_at)`.
2. `week_archive_snapshot.phase text NOT NULL DEFAULT 'advance'` + CHECK.
3. `weeks_derive_bowled_at` BEFORE INSERT trigger on `weeks` (§6a).
4. New functions: `advance_week`, `settle_week`, `unsettle_week`, `preview_settle_week`; rewritten
   `unarchive_week`. Fold `settle_betting_for_week` + `settle_lanetalk_props_for_week` bodies into
   `settle_week`. Keep thin shims for old names **only if** the probe suite calls them (§9).
5. **Bet-placement `is_archived` guard**: add to the place-bet/parlay/prop RPCs (around
   [schema.sql:2821, 3140](supabase/schema.sql)) so a locked-unsettled week's still-`open` prop
   markets cannot take new stakes between Advance and Settle. **Verify** current placement only
   checks `market.status='open'` and does not already gate on the week.

## 5. Split `archive_week` → `advance_week` + `settle_week`

Source ranges to lift from: `archive_week` [schema.sql:2190-2390](supabase/schema.sql),
`settle_betting_for_week` [schema.sql:5784-6032](supabase/schema.sql),
`settle_lanetalk_props_for_week` [schema.sql:6200-6409](supabase/schema.sql).

### 5a. `advance_week(p_week_id uuid, p_force boolean default false, p_fill_scores jsonb default null) → uuid`
Bowl-night. **No money, no bet settlement, no House P/L.** = front half of today's `archive_week`:
1. Guards: `assert_admin`; week exists; no `active` run (schema.sql:2204-2217).
2. Insert `week_archive_runs` (schema.sql:2221-2223).
3. **Snapshot ONLY the fill-score preimages, `phase='advance'`** (schema.sql:2334-2337). Do **not**
   capture money preexisting-id/preimage sets here — they move to Settle.
4. Fill materialization + coverage guard unchanged (schema.sql:2308-2372).
5. **Lock:** `UPDATE weeks SET is_archived=true` — **remove the `bowled_at=current_date` write**
   (was schema.sql:2379). `bowled_at` is now creation-set and immutable.
6. Create N+1 (schema.sql:2383-2385) — trigger derives its `bowled_at` (§6a).

### 5b. `settle_week(p_week_id uuid, p_void_missing boolean default false, p_force boolean default false) → jsonb`
Next-day, targets the explicit locked-unsettled week. **One atomic transaction, all money.**
1. Guards: `assert_admin`; week exists; `is_archived=true` (must be advanced first); find `active` run.
2. **Money snapshot capture, `phase='settle'`, guarded once per run** (skip if run already has
   `phase='settle'` rows): `preexisting_id` for `pin_ledger` (week_id **OR** bet-linked), `loan_ledger`,
   `pvp_ledger`, `activity_feed_events` (schema.sql:2229-2245); `preimage_row` for
   `bet_markets/bet_selections/bets/bet_legs/pvp_challenges/pvp_challenge_offers/loans`
   (schema.sql:2250-2294). **Capturing at settle (not advance) is the central correctness point** —
   it makes re-settle and late imports reversible.
3. **Ordered steps (keep each existing idempotency guard):**

   | # | Step | Source | Idempotency guard |
   |---|---|---|---|
   | a | score_credit pincome mint | schema.sql:5810-5825 | `NOT EXISTS score_credit for week` |
   | b | O/U settle (incl. night lines) | schema.sql:5830-5864 | market `status='settled'` early-return |
   | c | moneyline settle | schema.sql:5867-5880 | same |
   | c′ | team_prop `total_pins` (clock=archive) | schema.sql:5889-5929 | same |
   | **c″** | **LaneTalk player + team props (FOLDED IN)** | schema.sql:6224-6404 | market `status='settled'`; `p_void_missing` → delete-refund missing (schema.sql:6396-6400); else leave pending |
   | d | loans (garnish + interest) | schema.sql:5931-5932 | per-(loan,week) guard on `loan_ledger` types |
   | e | PvP | schema.sql:5934-5936 | challenge status early-return |
   | f | backstop | schema.sql:5952-6006 | state-driven; **narrow the prop exemption** (below) |
   | g | **unified House P/L** (§7) | UPSERT (not skip) |

4. **Backstop change (step f):** props now settle in c″, so **remove the blanket prop/lanetalk
   exemption** (schema.sql:5960-5961, 5972-5973, 5996-5997) and replace with a **narrowed** one:
   a bet is exempt from the pending-count/void only if its sole unsettled legs are on a prop market
   **still lacking import data** AND `p_void_missing=false`. With `p_void_missing=true`, c″ already
   deleted those, so none remain.
5. **Mark settled:** `UPDATE weeks SET settled_at = now() WHERE settled_at IS NULL` (preserve
   first-settle time across re-settles). Record run `details` counts.
6. **Return** `jsonb { settled, voided, left_pending, house_net }` for the toast.

**Re-settle for late imports = call `settle_week` again** (`p_void_missing=false`): additive via the
per-step guards + House P/L UPSERT. No unsettle needed for the "more data arrived" case.

## 6. `bowled_at` derivation + backfill + edge function

### 6a. Derivation (DB trigger — covers both creation paths, no app change required)
`weeks_derive_bowled_at` BEFORE INSERT on `weeks`: if `NEW.bowled_at IS NULL`, set
`NEW.bowled_at = season.start_date + (NEW.week_number - 1) * 7`.
- Reproduces the existing backfill (`20260602143542_backfill_bowled_at.sql`) — S1 `start_date`
  `2026-03-16` is a Monday and weeks map to consecutive Mondays.
- Week 1 insert ([SeasonRegistrationScreen.tsx:115](app/src/screens/SeasonRegistrationScreen.tsx))
  and N+1 insert in `advance_week` both get filled automatically.
- **Guard:** assert/warn if `season.start_date`'s weekday ≠ `season.bowling_night`. `parseLanetalk.toMonday`
  hardcodes Monday (parseLanetalk.ts:94) — flag any non-Monday season as needing the parser
  generalized (document as out-of-scope latent mismatch).

### 6b. Backfill migration
- Backfill `settled_at` for already-archived historical weeks (set to their run's `archived_at`, or
  `bowled_at`) so they read as SETTLED and don't show a spurious Settle button.
- Re-assert `bowled_at` via the formula for any open/future weeks so live data is consistent before
  the trigger lands.

### 6c. Edge function ([lanetalk-import/index.ts](supabase/functions/lanetalk-import/index.ts))
- Keep the `bowled_at = session.date` bind (index.ts:347-361) — now reliable (scheduled Monday
  present before advance).
- **Thread an optional admin-selected `weekId`** on the import path exactly like `reprocessWeekId`
  is already threaded end-to-end (index.ts:270-273, [db.ts:1517](app/src/utils/supabase/db.ts)):
  when present, bind directly and skip date resolution. Safety valve for date-parse/lane-split nights.

## 7. Unified House weekly P/L (replaces the bet-only sum)

Replace [schema.sql:6011-6015](supabase/schema.sql) with, at the **end of `settle_week` step g**:

```sql
SELECT COALESCE(SUM(amount), 0)
  FROM public.pin_ledger
 WHERE is_house = true
   AND week_id = p_week_id
   AND auction_id IS NULL       -- auctions: own feed cards + cross-week cron clock
   AND bounty_post_id IS NULL;  -- bounties: own feed cards + indefinite manual clock
```

Rationale: `pin_ledger` carries explicit FK columns `bet_id/loan_ledger_id/pvp_ledger_id/bounty_post_id/auction_id`
([schema.sql pin_ledger DDL](supabase/schema.sql)); bounty/auction house rows **do** carry `week_id`
(so `week_id` alone is insufficient — exclude by the FK columns). This captures bets (incl. LaneTalk
prop payouts — week-stamped + bet-linked), PvP, loan garnishment; excludes bounty/auction.

- **Idempotency = UPSERT, not skip.** Change the guard at schema.sql:6018-6029: if the
  `(season, week, event_type='sportsbook_weekly_house_result')` event exists, **update** its
  `house_net` payload; else insert. Keeps a stable row id for the snapshot; re-settle refreshes it.
- **Copy:** reframe [activityFeedTemplates.ts:239-247](app/src/utils/activityFeedTemplates.ts) to the
  House's **overall** weekly result — drop "for the Sportsbook" (line 245). Keep `event_type` +
  `house_net` key stable.
- **Reconciliation note:** the admin Accounting per-week sum
  ([useHousePinsinoData.ts:131-139](app/src/hooks/useHousePinsinoData.ts)) currently includes
  bounty/auction. Either apply the same `auction_id/bounty_post_id IS NULL` predicate there for
  parity, or document that the feed card is the "week-anchored clocks" subset. **Pick one; don't
  leave them silently divergent.**

## 8. Dry-run "would-void" preview (D4 guardrail)

### 8a. `preview_settle_week(p_week_id uuid) → jsonb` (read-only, `STABLE`, admin-gated)
Runs the **exact** coverage predicates `settle_week` uses, mutates nothing. For every non-settled
market in the week, classify `settleable` vs `would_void` + reason:
- LaneTalk player/team props: reuse completeness guards (schema.sql:6246-6259 game / 6289-6299 night
  / 6355-6371 player-night); no gradable value → `would_void` (delete-refund).
- Score-derived markets (O/U/moneyline/team-total): no scores → would `close` → their bets hit the
  backstop → `would_void` under force.

Return `{ settleable: int, missing_count: int, would_void: [{market_id, market_type, title, reason}] }`.
This is authoritative (server-side) and **replaces** the client-side coverage mirror in
[LanetalkConfirmModal.tsx:57-84](app/src/components/admin/LanetalkConfirmModal.tsx).

### 8b. Client `AdminSettleModal` (new; model on `LanetalkConfirmModal.tsx`)
- On open: call `preview_settle_week`; render a **mandatory warning** listing every `would_void`
  market (title + reason).
- Actions (armed pattern, mirrors existing modal):
  - **Settle Available** → `settle_week(week, void=false, force=false)` — additive; safe to re-run
    after late imports; leaves would-void markets pending.
  - **Settle + Void Missing** (armed, danger; only when `missing_count > 0`) →
    `settle_week(week, void=true, force=true)`.
- Reuse the toast summary shape (LanetalkConfirmModal.tsx:92-94), now returned by `settle_week`.

## 9. Reversal redesign (both new states)

### 9a. Re-settle — `settle_week` again (additive). Primary "late import arrived" path (§5b).

### 9b. `unsettle_week(p_week_id uuid) → void` — reverse money only, keep week advanced
For "settlement was wrong, money already moved." Operates on **`phase='settle'` rows only**:
1. Delete settlement-inserted `activity_feed_events/pin_ledger/pvp_ledger/loan_ledger` not in the
   run's `phase='settle'` `preexisting_id` set, excluding `auction_id` (reuse schema.sql:8017-8046).
2. Restore `phase='settle'` `preimage_row` payloads (reuse schema.sql:8051-8102).
3. `UPDATE weeks SET settled_at = NULL`. Leave `is_archived=true`, run stays `active`.
4. Delete the run's `phase='settle'` snapshot rows so the next `settle_week` re-captures cleanly.

### 9c. `unarchive_week(p_week_id, p_force)` — rewritten, phase-branched
LIFO + downstream guards unchanged (schema.sql:7970-8008).
- **If `settled_at IS NOT NULL`:** first do the §9b money reversal (`phase='settle'`), then continue.
- **Advance reversal (both states):** revert `phase='advance'` fill `scores` preimages to NULL
  (schema.sql:8106-8110); destroy N+1 (rsvp delete + week delete, schema.sql:8117-8120); reopen N
  `is_archived=false`; **DROP the `bowled_at=NULL` write** (was schema.sql:8126) — `bowled_at` is now
  the immutable scheduled date and must survive so re-import still binds; `settled_at=NULL`.
- Mark run `reversed` (schema.sql:8128-8130).

**Two distinct repair paths — document clearly:**
- `unsettle_week` = "re-derive money from the *same* frozen scores / newer imports" (week stays locked).
- `unarchive_week` = "reopen to edit scores" (full reversal). LaneTalk imports can change between
  unsettle/re-settle *without* unarchiving (imports write `lanetalk_game_imports`, not frozen `scores`).

## 10. App-layer changes

- **`AdminArchiveModal.tsx` → Advance:** copy "Advance Week" (:67, :85-86); keep `getActive()` (:33)
  to find open+confirmed N; call `archives.advanceWeek` instead of `archiveWeek` (:42). Remove the
  "remain pending" force retry (:46-48) — no settlement at advance (force here only covers the
  coverage guard).
- **`MatchupsScreen.tsx`** archive bar (:344, :612-658): relabel "Archive & Advance" → "Advance Week".
- **New `AdminSettleModal`** (§8b) mounted from
  [LanetalkImportAdminScreen.tsx:499-506](app/src/screens/LanetalkImportAdminScreen.tsx) (replace the
  `LanetalkConfirmModal` mount and the "Confirm LaneTalk Data" trigger :438), gated on
  `week.is_archived && settled_at == null`.
- **`db.ts`** ([app/src/utils/supabase/db.ts](app/src/utils/supabase/db.ts)):
  `archives.advanceWeek(weekId, force, fillScores)`, `settleWeek(weekId, voidMissing, force)`,
  `unsettleWeek(weekId)`, `previewSettleWeek(weekId)`; `unarchiveWeek` signature unchanged (:1373).
  Replace `settleLanetalkProps` usage (:603-604) with `settleWeek`. `lanetalkImports.run` (:1513):
  add optional `weekId` param threaded into `invokeLanetalk` (mirror `reprocessWeek` :1517).
- **`LanetalkImportAdminScreen.tsx` / `useLanetalkImportAdmin.ts`:** import may precede advance; add a
  week picker; move settle trigger behind the advanced-unsettled gate.
- **`activityFeedTemplates.ts:239-247`:** reframe copy (§7).
- **`database.types.ts`:** regenerate for new columns/RPCs.

## 11. PR chunking & sequencing (each independently shippable, probe-gated)

**Run `supabase/verify/run-all-probes.sh` before AND after every economy-touching PR** (hard rule),
and extend acceptance vectors (§12).

- **PR 1 — `bowled_at` semantics (low risk; fixes imports even before the split):** creation trigger
  (§6a) + backfill (§6b) + edge-function optional explicit `weekId` (§6c). Land on production first.
- **PR 2 — schema scaffolding:** `weeks.settled_at`, `week_archive_snapshot.phase`, bet-placement
  `is_archived` guard. No behavior change (settled_at backfilled).
- **PR 3 — the split (highest risk):** `advance_week` + `settle_week` (fold
  `settle_betting_for_week` + `settle_lanetalk_props_for_week`, narrow the backstop exemption, unified
  House P/L UPSERT) + `preview_settle_week`. Deprecate old RPCs (shims if probes need them).
- **PR 4 — reversal redesign:** `unsettle_week`, rewritten `unarchive_week`, drop `bowled_at=NULL`
  reset. Extend `probe-archive-roundtrip.sql` (§12).
- **PR 5 — app layer:** Advance modal, `AdminSettleModal` + preview, db.ts RPCs, import week picker,
  feed copy, types regen.
- **PR 6 — docs:** update `context/archive-and-settlement.md` (§1 diagram, §3 table, §4 reversal),
  `PIN_ECONOMY_SCHEMA.md`, `context/lanetalk-stat-bets.md`; create/extend `SETTLEMENT_ACCEPTANCE.md`
  (**referenced at context/archive-and-settlement.md:19 but currently absent from the tree**).

Ship PR 3+4 together behind a brief maintenance window (admin flow changes from one tap to two).
`unarchive_week` fully reverses a settled week, so PR 3/4 are recoverable in production.

## 12. Verification (probes + acceptance vectors)

Extend `supabase/verify/probe-archive-roundtrip.sql` into the split lifecycle (zero-persistence
rollback probes; see [context/db-verification.md](context/db-verification.md)):

- **A. `advance_week`** → assert: N locked (`is_archived=true`), N+1 created, `settled_at` NULL,
  `bowled_at` **unchanged**, and **no** score_credit/bet/pvp/loan ledger rows minted.
- **B. `settle_week`** → assert: pincome mint, score-market + prop settlement, loans/pvp, unified
  House P/L present + equal to the §7 predicate, `settled_at` set.
- **C. `settle_week` again (idempotency)** → no double-mint; House P/L unchanged.
- **D. `unsettle_week`** → money exactly reversed (season ledger `SUM` + row counts back to
  post-advance), week still locked.
- **E. `settle_week` (re-derive)** → identical to B.
- **F. `unarchive_week` on SETTLED week** → both phases reversed, N+1 destroyed, season ledger `SUM` +
  row count EXACTLY pre-advance; `bowled_at` preserved.
- **G. `unarchive_week` on ADVANCED-unsettled week** → fill revert + N+1 destroy, **zero** money delta.

**New vectors:** (1) `preview_settle_week` counts match actual settle outcome; (2) House P/L excludes
a co-existing **settled bounty + settled auction** in the same week (assert card = bet/pvp/loan subset);
(3) late-import re-settle picks up newly-official props and updates House P/L; (4) bet placement
rejected on a locked week; (5) `getCurrent` returns N+1 during the advanced window.

**App verification (no test suite):** run `expo start`; exercise Advance (bowl-night), import
(before/after advance), preview warning with a deliberately-missing import, Settle Available, Settle +
Void Missing, re-settle after a late import, unsettle→re-settle, unarchive of both states.

## 13. Risks & edge cases

- **Snapshot timing (central):** money `preexisting_id`/`preimage` MUST be captured at settle, not
  advance — else a bet/import landing between advance and settle corrupts reversal. Enforced by
  settle-time capture + the bet-placement `is_archived` guard.
- **Fix-bad-scores vs re-derive-money:** scores are editable only when unarchived; `unsettle_week`
  keeps the week locked. To fix scores → `unarchive_week` (reopen). To re-derive money from same
  scores / new imports → `unsettle`/re-settle. Document both.
- **Weeks with no props/bets:** steps a/d/e still run; House P/L may be 0 → still UPSERT (harmless,
  matches "compute once").
- **Bounty/auction exclusion:** they carry `week_id` on house rows → must exclude by
  `bounty_post_id/auction_id IS NULL` (§7). Regression-test explicitly.
- **`bowling_night != Monday`:** trigger formula + `toMonday` assume Monday — assert/guard + document.
- **`bowled_at` immutability through unarchive:** dropped the NULL reset — **verify** nothing relies on
  `bowled_at IS NULL` to mean "reopened/unarchived."
- **N+1 already has activity before unarchive:** existing downstream guard (schema.sql:7990-8008) still
  applies.

## 14. Critical files

| File | Role |
|---|---|
| [supabase/schema.sql](supabase/schema.sql) | Source of `archive_week` (2190-2390), `settle_betting_for_week` (5784-6032), `settle_lanetalk_props_for_week` (6200-6409), `unarchive_week` (7944-8132), `pin_ledger_double_entry` (4301-4334). Re-express as new migrations; regenerate snapshot last. |
| [supabase/functions/lanetalk-import/index.ts](supabase/functions/lanetalk-import/index.ts) | Week bind (347-361); add explicit `weekId` path (like `reprocessWeekId` 270-273). |
| [supabase/functions/lanetalk-import/parseLanetalk.ts](supabase/functions/lanetalk-import/parseLanetalk.ts) | `toMonday` (94-104) — Monday assumption to document. |
| [app/src/utils/supabase/db.ts](app/src/utils/supabase/db.ts) | weeks resolution (1314-1353), archives (1360-1374), lanetalkImports (1511-1517), settleLanetalkProps (603-604). Add advance/settle/unsettle/preview RPCs. |
| [app/src/components/admin/AdminArchiveModal.tsx](app/src/components/admin/AdminArchiveModal.tsx) | Repurpose → Advance. |
| [app/src/components/admin/LanetalkConfirmModal.tsx](app/src/components/admin/LanetalkConfirmModal.tsx) | Model for new `AdminSettleModal`. |
| [app/src/screens/LanetalkImportAdminScreen.tsx](app/src/screens/LanetalkImportAdminScreen.tsx) | Import UI; mount Settle modal; week picker. |
| [app/src/hooks/useHousePinsinoData.ts](app/src/hooks/useHousePinsinoData.ts) | Admin Accounting P/L (131-139) — reconcile predicate (§7). |
| [app/src/utils/activityFeedTemplates.ts](app/src/utils/activityFeedTemplates.ts) | Feed copy (239-247). |
| [supabase/verify/probe-archive-roundtrip.sql](supabase/verify/probe-archive-roundtrip.sql) | Extend to advance/settle/unsettle/re-settle/unarchive vectors. |
| [context/archive-and-settlement.md](context/archive-and-settlement.md) | As-built doc to update (§1/§3/§4). |
