# Archive & Settlement Engine

The weekly clock tick is split into **two** admin actions (the advance/settle
split — migrations `…190000_advance_settle_split` + `…200000_reversal_redesign`):

- **Advance** (`advance_week`, bowl-night): locks the week's scores into the
  standings, snapshots the fill preimages, and opens the next week. **Moves no
  money.** Introduces the **LOCKED-BUT-UNSETTLED** week state.
- **Settle** (`settle_week`, next-day): one atomic/idempotent/snapshot-reversible
  transaction that derives **every** economic consequence (pincome, bet
  settlement incl. LaneTalk props, loan garnishment, PvP resolution, the unified
  public House P/L), then stamps `settled_at`.

The split exists so the LaneTalk frame import — which lands the day *after* the
bowl night — settles on the same clock as everything else, instead of the old
"second clock." Two reversal mirrors: **`unsettle_week`** re-derives money on a
still-locked week (settlement was wrong / newer imports), and **`unarchive_week`**
fully reverses both phases and reopens the week for score edits.

`archive_week` still exists as a **deprecated one-tap shim** = `advance_week` +
`settle_week`, kept for the probe suite and any un-migrated caller.

This file is the as-built reference: read it before changing any part of the
engine, adding a new feature that settles at settle time, or debugging a
settlement discrepancy. Companion docs:

| Doc | Role |
|---|---|
| [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) | Authoritative betting/ledger schema: tables, every RPC, accounting rules, RLS |
| [ARCHIVE.md](../ARCHIVE.md) (repo root) | Original design doc / build handoff for archive–unarchive |
| [SETTLEMENT_ACCEPTANCE.md](../SETTLEMENT_ACCEPTANCE.md) (repo root) | The manual acceptance-test vector checklist for everything below |
| [database-schema.md](database-schema.md) | Schema invariants (incl. the per-game participation convention) |
| `supabase/schema.sql` | Generated current-state DDL — the function bodies themselves |

Key migrations (history only — never read migrations for current state):
`20260611000000_archive_unarchive_week` (original atomic archive + snapshot),
`20260611120000_settlement_integrity` (sync rework, coupling triggers, backstop),
`20260611130000_per_game_participation` (eager lineup rows), and the split:
`…170000_weeks_derive_bowled_at` (scheduled `bowled_at`),
`…180000_settlement_scaffolding` (`settled_at`, snapshot `phase`, placement
guard), `…190000_advance_settle_split` (`advance_week` / `settle_week` /
`preview_settle_week` + shims), `…200000_reversal_redesign` (`unsettle_week` +
phase-branched `unarchive_week`).

---

## 1. The mental model

```
  pre-advance          ┌──────────── advance_week(week, fill_scores) ─────────────┐  ADVANCED
  (integrity §5)       │  1. guard: admin, week exists, no active run             │  (locked,
                       │  2. snapshot fill preimages  ──► week_archive_* phase=adv │   unsettled)
  coupling triggers    │  3. materialize fills + coverage guard                   │
  keep every market    │  4. lock week (is_archived = true)   [NO bowled_at write]│
  settleable           │  5. create week N+1 (bowled_at from creation trigger)    │
                       └──────────────────────────────────────────────────────────┘
                                              │  (next day: LaneTalk import lands)
  ADVANCED             ┌──────────── settle_week(week, void_missing, force) ───────┐  SETTLED
  (locked, unsettled)  │  1. guard: admin, is_archived, active run                 │  (settled_at
                       │  2. money snapshot ──► week_archive_* phase=settle (once) │   set)
                       │  3. a score-credit mint   b O/U   c moneyline             │
                       │     c′ team_prop total_pins   c″ LaneTalk player+team     │
                       │     d loans   e PvP   f BACKSTOP (narrowed)               │
                       │     g UNIFIED House weekly P/L (UPSERT)                   │
                       │  4. settled_at = now()                                    │
                       └──────────────────────────────────────────────────────────┘

  Reversal:  unsettle_week → back to ADVANCED (money reversed, scores stay frozen)
             unarchive_week → back to pre-advance (both phases reversed, N+1 gone,
                              week reopened, bowled_at PRESERVED)                  (§4)
```

Load-bearing properties:

1. **Two clocks, each atomic.** Advance and settle are each one transaction; a
   RAISE anywhere (incl. the settle backstop) rolls that whole step back.
