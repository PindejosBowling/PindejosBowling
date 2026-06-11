# Playoff Draft (v1)

Captains draft playoff teams from the season's registered + active players, live from
their own phones; an admin ("commissioner") sets up, supervises, and converts the
result into real `teams`/`team_slots` rows. One draft per season.

## Data model (4 tables + 1 flag)

| Table | Purpose |
|---|---|
| `playoff_drafts` | One per season (`season_id` UNIQUE). `week_id` → the playoff week, `draft_type` (`snake`/`straight`), `status`: `setup` → `drafting` → `completed` → `materialized` |
| `playoff_draft_captains` | `draft_id`, `player_id`, `seed` (1..N). Seed order = current standings order among the chosen captains, computed app-side at create time |
| `playoff_draft_pool` | Snapshot of draftable players, seeded by the create RPC from `registrations` ∩ `players.is_active` minus captains. Admin-prunable while in `setup` |
| `playoff_draft_picks` | Append-only pick log: `(draft_id, pick_number)` and `(draft_id, picked_player_id)` both UNIQUE |

`weeks.is_playoff boolean` — labeling only. The playoff week is an **ordinary week**:
RSVP, betting-market sync, archive/settlement, and loans all run unchanged on it.

## The turn engine (derived, never stored)

Whose-turn is a pure function of the pick log: pick `k` over `N` seeds —
straight repeats seeds `1..N`; snake reverses every other round (`1,2,2,1,…`).
Implemented twice, identically:

- SQL: `playoff_current_turn(draft_id)` — used inside `playoff_make_pick`
- TS: `computeDraftTurnSeed()` in `app/src/hooks/usePlayoffDraftData.ts` — drives the UI

Because turn state is derived, **undo = delete the last pick row** and the clock
rewinds for free; there is no pointer to drift.

## Write paths

- **Captain picks**: only via `playoff_make_pick` (SECURITY DEFINER). Takes the draft
  row `FOR UPDATE` (serializes simultaneous taps), verifies caller = on-the-clock
  captain (admins may pick on the clock-holder's behalf; the pick is recorded against
  the clock-holder), verifies pool membership, auto-flips `status` to `completed`
  when the pool drains.
- **Admin fixes**: direct table CRUD under the `admin can write` RLS policies
  (start draft = status flip, pool pruning). Status-coupled mutations get RPCs:
  `playoff_undo_pick` (also reopens `completed` → `drafting`),
  `playoff_materialize_teams`, `playoff_reset_draft`.
- **Materialize**: writes `teams` (numbered by seed) + `team_slots` (captain slot 1,
  picks in pick order) onto the playoff week **and confirms the week**
  (`is_confirmed = true` — `weeks.getActive()`/Matchups only surfaces confirmed
  weeks); refuses if the week already has teams. From there the existing
  week-editor/matchups/scoring flow takes over — playoff code never touches `games`.
- **Reset** (`playoff_reset_draft`): valid in every status, including
  `materialized` — deletes the draft (cascades captains/pool/picks), un-flags
  `weeks.is_playoff`, and when materialized also deletes the week's `teams`
  (cascading slots/games/scores) and unconfirms the week. Refuses if the playoff
  week is archived (go through `unarchive_week` first).

## App layer

- `db.ts` → `playoffDrafts` query object (graph read, RPCs, pool CRUD, captain check).
- `usePlayoffDraftData` — draft graph + setup inputs (weeks, draftable players,
  standings raw data) + a Realtime `postgres_changes` subscription on
  `playoff_drafts`/`playoff_draft_picks` (the `useWeekClock` pattern) so every open
  draft room refetches on any pick. Both tables are in the `supabase_realtime`
  publication.
- `PlayoffsScreen` — single role-aware screen: admin setup form (captain multi-select
  standings-ordered, week picker, snake/straight toggle) → draft room (on-the-clock
  banner, seed-ordered rosters, tappable pool when it's your turn) → completed
  (admin "Create teams") → materialized. Admin controls inline: start, undo last
  pick, reset, materialize.
- **Access**: the MoreHome Playoffs tile renders for admins (LEAGUE ADMIN section)
  and for current-draft captains (`useIsPlayoffCaptain`, league tools section).
  No spectator mode in v1; no pick timer.

## Out of scope (v1)

Brackets, round logic, playoff scoring UI, betting changes. Scores for the playoff
week record through the normal weekly screens.
