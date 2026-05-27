# HASH_MODE.md — Vue Router (Hash Mode) Migration

Describes the step-by-step implementation of Vue Router 4 with hash mode, replacing the manual tab-switching architecture. Read in conjunction with `ANTIPATTERNS.md`.

## Prerequisites

- AP-5 is complete: all five views and all components in `src/components/` are Vue SFCs.
- `app.js` does not exist. No legacy render functions remain.

---

## Why Hash Mode

Vue Router supports two history drivers: `createWebHistory` (clean URLs like `/standings`) and `createWebHashHistory` (hash URLs like `/#/standings`). This project deploys to GitHub Pages, which is a static file host. GitHub Pages serves only files that exist on disk. A direct request to `/PindejosBowling/standings` returns 404 because no `standings/index.html` exists. With hash mode, every URL begins with the same path (`/PindejosBowling/`) — GitHub Pages always returns `index.html`, Vue Router reads the fragment (`#/standings`), and renders the correct component. No server configuration is required.

---

## What This Migration Removes

| Removed | Replaced by |
|---|---|
| `window.switchTab` global bridge in `App.vue` | `router.push()` at each call site |
| `window.__resetMoreView` global bridge in `MoreView.vue` | `router.push('/more')` at each call site |
| DOM `watch()` in `AppNav.vue` that toggles `.section.active` | `useRoute()` reactive active state |
| `Teleport`-into-section-divs pattern in `App.vue` | `<RouterView>` layout in `App.vue` |
| `<div class="container">` section scaffold in `index.html` | `<main class="container"><RouterView /></main>` in `App.vue` |
| `uiStore.activeTab` ref | `route.path` via `useRoute()` |
| `uiStore.setTab()` action | `router.push()` |
| `uiStore.moreView` ref | Nested route path |
| `uiStore.selectedPlayer` ref | `route.params.name` |
| `v-else-if` sub-view chain in `MoreView.vue` | Nested `<RouterView>` |

The following `uiStore` fields are **not** removed — they are per-view filter/UI state with no routing equivalent: `standingsSeason`, `playerSeason`, `histSeason`, `histWeek`, `recordsSeason`, `chemMode`, `chemExpanded`, `h2hP1`, `h2hP2`, `matchupsView`, `expandedWeek`, `playerLogMode`, `oddsRevealed`.

---

## Route Map

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

Admin dialogs (`AdminAddPlayerDialog`, `AdminArchiveDialog`, `AdminEndSeasonDialog`) are **not** routes. They remain as local `v-if` overlays inside `MoreHomeView.vue` (see Step 6).

The `:name` param in `#/more/players/:name` is the URL-encoded player name. Vue Router decodes it automatically — `route.params.name` always yields the plain string (e.g. `"Garrett Blinkhorn"` not `"Garrett%20Blinkhorn"`).

---

## Step 1 — Install vue-router

**Status:** ✅ Complete

```bash
npm install vue-router@4
```

---

## Step 2 — Create `src/router.js`

**Status:** ✅ Complete

Create this file. It defines every route and exports the configured router instance.

```js
import { createRouter, createWebHashHistory } from 'vue-router'

import MatchupsView  from './views/MatchupsView.vue'
import RsvpView      from './views/RsvpView.vue'
import StandingsView from './views/StandingsView.vue'
import HistoryView   from './views/HistoryView.vue'
import MoreView      from './views/MoreView.vue'
import MoreHomeView  from './views/MoreHomeView.vue'

import PlayerList    from './components/PlayerList.vue'
import PlayerDetail  from './components/PlayerDetail.vue'
import LeagueRecords from './components/LeagueRecords.vue'
import HeadToHead    from './components/HeadToHead.vue'
import Chemistry     from './components/Chemistry.vue'
import SeasonHistory from './components/SeasonHistory.vue'
import TrashBoard    from './components/TrashBoard.vue'
import GenerateTeams from './components/GenerateTeams.vue'
import Playoffs      from './components/Playoffs.vue'

const routes = [
  { path: '/',          component: MatchupsView },
  { path: '/rsvp',      component: RsvpView },
  { path: '/standings', component: StandingsView },
  { path: '/history',   component: HistoryView },
  {
    path: '/more',
    component: MoreView,
    children: [
      { path: '',               name: 'more-home',      component: MoreHomeView  },
      { path: 'players',        name: 'player-list',    component: PlayerList    },
      { path: 'players/:name',  name: 'player-detail',  component: PlayerDetail  },
      { path: 'records',        name: 'records',        component: LeagueRecords },
      { path: 'h2h',            name: 'h2h',            component: HeadToHead    },
      { path: 'chemistry',      name: 'chemistry',      component: Chemistry     },
      { path: 'season-history', name: 'season-history', component: SeasonHistory },
      { path: 'board',          name: 'board',          component: TrashBoard    },
      { path: 'generate',       name: 'generate',       component: GenerateTeams },
      { path: 'playoffs',       name: 'playoffs',       component: Playoffs      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
```

