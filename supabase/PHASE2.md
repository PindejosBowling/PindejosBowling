# Phase 2 — Cut over Over/Under betting to the target model & decommission legacy

Companion to [PIN_ECONOMY_SCHEMA.md](./PIN_ECONOMY_SCHEMA.md). Read that first —
this document assumes its table definitions, odds convention, accounting model,
and conventions, and references its sections (e.g. *Schema §4*).

## Objective

Reproduce **100% of the live over/under betting behavior** on the target model
(`bet_markets` / `bet_selections` / `bets` / `bet_legs` + the house-account
ledger), cut the app over to it, then **delete the legacy infrastructure**
(`bet_lines`, `placed_bets`, the `place_bet` / `sync_bet_lines_for_week` RPCs,
the `placed_bets_no_self_under` trigger, and `pin_ledger.placed_bet_id`).

When Phase 2 is done, over/under is the *first consumer* of the canonical model
and nothing in the app or DB references the legacy betting tables.

### In scope
- House-banked **over/under** markets (the only bet type live today).
- The **funded house account + double-entry** accounting from *Schema §4*.
- Full admin lifecycle: create/sync lines, open/close, edit line, settle (per
  market + on archive), cancel bet.
- Data migration of legacy history and removal of legacy objects.

### Out of scope (later phases — schema already supports them)
- **Peer** bets (`bet_offers` / `bet_matches`), **parlays** (multi-leg UI),
  moneyline/props. The placement/settlement RPCs are authored to *generalize*
  (leg arrays, combined odds), but no peer/parlay UI ships in Phase 2.

---

## Parity checklist (definition of done)

Every legacy capability must have a working target-model equivalent before legacy
is dropped.

| # | Legacy capability | Today (legacy) | Target implementation | Done |
|---|---|---|---|---|
| 1 | RSVP-driven line create/refund | `sync_bet_lines_for_week` | `sync_over_under_markets_for_week` (WS2) | ☐ |
| 2 | Team-gen game-3 lines | `AdminGenerateTeamsModal` → `betLines.insert` | calls `sync_over_under_markets_for_week` after gen | ☐ |
| 3 | Place bet (atomic, balance-checked) | `place_bet` RPC | `place_house_bet` RPC (WS2) | ☐ |
| 4 | Open/close a line | `betLines.update(is_open)` | `bet_markets.status` open/closed (admin RLS) | ☐ |
| 5 | Edit line value (no bets) | `betLines.update(line)` | `edit_over_under_line` RPC / guarded admin update | ☐ |
| 6 | Settle on week archive | `settleBettingForWeek` | `settle_betting_for_week` RPC (WS2) | ☐ |
| 7 | Manual single-market settle | `BettingScreen.settleBet` | `settle_market` RPC (WS2) | ☐ |
| 8 | Cancel placed bet (admin undo) | `removeByPlacedBet` + `placedBets.remove` | `cancel_bet` RPC (WS2) | ☐ |
| 9 | Anti-tanking (no under on own line) | `placed_bets_no_self_under` trigger | `bet_legs_no_self_tank` trigger (WS1) | ☐ |
| 10 | Balance | `pin_ledger` sum (player) | unchanged (player rows only) | ☐ |
| 11 | Leaderboard + "If Win" projection | `useBettingData` | re-sourced from `bets`/ledger (WS4) | ☐ |
| 12 | Place Bets view (open lines + my bets) | `BettingScreen` | re-sourced from markets/selections/bets | ☐ |
| 13 | Active Bets view (week unsettled) | `BettingScreen` | re-sourced from `bets`+`bet_legs` | ☐ |
| 14 | Settled Bets view (season) | `BettingScreen` | re-sourced from `bets` | ☐ |
| 15 | Bet Lines admin (toggle + counts + edit) | `BettingAdminScreen` | re-sourced from markets/selections | ☐ |

---

## Accounting rules for Phase 2 (house O/U only)

