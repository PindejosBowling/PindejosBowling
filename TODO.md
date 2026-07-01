# TODO — Team-Aggregate Markets + Ground-Up Specials Rebuild

Handoff doc for finishing this feature. **Full design + rationale:**
`~/.claude/plans/review-the-attached-image-staged-muffin.md` (read it first — this file
is the execution checklist, the plan is the spec).

- **Branch:** `feat/team-prop-markets` (off `main`).
- **Goal:** a first-class `team_prop` market family (team clean frames / strikes / spares /
  total pins, per game) surfaced on the board **and** composable in specials, plus a
  rebuilt specials leg model that bundles any of {player score O/U, player stat props,
  team win, team stat props}. Motivating example: **"Clean Up Crew — me & the boys clean
  10 frames in a game."**
- **⛔ Nothing has touched the database yet.** The four PR1 migration files are written but
  **NOT pushed**. No `supabase db push` has run; the schema snapshot is unchanged.

## Hard constraints (from AGENTS.md — do not violate)
- Migrations only (`supabase/migrations/*.sql` → `supabase db push`). Never direct DDL/DML.
- Every `supabase` command needs `SUPABASE_ACCESS_TOKEN` from `app/.env.local` + `--linked --workdir $(pwd)`.
- Run the rollback-probe suite green **before and after** any economy-RPC push:
  `./supabase/verify/run-all-probes.sh`.
- Regenerate the snapshot as the **last** step of every push: `./supabase/refresh-schema-snapshot.sh`
  (never hand-edit `supabase/schema.sql`).
- Settlement stays snapshot-reversible (only UPDATE captured columns / INSERT bet-linked+week-stamped ledger).

---

## Key architectural decisions (context for every task below)
- **New `market_type='team_prop'`** (not overloading `'prop'`) — because the archive
  **backstop exemption** and the two settlement clocks dispatch on `market_type`.
  `params = { family:'team_aggregate', stat, scope:'game', team_id, team_number, clock }`
  where `clock='archive'` for `total_pins`, `'lanetalk'` for the frame stats.
- Team anchored by `subject_game_id` (persistent within-week, like moneyline) + `params.team_id`;
  `subject_player_id` is NULL. Selections are `over`/`under` sharing a `line`, even money →
  the existing over/under/push engine (`settle_market_internal`) grades them.
