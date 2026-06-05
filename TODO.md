# TODO — Season 1 records bug (W/L wrong in player stats & standings)

**Status:** Root cause identified. Fix drafted but **NOT applied**. Needs team review before running any migration.

---

## Symptom

- Season 1 **averages / pin totals** display correctly.
- Season 1 **win/loss records** are wrong in PlayerDetail and Standings (when filtered to Season 1).
- Example: Garrett Blinkhorn shows **4-3** in Season 1; per the Season 1 Summary CSV it should be **7-5**.

## Root cause — corrupted data, not a code bug

The win/loss compute (`computeStandingsFromSupabase` in
[useStandingsData.ts](app/src/hooks/useStandingsData.ts) and `computePlayerProfile` /
`computeWeekRows` in [usePlayerDetailData.ts](app/src/hooks/usePlayerDetailData.ts))
determines a game result by:

1. looking up the opponent team for `scoreRow.game_id | myTeamId` in a schedule map built
   from the `games` table, then
2. comparing the two teams' summed totals on that same `game_id`.

If a score's `game_id` points at a game whose matchup (`team_a_id`/`team_b_id`) does **not**
include that score's own team, the opponent lookup returns `undefined` and **the game is
skipped entirely** (`if (oppTeam === undefined) continue`). Skipped games drop out of the
record but **not** out of the average (the player's own scores still sum), which exactly
matches the reported symptom.

### What's actually wrong in the data

For Season 1 weeks 1–5 and week 8 (playoffs), **all teams' scores for a given game number
were collapsed onto a single matchup row** instead of being split across that round's two
matchups. The correct matchup rows exist in `games` but sit empty (0 scores).

Concrete example — Season 1, Week 1 (`games` rows):

| game_id (abbrev) | game_number | matchup | # scores attached |
|---|---|---|---|
| `e2c94dfe` | 1 | T1 vs T2 | **0** (correct row, empty) |
| `57d9b7bc` | 1 | T3 vs T4 | 12 (ALL four teams' game-1 scores) |
| `8f345688` | 2 | T1 vs T4 | **0** (correct row, empty) |
| `4dbac911` | 2 | T2 vs T3 | 12 (ALL four teams' game-2 scores) |

So Garrett (Team 1) game-1 score is attached to the `T3 vs T4` row. The app looks up
Team 1's opponent on that row, finds Team 1 isn't in the matchup, and skips the game →
record undercounts. Same mechanism for every Team 1 / Team 2 game-1 and Team 1 / Team 4
game-2 score in weeks 1–5, and Team 1 / Team 2 game-1 in the playoffs.

### Exact scope (verified by query)

| Season | Weeks affected | Mismatched scores |
|---|---|---|
| 1 | weeks 1–5 (12 each), week 8 (6) | **66 total** |
| 1 | weeks 6–7 | 0 (single matchup per round — nothing to mis-route) |
| 2 | all weeks | **0 — clean** (entered through the app correctly) |

- No cross-week corruption anywhere (every score's slot-week matches its game-week).
- `teams` and `team_slots` are clean: exactly one team row per `(week, team_number)`, 3 slots each.
- All 66 mismatched scores map to **exactly one** correct target game (0 unresolvable).
- The duplicate-looking "8-score" T1vT2 game rows seen while investigating are **Season 2**
  games (separate season, also archived) — not part of this bug.

---

## Proposed fix (DRAFT — do not apply yet)

Re-point each mismatched Season 1 score to the game in the **same week** with the **same
game_number** whose matchup includes the score's own team. The correct target rows already
exist (the empty ones), so this is a pure `scores.game_id` re-link — no inserts, no deletes,
no score-value changes, averages unaffected.

This must go in a migration file (`supabase/migrations/…`) per AGENTS.md rule #12, then be
applied with `supabase db push`. Draft SQL:

```sql
-- Re-link mismatched Season 1 scores to their correct matchup game row.
UPDATE scores sc
SET game_id = correctg.id
FROM team_slots ts
JOIN teams tm        ON tm.id = ts.team_id
JOIN games gcur      ON gcur.id = sc.game_id
JOIN games correctg  ON correctg.game_number = gcur.game_number
                    AND (correctg.team_a_id = ts.team_id OR correctg.team_b_id = ts.team_id)
JOIN teams cca       ON cca.id = correctg.team_a_id AND cca.week_id = tm.week_id
WHERE sc.team_slot_id = ts.id
  -- only rows whose current game does NOT contain the score's own team
  AND ts.team_id <> gcur.team_a_id
  AND (gcur.team_b_id IS NULL OR ts.team_id <> gcur.team_b_id);
-- Expected: 66 rows updated.
```

Notes / safety:
- `scores` has a unique constraint on `(team_slot_id, game_id)`. Target rows currently hold
  0 scores for these slots, so no conflict on re-link. (Confirm once more before running.)
- `team_id` is a per-week-unique UUID, so the matchup-team match alone pins the correct week;
  the `cca.week_id = tm.week_id` join is a belt-and-suspenders guard.

## Verification before/after

- Before: a simulation of the corrected assignment was being run to confirm post-repair
  records match the Season 1 Summary CSV (Garrett → 7-5, etc.). **Re-run this simulation and
  diff against the Summary CSV before applying**, and re-check after applying:
  - Garrett 7-5, Nick 9-5, Jordan 8-7, CJ 5-1, John 6-4, Jack 6-5, Brandtly 6-5,
    Daniel 4-8, Danny 2-7, Andre 2-6, Troy 3-7, Thomas 2-4.
- After applying: open PlayerDetail (Season 1 filter) for a few players and the Standings
  Season 1 view; confirm records match the CSV.

## Open questions for the team

1. Confirm the Season 1 Summary CSV is the authoritative source of truth for expected records.
2. The Summary win/loss is computed by the app from **team totals including league-avg fills**.
   Confirm that's the intended definition (it's how live/standings already work) before we
   treat any small CSV-vs-app diffs as acceptable.
3. Should we add a guard (DB constraint or import-time check) so scores can only attach to a
   game whose matchup includes the slot's team, to prevent this class of corruption recurring?