---

## Step 3 — Register the router in `src/main.js`

**Status:** ✅ Complete

Replace the full contents of `src/main.js`:

```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router.js'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#vue-app')
```

---

## Step 4 — Refactor `index.html`

**Status:** ✅ Complete

Remove the entire `<div class="container">` block (the five `<div id="section-*">` elements). Remove the bare `<header>` and `<nav>` elements — `App.vue` now renders semantic `<header>` and `<nav>` wrappers directly, so the empty shell elements in HTML are no longer needed.

The only element in `<body>` after this change is the Vue mount point and its module script.

Replace the full `<body>` content with:

```html
<body>
  <div id="vue-app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
```

The `<link rel="stylesheet" href="styles.css">` in `<head>` is unchanged.

---

## Step 5 — Replace `src/App.vue`

**Status:** ✅ Complete

App.vue becomes a layout component. The Teleport pattern is removed. `RouterView` renders the active top-level view inside `<main>`. `AppHeader` and `AppNav` are wrapped in semantic `<header>` and `<nav>` elements so existing CSS selectors targeting those elements continue to work.

`window.switchTab` and `window.__resetMoreView` are removed (replaced by `router.push()` in Steps 8–9). `window.openModal`, `window.closeModal`, and `window.toast` are kept — they are called from admin dialog HTML that does not have direct access to Vue component scope.

Replace the full contents of `src/App.vue`:

```vue
<template>
  <header>
    <AppHeader />
  </header>
  <main class="container">
    <RouterView />
  </main>
  <nav>
    <AppNav />
  </nav>
  <AppModal />
</template>

<script setup>
import { onMounted }     from 'vue'
import { useDataStore }  from './stores/data.js'
import { useModalStore } from './stores/modal.js'
import AppHeader from './components/AppHeader.vue'
import AppNav    from './components/AppNav.vue'
import AppModal  from './components/AppModal.vue'

const dataStore  = useDataStore()
const modalStore = useModalStore()

onMounted(() => dataStore.loadAll())

window.openModal  = (html) => modalStore.open(html)
window.closeModal = () => modalStore.close()

function toast(msg, type = '') {
  const t = document.createElement('div')
  t.className = 'toast' + (type ? ' ' + type : '')
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2400)
}
window.toast = toast
</script>
```

---

## Step 6 — Create `src/views/MoreHomeView.vue`

**Status:** ✅ Complete

This is a new file. It contains the content currently inside the `v-if="uiStore.moreView === 'home'"` block in `MoreView.vue`, plus the three admin dialog components. The admin dialogs move here because they are only triggered from this view.

All tile `@click` handlers call `router.push()` instead of mutating `uiStore.moreView`.

```vue
<template>
  <AdminAddPlayerDialog v-if="activeDialog === 'add-player'" @close="activeDialog = null" />
  <AdminArchiveDialog   v-if="activeDialog === 'archive'"    @close="activeDialog = null" />
  <AdminEndSeasonDialog v-if="activeDialog === 'end-season'" @close="activeDialog = null" />

  <div class="tab-title"><h2>More</h2></div>

  <div class="section-header">League Tools</div>
  <div class="more-grid">
    <div class="more-tile" @click="router.push('/more/players')">
      <div class="more-tile-icon">🎳</div>
      <div class="more-tile-label">Players</div>
    </div>
    <div class="more-tile" @click="router.push('/more/records')">
      <div class="more-tile-icon">🏆</div>
      <div class="more-tile-label">Records</div>
    </div>
    <div class="more-tile" @click="router.push('/more/h2h')">
      <div class="more-tile-icon">⚔️</div>
      <div class="more-tile-label">Head to Head</div>
    </div>
    <div class="more-tile" @click="router.push('/more/chemistry')">
      <div class="more-tile-icon">🧪</div>
      <div class="more-tile-label">Chemistry</div>
    </div>
    <div class="more-tile" @click="router.push('/more/season-history')">
      <div class="more-tile-icon">📅</div>
      <div class="more-tile-label">Past Seasons</div>
    </div>
    <div class="more-tile" @click="router.push('/more/board')">
      <div class="more-tile-icon">🗑️</div>
      <div class="more-tile-label">Trash Board</div>
    </div>
  </div>

  <div class="section-header">League Admin</div>
  <div class="more-grid">
    <div class="more-tile" @click="router.push('/more/generate')">
      <div class="more-tile-icon">🎲</div>
      <div class="more-tile-label">Generate Teams</div>
    </div>
    <div class="more-tile" @click="activeDialog = 'add-player'">
      <div class="more-tile-icon">➕</div>
      <div class="more-tile-label">Add Player</div>
    </div>
    <div class="more-tile" @click="activeDialog = 'archive'">
      <div class="more-tile-icon">📦</div>
      <div class="more-tile-label">Archive & Advance</div>
    </div>
    <div class="more-tile" @click="activeDialog = 'end-season'">
      <div class="more-tile-icon">🥇</div>
      <div class="more-tile-label">End Season</div>
    </div>
    <div class="more-tile" @click="router.push('/more/playoffs')">
      <div class="more-tile-icon">🏁</div>
      <div class="more-tile-label">Playoffs</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminAddPlayerDialog from '../components/AdminAddPlayerDialog.vue'
import AdminArchiveDialog   from '../components/AdminArchiveDialog.vue'
import AdminEndSeasonDialog from '../components/AdminEndSeasonDialog.vue'

const router      = useRouter()
const activeDialog = ref(null)
</script>
```

