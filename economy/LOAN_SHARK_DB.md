# Loan Shark — Database Implementation Spec

Handoff spec for the **database layer** of the Loan Shark feature. Self-contained
and executable independently of the app-layer spec (`economy/LOAN_SHARK_APP.md`),
which depends on this being applied + `database.types.ts` regenerated.

**Read first:** `economy/ECONOMIC_DESIGN_DEBT.md` (the product design — section
references below are to it) and `supabase/PIN_ECONOMY_SCHEMA.md` §4–§6 (the ledger /
RPC conventions you must mirror). This spec assumes that context.

> **Hard rule (AGENTS.md §12):** every change here is a migration file created with
> `supabase migration new …` and applied with `supabase db push`. Never write to the
> DB directly. CLI invocation (token + `--linked --workdir $(pwd)`) is in AGENTS.md
> §11–§12. Project ref `lyihsvxraurjghjqxaau`.

---

## Conventions every object in this spec must follow

From `PIN_ECONOMY_SCHEMA.md` §5–§6 — non-negotiable:

- **New tables:** include `created_at timestamptz NOT NULL DEFAULT now()` and
  `updated_at timestamptz NOT NULL DEFAULT now()` **and nothing else for audit** —
  the `enforce_audit_columns` event trigger auto-attaches `set_updated_at`. Do
  **not** declare a `set_updated_at` trigger yourself (it collides).
