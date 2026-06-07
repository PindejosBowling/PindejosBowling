# PvP Challenge Contracts — Database Implementation Spec

Handoff spec for the **database layer** of the PvP Challenge Contracts feature.
Self-contained and executable independently of the app-layer spec
(`economy/PvP_APP.md`), which depends on this being applied + `database.types.ts`
regenerated.

**Read first:** `economy/ECONOMIC_DESIGN_PvP.md` (the product design — section
references below are to it) and `supabase/PIN_ECONOMY_SCHEMA.md` §4–§6 (the ledger /
RPC conventions you must mirror). This spec assumes that context. The Loan Shark DB
spec (`economy/LOAN_SHARK_DB.md`) is the closest existing analog — same ledger shape,
same RPC patterns — read it for worked examples.

> **Hard rule (AGENTS.md §2):** every change here is a migration file created with
> `supabase migration new …` and applied with `supabase db push`. Never write to the
> DB directly. CLI invocation (token from `app/.env.local` + `--linked --workdir $(pwd)`)
> is in AGENTS.md §3. Project ref `lyihsvxraurjghjqxaau`.

> **⚠️ Implemented + corrected — this doc reflects the as-built design.** The
> migrations below were applied, then two corrective migrations changed the design.
> The text here has been updated to match what's live; the deltas from the original
> v1 plan are:
> 1. **No rake / no house cut.** PvP duels are **winner-takes-the-whole-pot**. There
>    is no `pvp_rake` type, no `rake` pvp_ledger type, no `pvp_rake()` helper, and no
>    `pvp_challenges.rake_amount` column. `payout_amount` always equals `total_pot`.
> 2. **No time-based expiry.** Challenges do not expire on a clock. There is no
>    `expires_at` column on `pvp_challenges` or `pvp_challenge_offers`, no
>    `p_expires_at` RPC param, and no `expire_pvp_challenges()` sweep. A challenge
>    stays open until the admin **starts the game** it is tied to (Matchups →
>    "Start Game" → `close_open_pvp_challenges(week, game)`), which closes every
>    still-open challenge for that game; anything left open is closed when the week
>    is settled (`close_open_pvp_challenges(week, NULL)`). Closing reuses the decline
>    semantics: `status='cancelled'` + the live offer's `declined_at`.
> 3. Settlement pays the **full pot** to the winner as a single balanced player+house
>    `pvp_payout` pair. Voiding a *settled* contract reverses the payout before
>    refunding stakes. `decline` is restricted to actual parties (no open-board grief).
>
> Migrations: `…002012`–`…002537` (initial), `…004500_pvp_fixes` (lock_at/prop/void/
> decline + conservation fix), `…010000_pvp_remove_rake` (rake removal).

## Scope of this spec (v1 — design §10 MVP)

The reusable **Challenge Engine** (contract model + escrow + settlement
routing + counteroffers + admin tools — winner-takes-the-whole-pot, no rake) and
three contract types: **Line Duel**
(§11.1), **Player Prop Duel** (§11.7), **Raw Score Duel** (§11.2). Plus the **Open
Challenge Board** (open contracts, `counterparty_player_id IS NULL`), **counteroffers**
(§6), **escrow**, **auto-settlement from archived scores**
(§7.3), **admin cancel/void/manual-settle** (§14), and **double-or-nothing rematch**
(§11.10). The schema is generalized so deferred types (Series, Spread, Accuracy, Side
Pot, Rivalry, King of the Hill) slot in later via new `contract_type` values + new
settlement branches — **no schema redesign required**.

Activity feed and push notifications are **out of scope** (deferred phase — see
`PvP_APP.md` §8); v1 surfaces everything through existing screens.

---

## Naming rule (non-negotiable)

**Every new table is prefixed `pvp_*`** so they group together alphabetically:
`pvp_challenges`, `pvp_challenge_offers`, `pvp_ledger`. The `pin_ledger` linking
column is `pvp_ledger_id`. The new `pin_ledger.type` values are `pvp_stake`,
`pvp_payout`, `pvp_refund` (no `pvp_rake` — winner takes the whole pot). Do not
deviate from this prefix.

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
  client-supplied player id for the *caller*. (Opponent/subject ids are explicit
  params, validated.) `REVOKE EXECUTE … FROM PUBLIC, anon;` then
  `GRANT EXECUTE … TO authenticated;`. Admin gate:
  `IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;`
