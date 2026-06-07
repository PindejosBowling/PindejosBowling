# Activity Feed — Database Implementation Spec

Handoff spec for the **database layer** of the Activity Feed ("Market Moves") feature.
Self-contained and executable independently of the app-layer spec
(`economy/ACTIVITY_FEED_APP.md`), which depends on this being applied +
`database.types.ts` regenerated.

**Read first:** `economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md` (the product design — every
`§` reference below points to it) and `supabase/PIN_ECONOMY_SCHEMA.md` §4–§6, §10 (the
ledger / RPC conventions + the conservation/verification model you must mirror). The
Loan Shark DB spec (`economy/LOAN_SHARK_DB.md`) is the closest existing analog for the
table + RLS + cancel-cascade shape — read it for worked examples.

> **Hard rule (AGENTS.md §2):** every change here is a migration file created with
> `supabase migration new …` and applied with `supabase db push`. Never write to the
> DB directly. CLI invocation (token from `app/.env.local` + `--linked --workdir $(pwd)`)
> is in AGENTS.md §3.

> **⚠️ Design overrides baked into this spec (resolving design §23).** Four open
> questions are resolved here and must be built as stated:
> 1. **Publish path = DB-transactional.** A shared `publish_activity_event(...)` helper
>    is `PERFORM`ed from inside the existing economic RPCs (`place_house_bet`,
>    `settle_market_internal`, `take_loan`, `repay_loan`, `settle_betting_for_week`), so
>    each feed row is written in the **same transaction** as its source action (§13.2).
> 2. **Event scope = core + aggregates.** Emit the nine event types in §6.1 below.
>    **`sportsbook_bad_beat` is NOT built in v1** (too fuzzy — design §10.3/§23-Q3).
> 3. **Thresholds = SQL constants**, defined once at the top of the helper (§2.1).
> 4. **Controlled strings = `CHECK` constraints** (not enums or lookup tables — §23-Q7).

## Scope of this spec (v1 — design §20.1/§20.2)

One table (`activity_feed_events`), one internal publish helper, edits to the five
existing economic RPCs to publish feed rows, and three admin RPCs (suppress / restore /
post-system-event). No `pin_ledger` extension and no new ledger table — **the feed is
not the ledger** (§2) and never moves pins. Future feature publishers (Merchant, PvP,
Bounty, Auction, Weekly Recap) add their own nullable FK column + publish call later
(§5.2, §22) — **no schema redesign required**.

---

## Naming rule (non-negotiable)

The single table is `activity_feed_events`. The shared writer is
`publish_activity_event`. Admin RPCs are `suppress_activity_event`,
`restore_activity_event`, `create_system_activity_event`. Concrete source FK columns are
named `<feature>_<source>_id` and reference the source's own table
(`sportsbook_bet_id → bets`, `loan_id → loans`). Do not introduce a polymorphic
`source_type`/`source_action_id` pair (§3.2 — explicitly rejected).

---

## Conventions every object in this spec must follow

From `PIN_ECONOMY_SCHEMA.md` §5–§6 — non-negotiable:

- **New tables:** include `created_at timestamptz NOT NULL DEFAULT now()` and
  `updated_at timestamptz NOT NULL DEFAULT now()` **and nothing else for audit** — the
  `enforce_audit_columns` event trigger auto-attaches `set_updated_at`. Do **not**
  declare a `set_updated_at` trigger yourself (it collides).
