# Pin Economy & Betting Schema

Reference for the pin economy and the betting subsystem — the tables, their
relationships, the accounting model, and how to implement or extend betting
features. Read this before touching anything under the `bet_*` / `pin_ledger`
tables or writing new betting flows.

> **Status — two models coexist (strangler migration).**
> - **Legacy (LIVE today):** `bet_lines`, `placed_bets`, `pin_ledger`. The shipped
>   `BettingScreen`, RSVP sync, admin settlement, and the `place_bet` /
>   `sync_bet_lines_for_week` RPCs all run on these.
> - **Target (schema in place, NOT yet wired):** `bet_markets`, `bet_selections`,
>   `bets`, `bet_legs`, `bet_offers`, `bet_matches`. Created by
>   `20260605002715_betting_target_model.sql`. No app code references these yet.
>
> New betting work should drive the cutover onto the target model rather than
> deepen the legacy tables. See [Roadmap](#roadmap--phase-2) and
> [Implementing a new bet type](#implementing-a-new-bet-type).

---

## 1. Core concepts

The pin economy is a **closed play-money system**. Every player has a per-season
pin **balance**; there is no real currency. Pins are the unit for the betting
feature and the season-long leaderboard.

- **Balance is always season-scoped.** A player's balance = the sum of their
  `pin_ledger` rows for a given `season_id`. There is no stored balance column;
  it is always derived. Never cache a balance as authoritative.
- **The ledger is append-only.** Corrections are new rows (or, for the admin
  cancel-bet flow, deletion of the exact rows tied to a bet), never in-place edits.
- **Money movement must be conservative** in the target model: pins move between
  accounts, they are not silently minted on win / burned on loss. (The legacy
  model still mints on win — see [Accounting](#4-accounting-model).)

### Odds convention (target model)

**Decimal odds.** Stored in `bet_selections.odds` as `numeric(8,3)`.

- `2.000` = even money.
- **Total returned on a win = `stake × odds`** (includes the stake back).
- **Net profit on a win = `stake × (odds − 1)`**.
- A parlay's combined odds = the **product** of its legs' odds; payout =
  `stake × Π(odds)`.
- `odds > 1.0` is enforced by a CHECK (decimal odds always exceed 1).

Odds are **snapshotted** onto each `bet_legs.odds_at_placement` when the bet is
taken, because a market's posted odds can move afterward. Settlement uses the
snapshot, never the current selection odds.

---

## 2. Target model (canonical)

```
bet_markets ──< bet_selections                 bet_offers
  (what you        (the sides; each has          (peer: propose → accept)
   can bet on)      odds, line, result)              │
                          ▲                           │ on accept creates
                          │ referenced by             │ two opposing bets
                          │                           ▼
        bets ──< bet_legs ┘                      bet_matches
     (the stake)   (back/lay a selection,         (links back_bet ↔ lay_bet,
                    odds snapshotted)               holds the pooled escrow)
```

### `bet_markets` — a thing you can bet on

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `market_type` text | `over_under` \| `moneyline` \| `prop`. Discriminator. Extend the CHECK to add types. |
| `title` text | Display label. |
| `week_id` uuid → weeks | Scope. **Nullable** — null = season-long / futures. `ON DELETE CASCADE`. |
| `game_number` int | Nullable; `>= 1` when present. |
| `subject_player_id` uuid → players | The player a line/prop is about (e.g. the O/U subject). `ON DELETE CASCADE`. |
| `params` jsonb | Type-specific descriptive bits so arbitrary props don't each need a table. Default `{}`. |
| `status` text | `open` \| `closed` \| `settled` \| `void`. |
| `result_value` numeric(6,1) | Generic settled outcome (e.g. the subject's actual game score), optional. |
| `created_by_player_id` uuid → players | **Null = house-created.** `ON DELETE SET NULL`. |
| `settled_at` timestamptz | |

A market is the parent of its selections (`ON DELETE CASCADE`).

### `bet_selections` — the bettable sides, each with odds

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `market_id` uuid → bet_markets | `ON DELETE CASCADE`. |
| `key` text | Stable side key: `over`, `under`, `yes`, a player id, etc. **`UNIQUE (market_id, key)`**. |
| `label` text | Display. |
| `odds` numeric(8,3) | Decimal odds. Default `2.000`, CHECK `> 1.0`. |
| `line` numeric(6,1) | The total/handicap for this side (the O/U number). Per-selection so alternate lines / spreads are possible. Nullable. |
| `result` text | Set at settlement: `won` \| `lost` \| `push` \| `void`. |
| `sort_order` int | Display ordering. |

- **Over/under:** two selections, `over` and `under`, sharing the same `line`.
- **Moneyline:** one selection per side (e.g. each player/team), `line` null.
- **Prop:** `yes`/`no`, or N choices.

### `bets` — the stake (single source of truth for money placed)

`bets` carries **no bet-type-specific columns**. What was bet lives entirely in
`bet_legs → bet_selections`.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `player_id` uuid → players | The bettor. `ON DELETE CASCADE`. |
| `season_id` uuid → seasons | Balance scope (matches `pin_ledger`). `ON DELETE CASCADE`. |
| `counterparty` text | `house` \| `peer`. |
| `stake` int | `>= 10`. |
| `potential_payout` int | Total returned on win incl. stake — snapshot at placement. |
| `status` text | `pending` \| `won` \| `lost` \| `push` \| `void` \| `cancelled`. |
| `placed_at` / `settled_at` timestamptz | |

**Single vs parlay is emergent:** a bet with one leg is a single; a bet with N
legs is a parlay. There is no parlay table.

### `bet_legs` — bet ↔ selection (parlay-native)

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `bet_id` uuid → bets | `ON DELETE CASCADE`. |
| `selection_id` uuid → bet_selections | `ON DELETE CASCADE`. **`UNIQUE (bet_id, selection_id)`** — a bet can't have the same selection twice. |
| `side` text | `back` (for the selection) \| `lay` (against it). Default `back`. |
| `odds_at_placement` numeric(8,3) | Price snapshot, CHECK `> 1.0`. |
| `line_at_placement` numeric(6,1) | Line snapshot. |
| `result` text | `won` \| `lost` \| `push` \| `void`, copied from the selection at settlement. |

#### Back / lay settlement truth table

| Leg `side` | Selection result | Leg result |
|---|---|---|
| back | won | won |
| back | lost | lost |
| lay | won | lost |
| lay | lost | won |
| (any) | push / void | push / void |

A **bet** wins iff **all** its legs win. Any lost leg ⇒ bet lost. Push/void legs
drop out of the parlay (combined odds recomputed over the remaining legs).

### `bet_offers` — peer challenge / accept

A proposer **backs** a selection at agreed odds for a stake; another player (or
anyone) **accepts** the opposing **lay** side.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `proposer_id` uuid → players | `ON DELETE CASCADE`. |
| `season_id` uuid → seasons | `ON DELETE CASCADE`. |
| `selection_id` uuid → bet_selections | The side the proposer is backing. `ON DELETE CASCADE`. |
| `odds` numeric(8,3) | Agreed decimal odds, CHECK `> 1.0`. |
| `proposer_stake` int | `>= 10`. |
| `target_player_id` uuid → players | **Null = open to anyone**; set = a specific challenge. `ON DELETE CASCADE`. |
| `status` text | `open` \| `accepted` \| `cancelled` \| `expired`. |
| `accepted_by` uuid → players | `ON DELETE SET NULL`. |
| `accepted_at` / `expires_at` timestamptz | |

**Acceptor's required stake (lay liability) = `proposer_stake × (odds − 1)`.**
The pool the winner collects = `proposer_stake × odds`.

### `bet_matches` — the matched peer position + escrow

Created when an offer is accepted; links the two opposing `bets`.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `offer_id` uuid → bet_offers | `ON DELETE SET NULL`. |
| `back_bet_id` uuid → bets | The proposer's back bet. `ON DELETE CASCADE`. **UNIQUE**. |
| `lay_bet_id` uuid → bets | The acceptor's lay bet. `ON DELETE CASCADE`. **UNIQUE**. |
| `pool` int | `back_stake + lay_stake`; winner takes it minus rake. CHECK `>= 0`. |
| `rake` int | House commission on the pool. Default `0`, CHECK `>= 0`. |

---

## 3. How each bet type maps

| Feature | Expressed as |
|---|---|
| **Over/under** | `bet_markets(market_type=over_under, subject_player_id, game_number)` + two `bet_selections` (`over`/`under`) sharing a `line`, each with `odds`. |
| **Moneyline** | `bet_markets(market_type=moneyline)` + one selection per side, `line` null. |
| **Prop (arbitrary)** | `bet_markets(market_type=prop, params=<definition>)` + N selections. No new table. |
| **Single bet** | one `bets` row + one `bet_legs` row (`side=back`). |
| **Parlay** | one `bets` row + N `bet_legs` rows; combined odds = Π(leg odds). |
| **House bet** | `bets.counterparty=house`; legs all `back`; house is the implicit lay. |
| **Peer bet** | `bet_offers` → accept → two `bets` (`back`/`lay`) + `bet_matches` with pooled escrow. |
| **Non-even odds** | `bet_selections.odds` (any value > 1.0), snapshotted per leg. |

---

## 4. Accounting model

**Decision of record:** the house is a **funded account**, and settlement is
**double-entry** — pins move between accounts (bettor ↔ house, bettor ↔ bettor),
they are not minted/burned on the betting path. This keeps supply conservative
and the ledger auditable. "Mint-on-win" is available only as an explicit policy:
top up the house account (a visible mint) when it runs low. (Parimutuel pools
were considered and rejected — thin league liquidity, breaks fixed posted odds.)

### `pin_ledger` — the balance ledger (LIVE)

Append-only event log. **`balance(player, season) = SUM(amount)`** over their rows.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `player_id` uuid → players | The account owner. `ON DELETE CASCADE`. |
| `season_id` uuid → seasons | `ON DELETE CASCADE`. |
| `amount` int | Signed. Credits positive, debits negative. |
| `type` text | See lifecycle below. |
| `description` text | Human-readable. |
| `placed_bet_id` uuid → placed_bets | `ON DELETE SET NULL` (legacy bet linkage). |

#### Current ledger lifecycle (legacy)

| Event | Entry |
|---|---|
| Season opens | `+100` `champion_bonus` per prior-season champion |
| Week archived | `+score` `score_credit` per game per player (**the dominant pin faucet**) |
| Bet placed | `−wager` `bet_placed` |
| Bet won | `+wager×2` `bet_won` (net gain = wager) |
| Bet push | `+wager` `bet_push` (refund) |
| Bet loss | nothing (wager already debited) |

> The economy is **inflationary by design** via `score_credit` (every game score
> becomes pins). Betting-side flows are small next to it. This is why a betting
> sink (house vig) is useful, and why parimutuel's anti-inflation benefit was
> irrelevant here.

### Target accounting (PHASE 2 — designed, not yet built)

To make the house a real account without rewriting the live ledger:

- Extend `pin_ledger` minimally — allow a **non-player house account per season**
  (e.g. nullable `player_id` + an `is_house` flag, or a reserved system account),
  add a `bet_id` reference, and add betting entry types
  (`bet_stake`, `bet_payout`, `bet_refund`, `bet_rake`, `house_seed`, …).
- **Every player credit is mirrored by a house/escrow debit** (and vice versa),
  so each settlement nets to zero ⇒ conservative supply.
- Player balances keep coming from `pin_ledger` filtered to `player_id`, so the
  live app's balance/leaderboard queries are unaffected until cutover.

**Settlement math (target):**
- **House single back:** win → house pays `stake × odds` to the bettor; loss →
  house keeps the stake. Zero-sum vs the house account.
- **House parlay:** same, with `odds = Π(leg odds)`.
- **Peer:** both stakes escrow into `bet_matches.pool`; winner collects
  `pool − rake`; rake (if any) → house. Zero-sum between the two players.

---

## 5. Security & access model

Follows the project-wide pattern (see `supabase/AUTH.md`).

- **Reads:** open to `anon` + `authenticated` on all betting tables.
- **Direct writes:** **admin-only** (RLS gated on
  `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`). Used by admin flows
  (line/market creation, settlement, cancellation).
- **Player write paths go through `SECURITY DEFINER` RPCs**, never direct table
  writes. The RPC resolves the caller from `auth.uid()` (never trusts a
  client-supplied player id), validates everything, and writes atomically. This
  is why players can place bets despite the tables being admin-only at the RLS
  layer.

### Existing RPCs (legacy, LIVE)

| RPC | Purpose |
|---|---|
| `place_bet(bet_line_id, pick, wager)` | Atomic, balance-checked bet placement; writes `placed_bets` + `−wager` `pin_ledger`. Resolves bettor from JWT. |
| `sync_bet_lines_for_week(week_id)` | RSVP-driven create/refund of `bet_lines`, derived from `rsvp` + `scores`. Idempotent. |
| `is_registered_player(phone)` | Pre-login gate (anon-callable). |

### RPC / function conventions (REQUIRED for new functions)

- `SECURITY DEFINER` only when bypassing RLS is genuinely needed; always
  **`SET search_path = ''`** (qualify every object as `public.<name>`) or
  `= public`. The advisor flags any function without a pinned search_path.
- Resolve identity from `auth.uid()` / `auth.jwt()` inside the body. **Never trust
  a player id passed by the client.**
- `REVOKE EXECUTE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;` unless
  the function must be anon-callable.
- Document the security invariants in a header comment — the migration diff is the
  real regression control, not the advisor (the advisor only checks shape, and a
  `SECURITY DEFINER`-exposed-via-RPC flag is expected/intentional for these).

### Hard integrity rules

- **Anti-tanking:** a player may never bet the `under`/`lay` on their own line
  (where the bet's subject is the bettor). Legacy: enforced by the
  `placed_bets_no_self_under` BEFORE INSERT/UPDATE trigger **and** in the UI/RPC.
  The target model must reintroduce an equivalent guard (subject =
  `bet_selections`/`bet_markets.subject_player_id`; bettor = `bets.player_id`).
- **Min stake 10** (CHECK).
- **One bet per selection per bet** (`UNIQUE (bet_id, selection_id)`).
- **Balance never goes negative** — enforced in the placement RPC, not the DB.

---

## 6. Conventions baked into the schema

- **Every table has `created_at` + `updated_at`.** The `enforce_audit_columns`
  event trigger *requires* both on any new `public` table and **auto-attaches the
  `set_updated_at` trigger** — so do **not** declare `set_updated_at` manually on a
  new table (it will collide). Just include the two columns.
- **Index every foreign-key column.** Postgres does not auto-index FKs; the
  performance advisor flags unindexed ones. All target-model FKs are indexed.
- **All ids are `uuid`; all season ids / `season_id` are `string` in TypeScript.**
- **All DB changes go through migration files** (`supabase migration new …` then
  `supabase db push`). Never write to the database directly. See the root
  `AGENTS.md` rule 12 for the exact CLI invocation (token + `--linked --workdir`).

---

## 7. Implementing a new bet type

1. **Does it fit an existing `market_type`?** If it's a yes/no or multi-choice
   proposition, use `market_type='prop'` with `params` describing it + the
   appropriate `bet_selections`. **No schema change needed.**
2. **New structural type** (e.g. spreads with per-side handicaps): add the value
   to the `bet_markets.market_type` CHECK; `bet_selections.line` already carries a
   per-side handicap. Only add a child table if the type needs columns that don't
   fit `params` and you need to query/constrain them relationally.
3. **Selections:** create one `bet_selections` row per outcome, each with its
   `odds` (and `line` if applicable).
4. **Placement:** extend/author a `SECURITY DEFINER` RPC (modeled on `place_bet`)
   that snapshots `odds_at_placement` per leg and writes the `bets` + `bet_legs`
   + ledger rows atomically. For parlays, accept N selections → N legs on one bet.
5. **Settlement:** set each `bet_selections.result`, derive each `bet_legs.result`
   via the [back/lay table](#back--lay-settlement-truth-table), set the bet
   `status`/`settled_at`, and post the double-entry ledger rows. A bet wins iff all
   legs win.
6. **Re-check the integrity rules** in §5 (anti-tanking, min stake, balance).

## 8. Roadmap — phase 2

The schema is in place; the economic core and app port are not:

1. **`pin_ledger` house-account extension** (§4 target accounting).
2. **RPCs:** `place_house_bet` (single + parlay), `create_bet_offer`,
   `accept_bet_offer`, `settle_market` — all `SECURITY DEFINER`, balance- and
   integrity-checked, double-entry.
3. **App cutover (strangler):** add `db.ts` query objects + RPC wrappers for the
   new tables; migrate `BettingScreen` / admin / RSVP off `bet_lines` /
   `placed_bets` screen-by-screen.
4. **Legacy retirement:** migrate `bet_lines` / `placed_bets` history onto the new
   model (small dataset — betting launched recently), then drop them.

### Open product decisions (do not block the schema)
- Peer **rake** percentage (`bet_matches.rake` defaults to 0).
- House **vig** (sub-fair odds as a sink) vs fair odds + manual top-ups.
- Offer **expiry / cancellation refund** rules.

---

## 9. File map

| File | What |
|---|---|
| `migrations/20260604174814_betting_feature.sql` | Legacy `bet_lines` / `placed_bets` / `pin_ledger`. |
| `migrations/20260604190954_prevent_self_under_bet.sql` | Anti-tanking trigger (legacy). |
| `migrations/20260604204823_rsvp_bet_line_cleanup_rpc.sql` | (superseded) original cleanup RPC. |
| `migrations/20260604230655_betting_fk_indexes.sql` | FK indexes on legacy betting tables. |
| `migrations/20260604230656_auto_attach_updated_at_triggers.sql` | `set_updated_at` backfill + event-trigger auto-attach. |
| `migrations/20260604230657_betting_server_side_integrity.sql` | `place_bet` / `sync_bet_lines_for_week` RPCs + RLS lockdown. |
| `migrations/20260604232544_harden_function_search_path.sql` | Pinned `search_path` on functions. |
| `migrations/20260605002715_betting_target_model.sql` | **The target model** (this document's §2). |
| `app/src/utils/supabase/db.ts` | Typed query objects (legacy betting wired here). |
| `supabase/AUTH.md` | Auth / JWT / RLS architecture. |
