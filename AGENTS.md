# PindejosBowling Native — Agent Reference

## Project Overview

React Native / Expo app for a recreational bowling league called "Pindejos." Players track weekly matchups, scores, standings, RSVPs, and historical stats. All persistent data lives in Google Sheets and is accessed via a Google Apps Script (GAS) web-app endpoint. There is no dedicated server — GAS is the backend.

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

Run with `expo start` from `app/`. Use `--ios`, `--android`, or `--web` flags.

---

## Backend / API Layer

**File:** [src/api.js](src/api.js)

All data reads and writes go through a single Google Apps Script URL (`API` constant in `api.js`). Two wrappers:

```js
apiGet(action)           // GET  ?action=<action>
apiPost(action, payload) // POST { action, ...payload }, retries once on failure
```

`apiPost` does one automatic retry with a 1.2s backoff — GAS has occasional transient failures.

### Known action names (POST)
| Action | Purpose |
|---|---|
| `batchUpdateScores` | Save score entries from the active week board |
| `batchUpdateRSVP` | Save RSVP status changes |
| `resetRSVP` | Clear all RSVP statuses for the upcoming week |
| `archiveAndAdvance` | Archive current week scores → stats sheet, increment week |
| `addPlayer` | Add a new player to the roster |
| `generateTeams` | Server-side balanced team generation |
| `confirmMatchups` | Write generated teams to the active week sheet |
| `endSeason` | End-of-season admin action |

### Known action names (GET)
| Action | Purpose |
|---|---|
| `getAll` | Single call that returns all data slices at once |
| `getActiveWeek` | Fetch only the active week sheet (used by `loadActive`) |

---

## Data Architecture

### Single-fetch pattern

On startup `App.tsx` calls `useDataStore.getState().loadAll()` once. This calls `apiGet('getAll')` and populates all 10 slices in one round-trip. Subsequent refreshes (pull-to-refresh on every screen) call `loadAll()` again. `loadActive()` is available for lighter refreshes that only need the live scoreboard.

### Raw data format

Every data slice returned by the API is a **2D array of rows** mirroring the raw Google Sheet values:
- Row 0 is always a header row — skip it with `stats.slice(1)` or `statsRows(stats)`.
- Cell values may be booleans, numbers, strings, or empty strings — not null.
- The boolean `PRESENT` column stores `true`, `'TRUE'`, `1`, or `'1'` — use `isPresent()` from `helpers.js`.

### Column index constants

**File:** [src/utils/constants.js](src/utils/constants.js)

`SC` — Stats sheet columns:

| Key | Index | Meaning |
|---|---|---|
| `SEASON` | 0 | Season number |
| `WEEK` | 1 | Week number |
| `PLAYER` | 2 | Player full name |
| `TEAM` | 3 | Team name |
| `G1` | 4 | Game 1 score |
| `G1_OPP` | 5 | Game 1 opponent team |
| `G2` | 6 | Game 2 score |
| `G2_OPP` | 7 | Game 2 opponent team |
| `PINS` | 8 | Total pins |
| `WINS` | 9 | Win count |
| `LOSSES` | 10 | Loss count |
| `GAMES` | 11 | Games played |
| `PRESENT` | 12 | Attendance flag |

`AW` — Active week sheet columns (supports up to 3 games per night):

| Key | Index | Meaning |
|---|---|---|
| `SEASON` | 0 | Season number |
| `WEEK` | 1 | Week number |
| `TEAM` | 2 | Team name |
| `SLOT` | 3 | Player slot (sort order within team) |
| `NAME` | 4 | Player name |
| `G1` | 5 | Game 1 score |
| `G2` | 6 | Game 2 score |
| `G3` | 7 | Game 3 score |
| `G1_OPP` | 8 | Game 1 opponent team |
| `G2_OPP` | 9 | Game 2 opponent team |
| `G3_OPP` | 10 | Game 3 opponent team |
| `IS_FILL` | 11 | Fill placeholder flag |

### dataStore slices

**File:** [src/stores/dataStore.ts](src/stores/dataStore.ts)

| Store key | Google Sheet | Description |
|---|---|---|
| `stats` | Stats sheet | All historical per-player per-week rows |
| `active` | Active week sheet | Live scoreboard for the current week |
| `current` | Current week info | Week/season identifiers |
| `roster` | Roster sheet | All player names + availability status |
| `rsvp` | RSVP sheet | Per-player RSVP status (`'In'` / `'Out'` / `''`) |
| `board` | Leaderboard | Pre-computed board (used by TrashBoard screen) |
| `history` | History | Archived season data |
| `champions` | Champions | Season champion records (`[seasonNum, playerName]`) |
| `generated` | Generated teams | Last server-generated team arrangement |
| `settings` | Settings | Key-value pairs; `CurrentSeason` key drives season logic |

