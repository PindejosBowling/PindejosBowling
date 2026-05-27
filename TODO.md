# AP-5: Vue SFC Migration — Sequential TODO

> **Status:** Tasks 0–6 not yet started. Work AP-1 (stores) and AP-4 (pure utils) are **complete** — stores are in `src/stores/`, utilities are in `src/utils/`. This file tracks the remaining component migration work.
>
> **Hand-off note for agents:** Read the Integration Approach section before starting any task. Each task is self-contained and specifies exactly which files to create, which files to modify, and how to verify correctness. Complete tasks in order (see dependency tree at the bottom).

---

## Completed prerequisites

- [x] **AP-1** — Pinia stores created: `src/stores/data.js`, `ui.js`, `pending.js`, `prefs.js`
- [x] **AP-4** — Pure data utils created: `src/utils/data.js`, `helpers.js`, `constants.js`
- [x] **API module** — `src/api.js` (exports `apiGet`, `apiPost`, `API`)

---

## Integration Approach — read before starting any task

Each view is migrated one at a time using Vue's **`<Teleport>`** to render into the existing legacy section containers (e.g. `#standings-content`). This lets the legacy CSS tab-switching (`switchTab()` in `app.js`) keep working throughout migration without touching `index.html`.

**Pattern for each view migration:**
1. Create `src/views/FooView.vue` (and any needed components under `src/components/`)
2. Add `<Teleport to="#foo-content"><FooView /></Teleport>` to `src/App.vue`
3. Remove the legacy `renderFoo()` call from `switchTab()` in `app.js` (so it no longer overwrites Vue's DOM)
4. If `renderFoo()` is also called from `loadAll()`, remove that call too
5. **Remove the static loading spinner from `index.html`** for the migrated section (e.g. `#foo-content`) and replace it with an empty `<div id="foo-content"></div>`. The Vue component owns the loading state via `v-if="dataStore.loading || !dataStore.stats"` — if you leave the static spinner in place, `<Teleport>` appends alongside it and the spinner never clears.

> **⚠️ Loading spinner gotcha:** `index.html` pre-renders a `.loading` spinner inside each `#*-content` div. The legacy `renderFoo()` functions cleared it by replacing `innerHTML`. Vue's `<Teleport>` *appends* into the container instead of replacing it, so the spinner will persist as a sibling node unless you remove it from `index.html`. Always empty the target div in `index.html` when migrating a section to Vue.

**CSS:** `styles.css` is a global stylesheet linked in `index.html`. All existing CSS classes work inside Vue templates without imports. Do NOT add `<style scoped>` unless adding net-new styles.

**Cross-view navigation during migration:** When a Vue component needs to switch tabs (e.g. a standing row click that navigates to More → Player Detail), call the global `window.switchTab(tab, opts)` from `app.js`. This will be removed when AppNav is migrated in Task 6.

**Common store imports** (use as needed per component):
```js
import { useDataStore }    from '../stores/data.js'
import { useUiStore }      from '../stores/ui.js'
import { usePendingStore } from '../stores/pending.js'
import { usePrefsStore }   from '../stores/prefs.js'
```

**Common util imports** (use as needed per component):
```js
import { aggregateStandings, getSeasons, getDefaultViewSeason, getPlayerProfile,
         getLeagueRecords, getPersonalRecords, getChemistry, getH2H,
         getMatchupsForWeek, getWeeksForSeason, isChampion, championsForSeason,
         isPlayerOut, hasActiveWeek, readActiveWeek, getLeagueAvg,
         getPlayerCurrentAvg, effectiveAvg } from '../utils/data.js'
import { initials, timeAgo, spreadAndML } from '../utils/helpers.js'
import { apiPost } from '../api.js'
```

---

## Task 0 — Expand `App.vue` as Teleport host

- [x] **Status:** Complete

**Prerequisite:** None — do this first.
**Creates:** nothing new
**Modifies:** `src/App.vue`

Expand `App.vue` from its current empty comment stub into a valid SFC with an empty `<template>` and `<script setup>`. Teleport entries will accumulate here as each task completes.

```vue
<template>
  <!-- Teleport entries added here as each view is migrated (Tasks 1–6) -->
</template>

<script setup>
// Store imports added here as child components require them
</script>
```

**Verify:** `npm run build` passes. The app works exactly as before (app.js still handles all rendering).

---

## Task 1 — `src/views/StandingsView.vue`

- [x] **Status:** Complete

**Prerequisite:** Task 0
**Creates:** `src/views/StandingsView.vue`
**Modifies:** `src/App.vue`, `app.js`

### Template structure
- Season `<select>` populated with `['all', ...getSeasons(dataStore.stats)]`; bound to `uiStore.standingsSeason`
- `.standings-header` row (rank | name | W-L | pins | avg column labels)
- `v-for` over `standings` computed; each row is `.standing-row` with `@click="goToPlayer(player.name)"`
- Champion crown: `v-if="isChampion(dataStore.champions, player.name)"` renders `<span class="champ-crown">👑</span>`
- Top 3 ranks: `:class="{ top: index < 3 }"` on `.s-rank`

### Computed
```js
const dataStore = useDataStore()
const uiStore   = useUiStore()

const seasons = computed(() => ['all', ...getSeasons(dataStore.stats)])
const activeSeason = computed(() =>
  uiStore.standingsSeason ?? getDefaultViewSeason(dataStore.stats, dataStore.settings)
)
const standings = computed(() => aggregateStandings(dataStore.stats, activeSeason.value))
```

### Events
- Season select `@change` → `uiStore.standingsSeason = $event.target.value`
- Row `@click` → `goToPlayer(name)`:
  ```js
  function goToPlayer(name) {
    uiStore.selectedPlayer = name
    uiStore.moreView = 'player-detail'
    window.switchTab('more', { preserveView: true })
  }
  ```

### CSS classes
`.standings-card`, `.standings-header`, `.standing-row`, `.s-rank`, `.s-rank.top`, `.s-name`, `.s-wl`, `.s-pins`, `.s-avg`, `.champ-crown`, `.tab-title`, `.filter-bar`

### `src/App.vue` addition
```vue
<Teleport to="#standings-content">
  <StandingsView />
</Teleport>
```
Import: `import StandingsView from './views/StandingsView.vue'`

### `app.js` changes
- In `switchTab()`: remove the `if (tab === 'standings') renderStandings()` line
- Leave the `renderStandings()` function body intact (becomes dead code, cleaned up in Task 6)

### Verify
1. Standings tab renders the table via Vue (not app.js)
2. Season dropdown updates standings reactively
3. Clicking a player row navigates to More → Player Detail (via legacy renderPlayerDetail until Task 4c)

---

## Task 2 — `src/views/RsvpView.vue`

- [x] **Status:** Complete

**Prerequisite:** Task 1
**Creates:** `src/views/RsvpView.vue`
**Modifies:** `src/App.vue`, `app.js`

### Template structure
- `.rsvp-summary`: 3 stat chips — In count, Out count, No Reply count
- `v-for` over `roster` (skip header: `.slice(1).filter(r => r[0])`); each row is `.rsvp-row` + `:class="{ pending: isPending(name) }"`
- Each row: `.rsvp-name` + `.pending-dot` (if pending) + two `.rsvp-btn` buttons (In / Out)
  - `:class="{ active: effectiveStatus(name) === 'In', in: true }"` on In button
  - `:class="{ active: effectiveStatus(name) === 'Out', out: true }"` on Out button
- Floating confirm bar (`.confirm-bar.floating`): `v-if="hasPendingChanges"` with Discard + Save buttons

### Computed / logic
```js
const dataStore    = useDataStore()
const pendingStore = usePendingStore()

const roster = computed(() => (dataStore.roster ?? []).slice(1).filter(r => r[0]))

function currentStatus(name) {
  const row = (dataStore.rsvp ?? []).slice(1).find(r => r[0] === name)
  return row ? row[1] : null
}
function effectiveStatus(name) {
  return pendingStore.pendingRSVP[name] ?? currentStatus(name)
}
const hasPendingChanges = computed(() => Object.keys(pendingStore.pendingRSVP).length > 0)
const inCount    = computed(() => roster.value.filter(r => effectiveStatus(r[0]) === 'In').length)
const outCount   = computed(() => roster.value.filter(r => effectiveStatus(r[0]) === 'Out').length)
const noReply    = computed(() => roster.value.filter(r => !effectiveStatus(r[0])).length)
```

### Events
- In/Out buttons `@click` → `stageRSVP(name, status)`:
  ```js
  function stageRSVP(name, status) {
    const current = currentStatus(name)
    const alreadyStaged = pendingStore.pendingRSVP[name] === status
    const alreadyCurrent = !pendingStore.pendingRSVP[name] && current === status
    if (alreadyStaged || alreadyCurrent) {
      const next = { ...pendingStore.pendingRSVP }
      delete next[name]
      pendingStore.pendingRSVP = next
    } else {
      pendingStore.pendingRSVP = { ...pendingStore.pendingRSVP, [name]: status }
    }
  }
  ```
- Discard button → `pendingStore.pendingRSVP = {}`
- Save button → async:
  ```js
  async function saveChanges() {
    saving.value = true
    await apiPost('setRSVP', { changes: pendingStore.pendingRSVP })
    await dataStore.loadAll()
    pendingStore.pendingRSVP = {}
    saving.value = false
  }
  ```

### CSS classes
`.rsvp-row`, `.rsvp-row.pending`, `.pending-dot`, `.rsvp-name`, `.rsvp-buttons`, `.rsvp-btn`, `.rsvp-btn.active.in`, `.rsvp-btn.active.out`, `.rsvp-summary`, `.rsvp-stat`, `.rsvp-stat.in`, `.rsvp-stat.out`, `.rsvp-stat.unknown`, `.rsvp-stat-label`, `.rsvp-stat-val`, `.confirm-bar`, `.confirm-bar.floating`, `.confirm-bar.saving`

### `src/App.vue` addition
```vue
<Teleport to="#rsvp-content">
  <RsvpView />
</Teleport>
```

### `app.js` changes
- In `switchTab()`: remove `if (tab === 'rsvp') renderRSVP()` line
- The legacy `saveRSVPChanges()` and `discardRSVPChanges()` functions are now internal to the Vue component; no app.js coordination needed

### Verify
1. RSVP tab renders roster via Vue
2. Toggling a player status shows pending dot and yellow row background
3. Save calls API, refreshes data, clears pending
4. Discard reverts all pending changes

---

## Task 3 — `src/views/HistoryView.vue` + `src/components/HistoricalTeamBlock.vue`

- [x] **Status:** Complete

**Prerequisite:** Task 2
**Creates:** `src/views/HistoryView.vue`, `src/components/HistoricalTeamBlock.vue`
**Modifies:** `src/App.vue`, `app.js`

### `HistoryView.vue` — template structure
- Season `<select>` (options from `getSeasons(dataStore.stats)`)
- Week `<select>` (options from `weeks` computed; disabled until season selected)
- `v-if="pairings.length"`: grouped by game number (1, 2)
  - Section label for each game number
  - `v-for` over pairings: `.matchup` card → `.vs-bar` between two `<HistoricalTeamBlock>` components
- `v-else`: empty state prompt to select season + week

### Computed
```js
const dataStore = useDataStore()
const uiStore   = useUiStore()

const seasons  = computed(() => getSeasons(dataStore.stats))
const weeks    = computed(() => uiStore.histSeason ? getWeeksForSeason(dataStore.stats, uiStore.histSeason) : [])
const pairings = computed(() => {
  if (!uiStore.histSeason || !uiStore.histWeek) return []
  return getMatchupsForWeek(dataStore.stats, uiStore.histSeason, uiStore.histWeek)
})
const game1Pairings = computed(() => pairings.value.filter(p => p.gameNum === 1))
const game2Pairings = computed(() => pairings.value.filter(p => p.gameNum === 2))
```

### Events
- Season select `@change`:
  ```js
  uiStore.histSeason = $event.target.value
  uiStore.histWeek = null
  ```
- Week select `@change` → `uiStore.histWeek = $event.target.value`

### `HistoricalTeamBlock.vue` — spec
**Props:** `{ team: String, players: Array, total: Number }`  
Where each player is `{ name: string, score: number, present: boolean }`.

Renders:
- `.team-block` wrapper
- `.team-label` with team name
- `v-for` over players: `.player-row` `:class="{ absent: !player.present }"`
  - `.player-avatar` with `initials(player.name)`
  - `.player-name` with name + `.absent-tag` if not present
  - score display (read-only)
- `.team-total-row` with `.total-val` showing team total

### CSS classes
`.matchup`, `.vs-bar`, `.vs-left`, `.vs-right`, `.vs-chip`, `.team-block`, `.team-block.winner`, `.team-label`, `.player-row`, `.player-row.absent`, `.player-avatar`, `.player-name`, `.absent-tag`, `.team-total-row`, `.total-label`, `.total-val`, `.filter-bar`, `.tab-title`, `.empty-state`

### `src/App.vue` addition
```vue
<Teleport to="#history-content">
  <HistoryView />
</Teleport>
```

### `app.js` changes
- In `switchTab()`: remove `if (tab === 'history') renderMatchHistory()` line

### Verify
1. History tab renders season + week dropdowns
2. Selecting both renders matchup cards with final scores
3. Absent players show `.absent-tag`

---

## Task 4a — `src/views/MoreView.vue` (home menu)

- [x] **Status:** Complete

**Prerequisite:** Task 3
**Creates:** `src/views/MoreView.vue`
**Modifies:** `src/App.vue`, `app.js`

MoreView is a **sub-view router**. It renders the home menu when `uiStore.moreView === 'home'`, or the appropriate sub-component otherwise. Sub-components are wired in as Tasks 4b–4i complete.

### Template structure (initial — home menu only)
```vue
<template>
  <div v-if="uiStore.moreView === 'home'">
    <div class="more-grid">
      <div class="more-tile" @click="uiStore.moreView = 'player-list'">
        <div class="more-tile-icon">🎳</div>
        <div class="more-tile-label">Players</div>
      </div>
      <!-- Records, H2H, Chemistry, Past Seasons, Trash Board, Generate Teams, Playoffs tiles -->
    </div>
  </div>
  <!-- Sub-views wired in by Tasks 4b–4i: -->
  <!-- <PlayerList v-else-if="uiStore.moreView === 'player-list'" /> -->
  <!-- etc. -->
</template>
```

**Tile map:**
| Label | Icon | `moreView` value |
|---|---|---|
| Players | 🎳 | `'player-list'` |
| Records | 🏆 | `'records'` |
| Head to Head | ⚔️ | `'h2h'` |
| Chemistry | 🧪 | `'chemistry'` |
| Past Seasons | 📅 | `'season-history'` |
| Trash Board | 🗑️ | `'board'` |
| Generate Teams | 🎲 | `'generate'` |
| Playoffs | 🥇 | `'playoffs'` |

Admin tiles (Add Player, Archive & Advance, End Season): render with `.more-tile-coming` badge or call legacy modal functions via `window.openModal(...)` for now.

**Back button:** `v-if="uiStore.moreView !== 'home'"` — a `.back-btn` that sets `uiStore.moreView = 'home'`.

### `src/App.vue` addition
```vue
<Teleport to="#more-content">
  <MoreView />
</Teleport>
```

### `app.js` changes
- In `switchTab()`: remove the entire `if (tab === 'more') { ... renderMore() }` block
- The `state.moreView = 'home'` reset on tab click is now handled by: when the user clicks the nav More button, `uiStore.moreView` stays as-is (preserveView logic) OR resets to home depending on opts — replicate the `if (!opts.preserveView) state.moreView = 'home'` logic in `MoreView.vue` or in the nav handler

### Verify
1. More tab renders the tile grid
2. Clicking Players tile sets `uiStore.moreView = 'player-list'` (empty area until Task 4b)
3. Back button returns to home grid

---

## Task 4b — `src/components/PlayerList.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a
**Creates:** `src/components/PlayerList.vue`
**Modifies:** `src/views/MoreView.vue`

### Template structure
- `<input class="player-search" v-model="search" placeholder="Search players…">`
- `v-for` over `filteredPlayers`: `.player-card` with `@click="select(player.name)"`
  - `.player-avatar` showing `initials(player.name)`
  - `.player-card-info` with `.player-card-name` (name) + `.player-card-stats` ("W-L")
  - `.player-card-avg` showing avg formatted to 1 decimal

### Computed
```js
const search = ref('')
const allPlayers = computed(() => {
  if (!dataStore.stats) return []
  return aggregateStandings(dataStore.stats, 'all')
    .map(p => ({ name: p.name, avg: p.avg, wins: p.wins, losses: p.losses }))
})
const filteredPlayers = computed(() =>
  allPlayers.value.filter(p =>
    p.name.toLowerCase().includes(search.value.toLowerCase())
  )
)
```

### Events
- `@click` on player card:
  ```js
  function select(name) {
    uiStore.selectedPlayer = name
    uiStore.moreView = 'player-detail'
  }
  ```

### `MoreView.vue` change
Add to template:
```vue
<PlayerList v-else-if="uiStore.moreView === 'player-list'" />
```
Add to script: `import PlayerList from '../components/PlayerList.vue'`

### Verify
1. More → Players shows full player list with avatars and averages
2. Typing in search filters list reactively
3. Clicking a player navigates to player-detail view (Task 4c)

---

## Task 4c — `src/components/PlayerDetail.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4b
**Creates:** `src/components/PlayerDetail.vue`
**Modifies:** `src/views/MoreView.vue`

This is the most complex More sub-component (~120 lines of legacy render logic). Mirrors `renderPlayerDetail()` + `drawPlayerChart()` in `app.js`.

### Template structure
1. **Header:** `.player-detail-header` with `.back-btn` (`@click="uiStore.moreView = 'player-list'"`) + `.player-detail-name` + `.player-detail-team`
2. **Season filter:** `<select>` with `['all', ...getSeasons(dataStore.stats)]`, bound to `uiStore.playerSeason`
3. **Stat tiles:** `.stat-grid` with 6 `.stat-tile` cards:
   - Avg (season avg), High Game, W-L record, Last 5 Avg, All-Time Avg, Total Games
4. **Personal records:** 3 cards — High Game, High Series, Best Streak / Current Streak
5. **Chart:** `.chart-card` > `.chart-wrap` > `<canvas ref="chartCanvas">`
6. **Log toggle:** `.toggle-group` with "Bowled" / "All Weeks" buttons → `uiStore.playerLogMode`
7. **Game log:** `.score-history-table` with `v-for` over log rows
   - Rows grouped by week; expandable via `@click` → `toggleWeek(key)`
   - Expanded row shows `.week-expand` with matchup detail for that week

### Computed
```js
const profile = computed(() =>
  uiStore.selectedPlayer
    ? getPlayerProfile(dataStore.stats, dataStore.settings, uiStore.selectedPlayer, uiStore.playerSeason)
    : null
)
const records = computed(() =>
  uiStore.selectedPlayer
    ? getPersonalRecords(dataStore.stats, uiStore.selectedPlayer)
    : null
)
```

### Chart.js integration
```js
import Chart from 'chart.js/auto'

const chartCanvas = ref(null)
let chartInstance = null

watch(profile, () => {
  if (!chartCanvas.value || !profile.value) return
  if (chartInstance) chartInstance.destroy()
  const scores = profile.value.games.filter(g => g.present).map(g => g.score)
  const avg = profile.value.avg
  chartInstance = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels: scores.map((_, i) => i + 1),
      datasets: [
        { label: 'Score', data: scores, borderColor: '#e8ff47', tension: 0.3, pointRadius: 3 },
        { label: 'Avg',   data: scores.map(() => avg), borderColor: '#666', borderDash: [4,4], pointRadius: 0 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  })
}, { immediate: true })
```
*(Mirror the exact chart config from `drawPlayerChart()` in `app.js` for visual parity.)*

### Events
- Season select `@change` → `uiStore.playerSeason = $event.target.value`
- Log mode toggle → `uiStore.playerLogMode = mode`
- Week row click → `uiStore.expandedWeek = uiStore.expandedWeek === key ? null : key`

### CSS classes
`.player-detail-header`, `.back-btn`, `.player-detail-name`, `.player-detail-team`, `.stat-grid`, `.stat-tile`, `.stat-tile-label`, `.stat-tile-val`, `.stat-tile-sub`, `.chart-card`, `.chart-title`, `.chart-wrap`, `.toggle-group`, `.toggle-btn`, `.toggle-btn.active`, `.score-history-table`, `.score-history-row`, `.score-history-row.head`, `.score-history-row.clickable`, `.sh-week`, `.sh-team`, `.sh-record`, `.sh-record.win`, `.sh-record.loss`, `.sh-out`, `.sh-expand-icon`, `.week-expand`, `.week-expand-inner`

### `MoreView.vue` change
```vue
<PlayerDetail v-else-if="uiStore.moreView === 'player-detail'" />
```

### Verify
1. Click player in PlayerList → detail renders with correct stats
2. Chart animates with score history
3. Season filter updates stat tiles and chart
4. Log mode toggle shows/hides absent weeks
5. Clicking a week row expands to show matchup detail

---

## Task 4d — `src/components/SeasonHistory.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a (can run in parallel with 4b/4c)
**Creates:** `src/components/SeasonHistory.vue`
**Modifies:** `src/views/MoreView.vue`

### Template structure
- `v-for` over `seasonData` (seasons descending)
- Each: `.history-season` card
  - `.history-head`: season number + champion names (`.history-champion` with crown emoji)
  - `.history-body`: stat rows for top bowler+avg, league avg, total players, weeks played

### Computed
```js
const seasons = computed(() => getSeasons(dataStore.stats).slice().reverse())
const seasonData = computed(() =>
  seasons.value.map(s => {
    const standings = aggregateStandings(dataStore.stats, s)
    const top       = standings[0] ?? null
    const champs    = championsForSeason(dataStore.champions, s)
    const weeks     = getWeeksForSeason(dataStore.stats, s).length
    return { season: s, top, champs, playerCount: standings.length, weeks }
  })
)
```

### CSS classes
`.history-season`, `.history-head`, `.history-season-name`, `.history-champion`, `.history-body`, `.history-stat`, `.history-stat-label`, `.history-stat-val`

### `MoreView.vue` change
```vue
<SeasonHistory v-else-if="uiStore.moreView === 'season-history'" />
```

### Verify
1. More → Past Seasons shows cards in descending season order
2. Champions listed with crown, top bowler shown with avg

---

## Task 4e — `src/components/LeagueRecords.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a (can run in parallel with 4b/4c)
**Creates:** `src/components/LeagueRecords.vue`
**Modifies:** `src/views/MoreView.vue`

### Template structure
- Season `<select>` (`'all'` + all seasons) bound to `uiStore.recordsSeason`
- 5 record cards:
  1. **High Game** — individual single game (`.record-card` with player, score, when)
  2. **High Series** — individual two-game total
  3. **High Team Game** — team with roster list
  4. **High Team Night** — team with G1 + G2 roster breakdown
  5. **Best Season Avg** — player, avg, which season

Individual record card: `.record-card` > `.record-card-head` with `.record-icon` (emoji) + `.record-info` (`.record-num` big number, `.record-label` name, `.record-detail` when).

Team record cards: add `.record-team-roster` section with player rows (`.record-team-row`).

High Team Night: two `.record-team-game` sections (G1 and G2) each with `.record-team-game-head` and player rows.

### Computed
```js
const records = computed(() => getLeagueRecords(dataStore.stats, uiStore.recordsSeason))
```

### Events
- Season select `@change` → `uiStore.recordsSeason = $event.target.value`

### CSS classes
`.record-card`, `.record-card-head`, `.record-icon`, `.record-info`, `.record-label`, `.record-value`, `.record-detail`, `.record-num`, `.record-team-roster`, `.record-team-row`, `.record-team-game`, `.record-team-game-head`

### `MoreView.vue` change
```vue
<LeagueRecords v-else-if="uiStore.moreView === 'records'" />
```

### Verify
1. More → Records shows all 5 record categories
2. Season filter updates records reactively
3. Team records show full rosters

---

## Task 4f — `src/components/HeadToHead.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a (can run in parallel with 4b/4c)
**Creates:** `src/components/HeadToHead.vue`
**Modifies:** `src/views/MoreView.vue`

### Template structure
- `.h2h-controls` (CSS grid: `1fr auto 1fr`):
  - Player 1 `<select>` with all player names
  - `.h2h-vs` label ("VS")
  - Player 2 `<select>`
- `v-if="h2hData"` — `.h2h-result` card:
  - `.h2h-head`: P1 name | "–" | P2 name; winning name gets `:class="{ lead: ... }"`
  - Two stat rows: Team Game Wins, Pin Total Wins
  - Game log table: `v-for` over `h2hData.games` (season, week, game#, team totals, individual scores)

### Computed
```js
const allPlayerNames = computed(() =>
  aggregateStandings(dataStore.stats, 'all').map(p => p.name)
)
const h2hData = computed(() => {
  if (!uiStore.h2hP1 || !uiStore.h2hP2) return null
  return getH2H(dataStore.stats, uiStore.h2hP1, uiStore.h2hP2)
})
```

### Events
- P1 select `@change` → `uiStore.h2hP1 = $event.target.value`
- P2 select `@change` → `uiStore.h2hP2 = $event.target.value`

### CSS classes
`.h2h-controls`, `.h2h-vs`, `.h2h-result`, `.h2h-head`, `.h2h-name`, `.h2h-name.lead`, `.h2h-divider`, `.h2h-stat-row`, `.h2h-stat-label`, `.h2h-stat-line`, `.h2h-stat-num`, `.h2h-stat-num.lead`, `.h2h-stat-dash`, `.score-history-table`, `.score-history-row`

### `MoreView.vue` change
```vue
<HeadToHead v-else-if="uiStore.moreView === 'h2h'" />
```

### Verify
1. More → H2H shows two player dropdowns
2. Selecting both players populates stats and game log
3. Leading player name highlights in accent color

---

## Task 4g — `src/components/Chemistry.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a (can run in parallel with 4b/4c)
**Creates:** `src/components/Chemistry.vue`
**Modifies:** `src/views/MoreView.vue`

### Template structure
- `.chemistry-tabs`: "Pairs" / "Trios" buttons (`.chem-tab` `:class="{ active: ... }"`)
- `v-for` over `visibleGroups`: `.chemistry-card` (CSS grid `1fr auto auto`)
  - `.chem-pair`: joined player names (e.g. "Alice & Bob")
  - `.chem-rate`: win rate as percentage
  - `.chem-games`: game count + weeks
- "Show All" / "Show Top 10" button (shown when total > 10)

### Computed
```js
const groupSize = computed(() => uiStore.chemMode === 'pairs' ? 2 : 3)
const allGroups = computed(() => getChemistry(dataStore.stats, groupSize.value))
const visibleGroups = computed(() =>
  uiStore.chemExpanded ? allGroups.value : allGroups.value.slice(0, 10)
)
```

### Events
- Pairs tab `@click` → `uiStore.chemMode = 'pairs'; uiStore.chemExpanded = false`
- Trios tab `@click` → `uiStore.chemMode = 'trios'; uiStore.chemExpanded = false`
- Expand button `@click` → `uiStore.chemExpanded = !uiStore.chemExpanded`

### CSS classes
`.chemistry-tabs`, `.chem-tab`, `.chem-tab.active`, `.chemistry-card`, `.chem-pair`, `.chem-rate`, `.chem-games`, `.btn`, `.btn.sm`

### `MoreView.vue` change
```vue
<Chemistry v-else-if="uiStore.moreView === 'chemistry'" />
```

### Verify
1. More → Chemistry shows pairs ranked by win rate
2. Switching to Trios updates list
3. Expand/collapse works

---

## Task 4h — `src/components/TrashBoard.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a (can run in parallel with 4b/4c)
**Creates:** `src/components/TrashBoard.vue`
**Modifies:** `src/views/MoreView.vue`

### Template structure
- **Composer** (`.board-composer`):
  - `.board-author-row`: author input `v-model="prefsStore.myName"`
  - `<textarea v-model="msg">` for message text
  - Post button (`.btn.primary`) `@click="post()"` — disabled while posting
- **Feed**: `v-for` over `posts` (newest first):
  - `.board-post` > `.board-post-head` (`.board-author` + `.board-time` via `timeAgo()`) + `.board-msg`

### Data / logic
```js
const msg  = ref('')
const posting = ref(false)
const posts = computed(() =>
  (dataStore.board ?? []).slice(1).slice().reverse()
)
async function post() {
  if (!prefsStore.myName.trim() || !msg.value.trim()) return
  posting.value = true
  await apiPost('postBoard', { author: prefsStore.myName, message: msg.value })
  await dataStore.loadAll()
  msg.value = ''
  posting.value = false
}
```

### CSS classes
`.board-composer`, `.board-author-row`, `.board-author-input`, `.board-post`, `.board-post-head`, `.board-author`, `.board-time`, `.board-msg`, `.btn`, `.btn.primary`

### `MoreView.vue` change
```vue
<TrashBoard v-else-if="uiStore.moreView === 'board'" />
```

### Verify
1. More → Trash Board shows composer + existing posts
2. Posting adds a new message; feed refreshes
3. Author name persists across sessions (stored in `prefsStore.myName` → localStorage)

---

## Task 4i — `src/components/GenerateTeams.vue`

- [ ] **Status:** Not started

**Prerequisite:** Task 4a (can run in parallel with 4b/4c)
**Creates:** `src/components/GenerateTeams.vue`
**Modifies:** `src/views/MoreView.vue`

This is the most complex More sub-component. Mirrors `renderGenerateTeams()` + `doGenerate()` + `handleSwap()` + `confirmGenerate()` in `app.js`.

### Template structure

**Controls section** (`.gen-controls`):
- Number of Teams row: `.toggle-group` with buttons `[2,3,4,5,6]` → `pendingStore.genNumTeams`
- Players per Team row: `.toggle-group` with buttons `[2,3,4,5]` → `pendingStore.genTeamSize`
- Avg Source row: `.toggle-group` Last Season / Current / All-time → `pendingStore.genAvgSource`
- Fill Mode row: `.toggle-group` League Avg / Their Avg → `pendingStore.genFillMode`
- Pad teams row: `<input type="checkbox">` → `pendingStore.genFillToSize`
- Player count helper text (active roster vs. needed slots)
- Generate button `@click="doGenerate()"` — shows spinner while loading

**Generated teams** (`v-if="pendingStore.genTeams"`):
- `v-for` over teams: `.team-preview-card`
  - `.tp-head`: team name + `.tp-total` expected score
  - `.tp-list`: `v-for` over players: `.tp-row` with `.tp-player` name + `.tp-avg` + `.swap-btn`
    - Swap button: `:class="{ selected: pendingStore.genSwapTarget?.team === team && pendingStore.genSwapTarget?.idx === idx }"`
- "Use These Teams" `.btn.primary` at bottom `@click="useTeams()"`

### Events
- Toggle buttons: `@click` → update respective `pendingStore` field
- Generate `@click` → async `doGenerate()`:
  ```js
  async function doGenerate() {
    generating.value = true
    const result = await apiPost('generateTeams', {
      numTeams:   pendingStore.genNumTeams,
      teamSize:   pendingStore.genTeamSize,
      fillMode:   pendingStore.genFillMode,
      avgSource:  pendingStore.genAvgSource,
      fillToSize: pendingStore.genFillToSize,
    })
    pendingStore.genTeams = result.teams
    generating.value = false
  }
  ```
- Swap button `@click(team, idx)`:
  - If no swap target: set `pendingStore.genSwapTarget = { team, idx }`
  - If same target: clear it
  - If different target: perform swap in `pendingStore.genTeams`, clear target
- Use Teams `@click`:
  ```js
  async function useTeams() {
    await apiPost('setActiveWeek', { teams: pendingStore.genTeams })
    await dataStore.loadAll()
    pendingStore.genTeams = null
    uiStore.moreView = 'home'
  }
  ```

### CSS classes
`.gen-controls`, `.gen-row`, `.gen-label`, `.toggle-group`, `.toggle-btn`, `.toggle-btn.active`, `.team-preview-card`, `.tp-head`, `.tp-name`, `.tp-total`, `.tp-list`, `.tp-row`, `.tp-player`, `.tp-player.unavail`, `.tp-avg`, `.swap-btn`, `.swap-btn.selected`, `.btn`, `.btn.primary`, `.spinner`

### `MoreView.vue` change
```vue
<GenerateTeams v-else-if="uiStore.moreView === 'generate'" />
```

### Verify
1. More → Generate Teams shows controls with current `pendingStore` values
2. Clicking Generate calls API and renders team cards
3. Swap buttons correctly exchange players between teams
4. Use These Teams saves and navigates to Matchups

---

## Task 5 — `src/views/MatchupsView.vue`

- [ ] **Status:** Not started

**Prerequisite:** All Task 4 subtasks complete (4a through 4i)
**Creates:**
- `src/views/MatchupsView.vue`
- `src/components/ActiveMatchupsPanel.vue`
- `src/components/LegacyMatchupsPanel.vue`
- `src/components/PlayerScoreRow.vue`
- `src/components/OddsBlock.vue`
**Modifies:** `src/App.vue`, `app.js`

This is the most complex view. It branches between Active Week (live scoring) and Legacy (historical current week) modes.

### `MatchupsView.vue` — dispatcher
```vue
<template>
  <ActiveMatchupsPanel v-if="hasActiveWeek(dataStore.active)" />
  <LegacyMatchupsPanel v-else-if="dataStore.current" />
  <div v-else class="loading"><div class="spinner"></div><div class="loading-text">Loading…</div></div>
</template>

<script setup>
import { useDataStore } from '../stores/data.js'
import { hasActiveWeek } from '../utils/data.js'
import ActiveMatchupsPanel  from '../components/ActiveMatchupsPanel.vue'
import LegacyMatchupsPanel  from '../components/LegacyMatchupsPanel.vue'
const dataStore = useDataStore()
</script>
```

### `ActiveMatchupsPanel.vue`

**Reads:** `dataStore.active`, `dataStore.settings`, `dataStore.rsvp`, `dataStore.champions`, `uiStore.matchupsView`, `uiStore.oddsRevealed`, `prefsStore.avgDisplay`

**Template structure:**
- `.tab-title` with week/season label (from `readActiveWeek()` metadata)
- `.league-avg-banner` with avg value + `.avg-source-select` dropdown → `prefsStore.avgDisplay`
- `.toggle-group` — Scores / Expected view mode → `uiStore.matchupsView`
- `v-for` over game rounds (G1, G2, G3 if applicable):
  - Section header (`.match-header`)
  - `v-for` over team pairings: `.matchup` card
    - Two `.team-block` sections with `<PlayerScoreRow>` per player + `.team-total-row`
    - `.vs-bar` divider
  - If `uiStore.oddsRevealed`: `<OddsBlock>` for each pairing
- Odds toggle link: `.odds-toggle` `@click="uiStore.oddsRevealed = !uiStore.oddsRevealed"`
- Floating `.confirm-bar` when `pendingStore.pendingScores` is non-empty (Save / Discard)

**Computed:**
```js
const teams = computed(() => readActiveWeek(dataStore.active))
const leagueAvg = computed(() => getLeagueAvg(dataStore.stats, dataStore.settings, prefsStore.avgDisplay))
```

**Save scores flow:**
```js
async function saveScores() {
  await apiPost('saveScores', { scores: pendingStore.pendingScores })
  await dataStore.loadAll()
  pendingStore.pendingScores = {}
}
```

### `PlayerScoreRow.vue`

**Props:** `{ player: { name, slot, g1, g2, g3, isFill }, gameNum: Number, mode: 'scores' | 'expected' }`

- Shows `.player-avatar` with `initials(player.name)` (`:class="{ champ: isChampion(dataStore.champions, player.name) }"`)
- `.player-name` with name + `.champ-crown` if champion + `.absent-tag` if `isPlayerOut(dataStore.rsvp, player.name)` + `.fill-tag` if `player.isFill`
- `.player-avg` showing `getPlayerCurrentAvg(dataStore.stats, dataStore.settings, player.name, prefsStore.avgDisplay)`
- **Score mode:** `<input type="number">` per game; `@input` → `pendingStore.pendingScores[cellKey] = value`; `:class="{ 'has-score': hasValue, 'score-pending': isPending }"`
- **Expected mode:** `.score-display` showing `Math.round(effectiveAvg(dataStore.stats, dataStore.settings, dataStore.rsvp, player.name, player.isFill, leagueAvg))` per game

### `OddsBlock.vue`

**Props:** `{ teamA: Object, teamB: Object, leagueAvg: Number }`

Computes expected totals for each team using `effectiveAvg()` per player, then calls `spreadAndML(expectedA, expectedB)`.

Renders: `.odds-block` with `.odds-block-label`, `.odds-block-teams` (two `.odds-team-side`), `.odds-line` with `.odds-chip.fav` / `.odds-chip.dog`.

### `LegacyMatchupsPanel.vue`

Read-only display using `dataStore.current` (legacy Current Week sheet format). Similar layout to Active but no score inputs — uses `.score-display` everywhere. View toggle still works (Scores vs Expected). Reference `renderLegacyMatchups()` in `app.js` for the exact data shape of `state.current`.

### `src/App.vue` addition
```vue
<Teleport to="#matchups-content">
  <MatchupsView />
</Teleport>
```

### `app.js` changes
- In `switchTab()`: remove `if (tab === 'matchups') renderMatchups()` line
- In `loadAll()`: remove the `renderMatchups()` call at the end of the try block

### Verify
1. Page load — matchup view renders immediately (active or legacy)
2. Score inputs are editable; pending bar shows count of staged scores
3. View toggle (Scores ↔ Expected) switches display mode
4. Avg source dropdown changes expected score calculations
5. Odds section toggles with smooth reveal
6. Save scores: calls API, data refreshes, pending cleared

---

## Task 6 — Shell migration + cleanup

- [ ] **Status:** Not started

**Prerequisite:** Task 5 (all views migrated)
**Creates:** `src/components/AppHeader.vue`, `src/components/AppNav.vue`, `src/components/AppModal.vue`
**Modifies:** `src/App.vue`, `index.html`, `vite.config.js`

At this point all 5 view content areas are owned by Vue via Teleport. The shell (header, nav, modal) and tab switching still use legacy DOM. This task migrates them and removes app.js from the build.

### `AppHeader.vue`
Renders `<header>` with logo markup + `.week-badge-wrap` showing current week and season from `dataStore.active` or `dataStore.current`. Replaces the static header in `index.html`.

Use `<Teleport to="header">` from App.vue OR restructure index.html to let Vue own the header DOM — the latter is cleaner. Recommended: move the `<header>` out of `index.html` and into `App.vue`'s template, rendered before the section divs.

### `AppNav.vue`
Renders `<nav>` with 5 `.nav-btn` buttons. Tab switching via `uiStore.setTab(tab)`.

When this component is active, **replace** the legacy `switchTab()` calls from nav buttons. Add a `watch` in `App.vue` (or `AppNav.vue`) that mirrors `uiStore.activeTab` to the legacy section CSS classes:
```js
watch(() => uiStore.activeTab, tab => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.getElementById('section-' + tab)?.classList.add('active')
})
```
This bridge keeps the legacy section divs working until `index.html` is fully cleaned up.

### `AppModal.vue`
Small Pinia store (`src/stores/modal.js`) with `content: ref(null)`, `open(html)`, `close()`. `AppModal.vue` renders `.modal-backdrop` with `v-show="modalStore.content"` and a slot/innerHTML for content.

In `App.vue`, expose `openModal` and `closeModal` to `window` so any remaining legacy code can still call them:
```js
import { useModalStore } from './stores/modal.js'
const modalStore = useModalStore()
window.openModal  = (html) => modalStore.open(html)
window.closeModal = () => modalStore.close()
```

### `index.html` changes (ANTIPATTERNS.md decommissioning steps)
1. Remove `<script src="app.js"></script>`
2. Remove the Chart.js CDN `<script>` tag (Chart.js is now imported via npm in `PlayerDetail.vue`)
3. Keep the 5 `<section id="section-*">` divs and their `<div id="*-content">` containers — Teleport still targets them. These are removed in a follow-up once Teleport is replaced with full in-tree Vue rendering

### `vite.config.js` changes
Remove the `copyLegacyScript()` plugin function and its reference in `plugins`:
```js
// Before: plugins: [vue(), copyLegacyScript()]
// After:  plugins: [vue()]
```

### Verify
1. `npm run build` — `dist/` contains only `dist/index.html`, `dist/assets/index-[hash].js`, `dist/assets/index-[hash].css`. **No `dist/app.js`.**
2. All 5 tabs navigate and render correctly
3. Modal system works (any remaining legacy modal calls should route through `window.openModal`)
4. No JavaScript console errors on page load

---

## Dependency Tree

```
Task 0  App.vue wiring
  └── Task 1  StandingsView
        └── Task 2  RsvpView
              └── Task 3  HistoryView
                    └── Task 4a  MoreView (home menu)
                          ├── Task 4b  PlayerList
                          │     └── Task 4c  PlayerDetail (Chart.js)
                          ├── Task 4d  SeasonHistory        ← parallel after 4a
                          ├── Task 4e  LeagueRecords         ← parallel after 4a
                          ├── Task 4f  HeadToHead            ← parallel after 4a
                          ├── Task 4g  Chemistry             ← parallel after 4a
                          ├── Task 4h  TrashBoard            ← parallel after 4a
                          └── Task 4i  GenerateTeams         ← parallel after 4a
                                (all 4* tasks complete)
                                      └── Task 5  MatchupsView
                                            └── Task 6  Shell + cleanup
```

## Key files reference

| File | Role |
|---|---|
| `app.js` | Legacy — modified (render calls removed) per task; deleted in Task 6 |
| `src/App.vue` | Accumulates Teleport entries; becomes full shell in Task 6 |
| `src/stores/data.js` | Server data: `current`, `active`, `roster`, `rsvp`, `stats`, `board`, `champions`, `generated`, `settings` + `loadAll()` |
| `src/stores/ui.js` | Nav/view state: `activeTab`, `moreView`, `selectedPlayer`, `standingsSeason`, `histSeason`, `histWeek`, `recordsSeason`, `chemMode`, `chemExpanded`, `h2hP1`, `h2hP2`, `matchupsView`, `oddsRevealed`, `expandedWeek`, `playerSeason`, `playerLogMode` |
| `src/stores/pending.js` | Unsaved changes: `pendingRSVP`, `pendingScores`, all `gen*` fields |
| `src/stores/prefs.js` | localStorage-backed: `myName`, `avgDisplay` |
| `src/utils/data.js` | Pure data derivation: `aggregateStandings`, `getPlayerProfile`, `getChemistry`, `getLeagueRecords`, `getH2H`, `getMatchupsForWeek`, `getPlayerCurrentAvg`, `readActiveWeek`, etc. |
| `src/utils/helpers.js` | Pure utils: `initials`, `timeAgo`, `isPresent`, `combinations`, `spreadAndML` |
| `src/api.js` | `apiGet(action)`, `apiPost(action, payload)` |
| `styles.css` | Global stylesheet — all classes used by Vue components; do not import, just use class names |
| `index.html` | Legacy HTML shell — section divs kept as Teleport targets until Task 6 |
| `ANTIPATTERNS.md` | Full migration reference — consult for context on any AP |
