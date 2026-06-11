# Data Architecture, Hooks & Utilities

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
| `useAdminAction.ts` | `useAdminAction(onDone, onClose)` → `{ saving, run, confirm }` | — | BountyAdminActionModal, PvpAdminActionModal — the shared admin-action machinery: `run(label, rpc)` = saving flag → error/success toast → `onDone()` → `onClose()`; `confirm(title, msg, onYes, destructive?)` wraps the native Alert |
| `usePinsinoData.ts` | `usePinsinoData(playerId)` (+ `LineView`, `SelectionView`, `LineGroup`, `LineCategory`, `BetView`, `LegView`, `LeaderboardEntry`, `ActiveLoanSummary` types; `normalizeBet` compute fn + the market-type seam helpers `selectionBetsAgainstSubject` / `lineGroup` / `lineCategory` / `closedBettingNote`) | `normalizeBet(raw)` — collapse a bet → legs → selections → markets graph into a flat `BetView`; **see [Betting Line Board](betting-line-board.md) for the line/selection shapes + seam helpers** | PinsinoScreen, PinsinoLeaderboardScreen, SportsbookScreen — returns `{ balance, debt, netWorth, activeLoan, openLines, myBets, weekBets, settledBets, leaderboard, myBetMarketIds, currentWeekId, currentSeasonId }`. `leaderboard` entries now include `debt` and `netWorth = balance − debt`, sorted high → low by `netWorth`. `debt` + `activeLoan` expose the caller's own loan figures (activeLoan = `{ loanId, productName, outstanding }` or `null`) |
| `useLoanSharkData.ts` | `useLoanSharkData(playerId)` (+ `LoanProductView`, `DebtLedgerEntry`, `ActiveLoanView` types) | — | LoanSharkScreen — borrower view. Returns `{ loading, balance, products, activeLoan, reload }`. `products` is `LoanProductView[]` with a derived `available` boolean; `activeLoan` is `ActiveLoanView | null` (`{ loanId, product, outstanding, paymentHistory: DebtLedgerEntry[] }`) |
| `usePlayerPinsinoData.ts` | `usePlayerPinsinoData(playerId)` (+ `LedgerEntry` type) | — | PlayerPinsinoScreen — one player's betting record. Returns `{ balance, ledger, openBets, settledBets }`. `ledger` is `LedgerEntry[]` (each with `weekNumber` + a normalized `bet` for `bet_*` rows); `openBets`/`settledBets` are `BetView[]`. **`LedgerEntry` is the shared ledger-row type** imported by `useHousePinsinoData` + both ledger screens |
| `useHousePinsinoData.ts` | `useHousePinsinoData()` (+ `HouseSummary`, `WeekPnl`, `HouseStats` types) | — | PinsinoAdminScreen, PinsinoAccountingScreen, AdminSportsbookScreen — the **house** side of the pin economy (`is_house` rows). Returns `{ balance, ledger, summary, weekPnl, exposure, stats, seasonNumber, weekBets, settledBets }` for the current season: `summary` = stakes/payouts/refunds/bonuses, `weekPnl` = per-week house net, `exposure` = Σ potential payout over this week's pending bets, `stats` = settled record + hold%, `weekBets`/`settledBets` = the normalized `BetView[]` (already fetched for exposure/stats) that feed the Sportsbook screen's `ActiveBetsView` / `SettledBetsView`. Reuses `LedgerEntry` / `normalizeBet` |

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

**File:** [src/utils/helpers.ts](../app/src/utils/helpers.ts)

| Function | Purpose |
|---|---|
| `initials(name)` | 2-char initials from a full name |
| `timeAgo(date)` | Human-readable relative time string ("2h ago", "3d ago") |
| `toISO(date)` / `fromISO(s)` | `YYYY-MM-DD` ↔ local `Date` (parse avoids the UTC off-by-one) |
| `formatDateLong(date)` | "Mon, Jan 5, 2026" — admin season date pickers |
| `formatDateShort(date)` | "Jan 5, 2026" — ledger rows |
| `combinations(arr, k)` | All k-length combinations of an array — used by chemistry calculation |
| `spreadAndML(t1, t2)` | Bowling spread + moneyline odds from two expected team totals |

Bet display helpers (`resultBadge`, `betPayout`, `betReturn`, `betReturnDisplay`, `betReturnText`, `signed`) live in [src/utils/bets.ts](../app/src/utils/bets.ts).