**Actions:**
- `loadAll()` — Calls `getAll`, populates all slices. Called on startup and pull-to-refresh.
- `loadActive()` — Calls `getActiveWeek`, refreshes only the `active` slice.

---

## Pure Data Derivation Layer

**File:** [src/utils/data.js](src/utils/data.js)

All business logic for deriving UI data lives here as **pure functions** — they accept store slices as arguments and return computed values. Screens call these inside `useMemo()` for memoized derivation.

Key functions and what they return:

| Function | Returns |
|---|---|
| `statsRows(stats)` | Filtered rows (no header, no blank player name) — base for everything |
| `getSeasons(stats)` | Sorted array of season identifiers |
| `getCurrentSeason(stats, settings)` | Current season; prefers `settings` value, falls back to latest in stats |
| `getDefaultViewSeason(stats, settings)` | Most recent season that has data (avoids blank new-season pages) |
| `getWeeksForSeason(stats, season)` | Sorted week IDs for a season |
| `aggregateStandings(stats, season)` | `[{name, team, wins, losses, pins, games, avg, weekCount}]` sorted by wins; pass `'all'` for all-time |
| `getAllPlayerWeeks(stats, name)` | All stats rows for a given player |
| `getPlayerProfile(stats, settings, name, season)` | Full profile with avg breakdowns, per-game log, records |
| `getPersonalRecords(stats, name)` | `{highGame, highSeries, currentStreak, bestStreak, winRate}` |
| `getPlayerCurrentAvg(stats, settings, name, source)` | Single avg number; `source` = `'last-played'`\|`'current-season'`\|`'all-time'` |
| `getLeagueAvg(stats, settings, source)` | League-wide weighted avg for a source |
| `isChampion(champions, name)` | Boolean — player appears in champions sheet |
| `championsForSeason(champions, seasonNum)` | Array of champion names for a season |
| `isPlayerOut(rsvp, name)` | Boolean — player has RSVP'd Out |
| `getMatchupsForWeek(stats, season, week)` | Paired game matchup objects from historical data |
| `getH2H(stats, p1, p2)` | Head-to-head record between two players |
| `getChemistry(stats, groupSize)` | Win-rate stats for all player pairs/trios |
| `getLeagueRecords(stats, season)` | `{highGame, highSeries, highTeamGame, highTeamNight, bestSeasonAvg}` |
| `hasActiveWeek(active)` | Boolean — active sheet has at least one player row |
| `readActiveWeek(active)` | `{[teamName]: {players, opponents}}` structured map |
| `effectiveAvg(stats, settings, rsvp, name, isFill, leagueAvg)` | Returns leagueAvg for fill/Out players, else player's own avg |

**File:** [src/utils/helpers.js](src/utils/helpers.js)

| Function | Purpose |
|---|---|
| `isPresent(v)` | Normalizes `true`/`'TRUE'`/`1`/`'1'` → boolean |
| `initials(name)` | 2-char initials from full name |
| `escapeHtml(s)` | HTML escape (legacy; not needed in React Native) |
| `timeAgo(date)` | Human relative time string |
| `combinations(arr, k)` | k-length combinations for chemistry calculations |
| `spreadAndML(t1, t2)` | Bowling spread + moneyline odds from two expected totals |

---

## State Management

Four Zustand stores — all imported as `useXxxStore` hooks:

### `useDataStore` ([src/stores/dataStore.ts](src/stores/dataStore.ts))
Read-only from the perspective of the UI. Contains all server-fetched data, a `loadAll()` action, and a `loadActive()` action. Screens subscribe to individual slices and call `loadAll()` to refresh.

### `usePendingStore` ([src/stores/pendingStore.ts](src/stores/pendingStore.ts))
Optimistic edit buffer — not persisted. Holds:
- `pendingRSVP: Record<playerName, 'In'|'Out'>` — staged RSVP changes before save
- `pendingScores: Record<'teamName|slot|gameNum', scoreString>` — staged score edits before save
- `genTeams` / `genNumTeams` / `genTeamSize` / `genAvgSource` / `genFillMode` / `genFillToSize` / `genSwapTarget` — state for the Generate Teams flow

### `usePrefsStore` ([src/stores/prefsStore.ts](src/stores/prefsStore.ts))
User preferences, persisted via AsyncStorage (`pb_myname`, `pb_avgdisplay`). Call `hydrate()` on app start (done in `App.tsx`).
- `myName` — player's own name for personalization
- `avgDisplay` — `'last-played'` | `'current-season'` | `'all-time'` — controls which avg is shown everywhere

