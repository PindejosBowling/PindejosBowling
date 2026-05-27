# TODO_VUE.md — Style Guide Violations

Style guide violations identified against `VUE_BEST_PRACTICES.md`.
**This file is for tracking only — do not fix anything here; open a branch per issue.**

Severity: 🔴 High · 🟡 Medium · 🔵 Low

---

## 🔴 VIO-01 — Route-level components live in `components/` instead of `views/`

**Rule violated:** *"`views/` holds components that are mounted directly by Vue Router."*

Nine components are imported directly into `router.js` and mounted as routes, but they live in `src/components/`. They exhibit clear view-level behavior: they render their own page headers, back buttons, and call `router.push()` for navigation. They should live in `src/views/`.

| Component | Current location | Mounted as route |
|---|---|---|
| `PlayerList.vue` | `components/` | `#/more/players` |
| `PlayerDetail.vue` | `components/` | `#/more/players/:name` |
| `LeagueRecords.vue` | `components/` | `#/more/records` |
| `HeadToHead.vue` | `components/` | `#/more/h2h` |
| `Chemistry.vue` | `components/` | `#/more/chemistry` |
| `SeasonHistory.vue` | `components/` | `#/more/season-history` |
| `TrashBoard.vue` | `components/` | `#/more/board` |
| `GenerateTeams.vue` | `components/` | `#/more/generate` |
| `Playoffs.vue` | `components/` | `#/more/playoffs` |

**Files to change:**
- `src/router.js` — update import paths from `./components/X` to `./views/X`
- Move the 9 files above from `src/components/` to `src/views/`
- Rename each to match the `*View` convention (e.g., `PlayerList.vue` → `PlayerListView.vue`, `PlayerDetail.vue` → `PlayerDetailView.vue`, etc.) — or keep the existing names if renaming would be too disruptive; the move itself is the essential fix

**Consequence of not fixing:** The components/ directory conflates reusable building blocks with full-page route endpoints. Any agent looking for a page-level component has to hunt across two directories.

---

## 🔴 VIO-02 — Components in `components/` call `router.push()` for back navigation

**Rule violated:** *"Components do not call `router.push()` unless they are navigation primitives."*

This is a direct downstream consequence of VIO-01. Because the 9 components above live in `components/` while acting as views, they import `useRouter` and call `router.push('/more')` as their back-button action. Several also have unused `router` variables after the only callsite is the back button.

Affected files (all call `router.push()` solely for the back button):
- [src/components/Chemistry.vue](src/components/Chemistry.vue) — `router` imported, used only for `router.push('/more')` on line 57
- [src/components/HeadToHead.vue](src/components/HeadToHead.vue) — same pattern, line 107
- [src/components/LeagueRecords.vue](src/components/LeagueRecords.vue) — same pattern, line 139
- [src/components/SeasonHistory.vue](src/components/SeasonHistory.vue) — same pattern, line 48
- [src/components/TrashBoard.vue](src/components/TrashBoard.vue) — same pattern, line 50
- [src/components/Playoffs.vue](src/components/Playoffs.vue) — same pattern, line 58

**Fix:** Resolves automatically when VIO-01 is fixed (these become views, where `router.push()` is appropriate).

---

## 🔴 VIO-03 — Top-level routes have no names; path-based navigation throughout

**Rule violated:** *"Always define and reference routes by name when navigating programmatically. Route names use kebab-case."*

**Part A — Unnamed top-level routes in `router.js`**

The four top-level view routes have no `name` property:

```js
// src/router.js — lines 21–24
{ path: '/',          component: MatchupsView },   // ← no name
{ path: '/rsvp',      component: RsvpView },        // ← no name
{ path: '/standings', component: StandingsView },   // ← no name
{ path: '/history',   component: HistoryView },     // ← no name
```

Without names, every component that navigates to these routes must hardcode the path string, making route refactoring dangerous.

**Part B — `AppNav.vue` uses path strings**

[src/components/AppNav.vue](src/components/AppNav.vue) lines 2–16: all five `router.push()` calls use hard-coded path strings (`'/'`, `'/rsvp'`, `'/standings'`, `'/history'`, `'/more'`) instead of named routes.

```js
// Current (lines 2–16)
@click="router.push('/')"
@click="router.push('/rsvp')"
@click="router.push('/standings')"
@click="router.push('/history')"
@click="router.push('/more')"

// Should be
@click="router.push({ name: 'matchups' })"
@click="router.push({ name: 'rsvp' })"
// etc.
```

**Part C — `MoreHomeView.vue` uses path strings**

[src/views/MoreHomeView.vue](src/views/MoreHomeView.vue) lines 10–17 and 38–55: eight `router.push()` calls use hard-coded paths for routes that already have names defined in `router.js`.