2. **Money snapshot at SETTLE, not advance.** `settle_week` captures the money
   preimages/preexisting-ids (`phase='settle'`) the moment it runs — so a bet or
   import landing between advance and settle can't corrupt reversal. New stakes
   on a locked week are blocked at placement (`place_house_bet` `is_archived`
   guard).
3. **Idempotent derivation.** Every settle step has its own re-run guard (§3), so
   re-settle (late imports) and `advance → settle → unsettle → settle` re-derive
   the identical economy. The money snapshot is captured **once per run** (skipped
   on re-settle) so it always pins the pre-first-settle state.
4. **Snapshot reversibility.** Settlement only **INSERTs append rows** or
   **UPDATEs a captured column set**; `phase` tags which reversal (unsettle /
   unarchive) owns each snapshot row. *Any new settlement effect must keep this
   property* (§6 recipe).

---

## 2. `advance_week(p_week_id uuid, p_force boolean default false, p_fill_scores jsonb default null)` → run id

Admin-only `SECURITY DEFINER` RPC. Called from `AdminArchiveModal`
(MatchupsScreen's "Advance Week" floating bar) via
`archives.advanceWeek(weekId, force, fillScores)` in `db.ts`. **Bowl-night: locks
the week, moves no money.**

**Guards:** JWT `app_metadata.role = 'admin'`; week exists; **one active run per
week** (a `week_archive_runs` row with `status='active'` blocks re-advance;
unarchive marks it `reversed`, re-allowing advance).

**Fill snapshot only** — `advance_week` captures a **single** kind of snapshot row
(`phase='advance'`): the `p_fill_scores`-listed unscored fill rows' `score`
preimage (always NULL at capture). The money preimages/preexisting-ids are
**not** captured here — they move to `settle_week` (the correctness point, §3).

**Fill materialization**: `p_fill_scores` (`[{team_slot_id, game_id, score}, ...]`)
carries the value each **unscored fill** slot displayed on the live matchup
screen (`Math.round(effectiveAvg)`, computed by `computeUnscoredFillScores` in
`useMatchupsData.ts`). The RPC validates every row (belongs to week N via
`team_slots → teams`, `is_fill = true`, `score` currently NULL, positive integer,
no duplicate pairs — any violation RAISEs, aborting the advance), snapshots the
preimages, and UPDATEs the scores **before the lock**, so archived standings and
settlement grade on the same totals the screen showed. Stored scores (admin-typed
fill values included) are the source of truth and never touched; fills mint no
pincome and never feed player markets/averages.

**Coverage guard** (migration `…160000_archive_fill_coverage_guard`): after
materialization, RAISEs if any unscored fill row remains, so an outdated client
(or any caller omitting `p_fill_scores`) cannot silently advance without the
fill's contribution. Exemptions: a never-bowled week, and a league with zero
archived counted scores (league-average proxy = 0).

**Then**: lock (`is_archived = true` — **no `bowled_at` write**; `bowled_at` is
the immutable scheduled bowl-Monday, set at week creation by the
`weeks_derive_bowled_at` trigger) → `INSERT weeks (season, N+1) ON CONFLICT DO
NOTHING` (the trigger derives N+1's `bowled_at`).

`p_force` is accepted for shim compatibility but advance has no backstop, so it
is inert here.

---

## 3. `settle_week(p_week_id uuid, p_void_missing boolean default false, p_force boolean default false)` → jsonb

Admin-only. **Next-day: derives ALL money for an advanced (locked) week**, in one
atomic transaction. Called from `AdminSettleModal` (LaneTalk import screen) via
`archives.settleWeek(...)`. Returns `{settled, voided, left_pending, house_net}`
for the toast.

**Guards:** admin; week exists; `is_archived=true` (must be advanced first); an
`active` run exists.

**Money snapshot capture** (`phase='settle'`, **once per run** — skipped if the
run already has `phase='settle'` rows). Capturing at settle, not advance, is the
central correctness point: a bet/import landing between advance and settle can't
corrupt reversal. Two kinds, anchored to the run:

| Kind | Table | Predicate |
|---|---|---|
| `preexisting_id` | `pin_ledger` | `week_id = N` **OR** `bet_id ∈ week-N bets` |
| `preexisting_id` | `loan_ledger`, `pvp_ledger`, `activity_feed_events` | `week_id = N` |
| `preimage_row` | `bet_markets` | `status, result_value, settled_at` |
| `preimage_row` | `bet_selections`, `bet_legs` | `result` |
| `preimage_row` | `bets` | `status, potential_payout, settled_at` |
| `preimage_row` | `pvp_challenges` | `status, winner_player_id, result_detail, settled_at, admin_note` |
| `preimage_row` | `pvp_challenge_offers` | `superseded_at, accepted_at, declined_at` |
| `preimage_row` | `loans` | season's **active** loans: `status, paid_off_at` |

**Ordered settlement steps** (each with its idempotency guard):

| # | Step | What it does | Ledger writes | Re-run guard |
|---|---|---|---|---|
| a | **Score-credit mint** | One `score_credit` per real (non-fill) player per scored game — the economy's **only faucet** | `pin_ledger +score` (week-stamped) | `NOT EXISTS score_credit` for the week |
| b | **O/U settlement** | Subject's game score (night markets: Σ week's non-fill scores) → `settle_market_internal`. **No score → `closed`** (bets fall to step f) | win `bet_payout`; push `bet_refund`; loss none | market reaches `settled` |
| c | **Moneyline** | game with ≥1 score → `settle_moneyline_market_internal`; **zero → `closed`** | same as (b) | same |
| c′ | **team_prop `total_pins`** (`clock='archive'`) | game/night team pinfall → `settle_market_internal`; **zero → `closed`** | same as (b) | same |
| c″ | **LaneTalk player + team props** (FOLDED IN) | Settles `market_type='prop'`/`team_prop clock='lanetalk'` off official `lanetalk_game_imports`. Gradable value → settle; else `p_void_missing` → delete-refund (§5c rail); else left pending. Increments the returned `settled`/`voided`/`left_pending` | same as (b) | market `settled` |
| d | **Loans** (`process_weekly_loans`) | garnish = min(week pincome × rate, outstanding) → interest on still-active loans | garnish pair + `loan_ledger`; interest `loan_ledger` only | per-(loan, week) guard |
| e | **PvP** (`settle_pvp_for_week`) | close open offers, auto-settle `locked` contracts (decisive/push/void) | `pvp_payout`/`pvp_refund` pairs | challenge status |
| f | **BACKSTOP (narrowed)** | Count still-`pending` bets. **>0 and not force → RAISE**; force → void+refund. **Exemption gated on `NOT p_void_missing`**: a bet is exempt only if it has a leg on a still-unsettled LaneTalk market (genuinely lacking data). With `p_void_missing=true`, c″ already delete-refunded those, so nothing is exempt | force: `bet_refund` pair | state-driven |
| g | **UNIFIED House weekly P/L** | `sportsbook_weekly_house_result`, `house_net` = `SUM(pin_ledger.amount) WHERE is_house AND week_id=N AND auction_id IS NULL AND bounty_post_id IS NULL` — bets + PvP + loan garnishment, **excluding** bounty/auction (own feed cards + own clocks). **UPSERT** (re-settle refreshes the value) | none (feed row) | UPSERT, not skip |

**Then**: `UPDATE weeks SET settled_at = now() WHERE settled_at IS NULL` (preserves
the first-settle time across re-settles).

**Re-settle for late imports = call `settle_week` again** (`p_void_missing=false`):
additive via the per-step guards + the House P/L UPSERT; the money snapshot is
NOT re-captured (guard), so reversal still targets the pre-first-settle state. No
unsettle needed for the "more data arrived" case.

**What never settles here:** bounties (admin-manual only), bet/PvP **stakes**
(debited at placement/acceptance), season-close loan settlement (season end), and
the manual admin tools (`cancel_bet`, PvP settle/void, `cancel_loan`).

**Deprecated shims** (kept for the probe suite / un-migrated callers):
`archive_week` = `advance_week` + `settle_week(week, false, force)`;
`settle_lanetalk_props_for_week(week, void)` = `settle_week(week, void, false)`
returning the old `{settled, voided, left_pending}` TABLE. `settle_betting_for_week`
is left **unchanged** (still called directly by `probe-bets-bounty`); its logic is
inlined into `settle_week`, not called from it.

---

## 4. Reversal — two distinct repair paths

The `phase` column on `week_archive_snapshot` (`'advance'` = fill preimages,
`'settle'` = money preimages/preexisting-ids) is what lets each path reverse the
right slice. **Choose by intent:**

- **`unsettle_week`** = "re-derive money from the *same* frozen scores / newer
  imports" — the week stays LOCKED, scores untouched.
- **`unarchive_week`** = "reopen to edit scores" — full reversal, week back in
  play. LaneTalk imports can change between unsettle/re-settle *without*
  unarchiving (imports write `lanetalk_game_imports`, not the frozen `scores`).

### 4a. `unsettle_week(p_week_id uuid)` → reverse money only

Admin-only. Guards: `is_archived=true` **and** `settled_at IS NOT NULL`; an
`active` run. Operates on **`phase='settle'` rows only**:
1. **Delete what settlement inserted** — `activity_feed_events`, `pin_ledger`
   (week-stamped OR bet-linked), `pvp_ledger`, `loan_ledger` whose id is *not* in
   the run's `phase='settle'` `preexisting_id` set. Both feed + pin deletes
   **exclude `auction_id`** (auction activity reverses only via
   `reverse_settled_auction`; see
   [economy/SILENT_AUCTIONS_DB.md](economy/SILENT_AUCTIONS_DB.md) §5).
2. **Restore** the `phase='settle'` `preimage_row` payloads (markets/selections/
   bets/legs/pvp/loans). **NOT the fill `scores`** — those are `phase='advance'`
   and the week stays locked, so the frozen scores remain for re-settle to grade.
3. `settled_at = NULL` (back to ADVANCED); the run stays `active`.
4. Delete the run's `phase='settle'` snapshot rows so the next `settle_week`
   re-captures a clean pre-settle image.

A following `settle_week` re-derives. The primary "late import arrived" path,
though, is just `settle_week` again (§3, additive) — `unsettle_week` is for
"settlement was wrong."

### 4b. `unarchive_week(p_week_id uuid, p_force boolean default false)` → full reversal

Admin-only. Exposed on **ArchivesScreen** (More → Archives). Guards: admin;
**LIFO** (a later archived week blocks); `active` run; **downstream guard** (unless
forced, RAISE if week N+1 holds scores/bets/PvP/RSVPs/ledger — app arms **Force
Unarchive**).

**Reversal, in order:**
1. **Money reversal** — only if `settled_at IS NOT NULL`, run the §4a delete +
   restore on the `phase='settle'` rows. **Gated on `settled_at`**: on an
   advanced-but-unsettled week there are no `phase='settle'` preexisting rows, so
   an ungated `NOT IN (empty set)` delete would wipe every pre-existing ledger row.
2. **Advance reversal** (both states) — restore the `phase='advance'` fill
   `scores` preimages (back to NULL, unscored again).
3. **Destroy week N+1**: delete its `rsvp` rows (no cascade FK), then the week —
   teams/games/markets cascade and the market-delete refund trigger refunds N+1
   bets.
4. **Reopen week N** — `is_archived = false, settled_at = NULL`. **`bowled_at` is
   PRESERVED** (immutable scheduled date — dropping the old `bowled_at=NULL` reset
   is what keeps re-import binding after an unarchive).
5. Mark the run `reversed` (re-advance allowed).

Step 1's deletion of settlement-era ledger rows is the **single sanctioned
exception** to the ledger reversal rule — see the "Reversal rule" subsection in
[supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §4. Safe only
because the snapshot guarantees exact restoration.

**Legacy weeks:** pre-split monolithic runs work because
`…180000_settlement_scaffolding` labelled their money rows `phase='settle'` and
their fill `scores` `phase='advance'`, and backfilled `settled_at` for every
already-archived week — so `unarchive_week` takes the settled branch and reverses
them exactly as the old single-mode unarchive did.

**Insured bets (Golden Ticket):** the lost branch of `finalize_bets_for_market`
writes a NOT-EXISTS-guarded `bet_insurance_refund` pair (bet-linked +
week-stamped), captured/reversed/re-derived like other bet money.

**Known sharp edges (by design):**
- Reversal cannot resurrect anything **erased before** advance (bets cancelled by
  roster pruning are gone — not in the snapshot).
- **Manual writes into week N between settle and a planned unarchive** (e.g.,
  settling a bounty that pays week-N-stamped rows) are *deleted* by the snapshot
  diff, but non-snapshotted parent tables (`bounty_post.status`) do **not** revert.

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

**Fill slots at archive time:** an unscored **fill** row (null score on an
`is_fill` slot) is not left null forever — the live screen displays its
league-average estimate, and `archive_week` stamps that displayed value into
the row via `p_fill_scores` (§2) so the archived record and settlement match
the screen. Unarchive reverts it to null. An admin-typed fill score is a
normal stored score and rides through untouched.

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
game×team×stat **plus one night market per team×stat** (`subject_game_id`
null, pruned by week-team membership / empty schedule rather than the games
cascade) → reseed-unbet via `team_prop_seed_line(…, n_games)`), plus moneyline
when flagged — see [lanetalk-stat-bets.md](lanetalk-stat-bets.md)). The helper skips
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