---

## Step 7 — Replace `src/views/MoreView.vue`

**Status:** ✅ Complete

MoreView becomes a one-line layout shell. Its only job is to provide a `<RouterView>` outlet for its child routes. The `v-else-if` chain, the admin dialog components, and all `onMounted`/`onUnmounted` lifecycle hooks are removed.

Replace the full contents of `src/views/MoreView.vue`:

```vue
<template>
  <RouterView />
</template>
```

No `<script setup>` block is needed.

---

## Step 8 — Replace `src/components/AppNav.vue`

**Status:** ✅ Complete

Remove the `watch()` that manually toggled `.section.active` on DOM elements. Derive active-tab state from `useRoute()`. Use `router.push()` for navigation.

The `isActive('/')` check uses exact match to prevent the root path from matching every route. All other paths use prefix match so `/more/players` still highlights the More tab button.

Replace the full contents of `src/components/AppNav.vue`:

```vue
<template>
  <button class="nav-btn" :class="{ active: isActive('/') }"          @click="router.push('/')">
    <span class="nav-icon">🎳</span>This Week
  </button>
  <button class="nav-btn" :class="{ active: isActive('/rsvp') }"      @click="router.push('/rsvp')">
    <span class="nav-icon">📋</span>RSVP
  </button>
  <button class="nav-btn" :class="{ active: isActive('/standings') }" @click="router.push('/standings')">
    <span class="nav-icon">📊</span>Standings
  </button>
  <button class="nav-btn" :class="{ active: isActive('/history') }"   @click="router.push('/history')">
    <span class="nav-icon">🗓️</span>Matches
  </button>
  <button class="nav-btn" :class="{ active: isActive('/more') }"      @click="router.push('/more')">
    <span class="nav-icon">⋯</span>More
  </button>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route  = useRoute()

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}
</script>
```

---

## Step 9 — Update navigation call sites

**Status:** ✅ Complete

The following files contain patterns that must be replaced with `router.push()`. Perform a project-wide search for each pattern to confirm the full set before editing.

Search targets:
- `window.switchTab`
- `uiStore.moreView`
- `uiStore.selectedPlayer`
- `window.__resetMoreView`

### 9a — `src/views/StandingsView.vue`

`goToPlayer` sets `uiStore.selectedPlayer` and calls `window.switchTab`. Replace the function and remove the `uiStore` import if it is no longer used after this change.

```js
// Remove
import { useUiStore } from '../stores/ui.js'
const uiStore = useUiStore()
function goToPlayer(name) {
  uiStore.selectedPlayer = name
  uiStore.moreView = 'player-detail'
  window.switchTab('more', { preserveView: true })
}

// Add
import { useRouter } from 'vue-router'
const router = useRouter()
function goToPlayer(name) {
  router.push({ name: 'player-detail', params: { name } })
}
```

### 9b — `src/components/PlayerList.vue`

Two navigation patterns to replace:

```js
// Back button — remove uiStore.moreView = 'home'
// Replace template @click with:
@click="router.push('/more')"

// Player selection — remove both lines:
uiStore.selectedPlayer = name
uiStore.moreView = 'player-detail'
// Replace with:
router.push({ name: 'player-detail', params: { name } })
```

Add `useRouter` import. Remove `uiStore.moreView` and `uiStore.selectedPlayer` usages. Remove the `uiStore` import if no other fields from it remain in use in this file.

### 9c — `src/components/PlayerDetail.vue`

