# AGENTS.md — Pindejos Bowling

Quick-reference for agents working in this repo. Read this before touching any file.

---

## What this is

A **bowling league management app** for a friend group. Deployed as a static GitHub Pages site at `https://jordanreticker.github.io/PindejosBowling/`. All persistent data lives in a Google Sheet; the front-end talks to it through a published **Google Apps Script** endpoint.

---

## Architecture overview

The app has been fully migrated from a monolithic `app.js` + `innerHTML` approach to a **Vue 3 SFC** application built with **Vite**. The main branch still contains the legacy `app.js` file, but on `implement-view-components` (and any branch based on it) all rendering is done by Vue components. `app.js` is no longer referenced by `index.html` and is effectively dead code.

**Stack:**
- Vue 3 (Composition API / `<script setup>`)
- Pinia (state management)
- Chart.js (npm, not CDN — imported in `PlayerDetail.vue`)
- Vite (build tool, dev server, base path: `/PindejosBowling/`)
- Global `styles.css` (no CSS-in-JS, no scoped styles)

---

## File structure

```
index.html          — 41-line skeleton. Empty <header>, <nav>, five section divs, #vue-app mount point.
styles.css          — All CSS (~331 lines). Still a global stylesheet; do not import it in components.
app.js              — DEAD CODE. No longer loaded by index.html. Do not edit or rely on it.
vite.config.js      — plugins: [vue()], base: '/PindejosBowling/'
package.json        — vue, pinia, chart.js, vite, @vitejs/plugin-vue
src/
  main.js           — createApp + createPinia + mount('#vue-app')
  App.vue           — Root component: shell Teleports (header, nav, modal) + 5 view Teleports
  api.js            — apiGet(action), apiPost(action, payload), API endpoint URL
  stores/
    data.js         — Server data: current, active, roster, rsvp, stats, board, champions, generated, settings + loadAll()
    ui.js           — Nav/view state: activeTab, moreView, selectedPlayer, filter refs, setTab()
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
    StandingsView.vue     — Season-filtered standings table; click → More → Player Detail
    RsvpView.vue          — RSVP roster; pending changes + Save/Discard flow
    HistoryView.vue       — Season + week pickers → HistoricalTeamBlock matchup cards
    MoreView.vue          — Sub-view router (home grid + all sub-views via v-else-if)
  components/
    AppHeader.vue         — <header> logo + week/season badge; Teleported to <header>
    AppNav.vue            — Bottom nav; Teleported to <nav>; drives uiStore.setTab()
    AppModal.vue          — .modal-backdrop; Teleported to <body>; shows modalStore.content via v-html
    ActiveMatchupsPanel.vue   — Live scoring: score inputs, expected view, odds, confirm bar
    LegacyMatchupsPanel.vue   — Read-only historical current-week display
    PlayerScoreRow.vue    — Single player row used inside matchup panels
    OddsBlock.vue         — Spread + moneyline block for a pairing
    HistoricalTeamBlock.vue   — Team + player rows used in HistoryView matchup cards
    PlayerList.vue        — Searchable player roster list
    PlayerDetail.vue      — Full player profile: stat tiles, Chart.js chart, game log
    SeasonHistory.vue     — Past seasons overview cards
    LeagueRecords.vue     — League records (high game, series, team, avg) with season filter
    HeadToHead.vue        — Two-player H2H comparison with game log
    Chemistry.vue         — Pair/trio win-rate table
    TrashBoard.vue        — Message board; post + feed
    GenerateTeams.vue     — Team generator: controls, generated cards, swap UI
    Playoffs.vue          — Playoffs format info + coming-soon note
    AdminAddPlayerDialog.vue  — Modal dialog: add a player to roster
    AdminArchiveDialog.vue    — Modal dialog: archive week + advance
    AdminEndSeasonDialog.vue  — Modal dialog: pick champions + end season
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
import { useUiStore }      from '../stores/ui.js'      // navigation + filter state
import { usePendingStore } from '../stores/pending.js' // unsaved edits
import { usePrefsStore }   from '../stores/prefs.js'   // localStorage prefs
import { useModalStore }   from '../stores/modal.js'   // modal overlay
```

