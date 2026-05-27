# Vue Best Practices — Pindejos Bowling

Style and architecture guide for agents and contributors working on this codebase.
Based on [Vue School's large-scale Vue.js application guide](https://vueschool.io/articles/vuejs-tutorials/how-to-structure-a-large-scale-vue-js-application/) and adapted to this project's conventions.

---

## Core Principle: Predictability

> "The best way of making anything predictable is to follow a set of standards."

Every structural and naming decision should answer: *Can I go from a feature request or bug report straight to the right file, and immediately know what tools are available there?*

Predictability means:
- A new agent or contributor can navigate the codebase without reading every file.
- Conventions are consistent enough that the *next* piece of code to write is obvious.
- Files and symbols answer "what are you?" by their name and location alone.

All of the rules below serve this goal.

---

## Stack

| Layer | Tool |
|---|---|
| UI framework | Vue 3 (Composition API, `<script setup>`) |
| Build tool | Vite |
| Routing | Vue Router 4 — hash mode (`createWebHashHistory`) |
| State management | Pinia |
| Charts | Chart.js (npm, not CDN) |
| Styling | Global `styles.css` — no CSS-in-JS |
| Language | Plain JavaScript (no TypeScript) |

---

## Directory Structure

```
src/
  main.js           — App bootstrap: createApp + Pinia + Router + mount
  App.vue           — Root layout shell only; no business logic
  router.js         — All routes in one file
  api.js            — API helpers: apiGet / apiPost + endpoint URL
  views/            — Top-level route components (one per route)
  components/       — Shared/reusable UI components
  stores/           — Pinia stores (one concern per file)
  utils/
    data.js         — Pure data-derivation functions (no side effects)
    helpers.js      — Pure utility functions (formatting, math, etc.)
    constants.js    — Named constants (column indices, magic values)
```

### Rules

- **`views/`** holds components that are mounted directly by Vue Router. They own layout and orchestrate child components. They may read route params and call `router.push()`.
- **`components/`** holds everything else. Components do not import from `views/` and do not call `router.push()` unless they are navigation primitives (e.g., `AppNav.vue`).
- **`stores/`** — one file per logical concern. Components import only the stores they need.
- **`utils/`** — pure functions with no Vue or store imports. Safe to call anywhere.
- **`api.js`** — the only file that knows about the Google Apps Script endpoint URL.

---

## Naming Conventions

### Components

Follow the [official Vue style guide](https://vuejs.org/style-guide/):

| Convention | Example | Rule |
|---|---|---|
| PascalCase filenames | `PlayerDetail.vue` | Always — matches import name |
| Multi-word names | `PlayerList`, not `List` | Avoids collision with native HTML elements |
| App-wide singletons | `AppHeader`, `AppNav`, `AppModal` | `App` prefix for components that appear once in the whole layout |
| Tightly-coupled children | `PlayerScoreRow` (child of a matchup panel) | Name child after parent's subject |
| General → specific | `AdminAddPlayerDialog`, `AdminArchiveDialog` | Most general word first so related files sort together |

### Views

Views follow Laravel-style CRUD resource naming:

| Path | Component Name | Purpose |
|---|---|---|
| `#/` | `MatchupsView` | Default/index |
| `#/standings` | `StandingsView` | List |
| `#/rsvp` | `RsvpView` | Edit/form |
| `#/history` | `HistoryView` | Show |
| `#/more` | `MoreView` + `MoreHomeView` | Shell + default child |

**Convention:** All view filenames end with `View`. This makes it instantly obvious whether a file is a route endpoint or a reusable component.

### Routes

Always define and reference routes by **name** when navigating programmatically:

```js
// ✅ Correct — name-based navigation
router.push({ name: 'player-detail', params: { name: playerName } })

// ❌ Avoid — brittle string paths
router.push('/more/players/' + playerName)
```

Route names use `kebab-case` (`player-detail`, `player-list`, `season-history`).

### Stores

Store files use `camelCase` (`data.js`, `ui.js`). The exported composable uses `use` + PascalCase + `Store`:

```js
// stores/data.js
export const useDataStore = defineStore('data', () => { … })
```

### Utils

Exported functions use `camelCase` (`aggregateStandings`, `getPlayerProfile`, `initials`). Files are named by category (`data.js`, `helpers.js`, `constants.js`).

---

## Component Design

### Single Responsibility

Each component should do one thing. If a component is both fetching data *and* rendering a complex UI *and* managing modal state, split it.

- **Views** orchestrate: they read stores and pass data down via props.
- **Components** display: they receive props and emit events; they do not reach into stores unless the data is truly global (e.g., `dataStore.loading`).

### Props Down, Events Up

```vue
<!-- ✅ Parent passes data, child emits changes -->
<PlayerScoreRow :player="player" @score-change="handleScoreChange" />
```

Avoid mutating props. Use `emit` for communication back to the parent.

### Composition API (`<script setup>`)

All components use `<script setup>`. This is the only style in use in this codebase — do not introduce Options API.

```vue
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDataStore } from '../stores/data.js'

const dataStore = useDataStore()
const localState = ref(null)
const derived = computed(() => …)
onMounted(() => { … })
</script>
```

### Reactive Declarations

- Use `ref()` for primitive values and single-object state.
- Use `computed()` for derived values — never recalculate in templates.
- Use `watch()` / `watchEffect()` for side effects that respond to state changes.
- Never manually call a render or update function; reactivity handles all re-renders.

---

## State Management (Pinia)

### Store Responsibilities

| Store | Owns |
|---|---|
| `data.js` | All server data (`current`, `roster`, `stats`, `rsvp`, `board`, etc.) + `loadAll()` |
| `ui.js` | Per-view UI state only: filter selections, expanded rows, toggle flags |
| `pending.js` | Unsaved edits: pending RSVP, pending scores, team generator fields |
| `prefs.js` | User preferences persisted to `localStorage` (`myName`, `avgDisplay`) |
| `modal.js` | Modal overlay content and open/close |

### Rules

1. **Do not add routing state to `uiStore`.** Route params (`/more/players/:name`) are the source of truth for "which player is selected." Use `route.params` — not a store field.
2. **Do not add new `window.*` globals.** They exist only for legacy modal HTML strings. New interactive dialogs must be Vue components.
3. **One store per concern.** Do not create a giant catch-all store; split by domain.
4. **Import only what you need.** Destructure from the store composable:
   ```js
   const { stats, loading } = storeToRefs(useDataStore())
   ```

---

## Routing

### Navigation

Always use `router.push()`. Never manipulate the URL directly.

```js
import { useRouter, useRoute } from 'vue-router'
const router = useRouter()
const route  = useRoute()

router.push('/')                                          // go home
router.push({ name: 'player-detail', params: { name } }) // named route with param
```

### Route Params as State

If the "currently selected X" changes the URL (e.g., a player detail page), it belongs in a route param, not a store. This enables bookmarkable URLs, browser back/forward, and eliminates the "stale selection" class of bugs.

```js
// In PlayerDetail.vue — player name comes from the URL
const playerName = computed(() => route.params.name)
```

### Back Navigation

Every component rendered as a child route is responsible for its own back button:

```js
router.push('/more')          // return to More home menu
router.push('/more/players')  // return to player list from PlayerDetail
```

### Hash Mode

This app uses `createWebHashHistory` because GitHub Pages cannot handle HTML5 `pushState` routing. Do not change to `createWebHistory` without also solving the 404 redirect problem.

---

## Data Flow

```
App.vue onMounted → dataStore.loadAll()
  → GET /exec?action=getAll
  → populates dataStore refs
  → computed properties re-derive data reactively

User interaction
  → router.push()  →  RouterView updates
  → or store mutation  →  components re-render automatically

Writes (RSVP, scores, posts, admin actions)
  → apiPost(action, payload)
  → await dataStore.loadAll()   ← single re-sync, no manual DOM update
```

**Key rule:** After any write, call `dataStore.loadAll()` to re-sync. Do not patch local store state manually — let the server be the source of truth.

---

## Pure Utils vs. Store Logic

| Belongs in `utils/` | Belongs in a Store |
|---|---|
| Deriving standings from a raw data array | Holding the current standings ref |
| Calculating spread / moneyline odds | Tracking whether odds are revealed |
| Formatting a name as initials | Persisting the user's display name |
| Combinations algorithm | — |

Utils are pure functions: same input always produces same output, no imports from Vue or stores, trivially testable.

---

## CSS

- **One global stylesheet** — `styles.css` linked in `index.html`. All class names work in any component template without importing anything.
- **No `<style scoped>` blocks** unless you are adding genuinely new styles that do not exist in `styles.css`. Scoped styles interact badly with globally-targeted CSS when both target the same elements.
- **Inline `style=`** attributes are acceptable for one-off layout tweaks (e.g., `style="margin-top: 8px"`).
- Do not use CSS-in-JS or CSS Modules — they are not in the stack.

---

## Modal Pattern

Two patterns exist — choose based on whether the dialog needs Vue reactivity:

### Simple HTML-string modal

For read-only dialogs or those with only `window.*`-callable actions:

```js
import { useModalStore } from '../stores/modal.js'
const modalStore = useModalStore()

modalStore.open(`
  <div class="modal-title">Confirm?</div>
  <div class="btn-row">
    <button onclick="window.closeModal()">Cancel</button>
    <button onclick="window.closeModal(); doThing()">OK</button>
  </div>
`)
```

### Dedicated dialog component

For any dialog with reactive form inputs, async submission, or complex state — use a dedicated `*Dialog.vue` component (see `AdminAddPlayerDialog.vue`). Render it with `v-if` in the parent view:

```vue
<!-- In MoreHomeView.vue -->
<AdminAddPlayerDialog
  v-if="activeDialog === 'add-player'"
  @close="activeDialog = null"
/>
```

Do **not** wire new dialogs through `window.*` globals.

---

## Loading State

Gate components that require server data:

```vue
<template>
  <div v-if="dataStore.loading || !dataStore.stats">Loading…</div>
  <MyComponent v-else :data="derivedData" />
</template>
```

`dataStore.loading` is `true` during `loadAll()`. Always guard against `null` data.

---

## Documentation Standards

- **`AGENTS.md`** — Quick-reference for agents: architecture, file map, patterns, constraints. Keep it current whenever the structure changes.
- **`VUE_BEST_PRACTICES.md`** (this file) — Style and architecture principles. Update when the team adopts a new pattern.
- Write or update documentation *before* implementing a non-obvious pattern. Documenting the API first improves the design.
- Each directory that has non-obvious conventions should be described in `AGENTS.md` — do not rely solely on code comments.

---

## Anti-Patterns to Avoid

| Anti-pattern | Why | Do this instead |
|---|---|---|
| Options API (`data()`, `methods:`, `computed:`) | Inconsistent with codebase | `<script setup>` + Composition API |
| Manual DOM manipulation (`document.querySelector`, `innerHTML`) | Bypasses Vue reactivity | Reactive state + template bindings |
| Routing state in `uiStore` | Two sources of truth for location | `route.params` / `router.push()` |
| `window.*` globals for new features | Tight coupling, hard to test | Vue component + `emit` |
| Loading CDN scripts for npm packages | Bypasses build pipeline | `import` from npm |
| Patching local state after a write | Can diverge from server | `await dataStore.loadAll()` |
| Single-word component names | Collides with HTML elements | Multi-word: `PlayerList`, not `List` |
| Deeply nested component directories | Navigation friction | Flat `components/` with descriptive names |

---

## Quick Reference: Import Paths

```js
// Stores
import { useDataStore }    from '../stores/data.js'
import { useUiStore }      from '../stores/ui.js'
import { usePendingStore } from '../stores/pending.js'
import { usePrefsStore }   from '../stores/prefs.js'
import { useModalStore }   from '../stores/modal.js'

// Data utilities (pure functions, no side effects)
import { aggregateStandings, getPlayerProfile, getLeagueRecords,
         getChemistry, getH2H, getMatchupsForWeek, getWeeksForSeason,
         isChampion, championsForSeason, isPlayerOut, hasActiveWeek,
         readActiveWeek, getLeagueAvg, getPlayerCurrentAvg,
         effectiveAvg, getSeasons, getDefaultViewSeason,
         getCurrentSeason, getPersonalRecords } from '../utils/data.js'

// Formatting helpers
import { initials, timeAgo, escapeHtml, spreadAndML } from '../utils/helpers.js'

// Column index constants
import { SC, AW_STATUS, AW_WEEK /* etc. */ } from '../utils/constants.js'

// API
import { apiGet, apiPost } from '../api.js'

// Vue Router
import { useRouter, useRoute } from 'vue-router'
```

---

*Sources: [Vue School — How to Structure a Large-Scale Vue.js Application](https://vueschool.io/articles/vuejs-tutorials/how-to-structure-a-large-scale-vue-js-application/) · [Vue School — 6 Tips for Building Large-Scale Vue.js 3 Applications](https://vueschool.io/articles/vuejs-tutorials/6-tips-for-building-large-scale-vue-js-3-applications/) · [Vue.js Official Style Guide](https://vuejs.org/style-guide/)*