This file has the most changes. `uiStore.selectedPlayer` is used in multiple places for display and data derivation. It becomes `route.params.name`.

The following `uiStore` fields in this file are **view state and must be kept**: `playerSeason`, `playerLogMode`, `expandedWeek`. Do not remove those.

```js
// Add at top of <script setup>
import { useRoute, useRouter } from 'vue-router'
const route  = useRoute()
const router = useRouter()

// Replace every occurrence of uiStore.selectedPlayer with:
route.params.name

// Replace back-button navigation in template:
// Before: @click="uiStore.moreView = 'player-list'"
// After:  @click="router.push('/more/players')"
```

After these replacements, verify that `uiStore` is still imported — it will be, because `playerSeason`, `playerLogMode`, and `expandedWeek` still read from it.

### 9d — `src/components/GenerateTeams.vue`

Two patterns to replace:

```js
// Back button (template):
// Before: @click="uiStore.moreView = 'home'"
// After:  @click="router.push('/more')"

// Programmatic navigation after generating teams (script):
// Before:
uiStore.moreView = 'home'
window.switchTab('matchups')
// After:
router.push('/')
```

Add `useRouter` import. Remove `uiStore.moreView` usages. Remove the `uiStore` import if no other fields from it remain in use in this file.

### 9e — `src/components/SeasonHistory.vue`

```js
// Back button (template):
// Before: @click="uiStore.moreView = 'home'"
// After:  @click="router.push('/more')"
```

### 9f — Remaining More sub-view components

The following components likely contain `uiStore.moreView = 'home'` back-button handlers. Audit each file and replace with `router.push('/more')`:

- `src/components/LeagueRecords.vue`
- `src/components/HeadToHead.vue`
- `src/components/Chemistry.vue`
- `src/components/TrashBoard.vue`
- `src/components/Playoffs.vue`

---

## Step 10 — Remove fields from `src/stores/ui.js`

**Status:** ✅ Complete

After completing Steps 8 and 9, four fields in `ui.js` are no longer referenced. Before deleting, run a project-wide search to confirm zero remaining usages of each:

| Field / action | Search string | Expected result after Steps 8–9 |
|---|---|---|
| `activeTab` ref | `uiStore.activeTab` | 0 results |
| `setTab()` action | `uiStore.setTab` | 0 results |
| `moreView` ref | `uiStore.moreView` | 0 results |
| `selectedPlayer` ref | `uiStore.selectedPlayer` | 0 results |

Remove each confirmed-unused `ref()` declaration and its corresponding entry in the `return` statement. Remove the `setTab` function. Do not remove any other fields.

---

## Step 11 — Update `styles.css`

**Status:** ✅ Complete

The `.section` / `.section.active` rules controlled view visibility by setting `display: none` and `display: block` on the section container divs. Those divs no longer exist. Remove these rules to avoid dead CSS.

Search `styles.css` for the following and remove any rules that show/hide based on `.active`:
- `.section { display: none }` or equivalent
- `.section.active { display: block }` or equivalent
- Any rules targeting `#section-matchups`, `#section-rsvp`, `#section-standings`, `#section-history`, `#section-more` by ID

Do **not** remove `.section-header` or any other `.section-*` class rules used by component templates.

The `.container` CSS rule (max-width, padding, margin) still applies — `<main class="container">` in `App.vue` uses the same class name.

---

## Step 12 — Verify

**Status:** ✅ Complete

Run the dev server:

```bash
npm run dev
```

Test each item in the following checklist:

- [ ] Each nav button updates the URL hash (`#/`, `#/rsvp`, `#/standings`, `#/history`, `#/more`).
- [ ] The correct nav button is highlighted on every route, including all `/more/*` sub-routes.
- [ ] Refreshing the page on any route restores the correct view.
- [ ] Typing an unknown hash path (e.g. `#/nonsense`) redirects to `#/`.
- [ ] Browser Back and Forward buttons navigate between visited routes.
- [ ] Clicking a player name in Standings navigates to `#/more/players/:name` and displays the correct player.
- [ ] All More sub-views are reachable from the More home menu.
- [ ] Each sub-view's back button returns to the correct parent (`/more` or `/more/players`).
- [ ] Admin dialogs (Add Player, Archive, End Season) open and close from the More home menu.
- [ ] `AppModal` opens and closes correctly (used by admin save/confirm actions).
- [ ] `AppHeader` renders inside a `<header>` element and `AppNav` inside a `<nav>` element.

Run the production build:

```bash
npm run build
```

The build should complete with no warnings. `dist/` should contain `index.html` and hashed JS/CSS assets. No `dist/app.js`.
