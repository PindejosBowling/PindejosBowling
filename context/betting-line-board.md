# Betting Line Board — Place Bets composition

The **Place Bets** view in [src/screens/SportsbookScreen.tsx](../app/src/screens/SportsbookScreen.tsx) renders open betting markets as a board of collapsible sections. It is built as a **reusable, market-type-agnostic stack** so new market kinds (props, team totals, season-long futures) drop in by adding data + a few pure helpers — **with no new rendering code**. Over/under was the first consumer; **game moneylines** are the second (see the moneyline note below) — the board rendered them with no new component code, validating the seam. **Read this before adding a market type to the board.** (Schema/RPC side of adding a bet type lives in [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §7 — keep that authoritative; this section is the **UI** counterpart.)

### The layers (data → screen)

```
usePinsinoData.ts                         (data shapes + market-type seams)
  LineView  ── normalizeMarket(raw) ──  one bettable market, flattened
  SelectionView                          one bettable side (over/under/yes/…)
  helpers: lineGroup · lineCategory · selectionBetsAgainstSubject · closedBettingNote
        │  openLines: LineView[]
        ▼
SportsbookScreen   groups openLines:  game group → line category → lines
        │
        ▼
LineRowContainer   collapsible section (one per category; owns its own collapse state)
        │
        ▼
LineRow            one market row; renders N selection buttons from line.selections
```

### Data shapes (`usePinsinoData.ts`)

- **`SelectionView`** — one `bet_selections` row, flattened: `{ selectionId, key, label, line, odds }`. `key` is the stable side key (`'over'`, `'under'`, `'yes'`, a player id, …); `label` is the display text (rendered uppercased). **Generic** — carries any side, not just over/under.
- **`LineView`** — one market + its selections: `{ marketId, marketType, title, subjectPlayerId, subjectName, gameNumber, line, selections: SelectionView[], inProgress }`. `line` is the **shared** line only when every selection agrees on one (the O/U case); otherwise `null`. `inProgress` = market closed for betting (`status = 'closed'`). `gameNumber` is **nullable** (season-long markets have none).
- `normalizeMarket(raw)` builds a `LineView` from the `MARKET_GRAPH` embed (`bet_selections(*)`), sorting selections by `sort_order`. The hook's `openLines` is `LineView[]`.

### Market-type seams — the **only** places that branch on `market_type`

All four are **pure, exported** functions in `usePinsinoData.ts`. Adding a market type means adding a `case` here, not touching the components.

| Helper | Returns | Role |
|---|---|---|
| `selectionBetsAgainstSubject(marketType, selectionKey)` | `boolean` | **Anti-tanking.** `true` for the side that bets *against* the subject (the `under` on O/U). The screen blocks a player backing this on their own market — also enforced by the `bet_legs_no_self_tank` trigger + the `place_house_bet` RPC (defense in depth). |
| `lineGroup(line)` | `LineGroup {key,label,sortOrder}` | The **outer** section (a game heading). Per-game → `GAME N`; no game → `SEASON` (sorts last). |
| `lineCategory(line)` | `LineCategory {key,label,sortOrder}` | The **inner** collapsible section — one `LineRowContainer`. `over_under` → `Player Overs` (the "under" side is UI-hidden, so the label drops it); `moneyline` → `Moneylines`; else a `title`-based fallback. |
| `closedBettingNote(line)` | `string` | The italic in-progress note copy, market-type aware (game vs. non-game wording). |

### Grouping (two levels, in SportsbookScreen)

`openLines` is bucketed **game group → line category → lines** in one `useMemo`. The screen renders a plain `GAME N` heading (from `lineGroup`), and under it **one `<LineRowContainer>` per category** (from `lineCategory`). So a single game can show several independently-collapsible sections — Player Overs today, Team Totals / Moneylines later. Containers **start collapsed** (`defaultCollapsed`); the collapsed bar summarizes the category (`label` + `N LINES` count). `SEASON`-scoped markets form their own outer group at the end.

### Components

- **`LineRow`** (`{ line, isLast, inProgress?, selectionState?, onSelect? }`) — presentational row for one market. Subject + shared line on the left; **one pick button per `line.selections`** on the right (data-driven, never hardcoded over/under). Mirrors `BetRow`'s "callers gate the callbacks" design:
  - `onSelect(sel)` — what a tap does. Omitted / `inProgress` → inert pills.
  - `selectionState(sel) → { selected?, disabled? }` — **cosmetic only**. `disabled` dims a button but leaves it **pressable**, so the screen's handler still runs (e.g. to toast the anti-tank message). Pressability is governed solely by `inProgress` / presence of `onSelect`.
- **`LineRowContainer`** (`{ title, count, note?, defaultCollapsed?, rows }`) — a collapsible section wrapping a set of rows. **Owns its own collapse state**, so each instance toggles independently of the others; the header is a tappable summary bar (title + `N LINES` + ▾/▸ chevron) and is the primary affordance when collapsed. Presentational — the screen builds the rows. `rows` is a `CollapsibleRow[]` of `{ key, pinned?, render(isLast) }`: the container owns the **visible set** (collapsed → `pinned` rows only; expanded → all) and passes each visible row its `isLast` so borders stay correct as the set changes. **`pinned` keeps a row visible while collapsed** — the screen marks slip-selected lines pinned in parlay mode, so a player's picks stay on-screen under a collapsed header while they build across sections. Whenever any rows are pinned, the bar prefixes the count with an accent `N SELECTED · M LINES` hint (shown open or collapsed).

### How the screen wires selection behavior

The screen owns the betting context (balance, parlay slip, identity) and passes per-mode callbacks into each `LineRow`:

- **Single mode** — `onSelect` opens the wager sheet pre-picked to that selection; `selectionState` dims for `balance < 10` or anti-tank.
- **Parlay mode** — `onSelect` toggles the selection in/out of the slip (one selection per market); `selectionState` marks the slip's selection `selected` and dims anti-tank sides. Lines in the slip are passed to `LineRowContainer` as **`pinned`**, so they stay visible even when their section is collapsed (build-across-sections UX).
- **In progress** — `inProgress` dims the whole row and makes every side inert.

`isSelfTank(line, sel)` in the screen is the single anti-tank predicate: `line.subjectPlayerId === playerId && selectionBetsAgainstSubject(line.marketType, sel.key)`. It gates the single sheet, the parlay toggle, and the placement (the server re-checks regardless).

### UI-hidden selections — the "under" is disabled in the Sportsbook

The **"under" side of player O/U lines is intentionally not bettable** from the Sportsbook. In a small rec league, betting on a leaguemate to do *poorly* has negative social dynamics, so the pick is removed from the board rather than offered. This is a **pure presentation policy**, not a mechanic change:

- **Where:** `SportsbookScreen.tsx` — `isSelectionHiddenInUI(line, sel)` (the policy predicate, `over_under` + `key === 'under'`) and `withVisibleSelections(line)` (strips hidden selections), applied once in the `lineGroups` `useMemo`. Because the filtered `LineView` is what flows into `LineRow`, the parlay slip, and the single-bet sheet, the `under` cannot be selected, parlayed, or shown anywhere downstream. A line that ends up with zero visible selections is dropped from the board.
- **What is *not* touched:** the `under` `bet_selections` row, `normalizeMarket`, `selectionBetsAgainstSubject` (anti-tank still encodes `under` as the against-subject side), and the DB/RPC layer (`place_house_bet`, settlement) all handle `under` exactly as before. The mechanic is fully preserved server-side.
- **Re-enabling:** delete `isSelectionHiddenInUI` / `withVisibleSelections` and restore the plain `for (const line of openLines)` loop in `lineGroups`. No DB or migration work needed. To hide a *different* side (or a side on a future market type) instead, extend `isSelectionHiddenInUI`.

### Game moneylines (the second consumer)

**Moneylines** ("which team wins this game?") are live alongside O/U, proving the seam — they reuse `LineRow` / `LineRowContainer` / the grouping unchanged. Key differences from O/U, all absorbed by the existing shapes:

- **Subject = a game, not a player.** A new `bet_markets.subject_game_id` (uuid → `games.id`) points at the matchup; `subject_player_id` is null. In the DB a moneyline market has **two** selections (`bet_selections.key = team_id`, `label = "Team N"`, `line = null`, even-money). The *board* reshapes this — see the next bullet.
- **"Your Team" only (social policy), shaped like a player prop.** A player may bet **only their own team to win**. The hook ([usePinsinoData.ts](../app/src/hooks/usePinsinoData.ts) `toYourTeamMoneyline`) reduces each moneyline `LineView` to the single selection whose `key` matches the player's week team (`teamSlots.getTeamForPlayerWeek`) and reshapes the row to mirror an O/U prop: `subjectName = "Your Team"`, `subtitle = "MONEYLINE · vs <opponent>"` (the opponent's label, captured before its selection is dropped), and the surviving selection relabeled `"Win"` (→ a single `WIN` button). Matchups the player isn't in **drop out**, so per game a player sees exactly one moneyline row. The opponent side is hidden from the UI but still exists in the DB (settlement needs both). *This is a player-board policy; the house/admin views (`useHousePinsinoData`) and placed-bet history show the real team.*
- **`LineView.subtitle`.** A generic optional left-column metadata line. `LineRow` renders `subtitle` when set, else the O/U `LINE 142.5`, else nothing — so lineless markets (moneyline) carry context in the same slot the prop uses for its line.
- **Headerless section.** The moneyline category renders **without** a `LineRowContainer` (no collapsible header) — [SportsbookScreen.tsx](../app/src/screens/SportsbookScreen.tsx) branches on `category.key === 'moneyline'` and draws the row(s) in a plain card via the shared `renderLine` helper. O/U keeps its collapsible container. `lineCategory` still returns the `moneyline` key (used for grouping/branching) under each `GAME N` group.
- **No line.** `LineView.line = null` ⇒ `LineRow` shows the `subtitle` instead. Placed-bet views (`BetRow`, `BetDetailModal`, `SettleBetModal`, the admin cancel-confirm) gate `line.toFixed(1)` behind `marketType === 'over_under'`; `LegView`/`BetView` carry `marketType`, and `pick` is the selection **label** rather than its key (a uuid).
- **Even money.** Both sides are `2.000`, so `parlayOdds = 2^N` stays exactly correct and moneyline legs parlay freely with O/U legs.
- **No anti-tank.** `selectionBetsAgainstSubject` returns false for moneyline (backing your own team to win is the *only* allowed bet).
- **Auto-generated, auto-settled.** `sync_moneyline_markets_for_week` creates one even-money market per `games` row (wired to **team generation / add-game**, not RSVP — moneylines derive from the schedule). Settlement is automatic on week-archive (`settle_betting_for_week`): winner = the team with the higher combined game score, ties → push. The admin `SettleBetModal` also exposes a manual per-leg path (`settle_moneyline_market`, no score input — derived from entered scores). DB details: [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md).

### Recipe — adding a new market type to the board

The board needs **no new render code**:

1. **Schema / RPCs** — add the market type per [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §7 (`market_type`, selections, placement/settlement).
2. **Fetch** — add a `db.ts` query (or extend one) returning the new markets with the `MARKET_GRAPH` embed, and surface them in `usePinsinoData` so they land in `openLines`. *Today only `betMarkets.listActiveOUByWeek` feeds the board — season-long markets need a season-scoped fetch, and the `THIS WEEK'S LINES` header + empty-state copy are still week-shaped (revisit when that fetch lands).*
3. **`normalizeMarket`** — already generic; just confirm your selections carry `key` / `label` / `line` / `odds` / `sort_order`.
4. **Helpers** — add a `case` to `lineCategory` (section name) and, if a side bets against the subject, to `selectionBetsAgainstSubject`. Touch `lineGroup` only if the scope isn't per-game/season.
5. Done — `LineRow` / `LineRowContainer` / the grouping render it as-is.

> **Known assumption:** `lineCategory` maps `over_under → "Player Overs"` because every O/U subject is a player today. A *team* over/under under the same `market_type` would need the category (and anti-tank) to key off the subject **kind** (player vs team), not `market_type` alone.
