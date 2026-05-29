# Supabase Migration Checklist

Migrating from the Google Apps Script API (`api.js` → `getAll`, `apiPost`) to
typed Supabase queries via `src/utils/supabase/db.ts`.

Screen-specific query composition stays at the screen level; `db.ts` provides
the typed primitives.

---

## CRUD Library

- [x] `src/utils/supabase/db.ts` — typed CRUD helpers for all tables

---

## Tables

- [x] `board_posts` — `boardPosts.list`, `.insert`, `.remove`
- [x] `game_schedule` — `gameSchedule.listByWeek`, `.insert`, `.remove`, `.removeByWeek`
- [x] `players` — `players.list`, `.listActive`, `.getById`, `.getByName`, `.insert`, `.update`
- [x] `rsvp` — `rsvp.listByWeek`, `.upsert`, `.remove`, `.removeByWeek`
- [x] `scores` — `scores.listByWeek`, `.insert`, `.upsert`, `.update`
- [x] `season_champions` — `seasonChampions.list`, `.listBySeason`, `.insert`, `.remove`
- [x] `seasons` — `seasons.list`, `.getLatest`, `.getById`, `.insert`, `.update`
- [x] `team_slots` — `teamSlots.listByWeek`, `.insert`, `.update`, `.remove`, `.removeByWeek`
- [x] `weeks` — `weeks.list`, `.listBySeason`, `.getCurrent`, `.getActive`, `.getById`, `.insert`, `.update`

---

## Screens

Each screen currently reads from the `dataStore` (backed by `apiGet('getAll')`).
Replace with direct `db.*` calls and drop the `useDataStore` dependency once all
reads for that screen are covered.

- [x] `TrashBoardScreen` — `board_posts` r/w
- [x] `RsvpScreen` — `players`, `rsvp`, `weeks` r/w
- [x] `MatchupsScreen` — `weeks`, `team_slots`, `game_schedule`, `scores` r/w; `players` r
- [x] `StandingsScreen` — `seasons`, `weeks`, `team_slots`, `players`, `scores` r
- [x] `PlayerDetailScreen` — `players`, `weeks`, `team_slots`, `scores`, `season_champions` r
- [x] `SeasonHistoryScreen` — `seasons`, `weeks`, `team_slots`, `scores`, `season_champions` r
- [ ] `ChemistryScreen` — `players`, `team_slots`, `scores`, `season_champions` r
- [ ] `HeadToHeadScreen` — `players`, `team_slots`, `scores`, `weeks` r
- [ ] `LeagueRecordsScreen` — `players`, `scores`, `weeks` r
- [ ] `PlayoffsScreen` — `weeks`, `team_slots`, `players`, `scores` r
- [ ] `MoreHomeScreen` — `seasons`, `weeks` r

---

## Admin Components

These components write through `apiPost` today; migrate to `db.*` writes.

- [ ] `AdminAddPlayerModal` — `players.insert`
- [x] `AdminArchiveModal` — `weeks.update` (flip `is_archived`)
- [ ] `AdminEndSeasonModal` — `seasons.update` (set `ended_at`)
- [x] `AdminGenerateTeamsModal` — `team_slots` insert/replace by week

---

## Cleanup

- [ ] Remove `src/api.js` once all screens and components are migrated
- [ ] Remove `src/stores/dataStore.ts` once no screens depend on it
- [ ] Remove `loadAll` / `loadActive` call-sites from `AppHeader`, `RootNavigator`, etc.