- Two clocks: `total_pins` settles **at archive** from `scores` (moneyline aggregation);
  `clean_frames/strikes/spares` settle **next-day** via `settle_lanetalk_props_for_week`
  (summed across the team roster's official LaneTalk imports).
- Specials resolution stays **client-side**; `custom_lines` needs **no schema change** (legs is jsonb).

---

## ✅ DONE — PR1 migration files written (NOT pushed)

All four under `supabase/migrations/`, `CREATE OR REPLACE` style:

1. `20260701110000_team_prop_market_type.sql`
   - Extends `bet_markets_market_type_check` → `over_under|moneyline|prop|team_prop`.
   - Relaxes `settle_market_internal` guard → `IN ('over_under','prop','team_prop')` (body otherwise unchanged).
2. `20260701120000_team_prop_sync.sql`
   - `player_raw_avg_score(player, season)` — raw mean score (season→lifetime→league), no rounding.
   - `team_prop_seed_line(team_id, stat, season)` — Σ roster per-game avg, floored to half-point once, clamped.
   - `sync_team_prop_markets_for_week(week)` — prune-dead → create (game×team×stat) → reseed-unbet. Idempotent.
   - Wires `sync_team_prop_markets_for_week` into `resync_week_markets` **unconditionally** (no-ops until games exist).
3. `20260701130000_team_prop_total_pins_settlement.sql`
   - Adds the `total_pins` archive-clock loop to `settle_betting_for_week` (after the moneyline loop).
   - **Widens the backstop exemption** in all 3 subqueries + the abort-listing filter to:
     `market_type='prop' OR (market_type='team_prop' AND params->>'clock'='lanetalk')`.
   - ⚠ **Riskiest change in the whole feature.** Verify with probes on BOTH clocks (see below).
4. `20260701140000_team_prop_anti_tank.sql`
   - Extends `prevent_self_tank` with a team branch: blocks under-back / over-lay on a `team_prop`
     whose `params.team_id` is a team the bettor is rostered on (non-fill). (The in-body check in
     `place_house_bet` was intentionally NOT modified — the trigger is the authoritative backstop;
     the app provides the friendly pre-check. Optional to add later for a nicer error message.)

---

## ☐ OUTSTANDING

### PR1 — apply migrations + finish the board
1. **Baseline probes:** `./supabase/verify/run-all-probes.sh` (confirm green before changing anything).
2. **Push:** `supabase db push --linked --workdir $(pwd)` (token from `app/.env.local`). Applies the 4 files.
3. **Extend probes** ([context/db-verification.md](context/db-verification.md)):
   - `supabase/verify/probe-bets-bounty.sql`: add a `total_pins` team_prop fixture (2 team_slots w/ scores),
     place a bet, run `settle_betting_for_week(force)` → assert it **settles at archive** (not exempted),
     correct won/lost grading vs line, net-zero double-entry, back-link counts. Also assert a
     `clock='lanetalk'` team_prop bet **survives the sweep as pending** (exemption works). Assert an
     own-team `under` bet **RAISEs** (anti-tank).
   - `probe-archive-roundtrip` (the archive/unarchive probe — locate in `supabase/verify/`): add a settled
     `total_pins` bet; archive → unarchive → assert market/sel/leg/bet/ledger restored.
   - Re-run `./supabase/verify/run-all-probes.sh` → must be green.
4. **Refresh snapshot:** `./supabase/refresh-schema-snapshot.sh` (also runs the anon-posture assert).
5. **App board wiring** (all in `app/src`, no DB):
   - `utils/supabase/db.ts`: add `betMarkets.listActiveTeamPropByWeek(weekId)` — copy `listActivePropByWeek`
     ([db.ts:422](app/src/utils/supabase/db.ts#L422)) but `.eq('market_type','team_prop')`. (`MARKET_GRAPH`
     embed resolves the player subject to null, like moneyline — fine.)
   - `hooks/usePinsinoData.ts`:
     - Fetch the new query and merge into `openLines` alongside O/U/moneyline/prop (find where
       `listActiveOUByWeek`/`listActiveMoneylineByWeek`/`listActivePropByWeek` are awaited).
     - `normalizeMarket` is generic; confirm it maps team_prop (subject = title/team; `statKey` from
       `params.stat`; `line` from selections). Give the row a subject label "Team N" (from `params.team_number`)
       or "Your Team" when the viewer is on `params.team_id` (use `weekTeams.teamByPlayer`).
     - `lineCategory`: add a `team_prop` case → a new **"Team Totals"** section per game (its own `sortOrder`).
     - `selectionBetsAgainstSubject`: add `if (marketType === 'team_prop') return selectionKey === 'under'`
       — this auto-applies the under-hide + anti-tank policies on the board.
     - Client anti-tank: extend `isSelfTank`/`customLineSelfTank` (in `SportsbookScreen.tsx` /
       `usePinsinoData.ts`) so a team_prop `under` is blocked when the viewer is on that team
       (roster from `weekTeams`). The DB trigger is the backstop; this is the friendly pre-check.
   - `selectionButtonLabel` / `betLineSuffix`: make sure a team_prop reads sensibly, e.g.
     `9.5+ CLEAN FRAMES` / `OVER 9.5 CLEAN FRAMES` (extend the stat-label mapping used for LaneTalk props).
   - **Under-hide:** `isSelectionHiddenInUI` in `SportsbookScreen.tsx` already hides `over_under`+`prop`
     unders; add `team_prop` so team unders are hidden too.
6. **Docs:** update `supabase/PIN_ECONOMY_SCHEMA.md` (§3 map + §7), `context/archive-and-settlement.md`
   (total_pins step + widened exemption + function map), `context/betting-line-board.md` (team_prop rendering).
7. **Verify app** on Expo (`cd app && npx expo start`): a **Team Totals** section per game (unders hidden,
   own-team under blocked with the anti-tank toast); a team-total pick places; placed bets render correctly.
8. **PR** via `/pr` (target `main`).

### PR2 — frame-stat team props on the LaneTalk clock
- Migration `…_team_prop_lanetalk_settlement.sql`: add a parallel loop to `settle_lanetalk_props_for_week`
  ([schema.sql:5557](supabase/schema.sql#L5557)) for `market_type='team_prop' AND params->>'clock'='lanetalk'`.
  Actual value = `Σ` of `strikes`/`spares`/`strikes+spares` across the team roster's `official`
  `lanetalk_game_imports` for that game. **Coverage guard** (mirror the night-coverage rule at
  [schema.sql:5632](supabase/schema.sql#L5632)): settle only when every rostered scorer for the game has
  an official import; else leave pending / delete-refund under `p_void_missing`. Then `settle_market_internal`.
- New `supabase/verify/probe-team-props.sql` (register in `run-all-probes.sh`): partial roster → `left_pending`;
  full roster → settled with the Σ value; `void_missing` delete-refund. Push, probe green, refresh snapshot.
- Docs: `context/lanetalk-stat-bets.md` (team frame-stat loop + coverage rule).

### PR3 — generalized specials leg model + admin builder (app-only + one data migration)
- `hooks/usePinsinoData.ts`: v2 `CustomLegSpec` typed union — `over_under` | `stat_prop` (stat+scope) |
  `moneyline` | `team_prop` (stat), each with a **player anchor** (`fixed_player`|`self`) or **team anchor**
  (`self_team`|`team_of_player`), `game_number: number|null`, `pick`. No per-leg line (binds to the generated
  market's seeded line) — admin-authored thresholds are a v1 **non-goal** (revisit if "exactly 10" must differ
  from the seeded line).
- Extend `resolveCustomLine` ([usePinsinoData.ts:441](app/src/hooks/usePinsinoData.ts#L441)) to resolve
  `stat_prop` (player's prop market by stat/scope/game) and `team_prop` (anchored team's team_prop market by
  stat/game). **Normalize-on-read**: accept BOTH old `{kind,player_id,…}` and new `{kind,anchor,…}` shapes.
- Data migration `…_custom_lines_legs_v2.sql`: rewrite existing `legs` jsonb to the anchor union
  (`player_id!=null`→`fixed_player`/`team_of_player`; null→`self`/`self_team`). Non-load-bearing thanks to the
  dual-shape resolver — cleanup only. (No `custom_lines` schema change.)
- Rebuild `components/betting/CustomLineCreateModal.tsx`: market/stat picker + anchor picker, reusing the
  existing game picker (G1/G2/BOTH/EACH), scope, and overlap validation.
- Placement/branding unchanged (special = a parlay tagged via `place_house_bet(…, p_custom_line_id)`).
- Docs: `context/betting-line-board.md` custom-lines section (v2 leg union).

---

## Gotchas / risk flags
- **Backstop predicate (PR1 m3)** is the single most dangerous edit. A mistake either strands `total_pins`
  bets past archive (if wrongly exempted) or makes archive RAISE on deferred frame-stat bets (if not exempted).
  Both clocks MUST be probe-asserted before merge.
- **Seed vs settlement symmetry** — the `total_pins` seeded line uses roster average scores; settlement uses
  actual `Σ scores`. Keep `team_prop_seed_line` the single definition; a rounding mismatch skews fairness.
- **Coupling** — team markets only generate once games exist and a trigger fires. On the live DB, existing
  weeks won't retroactively get team_prop markets until a resync trigger runs (games change) or you manually
  `PERFORM sync_team_prop_markets_for_week(<week>)` via a one-off migration if needed for the current week.
- **Parlay fair-odds caveat** — team stats within a night are correlated (see PIN_ECONOMY_SCHEMA §8); team_prop
  legs in specials inherit the same underpricing risk. Product concern, not a blocker.
