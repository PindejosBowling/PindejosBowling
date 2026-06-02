# PindejosBowling Native — Agent Reference

## Project Overview

React Native / Expo app for a recreational bowling league called "Pindejos." Players track weekly matchups, scores, standings, RSVPs, and historical stats. The sole backend is a Supabase Postgres database accessed via typed query objects in `src/utils/supabase/db.ts`.

---

## Tech Stack

| Layer | Library / Version |
|---|---|
| Runtime | React Native 0.85 via Expo SDK 56 |
| UI framework | React 19.2 |
| Language | TypeScript (strict enough; some `any` in data layer) |
| State | Zustand 5 |
| Navigation | React Navigation 7 (bottom tabs + native stack) |
| Storage (prefs) | `@react-native-async-storage/async-storage` |
| Charts | `react-native-gifted-charts` |
| Fonts | Barlow + Barlow Condensed via `@expo-google-fonts` |
| Gradients | `react-native-linear-gradient` |
| Database | Supabase (Postgres) via `@supabase/supabase-js` |

Run with `expo start` from `app/`. Use `--ios`, `--android`, or `--web` flags.

---

## Backend / Data Layer

All data reads and writes go through Supabase via the typed query objects in `src/utils/supabase/db.ts`.

**Files:**

| File | Purpose |
|---|---|
| [src/utils/supabase/client.ts](src/utils/supabase/client.ts) | `createClient<Database>()` — import `supabase` from here for raw queries |
| [src/utils/supabase/database.types.ts](src/utils/supabase/database.types.ts) | Auto-generated Postgres types: `Database`, `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>` |
| [src/utils/supabase/db.ts](src/utils/supabase/db.ts) | Typed query objects, one per table — **always use these over raw client calls** |

