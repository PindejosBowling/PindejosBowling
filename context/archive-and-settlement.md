# Archive & Settlement Engine

The weekly **Archive & Advance** is the economy's clock tick — the single most
critical process in the pin economy. One admin tap runs one atomic transaction
that locks the week's scores, derives **every** economic consequence of the week
(pincome, bet settlement, loan garnishment, PvP resolution, the public P&L
event), and opens the next week. Its mirror, **unarchive**, restores the economy
to the exact instant before that transaction ran, making settlement repeatable
and testable.

This file is the as-built reference: read it before changing any part of the
engine, adding a new feature that settles at archive time, or debugging a
settlement discrepancy. Companion docs:

| Doc | Role |
|---|---|
| [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) | Authoritative betting/ledger schema: tables, every RPC, accounting rules, RLS |
| [ARCHIVE.md](../ARCHIVE.md) (repo root) | Original design doc / build handoff for archive–unarchive |
| [SETTLEMENT_ACCEPTANCE.md](../SETTLEMENT_ACCEPTANCE.md) (repo root) | The manual acceptance-test vector checklist for everything below |
| [database-schema.md](database-schema.md) | Schema invariants (incl. the per-game participation convention) |
| `supabase/schema.sql` | Generated current-state DDL — the function bodies themselves |

Key migrations (history only — never read migrations for current state):
`20260611000000_archive_unarchive_week` (atomic archive + snapshot + unarchive),
`20260611120000_settlement_integrity` (sync rework, coupling triggers, backstop,
P&L fix), `20260611130000_per_game_participation` (eager lineup rows,
participation-keyed lines).

---

## 1. The mental model

```
                         ┌─────────────────────────────────────────────┐
  pre-archive            │  archive_week(week_id, force)   [atomic]    │   post-archive
  (integrity layer §5)   │                                             │
                         │  1. guard: admin, week exists,              │
  roster/market coupling │     no active run for this week             │
  triggers keep every    │  2. snapshot pre-image  ──► week_archive_*  │   unarchive_week
  market settleable:     │  3. lock week (is_archived = true)          │   (force)
  bets can only exist on │  4. settle_betting_for_week(week, force)    │   restores the
  (player, game) pairs   │       a. score-credit mint                  │   §2 snapshot +
  that will really bowl  │       b. O/U markets settle                 │   destroys week
                         │       c. moneyline markets settle           │   N+1  (§4)
                         │       d. loans: garnish → interest          │
                         │       e. PvP: close opens, settle locked    │
                         │       f. BACKSTOP: no pending bets survive  │
                         │       g. house weekly P&L feed event        │
                         │  5. create week N+1 (idempotent)            │
                         └─────────────────────────────────────────────┘
```

Three load-bearing properties:

1. **Atomicity.** Everything between the guard and week-N+1 creation is one
   transaction. Any RAISE anywhere (including the backstop) rolls the entire
   archive back — week unlocked, nothing settled, no run row.
2. **Idempotent derivation.** Every settlement step has its own re-run guard
   (§3 table), so `archive → unarchive → archive` (untouched scores) re-derives the identical
   economy from the same scores.
3. **Snapshot reversibility.** Settlement only ever **INSERTs append rows** or
   **UPDATEs a known column set** — both captured in the pre-image snapshot, so
   unarchive can reverse them exactly. *Any new settlement effect must keep this
   property* (§6 recipe).

---

## 2. `archive_week(p_week_id uuid, p_force boolean default false)` → run id

