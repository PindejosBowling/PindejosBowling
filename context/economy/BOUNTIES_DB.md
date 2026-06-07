# Bounty Board — Database Implementation Spec

> **⚠️ Superseded by the "All Comers" redesign.** This spec describes the original
> early-hunter anti-dilution model (`floor(S / entry_number)` + House seed). The
> mechanic was redesigned — see `ECONOMIC_DESIGN_BOUNTIES.md` §13–§14. The **as-built**
> current schema/RPCs are the original four migrations (`20260607215737`–`…215740`)
> **plus** `supabase/migrations/20260607220000_bounty_all_comers.sql`, which:
> adds `bounty_post.reward_per_hunter` + `max_hunters`; repurposes `sponsor_bounty_amount`
> to hold the total sponsor escrow `reward × max_hunters`; rebuilds `create_sponsor_bounty`
> / `create_house_bounty` with the arg list
> `(week, title, description, reward_per_hunter, hunter_stake_amount, max_hunters, closes_at)`;
> caps `enter_bounty_as_hunter` at `max_hunters` and snapshots the flat reward into
> `protected_hunter_profit`; and pays `H + R` per hunter on a hunter win (returning the
> sponsor's unused `(m − n) × R` escrow), `n × H` to the sponsor on a sponsor win. The
> House seed is `0` for sponsor bounties and `n × R` only for a House bounty that loses.
> Sections below that reference per-entry dilution / `floor(S/k)` / House seed are
> historical; read them through that migration.
>
> **v1 is House-only.** `20260607221500_bounty_house_only_v1.sql` revokes EXECUTE on
> `create_sponsor_bounty(uuid,text,text,int,int,int,timestamptz)` from `authenticated`,
> so players cannot self-sponsor even via direct API calls — only admin-posted
> `create_house_bounty` and `enter_bounty_as_hunter` are reachable by clients. The
> function is kept (not dropped) for a future player-sponsor phase; re-`GRANT` to
> restore. Rationale + the planned admin-approval gate: `ECONOMIC_DESIGN_BOUNTIES.md` §3.3.

Handoff spec for the **database layer** of the Bounty Board feature. Self-contained and
executable independently of the app-layer spec (`economy/BOUNTIES_APP.md`), which depends on
this being applied (`supabase db push`) + `app/src/utils/supabase/database.types.ts`
regenerated.

**Read first:** `economy/ECONOMIC_DESIGN_BOUNTIES.md` (the product design — every `§`
reference below points to it) and `supabase/PIN_ECONOMY_SCHEMA.md` §4–§6, §10 (the ledger /
RPC conventions + the conservation/verification model you must mirror). The **PvP DB spec**
(`economy/PvP_DB.md`) is the closest existing analog — same escrow shape, same double-entry
ledger, same destructive admin cancel, same Activity Feed "new publisher" wiring — read it
for worked examples. The Activity Feed recipe for adding a new publisher
(`context/activity-feed.md` "Recipe B") is the literal template for §9 below.

> **Hard rule (AGENTS.md §2):** every change here is a migration file created with
> `supabase migration new …` and applied with `supabase db push`. Never write to the DB
> directly. The Supabase CLI needs `SUPABASE_ACCESS_TOKEN` from `app/.env.local` +
> `--linked --workdir $(pwd)` (AGENTS.md §3). Project ref `lyihsvxraurjghjqxaau`.

---

## Scope of this spec (v1 — design §6)

Four tables (`bounty_post`, `bounty_hunter_stakes`, `bounty_settlements`, `bounty_payouts`),
a `pin_ledger` extension (one root FK + three new ledger types), the bounty RPCs
(create-sponsor / create-house / enter / close / settle / cancel), and the Activity Feed
"new publisher" wiring (a `bounty_post_id` source FK + the `bounty_board` feature + five
event types + publish calls).

**V1 supports** (design §6): House-posted bounties; player-posted sponsor bounties; freeform
title/description; fixed sponsor + hunter amounts; one hunter entry per player; entry-order
**early-hunter anti-dilution** (snapshotted `protected_hunter_profit`); the Pinsino
**House seed** funded at settlement; **manual admin settlement only** with two outcomes
(`sponsor_win` / `hunter_win`); **destructive admin cancellation**; Activity Feed
integration; ledger-first accounting.

**V1 does not support** (design §6, §9, §17.3): automatic settlement; machine-readable
conditions; a `void` settlement outcome; rake / House fees; partial refunds as a normal
outcome; hunter counteroffers; multiple entries per player; sponsor self-cancel after
hunters enter. There is **no `cancelled` status** — admin cancellation is a hard delete
(§27).

---

## Naming rule (non-negotiable)

Table names are taken **verbatim from design §18** (note: singular `bounty_post`, unlike the
plural `pvp_challenges`): `bounty_post`, `bounty_hunter_stakes`, `bounty_settlements`,
`bounty_payouts`. The `pin_ledger` root linking column is `bounty_post_id` (plus optional
granular `bounty_hunter_stake_id` / `bounty_settlement_id` / `bounty_payout_id`). The new
`pin_ledger.type` values are `bounty_sponsor_stake`, `bounty_hunter_stake`, `bounty_payout`
— **no** `bounty_refund` / `bounty_void` / `bounty_cancelled` (design §23.2; cancellation
deletes rows, it does not write reversals). The Activity Feed source FK is `bounty_post_id`
and the source feature is `bounty_board`.

---

## Conventions every object in this spec must follow

From `PIN_ECONOMY_SCHEMA.md` §5–§6 — non-negotiable (identical to the PvP / Activity specs):

- **New tables:** include `created_at timestamptz NOT NULL DEFAULT now()` and
  `updated_at timestamptz NOT NULL DEFAULT now()` **and nothing else for audit** — the
  `enforce_audit_columns` event trigger auto-attaches `set_updated_at`. Do **not** declare a
  `set_updated_at` trigger yourself (it collides).
- **Index every FK column** (Postgres doesn't auto-index FKs; the advisor flags it).
- All ids `uuid` (`gen_random_uuid()`); all `season_id`/`week_id`/`*_player_id` are uuid FKs.
- **RPCs:** `SECURITY DEFINER`, `SET search_path = ''`, every object fully qualified as
  `public.<name>`. Resolve the **caller's** identity from `auth.uid()` — never accept a
  client-supplied player id for the caller. `REVOKE EXECUTE … FROM PUBLIC, anon;` then
  `GRANT EXECUTE … TO authenticated;`. Admin gate:
  `IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;`
- **Append-only ledgers** — corrections are new rows, never in-place edits, **except** the
  destructive admin cancel, which deletes the exact rows (§27, mirror `cancel_pvp_challenge`).
- **Voluntary-risk guardrail (design §28.1):** a player only loses pins by an explicit action
  — sponsoring (escrow at create) or entering as hunter (escrow at entry). No player is ever
  charged because someone else posted a bounty.

**Reference implementations to copy from** (read them before writing):
- `supabase/migrations/20260607180200_activity_feed_pvp.sql` — the **as-built**
  `accept_pvp_challenge` / `settle_pvp_challenge`: the exact double-entry escrow pattern
  (player −stake / house +stake), the mirrored domain-ledger row, the mutual
  `pin_ledger ↔ *_ledger` FK update, and the embedded `publish_activity_event` calls. This is
  also the worked example of the Activity Feed "new publisher" move (§9).
- `supabase/migrations/20260607012000_pvp_cancel_hard_delete.sql` — the destructive
  `cancel_pvp_challenge` (delete pin rows by domain-ledger link, then delete the root row so
  children + feed rows cascade). Mirror it for `cancel_bounty`.
- `supabase/migrations/20260606191026_loan_shark_tables.sql` +
  `…191027_loan_shark_rpcs.sql` — the table + DO-block RLS pattern, the `pin_ledger.type`
  CHECK drop/re-add, and the mutually-referential `pin_ledger ↔ *_ledger` link setup.
- `supabase/migrations/20260607002141_pin_ledger_pvp_support.sql` — the current
  `pin_ledger.type` CHECK to extend (confirm the live set before editing; see §7).

There is **no line/odds math** to reuse — bounty economics are pure integer arithmetic
(`floor`, `SUM`, `max`); see §8.7 / §26.

---

## Suggested migration ordering

One logical change per migration file (timestamps assigned by the CLI):

1. `bounty_board_tables` — the four tables + indexes + uniqueness constraints + RLS.
2. `pin_ledger_bounty_support` — `bounty_post_id` (+ optional granular FK) columns + indexes;
   extend the `pin_ledger.type` CHECK with the three `bounty_*` types; set the mutual-ref FK
   on the bounty ledger linkage.
3. `bounty_board_rpcs` — `create_sponsor_bounty`, `create_house_bounty`,
   `enter_bounty_as_hunter`, `close_bounty`, `settle_bounty`, `cancel_bounty`.
4. `activity_feed_bounty` — Recipe B: add the `bounty_post_id` source FK + indexes + the
   one-source CHECK term, the `bounty_board` source feature + five event types, the
   16→17-arg `publish_activity_event` rebuild, and `CREATE OR REPLACE` the bounty RPCs to add
   the publish calls.

(Steps 1–2 may be combined; keep 3 and 4 separate for reviewability. Step 4 must come after
3 so the RPCs exist to be replaced.)

---

## 1. Tables (design §18–§22)

### `bounty_post` (design §19) — the root object

The source object for a bounty. Lifecycle + fixed terms; **no stored balances** (escrow and
seed are derived from `pin_ledger` / computed at settlement).

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `season_id` | `uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE` |
| `week_id` | `uuid NULL REFERENCES public.weeks(id) ON DELETE SET NULL` |
| `bounty_type` | `text NOT NULL CHECK (bounty_type IN ('house_bounty','sponsor_bounty'))` |
| `sponsor_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE CASCADE` — NULL for `house_bounty`, required for `sponsor_bounty` |
| `title` | `text NOT NULL` — freeform (≤80 chars, app-enforced; §34.1) |
| `description` | `text NOT NULL` — freeform (≤1000 chars, app-enforced) |
| `sponsor_bounty_amount` | `int NOT NULL CHECK (sponsor_bounty_amount > 0)` |
| `hunter_stake_amount` | `int NOT NULL CHECK (hunter_stake_amount > 0)` |
| `house_seed_mode` | `text NOT NULL DEFAULT 'early_hunter_anti_dilution' CHECK (house_seed_mode = 'early_hunter_anti_dilution')` |
| `closes_at` | `timestamptz NOT NULL` — **no DB default**; computed in app logic (upcoming Monday 7:00 PM ET, design §11) |
| `status` | `text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','settled'))` — no `cancelled` (cancel = delete, §27) |
| `created_at` / `updated_at` | audit (auto) |

Type/sponsor consistency CHECK (design §19.2):

```sql
CONSTRAINT bounty_post_sponsor_consistency CHECK (
  (bounty_type = 'house_bounty'   AND sponsor_player_id IS NULL) OR
  (bounty_type = 'sponsor_bounty' AND sponsor_player_id IS NOT NULL)
)
```

Additional CHECKs (design §19.2): `closes_at > created_at`. (Amount/status/type/seed-mode
CHECKs are inline above.)

Indexes (design §31): `season_id`, `week_id`, `sponsor_player_id` (partial
`WHERE sponsor_player_id IS NOT NULL`), plus the board/week composites:

```sql
CREATE INDEX bounty_post_board_idx ON public.bounty_post (season_id, status, closes_at, created_at DESC);
CREATE INDEX bounty_post_week_idx  ON public.bounty_post (week_id, status, closes_at);
```

> **Removed fields (design §19.1):** do **not** add `sponsor_type`, `subject_player_id`,
> `created_by_*_id`, `condition_key`, `condition_config`, `settlement_mode`,
> `*_win_label`, `rake_rate`, `min_hunters`, `max_hunters`. `bounty_type` + the description
> carry everything v1 needs; settlement is fully manual; there is no rake.

### `bounty_hunter_stakes` (design §20) — a hunter's entry

One row per hunter; at most one per player per bounty.

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `bounty_post_id` | `uuid NOT NULL REFERENCES public.bounty_post(id) ON DELETE CASCADE` |
| `player_id` | `uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE` |
| `stake_amount` | `int NOT NULL CHECK (stake_amount > 0)` — snapshot of `bounty_post.hunter_stake_amount` at entry (design §20.1) |
| `entry_number` | `int NOT NULL CHECK (entry_number >= 1)` — order of entry, assigned transactionally (§20.2) |
| `protected_hunter_profit` | `int NOT NULL CHECK (protected_hunter_profit >= 0)` — `floor(sponsor_bounty_amount / entry_number)`, snapshotted at entry; never changes (§20.3) |
| `status` | `text NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost'))` — no `refunded`/`voided`/`cancelled` (§20.4) |
| `entered_at` | `timestamptz NOT NULL DEFAULT now()` |
| `resolved_at` | `timestamptz NULL` |
| `created_at` / `updated_at` | audit (auto) |

Uniqueness (design §20, §31):

```sql
ALTER TABLE public.bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_unique_player        UNIQUE (bounty_post_id, player_id);
ALTER TABLE public.bounty_hunter_stakes ADD CONSTRAINT bounty_hunter_unique_entry_number  UNIQUE (bounty_post_id, entry_number);
```

Indexes (design §31): `(bounty_post_id, entry_number)` and `(player_id, bounty_post_id)`
(the two unique constraints already cover the first composite; add the player index).

### `bounty_settlements` (design §21) — the resolved outcome + snapshot economics

One row per settled bounty (enforced by a unique index).

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `bounty_post_id` | `uuid NOT NULL REFERENCES public.bounty_post(id) ON DELETE CASCADE` |
| `settlement_outcome` | `text NOT NULL CHECK (settlement_outcome IN ('sponsor_win','hunter_win'))` — no `void` (§21.2) |
| `settlement_source` | `text NOT NULL DEFAULT 'admin' CHECK (settlement_source = 'admin')` — admin only in v1 (§21.1) |
| `total_sponsor_bounty` | `int NOT NULL` — snapshot of `sponsor_bounty_amount` |
| `total_hunter_stakes` | `int NOT NULL` — `SUM(stake_amount)` |
| `total_protected_hunter_profit` | `int NOT NULL` — `SUM(protected_hunter_profit)` |
| `total_house_seed` | `int NOT NULL` — `max(0, total_protected_hunter_profit - total_sponsor_bounty)` |
| `total_pot` | `int NOT NULL` — `total_sponsor_bounty + total_hunter_stakes + total_house_seed` |
| `winner_count` | `int NOT NULL` — 1 (sponsor_win) or hunter count (hunter_win) |
| `settled_by_admin_id` | `uuid NOT NULL REFERENCES public.players(id) ON DELETE SET NULL` — the resolving admin's player id |
| `admin_settlement_reasoning` | `text NOT NULL` — required justification (§21.4), shown publicly on detail |
| `settled_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` / `updated_at` | audit (auto) |

> `settled_by_admin_id` is `NOT NULL` but the FK is `ON DELETE SET NULL` to survive a player
> deletion without dropping the settlement row; in practice it is always populated at write
> time from the admin's `players.id`. (If a stricter NOT-NULL-forever guarantee is wanted,
> use `ON DELETE RESTRICT` instead — either is acceptable for v1.)

Single-settlement constraint (design §31) + FK index:

```sql
CREATE UNIQUE INDEX bounty_settlements_one_per_post ON public.bounty_settlements (bounty_post_id);
CREATE INDEX        bounty_settlements_admin_idx    ON public.bounty_settlements (settled_by_admin_id);
```

### `bounty_payouts` (design §22) — winner-specific payout rows

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `bounty_settlement_id` | `uuid NOT NULL REFERENCES public.bounty_settlements(id) ON DELETE CASCADE` |
| `bounty_post_id` | `uuid NOT NULL REFERENCES public.bounty_post(id) ON DELETE CASCADE` (denormalized for cancel/index) |
| `player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE CASCADE` — NULL only for the optional House row |
| `is_house` | `boolean NOT NULL DEFAULT false` |
| `payout_amount` | `int NOT NULL CHECK (payout_amount > 0)` |
| `created_at` / `updated_at` | audit (auto) |

Indexes (design §31): `bounty_post_id`, `bounty_settlement_id`, `player_id`.

> **House-bounty sponsor win (design §22.3):** no player payout is needed. Optionally write a
> single `is_house = true, player_id = NULL, payout_amount = total_pot` row for reporting —
> keep it clearly separate from player-facing rows. It is **not** required for balances and
> creates **no** `pin_ledger` movement (House-to-House is not ledgered, §23.4 / §17.1).

### RLS (mirror the `pvp_*` / `loan_*` policies)

On all four tables: `ENABLE ROW LEVEL SECURITY`. Reads open to `anon` + `authenticated`;
direct INSERT/UPDATE/DELETE **admin-only**
(`(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`). All player write paths go through
the `SECURITY DEFINER` RPCs (which bypass RLS), so players never write these tables directly.
Copy the exact DO-block policy shape from `loan_shark_tables.sql` / the PvP tables migration.

---

## 2. `pin_ledger` extension (`pin_ledger_bounty_support`)

```sql
ALTER TABLE public.pin_ledger
  ADD COLUMN bounty_post_id uuid REFERENCES public.bounty_post(id) ON DELETE CASCADE;
CREATE INDEX pin_ledger_bounty_post_id_idx ON public.pin_ledger (bounty_post_id);
```

The root `bounty_post_id` is the **most important linkage** — it is what destructive cancel
deletes by (design §23.1). It must be stamped on **every** bounty-related ledger row, on
**both** the player side and the house side of each pair.

Optional granular FKs (design §23.1) — add if you want per-stake/per-payout drill-down; not
required for v1 correctness:

```sql
ALTER TABLE public.pin_ledger ADD COLUMN bounty_hunter_stake_id uuid REFERENCES public.bounty_hunter_stakes(id) ON DELETE CASCADE;
ALTER TABLE public.pin_ledger ADD COLUMN bounty_settlement_id   uuid REFERENCES public.bounty_settlements(id)   ON DELETE CASCADE;
ALTER TABLE public.pin_ledger ADD COLUMN bounty_payout_id       uuid REFERENCES public.bounty_payouts(id)       ON DELETE CASCADE;
-- index each if added.
```

**Extend the `pin_ledger.type` CHECK.** Confirm the live set first
(`20260607002141_pin_ledger_pvp_support.sql` is the latest), then drop + re-add the full
list plus the three bounty types:

```sql
ALTER TABLE public.pin_ledger DROP CONSTRAINT IF EXISTS pin_ledger_type_check;
ALTER TABLE public.pin_ledger
  ADD CONSTRAINT pin_ledger_type_check CHECK (type IN (
    'bonus', 'score_credit',
    'bet_stake', 'bet_payout', 'bet_refund',
    'loan_issued', 'loan_manual_repayment',
    'loan_weekly_garnishment', 'loan_season_close_settlement',
    'pvp_stake', 'pvp_payout', 'pvp_refund', 'pvp_rake',
    'bounty_sponsor_stake', 'bounty_hunter_stake', 'bounty_payout'   -- Bounty Board transfers
  ));
```

> **Cancel-friendliness:** stamp `bounty_post_id` on both rows of every bounty pair so
> `cancel_bounty` deletes all of them with one `DELETE … WHERE bounty_post_id = X` (§27).

---

## 3. RPCs (`bounty_board_rpcs`)

Model structure on the as-built `accept_pvp_challenge` / `settle_pvp_challenge`. Balance is
always derived:
`SELECT COALESCE(SUM(amount),0) FROM public.pin_ledger WHERE player_id = X AND season_id = Y`.
"Current season" = `is_active = true AND registration_open = false` (`seasons.getCurrent()`).

**Sign convention** (enforced by writing the right sign; every event is a balanced
player+house pair that nets to 0 — there is no rake):

| event | `pin_ledger.type` | player row | house row |
|---|---|---|---|
| sponsor escrow (create) | `bounty_sponsor_stake` | − S | + S |
| hunter escrow (entry) | `bounty_hunter_stake` | − H | + H |
| payout (settlement) | `bounty_payout` | + payout | − payout |

The House nets to 0 over a `sponsor_bounty` lifecycle when sponsor wins; when **hunters**
win it nets to **−`total_house_seed`** (the seed is a deliberate House subsidy, design
§14.5). For a `house_bounty` the House posts no create-escrow, so on sponsor_win it nets
**+`total_hunter_stakes`** and on hunter_win **−(sponsor_bounty + seed)** — both are intended
House-funded outcomes (design §17.1). Either way every individual event is a balanced pair,
so the conservation invariant holds (§10).

### `create_sponsor_bounty(...) RETURNS uuid` — `authenticated`

Params (caller is `auth.uid()`): `p_week_id uuid, p_title text, p_description text,
p_sponsor_bounty_amount int, p_hunter_stake_amount int, p_closes_at timestamptz`.

1. Resolve `v_sponsor_id` from `auth.uid()` (RAISE if no player).
2. Resolve current season; RAISE if none. Validate `p_week_id` (if given) belongs to it and
   is not archived.
3. Validate `length(p_title) > 0`, `length(p_description) > 0`,
   `p_sponsor_bounty_amount >= 50` (min, §34.5), `p_hunter_stake_amount >= 25` (min),
   `p_closes_at > now()`.
4. Validate sponsor balance `>= p_sponsor_bounty_amount`.
5. INSERT `bounty_post` (`bounty_type='sponsor_bounty'`, `sponsor_player_id=v_sponsor_id`,
   `status='open'`, `house_seed_mode='early_hunter_anti_dilution'`). Capture `v_bounty_id`.
6. **Escrow the sponsor amount** (design §23.3): insert the player pin row
   (`-p_sponsor_bounty_amount`, `type='bounty_sponsor_stake'`, `is_house=false`,
   `bounty_post_id=v_bounty_id`, `week_id=p_week_id`) and the house pin row
   (`+p_sponsor_bounty_amount`, `is_house=true`, same link). (No separate bounty-domain
   ledger table exists — `pin_ledger` rows carry `bounty_post_id` directly.)
7. `RETURN v_bounty_id`. (Publish call added in step 4 of the migration plan; see §9.)

### `create_house_bounty(...) RETURNS uuid` — admin-gated

Same params as above **minus** any sponsor identity (the House is the sponsor). Admins act on
behalf of the Pinsino (design §25.2).

1. Admin gate. Resolve current season; validate `p_week_id`, title/description, amounts,
   `closes_at` as in `create_sponsor_bounty`.
2. INSERT `bounty_post` (`bounty_type='house_bounty'`, `sponsor_player_id=NULL`,
   `status='open'`).
3. **No ledger movement** — the House funds the bounty only if hunters win (design §23.4).
   The promised amount lives on `bounty_post.sponsor_bounty_amount`.
4. `RETURN v_bounty_id`.

### `enter_bounty_as_hunter(p_bounty_post_id uuid) RETURNS uuid` — `authenticated`

The escrow + anti-dilution moment. **Must be serialized per bounty** so `entry_number` is
unique and `protected_hunter_profit` is deterministic (design §32.1).

1. Resolve caller `v_hunter_id`; RAISE if no player.
2. `SELECT * FROM public.bounty_post WHERE id = p_bounty_post_id FOR UPDATE` (row lock —
   serializes concurrent entries). RAISE if not found.
3. Validate `status = 'open'` and `now() < closes_at`.
4. RAISE if `bounty_type = 'sponsor_bounty' AND sponsor_player_id = v_hunter_id` (sponsor
   cannot hunt own bounty, design §28.2).
5. RAISE if the player already entered
   (`EXISTS (… bounty_hunter_stakes WHERE bounty_post_id = X AND player_id = v_hunter_id)`;
   the unique constraint also backstops this, §28.3).
6. Validate hunter balance `>= hunter_stake_amount`.
7. Compute `v_entry_number = COALESCE(MAX(entry_number),0)+1` over existing stakes for this
   bounty (safe under the `FOR UPDATE` lock), and
   `v_protected = floor(sponsor_bounty_amount / v_entry_number)` (integer division).
8. INSERT `bounty_hunter_stakes` (`stake_amount = hunter_stake_amount` snapshot,
   `entry_number = v_entry_number`, `protected_hunter_profit = v_protected`,
   `status='active'`). Capture `v_stake_id`.
9. **Escrow the hunter stake** (design §23.5): player pin row (`-hunter_stake_amount`,
   `type='bounty_hunter_stake'`, `bounty_post_id`, optional `bounty_hunter_stake_id`,
   `week_id`) + house pin row (`+hunter_stake_amount`, `is_house=true`, same links).
10. `RETURN v_stake_id`. (First-hunter-join publish call: see §9.)

### `close_bounty(p_bounty_post_id uuid) RETURNS void` — admin-gated

1. Admin gate. Load `FOR UPDATE`; require `status='open'`.
2. `UPDATE bounty_post SET status='closed'`. A closed bounty no longer accepts entries
   (design §10.2, §25.4). (Time-based closing — `now() >= closes_at` — is enforced at entry
   in step 3 of `enter_bounty_as_hunter`; an explicit flip to `closed` is admin-driven in
   v1, and the app may also call this when the timer elapses. There is no background sweep
   required for v1; an unclosed-but-expired bounty simply rejects new hunters and is settled
   or closed by the admin.)

### `settle_bounty(p_bounty_post_id uuid, p_outcome text, p_admin_settlement_reasoning text) RETURNS void` — admin-gated

Idempotent manual settlement (design §8, §25.5, §26).

1. Admin gate. Resolve the admin's `players.id` (`v_admin_id`) from `auth.uid()`.
2. Load `bounty_post FOR UPDATE`. **Idempotency:** `RETURN` early if `status='settled'`.
   Require `status='closed'` (RAISE otherwise — a bounty must be closed before settling).
3. Validate `p_outcome IN ('sponsor_win','hunter_win')` and
   `length(p_admin_settlement_reasoning) > 0`.
4. Require ≥1 hunter (`COUNT(bounty_hunter_stakes) >= 1`); if zero, the bounty has no action
   and should be cancelled instead (RAISE, design §25.4 — "no hunter entered" → cancel).
5. **Compute snapshot economics** (design §26):
   - `S  = sponsor_bounty_amount`
   - `total_hunter_stakes = SUM(stake_amount)`
   - `total_protected_hunter_profit = SUM(protected_hunter_profit)`
   - `total_house_seed = max(0, total_protected_hunter_profit - S)`
   - `total_pot = S + total_hunter_stakes + total_house_seed`
6. INSERT `bounty_settlements` with the six snapshot values, `settlement_source='admin'`,
   `settled_by_admin_id=v_admin_id`, `admin_settlement_reasoning=p_admin_settlement_reasoning`,
   `winner_count` per branch below. Capture `v_settlement_id`.
7. **Branch on outcome:**
   - **`sponsor_win`:**
     - `sponsor_bounty` → INSERT one `bounty_payouts` row
       (`player_id = sponsor_player_id`, `is_house=false`, `payout_amount = total_pot`) and
       the `bounty_payout` ledger pair (sponsor `+total_pot` / house `−total_pot`). All
       hunter stakes are lost (their escrow stays in House). `winner_count = 1`.
     - `house_bounty` → **no player payout**; House keeps the hunter stakes (design §17.1,
       §22.3). Optionally write the reporting-only `is_house` payout row (no ledger).
       `winner_count = 1` (conceptually the House).
   - **`hunter_win`:** for each `bounty_hunter_stakes` row, `payout = stake_amount +
     protected_hunter_profit`; INSERT one `bounty_payouts` row (`player_id = hunter`,
     `is_house=false`) and the `bounty_payout` ledger pair (hunter `+payout` / house
     `−payout`). The House naturally funds the seed because the sum of payouts
     (`total_hunter_stakes + total_protected_hunter_profit`) exceeds what is held in escrow
     (`total_hunter_stakes + S`) by exactly `total_house_seed`. `winner_count = hunter count`.
8. Update hunter statuses: `won` (hunter_win) or `lost` (sponsor_win), set `resolved_at`.
9. `UPDATE bounty_post SET status='settled'`. (Settlement publish call: see §9.)

> **No remainder dust** (design §26.3): each hunter payout is computed from its own
> snapshotted `protected_hunter_profit`, so there is no equal-split division at settlement.

### `cancel_bounty(p_bounty_post_id uuid) RETURNS void` — admin-gated **(hard delete)**

Destructive rollback (design §27) — makes it as if the bounty never existed. Mirror
`cancel_pvp_challenge` (`20260607012000`).

1. Admin gate. Load the bounty (RAISE if not found).
2. **Delete the pin rows first** (they are `ON DELETE SET NULL` against `bounty_post`, so
   they would orphan rather than cascade):
   `DELETE FROM public.pin_ledger WHERE bounty_post_id = p_bounty_post_id;`
3. `DELETE FROM public.bounty_post WHERE id = p_bounty_post_id;` —
   `bounty_hunter_stakes`, `bounty_settlements`, `bounty_payouts`, and the
   `activity_feed_events` rows (all `ON DELETE CASCADE` on `bounty_post_id`) disappear with
   it.
4. **No compensating refund events** are written (design §27.2) — the deletion *is* the
   cancellation. (If any granular `bounty_*_id` FK columns are added in §2, ensure they are
   `ON DELETE CASCADE` so they don't block the delete; deleting the pin rows by
   `bounty_post_id` first covers them regardless.)

> If operational traceability is needed, record the cancellation in a separate admin audit
> log (design §27.3) — **not** in `bounty_post` (no `cancelled` row is kept) and **not** in
> the public Activity Feed. v1 may defer this (§34.6).

### Settlement-calculation worked example (design §14.4 / §33.1)

`S = 300`, `H = 50`, 3 hunters (entry profits 300, 150, 100):
`total_hunter_stakes = 150`, `total_protected_hunter_profit = 550`,
`total_house_seed = max(0, 550−300) = 250`, `total_pot = 300+150+250 = 700`.
- **sponsor_win** (sponsor bounty): sponsor `+700`; hunters lose 50 each.
- **hunter_win:** hunter #1 `+350`, #2 `+200`, #3 `+150` (sum `700`); House nets the `−250`
  seed.

---

## 4. Activity Feed integration (Recipe B — design §24)

Follow `context/activity-feed.md` **Recipe B** exactly; the worked example is
`20260607180200_activity_feed_pvp.sql`. Done in the `activity_feed_bounty` migration.

### 4.1 Schema (source FK + relaxed CHECKs)

```sql
ALTER TABLE public.activity_feed_events
  ADD COLUMN bounty_post_id uuid REFERENCES public.bounty_post(id) ON DELETE CASCADE;

CREATE INDEX activity_feed_events_bounty_idx
  ON public.activity_feed_events (bounty_post_id) WHERE bounty_post_id IS NOT NULL;
CREATE UNIQUE INDEX activity_feed_unique_bounty_event
  ON public.activity_feed_events (bounty_post_id, event_type) WHERE bounty_post_id IS NOT NULL;

-- source_feature gains 'bounty_board'
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_source_feature_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_source_feature_check
  CHECK (source_feature IN ('sportsbook','loan_shark','pvp','bounty_board','system','admin'));

-- event_type gains the five bounty events (re-add the full current list + these)
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_events_event_type_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_events_event_type_check
  CHECK (event_type IN (
    'sportsbook_bet_placed','sportsbook_parlay_placed','sportsbook_big_ticket_placed',
    'sportsbook_big_win','sportsbook_parlay_hit','sportsbook_weekly_house_result',
    'loan_shark_loan_taken','loan_shark_loan_repaid','loan_shark_special_offer',
    'pvp_challenge_accepted','pvp_challenge_settled',
    'bounty_board_bounty_posted','bounty_board_hunter_joined','bounty_board_bounty_closed',
    'bounty_board_sponsor_won','bounty_board_hunters_won'));

-- one-source CHECK gains the bounty term
ALTER TABLE public.activity_feed_events DROP CONSTRAINT activity_feed_one_source_check;
ALTER TABLE public.activity_feed_events ADD CONSTRAINT activity_feed_one_source_check CHECK (
  (sportsbook_bet_id IS NOT NULL)::int +
  (loan_id           IS NOT NULL)::int +
  (pvp_challenge_id  IS NOT NULL)::int +
  (bounty_post_id    IS NOT NULL)::int
  <= 1
);
```

### 4.2 `publish_activity_event` — 16 → 17 args

The live signature (post-PvP) is **16 args** ending in `p_pvp_challenge_id uuid DEFAULT
NULL`. Postgres can't `CREATE OR REPLACE` with a changed argument list, so `DROP` it and
recreate with a trailing `p_bounty_post_id uuid DEFAULT NULL` (the `DEFAULT NULL` keeps every
existing 16-arg caller — sportsbook/loan/system/pvp — working unchanged):

```sql
DROP FUNCTION public.publish_activity_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text, timestamptz, uuid);

CREATE FUNCTION public.publish_activity_event(
  …same 16 params…,
  p_bounty_post_id uuid DEFAULT NULL
) RETURNS uuid …
```

Inside the body, add to:
1. The `source_feature` validation set: `'bounty_board'`.
2. The catalog `CASE` block — five `WHEN` branches (defaults below).
3. The source-FK↔feature consistency `IF/ELSIF` — a new
   `ELSIF v_allowed_fk = 'bounty_post_id' THEN` branch requiring `p_bounty_post_id` non-NULL
   and the other three source FKs NULL; and add `OR p_bounty_post_id IS NOT NULL` to each of
   the existing branches' "others must be NULL" guards (and the `'none'` branch).
4. The `INSERT` column list + `VALUES` — add `bounty_post_id` / `p_bounty_post_id`.
5. Re-issue `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` for the **new 17-arg
   signature** (it is a brand-new function object).

Catalog entries (design §24.2):

| `event_type` | importance | visibility | requires_actor | allowed_source_fk | `template_key` |
|---|---|---|---|---|---|
| `bounty_board_bounty_posted` | normal | public | **no** | `bounty_post_id` | `bounty_board.bounty_posted` |
| `bounty_board_hunter_joined` | low | public | yes | `bounty_post_id` | `bounty_board.hunter_joined` |
| `bounty_board_bounty_closed` | normal | public | no | `bounty_post_id` | `bounty_board.bounty_closed` |
| `bounty_board_sponsor_won` | highlight | public | no | `bounty_post_id` | `bounty_board.sponsor_won` |
| `bounty_board_hunters_won` | highlight | public | no | `bounty_post_id` | `bounty_board.hunters_won` |

> `requires_actor=no` for posted/closed/won because a **House bounty** has no player actor
> (the Pinsino is the actor; `actor_player_id` is NULL and the template renders "The
> Pinsino…"). For a `sponsor_bounty`, callers still pass the sponsor as `actor_player_id` so
> the card leads with their name (design §24.3). `hunter_joined` requires the joining hunter
> as actor.

### 4.3 Publish calls (added when the RPCs are `CREATE OR REPLACE`d in this migration)

- **`create_sponsor_bounty` / `create_house_bounty`** → `bounty_board_bounty_posted`, actor =
  `sponsor_player_id` (NULL for house), `public_payload =
  jsonb_build_object('bounty_title', title, 'sponsor_bounty_amount', S, 'hunter_stake_amount', H, 'bounty_type', bounty_type)`,
  `p_bounty_post_id = v_bounty_id`.
- **`enter_bounty_as_hunter`** → `bounty_board_hunter_joined`, actor = hunter. **Configurable
  / first-join-only** (design §24.4, §34.2): the partial unique index on
  `(bounty_post_id, event_type)` already makes the *first* `hunter_joined` win and silently
  drops later ones via `ON CONFLICT DO NOTHING` — so simply always calling publish yields
  "first hunter join only" for free. `public_payload =
  jsonb_build_object('bounty_title', title, 'entry_number', v_entry_number)`.
- **`close_bounty`** → `bounty_board_bounty_closed`, actor = NULL,
  `public_payload = jsonb_build_object('bounty_title', title)`.
- **`settle_bounty`** → `bounty_board_sponsor_won` or `bounty_board_hunters_won` by
  `p_outcome`, actor = sponsor (sponsor_win on a sponsor_bounty) or NULL,
  `public_payload = jsonb_build_object('bounty_title', title, 'total_pot', total_pot, 'total_house_seed', total_house_seed, 'outcome', p_outcome)`.
- **`cancel_bounty`** publishes nothing — the cascade delete removes any prior feed rows
  (design §27).

> **User-authored title is league-safe** in `public_payload.bounty_title`, but the feed still
> renders via controlled templates (design §24.5) — store the title in the payload; never
> store rendered text. Copy examples are in design §24.3.

---

## 5. Verification (run after `db push`, mirror `PIN_ECONOMY_SCHEMA.md` §10)

Use a throwaway / non-prod season. SQL reads via `supabase db query --linked`.

1. **Schema/advisors** — `supabase db lint` clean; every new FK indexed; all functions have a
   pinned `search_path`; the four tables sort together under `bounty_`; the one-source CHECK
   rejects a feed row with both `bounty_post_id` and any other source FK.
2. **Sponsor create → escrow nets 0** — `create_sponsor_bounty` drops the sponsor's balance
   by `S`; two `bounty_sponsor_stake` pin rows (player −S / house +S) carry the
   `bounty_post_id` and sum to 0; `status='open'`; a `bounty_board_bounty_posted` feed row
   exists with `public_payload.bounty_title`.
3. **House create → no ledger** — `create_house_bounty` writes **zero** `pin_ledger` rows;
   `sponsor_player_id IS NULL`; one posted feed row (actor NULL).
4. **Hunter entry → anti-dilution snapshot** — three sequential `enter_bounty_as_hunter`
   calls produce `entry_number` 1/2/3 and `protected_hunter_profit`
   `floor(S/1)`/`floor(S/2)`/`floor(S/3)`; each escrows `H` (player −H / house +H); the
   sponsor cannot enter (RAISE); a second entry by the same player RAISEs (unique
   constraint); only the **first** entry produces a `bounty_board_hunter_joined` feed row.
5. **Serialized entry** — concurrent entries never produce a duplicate `entry_number` (the
   `FOR UPDATE` lock + unique constraint hold).
6. **Settle sponsor_win** — `settle_bounty(…, 'sponsor_win', reason)` on a `sponsor_bounty`
   pays the sponsor `total_pot` (incl. seed), marks hunters `lost`, writes one
   `bounty_settlements` (snapshot values match §26) + one `bounty_payouts` + the
   `bounty_payout` ledger pair; `status='settled'`; one `bounty_board_sponsor_won` feed row.
7. **Settle hunter_win** — pays each hunter `stake + protected_profit`; sum of payouts equals
   `total_hunter_stakes + total_protected_hunter_profit`; the House nets exactly
   `−total_house_seed`; hunters marked `won`; one `bounty_board_hunters_won` feed row.
8. **House bounty sponsor_win → no player payout** — no `is_house=false` payout row, no
   player-facing `bounty_payout` ledger pair; House simply retains the hunter stakes.
9. **Idempotent settle** — re-calling `settle_bounty` on a `settled` bounty `RETURN`s with no
   new rows.
10. **Hard-delete cancel** — `cancel_bounty` removes the `bounty_post`, all hunter stakes,
    any settlement/payout rows, **all** `bounty_post_id` pin rows, and the feed rows; no
    orphans remain (check by `bounty_post_id` across all tables).
11. **Conservation invariant (§10)** — `SUM(pin_ledger.amount)` per season still equals
    `SUM(score_credit)` minus any intended House subsidy: every bounty event is a balanced
    player+house pair, so the only net House movement is the deliberate `total_house_seed`
    on hunter-win (a House-funded subsidy, design §14.5), and House-to-House is never
    ledgered. Confirm with the §10 conservation query, accounting for seed as a House outflow.
```