The client is configured via Expo environment variables that are set in `.env.local` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_API_KEY`) and uses AsyncStorage for session persistence.

---

## Database Schema (9 tables)

| Table | Key columns |
|---|---|
| `players` | `id`, `name`, `phone`, `is_active`, `created_at` |
| `seasons` | `id`, `number`, `league_name`, `bowling_night`, `started_at`, `ended_at` |
| `weeks` | `id`, `season_id`, `week_number`, `is_archived`, `is_confirmed`, `bowled_at` |
| `rsvp` | `id`, `player_id`, `week_id`, `status`, `note`, `updated_at` |
| `team_slots` | `id`, `week_id`, `team_number`, `slot`, `player_id`, `is_fill` |
| `game_schedule` | `id`, `week_id`, `game_number`, `team_a`, `team_b` |
| `scores` | `id`, `team_slot_id`, `game_number`, `score`, `updated_at` |
| `season_champions` | `id`, `player_id`, `season_id` |
| `board_posts` | `id`, `player_id`, `message`, `created_at` |

**Key distinctions:**
- `weeks.is_archived` — `true` once the week has been bowled and scores are final. All historical queries filter to archived weeks.
- `weeks.is_confirmed` — `true` once teams have been generated and locked for the week. Used to distinguish an active (live-scoring) week from a pending one.
- `team_slots.is_fill` — `true` for league-avg fill placeholders. Excluded from personal stats but included in team totals.

---

## db.ts Query Objects

### `boardPosts`
| Method | Description |
|---|---|
| `list()` | All posts with joined player name, newest first |
| `insert(data)` | Insert a new post |
| `remove(id)` | Delete a post by id |

### `gameSchedule`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | Schedule rows for one week |
| `listForArchivedWeeks()` | All schedule rows for archived weeks (used by standings/chemistry/H2H) |
| `insert(data)` | Insert one or many schedule rows |
| `remove(id)` | Delete by id |
| `removeByWeek(weekId)` | Delete all schedule rows for a week |

### `players`
| Method | Description |
|---|---|
| `list()` | All players, ordered by name |
| `listActive()` | Active players only |
| `getById(id)` | Single player by id |
| `getByName(name)` | Case-insensitive name match (single) |
| `insert(data)` | Add a player |
| `update(id, data)` | Update player fields |

### `rsvp`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All RSVPs for a week with joined player name |
| `upsert(data)` | Insert or update on `player_id, week_id` conflict |
| `remove(id)` | Delete by id |
| `removeByWeek(weekId)` | Clear all RSVPs for a week |

### `scores`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | Scores for a live week (joins team_slots) |
| `listBySeason(seasonId)` | Archived, non-fill scores for a season (for avg calc) |
| `listAllArchived()` | All archived non-fill scores |
| `listForStandings()` | Archived scores with full player/week/season join (standings, chemistry, season history) |
| `listForPlayerDetail()` | Archived scores with slot/week/season join (player detail screen) |
| `listForH2H()` | Archived scores with player/week/season join (head-to-head) |
| `listForLeagueRecords()` | Archived scores with player/week/season join (league records) |
| `insert(data)` | Insert one or many scores |
| `upsert(data)` | Upsert on `team_slot_id, game_number` conflict |
| `update(id, data)` | Update a score by id |
| `removeBySlotIds(ids)` | Delete scores for a list of slot ids |
| `remove(teamSlotId, gameNumber)` | Delete a specific score |

### `seasonChampions`
| Method | Description |
|---|---|
| `list()` | All champions with joined player name and season |
| `listBySeason(seasonId)` | Champions for one season |
| `insert(data)` | Record a champion |
| `remove(id)` | Delete a champion record |

### `seasons`
| Method | Description |
|---|---|
| `list()` | All seasons, ordered by number |
| `getLatest()` | Most recent season (single) |
| `getById(id)` | Single season by id |
| `insert(data)` | Create a season |
| `update(id, data)` | Update season fields |

### `teamSlots`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All slots for a week with joined player name |
| `listByPlayer(playerId)` | All archived slots for a player with week/season join |
| `insert(data)` | Insert one or many slots |
| `update(id, data)` | Update a slot |
| `remove(id)` | Delete a slot |
| `removeByWeek(weekId)` | Delete all slots for a week |

### `weeks`
| Method | Description |
|---|---|
| `list()` | All weeks, ordered by week_number |
| `listBySeason(seasonId)` | Weeks for a season |
| `getCurrent()` | Most recent non-archived week (current/upcoming) |
| `getActive()` | Most recent non-archived, confirmed week (live-scoring) |
| `getById(id)` | Single week by id |
| `insert(data)` | Create a week |
| `update(id, data)` | Update week fields |

---

## Data Architecture

### Hook-based data pattern

Each screen (or group of screens) has a corresponding hook in `src/hooks/`. The hook fetches raw Supabase data, exposes it alongside a `reload` function, and the screen derives display data via `useMemo`. Many hook files also export standalone **compute functions** — pure functions that accept raw data and return derived UI data.

```
┌─────────────┐      ┌──────────────┐      ┌────────────────────────┐
│   Screen    │ uses │     Hook     │ uses │      db.ts / Supabase  │
│  (useMemo)  │◄─────│ rawScores,   │◄─────│  scores.listForXxx()  │
│             │      │ rawSchedule, │      │  gameSchedule.list...  │
│             │      │ loading,     │      │  seasons.list()        │
│             │      │ reload       │      └────────────────────────┘
└─────────────┘      └──────────────┘
        │
        ▼
   computeXxx(rawScores, rawSchedule, ...)
   (pure, exported from hook file)
