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

## Database Schema (18 tables)

> **Betting / pin economy is documented separately.** [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) is the **source of truth** for `pin_ledger` and the canonical betting tables (`bet_markets`, `bet_selections`, `bets`, `bet_legs`, `bet_offers`, `bet_matches`), the accounting model, the RPCs, and how to add a bet type. Read it before touching any `bet_*` / `pin_ledger` code. The rows below are a pointer only.

| Table | Key columns |
|---|---|
| `players` | `id`, `first_name`, `last_name`, `name`, `phone`, `role`, `user_id`, `is_active`, `created_at` |
| `seasons` | `id` (**uuid**), `number`, `bowling_night`, `start_date`, `end_date`, `registration_open`, `is_active`, `created_at`, `updated_at` |
| `weeks` | `id`, `season_id`, `week_number`, `is_archived`, `is_confirmed`, `bowled_at` |
| `rsvp` | `id`, `player_id`, `week_id`, `status`, `note`, `updated_at` |
| `teams` | `id`, `week_id`, `team_number` |
| `team_slots` | `id`, `team_id`, `slot`, `player_id`, `is_fill` |
| `games` | `id`, `game_number`, `team_a_id`, `team_b_id` |
| `scores` | `id`, `team_slot_id`, `game_id`, `score`, `updated_at` |
| `season_champions` | `id`, `player_id`, `season_id` |
| `registrations` | `id`, `season_id`, `player_id`, `created_at`, `updated_at` |
| `board_posts` | `id`, `player_id`, `message`, `created_at` |
| `pin_ledger` | `id`, `player_id` (nullable — `NULL` for house rows), `season_id`, `amount`, `type`, `description`, `is_house`, `bet_id`, `created_at`, `updated_at` |
| **betting** (canonical model) | `bet_markets`, `bet_selections`, `bets`, `bet_legs`, `bet_offers`, `bet_matches` — columns + relationships in [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) §2 |