- **Index every FK column** (Postgres doesn't auto-index FKs; the advisor flags it).
- All ids `uuid` (`gen_random_uuid()`); all `season_id`/`week_id`/`*_player_id` are uuid FKs.
- **RPCs:** `SECURITY DEFINER`, `SET search_path = ''`, every object fully qualified as
  `public.<name>`. Resolve identity from `auth.uid()` — **never** accept a
  client-supplied player id. Admin gate:
  `IF ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;`
- **Controlled strings** (`source_feature`, `event_type`, `visibility`, `importance`,
  `status`) enforced by `CHECK` constraints on the column (§23-Q7).
- The feed **never moves pins** and is read-derived only — it does not participate in the
  conservation invariant, but the RPC edits that publish into it must not alter any
  existing pin/ledger math (§7 verifies this).

**Reference implementations to copy from** (read them before writing):
- `supabase/migrations/20260606191026_loan_shark_tables.sql` — the table + DO-block RLS
  pattern (`ENABLE ROW LEVEL SECURITY`, anon/authenticated read, admin write). **Tighten
  the SELECT policy** for this feature (see §1 RLS) instead of `USING (true)`.
- `supabase/migrations/20260605120219_add_week_id_to_pin_ledger.sql` — `place_house_bet`
  (identity, leg count `v_n`, balance, `v_week_id`) and `settle_market_internal` (win /
  push branches, payout, won-leg loop) — the exact RPC bodies you will `CREATE OR REPLACE`.
- `supabase/migrations/20260606191027_loan_shark_rpcs.sql` — `take_loan`, `repay_loan`
  (paid-off transition), `cancel_loan` (destructive-delete pattern; FK cascade reaches
  the feed via `loan_id`).
- The latest `settle_betting_for_week` — currently
  `supabase/migrations/20260607002537_settle_betting_for_week_pvp.sql`. **Always
  `CREATE OR REPLACE` from the latest live body** (confirm with a `pg_get_functiondef`
  read first), appending the weekly-House publish call before `END;`.

---

## Suggested migration ordering

One logical change per migration file (timestamps assigned by the CLI):

1. `activity_feed_events_table` — the table + indexes (incl. partial unique dedup
   indexes) + RLS.
2. `publish_activity_event` — the internal writer + the threshold constants + the
   per-event-type catalog (a `CASE`-based defaults block inside the function).
3. `activity_feed_sportsbook_publish` — `CREATE OR REPLACE` `place_house_bet` and
   `settle_market_internal` to publish sportsbook events.
4. `activity_feed_loan_publish` — `CREATE OR REPLACE` `take_loan` and `repay_loan` to
   publish the vague loan events.
5. `activity_feed_weekly_house` — `CREATE OR REPLACE` `settle_betting_for_week` to
   publish `sportsbook_weekly_house_result`.
6. `activity_feed_admin_rpcs` — `suppress_activity_event`, `restore_activity_event`,
   `create_system_activity_event`.

(Steps 1–2 may be combined; keep 3/4/5/6 separate for reviewability. Each of 3/4/5
copies the **current live body verbatim** and adds only the publish call.)

---

## 1. Table `activity_feed_events` (design §5.1)

The public narrative row. Relationally anchored to concrete source tables via nullable
FKs (§3.2). **No rendered text is stored** — copy is rendered in the app from
`template_key` + `public_payload` (§3.7, §9; app-spec §2).

| Column | Type / notes |
|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` |
| `season_id` | `uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE` |
| `week_id` | `uuid NULL REFERENCES public.weeks(id) ON DELETE SET NULL` |
| `source_feature` | `text NOT NULL CHECK (source_feature IN ('sportsbook','loan_shark','system','admin'))` (§6.1) |
| `event_type` | `text NOT NULL CHECK (event_type IN (` …the nine v1 values, §6.2… `))` |
| `actor_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE SET NULL` — the player the story is about |
| `subject_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE SET NULL` — e.g. a bet's market subject (used sparingly publicly, §10.2) |
| `secondary_player_id` | `uuid NULL REFERENCES public.players(id) ON DELETE SET NULL` — reserved for future two-party events (PvP) |
| `sportsbook_bet_id` | `uuid NULL REFERENCES public.bets(id) ON DELETE CASCADE` (§3.3 — destructive bet cancel deletes the feed row) |
| `loan_id` | `uuid NULL REFERENCES public.loans(id) ON DELETE CASCADE` (§3.3 — destructive loan cancel deletes the feed row) |
| `visibility` | `text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','admin_only'))` (§6.3) |
| `importance` | `text NOT NULL DEFAULT 'normal' CHECK (importance IN ('low','normal','highlight','major'))` (§6.5) |
| `status` | `text NOT NULL DEFAULT 'published' CHECK (status IN ('published','suppressed'))` (§6.4) |
| `template_key` | `text NOT NULL` — controlled rendering key (e.g. `sportsbook.parlay_hit`), §9 |
| `public_payload` | `jsonb NOT NULL DEFAULT '{}'::jsonb` — league-safe snapshot values (§8.1, §8.3) |
| `admin_payload` | `jsonb NOT NULL DEFAULT '{}'::jsonb` — operational details, never rendered publicly (§8.2) |
| `occurred_at` | `timestamptz NOT NULL` — when the source action happened (stamped by the publisher) |
| `published_at` | `timestamptz NOT NULL DEFAULT now()` — feed-ordering key |
| `suppressed_by_admin_id` | `uuid NULL REFERENCES public.players(id) ON DELETE SET NULL` (§18.1) |
| `suppressed_at` | `timestamptz NULL` (§18.1) |
| `suppression_reason` | `text NULL` (§18.1) |
| `created_at` / `updated_at` | audit (auto) |

Source-count constraint (§5.3) — a row references **at most one** concrete source FK
(zero is allowed for system/admin aggregates, §5.3):

```sql
CONSTRAINT activity_feed_one_source_check CHECK (
  (sportsbook_bet_id IS NOT NULL)::int +
  (loan_id           IS NOT NULL)::int
  <= 1
)
```

> **Future FK columns (§5.2):** later publishers add their own nullable
> `<feature>_<source>_id uuid REFERENCES … ON DELETE CASCADE` column **and** extend this
> CHECK by one `+ (<new>_id IS NOT NULL)::int` term. The `source_feature ↔ source-FK`
> consistency rule (§5.4) is enforced in the publish helper, not by a DB constraint, so
> new features need no table redesign.

### Indexes (design §15.3)

```sql
CREATE INDEX activity_feed_events_feed_idx
  ON public.activity_feed_events (season_id, status, visibility, published_at DESC, id DESC);
CREATE INDEX activity_feed_events_feature_idx
  ON public.activity_feed_events (season_id, source_feature, status, visibility, published_at DESC, id DESC);
CREATE INDEX activity_feed_events_importance_idx
  ON public.activity_feed_events (season_id, importance, status, visibility, published_at DESC, id DESC);
CREATE INDEX activity_feed_events_sportsbook_bet_idx
  ON public.activity_feed_events (sportsbook_bet_id) WHERE sportsbook_bet_id IS NOT NULL;
CREATE INDEX activity_feed_events_loan_idx
  ON public.activity_feed_events (loan_id) WHERE loan_id IS NOT NULL;
```

Also index `week_id`, `actor_player_id`, `subject_player_id`, `secondary_player_id`,
`suppressed_by_admin_id` (FK-advisor requirement — they may be plain b-tree indexes).

**Partial unique indexes for dedup (§13.3)** — these make `publish_activity_event`'s
`ON CONFLICT DO NOTHING` idempotent so a retried RPC never double-posts:

```sql
CREATE UNIQUE INDEX activity_feed_unique_bet_event
  ON public.activity_feed_events (sportsbook_bet_id, event_type) WHERE sportsbook_bet_id IS NOT NULL;
CREATE UNIQUE INDEX activity_feed_unique_loan_event
  ON public.activity_feed_events (loan_id, event_type) WHERE loan_id IS NOT NULL;
```

### RLS — read is tightened, writes are admin-only

`ENABLE ROW LEVEL SECURITY`. Mirror the Loan Shark DO-block, **but the SELECT policy is
NOT `USING (true)`** — anon + authenticated may read **only published, public** rows so
suppressed and `admin_only` rows never leak to clients (§6.3, §6.4):

```sql
-- reads (anon + authenticated): published + public only
USING (status = 'published' AND visibility = 'public')
```

Direct INSERT/UPDATE/DELETE are **admin-only**
(`(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`) — so an admin client can read all
rows and run the admin RPCs. All non-admin writes go through `SECURITY DEFINER` RPCs
(which bypass RLS): players never write this table, and the publish helper is internal
(§2). Copy the exact policy DO-block shape from `loan_shark_tables.sql`, substituting the
tightened SELECT predicate.

---

## 2. `publish_activity_event(...)` — the internal writer (design §13.1)

In `publish_activity_event`. `SECURITY DEFINER`, `SET search_path = ''`. **Internal
only** — `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated;` and grant to nobody; it is
invoked by `PERFORM public.publish_activity_event(...)` from the other SECURITY DEFINER
RPCs (which run as the definer, so they can call it). This is the single validated write
path (§3.6 feature-neutral, §13.1) — no feature inserts feed rows directly.

Signature:

```sql
public.publish_activity_event(
  p_source_feature      text,
  p_event_type          text,
  p_season_id           uuid,
  p_week_id             uuid,
  p_actor_player_id     uuid,
  p_subject_player_id   uuid,
  p_secondary_player_id uuid,
  p_sportsbook_bet_id   uuid,
  p_loan_id             uuid,
  p_template_key        text,
  p_public_payload      jsonb,
  p_admin_payload       jsonb,
  p_importance          text,   -- NULL → catalog default
  p_visibility          text,   -- NULL → catalog default
  p_occurred_at         timestamptz
) RETURNS uuid
```

Steps:
1. **Validate `source_feature`** against the allowed set; RAISE on unknown.
2. **Validate `event_type`** against the catalog (§2.2); RAISE on unknown.
3. **Source-FK ↔ feature consistency (§5.4):** the catalog's `allowed_source_fk` for the
   event must match which FK arg is non-NULL (e.g. `sportsbook_*` events require
   `p_sportsbook_bet_id` and forbid `p_loan_id`; `loan_shark_*` events require
   `p_loan_id`; `system`/`admin` events take no source FK). RAISE on mismatch.
4. **Actor requirement:** if the catalog marks the event `requires_actor`, RAISE when
   `p_actor_player_id IS NULL`.
5. **Apply defaults:** `v_importance = COALESCE(p_importance, catalog.default_importance)`;
   `v_visibility = COALESCE(p_visibility, catalog.default_visibility)`.
6. **Insert** with `status='published'`, `occurred_at = COALESCE(p_occurred_at, now())`,
   `ON CONFLICT DO NOTHING` (against the partial unique indexes). If a conflict skips the
   insert, `RETURN NULL` (idempotent — the caller ignores the result).
7. `RETURN` the new row id.

### 2.1 Threshold constants (single source of truth — design §12, §23-Q1–Q4)

Declare these as local constants at the **top of the sportsbook-publishing logic** (they
are consumed in `place_house_bet` / `settle_market_internal`, not inside the writer
itself; keep them in one clearly-commented place so the league can tune them with a
follow-up migration):

| Constant | v1 value | Use |
|---|---:|---|
| `large_bet_absolute_threshold` | `250` | `sportsbook_big_ticket_placed` floor |
| `large_bet_balance_percent` | `0.10` | big ticket also if `stake ≥ 10% of pre-bet balance` |
| `big_win_payout_threshold` | `500` | `sportsbook_big_win` floor |
| `big_win_balance_percent` | `0.20` | big win also if `profit ≥ 20% of pre-settlement balance` |
| `normal_bet_placement_enabled` | `false` | gate for posting a plain single bet (§10.4 — off in v1) |

### 2.2 Event catalog (design §7)

Encode the catalog as a `CASE`/lookup inside the writer (application-code catalog,
§23-Q8 — kept in SQL because that's where publish runs). Each entry defines
`default_importance`, `default_visibility`, `requires_actor`, `allowed_source_fk`,
`template_key`:

| `event_type` | importance | visibility | requires_actor | allowed_source_fk | `template_key` |
|---|---|---|---|---|---|
| `sportsbook_bet_placed` | low | public | yes | `sportsbook_bet_id` | `sportsbook.bet_placed` |
| `sportsbook_parlay_placed` | normal | public | yes | `sportsbook_bet_id` | `sportsbook.parlay_placed` |
| `sportsbook_big_ticket_placed` | highlight | public | yes | `sportsbook_bet_id` | `sportsbook.big_ticket_placed` |
| `sportsbook_big_win` | highlight | public | yes | `sportsbook_bet_id` | `sportsbook.big_win` |
| `sportsbook_parlay_hit` | highlight | public | yes | `sportsbook_bet_id` | `sportsbook.parlay_hit` |
| `sportsbook_weekly_house_result` | major | public | no | _(none)_ | `sportsbook.weekly_house_result` |
| `loan_shark_loan_taken` | normal | public | yes | `loan_id` | `loan_shark.loan_taken` |
| `loan_shark_loan_repaid` | highlight | public | yes | `loan_id` | `loan_shark.loan_repaid` |
| `loan_shark_special_offer` | normal | public | no | _(none)_ | `loan_shark.special_offer` |

> The `template_key` is passed by callers (`p_template_key`) and must match the catalog
> entry; validating it against the table keeps copy controlled and future-proof (§3.7).

---

## 3. Sportsbook publish integration (design §10)

`CREATE OR REPLACE` both functions from their **current live bodies**
(`20260605120219_add_week_id_to_pin_ledger.sql`), adding only the publish calls. The
additions are inside the existing transaction (§13.2) — no behavior change to bets,
legs, or ledger.

### `place_house_bet` — at most one placement event (§10.3)

After the stake `pin_ledger` pair is inserted (current code ~line 165) and before
`RETURN v_bet_id`, decide **one** event by priority (the existing locals already hold
everything needed: `v_player_id`, `v_season_id`, `v_week_id`, `p_stake`, `v_payout`,
`v_balance` = pre-bet balance, `v_n` = leg count):

1. **Big ticket** — if `p_stake >= GREATEST(250, FLOOR(0.10 * v_balance))` →
   `event_type='sportsbook_big_ticket_placed'`, `template='sportsbook.big_ticket_placed'`,
   `public_payload = jsonb_build_object('stake', p_stake, 'legs', v_n)`.
2. else **Parlay** — if `v_n > 1` → `sportsbook_parlay_placed`,
   `public_payload = jsonb_build_object('stake', p_stake, 'legs', v_n)`.
3. else **Normal single** — only if `normal_bet_placement_enabled` (false in v1, so
   nothing posts) → `sportsbook_bet_placed`.

For whichever fires: `PERFORM public.publish_activity_event('sportsbook', <type>,
v_season_id, v_week_id, v_player_id, NULL, NULL, v_bet_id, NULL, <template>,
<public_payload>, jsonb_build_object('bet_id', v_bet_id), NULL, NULL, now())`. A small
single bet in v1 produces **no** feed row (§10.4).

### `settle_market_internal` — win events (§10.3)

In the **win** branch (current code ~line 258, after `v_payout` is computed and the bet
is marked `won`), publish exactly one of:

- **Parlay hit** — if the bet had more than one won leg
  (`COUNT(bet_legs WHERE result='won') > 1` for `v_bet.id`) →
  `event_type='sportsbook_parlay_hit'`.
- else **Big win** — if `v_payout >= 500 OR (v_payout - v_bet.stake) >= FLOOR(0.20 *
  v_pre_balance)` (derive `v_pre_balance = SUM(pin_ledger) for the player/season
  **excluding** the payout pair you're about to/just wrote — capture it before the
  payout insert) → `event_type='sportsbook_big_win'`.
- else **nothing** (an ordinary single-leg win is not feed-worthy, §10.1/§10.4).

`public_payload = jsonb_build_object('stake', v_bet.stake, 'payout', v_payout, 'profit',
v_payout - v_bet.stake, 'legs', <won-leg count>)` (snapshot values, §8.3).
`admin_payload = jsonb_build_object('bet_id', v_bet.id, 'market_id', p_market_id)`. Call
`publish_activity_event('sportsbook', <type>, v_bet.season_id, v_market.week_id,
v_bet.player_id, NULL, NULL, v_bet.id, NULL, <template>, <public_payload>,
<admin_payload>, NULL, NULL, now())`.

**No event** on the lost or push branches (§10.4). `bad_beat` is not built (v1).

> Settlement runs inside the per-bet loop; the partial unique index on
> `(sportsbook_bet_id, event_type)` guarantees a re-settlement (idempotent
> `settle_market_internal` is re-callable) never double-posts.

---

## 4. Loan publish integration (design §11) — privacy-aware

`CREATE OR REPLACE` `take_loan` and `repay_loan` from their current bodies
(`20260606191027_loan_shark_rpcs.sql`), adding only the publish calls. **Loan events are
deliberately vague (§5.5, §11).**

### `take_loan` — `loan_shark_loan_taken` (§11.1)

After the loan/`loan_ledger`/`pin_ledger` writes and before `RETURN v_loan_id`:

```sql
PERFORM public.publish_activity_event(
  'loan_shark', 'loan_shark_loan_taken',
  v_season_id, v_week_id, v_player_id, NULL, NULL,
  NULL, v_loan_id,
  'loan_shark.loan_taken',
  '{}'::jsonb,                                  -- empty public payload (§11.1) — NO amounts
  jsonb_build_object('loan_id', v_loan_id, 'loan_product_id', p_loan_product_id),
  NULL, NULL, now());
```

`public_payload` is intentionally `{}` — the public copy is "{actor} visited the Loan
Shark." with **no** product, borrow amount, interest, garnishment, or debt (§11.1, §5.5).

### `repay_loan` — `loan_shark_loan_repaid` only on **full** payoff (§11.1)

Publish **only** inside the existing branch that flips the loan to `paid_off` (when new
outstanding = 0). Partial repayments post nothing (§11.2). `public_payload = '{}'`,
`admin_payload = jsonb_build_object('loan_id', p_loan_id)`,
`template='loan_shark.loan_repaid'`, actor = the borrower.

**Never publish** for: weekly garnishment, weekly interest, missed-week interest, partial
repayment, season-close settlement, or any exact-debt change (§11.2). Those code paths
(`process_weekly_loans`, `settle_loans_for_season_close`) get **no** publish call.

> Cascade: `cancel_loan` already deletes the `loans` row; its
> `activity_feed_events.loan_id … ON DELETE CASCADE` deletes the vague loan feed rows
> automatically (§14.1) — `cancel_loan` needs **no** edit. Same for `cancel_bet` and
> `sportsbook_bet_id`.

---

## 5. Weekly House result (design §10.3, §19) — aggregate, no source FK

In `activity_feed_weekly_house`, `CREATE OR REPLACE settle_betting_for_week` reusing the
**current live body verbatim** (copy from the latest migration —
`20260607002537_settle_betting_for_week_pvp.sql`; confirm with `pg_get_functiondef`
first, since loans + PvP already appended to it). After the existing settlement work
(scores credited, markets settled, loans + PvP processed), append before `END;`:

```sql
  -- Activity Feed: post the House's weekly sportsbook P&L (aggregate, no source FK).
  DECLARE v_house_net integer; v_season uuid;
  BEGIN
    SELECT season_id INTO v_season FROM public.weeks WHERE id = p_week_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_house_net
      FROM public.pin_ledger
      WHERE is_house = true AND week_id = p_week_id
        AND type IN ('bet_stake','bet_payout','bet_refund');
    -- Idempotency: no source FK exists, so guard on (season, week, event_type).
    IF NOT EXISTS (
      SELECT 1 FROM public.activity_feed_events
       WHERE season_id = v_season AND week_id = p_week_id
         AND event_type = 'sportsbook_weekly_house_result'
    ) THEN
      PERFORM public.publish_activity_event(
        'system', 'sportsbook_weekly_house_result',
        v_season, p_week_id, NULL, NULL, NULL, NULL, NULL,
        'sportsbook.weekly_house_result',
        jsonb_build_object('house_net', v_house_net),
        '{}'::jsonb, NULL, NULL, now());
    END IF;
  END;
```

`house_net > 0` = the House won the week; `< 0` = players beat the House (§10.3 copy).
The presence guard (not a unique index — there is no source FK) makes a re-run of
`settle_betting_for_week` a no-op for this row. `AdminArchiveModal` needs **no change** —
it already calls `settle_betting_for_week`.

---

## 6. Admin RPCs (design §18) — `activity_feed_admin_rpcs`

All admin-gated, `SECURITY DEFINER`, `SET search_path = ''`,
`REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated` (the body re-checks the admin
role).

### `suppress_activity_event(p_event_id uuid, p_reason text) RETURNS void` (§14.2, §18.1)
1. Admin gate. Resolve the calling admin's `players.id` from `auth.uid()`.
2. `UPDATE public.activity_feed_events SET status='suppressed', suppressed_by_admin_id =
   <admin>, suppressed_at = now(), suppression_reason = p_reason WHERE id = p_event_id`.
   Does **not** touch the source action (§14.2). Suppressed rows drop out of the public
   read policy automatically.

### `restore_activity_event(p_event_id uuid) RETURNS void` (§14.3)
1. Admin gate.
2. `UPDATE … SET status='published', suppressed_by_admin_id=NULL, suppressed_at=NULL,
   suppression_reason=NULL WHERE id = p_event_id`. Only meaningful while the source row
   still exists (a cancelled source already cascade-deleted the feed row).

### `create_system_activity_event(...) RETURNS uuid` (§19.1)
Admin wrapper over the writer for aggregate/announcement events with **no** source FK —
v1 use is `loan_shark_special_offer` (§11.3) and generic admin posts. Params:
`p_source_feature text` (`'system'` or `'admin'`), `p_event_type text`,
`p_template_key text`, `p_public_payload jsonb`, `p_importance text`. Body: admin gate;
resolve current season + week (`is_active AND NOT registration_open`; week optional);
`RETURN publish_activity_event(p_source_feature, p_event_type, <season>, <week>, NULL,
NULL, NULL, NULL, NULL, p_template_key, p_public_payload, '{}'::jsonb, p_importance,
'public', now())`. Validation in the writer rejects an `event_type` that requires a
source FK.

---

## 7. Verification (run after `db push`, mirror `PIN_ECONOMY_SCHEMA.md` §10)

Use a throwaway / non-prod season. SQL reads via `supabase db query --linked`.

1. **Schema/advisors** — `supabase db lint` clean; every new FK indexed; the writer +
   3 admin functions + the 5 replaced economic functions all have a pinned
   `search_path`; the public SELECT policy returns **only** `published`+`public` rows
   (insert a `suppressed` and an `admin_only` row as admin, confirm an anon read omits
   both); the one-source CHECK rejects a row with both `sportsbook_bet_id` and `loan_id`.
2. **Big ticket** — `place_house_bet` with a 300-pin single creates **exactly one**
   `sportsbook_big_ticket_placed` row (FK = the bet, `public_payload.stake=300`); a
   10-pin single creates **no** row (`normal_bet_placement_enabled=false`).
3. **Parlay placed / hit** — a 3-leg bet creates one `sportsbook_parlay_placed`; settling
   all three legs as wins creates one `sportsbook_parlay_hit` with
   `public_payload = {stake,payout,profit,legs:3}`; re-running `settle_market_internal`
   does **not** double-post (partial unique index).
4. **Big win** — a single-leg win paying ≥ 500 creates one `sportsbook_big_win`; an
   ordinary small single-leg win creates **no** row; no row on loss or push.
5. **Loan taken (vague)** — `take_loan` creates one `loan_shark_loan_taken` with
   `public_payload = {}` (assert it contains no amount/rate/product keys) and FK = the
   loan; `admin_payload` carries `loan_id`+`loan_product_id`.
6. **Loan repaid (full only)** — a partial `repay_loan` posts **nothing**; the repayment
   that zeroes the loan posts exactly one `loan_shark_loan_repaid`.
7. **Weekly House result** — archiving a week with sportsbook activity posts one
   `sportsbook_weekly_house_result` (`source_feature='system'`, no source FK,
   `importance='major'`, `public_payload.house_net` = `SUM` of house bet rows for the
   week); **re-running `settle_betting_for_week` is a no-op** (presence guard).
8. **Cascade delete (§14.1)** — `cancel_bet` deletes the bet's feed rows;
   `cancel_loan` deletes the loan's feed row — confirm via the partial FK indexes (no
   orphan feed rows remain). Neither cancel RPC was edited.
9. **Suppress / restore (§14.2–14.3)** — `suppress_activity_event` hides a valid row
   from the public read policy and stamps `suppressed_by/at/reason`;
   `restore_activity_event` returns it and clears those fields. The underlying bet/loan
   is untouched.
10. **System event** — `create_system_activity_event('system',
    'loan_shark_special_offer', 'loan_shark.special_offer', '{}', 'normal')` inserts a
    sourceless public row; calling it with an event_type that requires a source FK
    raises.
11. **Conservation invariant (§10.2 / design §2)** — `SUM(pin_ledger.amount)` per season
    is **unchanged** by every feed write (the feed never touches `pin_ledger`); the
    existing bet/loan/PvP pin math is byte-for-byte identical to the pre-edit functions
    (diff the replaced bodies — only `PERFORM publish_activity_event(...)` lines added).
