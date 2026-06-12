# TODO — DB Consolidation (Audit §1: High-value consolidation)

> From the 2026-06-11 database-layer audit of [supabase/schema.sql](supabase/schema.sql).
> Companion docs: [TODO_DB_FUNCTION_HYGIENE.md](TODO_DB_FUNCTION_HYGIENE.md),
> [TODO_DB_PERFORMANCE.md](TODO_DB_PERFORMANCE.md), [TODO_DB_SECURITY.md](TODO_DB_SECURITY.md).
>
> **Sequencing across docs:** do SECURITY item 1 (anon lockdown) and FUNCTION_HYGIENE
> item 1 (shared helpers) first — the RPC rewrites below should call the new helpers
> rather than being rewritten twice.

Every step follows the migrations-only workflow in
[context/agent-rules.md](context/agent-rules.md) §12: `supabase migration new <name>`
→ write SQL → `supabase db push` → `./supabase/refresh-schema-snapshot.sh` →
regenerate `database.types.ts` → update the prose docs touched. No test suite —
verification is `supabase db query` reads + the Expo dev server.

---

## 1. Drop the dead deferred-peer layer (`bet_offers`, `bet_matches`, `bets.counterparty`)

**Status: ✅ DONE 2026-06-12** — migration `20260612003905_drop_deferred_peer_layer`
(Migration A below, as planned). Snapshot + types regenerated, `tsc --noEmit`
clean, docs updated (PIN_ECONOMY_SCHEMA.md, database-schema.md, AGENTS.md).
Migration B (`bet_legs.side`) remains deferred as designed.

**Original status: verified dead, pending final user sign-off.** Repo-wide search shows the
only references are generated types, the schema snapshot, docs, and the migration
that created them (`20260605002715_betting_target_model.sql`). No RPC reads or
writes either table; no `db.ts` method exists. Peer betting in production is the
**PvP Challenge Contracts** system (`pvp_challenges` / `pvp_challenge_offers`) —
unrelated tables, untouched by this plan. The back/lay design stays recoverable in
migration history if it's ever revived.

### Migration A — `drop_deferred_peer_layer`
1. `DROP TABLE public.bet_matches;` then `DROP TABLE public.bet_offers;`
   (matches first — it FKs offers). This removes 8 indexes, 10 RLS policies, 6 FKs.
2. Drop `bets.counterparty` (every row is `'house'`; verify first with
   `SELECT count(*) FROM bets WHERE counterparty <> 'house'` — expect 0):
   - `ALTER TABLE public.bets DROP CONSTRAINT bets_counterparty_check;`
   - `ALTER TABLE public.bets DROP COLUMN counterparty;`
   - Recreate `place_house_bet` without the `counterparty` insert column
     (currently hardcodes `'house'`).

### Migration B (optional, separate decision) — `drop_bet_legs_side`
`bet_legs.side` (`back`/`lay`) only ever holds `'back'` now. Dropping it touches
`prevent_self_tank` (lay branch), `finalize_bets_for_market` (back/lay truth
table), and `place_house_bet`. Defer unless we're confident back/lay never returns;
it's cheap to keep.

### App layer
- Regenerate types; grep for `counterparty` usages typed against `bets`
  (the PvP `counterparty*` fields are unrelated — leave them).
- Any bet-history UI that renders "vs house" from the column should hardcode it.

### Docs
- [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md): remove the
  deferred-peer-layer sections (§2 tables, lifecycle, RLS rows).
- [context/database-schema.md](context/database-schema.md): update the betting row
  and the table count.

### Done when
- [ ] `supabase db query "SELECT to_regclass('public.bet_offers'), to_regclass('public.bet_matches')"` returns NULLs
- [ ] Placing a single + parlay bet via the app works; bet history renders
- [ ] Snapshot + types regenerated; docs updated

---

## 2. Extract `pin_ledger_double_entry()` — kill the five-row dance

**Status: ✅ DONE 2026-06-12** — migrations `20260612145622_pin_ledger_double_entry_helper`
+ batches `…145700_loans_adopt_helpers` (B), `…151409_pvp_adopt_helpers` (C),
`…153019_bets_bounty_adopt_helpers` (D, fused with §4). Each batch verified by a
**rollback-probe** (`supabase/verify/probe-*.sql` via `run-probe.sh`): the real
flows executed against live functions inside an always-aborting transaction,
before and after the rewrite — captures byte-identical. Helper documented in
PIN_ECONOMY_SCHEMA §4 as the only sanctioned way to move pins.

