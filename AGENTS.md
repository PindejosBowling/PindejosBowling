# AGENTS.md — Pindejos Bowling

Quick-reference for agents working in this repo. Read this before touching any file.

Also read **[VUE_BEST_PRACTICES.md](VUE_BEST_PRACTICES.md)** — the style and architecture guide for all Vue work in this codebase.

---

## What this is

A **bowling league management app** for a friend group. Deployed as a static GitHub Pages site at `https://jordanreticker.github.io/PindejosBowling/`. All persistent data lives in a Google Sheet; the front-end talks to it through a published **Google Apps Script** endpoint.

---

## Architecture overview

The app has been fully migrated from a monolithic `app.js` + `innerHTML` approach to a **Vue 3 SFC** application built with **Vite**, using **Vue Router 4** (hash mode) for navigation. The main branch still contains the legacy `app.js` file, but on `implement-view-components` (and any branch based on it) all rendering is done by Vue components. `app.js` is no longer referenced by `index.html` and is effectively dead code.

**Stack:**
- Vue 3 (Composition API / `<script setup>`)
- Vue Router 4 (hash mode — `createWebHashHistory`)
- Pinia (state management)
- Chart.js (npm, not CDN — imported in `PlayerDetail.vue`)
- Vite (build tool, dev server, base path: `/PindejosBowling/`)
- Global `styles.css` (no CSS-in-JS, no scoped styles)

---

## File structure

```
index.html          — Minimal skeleton: only #vue-app mount point + module script.
styles.css          — All CSS. Global stylesheet; do not import it in components.
app.js              — DEAD CODE. No longer loaded by index.html. Do not edit or rely on it.
vite.config.js      — plugins: [vue()], base: '/PindejosBowling/'
package.json        — vue, vue-router, pinia, chart.js, vite, @vitejs/plugin-vue
src/
  main.js           — createApp + createPinia + router + mount('#vue-app')
  router.js         — All routes; exports the configured router instance (hash mode)
  App.vue           — Layout shell: <header><AppHeader/>, <main><RouterView/>, <nav><AppNav/>, <AppModal/>
  api.js            — apiGet(action), apiPost(action, payload), API endpoint URL
  stores/
    data.js         — Server data: current, active, roster, rsvp, stats, board, champions, generated, settings + loadAll()
    ui.js           — Per-view filter/UI state only (no routing fields): matchupsView, expandedWeek,
                      playerLogMode, oddsRevealed, standingsSeason, playerSeason, histSeason,
                      histWeek, recordsSeason, chemMode, chemExpanded, h2hP1, h2hP2
    pending.js      — Unsaved changes: pendingRSVP, pendingScores, all gen* team-generator fields
    prefs.js        — localStorage-backed: myName, avgDisplay (auto-persisted via watch)
    modal.js        — Modal content: content ref, open(html), close()
  utils/
    data.js         — Pure data derivation (no side effects): aggregateStandings, getPlayerProfile,
                      getChemistry, getLeagueRecords, getH2H, getMatchupsForWeek, getCurrentSeason,
                      getPlayerCurrentAvg, readActiveWeek, hasActiveWeek, effectiveAvg, isChampion,
                      championsForSeason, isPlayerOut, getLeagueAvg, getSeasons, getWeeksForSeason, etc.
    helpers.js      — Pure utils: initials(name), timeAgo(date), escapeHtml(s), isPresent(v),
                      combinations(arr, k), spreadAndML(t1, t2)
    constants.js    — SC (stats sheet column indices), AW_* (active week sheet column indices)
  views/
    MatchupsView.vue      — Dispatcher: ActiveMatchupsPanel or LegacyMatchupsPanel
    StandingsView.vue     — Season-filtered standings table; click row → router.push player-detail route
    RsvpView.vue          — RSVP roster; pending changes + Save/Discard flow
    HistoryView.vue       — Season + week pickers → HistoricalTeamBlock matchup cards
    MoreView.vue          — Layout shell: <RouterView /> outlet for all /more/* child routes
    MoreHomeView.vue      — More home menu grid; tiles call router.push(); hosts admin dialog v-ifs
  components/
    AppHeader.vue         — Logo + week/season badge (rendered inside <header> in App.vue)
    AppNav.vue            — Bottom nav; derives active state from useRoute(); calls router.push()
    AppModal.vue          — .modal-backdrop; shows modalStore.content via v-html
    ActiveMatchupsPanel.vue   — Live scoring: score inputs, expected view, odds, confirm bar
    LegacyMatchupsPanel.vue   — Read-only historical current-week display
    PlayerScoreRow.vue    — Single player row used inside matchup panels
    OddsBlock.vue         — Spread + moneyline block for a pairing
    HistoricalTeamBlock.vue   — Team + player rows used in HistoryView matchup cards
    PlayerList.vue        — Searchable player roster list
    PlayerDetail.vue      — Full player profile: stat tiles, Chart.js chart, game log; reads player name from route.params.name
    SeasonHistory.vue     — Past seasons overview cards
    LeagueRecords.vue     — League records (high game, series, team, avg) with season filter
    HeadToHead.vue        — Two-player H2H comparison with game log
    Chemistry.vue         — Pair/trio win-rate table
    TrashBoard.vue        — Message board; post + feed
    GenerateTeams.vue     — Team generator: controls, generated cards, swap UI
    Playoffs.vue          — Playoffs format info + coming-soon note
    AdminAddPlayerDialog.vue  — Dialog component rendered via v-if in MoreHomeView.vue
    AdminArchiveDialog.vue    — Dialog component rendered via v-if in MoreHomeView.vue
    AdminEndSeasonDialog.vue  — Dialog component rendered via v-if in MoreHomeView.vue
```

