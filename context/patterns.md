# Key Patterns & Theme

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
- **End season** (`AdminEndSeasonModal`) — calls `seasons.settleLoansForClose(season.id)` first (surfaces error via toast and aborts if it fails), then writes `season_champions.insert` for selected champions and sets `seasons.update(currentId, { is_active: false })`; the current season is resolved via `seasons.getCurrent()` (not the highest number)
- **Open registration** (`AdminOpenRegistrationModal`) — `seasons.insert` for the next season with `registration_open = true, is_active = false`; the new number is `getLatest().number + 1`; after insert, queries `seasons.getLastEnded()` + `seasonChampions.listBySeason` and inserts `+100` `champion_bonus` ledger entries for each champion into the new season
- **Registration management** (`RegistrationScreen`, admin) — open/close registration (`seasons.update` toggling `registration_open`/`is_active`), add/remove players via `registrations.insert`/`registrations.remove`, and **delete an open season** via `seasons.remove` (confirmed). Closing registration sets `is_active = true`, which fails if another season is already active (single-active index) — end the current season first
- **Generate teams** (`AdminGenerateTeamsModal`) — reads RSVP + player avgs, computes balanced teams client-side, previews swaps, then wipes the week with a single `teams.removeByWeek` (cascades slots → games → scores) and writes `teams.insert` (capturing the new ids) → `team_slots.insert` + `games.insert` → `weeks.update(..., { is_confirmed: true })`. It does **not** create base O/U markets (RSVP owns those; markets reference `weeks` not `teams`, so the wipe leaves them intact) — after gen it calls `betMarkets.syncOUForWeek(weekId, scheduleGames)` to add any missing schedule game (game 3 when `numTeams ∈ {3,5}`), idempotently
- **Betting flows** (`SportsbookScreen`, `PinsinoSportsbookScreen`, `RsvpScreen`, `MatchupsScreen`) — RSVP→market sync, place bet, settle, cancel, open/close are all **server-side RPCs on the canonical model** (`sync_over_under_markets_for_week`, `place_house_bet`, `settle_market`, `cancel_bet`) plus an admin per-game open/close write (`betMarkets.setOUStatusByWeekGame`). The UI mirrors the server guards (min stake 10, balance, anti-tanking). **For the exact mechanics of every flow, accounting, and integrity rules, see [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §4–§5 — keep it authoritative.**

---

## Theme System

**File:** [src/theme.ts](../app/src/theme.ts)

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
