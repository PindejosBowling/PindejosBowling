# TODO — DB Function & Flow Hygiene (Audit §2: Function & flow simplification)

> From the 2026-06-11 database-layer audit of [supabase/schema.sql](supabase/schema.sql).
> Companion docs: [TODO_DB_CONSOLIDATION.md](TODO_DB_CONSOLIDATION.md),
> [TODO_DB_PERFORMANCE.md](TODO_DB_PERFORMANCE.md), [TODO_DB_SECURITY.md](TODO_DB_SECURITY.md).
>
> **Sequencing:** item 1 (helpers) goes FIRST among all four docs' RPC work — the
> CONSOLIDATION rewrites and SECURITY policy dedup both build on these helpers.

Workflow per [context/agent-rules.md](context/agent-rules.md) §12: migration file →
`db push` → `./supabase/refresh-schema-snapshot.sh` → regen types (only when the
public schema shape changes) → update prose docs.

---

## 1. Shared assertion/lookup helpers

Four snippets are copy-pasted across the function layer:

| Snippet | Occurrences | Helper |
|---|---|---|
| `IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN RAISE` | ~20 | `assert_admin()` |
| `SELECT id INTO v FROM players WHERE user_id = auth.uid()` + null check | ~9 | `current_player_id()` (raises if no link) |
| `SELECT id FROM seasons WHERE is_active AND NOT registration_open` + null check | ~5 | `current_season_id()` (raises if none) |
| `SELECT COALESCE(SUM(amount),0) FROM pin_ledger WHERE player_id=… AND season_id=…` | ~8 | `pin_balance(p_player uuid, p_season uuid)` |

### Migration A — `db_assert_helpers`

**Status: ✅ DONE 2026-06-12** — migration `20260612130855_db_assert_helpers`,
additive only (adoption pending in Migrations B+). Grants verified on live:
anon=false everywhere, authenticated only on `is_admin()`. One hardening:
`assert_admin()` uses `IS DISTINCT FROM` (the inline `<> 'admin'` snippet
passes silently on a missing role claim).
- All four as `LANGUAGE sql`/`plpgsql`, `SECURITY DEFINER`, `SET search_path TO ''`,
  `STABLE` where applicable.
- `is_admin() RETURNS boolean` as the policy-friendly sibling of `assert_admin()`
  (SECURITY doc item 2 consumes it — define it here once).