```js
// Current — hard-coded paths
router.push('/more/players')
router.push('/more/records')
router.push('/more/h2h')
router.push('/more/chemistry')
router.push('/more/season-history')
router.push('/more/board')
router.push('/more/generate')
router.push('/more/playoffs')

// Should be — named routes already exist
router.push({ name: 'player-list' })
router.push({ name: 'records' })
router.push({ name: 'h2h' })
router.push({ name: 'chemistry' })
router.push({ name: 'season-history' })
router.push({ name: 'board' })
router.push({ name: 'generate' })
router.push({ name: 'playoffs' })
```

**Fix:** Add names to the 4 unnamed top-level routes in `router.js`, then update `AppNav.vue` and `MoreHomeView.vue` to use `{ name: '...' }` syntax.

---

## 🔴 VIO-04 — Dead DOM badge-sync code uses `document.getElementById`

**Rule violated:** *"Manual DOM manipulation (`document.querySelector`, `innerHTML`) — Bypasses Vue reactivity — Do: Reactive state + template bindings."*

Both matchup panel components contain a `watch()` block that tries to update `#week-badge` and `#season-badge` DOM elements. These element IDs **do not exist** — `AppHeader.vue` renders the badges using CSS classes (`.week-badge`, `.season-badge`), not IDs. The watch blocks are dead code that silently do nothing, but they represent a clear anti-pattern.

**[src/components/ActiveMatchupsPanel.vue](src/components/ActiveMatchupsPanel.vue) — lines 296–315:**
```js
watch(
  () => [dataStore.active, dataStore.stats, dataStore.settings],
  () => {
    ...
    const weekBadge   = document.getElementById('week-badge')    // always null
    const seasonBadge = document.getElementById('season-badge')  // always null
    if (weekBadge) { ... }    // never executes
    if (seasonBadge) { ... }  // never executes
  },
  { immediate: true, deep: false }
)
```

**[src/components/LegacyMatchupsPanel.vue](src/components/LegacyMatchupsPanel.vue) — lines 280–297:** identical pattern with the same dead IDs.

Both blocks carry a comment saying "Task 6 will replace with Vue components" — Task 6 is complete. `AppHeader.vue` already derives `weekLabel` and `currentSeason` reactively from the store. This code should be deleted.

**Fix:** Delete the entire `watch()` block at the bottom of both files. The badge display is already handled reactively by `AppHeader.vue`.

---

## 🔴 VIO-05 — `window.toast` is a DOM-manipulation `window.*` global

**Rule violated:** *"Do not add new `window.*` globals."* and *"Manual DOM manipulation (`document.createElement`, `innerHTML`) — Do: Reactive state + template bindings."*

[src/App.vue](src/App.vue) lines 30–37:
```js
function toast(msg, type = '') {
  const t = document.createElement('div')
  t.className = 'toast' + (type ? ' ' + type : '')
  t.textContent = msg
  document.body.appendChild(t)       // ← direct DOM manipulation
  setTimeout(() => t.remove(), 2400) // ← direct DOM manipulation
}
window.toast = toast  // ← window.* global
```

`window.toast` is then called from Vue components (`AdminAddPlayerDialog.vue`, `AdminArchiveDialog.vue`, `AdminEndSeasonDialog.vue`) — components that have full Vue context and do not need a `window.*` bridge. This bypasses Vue reactivity entirely.

The guide's documented exception for `window.*` is for legacy HTML-string modals that lack Vue scope. Admin dialogs are Vue components — they have direct access to stores and can use a reactive toast system.

**Fix:** Create a `useToastStore` (or add to `ui.js`) with a `toasts` ref and `show(msg, type)` action. Create an `AppToast.vue` component (rendered in `App.vue`) that reads from the store and handles auto-dismiss via a `watchEffect` / `setTimeout`. Update the three Admin dialog components to import and call the store directly. Remove `window.toast` from `App.vue`.

---

## 🟡 VIO-06 — Admin dialogs use `<Teleport>` contrary to documented pattern

**Rule violated:** AGENTS.md documents: *"Dialog components are rendered with `v-if` in `MoreHomeView.vue` (not via Teleport)."*

All three admin dialog components use `<Teleport to="body">`:

- [src/components/AdminAddPlayerDialog.vue](src/components/AdminAddPlayerDialog.vue) line 2
- [src/components/AdminArchiveDialog.vue](src/components/AdminArchiveDialog.vue) line 2
- [src/components/AdminEndSeasonDialog.vue](src/components/AdminEndSeasonDialog.vue) line 2