### Adding a new feature that settles at settle time

1. Write the settlement step as a block in `settle_week` (order matters — loans
   need the pincome mint first; prop-derived things need markets settled first).
2. Give it an **idempotency guard** (existence check or status early-return) so
   re-settle (late imports) and settle-after-unsettle cannot double-apply.
3. Keep it **snapshot-compatible**: only append-rows INSERTs into a table
   `settle_week`'s money snapshot captures, and/or UPDATEs to columns a
   `phase='settle'` pre-image stores. New table / new columns → extend **all
   three**: `settle_week`'s capture, and the `phase='settle'` delete/restore in
   **both** `unsettle_week` and `unarchive_week`. Week-stamp (or bet-link) every
   inserted row so the reversal predicates find it.
4. Feed events: publish via `publish_activity_event` **with `week_id`** so the
   reversal feed deletion catches them; idempotency-guard the publish.
5. Decide its relationship to the **backstop** (§3f): can your feature leave a
   bet-like obligation pending past settlement? If yes, resolve it in your step or
   extend the backstop's exemption predicate.
6. Update: this file, `PIN_ECONOMY_SCHEMA.md` (RPC table + migration history),
   `SETTLEMENT_ACCEPTANCE.md`, and add a `probe-settle-lifecycle` vector.

### Debugging a settlement discrepancy

