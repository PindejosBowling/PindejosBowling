# AGENTS.md — Pindejos Bowling

Quick-reference for agents working in this repo. Read this before touching any file.

---

## What this is

A **bowling league management app** for a friend group. Deployed as a static GitHub Pages site at `https://jordanreticker.github.io/PindejosBowling/`. All persistent data lives in a Google Sheet; the front-end talks to it through a published **Google Apps Script** endpoint.

---

## File structure

```
index.html   — 55-line HTML skeleton. No logic, no styles.
styles.css   — All CSS (~331 lines). Imported via <link> in <head>.
app.js       — All JavaScript (~2,401 lines). Loaded via <script src> before </body>.
```

These three files are the entire application. There is no build step, no bundler, no package.json, no node_modules.

---

## GitHub Pages constraints

- **Static files only.** No server-side code, no API routes, no SSR.
- **No build pipeline.** What you commit is exactly what gets served. Never introduce a build step without explicitly discussing it first.
- **Load order is manual.** `index.html` loads Chart.js from CDN first, then `app.js`. Any new script file must be added to `index.html` in the correct dependency order.
- **ES modules work** (`type="module"`) but are **not currently used** — see the inline handler constraint below. Introducing modules is a larger refactor that has been explicitly deferred.

---

## Critical design pattern: JS-generated HTML

**Almost nothing is static HTML.** The `index.html` body contains only five empty container divs (`#matchups-content`, `#rsvp-content`, `#standings-content`, `#history-content`, `#more-content`) plus a sticky header, a bottom nav, and a modal backdrop. Every visible UI element is built at runtime by JavaScript injecting HTML strings into those containers.

Example pattern — representative of the entire codebase:
```js
function renderStandings() {
  let html = `<div class="tab-title"><h2>Standings</h2></div>`;
  rows.forEach(r => {
    html += `<div class="standing-row" onclick="showPlayerDetail('${escapeHtml(r.name)}')">
      ...
    </div>`;
  });
  $('standings-content').innerHTML = html;
}
```

Every render function follows this same build-a-string → `innerHTML` pattern. There is no virtual DOM, no templating library, no JSX.

---

## Inline `onclick` handlers — the global scope requirement

Because HTML is built as strings and injected via `innerHTML`, event handlers are attached as inline `onclick="functionName()"` attributes. This means **every function that is called from a UI element must be globally scoped** (i.e., declared at the top level of `app.js`, not inside a module, class, or IIFE).

**Do not:**
- Wrap `app.js` in an IIFE or module scope
- Use `export`/`import` without also exposing functions on `window`
- Move a function into a nested scope if it is referenced in a rendered HTML string

Violating this silently breaks UI interactions — the browser will log `functionName is not defined` at click time.

---

## State management

A single `state` object at the top of `app.js` holds all runtime state:

```js
const state = {
  current, active, roster, rsvp, stats, board, history, champions,
  generated, settings,
  selectedPlayer, standingsSeason, playerSeason, playerLogMode,
  expandedWeek, histSeason, histWeek, recordsSeason, chemMode,
  moreView, myName, pendingRSVP, pendingScores,
  avgDisplay, matchupsView, oddsRevealed,
  genFillMode, genAvgSource, genTeams, genNumTeams, genTeamSize,
  genFillToSize, genSwapTarget,
  h2hP1, h2hP2
};
```

Mutations happen directly (`state.foo = bar`). Re-rendering is triggered by calling the relevant `render*()` function manually after any state change.

---

## Data flow

```
loadAll()
  → GET /exec?action=getAll  (Google Apps Script)
  → populates state.* fields
  → calls renderMatchups()

Tab switch (user taps nav)
  → switchTab(tab)
  → calls render function for that tab
  → render function reads from state.* (already in memory)
  → builds HTML string → innerHTML

Writes (RSVP, scores, board posts, admin actions)
  → apiPost(action, payload)  (POST to Apps Script)
  → optimistically updates state.*
  → re-renders affected section
```

User-facing data is **never re-fetched** between tab switches — it all lives in `state` after the initial `loadAll()`. The only exception is `doGenerate()`, which does a fresh `apiGet('getRoster')` before generating teams.

---

## Views / navigation

| Nav tab | Section div | Key render function | Sub-views (inside `#more-content`) |
|---|---|---|---|
| This Week | `#matchups-content` | `renderMatchups()` | — |
| RSVP | `#rsvp-content` | `renderRSVP()` | — |
| Standings | `#standings-content` | `renderStandings()` | — |
| Matches | `#history-content` | `renderMatchHistory()` | — |
| More | `#more-content` | `renderMore()` | player-list, player-detail, season-history, records, h2h, chemistry, board, generate, playoffs |

The **More** tab is itself a mini-router: `state.moreView` controls which sub-view is rendered. Sub-views are swapped by setting `state.moreView` and calling `renderMore()`.

---

## Key utilities (top of app.js)

| Symbol | Purpose |
|---|---|
| `API` | Google Apps Script URL — the only backend |
| `SC` | Column index constants for the Weekly Scores sheet |
| `AW_*` | Column index constants for the Active Week sheet |
| `$(id)` | Shorthand for `document.getElementById(id)` |
| `escapeHtml(s)` | Must be called on any user-supplied string before injecting into HTML |
| `apiGet(action)` | GET request to Apps Script |
| `apiPost(action, payload)` | POST with 1 auto-retry on network failure |
| `toast(msg, type)` | Ephemeral status message (auto-removes after 2.4s) |
| `openModal(html)` / `closeModal()` | Single shared modal overlay |

---

## What has already been refactored

- **Phase 1 complete:** CSS and JS were extracted from a monolithic 2,790-line `index.html` into `styles.css` and `app.js`. The HTML skeleton is now 55 lines.
- **Phase 2 (deferred):** Splitting `app.js` into logical modules. Blocked on deciding whether to stay with plain multi-`<script>` files (low effort, keeps inline handlers working) or migrate to ES modules (requires replacing all inline `onclick` strings with `addEventListener` calls).
