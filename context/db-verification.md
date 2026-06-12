# DB Verification — the rollback-probe suite

The database layer has a repeatable test suite in [supabase/verify/](../supabase/verify/).
It runs against the **live linked database** with zero persistence: every probe
executes real RPC flows inside a transaction that always aborts (success and
failure both exit via `RAISE EXCEPTION`, so no COMMIT path exists). This
amends the old "no test suite" fact for the DB layer only — app-layer
verification remains the Expo dev server.

## How a probe works

A probe is one `DO $$ … $$` block that:

1. **Synthesizes its own fixtures** in-transaction: auth users (`auth.users`
   insert), players, pin seeds, loan products, bet markets. Everything
   vanishes on abort. The only live anchors are the active season and its
   latest open week (`PROBE_SETUP_FAILED` if absent — probes require a running
   league, nothing else).
2. **Impersonates personas** via
   `set_config('request.jwt.claims', …, true)` — player/admin claims with the
   synthetic `sub`, so `auth.uid()` / `current_player_id()` / `is_admin()`
   resolve exactly as they do for real API calls. RLS, triggers, and
   SECURITY DEFINER behavior are all real.
3. **Drives the real RPCs** through full lifecycles (take→repay→payoff,
   create→accept→settle→void, place→settle→archive-sweep…).
4. **Asserts absolutes** — exact balance deltas, statuses, back-link counts
   (every domain-ledger row ↔ exactly 2 pin rows), payouts, and the
   double-entry invariant (every non-`score_credit` type nets to zero within
   the transaction). A violation raises `PROBE_FAIL: <which invariant>`.
5. **Emits a capture** — `RAISE EXCEPTION 'PROBE_RESULT <jsonb>'` carrying a
   normalized dump of the rows the flow wrote. The runner extracts it; the
   exception aborts the transaction.

## The suite

| Probe | Covers |
|---|---|
| [probe-loans.sql](../supabase/verify/probe-loans.sql) | `take_loan`, `repay_loan` (partial + payoff), `process_weekly_loans` (garnish + interest arithmetic), `settle_loans_for_season_close` |
| [probe-pvp.sql](../supabase/verify/probe-pvp.sql) | `create_pvp_challenge`, `accept_pvp_challenge` (escrow), `settle_pvp_challenge` (winner payout), `void_pvp_challenge` (settled-reversal + locked-refund); final deltas return to zero |
| [probe-bets-bounty.sql](../supabase/verify/probe-bets-bounty.sql) | `create_house_bounty`, `enter_bounty_as_hunter`, `settle_bounty` (hunter_win + sponsor_win), `place_house_bet`, `settle_market`→`finalize_bets_for_market` (won + lost), full `settle_betting_for_week(force)` sweep |
| [probe-admin-guards.sql](../supabase/verify/probe-admin-guards.sql) | Negative: all 20 admin RPCs reject player claims with exactly `'Admin only'` |

Runners: [run-probe.sh](../supabase/verify/run-probe.sh) (one probe → capture
JSON; exits non-zero on `PROBE_FAIL`), [run-all-probes.sh](../supabase/verify/run-all-probes.sh)
(the suite). Captures land in gitignored `.verify-artifacts/`.

Related, separate instruments:
- [anon-posture-assert.sql](../supabase/verify/anon-posture-assert.sql) — runs
  automatically inside `refresh-schema-snapshot.sh` after **every** push.
- [policies-dump.sql](../supabase/verify/policies-dump.sql) +
  [diff-policies.sh](../supabase/verify/diff-policies.sh) — RLS catalog
  before/after differ (used for the `is_admin()` policy dedup).
- [generate-rls-dedup.py](../supabase/verify/generate-rls-dedup.py) — the
  generator that produced the dedup migration from a catalog dump.

## When to run what

- **Touching any economy RPC** (`loan_*`, `pvp_*`, `bet_*`, `bounty_*`,
  settlement): run `run-all-probes.sh` before writing the migration (baseline
  green) and after pushing it. For pure refactors, additionally diff the
  before/after `PROBE_RESULT` captures — byte-identical captures prove the
  rewrite changed nothing (this is how the `pin_ledger_double_entry` adoption
  was verified).
- **Touching RLS policies**: capture `policies-dump.sql` before/after and diff.
- **Adding an admin RPC**: add it to `probe-admin-guards.sql`'s call list.
- **Adding an economy feature**: add a probe (copy the fixture preamble),
  assert its deltas/statuses/net-zero, and wire it into `run-all-probes.sh`.

## Known properties (accepted)

- Probes hold brief `FOR UPDATE` locks on real rows (loan products, bounty
  posts) while running — harmless at league scale, but don't run the suite
  mid-archive.
- `settle_betting_for_week(force)` inside the bets probe sweeps the whole live
  week (all rolled back). Its *fixture-scoped* assertions are deterministic;
  the capture's sweep content can vary with live data between runs — diff
  captures within minutes of each other when using differential mode.
- The suite needs an active season with at least one open week.
- Fixture seeds are week-stamped `score_credit` rows, so inside a probe
  transaction the sweep's once-per-week mint guard (keyed on
  `week_id + type` since HYGIENE §2) sees them and skips the real mint.
  Deterministic and assertion-neutral — just don't expect probe captures to
  contain the week's real score credits.