From *Schema §4*. Phase 2 needs only the **house account** (the escrow account is
peer-only, deferred). Every betting transfer writes **two** `pin_ledger` rows with
the same `bet_id` and opposite signs (double-entry, nets to zero).

| Event | Player row | House row |
|---|---|---|
| Place bet | `−stake` `bet_stake` | `+stake` `bet_stake` |
| Win (settle) | `+potential_payout` `bet_payout` | `−potential_payout` `bet_payout` |
| Push (settle) | `+stake` `bet_refund` | `−stake` `bet_refund` |
| Loss (settle) | — (stake already debited) | — (house already credited the stake) |
| Cancel bet | delete all rows for `bet_id` (both sides) | — |

`potential_payout = floor(stake × Π(won-leg odds))` (for a single even-money O/U
leg = `stake × 2`). Net player on win = `payout − stake` = profit; net house =
`stake − payout`. Conservative by construction.

**Faucet entries stay mints (player-only, no house counterpart):** `score_credit`
and `champion_bonus` are the intended way pins enter the economy and are *not*
double-entry. Only `bet_*` transfers balance against the house.

**House seed:** insert one `house_seed` row per season. Recommend seeding **0** and
allowing the house balance to go negative (preserves today's effective
infinite-bankroll feel while making liability auditable); top up later if you
adopt a finite bankroll. → *open decision below.*

---

## Workstreams (ordered)

### WS1 — Accounting migration (`pin_ledger` house extension + anti-tank trigger)

One migration. Additive; does not disturb existing rows or the live balance query.

1. **House account support on `pin_ledger`:**
   - `ALTER TABLE pin_ledger ALTER COLUMN player_id DROP NOT NULL;`
   - `ADD COLUMN is_house boolean NOT NULL DEFAULT false;`
   - `ADD COLUMN bet_id uuid REFERENCES bets(id) ON DELETE SET NULL;`
   - `ADD CONSTRAINT pin_ledger_owner_chk CHECK (is_house OR player_id IS NOT NULL);`
   - Extend the `type` CHECK to add `bet_stake`, `bet_payout`, `bet_refund`,
     `house_seed` (keep the legacy `bet_placed`/`bet_won`/`bet_push` values until
     legacy data is migrated/dropped, then prune in WS6).
   - Index: `CREATE INDEX idx_pin_ledger_bet ON pin_ledger (bet_id);` and a
     partial `CREATE INDEX idx_pin_ledger_house ON pin_ledger (season_id) WHERE is_house;`
2. **Balance/leaderboard isolation:** house rows have `player_id IS NULL` /
   `is_house = true`, so per-player balance (`WHERE player_id = X`) already
   excludes them. The leaderboard query must filter `is_house = false` (or rely on
   the `players` inner join). Verify in WS4.
3. **Anti-tanking trigger** `bet_legs_no_self_tank` — BEFORE INSERT/UPDATE on
   `bet_legs`: reject when the leg's bet belongs to the market's subject and the
   pick is against themselves:
   ```
   reject if market.subject_player_id = bet.player_id
            and ( (side='back' and selection.key='under')
               or (side='lay'  and selection.key='over') )
   ```
   (Phase 2 is back-only, so this blocks backing `under` on your own market — the
   legacy rule. The `lay/over` arm future-proofs for peer.)
4. Seed `house_seed` rows for active season(s).

> Conventions: every new function `SECURITY DEFINER … SET search_path = ''`,
> identity from `auth.uid()`, `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated`.
> Do **not** declare `set_updated_at` on any new table (auto-attached). See
> *Schema §5–§6*.

### WS2 — RPCs

All `SECURITY DEFINER`, pinned `search_path`, admin-gated where noted. Author them
**parlay-shaped** (leg arrays / combined odds) even though the O/U UI uses single
legs — the schema is parlay-native and it's nearly free.

#### `sync_over_under_markets_for_week(p_week_id uuid)` → void  *(replaces `sync_bet_lines_for_week`)*
- Idempotent. Derives in-players from `rsvp(status='in')`.
- **Target games** = distinct `game_number` of existing `over_under` markets for
  the week, defaulting to `{1,2}`.