### `uiStore` ([src/stores/uiStore.ts](src/stores/uiStore.ts))
Ephemeral UI state — toggles, selected seasons/weeks, selected players, toast queue. All fields have a single `set(partial)` action. Key fields:
- `matchupsView` — `'scores'` | `'expected'`
- `expandedWeek`, `histSeason`, `histWeek` — History screen navigation state
- `standingsSeason`, `playerSeason`, `recordsSeason` — season filter selection per screen
- `playerLogMode` — `'bowled'` | other — controls game log display in PlayerDetail
- `chemMode` — `'pairs'` | `'trios'` — chemistry analysis group size
- `chemExpanded` — boolean, whether chemistry rows are expanded
- `h2hP1`, `h2hP2` — selected players for head-to-head
- `oddsRevealed` — easter egg toggle on matchup screen
- `toasts` — call `showToast(msg, type)` to show a 2.4s auto-dismissing toast

---

## Navigation Architecture

**Root:** Bottom tabs (`@react-navigation/bottom-tabs`)

| Tab label | Screen | Route name |
|---|---|---|
| Standings | StandingsScreen | `Standings` |
| RSVP | RsvpScreen | `RSVP` |
| This Week | MatchupsScreen | `Matchups` |
| More | MoreStackNavigator | `More` |

**More tab** is a native stack navigator with these routes:

| Route | Screen | Notes |
|---|---|---|
| `MoreHome` | MoreHomeScreen | Tile grid entry point |
| `History` | HistoryScreen | Browse past weeks by season |
| `PlayerDetail` | PlayerDetailScreen | Receives `{ name: string }` param |
| `LeagueRecords` | LeagueRecordsScreen | High game/series/team records |
| `HeadToHead` | HeadToHeadScreen | Pick 2 players, compare |
| `Chemistry` | ChemistryScreen | Pair/trio win-rate analysis |
| `SeasonHistory` | SeasonHistoryScreen | Season-by-season summary |
| `TrashBoard` | TrashBoardScreen | Fun/trash talk leaderboard |
| `Playoffs` | PlayoffsScreen | Admin: playoffs bracket |

**Cross-tab navigation pattern** (used to jump to PlayerDetail from another tab):
```tsx
(navigation as any).navigate('More', { screen: 'PlayerDetail', params: { name } })
```

---

## Component Inventory

| Component | Purpose |
|---|---|
| `AppHeader` | App logo + current Week/Season badge, reads from `dataStore` |
| `ScreenHeader` | Reusable titled header for inner screens |
| `Toast` | Absolute-positioned animated toast, reads from `uiStore.toasts` |
| `ConfirmBar` | Sticky bottom bar for pending saves (RSVP, scores) |
| `PlayerScoreRow` | One player row in the live matchup view — editable `TextInput` or expected avg display |
| `OddsBlock` | Betting-style spread + moneyline card (easter egg, `Expected` mode only) |
| `LoadingView` | Centered spinner with label |
| `PillFilter` | Horizontal pill-style filter row for season/week selectors |
| `ToggleGroup` | Segmented toggle control for multi-option switches |
| `HistoricalTeamBlock` | Team block in the History screen |
| `PlayerPickerModal` | Full-screen player search/select for H2H |
| `AdminArchiveModal` | Confirm dialog for `archiveAndAdvance` |
| `AdminAddPlayerModal` | Input dialog for `addPlayer` |
| `AdminEndSeasonModal` | Confirm dialog for `endSeason` |
| `AdminGenerateTeamsModal` | Dialog for the generate-teams admin flow |

---

## Hooks

**File:** [src/hooks/useRefresh.ts](src/hooks/useRefresh.ts)

| Hook | Purpose |
|---|---|
| `useRefresh()` | Returns `{ refreshing, onRefresh }` bound to `loadAll` — use with `RefreshControl` |

---

## Key Patterns

### Pending / optimistic edits
The `usePendingStore` holds unsaved changes client-side. Screens show changes immediately and display a `ConfirmBar`. On save, `apiPost` is called, then `loadAll()` refreshes ground truth, then the pending buffer is cleared. On discard, pending is just cleared with no API call.

Pending score key format: `"${teamName}|${slot}|${gameNum}"`

### useMemo for derived data
Every screen derives its display data with `useMemo`. The canonical pattern:
```tsx
const standings = useMemo(
  () => stats ? aggregateStandings(stats, activeSeason) : [],
  [stats, activeSeason],
)
```
Do not call data util functions outside of `useMemo` in render — they can be O(n²) over the full stats sheet.

