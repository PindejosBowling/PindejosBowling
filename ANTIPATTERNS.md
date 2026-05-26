# ANTIPATTERNS.md — Pindejos Bowling

Documents known anti-patterns in `app.js` and their resolution path as part of a planned migration to **Vue 3 + Vite + Pinia**, deployed via **GitHub Actions** to GitHub Pages. Read `AGENTS.md` first for project context.

---

## Decided Architecture

The refactoring target is:

| Concern | Decision |
|---|---|
| UI framework | Vue 3 (Composition API + `<script setup>`) |
| State management | Pinia |
| Build tool | Vite |
| Deployment | GitHub Actions → GitHub Pages (official `actions/deploy-pages`) |
| CSS | Global stylesheet, unchanged initially; scoped per-component later |
| Chart.js | Move from CDN to npm package |

The Google Apps Script API endpoint is unchanged — it is called via `fetch` and the framework is agnostic to what is on the other end.

The anti-patterns below are listed in dependency order. Each resolution is framed in terms of the Vue 3 migration target.

---

## AP-1 · God Object with Mixed State Categories

### What it is

A single flat `state` object holds four categories of data with completely different lifecycles, mixed together with no separation:

```js
// Current app.js — everything in one object
const state = {
  // Server data — fetched once from the Google Apps Script API
  current, active, roster, rsvp, stats, board, history, champions, generated, settings,

  // Navigation / view state — changes on every tab switch
  moreView, selectedPlayer, matchupsView, oddsRevealed, expandedWeek, playerLogMode,

  // Filter / preference state — per-view user controls
  standingsSeason, playerSeason, histSeason, histWeek, recordsSeason,
  chemMode, chemExpanded, avgDisplay, h2hP1, h2hP2,

  // Transient / pending state — unsaved local edits
  pendingRSVP, pendingScores, myName,
  genFillMode, genAvgSource, genTeams, genNumTeams, genTeamSize,
  genFillToSize, genSwapTarget,
};
```

### Why it's a problem

Each category has a different invalidation lifecycle. Server data is valid until a write occurs. Navigation state changes on every tab switch. Pending state is either discarded or committed. Preferences survive across renders. No function can reason about any one category in isolation.

### Vue 3 Resolution

Replace the single `state` object with **four Pinia stores**, one per lifecycle category. Each store is a composable that Vue's reactivity system tracks automatically.

```
src/stores/data.js    — server data (populated by loadAll(), cleared on write-back)
src/stores/ui.js      — navigation and view state (activeTab, moreView, selectedPlayer, etc.)
src/stores/pending.js — unsaved RSVP changes, unsaved scores, team generator state
src/stores/prefs.js   — localStorage-backed preferences (avgDisplay, myName, genFillMode, etc.)
```

Example target structure for `stores/data.js`:

```js
// src/stores/data.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGet } from '../api.js'

export const useDataStore = defineStore('data', () => {
  const stats     = ref(null)
  const roster    = ref(null)
  const rsvp      = ref(null)
  const active    = ref(null)
  const settings  = ref(null)
  const champions = ref(null)
  // ... remaining fields

  const loading = ref(false)
  const error   = ref(null)

  async function loadAll() {
    loading.value = true
    try {
      const all = await apiGet('getAll')
      stats.value     = all.stats
      roster.value    = all.roster
      rsvp.value      = all.rsvp
      active.value    = all.activeWeek
      settings.value  = all.settings
      champions.value = all.champions
      // ...
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return { stats, roster, rsvp, active, settings, champions, loading, error, loadAll }
})
```

---

## AP-2 · Manual Render-After-Mutate Coupling

### What it is

Every mutation site must also know which render functions to invoke. This coupling is implicit and scattered across the file:

```js
// Current app.js — every write site carries dependency knowledge manually
state.pendingRSVP = {};
renderRSVP();
renderMatchups();   // caller must know matchups also reads RSVP state

await loadAll();
renderMatchups();
renderMore();       // caller must know More also depends on fresh data
```

### Why it's a problem

There is no single record of which views depend on which state. A state change that forgets a dependent render produces a stale view. Adding any new shared state requires auditing every write site across the 2,400-line file.

### Vue 3 Resolution