```

### Archived vs. live data

- **Archived weeks** (`is_archived = true`): all historical stats, standings, records, chemistry. Always filtered in the specialized `scores.listForXxx()` queries.
- **Active week** (`is_archived = false, is_confirmed = true`): the live scoreboard used by `MatchupsScreen`. Fetched by `weeks.getActive()`.

### Standings computation

Win/loss is determined by comparing **team totals** (all players on a team including fill) per game. The schedule (`game_schedule`) defines which team-number faced which. The `computeStandingsFromSupabase` function (exported from `useStandingsData.ts`) implements this and is reused by multiple screens.

### Effective avg for matchups

`useMatchupsData` computes a per-player avg from the previous season's archived scores. Fill slots and Out-RSVP'd players are assigned the league avg. This is not user-configurable.

---

## Hooks

**File:** `src/hooks/`

| Hook file | Exported hook | Exported compute functions | Used by |
|---|---|---|---|
| `useStandingsData.ts` | `useStandingsData` | `computeStandingsFromSupabase(rawScores, rawSchedule, seasonId)` | StandingsScreen, SeasonHistoryScreen |
| `useMatchupsData.ts` | `useMatchupsData` | — | MatchupsScreen |
| `usePlayerDetailData.ts` | `usePlayerDetailData(name)` | `computePlayerProfile`, `computePersonalRecords`, `computeCurrentTeam`, `computeWeekRows`, `computeChartPoints`, `computeExpandedMatchups`, `computePlayerSeasons` | PlayerDetailScreen |
| `useChemistryData.ts` | `useChemistryData` | `computeChemistryFromSupabase(rawScores, rawSchedule, groupSize)` | ChemistryScreen |
| `useH2HData.ts` | `useH2HData` | `computeH2HFromSupabase(p1Name, p2Name, rawScores, rawSchedule)` | HeadToHeadScreen |
| `useLeagueRecordsData.ts` | `useLeagueRecordsData` | `computeLeagueRecordsFromSupabase(rawScores, filterSeasonId)` | LeagueRecordsScreen |
| `useSeasonHistoryData.ts` | `useSeasonHistoryData` | — (uses `computeStandingsFromSupabase`) | SeasonHistoryScreen |
| `usePastGamesData.ts` | `usePastGamesData` | `computePastGamesFromSupabase(rawScores, rawSchedule, seasonId)` | PastGamesScreen |
| `usePlayerManagementData.ts` | `usePlayerManagementData` | — | PlayerManagementScreen |
| `useRefresh.ts` | `useRefresh(fn)` | — | All screens with pull-to-refresh |

### Hook return shapes

All data hooks return at minimum:
```ts
{ loading: boolean, reload: () => Promise<void> }
```
Plus raw data slices specific to that hook (`rawScores`, `rawSchedule`, `seasonList`, `playerNames`, etc.).

### `useRefresh(fn)`

Accepts any async function and returns `{ refreshing, onRefresh }` for use with `RefreshControl`. Pass the hook's own `reload`:

```tsx
const { reload } = useMatchupsData()
const { refreshing, onRefresh } = useRefresh(reload)
```

---

## Pure Data Utilities

**File:** [src/utils/helpers.js](src/utils/helpers.js)

| Function | Purpose |
|---|---|
| `initials(name)` | 2-char initials from a full name |
| `timeAgo(date)` | Human-readable relative time string ("2h ago", "3d ago") |
| `combinations(arr, k)` | All k-length combinations of an array — used by chemistry calculation |
| `spreadAndML(t1, t2)` | Bowling spread + moneyline odds from two expected team totals |

---

## State Management

Three Zustand stores — all imported as `useXxxStore` hooks:

### `usePendingStore` ([src/stores/pendingStore.ts](src/stores/pendingStore.ts))
Optimistic edit buffer — not persisted. Holds staged changes before save.
- `pendingRSVP: Record<playerName, 'In'|'Out'>` — staged RSVP changes
- `pendingScores: Record<'teamName|slot|gameNum', scoreString>` — staged score edits
- `genTeams` / `genNumTeams` / `genTeamSize` / `genAvgSource` / `genFillMode` / `genFillToSize` / `genSwapTarget` — state for the Generate Teams admin flow

Pending score key format: `"${teamName}|${slot}|${gameNum}"`

### `useUiStore` ([src/stores/uiStore.ts](src/stores/uiStore.ts))
Ephemeral UI state — toggles, selections, toast queue. All fields via `set(partial)`. Key fields:
- `matchupsView` — `'scores'` | `'expected'`
- `expandedWeek` — week id for expanded row in season history
- `standingsSeason` — season filter for StandingsScreen
- `playerSeason` — season filter for PlayerDetailScreen
- `recordsSeason` — season filter for LeagueRecordsScreen (`'all'` or season id string)
- `playerLogMode` — `'bowled'` | other — controls game log display in PlayerDetailScreen
- `chemMode` — `'pairs'` | `'trios'`
- `chemExpanded` — boolean, whether chemistry rows are expanded
- `h2hP1`, `h2hP2` — selected player names for head-to-head
- `oddsRevealed` — easter egg toggle on matchup screen
- `toasts` — call `showToast(msg, type)` to show a 2.4s auto-dismissing toast

---

## Navigation Architecture

**Root:** Bottom tabs (`@react-navigation/bottom-tabs`)

| Tab label | Navigator / Screen | Route name |
|---|---|---|
| Standings | StandingsStackNavigator | `Standings` |
| RSVP | RsvpScreen | `RSVP` |
| This Week | MatchupsScreen | `Matchups` |
| More | MoreStackNavigator | `More` |

**Standings tab** is a native stack navigator:

| Route | Screen |
|---|---|
| `StandingsList` | StandingsScreen |
| `PlayerDetail` | PlayerDetailScreen — receives `{ name: string }` param |

**More tab** is a native stack navigator:

| Route | Screen |
|---|---|
| `MoreHome` | MoreHomeScreen — tile grid entry point |
| `LeagueRecords` | LeagueRecordsScreen |
| `HeadToHead` | HeadToHeadScreen |
| `Chemistry` | ChemistryScreen |
| `SeasonHistory` | SeasonHistoryScreen |
| `TrashBoard` | TrashBoardScreen |
| `Playoffs` | PlayoffsScreen |
| `PlayerManagement` | PlayerManagementScreen — add, edit, and toggle active/inactive players |
| `PastGames` | PastGamesScreen — browse historical week rosters and scores by season |

**Cross-tab navigation to PlayerDetail** (e.g. from More tab):
```tsx
(navigation as any).navigate('Standings', { screen: 'PlayerDetail', params: { name } })
```

---

## Component Inventory

| Component | Purpose |
|---|---|
| `AppHeader` | App logo + current Week/Season badge, reads from Supabase (`weeks.getCurrent`, `seasons.getLatest`) |
| `ScreenHeader` | Reusable titled header for inner screens |
| `Toast` | Absolute-positioned animated toast, reads from `uiStore.toasts` |
| `ConfirmBar` | Sticky bottom bar for pending saves (RSVP, scores) |
| `PlayerScoreRow` | One player row in the live matchup view — editable score input or expected avg display |
| `OddsBlock` | Betting-style spread + moneyline card (easter egg, `Expected` mode only) |
| `LoadingView` | Centered spinner with label |
| `PillFilter` | Horizontal pill-style filter row for season/week selectors |
| `ToggleGroup` | Segmented toggle control for multi-option switches |
| `HistoricalTeamBlock` | Team block for displaying archived week rosters |
| `ProfileMenuModal` | Bottom sheet opened from the avatar in `AppHeader` — shows player identity and per-user actions (My Profile, Log Out) |
| `PlayerPickerModal` | Full-screen player search/select for H2H |
| `AdminArchiveModal` | Confirm dialog — archives active week (sets `is_archived = true`, creates next week row) |
| `AdminEndSeasonModal` | Confirm dialog — records season champions and creates new season row |
| `AdminGenerateTeamsModal` | Generate balanced teams from RSVP list, preview swaps, write slots/schedule to Supabase |

---

## Key Patterns

### useMemo for derived data
Every screen derives display data with `useMemo`. The canonical pattern:

```tsx
const { loading, rawScores, rawSchedule, seasonList } = useStandingsData()
const activeSeason = useUiStore(s => s.standingsSeason)