The pattern *insert player pin row → insert house mirror row → insert domain-ledger
row → back-link `UPDATE pin_ledger SET *_ledger_id`* is hand-written in ~10 RPCs.
One helper makes the "every movement nets to zero" invariant structural.

### Migration A — `pin_ledger_double_entry_helper`
```sql
-- Sketch — final SQL authored against current schema.sql at execution time.
CREATE FUNCTION public.pin_ledger_double_entry(
  p_player_id uuid, p_season_id uuid, p_week_id uuid,
  p_amount int,                -- the PLAYER-side signed amount; house mirrors -p_amount
  p_type text, p_description text,
  p_bet_id uuid DEFAULT NULL, p_bounty_post_id uuid DEFAULT NULL
  -- extend with other ref columns only as needed
) RETURNS TABLE (player_entry_id uuid, house_entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS ...
-- inserts (p_player_id, …, p_amount) and (NULL, is_house, …, -p_amount,
--   p_description || ' (house)') and returns both ids.
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated;
```
Callers that need a domain-ledger back-link (`loan_ledger`/`pvp_ledger`) keep doing:
insert domain row referencing `player_entry_id`, then one
`UPDATE pin_ledger SET <x>_ledger_id = ... WHERE id IN (player_entry_id, house_entry_id)`.

### Migrations B–D — convert call sites in three reviewable batches
Each batch is one migration that `CREATE OR REPLACE`s the functions:

| Batch | Functions (call sites) |
|---|---|
| B — loans | `take_loan`, `repay_loan`, `process_weekly_loans`, `settle_loans_for_season_close` |
| C — pvp | `accept_pvp_challenge` (×2), `settle_pvp_challenge` (push + payout), `void_pvp_challenge` (×2) |
| D — bets + bounty | `place_house_bet`, `finalize_bets_for_market` (push + win), `settle_betting_for_week` (force-void), `create_sponsor_bounty`, `enter_bounty_as_hunter`, `settle_bounty` (×3) |

### Verification (after each batch)
- House net-zero invariant for every double-entry type:
  `SELECT type, SUM(amount) FROM pin_ledger WHERE type <> 'score_credit' AND type NOT LIKE 'bonus%' GROUP BY type`
  — sums unchanged before/after exercising each flow on the dev server.
- Exercise the touched flows in-app: take/repay loan, accept+settle a PvP
  challenge, place + archive-settle a bet, enter + settle a bounty.

### Docs
- PIN_ECONOMY_SCHEMA.md accounting section: document the helper as the only
  sanctioned way to move pins.

---

## 3. Stamp `bets.week_id` — kill the four-table "bets in week" join

**Status: ✅ DONE 2026-06-12** — migrations `20260612172127_bets_week_id` +
`…172200_bets_week_id_consumers`. place_house_bet stamps + enforces
single-week parlays; archive_week / settle_betting_for_week / unarchive_week
predicates rewritten (the leg→market join survives only for market-type facts:
prop exemption + error titles); archive/unarchive also adopted assert_admin().
Verified by the new `probe-archive-roundtrip.sql` (force-void → surgical
restore, ledger sum + row count exact) plus the full probe suite green
before and after. Types regenerated; tsc clean.

The join `bets → bet_legs → bet_selections → bet_markets` appears 7+ times
(archive snapshot, settle backstop ×3, weekly house P&L, unarchive delete,
downstream guard). `place_house_bet` already computes `v_week_id`.

**Pre-decision:** a `bets.week_id` single value assumes single-week bets. Today
`place_house_bet` only enforces same-*season* legs. Step 1 below closes that gap —
parlays become single-week (which matches how markets are actually generated and
how settlement already reasons about them).

### Migration A — `bets_week_id`
1. `ALTER TABLE public.bets ADD COLUMN week_id uuid REFERENCES public.weeks(id) ON DELETE SET NULL;`
2. Backfill (DML inside the migration is fine):
   ```sql
   UPDATE bets b SET week_id = sub.week_id FROM (
     SELECT DISTINCT l.bet_id, m.week_id
     FROM bet_legs l JOIN bet_selections s ON s.id = l.selection_id
     JOIN bet_markets m ON m.id = s.market_id) sub
   WHERE sub.bet_id = b.id;
   ```
   Pre-check there are no multi-week bets:
   `SELECT bet_id FROM (…) GROUP BY bet_id HAVING count(DISTINCT week_id) > 1` → expect none.