---

## Build

```bash
npm run dev      # Vite dev server (hot reload)
npm run build    # Produces dist/ — deploy this to GitHub Pages
npm run preview  # Serve dist/ locally
```

`dist/` contains only `index.html`, `assets/index-[hash].js`, and `assets/index-[hash].css`. There is no `dist/app.js`.

---

## State management (Pinia)

Four stores replace the legacy `state` object. Import only what you need:

```js
import { useDataStore }    from '../stores/data.js'   // server data + loadAll()
import { useUiStore }      from '../stores/ui.js'      // per-view filter state (no routing)
import { usePendingStore } from '../stores/pending.js' // unsaved edits
import { usePrefsStore }   from '../stores/prefs.js'   // localStorage prefs
import { useModalStore }   from '../stores/modal.js'   // modal overlay
```

State is reactive — components update automatically when store values change. Never call a manual `render*()` function; there are none.

`uiStore` no longer holds any routing state. It contains only per-view filter/UI refs (`standingsSeason`, `playerSeason`, `histSeason`, `histWeek`, `recordsSeason`, `chemMode`, `chemExpanded`, `h2hP1`, `h2hP2`, `expandedWeek`, `playerLogMode`, `matchupsView`, `oddsRevealed`). Do not add `activeTab`, `moreView`, `selectedPlayer`, or `setTab` back — those are handled by Vue Router.

---

## Data flow

```
App.vue onMounted → dataStore.loadAll()
  → GET /exec?action=getAll  (Google Apps Script)
  → populates dataStore.* refs
  → Vue computed properties re-derive everything reactively

User taps nav button (AppNav.vue)
  → router.push(path)
  → Vue Router updates route
  → AppNav.vue useRoute() reactive active state updates automatically
  → RouterView renders the correct top-level view

Writes (RSVP, scores, board posts, admin actions)
  → apiPost(action, payload)  →  await dataStore.loadAll()
  → reactive stores update  →  components re-render automatically
```

---

## Navigation

All navigation uses Vue Router. There is no manual DOM tab-switching.

```js
import { useRouter, useRoute } from 'vue-router'
const router = useRouter()
const route  = useRoute()

// Navigate to a top-level view
router.push('/')
router.push('/standings')
router.push('/more')

// Navigate to a named More sub-view
router.push({ name: 'player-detail', params: { name: playerName } })
router.push({ name: 'player-list' })

// Read the current player from params (in PlayerDetail.vue)
route.params.name   // plain string, already URL-decoded by Vue Router
```

### Route map

```
Hash path                    Route name        Component
─────────────────────────    ───────────────   ──────────────────────────────
#/                           —                 MatchupsView
#/rsvp                       —                 RsvpView
#/standings                  —                 StandingsView
#/history                    —                 HistoryView
#/more                       more-home         MoreView → MoreHomeView (default child)
#/more/players               player-list       MoreView → PlayerList
#/more/players/:name         player-detail     MoreView → PlayerDetail
#/more/records               records           MoreView → LeagueRecords
#/more/h2h                   h2h               MoreView → HeadToHead
#/more/chemistry             chemistry         MoreView → Chemistry
#/more/season-history        season-history    MoreView → SeasonHistory
#/more/board                 board             MoreView → TrashBoard
#/more/generate              generate          MoreView → GenerateTeams
#/more/playoffs              playoffs          MoreView → Playoffs
#/:pathMatch(.*)             —                 redirect → /
```