- Append-only ledgers — corrections are new rows, never in-place edits (except the
  destructive admin cancel, which deletes the exact rows).
- **Voluntary-risk guardrail (design §2):** a player can only lose pins by an explicit
  action they took. Concretely: **no escrow on create** — stakes move only at
  `accept` (the counterparty's explicit action) or when a player accepts an open-board
  contract. A pending/countered contract holds **zero** escrow.

**Reference implementations to copy from** (read them before writing):
- `supabase/migrations/20260605005644_ou_target_model_rpcs.sql` — `place_house_bet`
  (balance check, double-entry insert, identity from `auth.uid()`),
  `sync_over_under_markets_for_week` (the `floor(season avg)+0.5` line formula — reuse it
  for the Line Duel snapshot).
- `supabase/migrations/20260605120219_add_week_id_to_pin_ledger.sql` —
  `settle_betting_for_week` (admin gate, `score_credit` mint, `week_id` stamping) and
  `settle_market_internal` (payout double-entry, `result_value` vs `line` comparison —
  the Line/Prop settlement logic to adapt).
- `supabase/migrations/20260606191026_loan_shark_tables.sql` +
  `…191027_loan_shark_rpcs.sql` — ledger table shape, `pin_ledger` extension, the
  mutually-referential `pin_ledger ↔ *_ledger` link pattern, and the destructive
  `cancel_loan` pattern (mirror it for `cancel_pvp_challenge`).
- `supabase/migrations/20260605005517_ou_house_account_and_anti_tank.sql` —
  `pin_ledger` house-account columns, `pin_ledger_owner_chk`, the type CHECK shape, and
  the **anti-tank trigger** (no-tank guard the engine must respect).

---

## Suggested migration ordering

One logical change per migration file (timestamps assigned by the CLI):

1. `pvp_challenge_tables` — `pvp_challenges`, `pvp_challenge_offers`, `pvp_ledger`
   + indexes + RLS.
2. `pin_ledger_pvp_support` — `pvp_ledger_id` column + index; extend `pin_ledger.type`
   CHECK with the three `pvp_*` types (`pvp_stake`/`pvp_payout`/`pvp_refund`); set
   `pvp_ledger.pin_ledger_id`'s FK (mutual ref).
3. `pvp_engine_helpers` — `pvp_player_line(uuid, uuid)` helper function.
4. `pvp_challenge_rpcs` — `create_pvp_challenge`, `counter_pvp_challenge`,
   `accept_pvp_challenge`, `decline_pvp_challenge`, `cancel_pvp_challenge`,
   `void_pvp_challenge`, `settle_pvp_challenge`, `settle_pvp_for_week`,
   `close_open_pvp_challenges`. *(A later migration, `pvp_remove_expiry`, dropped the
   `expires_at` columns/params and replaced `expire_pvp_challenges` with
   `close_open_pvp_challenges`.)*
5. `settle_betting_for_week_pvp` — `CREATE OR REPLACE settle_betting_for_week` to
   `PERFORM public.settle_pvp_for_week(p_week_id)` after the pincome mint (same txn).

(Steps 1–3 may be combined; keep 4 and 5 separate for reviewability.)

---

## 1. Tables (design §5)

### `pvp_challenges` (design §5.1)
The Challenge Contract. Lifecycle-only — **no stored balance/escrow** (escrow is
derived from `pvp_ledger`). One row is the *current accepted terms*; the negotiation
trail lives in `pvp_challenge_offers`.

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `contract_type` | `text NOT NULL CHECK (contract_type IN ('line_duel','prop_duel','raw_score_duel'))` — **extensible**: add values for later types |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','countered','accepted','locked','settled','pushed','voided','cancelled','expired'))` — v1 subset of design §5.2 (`draft`/`escrowed`/`settlement_pending` collapsed — see note) |
| `creator_player_id` | `uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE` |
| `counterparty_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE CASCADE` — **NULL = open-board** contract (first taker fills it) |
| `season_id` | `uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE` |
| `week_id` | `uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE` — the league week the contract settles against |
| `game_number` | `int NULL CHECK (game_number IS NULL OR game_number >= 1)` — NULL = full-series scope (later types); v1 duels use a specific game |
| `creator_stake` | `int NOT NULL CHECK (creator_stake > 0)` |
| `counterparty_stake` | `int NOT NULL CHECK (counterparty_stake > 0)` — v1 = symmetric (equals `creator_stake`); column allows future asymmetric |
| `total_pot` | `int NOT NULL CHECK (total_pot > 0)` — `creator_stake + counterparty_stake` (stored for display/audit; recomputed in RPCs) |
| `payout_amount` | `int NOT NULL CHECK (payout_amount >= 0)` — winner takes the whole pot, so always `= total_pot`, set at accept. (There is **no** `rake_amount` column — rake was removed.) |
| `creator_line` | `numeric(6,1) NULL` — snapshot of creator's projected line (Line Duel only), frozen at accept |
| `counterparty_line` | `numeric(6,1) NULL` — snapshot of counterparty's projected line (Line Duel only) |
| `prop_market_id` | `uuid NULL REFERENCES public.bet_markets(id) ON DELETE SET NULL` — Prop Duel: the existing market both players take sides of |
| `creator_selection` | `text NULL` — Prop Duel: the creator's chosen `bet_selections.key` (e.g. `'over'`) |
| `counterparty_selection` | `text NULL` — Prop Duel: the opposite selection key |
| `subject_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE SET NULL` — Prop Duel subject (the player the prop is about); NULL for duels where the two parties are the subjects |
| `accepted_at` | `timestamptz NULL` |
| `locked_at` | `timestamptz NULL` |
| `settled_at` | `timestamptz NULL` |
| `winner_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE SET NULL` — NULL on push/void |
| `result_detail` | `jsonb NOT NULL DEFAULT '{}'::jsonb` — settlement values (each side's score, net-vs-line, etc.) for the detail page |
| `creator_message` | `text NULL` |
| `admin_note` | `text NULL` |
| `rematch_of_challenge_id` | `uuid NULL REFERENCES public.pvp_challenges(id) ON DELETE SET NULL` — self-FK for double-or-nothing (§11.10) |
| `created_at` / `updated_at` | audit (auto) |

Indexes: `creator_player_id`, `counterparty_player_id`, `season_id`, `week_id`,
`prop_market_id`, `subject_player_id`, `winner_player_id`, `rematch_of_challenge_id`.

> **Status note:** design §5.2 lists `draft`, `escrowed`, `settlement_pending`. v1
> drops `draft` (creation is immediate), folds `escrowed` into `accepted`→`locked`
> (escrow happens atomically on accept), and folds `settlement_pending` into `locked`
> (settlement is driven by week archive / admin, not a separate waiting state). Keep
> the CHECK list as written; add the dropped values later only if a real waiting state
> is introduced.

> **Derivation note:** escrow currently held for a contract =
> `SUM(pvp_ledger.amount) WHERE challenge_id = X AND type = 'stake'` (will be
> negative player-side / positive house-side; the held amount is the absolute player
> total). The winner is paid `total_pot`; there is no rake.

### `pvp_challenge_offers` (design §6.4)
Append-only offer/counteroffer history. The contract's *current* terms live on
`pvp_challenges`; this table is the auditable negotiation trail. The **latest row with
`superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL` is the only
acceptable offer** (design §6.3).

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `challenge_id` | `uuid NOT NULL REFERENCES public.pvp_challenges(id) ON DELETE CASCADE` |
| `offered_by_player_id` | `uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE` |
| `offer_no` | `int NOT NULL CHECK (offer_no >= 1)` — 1 = original, increments per counter |
| `contract_type` | `text NOT NULL` — snapshot of proposed type (mirrors challenge CHECK list) |
| `creator_stake` | `int NOT NULL CHECK (creator_stake > 0)` — proposed stake snapshot |
| `counterparty_stake` | `int NOT NULL CHECK (counterparty_stake > 0)` |
| `game_number` | `int NULL` — proposed scope snapshot |
| `prop_market_id` | `uuid NULL REFERENCES public.bet_markets(id) ON DELETE SET NULL` |
| `creator_selection` | `text NULL` |
| `counterparty_selection` | `text NULL` |
| `message` | `text NULL` |
| `superseded_at` | `timestamptz NULL` — set when a newer counter replaces this offer |
| `accepted_at` | `timestamptz NULL` |
| `declined_at` | `timestamptz NULL` |
| `created_at` / `updated_at` | audit (auto) |

Indexes: `challenge_id`, `offered_by_player_id`. Consider a partial index
`(challenge_id) WHERE superseded_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL`
to fetch the live offer fast.

### `pvp_ledger` (mirrors `loan_ledger`)
Append-only PvP economic event log. Every pin movement for a contract has a row here,
linked to the player-side `pin_ledger` row. **Held escrow / payouts are all
derivable from this table.**

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `challenge_id` | `uuid NOT NULL REFERENCES public.pvp_challenges(id) ON DELETE CASCADE` |
| `player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE CASCADE` — NULL on the house side of a transfer |
| `season_id` | `uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE` (denormalized) |
| `week_id` | `uuid NULL REFERENCES public.weeks(id) ON DELETE SET NULL` |
| `amount` | `int NOT NULL` — signed (see sign table) |
| `type` | `text NOT NULL CHECK (type IN ('stake','payout','refund'))` |
| `description` | `text NOT NULL` |
| `pin_ledger_id` | `uuid NULL REFERENCES public.pin_ledger(id) ON DELETE SET NULL` — the matching `pin_ledger` row |
| `created_at` / `updated_at` | audit (auto) |

Indexes: `challenge_id`, `player_id`, `season_id`, `week_id`, `pin_ledger_id`.

**Sign convention — enforce by writing the right sign in the RPCs.** Each economic
event writes **two** `pvp_ledger` rows (player + house), mirroring the two `pin_ledger`
rows, so the pair nets to 0:

| event | player row sign | house row sign |
|---|---|---|
| `stake` (escrow on accept) | − stake | + stake |
| `payout` (winner paid) | + total_pot | − total_pot |
| `refund` (push/void/cancel) | + stake | − stake |

> At settlement the pot (both stakes, already in House from `stake` events) is paid
> back out **in full** to the winner: winner `+ total_pot` / house `− total_pot`. There
> is no rake — the House nets exactly 0 per contract over its lifecycle (both stakes in,
> the full pot out), so every PvP event is a balanced player+house pair and the
> conservation invariant holds. (See §6 verification.)

> **Mutual-reference note** (same as Loan Shark): `pvp_ledger.pin_ledger_id` and
> `pin_ledger.pvp_ledger_id` reference each other. Insert order inside RPCs: insert the
> two `pin_ledger` rows → insert the `pvp_ledger` row(s) referencing the player pin row
> → `UPDATE` both `pin_ledger` rows' `pvp_ledger_id`. Add the `pvp_ledger → pin_ledger`
> FK in migration step 2 (after `pin_ledger.pvp_ledger_id` exists), or create
> `pvp_ledger` without that FK and add it later — both columns are nullable.

### RLS (mirror the `bet_*` / `loan_*` policies)
On all three tables: `ENABLE ROW LEVEL SECURITY`. Reads open to `anon` +
`authenticated`; direct INSERT/UPDATE/DELETE **admin-only**
(`(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`). All player write paths go
through the `SECURITY DEFINER` RPCs (which bypass RLS), so players never write these
tables directly. Copy the exact policy shape from the Loan Shark / betting tables'
migration.

---

## 2. `pin_ledger` extension

In `pin_ledger_pvp_support`:

```sql
ALTER TABLE public.pin_ledger
  ADD COLUMN pvp_ledger_id uuid REFERENCES public.pvp_ledger(id) ON DELETE SET NULL;
CREATE INDEX pin_ledger_pvp_ledger_id_idx ON public.pin_ledger (pvp_ledger_id);
```

**Extend the existing `pin_ledger.type` CHECK** (drop + re-add) to add the three PvP
types alongside the current set. **Confirm the live set first** with a read:
`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname LIKE 'pin_ledger_type%';`
(the live set is `bonus`, `score_credit`, `bet_stake`, `bet_payout`, `bet_refund`,
and the four `loan_*` types). Add:

```
pvp_stake
pvp_payout
pvp_refund
```

**Cancel-friendliness convention:** in every PvP transfer, stamp `pvp_ledger_id` on
**both** the player row and the house row (mirrors `bet_id` / `loan_ledger_id` on both
rows). `cancel_pvp_challenge` then deletes all pin rows by `pvp_ledger_id`, getting
both sides.

---

## 3. Engine helpers

In `pvp_engine_helpers`. `SET search_path = ''`, fully qualified.

### `pvp_player_line(p_player_id uuid, p_season_id uuid) RETURNS numeric`
The Line Duel snapshot value. Reuse the sportsbook formula from
`sync_over_under_markets_for_week` (`20260605005644_…`): the player's mean of
current-season **archived** scores, `floor(avg) + 0.5`; fall back to the league average
(`floor(league_avg)+0.5`) when the player has no archived scores yet. Extract the exact
SQL from that function so PvP and the sportsbook stay consistent. `STABLE`.

> If `sync_over_under_markets_for_week` is later refactored to expose a shared
> `player_line` helper, point both call sites at it. For v1, duplicating the formula
> here is acceptable — flag it with a comment cross-referencing the sportsbook RPC so
> the two are kept in sync.

---

## 4. RPCs

All in `pvp_challenge_rpcs`. Model structure on `place_house_bet` /
`settle_market_internal` / `cancel_bet` / `take_loan`. Balance is always derived:
`SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE player_id = X AND season_id = Y`.
"Current season" = `is_active = true AND registration_open = false` (the
`seasons.getCurrent()` rule). The contract's `week_id` must belong to that season and
**not be archived/locked** at create time (no contracts after the week's lock —
open-Q #11, v1 default).

### `create_pvp_challenge(...) RETURNS uuid` — `authenticated`
Params (all explicit; caller is `auth.uid()`):
`p_contract_type text, p_counterparty_player_id uuid /* NULL = open board */,
p_week_id uuid, p_game_number int, p_stake int, p_prop_market_id uuid,
p_creator_selection text, p_message text`.

1. Resolve `v_creator_id` from `auth.uid()` (RAISE if no player).
2. Resolve current season; RAISE if none. Validate `p_week_id` is in that season and
   not archived. (No expiry — challenges stay open until the game starts; see §4.)
3. Validate `p_stake >= 10` (min stake, v1 default §15-Q1) and creator balance
   `>= p_stake`. (Balance only checked here for UX; re-checked at accept.)
4. Validate `p_counterparty_player_id <> v_creator_id` (no self-challenge); if not
   NULL, ensure the player exists. Validate scope per `p_contract_type`:
   - `line_duel` / `raw_score_duel`: `p_game_number` required.
   - `prop_duel`: `p_prop_market_id` required + open; `p_creator_selection` must be a
     valid `bet_selections.key` for that market; derive `counterparty_selection` as the
     opposite key and `subject_player_id` from the market.
5. **No-tank guard (design §2 / anti-tank trigger):** reject contract shapes that let a
   player profit from underperforming. (Line/Prop/Raw duels are overperformance- or
   neutral-framed; document that any future "under your own line" type is disallowed.)
6. INSERT `pvp_challenges` (`status='pending'`, symmetric stakes
   `creator_stake = counterparty_stake = p_stake`, `total_pot = 2*p_stake`,
   `payout_amount = total_pot` — winner takes the whole pot, no rake).
   **No escrow.** Capture `v_challenge_id`.
7. INSERT the original `pvp_challenge_offers` row (`offer_no = 1`, snapshot of terms).
8. `RETURN v_challenge_id`.

### `counter_pvp_challenge(...) RETURNS uuid` — `authenticated`
Params: `p_challenge_id uuid, p_stake int, p_contract_type text, p_game_number int,
p_prop_market_id uuid, p_selection text, p_message text`.

1. Resolve caller; load the challenge `FOR UPDATE`. RAISE unless status in
   (`pending`,`countered`) and caller is a current party (creator or counterparty; for
   open-board contracts the counterparty is set the moment a specific player counters).
2. Identify the latest active offer; RAISE if the caller made it (can't counter your own
   live offer — it's the other party's turn).
3. Validate new terms (stake ≥ 10, scope valid, balance check on the *countering*
   player for their side).
4. `UPDATE` the prior active offer `SET superseded_at = now()`.
5. INSERT a new `pvp_challenge_offers` row (`offer_no = prev + 1`, new snapshot).
6. `UPDATE pvp_challenges` to the new current terms, recompute
   `total_pot` and `payout_amount` (`= total_pot`), set `status='countered'`,
   and set `counterparty_player_id` if it was an open-board contract now being
   negotiated by a specific player.
7. `RETURN v_challenge_id`.

### `accept_pvp_challenge(p_challenge_id uuid) RETURNS void` — `authenticated`
The escrow moment. Mirror `place_house_bet`'s double-entry for each side.

1. Resolve caller; load challenge `FOR UPDATE`. RAISE unless status in
   (`pending`,`countered`).
2. Identify the latest active offer; RAISE if caller made it (you accept the *other*
   party's offer). For an **open-board** contract (`counterparty_player_id IS NULL`),
   the caller becomes the counterparty now (FCFS, exact posted terms — §13/v1) — set it.
3. Week not archived (no expiry check — challenges stay open until the game starts).
4. Re-derive **both** players' balances; RAISE if either `< their stake`.
5. **Escrow both stakes** — for each player, write the double-entry pin pair
   (`type='pvp_stake'`, player `−stake` / house `+stake`, `is_house` set correctly,
   `week_id` = challenge week, both rows `bet_id`/`loan_ledger_id` NULL), then a matching
   `pvp_ledger` pair (`type='stake'`, signs mirroring), and `UPDATE` both pin rows'
   `pvp_ledger_id`. (4 pin rows + 4 pvp_ledger rows total.)
6. **Snapshot settlement basis:**
   - `line_duel`: `creator_line = pvp_player_line(creator, season)`,
     `counterparty_line = pvp_player_line(counterparty, season)`.
   - `prop_duel`: nothing to snapshot beyond the already-stored `prop_market_id` +
     selections (the market's `line` is read at settlement).
   - `raw_score_duel`: nothing to snapshot.
7. Mark the accepted offer `accepted_at = now()`; `UPDATE pvp_challenges`
   `SET status='locked', accepted_at=now(), locked_at=now()` (v1 locks immediately on
   accept since contracts can't be created after the week lock anyway). Re-affirm
   `total_pot` and `payout_amount` (`= total_pot`).

### `decline_pvp_challenge(p_challenge_id uuid) RETURNS void` — `authenticated`
1. Resolve caller; load challenge. RAISE unless status in (`pending`,`countered`).
   Caller must be an actual party — the creator or the (set) counterparty — **and** the
   offer recipient (not the offerer). An open-board contract has no counterparty yet, so
   only the creator is a party and the creator can't decline their own live offer; this
   means a stranger can never decline (cancel) someone's open-board challenge.
2. Mark the active offer `declined_at = now()`; `UPDATE pvp_challenges
   SET status='cancelled'`. **No escrow exists**, so no refund. (Declines are never
   surfaced publicly — §15-Q8 / no feed in v1.)

### `cancel_pvp_challenge(p_challenge_id uuid) RETURNS void` — admin-gated
Admin cancellation of a pending/locked contract (design §4.5, §14). **Hard delete** —
makes it as if the contract never existed, mirroring `cancel_loan`/`cancel_bet`.
1. Admin gate. Load challenge.
2. Delete the escrow pin rows by `pvp_ledger_id` (both player + house sides):
   `DELETE FROM public.pin_ledger WHERE pvp_ledger_id IN (SELECT id FROM public.pvp_ledger WHERE challenge_id = p_challenge_id);`
   (`pin_ledger.pvp_ledger_id` is `ON DELETE SET NULL`, so these must go first or
   they orphan.)
3. `DELETE FROM public.pvp_challenges WHERE id = p_challenge_id` — `pvp_ledger` and
   `pvp_challenge_offers` both cascade `ON DELETE CASCADE`, so the contract row and
   all its children disappear.

> Implemented as the **delete** form (migration `20260607012000_pvp_cancel_hard_delete`).
> Use `void_pvp_challenge` (reversal, keeps the row + history) for *post-settlement*
> correction; `cancel` is the clean pre-settlement rollback.

### `void_pvp_challenge(p_challenge_id uuid, p_admin_note text) RETURNS void` — admin-gated
Design §4.5 void: contract can't be settled fairly → refund both stakes.
1. Admin gate. Load challenge `FOR UPDATE`; RAISE unless `locked` or `settled`.
2. If already `settled`, **reverse the `payout` movement first** (write a reversing
   `pvp_refund` pair for each `payout` pvp_ledger row) so the winner isn't paid twice.
   Then refund both stakes (`pvp_refund` pairs). (There is no rake to reverse.)
3. `UPDATE pvp_challenges SET status='voided', admin_note = p_admin_note, settled_at=now()`.

### `settle_pvp_challenge(p_challenge_id uuid, p_source text, p_winner_player_id uuid, p_admin_note text) RETURNS void`
The common settlement interface (design §7.3). `p_source IN ('automatic','admin')`.
Admin-gated for `admin`; for `automatic` it is invoked internally by
`settle_pvp_for_week` (a SECURITY DEFINER caller). Idempotent.

1. **Idempotency guard** — `RETURN` early if status already in
   (`settled`,`pushed`,`voided`,`cancelled`).
2. Load challenge `FOR UPDATE`; require status `locked`.
3. **Compute outcome** by `contract_type`:
   - `line_duel`: read each subject's actual game score (see "reading scores" below);
     `net = score − snapshot_line` for each side; higher `net` wins; equal `net` →
     **push**. Record both scores + nets in `result_detail`.
   - `prop_duel`: read the prop market's `result_value` (or the subject's actual score);
     reuse `settle_market_internal`'s comparison logic (`result_value` vs the selection
     `line`) to decide which selection won; the player holding the winning selection
     wins; if the market pushes → **push**. Store the market result in `result_detail`.
   - `raw_score_duel`: compare each side's raw actual game score; higher wins; tie →
     **push**.
   - For `p_source='admin'` with `p_winner_player_id` supplied, the admin's pick
     overrides computed outcome (manual adjudication, design §7.3 "fully admin").
4. **If a winner:** pay the **whole pot** back out — winner `+total_pot` / house
   `−total_pot` (`type='pvp_payout'`) pin pair + a matching `pvp_ledger` `payout` row.
   Stamp `pvp_ledger_id` on both pin rows. There is **no rake** — the House nets 0 over
   the contract (both stakes in, full pot out). `UPDATE` challenge
   `status='settled', winner_player_id, settled_at=now(), result_detail`.
5. **If push/void:** refund both stakes (`pvp_refund` pairs);
   `status='pushed'` (or `voided` if data missing/unfair), `settled_at=now()`.
6. If `p_source='admin'`, store `p_admin_note`.

**Reading scores** (mirror `settle_betting_for_week`): join
`scores → games(game_number) → … → team_slots(player_id, is_fill=false)` filtered to
the contract's `week_id` and `game_number`, `score IS NOT NULL`. If the required
score(s) don't exist after archive → **void** (can't settle fairly, §4.5).

### `settle_pvp_for_week(p_week_id uuid) RETURNS void` — admin-gated
Idempotent batch driver, called by `settle_betting_for_week` after pincome is minted.
1. Admin gate (or rely on the SECURITY DEFINER caller). Resolve the week's season.
2. For each `locked` contract with this `week_id` whose `contract_type` is
   **auto-settleable** (`line_duel`,`prop_duel`,`raw_score_duel`):
   `PERFORM public.settle_pvp_challenge(id, 'automatic', NULL, NULL);`
   (the per-contract idempotency guard makes re-runs safe).
3. Contract types requiring admin adjudication (none in v1) are skipped for manual
   settle.

### `close_open_pvp_challenges(p_week_id uuid, p_game_number int) RETURNS void` — admin-gated
Close every still-open negotiation for a week, optionally narrowed to one game. Stamp
the live offer's `declined_at` and set `status='cancelled'`:
`UPDATE public.pvp_challenges SET status='cancelled'
 WHERE week_id = p_week_id AND status IN ('pending','countered')
   AND (p_game_number IS NULL OR game_number = p_game_number);`
The status filter inherently skips accepted/locked contracts, so an already-accepted
challenge is never closed. No escrow exists on pending/countered, so nothing to refund.
Called game-scoped by Matchups "Start Game" (`game_number = N`) and week-wide by
`settle_pvp_for_week` (`game_number = NULL`).

---

## 5. Weekly-flow integration (no client window)

In `settle_betting_for_week_pvp`, `CREATE OR REPLACE FUNCTION
public.settle_betting_for_week(p_week_id uuid)` reusing the **current body verbatim**
(copy from the latest `settle_betting_for_week` migration) and append, as the last
statements before `END;`:

```sql
  -- PvP: settle locked contracts for this week in the same transaction as the
  -- score_credit mint (no intermediate player window). settle_pvp_for_week first
  -- closes any still-open challenges for the week (close_open_pvp_challenges).
  PERFORM public.settle_pvp_for_week(p_week_id);
```

This guarantees PvP settlement runs in the same transaction as the `score_credit`
mint, immediately after scores are credited. `AdminArchiveModal` needs **no change** —
it already calls `settle_betting_for_week`.

> Ordering: PvP settlement reads the same `scores` rows the betting settlement reads;
> it does **not** depend on `score_credit` rows, so it can run before or after the
> betting `settle_market_internal` loop. Placing it last keeps the diff minimal.

---

## 6. Verification (run after `db push`, mirror `PIN_ECONOMY_SCHEMA.md` §10)

Use a throwaway / non-prod season. SQL reads via `supabase db query --linked`.

1. **Schema/advisors** — `supabase db lint` clean; every new FK indexed; all functions
   have a pinned `search_path`; the three tables sort together under `pvp_`.
2. **create → no escrow** — `create_pvp_challenge` leaves both players' balances
   unchanged and writes **zero** `pvp_ledger` rows; a `pvp_challenge_offers` row
   (`offer_no=1`) exists; `status='pending'`.
3. **counter** — `counter_pvp_challenge` supersedes the prior offer (`superseded_at`
   set), inserts `offer_no=2`, recomputes `total_pot`/`payout_amount`,
   `status='countered'`; only the latest non-superseded/non-resolved offer is acceptable.
4. **accept → escrow nets 0** — both balances drop by their stake; four `pvp_stake`
   pin rows sum to 0; each pair carries the same `pvp_ledger_id`; Line Duel snapshots
   `creator_line`/`counterparty_line`; `status='locked'`. Accepting your own latest
   offer raises; accepting with insufficient balance raises.
4a. **close on game start** — `close_open_pvp_challenges(week, N)` flips every open
   (`pending`/`countered`) Game-N challenge to `cancelled` and stamps its live offer's
   `declined_at`; a `locked` (accepted) Game-N challenge is untouched.
5. **payout = pot** — `payout_amount = total_pot` for every contract (no rake; winner
   takes the whole pot).
6. **auto-settle (archive)** — archive a week with a locked Line Duel: winner gets
   `+total_pot`, house nets 0 overall (both stakes in, full pot out), loser gets nothing
   back; `result_detail` holds both scores/nets; **re-running `settle_betting_for_week`
   is a no-op** (idempotency guard). Equal nets → `pushed` with both stakes refunded.
7. **prop_duel settle** — agrees with the existing market settlement: the side holding
   the winning `bet_selections.key` wins; a market push → contract `pushed`.
8. **missing score → void** — a locked contract whose game has no archived score after
   settle becomes `voided` with both stakes refunded.
9. **admin tools** — `cancel_pvp_challenge` (pre-settlement) rolls escrow back to
   pre-accept state; `void_pvp_challenge` refunds (reversing the payout first if the
   contract was already settled); admin `settle_pvp_challenge(..., 'admin', winner)`
   overrides computed outcome.
10. **Conservation invariant (§10.2)** — `SUM(pin_ledger.amount)` per season still
    equals `SUM(score_credit)`: every PvP `stake`/`payout`/`refund` is a player+house
    pair netting 0, so all PvP rows net 0 House-side overall (no rake row to leak).
    Confirm with the §10 conservation query.