Admin-only `SECURITY DEFINER` RPC. Called from `AdminArchiveModal`
(MatchupsScreen's "Archive & Advance" floating bar) via
`archives.archiveWeek(weekId, force)` in `db.ts`.

**Guards** (before any mutation):
- JWT `app_metadata.role = 'admin'`.
- Week exists.
- **One active run per week**: a `week_archive_runs` row with
  `status='active'` blocks re-archive ("unarchive it first"). Unarchive marks
  the run `reversed`, which re-allows archiving.

**Snapshot capture** — two kinds of rows in `week_archive_snapshot`, anchored to
the new `week_archive_runs` row:

| Kind | Table | Predicate (what's captured) |
|---|---|---|
| `preexisting_id` | `pin_ledger` | `week_id = N` **OR** `bet_id ∈ week-N bets` (payout/refund rows are bet-linked **and**, since migration `…191008_week_stamp_bet_settlement_ledger`, also week-stamped; the OR keeps the predicate belt-and-braces) |
| `preexisting_id` | `loan_ledger`, `pvp_ledger`, `activity_feed_events` | `week_id = N` |
| `preimage_row` | `bet_markets` | week-N markets: `status, result_value, settled_at` |
| `preimage_row` | `bet_selections`, `bet_legs` | week-N markets' rows: `result` |
| `preimage_row` | `bets` | bets with a leg in week N: `status, potential_payout, settled_at` |
| `preimage_row` | `pvp_challenges` | week-N: `status, winner_player_id, result_detail, settled_at, admin_note` |
| `preimage_row` | `pvp_challenge_offers` | week-N challenges' offers: `superseded_at, accepted_at, declined_at` |
| `preimage_row` | `loans` | season's **active** loans: `status, paid_off_at` |

The `preexisting_id` set defines "what existed before settlement" — unarchive
deletes everything matching the predicate that is **not** in the set (i.e.,
exactly what settlement inserted). The `preimage_row` payloads are restored
verbatim. Reversal is snapshot-driven, **not** rule-based, so it cannot
resurrect pre-archive actions (a challenge cancelled by Start Game stays
cancelled — its pre-image was already in that state).

**Then**: lock (`is_archived = true`, `bowled_at = current_date`) → settle (§3)
→ `INSERT weeks (season, N+1) ON CONFLICT DO NOTHING`.

`p_force` is threaded straight into settlement's backstop (§3f).

---

## 3. `settle_betting_for_week(p_week_id uuid, p_force boolean default false)`

Admin-only. The consolidated settlement engine — every step in order, with its
idempotency guard:

| # | Step | What it does | Ledger writes | Re-run guard |
|---|---|---|---|---|
| a | **Score-credit mint** | One `score_credit` per real (non-fill) player per scored game — the economy's **only faucet** (no house counterpart) | `pin_ledger +score` (week-stamped) | `NOT EXISTS score_credit LIKE 'Week N %'` for the season |
| b | **O/U settlement** | Each non-`settled` O/U market: subject's actual score → `settle_market_internal` (selection results → leg back/lay results → `finalize_bets_for_market`). **No score → market `closed`, no result** (its bets fall to step f) | win: `bet_payout` pair; push: `bet_refund` pair; loss: none (stake kept from placement) | markets reach `settled`; `settle_market_internal` returns early on `settled` |
| c | **Moneyline settlement** | Each non-`settled` moneyline whose game has ≥1 score → `settle_moneyline_market_internal` (higher combined team total wins; tie = push; a side with zero scores totals 0). **Zero scores in the game → `closed`** | same as (b) | same as (b) |
| c′ | **Team-prop `total_pins` settlement** | Each non-`settled` `team_prop` market with `params.stat='total_pins'` (`clock='archive'`) whose game has ≥1 score → team pinfall = Σ `scores` of the anchored team (`params.team_id`) for the game (the moneyline aggregation) → `settle_market_internal` (shared over/under grading). **Zero scores in the game → `closed`**. Frame-stat team_props (`clock='lanetalk'`) are skipped — they ride the LaneTalk clock (step f exemption) | same as (b) | same as (b) |
| d | **Loans** (`process_weekly_loans`) | Per active loan: **garnish** = min(week pincome × rate, outstanding) → then **interest** = ceil(remaining × rate) on still-active loans; outstanding ≤ 0 → `status='paid_off'` | garnish: `pin_ledger` pair (`loan_weekly_garnishment`) + `loan_ledger weekly_garnishment`; interest: `loan_ledger weekly_interest` **only** (debt grows, no pin movement) | per-(loan, week) guard on `loan_ledger` types |
| e | **PvP** (`settle_pvp_for_week`) | Close still-open offers/challenges (pending/countered → `cancelled`, nothing was escrowed) then auto-settle every `locked` contract: decisive → winner takes pot; tie → push (refund); missing data (incl. a deleted prop market — FK is SET NULL) → **void** (refund). Publishes `pvp_challenge_settled` feed events | win: `pvp_payout` pair; push/void: `pvp_refund` pairs | challenge `status` checks; settled/pushed/voided return early |
| f | **BACKSTOP** | Count bets with a leg in this week still `pending`. **>0 and not force → RAISE** (whole archive rolls back) naming the unsettleable markets. **Force →** each such bet: legs `result='void'`, bet `status='void'`, stake refunded. **Exemption: bets with ≥1 leg on an unsettled next-day-clock market — `market_type='prop'` (LaneTalk stat bets) OR `market_type='team_prop' AND params.clock='lanetalk'` (frame-stat team props) — are excluded from the count, the listing, AND the force-void** — they settle later via `settle_lanetalk_props_for_week` ([lanetalk-stat-bets.md](lanetalk-stat-bets.md)). `total_pins` team_props (`clock='archive'`) are **NOT** exempt — step c′ settles them in this transaction, so a pending one is a real unsettleable | force: `bet_refund` pair ("Voided at archive — market never settled") | n/a (state-driven) |
| g | **House weekly P&L feed event** | `sportsbook_weekly_house_result` with `house_net` = SUM of house `bet_stake/bet_payout/bet_refund` **via `bet_id` through the week's markets** (`bet_id` is the authoritative link for bet money; payout/refund rows are also week-stamped since `…191008_week_stamp_bet_settlement_ledger`) | none (feed row) | `(season, week, event_type)` existence check |

**Backstop reversibility:** the force-void is an UPDATE on `bets`/`bet_legs`
(pre-images captured in §2) plus bet-linked `bet_refund` INSERTs (caught by
unarchive's `bet_id` branch) — a forced archive unarchives back to the
exact pre-archive state, voided bets returning to `pending`.

**App force flow:** `AdminArchiveModal` arms a red **Force Archive** retry when
the RPC error matches `/remain pending/i`, mirroring the unarchive force flow.

**Post-archive prop settlement composes.** LaneTalk stat props ride a second
settlement clock: their bets stay `pending` through archive (the backstop
exemption above) and settle when the admin runs
`settle_lanetalk_props_for_week` from the import screen — which only UPDATEs
columns the §2 preimage already captured (markets/selections/bets/legs) and
INSERTs bet-linked, week-stamped `pin_ledger` rows, exactly what
`unarchive_week` reverses. Confirm-before-archive composes too. Missing-data
markets are either left pending or (admin choice) DELETEd via the
refund-on-market-death rail (§5c). Full doc:
[lanetalk-stat-bets.md](lanetalk-stat-bets.md).

**What never settles here:** bounties (admin-manual `settle_bounty`/`close_bounty`
only), bet/PvP **stakes** (debited at placement/acceptance), season-close loan
settlement (`settle_loans_for_season_close`, season end), and the manual admin
tools (`cancel_bet`, PvP settle/void, `cancel_loan`, feed suppress).

---

## 4. `unarchive_week(p_week_id uuid, p_force boolean default false)`

Admin-only. Exposed on **ArchivesScreen** (More → Archives) via
`archives.unarchiveWeek(weekId, force)`.

There is deliberately **one mode** (migration `…193032_single_mode_unarchive`,
replacing the original soft/hard split): unarchive reverses the settlement
**and reopens the week**, so afterwards week N is simply *in play again* —
MatchupsScreen shows it, scores are editable, and its **Archive & Advance bar
is the re-archive path**. The removed "soft" mode (settlement reversed but week
still locked) created the only state in the lifecycle with no current week,
which every screen had to special-case and no UI path could re-archive.
Re-deriving identical settlement from untouched scores is guaranteed by the §3
idempotency guards, not by a score lock.

**Guards:** admin; **LIFO** (a later archived week blocks — only the most
recent is reversible); an `active` run must exist; and the **downstream
guard**: unless forced, RAISE if week N+1 holds any scores, bets, PvP, RSVPs,
or ledger rows (the app surfaces the message and arms **Force Unarchive**).

**Reversal, in order:**
1. **Delete what settlement inserted** — `activity_feed_events` and
   `pin_ledger` (week-stamped OR bet-linked branch), `pvp_ledger`,
   `loan_ledger` rows whose id is *not* in the run's `preexisting_id` set.
   **Both the feed and pin deletes exclude `auction_id` rows** — auction
   activity settles on its own pg_cron clock, is week-stamped only so
   accounting/feed group it under the right week, and reverses exclusively
   via `reverse_settled_auction`; see
   [economy/SILENT_AUCTIONS_DB.md](economy/SILENT_AUCTIONS_DB.md) §5.
2. **Restore what settlement updated** — `bet_markets`, `bet_selections`,
   `bets`, `bet_legs`, `pvp_challenges`, `pvp_challenge_offers`, `loans` from
   the `preimage_row` payloads.
3. **Destroy week N+1**: delete its `rsvp` rows (no cascade FK), then the week
   — teams/games/markets cascade and the market-delete refund trigger refunds
   any N+1 bets.
4. **Reopen week N** — `is_archived = false, bowled_at = NULL`.
5. Mark the run `reversed` (re-archive allowed).

Step 1's deletion of settlement-era ledger rows is the **single sanctioned
exception** to the ledger reversal rule (delete-refund only for unsettled
escrow, always by root ref; post-settlement money reverses by appending
offsetting rows) — see the "Reversal rule" subsection in
[supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §4. It is
safe here only because the snapshot guarantees exact restoration.

**Insured bets (Golden Ticket):** the lost branch of `finalize_bets_for_market`
writes a NOT-EXISTS-guarded `bet_insurance_refund` pair (bet-linked +
week-stamped), so it is captured, reversed, and re-derived by the engine
exactly like other bet money. The consumed item does NOT revert on unarchive
(placement consumed it pre-archive); force-voids pay only `bet_refund`.

**Known sharp edges (by design, verify in acceptance vectors U6/I13):**
- Unarchive cannot resurrect anything **erased before** the archive (bets
  cancelled by roster pruning are gone for good — they're not in the snapshot).
- **Post-archive manual writes into week N** (e.g., settling a bounty that pays
  week-N-stamped ledger rows) are *deleted* by the snapshot diff, but
  non-snapshotted parent tables (e.g., `bounty_post.status`) do **not** revert.
  Avoid manual week-N economic actions between archive and a planned unarchive.

---

## 5. The pre-archive integrity layer (why settlement can trust its inputs)

The acceptance criterion: **no sportsbook bet may reach archive time
unsettleable**. Settlement assumes every open market's subject will actually
bowl; this layer makes that true *at the moment of every roster edit* instead of
hoping. The backstop (§3f) is the fail-safe, not the mechanism.

### 5a. Per-game participation (the lineup model)

A `(team_slot, game)` **`scores` row is the lineup marker** — `score` is
nullable; null = "in this game's lineup, not yet scored". Rosters can differ per
game; a player can bowl for two teams the same night (two slots). Rows are
**seeded eagerly**: the `games_participation_seed_ins` trigger inserts null-score
rows for every existing slot of both teams the moment a matchup row is created
(team-gen inserts slots before games, so this covers the whole roster). The
week editor adds/removes rows for per-game lineup changes; the score pad
(`MatchupsScreen.flushScores`) clears a score by upserting **null** — never
deleting the row, because deletion means "out of the lineup". All stats and
settlement queries filter `score IS NOT NULL`, so null rows are inert outside
lineup semantics.

### 5b. Line eligibility ladder (`sync_over_under_markets_for_week`)

An O/U line for (player P, game N) exists iff:

| Week state | P is eligible for game N when… |
|---|---|
| has `games` rows | P has a non-fill **participation row** for game N |
| teams, no games yet | P has a non-fill slot (mid-team-gen transient) |
| no teams | P is RSVP'd `'in'` |

Target game numbers: the **`games` table is authoritative** once a schedule
exists (∪ `p_extra_games`); before teams, existing market numbers ∪ extras,
default {1,2}. The sync **prunes** (deletes) any open/closed O/U market that
fails the ladder or whose game number left the schedule — and never touches
settled/void markets. Moneylines are create-only per `games` row
(`sync_moneyline_markets_for_week`) and die by FK cascade
(`bet_markets.subject_game_id → games ON DELETE CASCADE`).

### 5c. Refunds on market death

`trg_refund_bets_before_market_delete` (BEFORE DELETE on `bet_markets`) deletes
the `pin_ledger` stake pair and the bet row for every bet touching the dying
market — **whole parlays refund**, and any delete path (sync prune, FK cascade,
console) tears down correctly. This is **erasure**, not voiding: balance returns
to pre-bet, no audit row, the placement feed card cascades away. Contrast with
the backstop's archive-time **void** (§3f), which keeps the bet with status
`void` and a visible refund. Erasure = "the premise of the bet ceased to exist";
void = "the bet was valid but ungradeable".

### 5d. The coupling triggers (no client path can forget)

Statement-level AFTER triggers, all funnelling into
`resync_week_markets(week_id, moneyline?)` → the syncs (O/U, **the LaneTalk
stat-prop sync**, and **the team-prop sync** (`sync_team_prop_markets_for_week`
— unconditional, a cheap no-op until games exist; prune-dead → create
game×team×stat → reseed-unbet via `team_prop_seed_line`), plus moneyline when
flagged — see [lanetalk-stat-bets.md](lanetalk-stat-bets.md)). The helper skips
weeks that are archived (settled markets immutable) or already deleted
(mid-cascade).

| Table | Triggers | Week resolution | Notes |
|---|---|---|---|
| `rsvp` | ins/upd/del | `week_id` on row | pre-teams line ownership |
| `team_slots` | ins/upd/del | via `teams` | cascaded deletes resolve to no week → no-op (wipe side is handled by cascades + 5c) |
| `games` | ins/upd/del (+ moneyline sync) | via `teams.team_a_id` | `games_participation_seed_ins` is named to fire **before** the resync (alphabetical trigger order) so the resync sees seeded rows |
| `scores` | ins/del only | via `team_slots → teams` | per-game lineup edits; score-value changes ride the upsert conflict path (no INSERT transition rows) → free |

Client-side sync calls (RsvpScreen, team-gen modal, add/remove game, Clear
Matchups) remain as idempotent belt-and-braces. Clear Matchups *must* keep its
explicit sync: the cascade deletes resolve to no week, and ownership reverts to
RSVP.

**Behavioral consequence to keep in mind:** roster edits cancel affected bets
*immediately and silently* (no confirmation, no toast). A swap-out-and-back
destroys bets even though the final roster is identical. Sequence a week as
RSVPs → teams → then bets.

### 5e. What deliberately does NOT couple

**Moneylines ride through lineup changes.** Per-game adds/removes never touch
the `games` row, so the moneyline and its bets stay live; settlement grades the
team total from whoever actually has scores. (Real-sportsbook semantics; both
sides are flat 2.000 so there is no stale numeric line. The manual escape hatch
is admin `cancel_bet`.)

---

## 6. Recipes

### Adding a new feature that settles at archive time

1. Write the settlement step as a function called from
   `settle_betting_for_week` (order matters — e.g., loans need the pincome mint
   first; prop-derived things need markets settled first).
2. Give it an **idempotency guard** (existence check or status early-return) so
   re-archive after unarchive cannot double-apply.
3. Keep it **snapshot-compatible**: only append-rows INSERTs into a table the
   snapshot captures, and/or UPDATEs to columns the pre-image stores. If you
   touch a *new* table or *new* columns, extend **both** `archive_week`'s
   capture **and** `unarchive_week`'s delete/restore — they are a matched pair.
   Week-stamp (or bet-link) every inserted row so the reversal predicates find it.
4. Feed events: publish via `publish_activity_event` **with `week_id`** so
   unarchive's feed deletion catches them; idempotency-guard the publish.
5. Decide its relationship to the **backstop**: can your feature leave a bet (or
   bet-like obligation) pending past settlement? If yes, either resolve it in
   your step or extend the backstop's predicate.
6. Update: this file, `PIN_ECONOMY_SCHEMA.md` (RPC table + migration history),
   and add vectors to `SETTLEMENT_ACCEPTANCE.md`.

### Debugging a settlement discrepancy

1. Reproduce via the Archives screen: **unarchive** the week (economy
   reversed, week back in play), inspect — and if the input scores were wrong,
   fix them — then re-run Archive & Advance from MatchupsScreen.
2. Read state, never migrations: function bodies in `supabase/schema.sql`; the
   run + snapshot via `week_archive_runs` / `week_archive_snapshot`
   (`supabase db query`, read-only).
3. Useful checks: per-player balance = `SUM(pin_ledger.amount)`; conservation =
   every non-mint type sums to zero per `bet_id`/feature link; the only
   non-conservative type is `score_credit`.
4. A bet "missing" after a roster change is usually 5c **erasure** (working as
   designed), not a settlement bug — check the placement feed card is gone too.
5. If archive RAISEs on the backstop: that's the engine telling you a market
   has no gradable outcome. Fix the lineup/scores (unarchive first if already
   archived), or force-void deliberately.

---

## 7. Function & file map

| Layer | Things |
|---|---|
| DB engine | `archive_week`, `unarchive_week`, `settle_betting_for_week`, `settle_market_internal`, `settle_moneyline_market_internal`, `finalize_bets_for_market`, `process_weekly_loans`, `settle_pvp_for_week`, `settle_pvp_challenge`, `void_pvp_challenge`, `close_open_pvp_challenges`, `publish_activity_event` |
| DB integrity | `sync_over_under_markets_for_week`, `sync_moneyline_markets_for_week`, `sync_team_prop_markets_for_week` (+ `team_prop_seed_line`, `player_raw_avg_score`), `resync_week_markets`, `remove_over_under_markets_for_game`, `refund_bets_before_market_delete`, `prevent_self_tank` (player + team branches), `trg_resync_markets_{rsvp,team_slots,games,scores}`, `trg_seed_participation_games` |
| DB state | `weeks.is_archived/bowled_at`, `week_archive_runs`, `week_archive_snapshot`, `scores` (participation rows) |
| App | `db.ts → archives` (archiveWeek/unarchiveWeek/listArchivedWeeks), `AdminArchiveModal` (archive + force flow), `ArchivesScreen` (unarchive + force flow), `MatchupsScreen` (archive bar, flushScores null-clear, game add/remove), `AdminGenerateTeamsModal`, `useWeekEditor` (per-game lineup edits) |