**Key distinctions:**
- `weeks.is_archived` — `true` once the week has been bowled and scores are final. All historical queries filter to archived weeks.
- `weeks.is_confirmed` — `true` once teams have been generated and locked for the week. Used to distinguish an active (live-scoring) week from a pending one.
- `team_slots.is_fill` — `true` for league-avg fill placeholders. Excluded from personal stats but included in team totals. **Generated column** (`player_id IS NULL`) — readable but never written; a fill is simply a slot with no `player_id`.
- **`teams` is the team entity and the sole owner of `week_id`.** A team is one `(week_id, team_number)` pairing. `team_slots.team_id` (who's on the team) and `games.team_a_id`/`team_b_id` (the matchup) reference it by **plain UUID FK** (`→ teams(id)`, `ON DELETE CASCADE`). A row's week is **derived through its team** (`team_slots → teams → weeks`, `games → teams → weeks`); neither `team_slots` nor `games` stores its own `week_id`. `team_number` lives on `teams` purely for the "Team N" display label — **all matching/joining keys on the team UUID.**
- **`games` same-week invariant** is enforced by the `games_same_week` trigger (`team_a_id` and `team_b_id` must resolve to the same `teams.week_id`) — it replaces the old shared-`week_id` composite FK.
- **Week deletes cascade from `teams`.** `scores` FKs (`team_slot_id`, `game_id`) and the `team_slots`/`games` team FKs are all `ON DELETE CASCADE`, so deleting a week's `teams` rows (`teams.removeByWeek`) wipes its slots, games, and scores in one step — there is no `team_slots.removeByWeek` / `games.removeByWeek`.
- **`seasons.id` is a `uuid`** (`gen_random_uuid()`), like every other table — there are no integer/sequence keys in the schema. FKs `weeks.season_id`, `registrations.season_id`, `season_champions.season_id` are all `uuid`. In TypeScript a season id / `season_id` is a **`string`**.
- **Season lifecycle = `registration_open` + `is_active`.** A new season starts in registration (`registration_open = true`, `is_active = false`); closing registration flips it to `registration_open = false`, `is_active = true` (the live/current season); ending it sets `is_active = false`. **The current season is the one that is `is_active = true` AND `registration_open = false`** — never "highest `number`". A partial unique index (`seasons_single_active`, `WHERE is_active`) enforces **at most one active season** at a time, so activating a new season while another is still active fails until the old one is ended.
- **`registrations`** holds per-season player sign-ups, unique on `(season_id, player_id)`. `registrations.season_id` is `ON DELETE CASCADE` (deleting a season removes its sign-ups); `weeks`/`season_champions` season FKs are **not** cascade, so a season with weeks or champions cannot be deleted (an in-registration season has neither).
- **Betting + pin economy** run on the **canonical model** (`bet_markets` → `bet_selections` → `bets` → `bet_legs`, plus the deferred peer layer `bet_offers` / `bet_matches`) with funded-house **double-entry** accounting on `pin_ledger`. Over/under is the first consumer: one `bet_markets(market_type='over_under', subject_player_id, game_number)` per player×game×week with two `bet_selections` (`over`/`under`) sharing a `line`; a player's bet is a `bets` row + one `bet_legs`. Markets are derived from **RSVP** (server-side `sync_over_under_markets_for_week` RPC), line = `floor(avg)+0.5`, even odds (`2.000`), min stake 10. `pin_ledger` is the append-only balance log: per-player `balance = SUM(amount) WHERE player_id = X AND season_id = Y` (house rows have `player_id IS NULL` / `is_house = true` and are excluded). Anti-tanking (no backing `under` on your own market) is enforced by the `bet_legs_no_self_tank` trigger + the placement RPC + the UI. **Full details — accounting/lifecycle, every RPC, RLS, and how to add a bet type — are in [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md); keep that doc, not this bullet, authoritative.**

---

## db.ts Query Objects

### `boardPosts`
| Method | Description |
|---|---|
| `list()` | All posts with joined player name, newest first |
| `insert(data)` | Insert a new post |
| `remove(id)` | Delete a post by id |

### `games`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | Game rows for one week (filters via the team-a → `teams.week_id` embed) |
| `listForArchivedWeeks()` | All game rows for archived weeks (used by standings/chemistry/H2H/past-games) — includes `id`, `team_a_id`, `team_b_id`, and the week via embedded `teams(week_id)` |
| `insert(data)` | Insert one or many game rows |
| `remove(id)` | Delete by id |
| `removeByWeekAndGame(weekId, gameNumber)` | Delete a specific game (by game number) for a week — resolves the week's team ids, then deletes by `team_a_id` |

### `players`
| Method | Description |
|---|---|
| `list()` | All players, ordered by name |
| `listActive()` | Active players only |
| `getById(id)` | Single player by id |
| `getByName(name)` | Case-insensitive name match (single) |
| `getByUserId(userId)` | Single player (`id, name, role`) by auth `user_id` |
| `isRegistered(phone)` | RPC `is_registered_player` — whether a phone belongs to a registered player (login gate) |
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
| `listByWeekWithGames(weekId)` | Non-fill scores for a week with `games(game_number)` join (settlement now runs server-side in `settle_betting_for_week`) |
| `listBySeason(seasonId)` | Archived, non-fill scores for a season (for avg calc) |
| `listAllArchived()` | All archived non-fill scores |
| `listForStandings()` | Archived scores with full player/week/season join (standings, chemistry, past seasons) |
| `listForPlayerDetail()` | Archived scores with slot/week/season join (player detail screen) |
| `listForH2H()` | Archived scores with player/week/season join (head-to-head) |
| `listForLeagueRecords()` | Archived scores with player/week/season join (league records) |
| `listForPastGames()` | Archived scores with slot/team/week join — embeds `teams(team_number)` (past games screen) |
| `insert(data)` | Insert one or many scores |
| `upsert(data)` | Upsert on `team_slot_id, game_id` conflict |
| `update(id, data)` | Update a score by id |
| `removeBySlotIds(ids)` | Delete scores for a list of slot ids |
| `remove(teamSlotId, gameId)` | Delete a specific score |

### `seasonChampions`
| Method | Description |
|---|---|
| `list()` | All champions with joined player name and season |
| `listBySeason(seasonId)` | Champions for one season |
| `insert(data)` | Record a champion |
| `remove(id)` | Delete a champion record |

### `registrations`
| Method | Description |
|---|---|
| `list()` | All registrations with joined player `(id, name)` |
| `listBySeason(seasonId)` | Registrations for one season with joined player |
| `insert(data)` | Add a registration (sign a player up for a season) |
| `remove(seasonId, playerId)` | Delete a sign-up by `(season_id, player_id)` |

### `seasons`
| Method | Description |
|---|---|
| `list()` | All seasons, ordered by number |
| `getLatest()` | Highest-`number` season (single) — use **only** for computing the next season number, not "current" |
| `getCurrent()` | The current playing season: `is_active = true` AND `registration_open = false` (single). **Use this for "what season is it now"**, not `getLatest()` |
| `getLastEnded()` | Most recently ended season (`is_active = false`, `registration_open = false`, highest number) — used to look up champions when crediting the new-season champion bonus |
| `getById(id)` | Single season by id |
| `insert(data)` | Create a season |
| `update(id, data)` | Update season fields |
| `remove(id)` | Delete a season by id (admin; registrations cascade) |

### `betMarkets` (canonical over/under markets — see [PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md))
| Method | Description |
|---|---|
| `listOpenOUByWeek(weekId)` | Open `over_under` markets for a week with subject name + `bet_selections(*)` (Place Bets) |
| `listOUByWeek(weekId)` | All `over_under` markets for a week with subject name + selections (admin Bet Lines) |
| `update(id, data)` | Admin direct write — open/close a market (`status`) |
| `syncOUForWeek(weekId, extraGames?)` | RPC `sync_over_under_markets_for_week` — RSVP-driven create/refund of markets; `extraGames` adds schedule games (team-gen game 3) |
| `settle(marketId, resultValue)` | RPC `settle_market` (admin) — settle one market against the subject's actual score |
| `settleForWeek(weekId)` | RPC `settle_betting_for_week` (admin) — credit `score_credit` + settle all open markets on archive |
| `editLine(marketId, line)` | RPC `edit_over_under_line` (admin) — set the line on both selections (rejects if any bet exists) |

### `bets` (canonical stakes)
| Method | Description |
|---|---|
| `listByPlayer(playerId)` | A player's bets with `bet_legs → bet_selections → bet_markets`(+subject, +week) — newest first |
| `listByWeek(weekId)` | All bets with a leg on an `over_under` market in this week (Active Bets) |
| `listSettledBySeason(seasonId)` | All settled bets for a season with the full leg/selection/market(+week) graph (Settled Bets) |
| `place(selectionIds, stake)` | RPC `place_house_bet` — atomic, balance/anti-tank-checked; O/U passes one selection id |
| `cancel(betId)` | RPC `cancel_bet` (admin) — total undo: removes ledger pair(s) + bet, re-opens a settled market if it was the last bet |

### `pinLedger`
| Method | Description |
|---|---|
| `listByPlayerSeason(playerId, seasonId)` | All ledger entries for a player in a season — newest first. `SUM(amount)` = balance |
| `listBySeasonForLeaderboard(seasonId)` | Player entries (`is_house = false`) for a season with joined `players(name, is_active)` — for the pin-balance scoreboard |
| `insert(data)` | Insert one or many entries (champion bonus). Betting transfers are written by the RPCs, not here |

### `teamSlots`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All slots for a week with joined player name + `teams(team_number, week_id)` (filters via `teams.week_id`) |
| `listByPlayer(playerId)` | All archived slots for a player with `team_id` and the week/season join embedded under `teams` |
| `insert(data)` | Insert one or many slots |
| `update(id, data)` | Update a slot |
| `remove(id)` | Delete a slot |

### `teams`
| Method | Description |
|---|---|
| `listByWeek(weekId)` | All team rows for a week, ordered by `team_number` |
| `insert(data)` | Insert one or many teams; chains `.select()` so callers get the new ids back |
| `removeByWeek(weekId)` | Delete all teams for a week — cascades to its slots, games, and scores |

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
│             │      │ rawSchedule, │      │  games.list...         │
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

Win/loss is determined by comparing **team totals** (all players on a team including fill) per game. The `games` table defines which team faced which via `team_a_id`/`team_b_id`. All compute functions key the opponent/total maps on the **team UUID** (`team_slots.team_id` ↔ `games.team_a_id`/`team_b_id`), e.g. `` `${gameId}|${teamId}` ``. The `computeStandingsFromSupabase` function (exported from `useStandingsData.ts`) implements this and is reused by multiple screens.

### Effective avg for matchups

`useMatchupsData` computes a per-player avg from the previous season's archived scores. Fill slots and Out-RSVP'd players are assigned the league avg. This is not user-configurable.

---

## Hooks

**File:** `src/hooks/`

| Hook file | Exported hook | Exported compute functions | Used by |
|---|---|---|---|
| `useStandingsData.ts` | `useStandingsData` | `computeStandingsFromSupabase(rawScores, rawSchedule, seasonId)` | StandingsScreen, PastSeasonsScreen |
| `useMatchupsData.ts` | `useMatchupsData` | — | MatchupsScreen |
| `usePlayerDetailData.ts` | `usePlayerDetailData(name)` | `computePlayerProfile`, `computePersonalRecords`, `computeCurrentTeam`, `computeWeekRows`, `computeChartPoints(playerId, allScores, allSchedule, seasonId)`, `computeExpandedMatchups`, `computePlayerSeasons` | PlayerDetailScreen |
| `useChemistryData.ts` | `useChemistryData` | `computeChemistryFromSupabase(rawScores, rawSchedule, groupSize)` | ChemistryScreen |
| `useH2HData.ts` | `useH2HData` | `computeH2HFromSupabase(p1Name, p2Name, rawScores, rawSchedule)` | HeadToHeadScreen |
| `useLeagueRecordsData.ts` | `useLeagueRecordsData` | `computeLeagueRecordsFromSupabase(rawScores, filterSeasonId)` | LeagueRecordsScreen |
| `usePastSeasonsData.ts` | `usePastSeasonsData` | — (uses `computeStandingsFromSupabase`) | PastSeasonsScreen |
| `usePastGamesData.ts` | `usePastGamesData` | `computePastGamesFromSupabase(rawScores, rawSchedule, seasonId)` | PastGamesScreen |
| `usePlayerManagementData.ts` | `usePlayerManagementData` | — | PlayerManagementScreen |
| `useRegistrationData.ts` | `useRegistrationData` | — | RegistrationScreen |
| `useRefresh.ts` | `useRefresh(fn)` | — | All screens with pull-to-refresh |
| `useBettingData.ts` | `useBettingData(playerId)` (+ `LineView`, `BetView` types) | — | BettingScreen — returns `{ balance, openLines, myBets, weekBets, settledBets, leaderboard, myBetMarketIds, currentWeekId, currentSeasonId }`. Normalizes the market/bet graph into flat `LineView` / `BetView`. (`weekBets` = all players' bets this week via `bets.listByWeek`; `settledBets` = settled bets this season via `bets.listSettledBySeason`; `leaderboard` = active players' season pin balances from the ledger, each with `potential` = balance + Σ(`potential_payout`) over still-pending bets; sorted high → low by `potential`) |
| `useBettingAdminData.ts` | `useBettingAdminData()` (+ `AdminLineView`) | — | BettingAdminScreen — returns `{ lines, betCountByMarket, currentWeekId }` (lines = `over_under` markets flattened) |

> Stats hooks (`useStandingsData`, `usePastSeasonsData`, `usePastGamesData`, `useLeagueRecordsData`, `usePlayerDetailData`) build their `seasonList` from `seasons.list()` **filtered to started seasons** (`!registration_open`), so an in-registration season never appears as a stats filter or default. `useRegistrationData` keeps **all** seasons (registration UI needs them).

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

**File:** [src/utils/helpers.ts](src/utils/helpers.ts)

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
- `pendingScores: Record<'teamSlotId|gameNum', scoreString>` — staged score edits
- `genTeams` / `genNumTeams` / `genTeamSize` / `genAvgSource` / `genFillMode` / `genFillToSize` / `genSwapTarget` — state for the Generate Teams admin flow

Pending score key format: `"${teamSlotId}|${gameNum}"` where `gameNum` is the integer game number (1, 2, 3)

### `useUiStore` ([src/stores/uiStore.ts](src/stores/uiStore.ts))
Ephemeral UI state — toggles, selections, toast queue. All fields via `set(partial)`. Key fields:
- `matchupsView` — `'scores'` | `'expected'`
- `expandedWeek` — week id for expanded row in past seasons
- `standingsSeason` — season filter for StandingsScreen
- `playerSeason` — season filter for PlayerDetailScreen
- `recordsSeason` — season filter for LeagueRecordsScreen (`'all'` or season id string)
- `pastGamesSeason` — season filter for PastGamesScreen
- `playerLogMode` — `'bowled'` | other — controls game log display in PlayerDetailScreen
- `chemMode` — `'pairs'` | `'trios'`
- `chemExpanded` — boolean, whether chemistry rows are expanded
- `h2hP1`, `h2hP2` — selected player names for head-to-head
- `oddsRevealed` — easter egg toggle on matchup screen
- `toasts` — call `showToast(msg, type)` to show an auto-dismissing toast; display time scales with message length (2.4s–10s) so long DB errors stay readable

---

## Navigation Architecture

**Root:** Bottom tabs (`@react-navigation/bottom-tabs`)

| Tab label | Navigator / Screen | Route name |
|---|---|---|
| Standings | StandingsStackNavigator | `Standings` |
| RSVP | RsvpScreen | `RSVP` |
| This Week | MatchupsScreen | `Matchups` |
| Betting | BettingScreen | `Betting` |
| More | MoreStackNavigator | `More` |

> The **Betting** tab is a top-level bottom-tab screen (after This Week). It renders `AppHeader` (no back button) like the other tabs. `BettingAdminScreen` remains in the More stack (admin "Bet Lines").

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
| `PastSeasons` | PastSeasonsScreen — season-by-season summary |
| `TrashBoard` | TrashBoardScreen |
| `Playoffs` | PlayoffsScreen |
| `PlayerManagement` | PlayerManagementScreen — add, edit, and toggle active/inactive players |
| `PastGames` | PastGamesScreen — browse historical week rosters and scores by season |
| `Registration` | RegistrationScreen — per-season sign-ups; admins open/close registration, manage the roster, and delete an open season |
| `BettingAdmin` | BettingAdminScreen — toggle bet lines open/closed for current week, shows bet counts per line, and edit a line's value while it has no bets (admin only) |

**Betting tab** (top-level, after This Week) — BettingScreen: balance card + four toggled views (horizontally-scrollable pills): **Leaderboard** (default; pin-balance scoreboard of active players, season balances summed from the ledger, Standings-style, with an "If Win" column = projected balance if all that player's still-pending bets win, sorted descending by that projection), **Place Bets** (open per-game over/under lines, bet placement modal, my bets history), **Active Bets** (league-wide summary of all players' *unsettled* bets this week, grouped by game; admins tap a bet to manually settle its line), and **Settled Bets** (all settled won/lost/push bets this season, grouped by week, newest first).

**Cross-tab navigation to PlayerDetail** (e.g. from More tab):
```tsx
(navigation as any).navigate('Standings', { screen: 'PlayerDetail', params: { name } })
```

---

## Component Inventory

| Component | Purpose |
|---|---|
| `AppHeader` | App logo + current Week/Season badge, reads from Supabase (`weeks.getCurrent`, `seasons.getCurrent`) |
| `ScreenHeader` | Reusable titled header for inner screens |
| `Toast` | Absolute-positioned animated toast, reads from `uiStore.toasts`. **Render a `<Toast />` inside any RN `<Modal>` that calls `showToast`** — the app-root `<Toast />` (App.tsx) sits behind the native modal layer and is occluded while a modal is open (see Key Patterns) |
| `ConfirmBar` | Sticky bottom bar for pending saves (RSVP, scores) |
| `PlayerScoreRow` | One player row in the live matchup view — editable score input or expected avg display |
| `OddsBlock` | Betting-style spread + moneyline card (easter egg, `Expected` mode only) |
| `LoadingView` | Centered spinner with label |
| `PillFilter` | Horizontal pill-style filter row for season/week selectors |
| `ToggleGroup` | Segmented toggle control for multi-option switches |
| `HistoricalTeamBlock` | Team block for displaying archived week rosters |
| `ProfileMenuModal` | Bottom sheet opened from the avatar in `AppHeader` — shows player identity and per-user actions (My Profile, Log Out) |
| `PlayerPickerModal` | Full-screen player search/select for H2H |
| `AdminArchiveModal` | Confirm dialog — archives active week (`is_archived = true`, creates next week row), then calls the `settle_betting_for_week` RPC: credits game scores to the ledger and auto-settles all open O/U markets (double-entry) |
| `AdminEndSeasonModal` | Confirm dialog — records season champions and marks the current season ended (`is_active = false`); reads the current season via `seasons.getCurrent()` |
| `AdminOpenRegistrationModal` | Create the next season (`seasons.insert` with `registration_open = true`) and open its registration window; next number derived from `seasons.getLatest()`; credits +100 pin champion bonus to prior-season champions |
| `AdminGenerateTeamsModal` | Generate balanced teams from RSVP list, preview swaps, write teams/slots/schedule to Supabase. **Not the source of base O/U markets** (those come from RSVP) — after gen it calls `sync_over_under_markets_for_week(weekId, scheduleGames)`, which adds markets for any schedule game number not yet present (game 3 when `numTeams ∈ {3,5}`), idempotently |

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

### Toasts inside modals
The app-root `<Toast />` (App.tsx) renders behind any React Native `<Modal>`, so a `showToast` call made while a modal is open is **invisible** (occluded by the native modal layer). Any `<Modal>` that calls `showToast` must render its **own `<Toast />` as the last child inside the Modal** — it reads the same global `uiStore.toasts`, so it just surfaces the toast above the modal. All admin modals and `PlayerManagementScreen` follow this.

### Pending / optimistic score edits
`usePendingStore.pendingScores` holds unsaved score changes. `MatchupsScreen` renders them immediately and shows a `ConfirmBar`. On save, `scores.upsert` is called, then `reload()` refreshes from Supabase, then the pending buffer is cleared. On discard, pending is just cleared.

### Admin flows (all Supabase direct)
- **Archive week** (`AdminArchiveModal`) — sets `weeks.update(id, { is_archived: true })`, calls the `settle_betting_for_week` RPC (credits game scores as `score_credit`, settles all open O/U markets with double-entry payouts), then inserts a new week row for the next week number
- **Add/edit player** (`PlayerManagementScreen`) — inline modal calls `players.insert` or `players.update`; first name, last name, and phone are all required
- **End season** (`AdminEndSeasonModal`) — writes `season_champions.insert` for selected champions and sets `seasons.update(currentId, { is_active: false })`; the current season is resolved via `seasons.getCurrent()` (not the highest number)
- **Open registration** (`AdminOpenRegistrationModal`) — `seasons.insert` for the next season with `registration_open = true, is_active = false`; the new number is `getLatest().number + 1`; after insert, queries `seasons.getLastEnded()` + `seasonChampions.listBySeason` and inserts `+100` `champion_bonus` ledger entries for each champion into the new season
- **Registration management** (`RegistrationScreen`, admin) — open/close registration (`seasons.update` toggling `registration_open`/`is_active`), add/remove players via `registrations.insert`/`registrations.remove`, and **delete an open season** via `seasons.remove` (confirmed). Closing registration sets `is_active = true`, which fails if another season is already active (single-active index) — end the current season first
- **Generate teams** (`AdminGenerateTeamsModal`) — reads RSVP + player avgs, computes balanced teams client-side, previews swaps, then wipes the week with a single `teams.removeByWeek` (cascades slots → games → scores) and writes `teams.insert` (capturing the new ids) → `team_slots.insert` + `games.insert` → `weeks.update(..., { is_confirmed: true })`. It does **not** create base O/U markets (RSVP owns those; markets reference `weeks` not `teams`, so the wipe leaves them intact) — after gen it calls `betMarkets.syncOUForWeek(weekId, scheduleGames)` to add any missing schedule game (game 3 when `numTeams ∈ {3,5}`), idempotently
- **Betting flows** (`BettingScreen`, `BettingAdminScreen`, `RsvpScreen`) — RSVP→market sync, place bet, settle, cancel, edit line, open/close are all **server-side RPCs on the canonical model** (`sync_over_under_markets_for_week`, `place_house_bet`, `settle_market`, `cancel_bet`, `edit_over_under_line`, + admin `UPDATE bet_markets.status`). The UI mirrors the server guards (min stake 10, balance, anti-tanking). Avg/line candidate logic for the admin line editor lives in [src/utils/betLines.ts](src/utils/betLines.ts) (`lineForAvg`, `computeAvgById`). **For the exact mechanics of every flow, accounting, and integrity rules, see [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) §4–§5 — keep it authoritative.**

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
│   │   ├── useBettingAdminData.ts  # Lines + bet counts for BettingAdminScreen
│   │   ├── useBettingData.ts    # Balance + open lines + my bets for BettingScreen
│   │   ├── useChemistryData.ts  # Chemistry data + computeChemistryFromSupabase
│   │   ├── useH2HData.ts        # H2H data + computeH2HFromSupabase
│   │   ├── useLeagueRecordsData.ts  # League records + computeLeagueRecordsFromSupabase
│   │   ├── useMatchupsData.ts   # Active week matchup data (full derivation in hook)
│   │   ├── usePastGamesData.ts  # Past games by season + computePastGamesFromSupabase
│   │   ├── usePastSeasonsData.ts  # Past seasons raw data (screen reuses computeStandingsFromSupabase)
│   │   ├── usePlayerDetailData.ts   # Player data + many compute* functions
│   │   ├── usePlayerManagementData.ts  # Raw player list for PlayerManagementScreen
│   │   ├── useRegistrationData.ts  # Registrations + seasons + roster for RegistrationScreen
│   │   ├── useRefresh.ts        # useRefresh(fn) — RefreshControl helper
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
│   │   ├── betLines.ts          # lineForAvg (floor+0.5), computeAvgById — shared bet-line avg/line logic
│   │   ├── helpers.ts           # initials, timeAgo, combinations, spreadAndML
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
│   │   ├── AdminOpenRegistrationModal.tsx
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
│       ├── RegistrationScreen.tsx   # Per-season sign-ups + admin registration management
│       ├── LeagueRecordsScreen.tsx  # High game/series/team records
│       ├── HeadToHeadScreen.tsx     # 1v1 player comparison
│       ├── ChemistryScreen.tsx      # Pair/trio win-rate analysis
│       ├── PastSeasonsScreen.tsx    # Past seasons — season-by-season summary
│       ├── BettingAdminScreen.tsx   # Admin: toggle bet lines open/closed
│       ├── BettingScreen.tsx        # Balance, open O/U lines, bet placement, my bets
│       ├── TrashBoardScreen.tsx     # Fun message board
│       └── PlayoffsScreen.tsx       # Admin: playoffs bracket
```

---

## Page Creation

You must ALWAYS reference [PAGE_CREATION.md](PAGE_CREATION.md) when working on new pages or editing existing pages.

It contains hook patterns, screen skeleton, navigation wiring, database migration workflow, and type regeneration. Follow it when adding any new screen or making schema changes.

---

## Important Notes for Agents

1. **All data comes from Supabase.** 

2. **All database queries MUST be implemented in `db.ts`.** Queries like `scores.listForStandings()` join the right tables in one round-trip. Avoid building ad-hoc joins from raw `supabase` client calls; add a new method to `db.ts` if needed.

3. **Archived = historical.** All stat computation queries filter `is_archived = true`. The current/active week is identified by `is_archived = false` (and `is_confirmed = true` for live scoring).

4. **Compute functions are pure.** Functions like `computeStandingsFromSupabase` scan full data arrays on every call with no caching. Always wrap in `useMemo` at the screen level.

5. **Hook files export both the hook and compute functions.** If you need the derived data type shape, import it from the hook file (e.g. `StandingsRow` from `useStandingsData.ts`).

6. **No memoization inside hooks or compute functions.** Caching is the screen's responsibility via `useMemo`.

7. **All source files are TypeScript.** Screens, hooks, and utilities are fully typed `.ts`/`.tsx`.

8. **No test suite.** Verify behavior manually via the Expo dev server (`expo start`).

9. **Auth layer is active.** Phone OTP login is required. User identity is derived from `auth.users` and linked to `players` via `players.user_id`. The `useAuthStore` exposes `userId`, `playerId`, `playerName`, and `role`. See [supabase/AUTH.md](supabase/AUTH.md) for the full architecture — JWT hook, trigger, RLS patterns, and role management.

10. **`useRefresh` requires a function argument.** Pass the `reload` from the screen's data hook: `useRefresh(reload)`. It is not bound to a global store refresh.

11. **Supabase CLI requires `SUPABASE_ACCESS_TOKEN` — no MCP server is configured.** Always load the token from `app/.env.local` and use `--linked` with `--workdir` pointing to the repo root. Never run `supabase` commands without this setup or they will fail with 401.

  ```bash
  SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2) \
    supabase db query --linked --workdir $(pwd) \
    "SELECT ..."
  ```
  Project ref: `lyihsvxraurjghjqxaau` — URL: `https://lyihsvxraurjghjqxaau.supabase.co`