Vue's reactivity system eliminates this entirely. When a Pinia store value changes, any component that reads it in its template or a `computed()` automatically re-renders. Write sites become simple mutations — no render calls needed.

```js
// src/stores/pending.js — after saveRSVPChanges completes:
pending.rsvp = {}
// Vue automatically re-renders every component that reads pending.rsvp.
// No explicit render call. No list of dependent views to maintain.
```

---

## AP-3 · No Reactivity — Renders Are Manually Triggered

### What it is

There is no mechanism that observes state and updates the UI. Views only update when a render function is called explicitly. The current flow is:

```
mutation → caller manually calls renderX() → renderX() reads state → innerHTML
```

### Why it's a problem

This is the opposite of the reactive model — every render is pull-based and manually triggered. Adding any feature that touches shared state requires updating every involved write site to call every affected view.

### Vue 3 Resolution

Vue's template system is inherently reactive. A component's template is a function of reactive state — when the state changes, Vue re-renders only the affected parts of the DOM automatically.

```vue
<!-- src/views/StandingsView.vue -->
<!-- No render function. No manual call. Vue handles re-rendering. -->
<template>
  <div v-for="player in standings" :key="player.name" class="standing-row">
    <span>{{ player.name }}</span>
    <span>{{ player.avg.toFixed(1) }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUiStore } from '../stores/ui.js'
import { aggregateStandings } from '../utils/data.js'

const dataStore = useDataStore()
const uiStore   = useUiStore()

// Automatically recomputes when dataStore.stats or uiStore.standingsSeason changes.
// Automatically triggers a re-render of only the affected DOM nodes.
const standings = computed(() =>
  aggregateStandings(dataStore.stats, uiStore.standingsSeason)
)
</script>
```

---

## AP-4 · Expensive Data Derivation on Every Render

### What it is

Functions like `aggregateStandings()`, `getChemistry()`, and `getLeagueRecords()` iterate the full stats dataset from scratch on every render call, even when the underlying data has not changed:

```js
// Current app.js — called inside renderStandings() on every tab switch
const rows = aggregateStandings(state.standingsSeason);
// aggregateStandings() iterates all of state.stats. Every time.
```

### Why it's a problem

These are O(n) or O(n²) operations against the full dataset. As the league accumulates seasons, they degrade silently. The underlying data (`state.stats`) rarely changes but the derivation runs constantly.

### Vue 3 Resolution

Vue's `computed()` is a **memoized reactive getter**. It caches its return value and only recomputes when one of its reactive dependencies changes. This resolves AP-4 without any explicit cache management.

```js
// In a view component — runs once, then only when stats or season changes
const standings = computed(() =>
  aggregateStandings(dataStore.stats, uiStore.standingsSeason)
)
```

The target data utility functions in `src/utils/data.js` should be **pure functions** that accept data as parameters (not read from a store directly). This makes them composable with `computed()` throughout the app.

```js
// src/utils/data.js — pure functions, no store dependency
export function aggregateStandings(stats, season) { /* ... */ }
export function getPlayerProfile(stats, name, season) { /* ... */ }
export function getChemistry(stats, groupSize) { /* ... */ }
export function getLeagueRecords(stats, season) { /* ... */ }
```

---

## AP-5 · HTML Built by String Concatenation (No Templates)

### What it is

Every visible UI element is generated at runtime by JavaScript functions that build raw HTML strings and inject them via `innerHTML`. There are no template files, no component files, no template engine.

```js
// Current app.js — all UI is built this way
function renderStandings() {
  let html = `<div class="standings-card">`;
  rows.forEach(r => {
    html += `<div class="standing-row" onclick="showPlayerDetail('${escapeHtml(r.name)}')">
      <div class="s-avg">${r.avg.toFixed(1)}</div>
    </div>`;
  });
  html += `</div>`;
  $('standings-content').innerHTML = html;
}
```

Consequences:
- Every interpolated value is a potential XSS injection point. `escapeHtml()` must be called manually and consistently — any missed call on user-supplied or server-supplied data is a vulnerability.
- Similar UI patterns (player rows, team blocks, stat tiles) are rebuilt independently across multiple render functions with no enforced reuse.
- There is no component boundary. A "player row" is just a string fragment, not a reusable unit.