const standings = useMemo(
  () => computeStandingsFromSupabase(rawScores, rawSchedule, activeSeason),
  [rawScores, rawSchedule, activeSeason],
)
```

Do not call compute functions outside of `useMemo` in render — they scan full data sets on every call.

### Pull-to-refresh
Every scrollable screen uses `useRefresh(reload)` from `src/hooks/useRefresh.ts`, passing the hook's own `reload` function:

```tsx
const { loading, rawScores, reload } = useStandingsData()
const { refreshing, onRefresh } = useRefresh(reload)
// pass refreshing/onRefresh to RefreshControl
```

### Pending / optimistic score edits
`usePendingStore.pendingScores` holds unsaved score changes. `MatchupsScreen` renders them immediately and shows a `ConfirmBar`. On save, `scores.upsert` is called, then `reload()` refreshes from Supabase, then the pending buffer is cleared. On discard, pending is just cleared.

### Admin flows (all Supabase direct)
- **Archive week** (`AdminArchiveModal`) — sets `weeks.update(id, { is_archived: true })`, then inserts a new week row for the next week number
- **Add/edit player** (`PlayerManagementScreen`) — inline modal calls `players.insert` or `players.update`; first name, last name, and phone are all required
- **End season** (`AdminEndSeasonModal`) — writes `season_champions.insert` for selected champions, then calls `seasons.insert` for the new season
- **Generate teams** (`AdminGenerateTeamsModal`) — reads RSVP + player avgs, computes balanced teams client-side, previews swaps, then writes `team_slots.insert` + `gameSchedule.insert` + `weeks.update(..., { is_confirmed: true })`

---

## Theme System

**File:** [src/theme.ts](src/theme.ts)

Dark theme only. Import `colors`, `fonts`, `radius`.

```ts
colors.bg        // #0a0a0c  — page background
colors.surface   // #131316  — card background
colors.surface2  // #1c1c21  — raised surface
colors.surface3  // #25252b  — element on surface
colors.accent    // #e8ff47  — primary accent (yellow-green)
colors.accentDim // rgba(232,255,71,0.12) — translucent accent tint
colors.accent2   // #ff4f6d  — secondary accent (red)
colors.accent3   // #4fc3ff  — tertiary accent (blue)
colors.gold      // #fbbf24  — champion gold
colors.text      // #f0f0f0  — body text
colors.muted     // #7a7a85  — secondary text
colors.muted2    // #55555e  — tertiary / disabled text
colors.border    // rgba(255,255,255,0.08)
colors.border2   // rgba(255,255,255,0.14) — stronger border
colors.danger    // #ff4f6d
colors.success   // #4ade80
```

Typography uses **Barlow Condensed** for labels/headings/stats and **Barlow** for body text:
```ts
fonts.barlow               // Barlow_400Regular
fonts.barlowMedium         // Barlow_500Medium
fonts.barlowSemiBold       // Barlow_600SemiBold
fonts.barlowCondensed      // BarlowCondensed_700Bold
fonts.barlowCondensedHeavy // BarlowCondensed_900Black
```

Border radii:
```ts
radius.card   // 18 — large cards
radius.cardMd // 14 — medium cards
radius.cardSm // 12 — buttons, inputs
radius.icon   // 10 — avatar/icon boxes
```

---

## File Map

```
app/
├── App.tsx                      # Root: font loading, prefs hydration, navigation container
├── index.ts                     # Expo entry point
├── src/
│   ├── theme.ts                 # colors, fonts, radius
│   ├── hooks/
│   │   ├── useChemistryData.ts  # Chemistry data + computeChemistryFromSupabase
│   │   ├── useH2HData.ts        # H2H data + computeH2HFromSupabase
│   │   ├── useLeagueRecordsData.ts  # League records + computeLeagueRecordsFromSupabase
│   │   ├── useMatchupsData.ts   # Active week matchup data (full derivation in hook)
│   │   ├── usePastGamesData.ts  # Past games by season + computePastGamesFromSupabase
│   │   ├── usePlayerDetailData.ts   # Player data + many compute* functions
│   │   ├── usePlayerManagementData.ts  # Raw player list for PlayerManagementScreen
│   │   ├── useRefresh.ts        # useRefresh(fn) — RefreshControl helper
│   │   ├── useSeasonHistoryData.ts  # Past seasons raw data
│   │   └── useStandingsData.ts  # Standings data + computeStandingsFromSupabase
│   ├── navigation/
│   │   ├── RootNavigator.tsx    # Bottom tab navigator
│   │   ├── StandingsStackNavigator.tsx  # Stack: StandingsList → PlayerDetail
│   │   ├── MoreStackNavigator.tsx       # Stack: MoreHome + tools
│   │   └── types.ts             # MoreStackParamList, StandingsStackParamList
│   ├── stores/
│   │   ├── pendingStore.ts      # Optimistic edit buffer (scores, RSVPs, team gen state)
│   │   └── uiStore.ts           # Ephemeral UI state + toast queue
│   ├── utils/
│   │   ├── helpers.js           # initials, timeAgo, combinations, spreadAndML
│   │   └── supabase/
│   │       ├── client.ts        # Supabase client (env-var configured)
│   │       ├── database.types.ts # Auto-generated Postgres types
│   │       └── db.ts            # Typed query objects per table
│   ├── components/
│   │   ├── AppHeader.tsx
│   │   ├── ScreenHeader.tsx
│   │   ├── Toast.tsx
│   │   ├── ConfirmBar.tsx
│   │   ├── PillFilter.tsx
│   │   ├── ToggleGroup.tsx
│   │   ├── PlayerScoreRow.tsx
│   │   ├── OddsBlock.tsx
│   │   ├── LoadingView.tsx
│   │   ├── HistoricalTeamBlock.tsx
│   │   ├── ProfileMenuModal.tsx
│   │   ├── PlayerPickerModal.tsx
│   │   ├── AdminArchiveModal.tsx
│   │   ├── AdminEndSeasonModal.tsx
│   │   └── AdminGenerateTeamsModal.tsx
│   └── screens/
│       ├── LoginScreen.tsx          # Phone OTP login flow
│       ├── MatchupsScreen.tsx       # Live scoreboard + score entry
│       ├── RsvpScreen.tsx           # Weekly attendance management
│       ├── StandingsScreen.tsx      # Season/all-time standings table
│       ├── MoreHomeScreen.tsx       # Tile grid for tools/admin
│       ├── PlayerDetailScreen.tsx   # Per-player stats, game log, records
│       ├── PlayerManagementScreen.tsx  # Add/edit/toggle players (admin)
│       ├── PastGamesScreen.tsx      # Historical week rosters + scores by season
│       ├── LeagueRecordsScreen.tsx  # High game/series/team records
│       ├── HeadToHeadScreen.tsx     # 1v1 player comparison
│       ├── ChemistryScreen.tsx      # Pair/trio win-rate analysis
│       ├── SeasonHistoryScreen.tsx  # Season-by-season summary
│       ├── TrashBoardScreen.tsx     # Fun message board
│       └── PlayoffsScreen.tsx       # Admin: playoffs bracket
```

---

## Page Creation

See [PAGE_CREATION.md](PAGE_CREATION.md) for the full blueprint: hook patterns, screen skeleton, navigation wiring, database migration workflow, and type regeneration. Follow it when adding any new screen or making schema changes.

---

## Important Notes for Agents

1. **All data comes from Supabase.** There is no Google Apps Script backend. Do not reference `api.js`, `apiGet`, `apiPost`, `dataStore`, `data.js`, or `constants.js` — they no longer exist.

2. **Use specialized query methods in `db.ts`.** Queries like `scores.listForStandings()` join the right tables in one round-trip. Avoid building ad-hoc joins from raw `supabase` client calls; add a new method to `db.ts` if needed.

3. **Archived = historical.** All stat computation queries filter `is_archived = true`. The current/active week is identified by `is_archived = false` (and `is_confirmed = true` for live scoring).

4. **Compute functions are pure.** Functions like `computeStandingsFromSupabase` scan full data arrays on every call with no caching. Always wrap in `useMemo` at the screen level.

5. **Hook files export both the hook and compute functions.** If you need the derived data type shape, import it from the hook file (e.g. `StandingsRow` from `useStandingsData.ts`).

6. **No memoization inside hooks or compute functions.** Caching is the screen's responsibility via `useMemo`.

7. **TypeScript coverage is partial.** Screens and hooks are `.tsx`/`.ts` with typed interfaces. `helpers.js` is plain `.js` with JSDoc. Do not convert it to TS without confirming it's wanted.

8. **No test suite.** Verify behavior manually via the Expo dev server (`expo start`).

9. **Auth layer is active.** Phone OTP login is required. User identity is derived from `auth.users` and linked to `players` via `players.user_id`. The `useAuthStore` exposes `userId`, `playerId`, `playerName`, and `role`. See [supabase/AUTH.md](supabase/AUTH.md) for the full architecture — JWT hook, trigger, RLS patterns, and role management.

10. **`useRefresh` requires a function argument.** Pass the `reload` from the screen's data hook: `useRefresh(reload)`. It is not bound to a global store refresh.

11. **Supabase CLI requires `SUPABASE_ACCESS_TOKEN` — no MCP server is configured.** Always load the token from `app/.env.local` and use `--linked` with `--workdir` pointing to the repo root. Never run `supabase` commands without this setup or they will fail with 401.
    ```bash
    SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN \
      supabase db query --linked --workdir /Users/garrett/Code/PindejosBowling \
      "SELECT ..."
    ```
    Project ref: `lyihsvxraurjghjqxaau` — URL: `https://lyihsvxraurjghjqxaau.supabase.co`
