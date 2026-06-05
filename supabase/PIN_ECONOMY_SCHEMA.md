# Pin Economy & Betting Schema

Reference for the pin economy and the betting subsystem — the tables, their
relationships, the accounting model, and how to implement or extend betting
features. Read this before touching anything under the `bet_*` / `pin_ledger`
tables or writing new betting flows.

> **Status — single canonical model (Phase 2 complete).**
> Over/under runs natively on the canonical model: `bet_markets`,
> `bet_selections`, `bets`, `bet_legs` (+ the deferred peer layer `bet_offers` /
> `bet_matches`), with funded-house **double-entry** accounting on `pin_ledger`
> (player rows + house rows, `is_house` / `bet_id`). The legacy `bet_lines` /
> `placed_bets` tables, the `place_bet` / `sync_bet_lines_for_week` RPCs, and the
> `placed_bets_no_self_under` trigger were **removed** in the Phase 2 cutover (the
> `20260605005517`–`20260605011338` migrations). All betting work now extends the
> canonical model — see [Implementing a new bet type](#implementing-a-new-bet-type).
>
> **House parlays are also live** (multi-leg house bets, combined odds = Π(leg
> odds) = `×2^N` on even-money O/U legs). This required **no schema or RPC change** —
> the placement/settlement/cancel RPCs were parlay-shaped from the start; only the UI
> was added. See [Roadmap → Parlays](#8-roadmap) for the mechanics and the fair-odds
> / correlation caveats.

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
| `player_id` uuid → players | The account owner. **Nullable** — `NULL` for house rows. `ON DELETE CASCADE`. |
| `season_id` uuid → seasons | `ON DELETE CASCADE`. |
| `week_id` uuid → weeks | The week the entry belongs to. **Nullable** — `NULL` for `champion_bonus` (credited at season open before any week exists) and future `house_seed` rows. `ON DELETE SET NULL`. |
| `amount` int | Signed. Credits positive, debits negative. |
| `type` text | See lifecycle below. |
| `description` text | Human-readable. |
| `is_house` bool | House-account row (the betting counterparty). Excluded from player balances/leaderboard. |
| `bet_id` uuid → bets | The bet a transfer belongs to. `ON DELETE SET NULL`. |

- `pin_ledger_owner_chk`: every row is owned by a player **or** the house
  (`is_house OR player_id IS NOT NULL`).
- Per-player balance is `WHERE player_id = X` (house rows have `player_id NULL`,
  so they're excluded automatically); the leaderboard also filters `is_house = false`.

#### Ledger lifecycle (double-entry)

Faucets are **mints** (player-only, no counterpart). Every `bet_*` transfer writes
**two** rows with the same `bet_id` and opposite signs (player ↔ house), netting to 0.

| Event | Player row | House row | `week_id` set? |
|---|---|---|---|
| Season opens | `+100` `champion_bonus` per prior-season champion | — | **NULL** (no week exists yet) |
| Season opens | — | `0` `house_seed` (one per season; seed-0 policy, allowed negative) | **NULL** for new seasons; backfilled to week 1 for existing rows |
| Week archived | `+score` `score_credit` per game per player (**dominant faucet**) | — | **YES** — the archived week |
| Bet placed | `−stake` `bet_stake` | `+stake` `bet_stake` | **YES** — the market's week |
| Bet won | `+potential_payout` `bet_payout` | `−potential_payout` `bet_payout` | **YES** — the market's week |
| Bet push | `+stake` `bet_refund` | `−stake` `bet_refund` | **YES** — the market's week |
| Bet loss | — (stake already debited) | — (house already holds the stake) | n/a |

`potential_payout = floor(stake × Π(won-leg odds))` (single even-money O/U leg =
`stake × 2`). Net player on win = profit; net house = `stake − payout`.

> The economy is **inflationary by design** via `score_credit` (every game score
> becomes pins). Only `bet_*` movements balance against the house; the faucets do
> not. A house **vig** (sub-fair odds) is the available sink; Phase 2 ships fair
> even odds (`2.000`).

**Conservation invariant (post-cutover):** for any season,
`SUM(pin_ledger.amount) = SUM(house_seed) + SUM(score_credit) + SUM(champion_bonus)`
— every `bet_*` transfer nets to 0 across the player + house rows. (Holds from the
Phase 2 cutover forward; legacy history migrated in WS5 was mint-on-win and has no
house counter-rows, by design.)

**Settlement math:**
- **House single back:** win → house pays `stake × odds`; loss → house keeps the
  stake. Zero-sum vs the house account.
- **House parlay:** same, with `odds = Π(won-leg odds)` (push/void legs drop out).
- **Peer (deferred):** both stakes escrow into `bet_matches.pool`; winner collects
  `pool − rake`; rake (if any) → house.

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

### Betting RPCs (LIVE — canonical model)

All `SECURITY DEFINER`, pinned `search_path`, identity from `auth.uid()`/`auth.jwt()`.

| RPC | Purpose |
|---|---|
| `sync_over_under_markets_for_week(week_id, extra_games default {})` | RSVP-driven create/refund of O/U markets + selections, derived from `rsvp` + `scores`. `extra_games` adds schedule games (team-gen game 3). Idempotent. `authenticated`. |
| `place_house_bet(selection_ids[], stake)` | Atomic, balance-checked, anti-tank-checked house bet; writes `bets` + `bet_legs` + the `bet_stake` double-entry pair. Parlay-shaped (O/U passes one selection). Returns `bets.id`. `authenticated`. |
| `settle_market(market_id, result_value)` | **Admin.** Settle one O/U market: set selection results, derive leg results (back/lay), finalize bets, post payout/refund pairs. Idempotent. |
| `settle_betting_for_week(week_id)` | **Admin.** On archive: credit `score_credit` (once) + settle every open O/U market against the subject's actual score. |
| `cancel_bet(bet_id)` | **Admin.** Total undo: delete the bet's ledger pair(s) + the bet; re-open a settled market if it was its last bet. |
| `edit_over_under_line(market_id, line)` | **Admin.** Set a market's line (both selections) — rejects if any bet exists. |
| `settle_market_internal(market_id, result_value)` | Private engine (no grants); the settlement body shared by `settle_market` / `settle_betting_for_week`. |
| `is_registered_player(phone)` | Pre-login gate (anon-callable). |

Anti-tanking is also enforced by the `bet_legs_no_self_tank` BEFORE INSERT/UPDATE
trigger on `bet_legs` (rejects backing `under` / laying `over` on your own market).
Open/close a market with a direct admin `UPDATE bet_markets SET status` (no RPC).

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

- **Anti-tanking:** a player may never bet against their own performance —
  backing the `under` (or laying the `over`) on a market where they are the
  subject (`bet_markets.subject_player_id = bets.player_id`). Enforced by the
  `bet_legs_no_self_tank` BEFORE INSERT/UPDATE trigger on `bet_legs` **and**
  in-body in `place_house_bet` **and** in the UI.
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

## 8. Roadmap

**Phase 2 — DONE.** House over/under is native on the canonical model with
funded-house double-entry accounting; the app, RSVP sync, admin settlement, and
team-gen are ported; legacy `bet_lines` / `placed_bets` / RPCs / trigger are
dropped (the `20260605005517`–`20260605011338` migrations + git history).

**Parlays — DONE (UI only, no schema/RPC change).** The placement/settlement RPCs
were authored parlay-shaped from the start (leg arrays, combined odds = Π(leg
`odds_at_placement`), push/void legs drop out at settlement), so multi-leg house
bets shipped as a pure-UI addition on top of the existing model:

- **Placement:** `place_house_bet(selection_ids[], stake)` already accepts N
  selections → N `bet_legs` on one `bets` row. The combined `potential_payout` =
  `floor(stake × Π(odds))`; with the live even-money O/U selections (`odds =
  2.000`) an N-leg parlay pays **`×2^N`**.
- **Settlement:** each leg settles when *its* market settles; `settle_market_internal`
  leaves the bet `pending` until every leg is resolved, then a bet wins iff all
  surviving legs win (push/void legs drop out and the payout is recomputed over the
  remaining legs — see the [back/lay table](#back--lay-settlement-truth-table)).
  A parlay therefore can't be settled from a single market in the admin UI; it
  finalizes automatically as its last leg lands.
- **Cancellation:** `cancel_bet(bet_id)` already reverses all of a bet's ledger
  pair(s) regardless of leg count, so admin cancel works on parlays unchanged.
- **UI:** the **Place Bets** tab has a Single/Parlay toggle; in Parlay mode the
  open O/U lines feed a **bet slip** (one selection per market, anti-tank enforced
  on the slip as well as the RPC/trigger), and a confirm modal places the whole
  slip in one `place_house_bet` call. Parlays render as their own group in **Active
  Bets** / **Settled Bets** (`BetView.legCount > 1`).

> **Odds note — `2^N` is the *fair* (zero-EV) payout for independent even-money
> legs, not a house giveaway.** Win probability shrinks as `(1/2)^N` exactly as the
> payout grows as `2^N`, so EV nets to 0. Because Phase 2 ships **fair odds with no
> vig**, the house has no cushion against legs that aren't truly 50/50. Two leaks to
> watch (neither is a schema issue — both are pricing/integrity choices):
> - **Mispriced lines.** The O/U line is `floor(avg)+0.5` from prior archived
>   scores — an estimate of a skewed, non-stationary distribution. A leg whose true
>   `P(win)` ≠ 0.5 is mildly +EV as a single but its edge compounds **exponentially**
>   in a parlay.
> - **Correlated legs.** The `Π(odds)` rule is only fair for *independent* legs. A
>   single player's Overs **across multiple games in one night** are positively
>   correlated (hot/cold night, lane condition), so `P(all over)` exceeds `Π(0.5)`
>   while the parlay still only pays `×2^N` → underpriced → +EV. (A cross-market
>   correlation — a player's Over + their team's moneyline — is the textbook case
>   real books block, but moneyline isn't live yet, so it can't occur today.)

**Next (schema already supports it):**

1. **Peer bets** (`bet_offers` / `bet_matches`): `create_bet_offer`,
   `accept_bet_offer` RPCs + escrow settlement — all `SECURITY DEFINER`,
   integrity-checked, double-entry (peer is zero-sum between players, rake → house).
2. **Moneyline / props:** new `bet_markets.market_type` + selections (§7).

### Open product decisions (do not block the schema)
- Peer **rake** percentage (`bet_matches.rake` defaults to 0).
- House **vig** (sub-fair odds as a sink) vs fair odds + manual top-ups (Phase 2
  ships fair `2.000`). Pricing parlay legs below `2.000` (e.g. `1.90` → `×1.9^N`)
  is the lever that turns the compounding parlay margin in the house's favor, the
  way real books do.
- **Parlay correlation guard:** whether to forbid multiple legs with the same
  `subject_player_id` in one bet (kills the same-player-across-games +EV play). Not
  yet enforced — parlays currently allow any distinct selections.
- Offer **expiry / cancellation refund** rules.

---

## 9. File map

| File | What |
|---|---|
| `migrations/20260604174814_betting_feature.sql` | Original `pin_ledger` (+ legacy `bet_lines` / `placed_bets`, since dropped). |
| `migrations/20260604230656_auto_attach_updated_at_triggers.sql` | `set_updated_at` backfill + event-trigger auto-attach. |
| `migrations/20260605002715_betting_target_model.sql` | **The canonical model** (this document's §2). |
| `migrations/20260605005517_ou_house_account_and_anti_tank.sql` | Phase 2 WS1 — `pin_ledger` house account (`is_house`/`bet_id`), `bet_legs_no_self_tank`, house seed. |
| `migrations/20260605005644_ou_target_model_rpcs.sql` | Phase 2 WS2 — placement / settlement / cancel / edit RPCs (§5). |
| `migrations/20260605010835_ou_sync_extra_games.sql` | Phase 2 — `sync_over_under_markets_for_week` + `extra_games` (team-gen game 3). |
| `migrations/20260605011207_migrate_legacy_betting_to_target.sql` | Phase 2 WS5 — legacy history → canonical model; ledger `bet_id`/type backfill. |
| `migrations/20260605011338_decommission_legacy_betting.sql` | Phase 2 WS6 — drop legacy tables / RPCs / trigger / `placed_bet_id`; prune type CHECK. |
| `migrations/20260605120219_add_week_id_to_pin_ledger.sql` | Add `week_id` FK to `pin_ledger`; backfill existing rows; update `place_house_bet`, `settle_market_internal`, `settle_betting_for_week` to stamp it on new entries. |
| `app/src/utils/supabase/db.ts` | Typed query objects (`betMarkets` / `bets` / `pinLedger` + RPC wrappers). |
| `app/src/hooks/useBettingData.ts` | Normalizes the market/bet graph into flat `LineView` / `BetView`. |
| `supabase/AUTH.md` | Auth / JWT / RLS architecture. |

> The Phase 2 cutover (legacy `bet_lines` / `placed_bets` → this model) is recorded
> in the `20260605005517`–`20260605011338` migrations and git history.

---

## 10. Verifying betting integrity (no test suite)

Manual + SQL checks — run against a throwaway week / non-prod season after any
change to the betting RPCs, the ledger, or the settlement math.

1. **Placement.** Place an O/U bet in the app. Assert: one `bets` (`pending`) + one
   `bet_legs` (`back`); a `bet_stake` ledger pair (player `−`, house `+`) summing to
   0; the player's balance dropped by the stake; **over** on your own line is
   allowed, **under** on your own line is rejected by both the UI and the
   `bet_legs_no_self_tank` trigger.
2. **Conservation invariant (SQL).** Every `bet_*` transfer nets to 0 across the
   player + house rows, so for any season the ledger sum equals the faucets only:
   ```sql
   SELECT season_id,
          SUM(amount)                                                                AS net,
          SUM(amount) FILTER (WHERE type IN ('house_seed','score_credit','champion_bonus')) AS faucets
   FROM public.pin_ledger
   GROUP BY season_id;
   -- net must equal faucets for every season. (Holds from the Phase 2 cutover
   -- forward; pre-cutover migrated history was mint-on-win — see §4.)
   ```
3. **Settle win / loss / push.** Call `settle_market` with a value above / below /
   equal to the line; assert bet `status`, the payout pair (win) / refund pair
   (push) / no ledger (loss), correct balances, and that a re-run is a no-op.
4. **Archive.** `settle_betting_for_week` credits `score_credit` once and settles
   every open market exactly once; re-running is a no-op.
5. **Cancel.** `cancel_bet` removes all ledger rows for the bet, restores the
   balance exactly, and re-opens a market if it was the market's last bet.
6. **RSVP sync.** RSVP a player **out** → their markets + bets are gone and any
   bets are refunded; RSVP **in** → markets recreated; fully idempotent.
7. **Advisors.** `supabase db lint` is clean and every betting FK is indexed with a
   pinned `search_path` on all functions (§5–§6 conventions).