State is reactive — components update automatically when store values change. Never call a manual `render*()` function; there are none.

---

## Data flow

```
App.vue onMounted → dataStore.loadAll()
  → GET /exec?action=getAll  (Google Apps Script)
  → populates dataStore.* refs
  → Vue computed properties re-derive everything reactively

User taps nav button (AppNav.vue)
  → uiStore.setTab(tab)
  → AppNav.vue watch mirrors activeTab to section CSS classes
    (adds .active to #section-<tab>, removes from others)

Writes (RSVP, scores, board posts, admin actions)
  → apiPost(action, payload)  →  await dataStore.loadAll()
  → reactive stores update  →  components re-render automatically
```

---

## Navigation and tab switching

`AppNav.vue` owns the nav bar. It calls `uiStore.setTab(tab)` and watches `uiStore.activeTab` to toggle `.active` on the `#section-*` divs (the CSS tab-switching mechanism). The More sub-view router is `uiStore.moreView`; set it to `'home'` to return to the More grid.

`window.switchTab(tab, opts)` is still exposed from `App.vue` for the one cross-view navigation that originates inside a component (Standings row → More → Player Detail):

```js
window.switchTab('more', { preserveView: true })
```

Do not use this for new code — set `uiStore.setTab()` and `uiStore.moreView` directly.

---

## CSS

`styles.css` is a global stylesheet linked in `index.html`. All existing class names work inside Vue templates without any import. **Do not add `<style scoped>` blocks** unless adding genuinely new styles that do not exist in `styles.css`. Inline `style=` attributes are acceptable for one-off layout tweaks.

---

## Modal system

`AppModal.vue` renders `modalStore.content` via `v-html`. Use it for simple HTML-string dialogs:

```js
import { useModalStore } from '../stores/modal.js'
const modalStore = useModalStore()
modalStore.open('<div class="modal-title">…</div><div class="btn-row">…</div>')
// buttons inside the HTML can call window.closeModal()
```

For interactive forms that need Vue reactivity (checkboxes, bound inputs, async submission), create a dedicated dialog component instead — see `AdminAddPlayerDialog.vue` as the minimal template. Dialog components use `<Teleport to="body">` and the `.modal-backdrop.active` + `.modal` CSS classes directly.

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

These exist for backward-compatible bridges. Do not add new ones.

| Symbol | What it does |
|---|---|
| `window.switchTab(tab, opts)` | Tab switch via uiStore; `opts.preserveView` suppresses moreView reset |
| `window.openModal(html)` | Opens AppModal with an HTML string |
| `window.closeModal()` | Closes AppModal |
| `window.toast(msg, type)` | Shows an ephemeral toast (type: `'success'` / `'error'` / `''`) |
| `window.__resetMoreView()` | Set by MoreView.vue on mount; resets moreView to 'home' |

---

## GitHub Pages deployment

- **Static files only.** The build output in `dist/` is what gets served.
- **Base path is `/PindejosBowling/`** — already set in `vite.config.js`.
- Deploy by copying `dist/` contents to the `gh-pages` branch, or via a GitHub Actions workflow that runs `npm run build`.

---

## Key patterns

**Back button in More sub-views:** Every component rendered inside `MoreView.vue` is responsible for its own back navigation. Render a button that sets `uiStore.moreView = 'home'` (or `'player-list'` for PlayerDetail). There is no generic back button in MoreView itself.

**Loading state:** `dataStore.loading` is `true` during `loadAll()`. Use `v-if="dataStore.loading || !dataStore.stats"` to gate components that need data.

**Chart.js:** Import `Chart from 'chart.js/auto'` (npm, not CDN). Destroy the previous instance before creating a new one in a `watch` with `{ immediate: true }`. See `PlayerDetail.vue`.

**Admin dialogs:** Use `activeDialog = ref(null)` in `MoreView.vue` and render the dialog components with `v-if`. Do not wire new admin actions through `window.*`.