### Pull-to-refresh
Every scrollable screen wraps its scroll/list in a `RefreshControl`. Use the `useRefresh()` hook from `src/hooks/useRefresh.ts` to get `{ refreshing, onRefresh }` bound to `loadAll`.

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

Typography uses **Barlow Condensed** for labels/headings/stats (condensed, bold, letterSpacing applied) and **Barlow** for body text. All font strings are in `fonts`:
```ts
fonts.barlow               // body text
fonts.barlowMedium         // medium body
fonts.barlowSemiBold       // semi-bold body
fonts.barlowCondensed      // BarlowCondensed_700Bold — primary heading font
fonts.barlowCondensedHeavy // BarlowCondensed_900Black — logo/hero
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
├── App.tsx                      # Root: font loading, store hydration, navigation container
├── index.ts                     # Expo entry point
├── src/
│   ├── api.js                   # apiGet / apiPost wrappers
│   ├── theme.ts                 # colors, fonts, radius
│   ├── hooks/
│   │   └── useRefresh.ts        # useRefresh() hook — RefreshControl bound to loadAll
│   ├── navigation/
│   │   ├── RootNavigator.tsx    # Bottom tab navigator
│   │   ├── MoreStackNavigator.tsx # Stack navigator for More tab
│   │   └── types.ts             # MoreStackParamList type
│   ├── stores/
│   │   ├── dataStore.ts         # Server data (read-only, refresh via loadAll / loadActive)
│   │   ├── pendingStore.ts      # Optimistic edit buffer
│   │   ├── prefsStore.ts        # User prefs (AsyncStorage-backed)
│   │   └── uiStore.ts           # Ephemeral UI state + toast queue
│   ├── utils/
│   │   ├── constants.js         # SC and AW column index maps
│   │   ├── data.js              # Pure data derivation functions
│   │   └── helpers.js           # Pure formatting/math utilities
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
│   │   ├── PlayerPickerModal.tsx
│   │   ├── AdminArchiveModal.tsx
│   │   ├── AdminAddPlayerModal.tsx
│   │   ├── AdminEndSeasonModal.tsx
│   │   └── AdminGenerateTeamsModal.tsx
│   └── screens/
│       ├── MatchupsScreen.tsx   # Live scoreboard + score entry
│       ├── RsvpScreen.tsx       # Weekly attendance management
│       ├── StandingsScreen.tsx  # Season/all-time standings table
│       ├── HistoryScreen.tsx    # Browse past weeks by season
│       ├── MoreHomeScreen.tsx   # Tile grid for tools/admin
│       ├── PlayerDetailScreen.tsx # Per-player stats, game log, records
│       ├── LeagueRecordsScreen.tsx # High game/series/team records
│       ├── HeadToHeadScreen.tsx # 1v1 comparison
│       ├── ChemistryScreen.tsx  # Pair/trio win-rate analysis
│       ├── SeasonHistoryScreen.tsx # Season summaries
│       ├── TrashBoardScreen.tsx # Fun leaderboard
│       └── PlayoffsScreen.tsx   # Admin: playoffs bracket
```

---

## Important Notes for Agents

1. **Data is stale until `loadAll()` is called.** Screens show `<LoadingView>` while `loading && !data`. After mutations, always call `await loadAll()` before clearing the pending buffer.

2. **All sheet data is 0-indexed 2D arrays.** Row 0 is headers. Use `SC.*` and `AW.*` constants — never hardcode column numbers.

3. **`data.js` functions are Vue-documented but used in React.** The JSDoc at the top of `data.js` describes Vue `computed()` usage — ignore that. In React, wrap these calls in `useMemo()`.

4. **No memoization inside `data.js`.** The functions are pure with no caching. Heavy calls like `getChemistry`, `getLeagueRecords`, and `aggregateStandings` scan the entire stats array on every call — always guard with `useMemo`.

5. **The `avgDisplay` preference in `prefsStore` controls avg display everywhere** — `PlayerScoreRow`, `getLeagueAvg`, and `getPlayerCurrentAvg` all accept a `source` parameter that should be driven by `avgDisplay`.

6. **No auth layer.** Any user can call any API action. Admin actions (`archiveAndAdvance`, `addPlayer`, `endSeason`) are gated only by UI accessibility, not server-side permissions.

7. **TypeScript coverage is partial.** Screens and components are `.tsx` with typed props. Stores have interfaces. Utility files (`api.js`, `data.js`, `helpers.js`, `constants.js`) are plain `.js` with JSDoc. Do not convert them to TS without confirming it's wanted.

8. **No test suite.** There are no unit or integration tests. Verify behavior manually via the Expo dev server.