### Vue 3 Resolution

Replace render functions with **Vue Single File Components** (`.vue` files). Each `.vue` file is a self-contained unit with a `<template>` (declarative HTML), `<script setup>` (reactive logic), and optionally `<style scoped>` (encapsulated CSS).

```vue
<!-- src/components/PlayerRow.vue — replaces the html_playerRow() pattern -->
<template>
  <div class="player-row" :class="{ absent }">
    <div class="player-avatar" :class="{ champ: isChampion }">{{ initials(name) }}</div>
    <div class="player-info">
      <div class="player-name">
        {{ name }}
        <span v-if="isChampion" class="champ-crown">👑</span>
        <span v-if="absent" class="absent-tag">OUT</span>
      </div>
      <div v-if="avg > 0" class="player-avg">avg {{ avg.toFixed(1) }}</div>
    </div>
  </div>
</template>

<script setup>
import { initials } from '../utils/helpers.js'

const props = defineProps({
  name:       String,
  avg:        Number,
  absent:     Boolean,
  isChampion: Boolean,
})
</script>
```

Vue's template compiler handles escaping automatically — interpolation via `{{ }}` is XSS-safe by default, eliminating the need for manual `escapeHtml()` calls in templates.

**Target component structure:**

```
src/
  views/
    MatchupsView.vue
    RsvpView.vue
    StandingsView.vue
    HistoryView.vue
    MoreView.vue          ← sub-view router
  components/
    PlayerRow.vue
    TeamBlock.vue
    MatchupCard.vue
    PlayerDetail.vue
    PlayerList.vue
    LeagueRecords.vue
    HeadToHead.vue
    Chemistry.vue
    TrashBoard.vue
    GenerateTeams.vue
    AppHeader.vue
    AppNav.vue
    AppModal.vue
```

---

## AP-6 · Inline Event Handlers Embedded in Template Strings

### What it is

Because HTML is built as strings, event handlers are attached as inline `onclick="..."` string attributes. Function names are baked into the strings, and multi-step logic is written directly inside quoted attribute values:

```js
// Current app.js — logic inside a string, inside a template literal
html += `<button onclick="state.moreView='player-list';renderMore();">← Back</button>`;
html += `<select onchange="state.standingsSeason=this.value;renderStandings();">`;
html += `<div class="standing-row" onclick="showPlayerDetail('${escapeHtml(r.name)}')">`;
```

This is a direct consequence of AP-5. It also means **every function called from a UI element must remain globally scoped** — declared at the top level of `app.js`, never inside a module, class, or IIFE. This is the primary blocker for migrating to ES modules.

### Why it's a problem

1. **No ES modules.** Functions inside `export`/`import` modules are not on `window` and cannot be reached by inline `onclick` handlers. The entire codebase must stay in global scope until this is resolved.
2. **Logic in strings.** Untracked, unlintable, untestable imperative code lives inside quoted HTML attribute values.
3. **Argument escaping.** Passing dynamic values like names into inline handlers requires careful quote escaping — a source of subtle bugs.

### Vue 3 Resolution

Vue's event binding (`@click`, `@change`, etc.) replaces all inline handlers. Handlers reference component methods or store actions — never global functions.

```vue
<!-- src/views/StandingsView.vue -->
<template>
  <div
    v-for="(player, i) in standings"
    :key="player.name"
    class="standing-row"
    @click="showPlayer(player.name)"
  >
    {{ player.name }}
  </div>
  <select @change="uiStore.standingsSeason = $event.target.value">
    <option v-for="s in seasons" :key="s" :value="s">Season {{ s }}</option>
  </select>
</template>

<script setup>
import { useUiStore } from '../stores/ui.js'
const uiStore = useUiStore()

function showPlayer(name) {
  uiStore.selectedPlayer = name
  uiStore.moreView = 'player-detail'
  uiStore.setTab('more')
}
</script>
```

With this pattern, no function needs to be globally scoped. ES modules work naturally.

---

## AP-7 · Monolithic Single File

### What it is

All 2,400 lines of application logic — constants, utilities, data derivation, state, API calls, and every render function — live in a single `app.js` file with no module boundaries.