The `.modal-backdrop` CSS class uses `position: fixed` with a high `z-index`, which means it overlays everything regardless of where it sits in the DOM tree. `Teleport` is not needed. Its presence creates an inconsistency: `AppModal.vue` renders inline (no Teleport) and the dialog components Teleport — but both use the same CSS class and both overlay the full screen.

**Fix:** Remove the `<Teleport to="body">` wrapper from each dialog. The inner `<div class="modal-backdrop active">` already handles the overlay via CSS positioning.

---

## 🟡 VIO-07 — `GenerateTeams.vue` patches store state directly instead of calling `loadAll()`

**Rule violated:** *"After any write, call `dataStore.loadAll()` to re-sync. Do not patch local store state manually — let the server be the source of truth."*

[src/components/GenerateTeams.vue](src/components/GenerateTeams.vue) lines 199–201:
```js
const fresh = await apiGet('getRoster')
if (Array.isArray(fresh)) dataStore.roster = fresh  // ← direct store patch
```

The comment says this is to "refresh roster so latest RSVPs are reflected" before generating teams. But the guide is explicit: never patch store refs from a component — always use `loadAll()`. The current approach partially refreshes state (only `roster`), leaving other store fields potentially stale.

**Fix:** Replace the manual `apiGet('getRoster')` + patch with `await dataStore.loadAll()`. If a full reload is too slow before team generation, add a lightweight `loadRoster()` action to `data.js` that only re-fetches and sets `roster`, keeping the logic inside the store.

---

## 🔵 VIO-08 — `constants.js` uses two different export styles for the same kind of data

**Rule violated:** *"Predictability" core principle — consistent conventions reduce cognitive overhead.*

[src/utils/constants.js](src/utils/constants.js) defines two sets of sheet column indices but with inconsistent structure:

```js
// SC columns — exported as a single named-object (clean, one import)
export const SC = { SEASON: 0, WEEK: 1, PLAYER: 2, ... }

// AW columns — exported as separate flat named exports (11 separate names to import)
export const AW_SEASON  = 0
export const AW_WEEK    = 1
export const AW_TEAM    = 2
// ... 8 more
```

Callers importing `AW_*` need a long destructured import line; callers importing `SC` use one name. Both represent the same category (sheet column indices). Inconsistency here means every agent must remember which style each set uses.

**Fix:** Convert the `AW_*` flat exports to an object export, matching `SC`:
```js
export const AW = {
  SEASON: 0, WEEK: 1, TEAM: 2, SLOT: 3, NAME: 4,
  G1: 5, G2: 6, G3: 7, G1_OPP: 8, G2_OPP: 9, G3_OPP: 10, IS_FILL: 11,
}
```
Then update all import sites to use `AW.WEEK` instead of `AW_WEEK`, etc.

**Affected import sites (files that import `AW_*`):**
- [src/utils/data.js](src/utils/data.js) line 15–16
- [src/components/ActiveMatchupsPanel.vue](src/components/ActiveMatchupsPanel.vue) line 169
- [src/components/LegacyMatchupsPanel.vue](src/components/LegacyMatchupsPanel.vue) (imports `getCurrentSeason` but no AW constants directly — verify)
- [src/components/AppHeader.vue](src/components/AppHeader.vue) line 16

---

## Summary

| ID | Severity | Short description | Primary files |
|---|---|---|---|
| VIO-01 | 🔴 | 9 route-level components in `components/` not `views/` | `router.js`, 9 component files |
| VIO-02 | 🔴 | `router.push()` called from non-navigation components | 6 component files |
| VIO-03 | 🔴 | Unnamed routes + path-based navigation | `router.js`, `AppNav.vue`, `MoreHomeView.vue` |
| VIO-04 | 🔴 | Dead DOM badge-sync via `document.getElementById` | `ActiveMatchupsPanel.vue`, `LegacyMatchupsPanel.vue` |
| VIO-05 | 🔴 | `window.toast` = DOM manipulation + global | `App.vue`, 3 Admin dialog files |
| VIO-06 | 🟡 | Admin dialogs use `<Teleport>` against documented pattern | 3 Admin dialog files |
| VIO-07 | 🟡 | `GenerateTeams.vue` patches `dataStore.roster` directly | `GenerateTeams.vue` |
| VIO-08 | 🔵 | Inconsistent export style in `constants.js` | `constants.js`, 3 import sites |

**Recommended fix order:** VIO-04 (pure deletion, zero risk) → VIO-03 (naming only) → VIO-06 (one-line removal × 3) → VIO-07 (swap API call) → VIO-08 (mechanical rename) → VIO-01+02 (together, larger refactor) → VIO-05 (new store + component).