- **Create** for each in-player × target game with no existing market: a
  `bet_markets(market_type='over_under', week_id, game_number, subject_player_id,
  title, status='open')` + two `bet_selections` (`over`/`under`) with
  `line = floor(avg)+0.5`, `odds = 2.000`. Avg = current-season archived non-fill
  scores, league fallback 130 (port the SQL from `sync_bet_lines_for_week`).
- **Refund + remove** for players no longer "in": for each of their O/U markets
  this week, delete `pin_ledger` rows by the markets' `bet_id`s (restores
  balances), then delete the markets (cascade → selections → legs → bets). Order
  matters (ledger first; `pin_ledger.bet_id` is `ON DELETE SET NULL`).
- Grant `authenticated` (a non-admin toggling their own RSVP must trigger it).

#### `place_house_bet(p_selection_ids uuid[], p_stake int)` → uuid  *(replaces `place_bet`)*
- Resolve bettor from `auth.uid()`.
- Validate: every selection exists; each parent market `status='open'`; all
  markets resolve to the **same season**; `p_stake >= 10`; `stake <= balance`.
- Anti-tank check in-body (trigger is the backstop).
- `combined_odds = Π(selection.odds)`; `potential_payout = floor(stake × combined_odds)`.
- Insert `bets(player_id, season_id, counterparty='house', stake, potential_payout,
  status='pending')` + one `bet_legs` per selection (`side='back'`,
  `odds_at_placement=selection.odds`, `line_at_placement=selection.line`).
- Ledger pair: player `−stake` + house `+stake` (`bet_stake`, both with `bet_id`).
- Return the new `bet.id`. (O/U UI passes a single-element array.)

#### `settle_market(p_market_id uuid, p_result_value numeric)` → void
- **Admin only** (check JWT role in-body).
- Set `bet_markets.result_value`, `status='settled'`, `settled_at=now()`.
- Set each `bet_selections.result`: for O/U, `over` wins if `result_value > line`,
  `under` if `<`, else `push` (half-point lines never push).
- For every **pending** bet with a leg on this market: set `bet_legs.result` via
  the back/lay table (*Schema §2*), then **finalize any bet whose legs are all
  resolved**:
  - any leg `lost` → bet `lost` (no ledger; house keeps stake).
  - all legs `push`/`void` → bet `push` → refund pair (player `+stake`, house `−stake`).
  - else → bet `won`, `payout = floor(stake × Π(won-leg odds_at_placement))` →
    payout pair (player `+payout`, house `−payout`). Store on `bets.potential_payout`
    if it differs (push legs dropped).
- Skip non-`pending` bets (idempotent; never double-pays — mirrors legacy
  "archive only settles open" guarantee).

#### `settle_betting_for_week(p_week_id uuid)` → void  *(replaces `settleBettingForWeek`)*
- **Admin only.** Called by `AdminArchiveModal` after marking the week archived.
- **Score credits** (faucet, player-only): `+score` `score_credit` per non-fill
  game score (unchanged from legacy).
- For each non-settled `over_under` market in the week: look up the subject's
  actual game score; if present, call the `settle_market` logic with it; if
  absent, close/void the market (mirror legacy "no score → close without result").

#### `cancel_bet(p_bet_id uuid)` → void  *(replaces cancel-bet flow)*
- **Admin only.**
- Delete all `pin_ledger` rows `WHERE bet_id = p_bet_id` (both player + house →
  full balance restore), then delete the `bet` (cascade legs).
- If the bet's market was `settled` and **no bets remain** on it, re-open it: set
  market `status='open'`, clear `result_value`, clear selection `result`s (mirror
  legacy "un-settle on last cancel").

#### `edit_over_under_line(p_market_id uuid, p_line numeric)` → void  *(optional; or admin direct write)*
- **Admin only.** Re-check **no bets exist** on the market (guard against a bet
  placed since the admin loaded the screen), then update `line` on both selections.
