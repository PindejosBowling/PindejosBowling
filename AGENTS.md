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
| `players` | `id`, `first_name`, `last_name`, `name`, `phone`, `role`, `user_id`, `is_active`, `avatar_path`, `created_at` |
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
| `update(id, data)` | Update player fields (incl. `avatar_path`) |

### `avatars` (player profile pictures — private `avatars` storage bucket)
| Method | Description |
|---|---|
| `upload(path, body, contentType)` | Upsert a photo to the `avatars` bucket; `path` = `<playerId>.jpg`. **Admin-only** (storage RLS) |
| `remove(path)` | Delete a photo from the bucket. **Admin-only** |
| `signedUrls(paths, expiresIn?)` | Batch-create signed download URLs (default 1h) — bucket is private, so reads need signed URLs |

> **Profile pictures:** images live in a **private** `avatars` Storage bucket. Storage RLS: any **`authenticated`** user can read (via signed URLs); only **`admin`** can INSERT/UPDATE/DELETE (mirrors the `(auth.jwt()->'app_metadata'->>'role')='admin'` pattern). `players.avatar_path` holds the storage key (`NULL` = no photo → UI falls back to initials). Admins set/delete photos on behalf of players from the **Profile Pictures** screen — there is no self-service upload. Signed URLs are cached centrally in `useAvatarStore` and rendered via the `<PlayerAvatar>` component.

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
| `setOUStatusByWeekGame(weekId, gameNumber, status)` | Admin per-game open/close — flips all `over_under` markets for a week's game number to `'open'`/`'closed'` (only toggles rows currently in the opposite status) |
| `syncOUForWeek(weekId, extraGames?)` | RPC `sync_over_under_markets_for_week` — RSVP-driven create/refund of markets; `extraGames` adds schedule games (team-gen game 3) |
| `settle(marketId, resultValue)` | RPC `settle_market` (admin) — settle one market against the subject's actual score |
| `settleForWeek(weekId)` | RPC `settle_betting_for_week` (admin) — credit `score_credit` + settle all open markets on archive |

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
| `listByPlayerSeason(playerId, seasonId)` | All ledger entries for a player in a season — newest first. `SUM(amount)` = balance. Embeds `weeks(week_number)` + the bet graph (`bets(*, players(name), <LEG_GRAPH>)`) off `bet_id` so a `bet_*` row can render full bet detail (see **Betting display components**) |
| `listHouseBySeason(seasonId)` | House-side rows for a season (`is_house = true`) — the betting counterparty + bonus funder. Same `weeks` + bet-graph embed as above. Drives PinsinoAccountingScreen (Activity) |
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
| `usePinsinoData.ts` | `usePinsinoData(playerId)` (+ `LineView`, `SelectionView`, `LineGroup`, `LineCategory`, `BetView`, `LegView` types; `normalizeBet` compute fn + the market-type seam helpers `selectionBetsAgainstSubject` / `lineGroup` / `lineCategory` / `closedBettingNote`) | `normalizeBet(raw)` — collapse a bet → legs → selections → markets graph into a flat `BetView`; **see [Betting Line Board](#betting-line-board--place-bets-composition) for the line/selection shapes + seam helpers** | PinsinoScreen, PinsinoLeaderboardScreen, SportsbookScreen — returns `{ balance, openLines, myBets, weekBets, settledBets, leaderboard, myBetMarketIds, currentWeekId, currentSeasonId }`. Normalizes the market/bet graph into flat `LineView` (one market + its `SelectionView[]`) / `BetView`. (`weekBets` = all players' bets this week via `bets.listByWeek`; `settledBets` = settled bets this season via `bets.listSettledBySeason`; `leaderboard` = active players' season pin balances from the ledger, each with `potential` = balance + Σ(`potential_payout`) over still-pending bets; sorted high → low by `potential`) |
| `usePlayerPinsinoData.ts` | `usePlayerPinsinoData(playerId)` (+ `LedgerEntry` type) | — | PlayerPinsinoScreen — one player's betting record. Returns `{ balance, ledger, openBets, settledBets }`. `ledger` is `LedgerEntry[]` (each with `weekNumber` + a normalized `bet` for `bet_*` rows); `openBets`/`settledBets` are `BetView[]`. **`LedgerEntry` is the shared ledger-row type** imported by `useHousePinsinoData` + both ledger screens |
| `useHousePinsinoData.ts` | `useHousePinsinoData()` (+ `HouseSummary`, `WeekPnl`, `HouseStats` types) | — | PinsinoAdminScreen, PinsinoAccountingScreen, PinsinoSportsbookScreen — the **house** side of the pin economy (`is_house` rows). Returns `{ balance, ledger, summary, weekPnl, exposure, stats, seasonNumber, weekBets, settledBets }` for the current season: `summary` = stakes/payouts/refunds/bonuses, `weekPnl` = per-week house net, `exposure` = Σ potential payout over this week's pending bets, `stats` = settled record + hold%, `weekBets`/`settledBets` = the normalized `BetView[]` (already fetched for exposure/stats) that feed the Sportsbook screen's `ActiveBetsView` / `SettledBetsView`. Reuses `LedgerEntry` / `normalizeBet` |

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

## Player Badges

**File:** [src/utils/badges.ts](src/utils/badges.ts) + [src/components/PlayerBadges.tsx](src/components/PlayerBadges.tsx)

Status emojis shown next to a player's name (e.g. 👑 next to the reigning champion in Standings). The system is a declarative **rule list**, not scattered inline conditions.

- `badges.ts` holds the single `BADGE_RULES` array — the **source of truth** for every status → emoji mapping. Each rule is `{ key, emoji, label, applies(playerId, ctx) }`, where `applies` is a pure predicate over a `BadgeContext` (data the screen already loads — currently `lastSeasonChampionIds` + `standings`). `badgesForPlayer(playerId, ctx)` returns all matching `Badge`s.
- Array order = display/priority order; a player can match multiple rules and show multiple emojis.
- `PlayerBadges` is a thin presentational component that just joins the emojis.

**To add a new emoji rule:** append one entry to `BADGE_RULES` in `badges.ts`. If the predicate needs data not yet in `BadgeContext`, add the field to the `BadgeContext` type, populate it where the context is built (e.g. the `badgesByPlayer` `useMemo` in StandingsScreen), and have the hook expose any new raw data. No screen render changes are needed — screens read badges via the `badgesByPlayer` map.

> The champion badge is intentionally scoped to the **reigning** champion only — `useStandingsData` builds `championPlayerIds` from `seasons.getLastEnded()` → `seasonChampions.listBySeason()`, not all-time `seasonChampions.list()`.

---

## State Management

Four Zustand stores — all imported as `useXxxStore` hooks:

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

### `useAvatarStore` ([src/stores/avatarStore.ts](src/stores/avatarStore.ts))
Central signed-URL cache for player profile pictures. `load()` fetches `players.list()`, batch-signs every non-null `avatar_path` via `avatars.signedUrls()`, and builds `byId` (playerId → url) and `byName` (lowercased name → url) maps. Called once on sign-in (in [App.tsx](App.tsx), gated on `role` since signed-URL reads need auth) and re-run after admin upload/delete. The `<PlayerAvatar>` component reads it; list screens that only have a player name still resolve a photo via `byName`.

---

## Navigation Architecture

**Root:** Bottom tabs (`@react-navigation/bottom-tabs`)

| Tab label | Navigator / Screen | Route name |
|---|---|---|
| Standings | StandingsStackNavigator | `Standings` |
| RSVP | RsvpScreen | `RSVP` |
| This Week | MatchupsScreen | `Matchups` |
| Pinsino | PinsinoStackNavigator | `Pinsino` |
| More | MoreStackNavigator | `More` |

> The **Pinsino** tab (route `Pinsino`, label "Pinsino", 🏦 icon) is a native stack navigator (after This Week). Its `PinsinoHome` screen renders `AppHeader` (no back button) like the other tabs.

**Pinsino tab** is a native stack navigator:

| Route | Screen |
|---|---|
| `PinsinoHome` | PinsinoScreen — hub: balance card + top-3 leaderboard preview + tile menu |
| `PinsinoLeaderboard` | PinsinoLeaderboardScreen — full pin-balance leaderboard ("Titans of Pindustry"); uses `PinsinoLeaderboardTable` (no limit) |
| `Sportsbook` | SportsbookScreen — Place Bets / Active Bets / Settled Bets toggle; bet placement, parlay slip, `BetDetailModal` (public; read-only Active/Settled) |
| `PlayerPinsino` | PlayerPinsinoScreen — one player's betting record; receives `{ playerId, name }` (opened by tapping a leaderboard row) |

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
| `ProfilePictures` | ProfilePicturesScreen — admin uploads/deletes player profile photos on behalf of any player (admin only) |
| `PastGames` | PastGamesScreen — browse historical week rosters and scores by season |
| `Registration` | RegistrationScreen — per-season sign-ups; admins open/close registration, manage the roster, and delete an open season |
| `PinsinoAdmin` | PinsinoAdminScreen — **admin-only** hub: tile menu with Accounting and Sportsbook subpages |
| `PinsinoAccounting` | PinsinoAccountingScreen — **admin-only** house ledger: House Balance collapsible statement card + Activity / Weekly P&L toggle |
| `PinsinoSportsbook` | PinsinoSportsbookScreen — **admin-only** Active Bets / Settled Bets toggle; admin settle (`SettleBetModal`) and cancel (`cancel_bet`) actions |

**PinsinoHome** (hub) — PinsinoScreen renders a **balance card** (tap → your own `PlayerPinsino`) + a **"TITANS OF PINDUSTRY" header row** (tap "VIEW ALL ›" → `PinsinoLeaderboard`) + a top-3 preview via `<PinsinoLeaderboardTable limit={3} />` + a **tile menu** (currently one tile: **Sportsbook** 🏟️ → `Sportsbook`). Add future tiles to `MENU_TILES` in that screen.

**PinsinoLeaderboardScreen** — full leaderboard via `<PinsinoLeaderboardTable />` (no limit). Pin-balance scoreboard of active players, season balances summed from the ledger, Standings-style, with an "Upside" column = projected balance if all that player's still-pending bets win, sorted descending. Tap a row → `PlayerPinsino`.

**SportsbookScreen** (`Pinsino` stack) — public betting: **Place Bets** (open markets as collapsible board — see **Betting Line Board**), **Active Bets** (read-only `ActiveBetsView`), **Settled Bets** (read-only `SettledBetsView`) toggled via `ToggleGroup`. Single and parlay placement, sticky parlay slip, `BetDetailModal`. `<Toast />` inside each `<Modal>`.

**PinsinoAdminScreen** (hub) — pure tile menu: **Accounting** 📒 → `PinsinoAccounting`, **Sportsbook** 🏟️ → `PinsinoSportsbook`. No content of its own beyond the admin gate.

**PinsinoAccountingScreen** (`More` stack, admin-only) — house financials: collapsible **House Balance** statement card (stats: W-L-P record, hold%, exposure, biggest payout/take; ledger flows: stakes taken, payouts, refunds, bonuses; `signed()` helper for ± display) + season subtitle (`SEASON N · THE HOUSE`) + **Activity / Weekly P&L** toggle. Activity groups house ledger rows by week via `LedgerRow`; P&L lists per-week house net. Uses `useHousePinsinoData()`.

**PinsinoSportsbookScreen** (`More` stack, admin-only) — admin bet management: **Active Bets / Settled Bets** toggle. Active: tap a bet → `SettleBetModal` to settle its line(s); ✕ → confirm-cancel via `bets.cancel`. Settled: tap → `BetDetailModal`; ✕ → confirm-cancel. Uses `useHousePinsinoData()`.

**PlayerPinsinoScreen** (`Pinsino` stack) and **PinsinoAccountingScreen** (`More` stack) are the two opposite sides of one player↔house ledger. Each has an **Activity** view built from `LedgerRow` (player `perspective` vs. house `perspective`); PlayerPinsino adds Open / Settled Bets tabs (`BetRow`), PinsinoAccounting adds Weekly P&L. **Admin settle/cancel lives on PinsinoSportsbookScreen** (tap an active single bet → `SettleBetModal`; ✕ on any bet → cancel via `cancel_bet`).

**Cross-tab navigation to PlayerDetail** (e.g. from More tab):
```tsx
(navigation as any).navigate('Standings', { screen: 'PlayerDetail', params: { name } })
```

---

## Component Inventory

| Component | Purpose |
|---|---|
| `AppHeader` | App logo + current Week/Season badge, reads from Supabase (`weeks.getCurrent`, `seasons.getCurrent`). Top-right avatar is a `<PlayerAvatar>` opening `ProfileMenuModal` |
| `PlayerAvatar` | Player profile picture (`{ name?, playerId?, size }`) — resolves a signed URL from `useAvatarStore` (by id, else by name) and renders `<Image>`, falling back to an `initials()` circle. Used in AppHeader, PlayerDetailScreen, ProfilePicturesScreen |
| `PlayerBadges` | Renders a player's status emojis inline (`{ badges, style? }`) — takes a `Badge[]` from `badgesForPlayer()` and joins their emojis after the name. Renders nothing when empty. Used in StandingsScreen. See **Player Badges** |
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
| `PinsinoLeaderboardTable` | Shared pin-balance leaderboard table (`{ leaderboard, playerId, limit?, onRowPress }`). Renders rank badge, name with movement arrows ▲▼, balance, and Upside (projected balance if all pending bets win) columns. `limit` caps the rows shown (e.g. `3` for the PinsinoScreen preview; omit for full list). Used by PinsinoScreen (top-3 preview) and PinsinoLeaderboardScreen (full list) |

### Betting display components

These render the betting/pin-economy UI and are reused across SportsbookScreen (public), PinsinoSportsbookScreen (admin), and the two ledger screens. They all consume the flat `BetView` (from `usePinsinoData.ts`) so a bet looks identical everywhere it appears. **`ActiveBetsView` and `SettledBetsView` are the shared "list of bets" surfaces** — both SportsbookScreen (read-only) and PinsinoSportsbookScreen (admin-actionable) render the same component; the *only* difference is which callbacks they pass.

| Component | Purpose |
|---|---|
| `ActiveBetsView` | Shared **Active Bets** surface (`{ bets, hint?, onBetPress?, onParlayPress?, onCancelBet? }`). Renders a wager summary (BETS / PINS WAGERED / BETTORS) + this week's pending bets grouped by game (parlays bucketed on their own), each via `BetRow`. Self-contained grouping. Callbacks are optional: SportsbookScreen passes `onBetPress`/`onParlayPress` = open `BetDetailModal` (read-only); PinsinoSportsbookScreen passes `onBetPress` = open `SettleBetModal`, `onParlayPress` = details, `onCancelBet` = confirm-cancel, plus a `hint` |
| `SettledBetsView` | Shared **Settled Bets** surface (`{ bets, onBetPress?, onCancelBet? }`). This season's settled bets grouped by week (newest first), each via `BetRow`. SportsbookScreen passes `onBetPress` = details; PinsinoSportsbookScreen adds `onCancelBet` = confirm-cancel |
| `SettleBetModal` | Admin single-market settlement overlay (`{ bet, onClose, onSettled }`). Self-contained: takes an actual-score input, calls `settle_market` via `betMarkets.settle(bet.marketId, score)`, toasts, and calls `onSettled` (reload). **Mount conditionally** (`{settleBet && <SettleBetModal …/>}`) so the input resets between opens. Used only by PinsinoSportsbookScreen |
| `BetRow` | One bet row in a betting list (`{ bet, isLast, badge, betReturnText, onPress?, onCancelPress? }`). Renders a single bet or parlay — `subject · PICK line · G#`, or one line per leg — with its status badge (or `PENDING`) and signed return. **Presentational**: the row is tappable when given an `onPress` and shows an inline cancel (✕) when given an `onCancelPress` — callers gate those (read-only surfaces omit them; admin surfaces pass them). Used by `ActiveBetsView` / `SettledBetsView` and in PinsinoScreen (My Bets) / PlayerPinsinoScreen (Open / Settled Bets) |
| `LedgerRow` | One `pin_ledger` activity row (`{ entry, perspective, isLast }`) — the **single shared renderer for both ledger surfaces**. Shows the bet specifics when the entry carries an associated `bet` (`subject · PICK line · G#`, or per-leg for parlays), else the raw `description`; plus an **action label** derived from `(type, perspective)` (`BET PLACED`/`BET TAKEN`, `WINNING PAYOUT`, `PUSH · REFUND`, `GAME SCORE`, `BONUS`), the bettor name on the house side, the date, and the signed amount (gold for bonuses). `perspective` = `'player'` \| `'house'`. **Bet-backed rows are tappable** and open the shared `BetDetailModal`; mint rows (score / bonus) render as static `View`s. Used in PlayerPinsinoScreen (Activity) + PinsinoAccountingScreen (Activity) |
| `BetDetailModal` | Shared **"Bet Details" overlay** (`{ bet: BetView \| null, onClose }`; renders `null` when `bet` is null). The canonical single-bet breakdown: bettor / season / week, a **consolidated leg view for 1+ legs** (a single bet is just one leg — labeled `SELECTION`, parlays `LEGS (N)`), then wager / status / return. Each leg shows `subject · PICK line · G#` and, once settled, a ` -- ` divider followed by the leg's actual score **color-coded to its win/loss/push outcome** (status word is not repeated — the bet `status` row reports it once). Also **exports the `resultBadge(status)` and `betReturnText(bet)` helpers** (status→badge color/label; signed return text) reused by BetRow callers. Opened from `BetRow` taps (SportsbookScreen + PinsinoSportsbookScreen Active/Settled) and `LedgerRow` taps (both ledger Activity tabs) |

> **Ledger Activity is bet-aware.** `pinLedger.listByPlayerSeason` / `listHouseBySeason` embed the bet graph (`bets(*, players(name), <LEG_GRAPH>)`) off `pin_ledger.bet_id`; the hooks (`usePlayerPinsinoData`, `useHousePinsinoData`) normalize it onto each `LedgerEntry.bet` via `normalizeBet`, so a `bet_*` ledger row can render the same bet detail (and open the same overlay) as the Bets tabs. `score_credit` / `bonus` rows have no `bet_id` → `bet` is `null`.

---

## Betting Line Board — Place Bets composition

The **Place Bets** view in [src/screens/SportsbookScreen.tsx](src/screens/SportsbookScreen.tsx) renders open betting markets as a board of collapsible sections. It is built as a **reusable, market-type-agnostic stack** so new market kinds (moneylines, props, team totals, season-long futures) drop in by adding data + a few pure helpers — **with no new rendering code**. Over/under is the first and currently only consumer. **Read this before adding a market type to the board.** (Schema/RPC side of adding a bet type lives in [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) §7 — keep that authoritative; this section is the **UI** counterpart.)

### The layers (data → screen)

```
usePinsinoData.ts                         (data shapes + market-type seams)
  LineView  ── normalizeMarket(raw) ──  one bettable market, flattened
  SelectionView                          one bettable side (over/under/yes/…)
  helpers: lineGroup · lineCategory · selectionBetsAgainstSubject · closedBettingNote
        │  openLines: LineView[]
        ▼
SportsbookScreen   groups openLines:  game group → line category → lines
        │
        ▼
LineRowContainer   collapsible section (one per category; owns its own collapse state)
        │
        ▼
LineRow            one market row; renders N selection buttons from line.selections
```

### Data shapes (`usePinsinoData.ts`)

- **`SelectionView`** — one `bet_selections` row, flattened: `{ selectionId, key, label, line, odds }`. `key` is the stable side key (`'over'`, `'under'`, `'yes'`, a player id, …); `label` is the display text (rendered uppercased). **Generic** — carries any side, not just over/under.
- **`LineView`** — one market + its selections: `{ marketId, marketType, title, subjectPlayerId, subjectName, gameNumber, line, selections: SelectionView[], inProgress }`. `line` is the **shared** line only when every selection agrees on one (the O/U case); otherwise `null`. `inProgress` = market closed for betting (`status = 'closed'`). `gameNumber` is **nullable** (season-long markets have none).
- `normalizeMarket(raw)` builds a `LineView` from the `MARKET_GRAPH` embed (`bet_selections(*)`), sorting selections by `sort_order`. The hook's `openLines` is `LineView[]`.

### Market-type seams — the **only** places that branch on `market_type`

All four are **pure, exported** functions in `usePinsinoData.ts`. Adding a market type means adding a `case` here, not touching the components.

| Helper | Returns | Role |
|---|---|---|
| `selectionBetsAgainstSubject(marketType, selectionKey)` | `boolean` | **Anti-tanking.** `true` for the side that bets *against* the subject (the `under` on O/U). The screen blocks a player backing this on their own market — also enforced by the `bet_legs_no_self_tank` trigger + the `place_house_bet` RPC (defense in depth). |
| `lineGroup(line)` | `LineGroup {key,label,sortOrder}` | The **outer** section (a game heading). Per-game → `GAME N`; no game → `SEASON` (sorts last). |
| `lineCategory(line)` | `LineCategory {key,label,sortOrder}` | The **inner** collapsible section — one `LineRowContainer`. `over_under` → `Player Over/Unders`; `moneyline` → `Moneylines`; else a `title`-based fallback. |
| `closedBettingNote(line)` | `string` | The italic in-progress note copy, market-type aware (game vs. non-game wording). |

### Grouping (two levels, in SportsbookScreen)

`openLines` is bucketed **game group → line category → lines** in one `useMemo`. The screen renders a plain `GAME N` heading (from `lineGroup`), and under it **one `<LineRowContainer>` per category** (from `lineCategory`). So a single game can show several independently-collapsible sections — Player Over/Unders today, Team Totals / Moneylines later. Containers **start collapsed** (`defaultCollapsed`); the collapsed bar summarizes the category (`label` + `N LINES` count). `SEASON`-scoped markets form their own outer group at the end.

### Components

- **`LineRow`** (`{ line, isLast, inProgress?, selectionState?, onSelect? }`) — presentational row for one market. Subject + shared line on the left; **one pick button per `line.selections`** on the right (data-driven, never hardcoded over/under). Mirrors `BetRow`'s "callers gate the callbacks" design:
  - `onSelect(sel)` — what a tap does. Omitted / `inProgress` → inert pills.
  - `selectionState(sel) → { selected?, disabled? }` — **cosmetic only**. `disabled` dims a button but leaves it **pressable**, so the screen's handler still runs (e.g. to toast the anti-tank message). Pressability is governed solely by `inProgress` / presence of `onSelect`.
- **`LineRowContainer`** (`{ title, count, note?, defaultCollapsed?, rows }`) — a collapsible section wrapping a set of rows. **Owns its own collapse state**, so each instance toggles independently of the others; the header is a tappable summary bar (title + `N LINES` + ▾/▸ chevron) and is the primary affordance when collapsed. Presentational — the screen builds the rows. `rows` is a `CollapsibleRow[]` of `{ key, pinned?, render(isLast) }`: the container owns the **visible set** (collapsed → `pinned` rows only; expanded → all) and passes each visible row its `isLast` so borders stay correct as the set changes. **`pinned` keeps a row visible while collapsed** — the screen marks slip-selected lines pinned in parlay mode, so a player's picks stay on-screen under a collapsed header while they build across sections. Whenever any rows are pinned, the bar prefixes the count with an accent `N SELECTED · M LINES` hint (shown open or collapsed).

### How the screen wires selection behavior

The screen owns the betting context (balance, parlay slip, identity) and passes per-mode callbacks into each `LineRow`:

- **Single mode** — `onSelect` opens the wager sheet pre-picked to that selection; `selectionState` dims for `balance < 10` or anti-tank.
- **Parlay mode** — `onSelect` toggles the selection in/out of the slip (one selection per market); `selectionState` marks the slip's selection `selected` and dims anti-tank sides. Lines in the slip are passed to `LineRowContainer` as **`pinned`**, so they stay visible even when their section is collapsed (build-across-sections UX).
- **In progress** — `inProgress` dims the whole row and makes every side inert.

`isSelfTank(line, sel)` in the screen is the single anti-tank predicate: `line.subjectPlayerId === playerId && selectionBetsAgainstSubject(line.marketType, sel.key)`. It gates the single sheet, the parlay toggle, and the placement (the server re-checks regardless).

### Recipe — adding a new market type to the board

The board needs **no new render code**:

1. **Schema / RPCs** — add the market type per [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) §7 (`market_type`, selections, placement/settlement).
2. **Fetch** — add a `db.ts` query (or extend one) returning the new markets with the `MARKET_GRAPH` embed, and surface them in `usePinsinoData` so they land in `openLines`. *Today only `betMarkets.listActiveOUByWeek` feeds the board — season-long markets need a season-scoped fetch, and the `THIS WEEK'S LINES` header + empty-state copy are still week-shaped (revisit when that fetch lands).*
3. **`normalizeMarket`** — already generic; just confirm your selections carry `key` / `label` / `line` / `odds` / `sort_order`.
4. **Helpers** — add a `case` to `lineCategory` (section name) and, if a side bets against the subject, to `selectionBetsAgainstSubject`. Touch `lineGroup` only if the scope isn't per-game/season.
5. Done — `LineRow` / `LineRowContainer` / the grouping render it as-is.

> **Known assumption:** `lineCategory` maps `over_under → "Player Over/Unders"` because every O/U subject is a player today. A *team* over/under under the same `market_type` would need the category (and anti-tank) to key off the subject **kind** (player vs team), not `market_type` alone.

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
- **Betting flows** (`SportsbookScreen`, `PinsinoSportsbookScreen`, `RsvpScreen`, `MatchupsScreen`) — RSVP→market sync, place bet, settle, cancel, open/close are all **server-side RPCs on the canonical model** (`sync_over_under_markets_for_week`, `place_house_bet`, `settle_market`, `cancel_bet`) plus an admin per-game open/close write (`betMarkets.setOUStatusByWeekGame`). The UI mirrors the server guards (min stake 10, balance, anti-tanking). **For the exact mechanics of every flow, accounting, and integrity rules, see [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) §4–§5 — keep it authoritative.**

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
│   │   ├── usePinsinoData.ts    # Balance + open lines + bets for PinsinoScreen/PinsinoLeaderboardScreen/SportsbookScreen (+ normalizeBet, BetView)
│   │   ├── usePlayerPinsinoData.ts  # One player's balance/ledger/bets (+ shared LedgerEntry type)
│   │   ├── useHousePinsinoData.ts  # House-side ledger + summary/P&L/stats for PinsinoAccountingScreen + PinsinoSportsbookScreen
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
│   │   ├── PinsinoStackNavigator.tsx    # Stack: PinsinoHome → PinsinoLeaderboard / Sportsbook / PlayerPinsino
│   │   ├── MoreStackNavigator.tsx       # Stack: MoreHome + tools (incl. PinsinoAdmin → PinsinoAccounting / PinsinoSportsbook)
│   │   └── types.ts             # MoreStackParamList, StandingsStackParamList, PinsinoStackParamList
│   ├── stores/
│   │   ├── pendingStore.ts      # Optimistic edit buffer (scores, RSVPs, team gen state)
│   │   ├── uiStore.ts           # Ephemeral UI state + toast queue
│   │   └── avatarStore.ts       # Signed-URL cache for player profile pictures
│   ├── utils/
│   │   ├── badges.ts            # BADGE_RULES + badgesForPlayer — status→emoji rule list (see Player Badges)
│   │   ├── helpers.ts           # initials, timeAgo, combinations, spreadAndML
│   │   └── supabase/
│   │       ├── client.ts        # Supabase client (env-var configured)
│   │       ├── database.types.ts # Auto-generated Postgres types
│   │       └── db.ts            # Typed query objects per table
│   ├── components/
│   │   ├── AppHeader.tsx
│   │   ├── PlayerAvatar.tsx
│   │   ├── PlayerBadges.tsx
│   │   ├── ScreenHeader.tsx
│   │   ├── Toast.tsx
│   │   ├── ConfirmBar.tsx
│   │   ├── PillFilter.tsx
│   │   ├── ToggleGroup.tsx
│   │   ├── PlayerScoreRow.tsx
│   │   ├── OddsBlock.tsx
│   │   ├── LineRow.tsx           # One market row; data-driven selection buttons (see Betting Line Board)
│   │   ├── LineRowContainer.tsx  # Collapsible per-category section; pinned rows stay visible collapsed (see Betting Line Board)
│   │   ├── BetRow.tsx            # One bet/parlay row in betting lists (see Betting display components)
│   │   ├── ActiveBetsView.tsx    # Shared Active Bets surface (read-only on Pinsino, actionable on PinsinoAdmin)
│   │   ├── SettledBetsView.tsx   # Shared Settled Bets surface (read-only on Pinsino, cancellable on PinsinoAdmin)
│   │   ├── SettleBetModal.tsx    # Admin single-market settlement overlay (settle_market RPC)
│   │   ├── LedgerRow.tsx         # One pin_ledger activity row, shared by both ledger screens
│   │   ├── BetDetailModal.tsx    # Shared "Bet Details" overlay + resultBadge/betReturnText helpers
│   │   ├── PinsinoLeaderboardTable.tsx  # Shared leaderboard table (rank, name, balance, upside); limit prop for preview
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
│       ├── ProfilePicturesScreen.tsx  # Upload/delete player profile photos (admin)
│       ├── PastGamesScreen.tsx      # Historical week rosters + scores by season
│       ├── RegistrationScreen.tsx   # Per-season sign-ups + admin registration management
│       ├── LeagueRecordsScreen.tsx  # High game/series/team records
│       ├── HeadToHeadScreen.tsx     # 1v1 player comparison
│       ├── ChemistryScreen.tsx      # Pair/trio win-rate analysis
│       ├── PastSeasonsScreen.tsx    # Past seasons — season-by-season summary
│       ├── PinsinoScreen.tsx        # Hub: balance card + top-3 leaderboard preview + tile menu (Sportsbook)
│       ├── PinsinoLeaderboardScreen.tsx  # Full pin-balance leaderboard (Titans of Pindustry)
│       ├── SportsbookScreen.tsx     # Public betting: Place Bets / Active Bets / Settled Bets toggle
│       ├── PlayerPinsinoScreen.tsx  # One player's betting record: Activity / Open / Settled
│       ├── PinsinoAdminScreen.tsx   # Admin hub: tile menu (Accounting + Sportsbook)
│       ├── PinsinoAccountingScreen.tsx  # Admin: House Balance + Activity / Weekly P&L toggle
│       ├── PinsinoSportsbookScreen.tsx  # Admin: Active Bets / Settled Bets toggle (settle + cancel actions)
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