- **Index every FK column** (Postgres doesn't auto-index FKs; the advisor flags it).
- All ids `uuid` (`gen_random_uuid()`); all `season_id`/`week_id`/`player_id` are uuid FKs.
- **RPCs:** `SECURITY DEFINER`, `SET search_path = ''`, every object fully qualified
  as `public.<name>`. Resolve identity from `auth.uid()` — **never** accept a
  client-supplied player id. `REVOKE EXECUTE … FROM PUBLIC, anon;` then
  `GRANT EXECUTE … TO authenticated;`. Admin gate:
  `IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;`
- Append-only ledgers — corrections are new rows, never in-place edits (except the
  destructive admin cancel, which deletes the exact rows).

**Reference implementations to copy from** (read them before writing):
- `supabase/migrations/20260605005644_ou_target_model_rpcs.sql` — `place_house_bet` (balance check, double-entry insert, identity), `cancel_bet` (destructive delete pattern).
- `supabase/migrations/20260605120219_add_week_id_to_pin_ledger.sql` — `settle_betting_for_week` (admin gate, `score_credit` mint, week_id stamping) and `settle_market_internal` (payout double-entry).
- `supabase/migrations/20260605005517_ou_house_account_and_anti_tank.sql` — `pin_ledger` house account columns, `pin_ledger_owner_chk`, the type CHECK, the anti-tank trigger shape.

---

## Suggested migration ordering

One logical change per migration file. Recommended sequence (timestamps assigned by
the CLI):

1. `loan_shark_tables` — `loan_products`, `loans`, `debt_ledger` + indexes + RLS.
2. `pin_ledger_loan_support` — `debt_ledger_id` column + index, extend type CHECK.
3. `loan_products_immutable_terms` — immutability trigger.
4. `loan_shark_rpcs` — `take_loan`, `repay_loan`, `process_weekly_loans`, `settle_loans_for_season_close`, `cancel_loan`.
5. `settle_betting_for_week_loans` — `CREATE OR REPLACE` to `PERFORM process_weekly_loans` at the end.
6. `seed_loan_products` — the 4 v1 products (data migration).

(Steps 1–3 may be combined; keep 4/5/6 separate for reviewability.)

---

## 1. Tables (design §9)

### `loan_products` (§9.2)
Immutable historical offers. **No `product_key`** — `id` is canonical (§9.2.1).

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `season_id` | `uuid NULL REFERENCES public.seasons(id)` — NULL = global. **Immutable.** |
| `display_name` | `text NOT NULL` — editable |
| `description` | `text NOT NULL` — editable |
| `special_warning_text` | `text NULL` — editable |
| `risk_level` | `text NOT NULL CHECK (risk_level IN ('low','medium','high','extreme'))` — editable |
| `borrow_amount` | `int NOT NULL CHECK (borrow_amount > 0)` — **immutable** |
| `weekly_interest_rate` | `numeric(5,4) NOT NULL CHECK (weekly_interest_rate >= 0)` — **immutable** (e.g. `0.1500` = 15%) |
| `garnishment_rate` | `numeric(5,4) NOT NULL CHECK (garnishment_rate >= 0 AND garnishment_rate <= 1)` — **immutable** |
| `is_active` | `boolean NOT NULL DEFAULT true` — editable |
| `available_from` | `timestamptz NULL` — **immutable** |
| `available_until` | `timestamptz NULL` — **immutable** |
| `max_uses` | `int NULL CHECK (max_uses IS NULL OR max_uses > 0)` — NULL = unlimited. **immutable** |
| `sort_order` | `int NOT NULL DEFAULT 0` — editable |
| `created_at` / `updated_at` | audit (auto) |

Index: `season_id`.

### `loans` (§9.4)
Lifecycle only — **no stored balance** (derived from `debt_ledger`).

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `player_id` | `uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE` |
| `season_id` | `uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE` |
| `loan_product_id` | `uuid NOT NULL REFERENCES public.loan_products(id)` |
| `status` | `text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid_off','season_closed'))` |
| `issued_at` | `timestamptz NOT NULL DEFAULT now()` |
| `paid_off_at` | `timestamptz NULL` |
| `season_closed_at` | `timestamptz NULL` |
| `created_at` / `updated_at` | audit (auto) |

Indexes: `player_id`, `season_id`, `loan_product_id`. Do **not** add a DB unique
constraint enforcing one active loan — that is an application-layer + RPC rule
(§3.3), kept out of the DB so future versions can allow multiple.

### `debt_ledger` (§9.5)
Append-only debt event log. **`loan_balance(loan) = SUM(amount)`.**

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `loan_id` | `uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE` |
| `player_id` | `uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE` (denormalized) |
| `season_id` | `uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE` (denormalized) |
| `week_id` | `uuid NULL REFERENCES public.weeks(id) ON DELETE SET NULL` |
| `amount` | `int NOT NULL` — signed (see sign table) |
| `type` | `text NOT NULL CHECK (type IN ('loan_issued','manual_repayment','weekly_garnishment','weekly_interest','season_close_settlement'))` |
| `description` | `text NOT NULL` |
| `pin_ledger_id` | `uuid NULL REFERENCES public.pin_ledger(id) ON DELETE SET NULL` — player-side pin row when pins moved; NULL for `weekly_interest` |
| `created_at` / `updated_at` | audit (auto) |

Indexes: `loan_id`, `player_id`, `season_id`, `week_id`, `pin_ledger_id`.

**Sign convention (§9.5) — enforce by writing the right sign in the RPCs:**

| `type` | sign | meaning |
|---|---|---|
| `loan_issued` | + | principal created |
| `manual_repayment` | − | player repays |
| `weekly_garnishment` | − | garnished pincome |
| `weekly_interest` | + | interest |
| `season_close_settlement` | − | season-close payment |

> Note: `debt_ledger.pin_ledger_id` and `pin_ledger.debt_ledger_id` are mutually
> referential. Create `debt_ledger` **without** the FK to `pin_ledger` if ordering
> is awkward, or add the `pin_ledger.debt_ledger_id` column (step 2) after both
> tables exist and set `debt_ledger.pin_ledger_id`'s FK in the same migration. Both
> are nullable, so insert order inside the RPCs is: insert pin rows → insert debt
> row referencing the player pin row → `UPDATE` the two pin rows' `debt_ledger_id`.

### RLS (mirror the `bet_*` policies)
On all three tables: `ENABLE ROW LEVEL SECURITY`. Reads open to `anon` +
`authenticated`; direct INSERT/UPDATE/DELETE **admin-only**
(`(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`). All player write paths go
through the `SECURITY DEFINER` RPCs (which bypass RLS), so players never write these
tables directly. Copy the exact policy shape from the betting tables' migration.

---

## 2. `pin_ledger` extension

In `pin_ledger_loan_support`:

```sql
ALTER TABLE public.pin_ledger
  ADD COLUMN debt_ledger_id uuid REFERENCES public.debt_ledger(id) ON DELETE SET NULL;
CREATE INDEX pin_ledger_debt_ledger_id_idx ON public.pin_ledger (debt_ledger_id);
```

**Extend the existing `pin_ledger.type` CHECK** (drop + re-add) to add the four
loan pin types alongside the current set (`champion_bonus`/`score_credit`/`bonus`/
`bet_stake`/`bet_payout`/`bet_refund` — confirm the live set first with a
`SELECT pg_get_constraintdef(...)` read):

```
loan_issued
loan_manual_repayment
loan_weekly_garnishment
loan_season_close_settlement
```

**Cancel-friendliness convention:** in every loan transfer, stamp `debt_ledger_id`
on **both** the player row and the house row (mirrors `bet_id` on both bet rows).
`cancel_loan` then deletes all pin rows by `debt_ledger_id`, getting both sides.

---

## 3. Immutability trigger (§9.3.1)

In `loan_products_immutable_terms` — reject UPDATEs that change the immutable terms.
Use the design doc's `prevent_loan_product_term_updates` body verbatim (§9.3.1),
adding `SET search_path = ''` to the function. Protected fields: `season_id`,
`borrow_amount`, `weekly_interest_rate`, `garnishment_rate`, `max_uses`,
`available_from`, `available_until`. `BEFORE UPDATE … FOR EACH ROW`.

---

## 4. RPCs

All in `loan_shark_rpcs`. Model the structure on `place_house_bet` /
`settle_market_internal` / `cancel_bet`. Balance is always derived:
`SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE player_id = X AND season_id = Y`.
Outstanding debt is always derived:
`SELECT COALESCE(SUM(amount),0) FROM public.debt_ledger WHERE loan_id = L`.

### `take_loan(p_loan_product_id uuid) RETURNS uuid` — `authenticated` (§11.1, §10.1)
1. Resolve `v_player_id` from `auth.uid()` (RAISE if no player).
2. Resolve current season — `is_active = true AND registration_open = false` (the `seasons.getCurrent()` rule). RAISE if none.
3. `SELECT … FOR UPDATE` the product row (serializes `max_uses`). Validate availability (§10): `is_active`, `season_id IS NULL OR = current`, `available_from`/`until` window, and `max_uses IS NULL OR (SELECT count(*) FROM loans WHERE loan_product_id = p_loan_product_id) < max_uses`.
4. Reject if the player already has an `active` loan this season (app-layer rule, also checked here for safety).
5. INSERT `loans` (`status='active'`), capture `v_loan_id`.
6. INSERT the pin pair — both rows `bet_id NULL`, `type='loan_issued'`, `week_id` = current week (`weeks.getCurrent()`; may be NULL — acceptable):
   - player: `+borrow_amount`, `is_house=false`
   - house: `−borrow_amount`, `is_house=true`
   Capture the player row id `v_pin_id`.
7. INSERT `debt_ledger` (`type='loan_issued'`, `amount = +borrow_amount`, `pin_ledger_id = v_pin_id`), capture `v_debt_id`.
8. `UPDATE` both pin rows `SET debt_ledger_id = v_debt_id`.
9. `RETURN v_loan_id`.

### `repay_loan(p_loan_id uuid, p_amount int) RETURNS void` — `authenticated` (§11.2)
1. Resolve `v_player_id`; load the loan; RAISE unless it exists, is `active`, and `player_id = v_player_id`.
2. Derive outstanding debt + player balance.
3. Validate: `p_amount` is a positive integer, `<= outstanding`, `<= balance`.
4. INSERT pin pair (`type='loan_manual_repayment'`, player `−p_amount` / house `+p_amount`, `week_id` = current week), capture player pin id.
5. INSERT `debt_ledger` (`type='manual_repayment'`, `amount = -p_amount`, `pin_ledger_id`), update both pin rows' `debt_ledger_id`.
6. If new outstanding = 0 → `UPDATE loans SET status='paid_off', paid_off_at = now()`.

### `process_weekly_loans(p_week_id uuid) RETURNS void` — admin-gated (§5, §11.3–11.4)
Called by `settle_betting_for_week` (which is already admin-gated) and idempotent.
For each `active` loan whose `season_id` = the week's season:
1. **Idempotency guard** — `CONTINUE` if a `debt_ledger` row already exists with this `loan_id` and `week_id` and `type IN ('weekly_garnishment','weekly_interest')`.
2. Weekly bowling pincome = `SUM(amount) FROM pin_ledger WHERE player_id = loan.player_id AND week_id = p_week_id AND type = 'score_credit'` (these are the rows `settle_betting_for_week` just minted).
3. Derive outstanding debt; if 0 → `UPDATE loans SET status='paid_off', paid_off_at=now()` and `CONTINUE` (no interest).
4. `calculated = ceil(pincome * garnishment_rate)` (use `CEIL(... )::int`); `garnish = LEAST(calculated, outstanding)`.
5. If `garnish > 0`: pin pair (`type='loan_weekly_garnishment'`, player `−garnish` / house `+garnish`, `week_id = p_week_id`) + `debt_ledger` (`type='weekly_garnishment'`, `amount = -garnish`, link both).
6. Recompute outstanding. If 0 → mark `paid_off` and **skip interest**.
7. Else `interest = CEIL(remaining * weekly_interest_rate)::int`; if `> 0` INSERT `debt_ledger` only (`type='weekly_interest'`, `amount = +interest`, `week_id = p_week_id`, `pin_ledger_id = NULL`). **No pin row** — no pins move on interest.

Rounding: both garnishment and interest use `CEIL` (§5.5). Garnishment is applied
**before** interest (§5.1). `REVOKE … FROM PUBLIC, anon`; it's invoked internally by
`settle_betting_for_week` (SECURITY DEFINER) so a direct grant to `authenticated`
isn't required, but admin-callable is fine for manual reruns — match whichever the
reviewer prefers; gate the body on admin role regardless.

### `settle_loans_for_season_close(p_season_id uuid) RETURNS void` — admin-gated (§11.5)
For each `active` loan in the season:
1. Derive outstanding debt + player balance.
2. `payment = LEAST(balance, outstanding)`.
3. If `payment > 0`: pin pair (`type='loan_season_close_settlement'`, player `−payment` / house `+payment`, `week_id` = the season's last week or NULL) + `debt_ledger` (`type='season_close_settlement'`, `amount = -payment`, link both).
4. `UPDATE loans SET status='season_closed', season_closed_at = now()`.
   (Residual debt stays on the ledger → contributes to negative final net worth, §7.2.)

### `cancel_loan(p_loan_id uuid) RETURNS void` — admin-gated (§12)
Destructive rollback, mirrors `cancel_bet`:
```sql
DELETE FROM public.pin_ledger
 WHERE debt_ledger_id IN (SELECT id FROM public.debt_ledger WHERE loan_id = p_loan_id);
DELETE FROM public.debt_ledger WHERE loan_id = p_loan_id;   -- (or rely on FK cascade from loans)
DELETE FROM public.loans WHERE id = p_loan_id;
```
Result: derived pin balance and derived debt return to their no-loan state.

---

## 5. Weekly-flow integration (no client window) — §6

In `settle_betting_for_week_loans`, `CREATE OR REPLACE FUNCTION
public.settle_betting_for_week(p_week_id uuid)` reusing the **current body
verbatim** (copy from `20260605120219_…`) and append, as the last statement before
`END;`:

```sql
  -- Loan garnishment + interest, after pincome is minted, same transaction.
  PERFORM public.process_weekly_loans(p_week_id);
```

This guarantees garnishment→interest run in the same transaction as the
`score_credit` mint, with no intermediate player-action window (§6). `AdminArchiveModal`
needs **no change** — it already calls `settle_betting_for_week`.

---

## 6. Seed (§4)

Data migration `seed_loan_products` — INSERT the 4 global (`season_id = NULL`)
products. Rates stored as decimals (e.g. `0.08`). Copy `description` /
`special_warning_text` from design §4.1–§4.2 (only Feeding Frenzy + Blood in the
Water have warning text).

| `display_name` | `borrow_amount` | `weekly_interest_rate` | `garnishment_rate` | `risk_level` | `sort_order` |
|---|---:|---:|---:|---|---:|
| Minnow Loan | 250 | 0.08 | 0.25 | low | 1 |
| Shark Bite | 500 | 0.10 | 0.35 | medium | 2 |
| Feeding Frenzy | 750 | 0.12 | 0.45 | high | 3 |
| Blood in the Water | 1000 | 0.15 | 0.55 | extreme | 4 |

---

## 7. Verification (run after `db push`, mirror `PIN_ECONOMY_SCHEMA.md` §10)

Use a throwaway / non-prod season. SQL reads via `supabase db query --linked`.

1. **Schema/advisors** — `supabase db lint` clean; every new FK indexed; all 5
   functions have a pinned `search_path`; the immutability trigger rejects an UPDATE
   that changes `borrow_amount`.
2. **take_loan** — balance up by `borrow_amount`; `SUM(debt_ledger)=borrow_amount`;
   the two `loan_issued` pin rows net to 0 and both carry the same `debt_ledger_id`;
   a second `take_loan` while one loan is `active` raises.
3. **repay_loan** — partial then full; rejects `> debt` and `> balance`; full repay
   flips `loans.status='paid_off'` with `paid_off_at`.
4. **process_weekly_loans / archive** — archive a week with an active loan: assert
   garnishment = `ceil(pincome×rate)` capped at outstanding, then interest =
   `ceil(remaining×rate)` as a debt-only row (no matching pin row); a garnishment
   that zeroes the loan charges **no** interest and marks `paid_off`; **re-running
   `settle_betting_for_week` is a no-op** (guard).
5. **Missed week** — player with no `score_credit` that week: no garnishment row,
   interest assessed on full balance.
6. **season close** — `settle_loans_for_season_close` pays `min(balance, debt)`;
   residual debt remains on `debt_ledger`; loan marked `season_closed`.
7. **cancel_loan** — all pin + debt rows for the loan gone; derived balance + debt
   back to pre-loan state.
8. **Conservation invariant (§10.2)** — `SUM(pin_ledger.amount)` per season still
   equals `SUM(score_credit)`: loan pin transfers net 0 (player + house), and
   `weekly_interest` never touches `pin_ledger`.