- Alternatively keep as a guarded admin direct `UPDATE` (admin RLS allows it),
  matching the legacy client-side recheck. RPC is safer; either is acceptable.

> Open/close toggle (#4) needs no RPC — it's an admin direct `UPDATE bet_markets
> SET status` permitted by admin RLS.

### WS3 — Data layer (`db.ts`)

Add query objects + RPC wrappers for the new tables (`betMarkets`,
`betSelections`, `bets`, `betLegs`, and `placeHouseBet`/`settleMarket`/
`cancelBet`/`syncOverUnderMarketsForWeek`/`settleBettingForWeek` wrappers). Keep
the legacy `betLines`/`placedBets` objects until WS4 finishes, then remove in WS6.
Mirror the existing join-in-one-round-trip style (e.g. markets with selections,
bets with legs+selection+market+subject).

### WS4 — App cutover (strangler, screen by screen)

Port each consumer; verify behavior matches before moving on. Files:

- `hooks/useBettingData.ts` — open markets+selections, my bets (`bets`+legs),
  week bets, settled bets, balance (unchanged), leaderboard (filter `is_house`),
  "If Win" projection from `bets.potential_payout` of pending bets.
- `hooks/useBettingAdminData.ts` — markets for the week + bet counts per market.
- `screens/BettingScreen.tsx` — all four views; `placeBet` → `place_house_bet`;
  `settleBet` → `settle_market`; `cancelBet` → `cancel_bet`. Keep the existing
  toast/modal UX.
- `screens/BettingAdminScreen.tsx` — toggle `status`, counts, `edit_over_under_line`.
- `components/AdminArchiveModal.tsx` — replace inline `settleBettingForWeek` with
  the `settle_betting_for_week` RPC call.
- `components/AdminGenerateTeamsModal.tsx` — after gen, call
  `sync_over_under_markets_for_week` instead of `betLines.insert`.
- `screens/RsvpScreen.tsx` — `syncBetLines` → `sync_over_under_markets_for_week`.
- Regenerate `database.types.ts`; `tsc --noEmit` must be 0.

### WS5 — Data migration (legacy history → target)

One migration, after WS1–WS4 are merged and verified, before WS6.

- **`bet_lines` → markets+selections:** each row → one
  `bet_markets(market_type='over_under', week_id, game_number,
  subject_player_id=player_id, result_value=actual_score, status=...)` + two
  `bet_selections` (`over`/`under`, `odds=2.000`, `line`, `result` derived from
  `bet_lines.result`).
- **`placed_bets` → bets+legs:** each row → one `bets(player_id, season_id (via
  week→season), counterparty='house', stake=wager, potential_payout=wager*2,
  status from result/settled_at, settled_at)` + one `bet_legs(selection=matching
  over/under, side='back', odds_at_placement=2.000, line_at_placement=line,
  result)`.
- **`pin_ledger`:** rows already hold balances (no reconciliation). Backfill
  `bet_id` from a `placed_bet_id → bet.id` map for audit continuity, **then** the
  `placed_bet_id` column can be dropped in WS6. Do **not** create house
  counter-rows for historical bets (legacy was mint-on-win; rewriting history
  isn't worth it — only new Phase-2 bets are double-entry).
- Guard every insert with `NOT EXISTS` so the migration is re-runnable.

### WS6 — Decommission legacy

Separate migration, after a production soak confirming parity (≥1 archived week on
the new model). Drop in FK-safe order:

- Drop RPCs: `place_bet(uuid,text,integer)`, `sync_bet_lines_for_week(uuid)`.
- Drop trigger + function: `placed_bets_no_self_under`, `prevent_self_under_bet()`.
- Drop `pin_ledger.placed_bet_id` (and prune legacy `type` values
  `bet_placed`/`bet_won`/`bet_push` from the CHECK once no rows use them — or keep
  for historical rows; document the choice).
- `DROP TABLE placed_bets;` then `DROP TABLE bet_lines;`.
- Remove legacy `db.ts` objects + any dead imports; regenerate types; `tsc` clean.
- Update [PIN_ECONOMY_SCHEMA.md](./PIN_ECONOMY_SCHEMA.md): delete the "Legacy"
  column from the status banner and §4/§5/§9; over/under is now native.

---

## Legacy → target reference map

| Legacy object | Target replacement |
|---|---|
| `bet_lines` (row = player×game×week O/U) | `bet_markets`(over_under) + 2 `bet_selections` |
| `bet_lines.line` | `bet_selections.line` (both sides) |
| `bet_lines.is_open` | `bet_markets.status` (`open`/`closed`) |
| `bet_lines.result` / `actual_score` | `bet_selections.result` / `bet_markets.result_value` |
| `placed_bets` | `bets` + `bet_legs` |
| `placed_bets.pick` | which `bet_selections` the leg backs |
| `placed_bets.wager` / `payout` | `bets.stake` / `bets.potential_payout` |
| `pin_ledger` `bet_placed`/`bet_won`/`bet_push` | `bet_stake`/`bet_payout`/`bet_refund` (double-entry) |
| `place_bet` RPC | `place_house_bet` RPC |
| `sync_bet_lines_for_week` RPC | `sync_over_under_markets_for_week` RPC |
| `settleBettingForWeek` (client) | `settle_betting_for_week` RPC |
| `placed_bets_no_self_under` trigger | `bet_legs_no_self_tank` trigger |

---

## Verification (no test suite — manual + SQL)

Run after WS4, before WS5/WS6. Use a non-prod season or a throwaway week.

1. **Placement:** place an O/U bet via the app. Assert: one `bets` (pending) + one
   `bet_legs` (back); two paired `pin_ledger` rows (`bet_stake`, player `−`, house
   `+`) summing to 0; player balance dropped by stake; over-on-own-line allowed,
   under-on-own-line rejected by both UI and trigger.
2. **Conservation invariant (SQL):** for any season,
   `SUM(pin_ledger.amount) = SUM(house_seed) + SUM(score_credit) + SUM(champion_bonus)`
   — i.e. every `bet_*` movement nets to 0 across player+house rows. Run this
   before/after each settlement.
3. **Settle win/loss/push:** `settle_market` with a value above / below / equal to
   the line; assert bet `status`, payout pair posted (win/push) or none (loss),
   balances correct, idempotent on re-run.
4. **Archive:** `settle_betting_for_week` credits `score_credit` and settles all
   open markets exactly once; re-running is a no-op.
5. **Cancel:** `cancel_bet` removes all ledger rows for the bet, restores balance
   exactly, and re-opens a market if it was the last bet.
6. **RSVP sync:** RSVP a player out → their markets + bets gone, balance refunded;
   RSVP back in → markets recreated; fully idempotent.
7. `supabase db advisors` clean (FKs indexed, no mutable search_path).
8. Compare the four BettingScreen views against the legacy app for the same data.

---

## Open decisions (resolve before WS1)

1. **House seed / bankroll policy.** Recommend seed `0` + allow negative (audit
   liability, behaves like today). Alternative: seed a finite bankroll and add a
   low-balance guard/top-up flow. *(Schema §4 / accounting table.)*
2. **House vig.** Keep O/U at fair even odds (`2.000`) for Phase 2, or shade to
   e.g. `1.91` as a sink. Recommend `2.000` for parity; revisit with peer/props.
3. **Legacy `pin_ledger` type values.** Keep `bet_placed`/`bet_won`/`bet_push` in
   the CHECK for historical rows, or migrate their `type` to the new names in WS5.
   Recommend keep (historical fidelity) and document.
4. **Settled history.** Migrate legacy `placed_bets`/`bet_lines` into the model
   (WS5) for a unified Settled Bets view, or keep legacy tables read-only for old
   history and only show new-model bets going forward. Recommend migrate (clean
   single-model world, enables the legacy drop).
