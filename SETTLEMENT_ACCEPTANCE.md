# SETTLEMENT_ACCEPTANCE.md

The manual + probe acceptance-test vector checklist for the weekly clock tick
(advance / settle / unsettle / unarchive). Companion:
[context/archive-and-settlement.md](context/archive-and-settlement.md) (as-built),
[context/db-verification.md](context/db-verification.md) (probe harness).

**Two verification layers:**
- **DB (automated, zero-persistence):** `supabase/verify/run-all-probes.sh` — run
  BEFORE and AFTER every economy-touching migration. The split lifecycle lives in
  `probe-settle-lifecycle.sql`; the shim round-trip in `probe-archive-roundtrip.sql`.
- **App (manual, no test suite):** `expo start`, exercise the flows below.

---

## A. DB probe vectors (`probe-settle-lifecycle.sql`, §12 of the plan)

| # | Vector | Assert |
|---|---|---|
| A | `advance_week` | N locked (`is_archived`), N+1 created, `settled_at` NULL, **`bowled_at` unchanged**, **no** score_credit/bet/pvp/loan ledger minted (ledger == pre-advance). |
| B | `settle_week(force)` | pincome mint + score-market + prop settlement + loans/pvp; team_prop won at the materialized total; scoreless bet force-voided; unified House P/L event present and = the §3g predicate; `settled_at` set. |
| C | `settle_week` again | idempotent: no double-mint, ledger + House P/L row unchanged (no duplicate feed event). |
| D | `unsettle_week` | money exactly reversed (ledger sum + row count back to post-advance), week **still locked**, `settled_at` NULL, House P/L event deleted, fill score **stays materialized**. |
| E | `settle_week` (re-derive) | identical to B. |
| F | `unarchive_week` on SETTLED week | both phases reversed, N+1 destroyed, ledger EXACTLY pre-advance, fill reverted to NULL, **`bowled_at` preserved**, run `reversed`. |
| G | `unarchive_week` on ADVANCED-unsettled week | fill revert + N+1 destroy, **zero money delta** (the `settled_at`-gated money reversal is a no-op). |

**Additional vectors:** (1) `preview_settle_week` counts match the actual settle
outcome; (2) House P/L excludes a co-existing settled bounty + settled auction in
the same week (card = bet/pvp/loan subset); (3) late-import re-settle picks up
newly-official props and UPSERTs House P/L; (4) bet placement rejected on a locked
week (`place_house_bet` `is_archived` guard); (5) `getCurrent` returns N+1 during
the advanced window.

---

## B. App flow vectors (`expo start`)

1. **Advance (bowl-night):** MatchupsScreen → "Advance Week". Week locks, N+1
   opens, toast reminds to settle later. Confirm **no** pincome/bet settlement yet
   (bets still pending, balances unchanged).
2. **Import (before/after advance):** LaneTalk import resolves the week by the
   scheduled `bowled_at` regardless of when you advanced (the PR1 fix). The
   optional explicit-week path is deferred (§6c) — not in the UI yet.
3. **Preview warning:** open the Settle modal with a deliberately-missing import —
   the would-void list (from `preview_settle_week`) enumerates the affected
   markets with reasons.
4. **Settle Available:** settles everything gradable; LaneTalk props lacking data
   stay pending; House P/L feed card appears with the full-week `house_net`.
5. **Settle + Void Missing:** (armed) delete-refunds the no-data markets and
   force-voids any stuck bet.
6. **Re-settle after a late import:** the week shows **Re-settle Week**; running it
   settles the newly-official props and refreshes the House P/L card.
7. **Unsettle → re-settle:** (Archives / admin) money reverses, week stays locked,
   scores frozen; re-settle reproduces the same economy.
8. **Unarchive of both states:** unarchive an advanced-unsettled week (zero money
   delta) and a settled week (full reversal); confirm the week reopens for score
   edits and **`bowled_at` survives** (re-import still binds).
9. **Accounting parity:** the admin Pinsino Accounting per-week net matches the
   `sportsbook_weekly_house_result` feed card (both exclude auction/bounty).

---

## C. Known gaps / operational notes

- The **Settle Week** action lives on the LaneTalk import screen. Its week list
  is built from import rows, but advanced weeks that still need settling
  (advanced-unsettled, or settled-with-pending-props) are **injected even with
  zero imports** (empty player list), so they always surface a Settle button.
- Advancing no longer settles: an admin who forgets to Settle leaves bets pending
  and no pincome/House P/L posts. This is the intended two-clock behavior.
- During the PR3→PR4 rollout window the reversal redesign must ship with the split
  (they were released together); a mixed state would let `unarchive_week` null a
  scheduled `bowled_at`.
