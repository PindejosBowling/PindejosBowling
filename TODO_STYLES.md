# TODO_STYLES.md — CSS Standardization

Eliminate the one-class-per-use-case pattern inherited from the legacy `innerHTML` architecture. Extract 6 reusable utility classes from the ~15 near-identical patterns currently scattered across `styles.css`, then migrate all Vue components to use them, then delete the dead CSS.

**Target:** reduce `styles.css` from ~80 classes to ~45 by standardizing the 5 most-repeated patterns: eyebrow labels, surface cards, flex list rows, large stat values, and avatar/icon boxes.

Do not touch any class that is structural-only or genuinely unique (nav, modal, confirm-bar, odds layout, score inputs, etc.). Do not add `<style scoped>` blocks to components.

---

## Utility Class Specifications

These are the exact CSS definitions to write in Phase 1.

### `.label` and `.label-sm`
Replaces every eyebrow/uppercase-small-caps label pattern. Use `.label` for section-level headers (12px). Use `.label-sm` for in-row or in-tile labels (10px).

```css
.label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--muted);
  line-height: 1;
}
.label-sm {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--muted);
  line-height: 1;
}
```

### `.card`, `.card-md`, `.card-sm`
Replaces the `background/border/border-radius` surface pattern repeated on every container. Use `.card` (18px) for primary section containers, `.card-md` (14px) for list items and sub-panels, `.card-sm` (12px) for compact controls and stat widgets.

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  overflow: hidden;
}
.card-md {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}
.card-sm {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
```

### `.list-row`
Replaces the `display:flex; align-items:center; border-bottom` base shared by all divider-separated list rows. Individual row classes retain only their unique `padding`, `gap`, and `justify-content`.

```css
.list-row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
}
.list-row:last-child { border-bottom: none; }
```

### `.icon-box`
Replaces the square flex-centered surface box pattern shared by `.player-avatar` and `.record-icon`. Size is set via a modifier class.

```css
.icon-box {
  border-radius: 10px;
  background: var(--surface2);
  border: 1px solid var(--border2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.icon-box.sm { width: 34px; height: 34px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; color: var(--muted); }
.icon-box.md { width: 40px; height: 40px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 15px; color: var(--muted); }
.icon-box.lg { width: 44px; height: 44px; border-radius: 12px; font-size: 22px; }
```

---

## Phase 1 — Add Utility Classes to `styles.css`

**Task:** Insert all utility class definitions into `styles.css` as a labeled block. Do not remove or modify any existing class.

**Where to insert:** After the `.container` rule (line ~22), before `@keyframes fadeUp`. Add this comment header above the block:

```css
/* ─── Utility classes ─────────────────────────────────────────────────────── */
```

Then add the 6 utility blocks (`.label`, `.label-sm`, `.card`, `.card-md`, `.card-sm`, `.list-row`, `.icon-box`) in that order.

**Verification:** `npm run build` must complete without error. No visual changes expected yet.

---

## Phase 2 — Migrate Vue Components

Process files in the order listed. For each file: apply the substitutions, then confirm the build passes before moving to the next file.

**Composition pattern:** When an old class has both typography/surface styles AND unique layout/spacing styles, keep the old class name but strip the absorbed properties from it, and add the utility class alongside it in the template. Example: `class="card matchup"` where `.matchup` retains only `margin-bottom: 16px`.

**Deletion pattern:** When an old class has NO unique properties after stripping (it was purely surface/typography), delete it from `styles.css` and replace it in templates with the utility class alone.

---

### `src/components/ActiveMatchupsPanel.vue`

| Template change | `styles.css` change |
|---|---|
| `class="matchup"` → `class="card matchup"` | Strip `.matchup` to `{ margin-bottom: 16px }` |
| `class="team-label"` → `class="label"` | Strip `.team-label` to `{ margin-bottom: 10px }` |

---

### `src/components/LegacyMatchupsPanel.vue`

Same substitutions as `ActiveMatchupsPanel.vue`. No additional `styles.css` changes needed (already done above).

---

### `src/components/HistoricalTeamBlock.vue`

Same substitutions as `ActiveMatchupsPanel.vue`. No additional `styles.css` changes needed.

---

### `src/components/PlayerScoreRow.vue`

| Template change | `styles.css` change |
|---|---|
| `class="player-avatar"` → `class="icon-box sm player-avatar"` | Strip `.player-avatar` to `{ position: relative }`. Keep `.player-avatar.champ` rule unchanged. |
| `class="score-label"` → `class="label-sm"` | Delete `.score-label` from `styles.css` entirely. |

---

### `src/components/PlayerList.vue`

| Template change | `styles.css` change |
|---|---|
| `class="player-card"` → `class="card-md player-card"` | Strip `.player-card` to `{ padding: 12px 14px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 12px; margin-bottom: 8px }`. Keep `.player-card:hover` rule. |
| `class="player-avatar"` → `class="icon-box md player-avatar"` | Already stripped in `PlayerScoreRow.vue` migration. |

---

### `src/views/StandingsView.vue`

| Template change | `styles.css` change |
|---|---|
| `class="standings-card"` → `class="card"` | Delete `.standings-card` entirely (no unique properties). |
| `class="standing-row"` → `class="list-row standing-row"` | Strip `.standing-row` to `{ display: grid; grid-template-columns: 28px 1fr 70px 60px 56px; gap: 8px; padding: 13px 16px; align-items: center; transition: background 0.15s; cursor: pointer }`. Remove `border-bottom` and the `:last-child` rule — `.list-row` handles both. Keep `.standing-row:hover`. |

Note: `.standings-header` uses a `span` descendant selector for its label styling. Add `class="label-sm"` to each `<span>` inside `.standings-header` in the template, then remove the `.standings-header span { ... }` descendant rule from `styles.css`, leaving `.standings-header` with only its grid/padding definition.

---

### `src/views/RsvpView.vue`

| Template change | `styles.css` change |
|---|---|
| `class="rsvp-stat"` → `class="card-sm rsvp-stat"` | Strip `.rsvp-stat` to `{ flex: 1; padding: 10px 14px }`. |
| `class="rsvp-stat-label"` → `class="label-sm"` | Delete `.rsvp-stat-label` entirely. |
| `class="rsvp-row"` → `class="list-row rsvp-row"` | Strip `.rsvp-row` to `{ gap: 12px; padding: 10px 16px }`. Remove `border-bottom` and `:last-child` — handled by `.list-row`. Keep `.rsvp-row.pending`. |

---

### `src/components/GenerateTeams.vue`

| Template change | `styles.css` change |
|---|---|
| `class="gen-controls"` → `class="card gen-controls"` | Strip `.gen-controls` to `{ padding: 16px; margin-bottom: 16px }`. |
| `class="gen-label"` → `class="label"` | Delete `.gen-label` entirely. |
| `class="team-preview-card"` → `class="card-md team-preview-card"` | Strip `.team-preview-card` to `{ margin-bottom: 12px }`. |
| `class="tp-row"` → `class="list-row tp-row"` | Strip `.tp-row` to `{ justify-content: space-between; padding: 8px 0; gap: 8px }`. Remove `border-bottom` and `:last-child`. |

---

### `src/components/PlayerDetail.vue`

| Template change | `styles.css` change |
|---|---|
| `class="score-history-table"` → `class="card-md"` | Delete `.score-history-table` entirely (no unique properties). |
| `class="chart-card"` → `class="card chart-card"` | Strip `.chart-card` to `{ padding: 16px; margin-bottom: 16px }`. |
| `class="chart-title"` → `class="label chart-title"` | Strip `.chart-title` to `{ margin-bottom: 12px }`. |
| `class="stat-tile-label"` → `class="label-sm"` | Delete `.stat-tile-label` entirely. |

---

### `src/components/SeasonHistory.vue`

| Template change | `styles.css` change |
|---|---|
| `class="history-season"` → `class="card history-season"` | Strip `.history-season` to `{ margin-bottom: 16px }`. |

---

### `src/components/LeagueRecords.vue`

| Template change | `styles.css` change |
|---|---|
| `class="record-card"` → `class="card-md record-card"` | Strip `.record-card` to `{ padding: 14px; margin-bottom: 10px }`. |
| `class="record-icon"` → `class="icon-box lg"` | Delete `.record-icon` entirely. |
| `class="record-label"` → `class="label-sm"` | Delete `.record-label` entirely. |

---

### `src/components/HeadToHead.vue`

| Template change | `styles.css` change |
|---|---|
| `class="h2h-result"` → `class="card h2h-result"` | Strip `.h2h-result` to `{ margin-bottom: 12px }`. |
| `class="h2h-controls"` → `class="card-sm h2h-controls"` | Strip `.h2h-controls` to `{ padding: 12px; margin-bottom: 16px; display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center }`. |
| `class="h2h-stat-label"` → `class="label-sm h2h-stat-label"` | Strip `.h2h-stat-label` to `{ margin-bottom: 6px; text-align: center }`. |

---

### `src/components/Chemistry.vue`

| Template change | `styles.css` change |
|---|---|
| `class="chemistry-card"` → `class="card-sm chemistry-card"` | Strip `.chemistry-card` to `{ padding: 12px 14px; margin-bottom: 8px; display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center }`. |

---

### `src/components/TrashBoard.vue`

| Template change | `styles.css` change |
|---|---|
| `class="board-post"` → `class="card-md board-post"` | Strip `.board-post` to `{ padding: 14px; margin-bottom: 10px }`. |
| `class="board-composer"` → `class="card-sm board-composer"` | Strip `.board-composer` to `{ padding: 12px; margin-bottom: 16px }`. |

---

### `src/views/MoreHomeView.vue` and all `Admin*Dialog.vue` components

No label or card changes expected in these files (tiles and dialogs use structural-only classes). Verify by grepping for any class names targeted in the Phase 3 deletion list.

---

### Section headers (all views that use `.section-header`)

`.section-header` is used across multiple views as a structural divider. After Phase 2 is complete, update all templates that use it:

`class="section-header"` → `class="label section-header"`

Then strip `.section-header` in `styles.css` to remove its typography properties, retaining only:
```css
.section-header {
  margin: 20px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
```

---

### `src/components/AppHeader.vue`

No changes. `.week-badge` and `.season-badge` are accent-colored, not muted — they do not follow the `.label` pattern.

---

## Phase 3 — Prune `styles.css`

After all Phase 2 migrations are complete, verify the following with `grep -r "class-name" src/` before deleting. Only delete a class if grep returns zero matches in the `src/` directory.

### Classes to delete entirely

These classes have no unique properties remaining after Phase 2 stripping:

- `.standings-card`
- `.score-history-table`
- `.gen-label`
- `.rsvp-stat-label`
- `.stat-tile-label`
- `.score-label`
- `.record-icon`
- `.record-label`

### Classes to verify are fully stripped

These classes must contain only their retained unique properties — confirm no absorbed typography or surface styles remain:

| Class | Should contain only |
|---|---|
| `.matchup` | `margin-bottom: 16px` |
| `.team-label` | `margin-bottom: 10px` |
| `.history-season` | `margin-bottom: 16px` |
| `.h2h-result` | `margin-bottom: 12px` |
| `.team-preview-card` | `margin-bottom: 12px` |
| `.board-post` | `padding: 14px; margin-bottom: 10px` |
| `.board-composer` | `padding: 12px; margin-bottom: 16px` |
| `.chart-card` | `padding: 16px; margin-bottom: 16px` |
| `.chart-title` | `margin-bottom: 12px` |
| `.gen-controls` | `padding: 16px; margin-bottom: 16px` |
| `.rsvp-stat` | `flex: 1; padding: 10px 14px` |
| `.record-card` | `padding: 14px; margin-bottom: 10px` |
| `.h2h-controls` | `padding: 12px; margin-bottom: 16px; display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center` |
| `.chemistry-card` | `padding: 12px 14px; margin-bottom: 8px; display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center` |
| `.player-card` | `padding: 12px 14px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 12px; margin-bottom: 8px` |
| `.player-avatar` | `position: relative` |
| `.standing-row` | `display: grid; grid-template-columns: 28px 1fr 70px 60px 56px; gap: 8px; padding: 13px 16px; align-items: center; transition: background 0.15s; cursor: pointer` |
| `.rsvp-row` | `gap: 12px; padding: 10px 16px` |
| `.tp-row` | `justify-content: space-between; padding: 8px 0; gap: 8px` |
| `.h2h-stat-label` | `margin-bottom: 6px; text-align: center` |
| `.section-header` | `margin: 20px 0 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px` |

### Final verification

```bash
# Confirm no deleted class names remain in src/
grep -r "standings-card\|score-history-table\|gen-label\|rsvp-stat-label\|stat-tile-label\|score-label\|record-icon\|record-label" src/

# Confirm new utility classes are used
grep -r "class=\"card\|class=\"label\|class=\"list-row\|class=\"icon-box" src/

# Confirm build is clean
npm run build
```

Expected result: all grep commands for deleted classes return zero matches. Build produces no errors or warnings.