### Why it's a problem

Every agent working in this file must load and reason about the entire codebase to make any change. There is no enforced separation between data logic, UI logic, and API logic. Naming collisions, accidental shared state, and unclear ownership are all possible.

### Vue 3 Resolution

The Vite build process handles ES module bundling. `app.js` is replaced by a structured source tree:

```
src/
  main.js               ← entry point; mounts Vue app, initialises Pinia
  App.vue               ← root component; tab router, header, nav, modal
  api.js                ← all fetch() calls to the Google Apps Script endpoint
  utils/
    constants.js        ← SC column indices, AW column indices, API_URL
    helpers.js          ← initials(), escapeHtml(), timeAgo(), isPresent()
    data.js             ← pure data derivation functions (aggregateStandings, etc.)
  stores/
    data.js             ← Pinia: server data + loadAll() action
    ui.js               ← Pinia: navigation state + setTab() action
    pending.js          ← Pinia: unsaved RSVP/scores/generator state
    prefs.js            ← Pinia: localStorage-backed preferences
  views/                ← one component per top-level tab
  components/           ← shared/reusable UI units
```

---

## Refactoring Order

The anti-patterns form a dependency chain. Work in this sequence to avoid rework:

```
AP-1  Split state into Pinia stores (data / ui / pending / prefs)
  └── AP-2  Remove manual render calls — Pinia mutations trigger Vue reactivity
        └── AP-3  Reactivity is now automatic via Vue templates + computed()
              └── AP-6  Replace inline onclick strings with Vue @event bindings
                        (requires components to exist — do after AP-5)

AP-4  Pure data functions + computed() — do after AP-1, independent of AP-2/3
AP-5  Extract render functions → .vue Single File Components — parallel track
AP-7  Resolved as a natural consequence of completing AP-1 through AP-6
```

**Parallel tracks for agent work:**

- **Track A (state):** AP-1 → AP-2 → AP-3 → AP-6
- **Track B (components):** AP-5, view by view, one component at a time
- **Track C (data):** AP-4, after AP-1

Track B is the highest volume of work. Migrate one view at a time in this order (simplest to most complex): Standings → RSVP → Match History → More (player list, records, H2H, chemistry, board) → Matchups.

---

## Decommissioning `app.js` — End-State Cleanup

When all AP tracks are complete, `app.js` will be empty and the following cleanup closes out the migration entirely. All four steps should be done together in a single commit.

### What moves where

| `app.js` today | Final location in `src/` |
|---|---|
| `const state = { ... }` | `src/stores/data.js`, `ui.js`, `pending.js`, `prefs.js` |
| `apiGet()`, `apiPost()`, `API` const | `src/api.js` |
| `SC`, `AW_*` column index constants | `src/utils/constants.js` |
| `escapeHtml()`, `initials()`, etc. | `src/utils/helpers.js` |
| `aggregateStandings()`, `getChemistry()`, etc. | `src/utils/data.js` |
| `renderMatchups()`, `renderStandings()`, etc. | `src/views/MatchupsView.vue`, `StandingsView.vue`, etc. |
| Inline `onclick` handlers | `@click` bindings inside the corresponding `.vue` files |

### The four cleanup steps

**1. Delete `app.js`**
The file should be empty (or contain only comments) at this point. Remove it from the repo root.

**2. Remove the legacy `<script>` tag from `index.html`**
```html
<!-- Remove this line -->
<script src="app.js"></script>
```
The `<div id="vue-app">` is now the sole app mount point.

**3. Remove the `copyLegacyScript` plugin from `vite.config.js`**
```js
// Remove the plugin function and its import
function copyLegacyScript() { ... }

// Remove from plugins array — only vue() remains
plugins: [vue()]
```

**4. Remove Chart.js CDN script from `index.html`**
```html
<!-- Remove this line — Chart.js is now imported via npm in the component that uses it -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
```

### Verify the build is clean

After cleanup, `npm run build` should produce no warnings and a `dist/` containing only:

```
dist/index.html
dist/assets/index-[hash].js   ← Vue bundle
dist/assets/index-[hash].css  ← compiled styles
```

No `dist/app.js`. No "can't be bundled" warning. The legacy scaffold is gone.