1. Reproduce: **`unsettle_week`** (money reversed, week stays locked, scores
   frozen) then re-run **Settle Week** — for a *money* discrepancy off the same
   scores. For a *score* problem, **`unarchive_week`** (reopen), fix scores, then
   Advance + Settle.
2. Read state, never migrations: function bodies in `supabase/schema.sql`; the
   run + snapshot (incl. `phase`) via `week_archive_runs` / `week_archive_snapshot`
   (`supabase db query`, read-only).
3. Useful checks: per-player balance = `SUM(pin_ledger.amount)`; conservation =
   every non-mint type sums to zero per `bet_id`/feature link; the only
   non-conservative type is `score_credit`. Feed-card `house_net` = the §3g
   predicate (`is_house AND week_id=N AND auction_id IS NULL AND bounty_post_id IS
   NULL`) — matches the admin Accounting per-week net (`useHousePinsinoData`, same
   exclusion).
4. A bet "missing" after a roster change is usually §5c **erasure** (by design),
   not a bug — check the placement feed card is gone too.
5. If `settle_week` RAISEs on the backstop: a market has no gradable outcome. Fix
   the lineup/scores (`unarchive_week` first), or Settle + Void Missing.

---

## 7. Function & file map

| Layer | Things |
|---|---|
| DB engine | `advance_week`, `settle_week`, `preview_settle_week`, `unsettle_week`, `unarchive_week`, `archive_week`/`settle_lanetalk_props_for_week` (deprecated shims), `settle_betting_for_week` (legacy, probe-only), `settle_market_internal`, `settle_moneyline_market_internal`, `finalize_bets_for_market`, `process_weekly_loans`, `settle_pvp_for_week`, `settle_pvp_challenge`, `void_pvp_challenge`, `close_open_pvp_challenges`, `publish_activity_event` |
| DB integrity | `weeks_derive_bowled_at`, `sync_over_under_markets_for_week`, `sync_moneyline_markets_for_week`, `sync_team_prop_markets_for_week` (+ `team_prop_seed_line`, `player_raw_avg_score`), `resync_week_markets`, `remove_over_under_markets_for_game`, `refund_bets_before_market_delete`, `prevent_self_tank`, `trg_resync_markets_{rsvp,team_slots,games,scores}`, `trg_seed_participation_games`, `place_house_bet` (is_archived placement guard) |
| DB state | `weeks.is_archived/settled_at/bowled_at`, `week_archive_runs`, `week_archive_snapshot` (`phase`), `scores` (participation rows) |
| App | `db.ts → archives` (advanceWeek/settleWeek/previewSettleWeek/unsettleWeek/unarchiveWeek/listArchivedWeeks; archiveWeek deprecated shim), `AdminArchiveModal` ("Advance Week"), `AdminSettleModal` (preview + Settle Available / Settle + Void Missing), `LanetalkImportAdminScreen` (Settle gate), `ArchivesScreen` (unarchive + force), `MatchupsScreen` (advance bar, flushScores null-clear, game add/remove), `useHousePinsinoData` (unified P/L), `useLanetalkImportAdmin` (archivedSettleState) |
