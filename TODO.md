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
- [ ] `game_schedule` — `gameSchedule.listByWeek`, `.insert`, `.remove`, `.removeByWeek`
- [ ] `players` — `players.list`, `.listActive`, `.getById`, `.getByName`, `.insert`, `.update`
- [ ] `rsvp` — `rsvp.listByWeek`, `.upsert`, `.remove`, `.removeByWeek`
- [ ] `scores` — `scores.listByWeek`, `.insert`, `.upsert`, `.update`
- [ ] `season_champions` — `seasonChampions.list`, `.listBySeason`, `.insert`, `.remove`
- [ ] `seasons` — `seasons.list`, `.getLatest`, `.getById`, `.insert`, `.update`
- [ ] `team_slots` — `teamSlots.listByWeek`, `.insert`, `.update`, `.remove`, `.removeByWeek`
- [ ] `weeks` — `weeks.list`, `.listBySeason`, `.getCurrent`, `.getActive`, `.getById`, `.insert`, `.update`

---

## Screens

Each screen currently reads from the `dataStore` (backed by `apiGet('getAll')`).
Replace with direct `db.*` calls and drop the `useDataStore` dependency once all
reads for that screen are covered.

- [x] `TrashBoardScreen` — `board_posts` r/w
- [ ] `RsvpScreen` — `players`, `rsvp`, `weeks` r/w
- [ ] `MatchupsScreen` — `weeks`, `team_slots`, `game_schedule`, `scores` r/w; `players` r
- [ ] `StandingsScreen` — `seasons`, `weeks`, `team_slots`, `players`, `scores` r
- [ ] `PlayerDetailScreen` — `players`, `weeks`, `team_slots`, `scores`, `season_champions` r
- [ ] `SeasonHistoryScreen` — `seasons`, `weeks`, `team_slots`, `scores`, `season_champions` r
- [ ] `HistoryScreen` — `seasons`, `weeks`, `team_slots`, `scores` r
- [ ] `ChemistryScreen` — `players`, `team_slots`, `scores`, `season_champions` r
- [ ] `HeadToHeadScreen` — `players`, `team_slots`, `scores`, `weeks` r
- [ ] `LeagueRecordsScreen` — `players`, `scores`, `weeks` r
- [ ] `PlayoffsScreen` — `weeks`, `team_slots`, `players`, `scores` r
- [ ] `MoreHomeScreen` — `seasons`, `weeks` r

---

## Admin Components

These components write through `apiPost` today; migrate to `db.*` writes.

- [ ] `AdminAddPlayerModal` — `players.insert`
- [ ] `AdminArchiveModal` — `weeks.update` (flip `is_archived`)
- [ ] `AdminEndSeasonModal` — `seasons.update` (set `ended_at`)
- [ ] `AdminGenerateTeamsModal` — `team_slots` insert/replace by week

---

## Cleanup

- [ ] Remove `src/api.js` once all screens and components are migrated
- [ ] Remove `src/stores/dataStore.ts` once no screens depend on it
- [ ] Remove `loadAll` / `loadActive` call-sites from `AppHeader`, `RootNavigator`, etc.