### Why hash mode

GitHub Pages serves only files that exist on disk. A direct request to `/PindejosBowling/standings` returns 404. With hash mode every URL starts with `/PindejosBowling/` — GitHub Pages always returns `index.html`, Vue Router reads the fragment, and renders the correct component. No server configuration required.

---

## CSS

`styles.css` is a global stylesheet linked in `index.html`. All existing class names work inside Vue templates without any import. **Do not add `<style scoped>` blocks** unless adding genuinely new styles that do not exist in `styles.css`. Inline `style=` attributes are acceptable for one-off layout tweaks.

The `.section` / `.section.active` display rules have been removed — those divs no longer exist. Do not reference `#section-matchups` / `#section-rsvp` / `#section-standings` / `#section-history` / `#section-more` by ID; they are gone.

---

## Modal system

`AppModal.vue` renders `modalStore.content` via `v-html`. Use it for simple HTML-string dialogs:

```js
import { useModalStore } from '../stores/modal.js'
const modalStore = useModalStore()
modalStore.open('<div class="modal-title">…</div><div class="btn-row">…</div>')
// buttons inside the HTML can call window.closeModal()
```

For interactive forms that need Vue reactivity (checkboxes, bound inputs, async submission), create a dedicated dialog component instead — see `AdminAddPlayerDialog.vue` as the minimal template. Dialog components are rendered with `v-if` in `MoreHomeView.vue` (not via Teleport) and use the `.modal-backdrop.active` + `.modal` CSS classes directly.

---

## Common utility imports

```js
import { aggregateStandings, getSeasons, getDefaultViewSeason, getCurrentSeason,
         getPlayerProfile, getLeagueRecords, getPersonalRecords, getChemistry,
         getH2H, getMatchupsForWeek, getWeeksForSeason, isChampion,
         championsForSeason, isPlayerOut, hasActiveWeek, readActiveWeek,
         getLeagueAvg, getPlayerCurrentAvg, effectiveAvg } from '../utils/data.js'

import { initials, timeAgo, escapeHtml, spreadAndML } from '../utils/helpers.js'

import { apiPost, apiGet } from '../api.js'
```

---

## Global window APIs (set by App.vue)

These exist for use from admin modal HTML strings that lack Vue scope. Do not add new ones.

| Symbol | What it does |
|---|---|
| `window.openModal(html)` | Opens AppModal with an HTML string |
| `window.closeModal()` | Closes AppModal |
| `window.toast(msg, type)` | Shows an ephemeral toast (type: `'success'` / `'error'` / `''`) |

`window.switchTab` and `window.__resetMoreView` have been removed. Use `router.push()` instead.

---

## GitHub Pages deployment

- **Static files only.** The build output in `dist/` is what gets served.
- **Base path is `/PindejosBowling/`** — already set in `vite.config.js`.
- Deploy by copying `dist/` contents to the `gh-pages` branch, or via a GitHub Actions workflow that runs `npm run build`.

---

## Key patterns

**Back button in More sub-views:** Every component rendered as a child of `/more` is responsible for its own back navigation. Use `router.push('/more')` to return to the More home menu, or `router.push('/more/players')` to return to the player list from PlayerDetail. Import `useRouter` and call `router.push()` — never set `uiStore.moreView`.

**Player identity in PlayerDetail:** The selected player's name comes from `route.params.name` (already URL-decoded by Vue Router), not from a store field. Navigate to a player with `router.push({ name: 'player-detail', params: { name } })`.

**Admin dialogs:** Rendered via `v-if` in `MoreHomeView.vue` using a local `activeDialog = ref(null)`. Set `activeDialog.value = 'add-player'` / `'archive'` / `'end-season'` to open; the dialog emits `close` to reset it. Do not wire new admin actions through `window.*`.

**Loading state:** `dataStore.loading` is `true` during `loadAll()`. Use `v-if="dataStore.loading || !dataStore.stats"` to gate components that need data.

**Chart.js:** Import `Chart from 'chart.js/auto'` (npm, not CDN). Destroy the previous instance before creating a new one in a `watchEffect` with `onCleanup`. See `PlayerDetail.vue`.