- `REVOKE EXECUTE … FROM PUBLIC, anon` on all; `authenticated` may keep EXECUTE on
  `is_admin`/`current_player_id` only if a policy/client ever needs them (default:
  revoke everything; the SECURITY DEFINER RPCs run as owner and don't need grants).

### Migrations B+ — adopt in batches
Fold adoption into the same `CREATE OR REPLACE` batches as
[TODO_DB_CONSOLIDATION.md](TODO_DB_CONSOLIDATION.md) §2 (loans → pvp → bets/bounty),
plus an admin-tools batch: `archive_week`, `unarchive_week`, `cancel_*`,
`close_*`, `settle_market*`, `settle_lanetalk_props_for_week`,
`remove_over_under_markets_for_game`, `create_*_bounty`, `playoff_*`,
`suppress/restore_activity_event`, `create_system_activity_event`.

### Verification
- `supabase db query` each helper under an anon/authenticated role grant check
  (`SELECT has_function_privilege('anon', 'public.assert_admin()', 'EXECUTE')` → false).
- Smoke the admin flows (archive, settle, cancel) and player flows (bet, loan,
  pvp) on the dev server.

---

## 2. Fix the `score_credit` idempotency guard (string-match → `week_id`)

`settle_betting_for_week` guards the weekly mint with
`description LIKE 'Week ' || N || ' %'` — display text as a uniqueness key.
`pin_ledger.week_id` now exists and is stamped by the mint itself.

### Migration — `score_credit_guard_week_id`

**Status: ✅ DONE 2026-06-12** — migration `20260612175222_score_credit_guard_and_pvp_expired`
(commit `5e48d77`). Backfill check returned 0 NULLs (no DML needed); guard now
`WHERE week_id = p_week_id AND type = 'score_credit'`. Probe-verified.

1. **Backfill check first** (read-only):
   `SELECT count(*) FROM pin_ledger WHERE type='score_credit' AND week_id IS NULL`.
   If > 0, backfill in this migration by parsing `description` (`'Week N Game …'`)
   joined to `weeks(season_id, week_number)` — one-time DML.
2. Swap the guard to
   `WHERE week_id = p_week_id AND type = 'score_credit'`.
3. (Optional hardening) partial unique index is NOT possible per (player, week,
   game) without a game column — skip; the guard + single archive path suffices.

### Verification
- Archive a dev week twice (second run no-ops the mint); unarchive restores.

---

## 3. Write down the reversal rule (delete-refund vs append-reversal)

Two philosophies coexist:
- **Physical DELETE of ledger rows**: `cancel_bet`, `cancel_loan`,
  `cancel_pvp_challenge`, `cancel_bounty`, `refund_bets_before_market_delete`,
  `remove_over_under_markets_for_game`.
- **Append reversing entries**: `void_pvp_challenge`, PvP push refunds, bet
  push/void refunds.

No code change required — the split is actually principled (deletes only ever
remove *pre-settlement escrow pairs*; post-settlement money always reverses by
append). The debt is that it's nowhere stated, so every new feature re-derives it.

### Task (docs only)

**Status: ✅ DONE 2026-06-12** — "Reversal rule" subsection added to
`supabase/PIN_ECONOMY_SCHEMA.md` §4 (after the ref-column policy) + pointer in
`context/archive-and-settlement.md` under the unarchive reversal steps.

- Add a **"Reversal rule"** subsection to
  [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) and a pointer in
  [context/archive-and-settlement.md](context/archive-and-settlement.md):
  *Delete-refund is allowed only for unsettled escrow (the paired stake rows of a
  bet/contract/bounty that never reached settlement), always by the feature's root
  ref column. Anything after settlement is reversed by appending offsetting rows.
  `unarchive_week` is the single sanctioned exception (snapshot-based surgical
  reversal).*

---

## 4. Normalize `search_path` on every function

Current state: most functions `SET search_path TO ''`; `playoff_*` (6 functions),
`custom_access_token`, `link_auth_user_to_player` use `'public'`;
`prevent_non_open_season_delete` sets none (SECURITY-relevant since it runs as a
trigger).

### Migration — `normalize_search_path`

**Status: ✅ DONE 2026-06-12** — migration `20260612172957_normalize_search_path`
(commit `d51a834`), generated from the live catalog. **Deliberate deviation:**
`SET search_path TO 'public','pg_temp'` instead of `''`+qualify — same security
property (pg_temp-first shadowing closed), zero body-rewrite risk.
`custom_access_token` verified by direct invocation; a real OTP login check by
the user is still outstanding.

1. `CREATE OR REPLACE` each of the 8 outliers with `SET search_path TO ''` and
   fully qualified `public.` table refs.
2. **Caution — `custom_access_token` is the JWT claims hook** (runs as
   `supabase_auth_admin`). Change it last, verify login immediately after push,
   and keep the previous body in the migration comment for fast rollback.
3. `prevent_non_open_season_delete`: also qualify and keep its `errcode`.

### Verification
- Log in via OTP (exercises the hook + `link_auth_user_to_player`).
- Run a playoff draft create/pick/undo/reset cycle on the dev server.

---

## 5. PvP status vocabulary cleanup

`close_open_pvp_challenges` stamps week-end expiry as `'cancelled'`, though
`'expired'` exists in the CHECK; `'accepted'` is never stored (accept jumps to
`'locked'`).

### Decision (pick one)
- **(a) Use `'expired'` for the week-close sweep** — better audit trail;
  requires checking app handling (`usePvpData`, PvP list filters/badges) for the
  new status.
- **(b) Shrink the CHECK** to the statuses actually written
  (`pending, countered, locked, settled, pushed, voided, cancelled`) — zero app
  impact, smaller vocabulary.

Recommendation: **(a)** — the distinction between "I withdrew it" and "it lapsed
at archive" is real and free to keep.

### Migration — `pvp_expired_status` (if (a))

**Status: ✅ DONE 2026-06-12 (option a)** — migration
`20260612175222_score_credit_guard_and_pvp_expired` (commit `5e48d77`).
Week-close sweep now stamps `'expired'`; the app already renders the status
(no app change was needed).

1. Update `close_open_pvp_challenges` to set `'expired'`.
2. App: surface `'expired'` wherever `'cancelled'` is rendered
   (grep `usePvpData.ts`, PvP screens for status unions).
3. If (b) instead: `ALTER TABLE … DROP CONSTRAINT pvp_challenges_status_check;`
   + re-add without the dead values (verify no rows hold them first).

---

## 6. Document the challenge ↔ live-offer mirror (PvP dual-write)

`pvp_challenges` mirrors every negotiable term of the live
`pvp_challenge_offers` row; `counter_pvp_challenge` maintains the mirror by hand
across ~12 columns. Deriving challenge terms from the latest offer would remove
the dual-write but means rewriting every read path (app reads challenge columns
directly, including realtime payloads).

### Task (docs + cheap guard, no restructure)

**Status: ✅ DONE 2026-06-12 (docs part)** — mirror invariant documented in
`context/economy/PvP_DB.md` under `pvp_challenge_offers`. The optional drift
guard in `accept_pvp_challenge` was **not** implemented (judgment call left
open; revisit only with a new decision).

1. Document in [context/economy/PvP_DB.md](context/economy/PvP_DB.md): *the
   challenge row is a denormalized snapshot of the live offer, maintained only by
   `create_pvp_challenge` / `counter_pvp_challenge`; never update either side
   elsewhere.*
2. Optional one-line guard at the top of `accept_pvp_challenge`: raise if the
   live offer's `(creator_stake, counterparty_stake, contract_type, game_number)`
   disagree with the challenge row — converts silent drift into a loud error.

---

## Done when
- [x] Helpers exist, granted correctly, adopted by all RPC batches
- [x] `grep -c "app_metadata' ->> 'role'" supabase/schema.sql` drops to ~0 in the
      FUNCTIONS section (policies are SECURITY doc scope) — only `is_admin()`
      itself remains
- [x] `score_credit` guard uses `week_id`; double-archive no-ops
- [x] All functions normalized — to `'public','pg_temp'`, not `''` (deliberate
      deviation, see §4 status block); OTP-login check of the JWT hook still
      outstanding
- [x] Reversal rule + PvP mirror documented; PvP status decision executed
      (option a, `'expired'`)