3. `CREATE INDEX idx_bets_week ON public.bets (week_id);`
4. `place_house_bet`: stamp `week_id` on insert **and** raise if a selection's
   week differs from the first leg's week ("All selections must be in the same week").

### Migration B — `bets_week_id_consumers`
Rewrite the predicates to `b.week_id = p_week_id` in: `archive_week` (snapshot
2a + preimage 2b), `settle_betting_for_week` (backstop count, error-title agg,
force-void loop, house-net sum), `unarchive_week` (pin_ledger delete + downstream
bets count). Keep the old join only where it still expresses the right thing
(none expected).

### Done when
- [ ] `SELECT count(*) FROM bets WHERE week_id IS NULL` returns only pre-backfill
      legacy rows we've consciously accepted (expect 0)
- [ ] Archive → unarchive → re-archive round-trip on a dev week leaves ledger
      sums identical (SETTLEMENT_ACCEPTANCE.md checklist)

---

## 4. Cap `pin_ledger`'s per-feature column growth

**Status: ✅ DONE 2026-06-12** — fused into batch D
(`20260612153019_bets_bounty_adopt_helpers`): settle_bounty +
enter_bounty_as_hunter stopped writing the granular refs, the three columns
(+ indexes) dropped, types regenerated, policy line added to
PIN_ECONOMY_SCHEMA §4.

Bounties added four ref columns; only `bounty_post_id` carries the cancel-refund
semantics. `bounty_payouts` already preserves payout-level granularity.

### Migration — `pin_ledger_drop_granular_bounty_refs`
1. Update `settle_bounty` + `enter_bounty_as_hunter` to stop writing
   `bounty_hunter_stake_id`, `bounty_settlement_id`, `bounty_payout_id`.
2. Drop the three columns (+ their three indexes).
3. **Policy line for future features** (add to PIN_ECONOMY_SCHEMA.md "adding a bet
   type" section): a new economy feature gets **exactly one** root-entity ref
   column on `pin_ledger` — the one its cancel/refund path deletes by.

---

## 5. Activity-event catalog table (replaces the 16-branch CASE)

`publish_activity_event` hardcodes per-event metadata in a CASE, duplicated by the
`event_type` CHECK. Every new event = function edit + constraint edit.

### Migration — `activity_event_catalog`

**Status: ✅ DONE 2026-06-12** — migration `20260612183555_activity_event_catalog`,
pushed after the pre-push probe suite passed; post-push probes, snapshot + anon
posture, types regen, and `tsc` all green. 16 rows seeded; CHECK → FK; helper
rewritten (success paths verbatim). One push-time correction: the explicit
`CREATE TRIGGER set_updated_at` collided with the `enforce_audit_columns` event
trigger, which auto-attaches it to every new public table (42710) — the
statement was removed; the event trigger provides it. `context/activity-feed.md`
updated: adding an event = 1 catalog INSERT + app template.

1. `CREATE TABLE activity_event_catalog (event_type text PRIMARY KEY, source_feature text NOT NULL, template_key text NOT NULL, requires_actor boolean NOT NULL, allowed_fk text NOT NULL CHECK (allowed_fk IN ('sportsbook_bet_id','loan_id','pvp_challenge_id','bounty_post_id','none')), default_visibility text NOT NULL)` + seed the 16 rows (+ `created_at`/`updated_at` — the audit-columns event trigger requires them).
2. Rewrite `publish_activity_event`: one catalog lookup replaces the CASE; the
   FK-exclusivity check becomes a single comparison against `allowed_fk`.
3. Replace `activity_feed_events_event_type_check` with
   `FOREIGN KEY (event_type) REFERENCES activity_event_catalog(event_type)`.
4. RLS: admin-write / all-read; new event types become catalog INSERTs in future
   migrations.
5. Update [context/activity-feed.md](context/activity-feed.md) recipe ("add a new
   event type" = 1 catalog row + app template, no function edit).

---

## 6. (Deferred) Bounty 4 → 2 tables

`bounty_settlements` is 1:1 with `bounty_post` (unique index); `bounty_payouts` is
derivable from `hunter_stakes` + outcome. Folding settlement columns into
`bounty_post` and dropping payouts is a clean consolidation **but** touches
`settle_bounty`, `cancel_bounty`, pin_ledger refs, and the Bounties app screens.
Park until bounty v2 work happens anyway; revisit alongside §4's policy.
