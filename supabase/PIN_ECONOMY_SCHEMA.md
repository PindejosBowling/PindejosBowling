# Pin Economy & Betting Schema

Reference for the pin economy and the betting subsystem — the tables, their
relationships, the accounting model, and how to implement or extend betting
features. Read this before touching anything under the `bet_*` / `pin_ledger`
tables or writing new betting flows.

> **Status — single canonical model (Phase 2 complete).**
> Over/under runs natively on the canonical model: `bet_markets`,
> `bet_selections`, `bets`, `bet_legs`, with funded-house **double-entry**
> accounting on `pin_ledger` (player rows + house rows, `is_house` / `bet_id`).
> The legacy `bet_lines` / `placed_bets` tables, the `place_bet` /
> `sync_bet_lines_for_week` RPCs, and the `placed_bets_no_self_under` trigger were
> **removed** in the Phase 2 cutover (the `20260605005517`–`20260605011338`
> migrations). The **deferred peer layer** (`bet_offers` / `bet_matches` +
> `bets.counterparty`) was never built on and was **dropped** in the 2026-06 tech-debt
> cleanup (`20260612003905_drop_deferred_peer_layer`) — peer wagering ships as the
> **PvP Challenge Contracts** system instead ([context/economy/PvP_DB.md](../context/economy/PvP_DB.md)).
> All betting work now extends the canonical model — see
> [Implementing a new bet type](#implementing-a-new-bet-type).
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
bet_markets ──< bet_selections
  (what you        (the sides; each has
   can bet on)      odds, line, result)
                          ▲
                          │ referenced by
                          │
        bets ──< bet_legs ┘
     (the stake)   (back/lay a selection,
                    odds snapshotted)
```

### `bet_markets` — a thing you can bet on

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `market_type` text | `over_under` \| `moneyline` \| `prop`. Discriminator. Extend the CHECK to add types. |
| `title` text | Display label. |
| `week_id` uuid → weeks | Scope. **Nullable** — null = season-long / futures. `ON DELETE CASCADE`. |
| `game_number` int | Nullable; `>= 1` when present. |
| `subject_player_id` uuid → players | The player a line/prop is about (e.g. the O/U subject). `ON DELETE CASCADE`. Null for moneylines. |
| `subject_game_id` uuid → games | The game (matchup) a market is about — the **moneyline** subject. `ON DELETE CASCADE`. Null for O/U. Mirrors `subject_player_id`: one or the other is set. Indexed. |
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
- **Moneyline (as built):** one selection per **team** in a game, `key = team_id`, `label = "Team N"`, `line` null, even-money `2.000`. Market `subject_game_id` points at the matchup.
- **Prop:** `yes`/`no`, or N choices.

### `bets` — the stake (single source of truth for money placed)

`bets` carries **no bet-type-specific columns**. What was bet lives entirely in
`bet_legs → bet_selections`.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `player_id` uuid → players | The bettor. `ON DELETE CASCADE`. |
| `season_id` uuid → seasons | Balance scope (matches `pin_ledger`). `ON DELETE CASCADE`. |
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

### Removed: `bet_offers` / `bet_matches` (the deferred peer layer)

The back/lay peer-matching layer shipped with the canonical model but was never
built on (no RPC, no app path, zero rows). It was **dropped** in
`20260612003905_drop_deferred_peer_layer`, along with `bets.counterparty`
(every bet is a house bet). Peer wagering exists as the **PvP Challenge
Contracts** system (`pvp_challenges` / `pvp_challenge_offers`). If back/lay
odds-matching is ever revived, the original design lives in migration
`20260605002715_betting_target_model.sql`. `bet_legs.side` (`back`/`lay`)
survives — only `'back'` is ever written today; the lay branch of the
settlement truth table and `prevent_self_tank` is dormant, not dead.

---

## 3. How each bet type maps

| Feature | Expressed as |
|---|---|
| **Over/under** | `bet_markets(market_type=over_under, subject_player_id, game_number)` + two `bet_selections` (`over`/`under`) sharing a `line`, each with `odds`. |
| **Moneyline (LIVE)** | `bet_markets(market_type=moneyline, subject_game_id, game_number)` + one selection per team (`key=team_id`, `line` null, even-money). Auto-generated per game (`sync_moneyline_markets_for_week`), auto-settled by higher combined team score (`settle_betting_for_week`). |
| **Prop (arbitrary)** | `bet_markets(market_type=prop, params=<definition>)` + N selections. No new table. |
| **LaneTalk stat prop (LIVE)** | `bet_markets(market_type=prop, subject_player_id, params={source:'lanetalk', stat:'strikes'\|'spares'\|'clean_frames'\|'first_ball_avg', scope:'game'\|'night'})` + over/under selections sharing a `line` (even-money). Per-game markets carry `game_number`; night markets `game_number=null`. Auto-generated by `sync_lanetalk_prop_markets_for_week` (RSVP-coupled via `resync_week_markets`); settled post-archive by `settle_lanetalk_props_for_week` off `lanetalk_game_imports.payload` (**separate clock from archive** — the backstop exempts pending prop-leg bets). Full doc: [context/lanetalk-stat-bets.md](../context/lanetalk-stat-bets.md). |
| **Single bet** | one `bets` row + one `bet_legs` row (`side=back`). |
| **Parlay** | one `bets` row + N `bet_legs` rows; combined odds = Π(leg odds). |
| **House bet** | Every `bets` row (the only kind); legs all `back`; house is the implicit lay. |
| **Peer wager** | **Not a `bets` row** — the PvP Challenge Contracts system (`pvp_challenges`, [context/economy/PvP_DB.md](../context/economy/PvP_DB.md)). |
| **Non-even odds** | `bet_selections.odds` (any value > 1.0), snapshotted per leg. |
| **Custom line / "Special" (LIVE)** | **Not a market.** A `custom_lines` row (title/description/category + abstract leg-spec jsonb + `week_ids`/permanent lifecycle) is an admin presentation template over existing selections; the app resolves it weekly — leg specs may be **bettor-relative** (`player_id` null = whoever takes it, resolved per-viewer) — and taking it calls `place_house_bet` with the underlying selection ids + the line id: the bet is an ordinary single/parlay (zero bespoke accounting or settlement) carrying a `custom_line_id` link + title/description/category **snapshot** on `bets` for durable display branding. Full doc: [context/betting-line-board.md](../context/betting-line-board.md). |

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
| `week_id` uuid → weeks | The week the entry belongs to. **Nullable** — `NULL` for `bonus` rows (credited at season open before any week exists). `ON DELETE SET NULL`. |
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

`score_credit` is the only **mint** (player-only, no counterpart). Every `bet_*`
transfer **and every `bonus`** writes **two** rows with opposite signs (player ↔
house), netting to 0 — `bet_*` pairs share a `bet_id`; bonuses are paired by
season at credit time.

| Event | Player row | House row | `week_id` set? |
|---|---|---|---|
| Season opens | `+100` `bonus` per prior-season champion | `−100` `bonus` (house-funded) | **NULL** (no week exists yet) |
| Week archived | `+score` `score_credit` per game per player (**only faucet**) | — | **YES** — the archived week |
| Bet placed | `−stake` `bet_stake` | `+stake` `bet_stake` | **YES** — the market's week |
| Bet won | `+potential_payout` `bet_payout` | `−potential_payout` `bet_payout` | **YES** — the market's week |
| Bet push | `+stake` `bet_refund` | `−stake` `bet_refund` | **YES** — the market's week |
| Bet loss | — (stake already debited) | — (house already holds the stake) | n/a |

`potential_payout = floor(stake × Π(won-leg odds))` (single even-money O/U leg =
`stake × 2`). Net player on win = profit; net house = `stake − payout`.

> `bonus` is the generalized, **house-funded** bonus type (formerly the player-only
> `champion_bonus` mint). Each bonus credit is debited from the house, so bonuses
> are paid *out of house income* rather than minted — they net to zero and the
> house balance reflects them. The `house_seed` type has been **dropped** (it was a
> per-season amount-0 marker with no balance impact and no code path).

> The economy's only inflation is `score_credit` (every game score becomes pins).
> `bonus` and `bet_*` movements balance against the house; only `score_credit`
> mints. A house **vig** (sub-fair odds) is the available sink; Phase 2 ships fair
> even odds (`2.000`).

**Conservation invariant (post-cutover):** for any season,
`SUM(pin_ledger.amount) = SUM(score_credit)` — every `bet_*` transfer and every
`bonus` nets to 0 across the player + house rows. (Holds from the Phase 2 cutover
forward; legacy history migrated in WS5 was mint-on-win and has no house
counter-rows, by design.)

**Settlement math:**
- **House single back:** win → house pays `stake × odds`; loss → house keeps the
  stake. Zero-sum vs the house account.
- **House parlay:** same, with `odds = Π(won-leg odds)` (push/void legs drop out).
- **Peer wagers** settle in the PvP system (stake escrow ↔ house, winner takes
  the pot) — see [context/economy/PvP_DB.md](../context/economy/PvP_DB.md).

### `pin_ledger_double_entry()` — the only sanctioned way to move pins

Every player↔house transfer goes through
`pin_ledger_double_entry(player, season, week, amount, type, description,
house_description?, bet_id?, bounty_post_id?)` — it inserts the player row
(signed `amount`) and the house mirror (`-amount`) and returns both ids, making
the nets-to-zero invariant structural. EXECUTE is revoked from all client
roles; only the SECURITY DEFINER RPCs (running as owner) may call it. Callers
that maintain a domain ledger (`loan_ledger` / `pvp_ledger`) insert their
domain row referencing `player_entry_id`, then back-link both pin rows in one
`UPDATE … SET <x>_ledger_id`. The only non-helper writes are the two
single-sided mints: `score_credit` and (one side of) season-open `bonus`.

**Ref-column policy:** a new economy feature gets **exactly one** root-entity
ref column on `pin_ledger` — the one its cancel/refund path deletes by
(`bet_id`, `bounty_post_id`, or a `<x>_ledger_id` back-link). The granular
bounty refs (`bounty_hunter_stake_id`, `bounty_settlement_id`,
`bounty_payout_id`) were dropped 2026-06-12 (`bets_bounty_adopt_helpers`);
payout-level granularity lives in `bounty_payouts`.

### Reversal rule — delete-refund vs append-reversal

Two undo mechanisms coexist in the ledger, and the split is principled:

- **Delete-refund is allowed only for unsettled escrow** — the paired stake
  rows of a bet/contract/bounty that never reached settlement — and always by
  the feature's root ref column (`cancel_bet`, `cancel_loan`,
  `cancel_pvp_challenge`, `cancel_bounty`, `refund_bets_before_market_delete`,
  `remove_over_under_markets_for_game`). The pair nets to zero, so deleting it
  leaves balances untouched; the contract "never existed."
- **Anything after settlement is reversed by appending offsetting rows**
  (`void_pvp_challenge`, PvP push refunds, bet push/void refunds). Settled
  money is history; history gets corrected, not erased.

`unarchive_week` is the single sanctioned exception: a snapshot-based surgical
reversal that may delete settlement-era rows because the archive snapshot
guarantees exact restoration (see
[context/archive-and-settlement.md](../context/archive-and-settlement.md)).
New features must pick the side this rule dictates — pre-settlement escrow
deletes by root ref; everything else appends.

---

## 5. Security & access model

Follows the project-wide pattern (see `supabase/AUTH.md`).

- **Reads:** `authenticated` only. Anon was locked out of every table on
  2026-06-12 (`anon_lockdown` — see AUTH.md "Anon posture"); its sole
  capability is the pre-login `is_registered_player` RPC.
- **Direct writes:** **admin-only** (RLS gated on `(SELECT public.is_admin())`
  — the shared helper that wraps the JWT role claim). Used by admin flows
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
| `sync_over_under_markets_for_week(week_id, extra_games default {})` | Create/refund of O/U markets + selections. **Line eligibility ladder for (player, game N): week has games → the player has a non-fill participation row (`scores`, score nullable) for game N; teams but no games yet → non-fill slot; no teams → RSVP `'in'`.** **Target games: the `games` table is authoritative once a schedule exists** (∪ `extra_games`); before teams it's existing market numbers ∪ extras, default {1,2}. Prunes (market delete → trigger refund) any open/closed market with an ineligible subject **or an out-of-schedule game number**; never touches settled/void markets. Re-run automatically by the coupling triggers (below). Idempotent. `authenticated`. |
| `remove_over_under_markets_for_game(week_id, game_number)` | **Admin.** Inverse of the sync's *create*: refund every bet on that week+game's O/U markets (delete the ledger pair[s] by `bet_id`, restoring balances — parlays touching the game refund whole) and drop the markets. Belt-and-braces alongside the games-delete trigger (the sync now prunes to the schedule). |
| `place_house_bet(selection_ids[], stake, custom_line_id?)` | Atomic, balance-checked, anti-tank-checked house bet; writes `bets` + `bet_legs` + the `bet_stake` double-entry pair. Parlay-shaped (O/U passes one selection). When `custom_line_id` is set (a "Special" take), the line must exist + be active, and its title/description/category are **snapshotted onto `bets.custom_line_*`** — durable branding for ledger/history surfaces (settlement never touches these columns). Returns `bets.id`. `authenticated`. |
| `sync_moneyline_markets_for_week(week_id)` | Schedule-driven create of even-money moneyline markets + team selections (one per `games` row). Wired to **team generation / add-game**, not RSVP. Idempotent (create-only). `authenticated`. |
| `place_house_bet(selection_ids[], stake)` | (above — market-type-agnostic; moneyline needs no change). |
| `settle_market(market_id, result_value)` | **Admin.** Settle one O/U **or prop** market: set selection results, derive leg results (back/lay), finalize bets, post payout/refund pairs. Idempotent. For LaneTalk props this is the manual escape hatch — systematic settlement is `settle_lanetalk_props_for_week`. |
| `settle_moneyline_market(market_id)` | **Admin.** Settle one moneyline market from its game's scores — winner = higher combined team total, ties → push. No score input. Idempotent. |
| `settle_betting_for_week(week_id, force default false)` | **Admin.** On archive: credit `score_credit` (once) + settle every open O/U market (vs. the subject's score) **and** every moneyline market (vs. team totals); scoreless markets are closed without a result. **Backstop: refuses to finish (RAISE, naming the unsettleable markets) while any bet with a leg in the week is still `pending`; with `force`, voids those bets (`status='void'`, legs `void`) and refunds their stakes (`bet_refund` pair).** **Exemption: bets with ≥1 leg on an unsettled `prop` market (LaneTalk stat bets) are excluded from the count, the listing, and the force-void — they settle later on the Confirm clock.** The weekly House P&L feed event sums `bet_stake`/`bet_payout`/`bet_refund` **via `bet_id` through the week's markets** (`bet_id` is the authoritative link; since `…191008_week_stamp_bet_settlement_ledger` the payout/refund pairs are also week-stamped so they group correctly in weekly ledger views). Called by `archive_week(week_id, force)`, which threads the flag. |
| `cancel_bet(bet_id)` | **Admin.** Total undo: delete the bet's ledger pair(s) + the bet; re-open a settled market if it was its last bet. |
| `settle_market_internal(market_id, result_value)` | Private engine (no grants); the **O/U + prop** settlement body (both are over/under/push vs. a shared line). |
| `settle_moneyline_market_internal(market_id)` | Private engine (no grants); the **moneyline** settlement body (computes team totals, sets results). |
| `finalize_bets_for_market(market_id)` | Private engine (no grants); the **shared** bet-finalization body (leg back/lay results + bet resolution + payout/refund pairs), called by both settlement engines once selection results are set. |
| `sync_lanetalk_prop_markets_for_week(week_id)` | Create/prune/reprice of LaneTalk stat-prop markets, mirroring the O/U sync: ladder eligibility ∩ ≥1 official import (no fallback — no imports, no lines); seeds via `lanetalk_seed_lines`; reprices UNBET open/closed lines that drifted. Run by `resync_week_markets` (the rsvp/team_slots/games/scores coupling triggers). Idempotent. `authenticated`. |
| `lanetalk_seed_lines(player_id)` | STABLE helper → the player's seeds (count lines `floor(avg)+0.5` clamped, raw clean-frames-per-game — the sync scales it by the week's schedule — first-ball `round(avg,1)`) from their official imports; zero rows when no history. `authenticated`. |
| `lanetalk_game_stats(payload jsonb)` | IMMUTABLE helper → `(strikes, spares, clean_pct, first_ball_avg)` from one import payload. **The authoritative stat definition for money** (the client `stats.ts` mirror is display/seeding only). `authenticated`. |
| `settle_lanetalk_props_for_week(week_id, void_missing default false)` | **Admin.** "Confirm LaneTalk Data": settle every unsettled LaneTalk prop of the week from the subject's `official` import rows (game scope: exact (player, game) row; night scope: frame-weighted aggregate, only when official-game count ≥ scored-game count). Missing data → left pending, or with `void_missing` the market is DELETEd (trigger refunds bets whole — bets are removed, not kept as `void` records). Returns `(settled, voided, left_pending)`. Idempotent / re-runnable. |
| `is_registered_player(phone)` | Pre-login gate (anon-callable). |

Anti-tanking is also enforced by the `bet_legs_no_self_tank` BEFORE INSERT/UPDATE
trigger on `bet_legs` (rejects backing `under` / laying `over` on your own market).
Open/close a market with a direct admin `UPDATE bet_markets SET status` (no RPC).

**Deleting a market is self-cleaning.** A `refund_bets_before_market_delete`
BEFORE DELETE trigger on `bet_markets` refunds (deletes the `pin_ledger` pair[s]
by `bet_id`, restoring balances) and deletes every bet with a leg on the market
being removed — so a raw `DELETE FROM bet_markets` (console / any non-RPC path),
not just `remove_over_under_markets_for_game`, tears down correctly and across
all market types. Without it the FK cascade only flows downward
(`bet_markets → bet_selections → bet_legs`), orphaning the parent `bets` row and
leaving its `bet_stake` ledger pair un-reversed (`pin_ledger.bet_id` is `ON DELETE
SET NULL`). Parlays touching the market refund whole (the bet delete cascades its
legs on other games). Composes with the RPC (which deletes bets first → trigger
is then a no-op); no recursion.

**Roster→market coupling is server-side.** Statement-level AFTER triggers on
`rsvp`, `team_slots`, `games`, and `scores` (`*_resync_markets_{ins,upd,del}` →
`trg_resync_markets_*` → `resync_week_markets(week_id, moneyline?)`) re-run
`sync_over_under_markets_for_week` — plus `sync_moneyline_markets_for_week` for
`games` changes — after **any** mutation, so no client path can strand a market
whose subject/game no longer exists (the hanging-pending-bet class of bug; see
`SETTLEMENT_ACCEPTANCE.md` §C). The guard helper skips weeks that are archived
(settled markets are immutable) or mid-cascade-delete (week row already gone),
and cascaded slot/game deletes resolve to no week by design — the wipe side of a
team regen is handled by FK cascades + the market-delete refund trigger, and the
rebuild side by the slot/game INSERT triggers. Client-side sync calls remain as
idempotent belt-and-braces.

**Per-game participation drives O/U lines.** A `(team_slot, game)` `scores` row
is the lineup marker (`score` nullable; null = present, not yet scored). Rows
are seeded eagerly at matchup creation by `games_participation_seed_ins` (named
to fire before the games resync trigger — alphabetical order) and backfilled for
unarchived weeks at cutover, so row-absence unambiguously means "not in this
game's lineup". The week editor adds/removes rows for per-game lineup changes —
the `scores` INSERT/DELETE resync triggers then create/prune that player+game's
line at edit time (prune refunds bets whole). Score-value changes are the
upsert's conflict path (no INSERT transition rows, no UPDATE trigger installed)
→ routine score entry costs nothing. The app's score pad clears a score by
upserting null, never deleting the row.

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
>   real books block, and **moneyline is now live**, so this parlay *can* be built
>   today. It's an open integrity item, not blocked in code.)

**Next (schema already supports it):**

1. **Peer bets — superseded.** The back/lay offer/match layer was dropped
   (2026-06 cleanup); peer wagering shipped as PvP Challenge Contracts instead.
2. **Moneyline — DONE.** Game moneylines are live: even-money, auto-generated per matchup, auto-settled by combined team score (`subject_game_id`, `sync_moneyline_markets_for_week`, `settle_moneyline_market`). **Props** remain (new `bet_markets.market_type` + selections, §7).

### Open product decisions (do not block the schema)
- House **vig** (sub-fair odds as a sink) vs fair odds + manual top-ups (Phase 2
  ships fair `2.000`). Pricing parlay legs below `2.000` (e.g. `1.90` → `×1.9^N`)
  is the lever that turns the compounding parlay margin in the house's favor, the
  way real books do.
- **Parlay correlation guard:** whether to forbid multiple legs with the same
  `subject_player_id` in one bet (kills the same-player-across-games +EV play). Not
  yet enforced — parlays currently allow any distinct selections.

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
| `migrations/20260605215407_remove_ou_markets_for_game.sql` | `remove_over_under_markets_for_game(week_id, game_number)` — admin refund + teardown of a removed schedule game's O/U markets (inverse of the sync's create path). |
| `migrations/20260608140000_bet_markets_subject_game.sql` | **Moneyline 1/3** — `bet_markets.subject_game_id` (+ index). |
| `migrations/20260608140100_sync_moneyline_markets.sql` | **Moneyline 2/3** — `sync_moneyline_markets_for_week` (even-money market per matchup). |
| `migrations/20260608140200_moneyline_settlement.sql` | **Moneyline 3/3** — extract `finalize_bets_for_market`; `settle_moneyline_market[_internal]`; extend `settle_betting_for_week`. |
| `migrations/20260608140300_moneyline_title_no_game_suffix.sql` | Moneyline title cleanup (drop the redundant "· Game N"). |
| `migrations/20260610003542_refund_bets_before_market_delete.sql` | `refund_bets_before_market_delete` BEFORE DELETE trigger on `bet_markets` — makes any market delete (not just the RPC) refund + tear down its bets, fixing the orphaned-bet / un-reversed-ledger class of bug (see §5 "Deleting a market is self-cleaning"). |
| `migrations/20260611120000_settlement_integrity.sql` | **Settlement integrity** — (1) `sync_over_under_markets_for_week` rework: slot-coupled line ownership + authoritative game set with pruning; (2) roster→market coupling triggers on `rsvp`/`team_slots`/`games`; (3) `settle_betting_for_week(week_id, force)` no-pending-bets backstop (+ `archive_week(week_id, force)` threading) and the bet-linked House P&L sum fix. |
| `migrations/20260611130000_per_game_participation.sql` | **Per-game participation** — eager seeding of `(team_slot, game)` null-score lineup rows (`games_participation_seed_ins` trigger + unarchived-week backfill); `sync_over_under_markets_for_week` keys lines to participation rows when games exist; `scores` INSERT/DELETE resync triggers so per-game lineup edits prune/create lines (refunding bets) at edit time. |
| `migrations/20260610191008_week_stamp_bet_settlement_ledger.sql` | **Week-stamp settlement ledger** (applied after the 20260611 pair; acceptance-test V3 finding) — `bet_payout`/`bet_refund` pairs now carry `week_id` at both insertion sites (`finalize_bets_for_market`, the backstop force-void) + backfill, so they group under the correct week in per-player Activity views instead of being dropped. |
| `migrations/20260610193032_single_mode_unarchive.sql` | **Single-mode unarchive** (acceptance-test finding) — `unarchive_week(week_id, force)` replaces the soft/hard split: reversal always reopens the week (`is_archived → false`), so the week is back in play and MatchupsScreen's Archive & Advance is the re-archive path. The old soft state (reversed-but-locked, no current week anywhere) is gone; one-time data fix completed any week stranded in it. |
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
2. **Conservation invariant (SQL).** Every `bet_*` transfer and every `bonus` nets
   to 0 across the player + house rows, so for any season the ledger sum equals the
   lone mint (`score_credit`):
   ```sql
   SELECT season_id,
          SUM(amount)                                                  AS net,
          SUM(amount) FILTER (WHERE type = 'score_credit')             AS mint
   FROM public.pin_ledger
   GROUP BY season_id;
   -- net must equal mint for every season. (Holds from the Phase 2 cutover
   -- forward; pre-cutover migrated history was mint-on-win — see §4.)
   ```
3. **Settle win / loss / push.** Call `settle_market` with a value above / below /
   equal to the line; assert bet `status`, the payout pair (win) / refund pair
   (push) / no ledger (loss), correct balances, and that a re-run is a no-op.
4. **Archive.** `settle_betting_for_week` credits `score_credit` once and settles
   every open market exactly once; re-running is a no-op.
5. **Cancel.** `cancel_bet` removes all ledger rows for the bet, restores the
   balance exactly, and re-opens a market if it was the market's last bet.
6. **RSVP / roster sync.** RSVP a player **out** (pre-teams) → their markets +
   bets are gone and any bets are refunded; RSVP **in** → markets recreated;
   fully idempotent. Once teams exist: removing a player's slot (week editor) or
   regenerating into a smaller schedule prunes + refunds the same way — via the
   `rsvp`/`team_slots`/`games` triggers, no client call needed.
7. **Advisors.** `supabase db lint` is clean and every betting FK is indexed with a
   pinned `search_path` on all functions (§5–§6 conventions).