12. **ALL database changes MUST go through migration files — never write to the database directly.** This is a hard rule with no exceptions. Every schema change (DDL: `CREATE`, `ALTER`, `DROP`, index additions, RLS policy changes, trigger changes, etc.) MUST be written as a `.sql` file in `supabase/migrations/` and applied via `supabase db push`. The Supabase CLI may ONLY be used for two purposes:
    - **Reading** — `supabase db query` to inspect the current database state and confirm schema or data.
    - **Pushing migrations** — `supabase db push` to apply a migration file you have already written to `supabase/migrations/`.

  Never use `supabase db query` (or any other tool) to execute `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, or any other write statement against the live database. If a change needs to be made, write a migration file first.

  **Creating a migration file:** Always use the CLI to generate the file — never create it manually. This ensures the timestamp prefix is correct and consistent:
  ```bash
  SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2) \
    supabase migration new short_description --workdir $(pwd)
  ```
  This creates an empty `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql` file. Write your SQL into that file, then push it. **`--workdir` must be the repo root** (`migration new` writes to `<workdir>/supabase/migrations/`) — pointing it at `supabase/migrations` nests the file at `supabase/migrations/supabase/migrations/`.

  **To apply a migration:**
  ```bash
  SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2) \
    supabase db push --linked --workdir $(pwd)
  ```

  **Why:** Migration files are version-controlled and reversible. Direct writes bypass this safety net and make schema drift impossible to track or roll back.

13. **"Current season" ≠ highest `number`.** The current season is `is_active = true` AND `registration_open = false` — query it with `seasons.getCurrent()`. `seasons.getLatest()` (highest `number`) exists only to compute the *next* season number; using it for "current" mis-selects a season that is still in registration. Stats season lists exclude in-registration seasons (`!registration_open`). At most one season can be `is_active` (enforced by the `seasons_single_active` partial unique index).

14. **All ids are `uuid` / TypeScript `string`.** No table uses integer/sequence keys. When adding season-related code, season ids and `season_id` are `string`.
