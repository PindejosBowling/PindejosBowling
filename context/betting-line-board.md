# Betting Line Board — Place Bets composition

The **Place Bets** view in [src/screens/SportsbookScreen.tsx](../app/src/screens/SportsbookScreen.tsx) renders open betting markets as a board of collapsible sections. It is built as a **reusable, market-type-agnostic stack** so new market kinds (moneylines, props, team totals, season-long futures) drop in by adding data + a few pure helpers — **with no new rendering code**. Over/under is the first and currently only consumer. **Read this before adding a market type to the board.** (Schema/RPC side of adding a bet type lives in [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §7 — keep that authoritative; this section is the **UI** counterpart.)

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
| `lineCategory(line)` | `LineCategory {key,label,sortOrder}` | The **inner** collapsible section — one `LineRowContainer`. `over_under` → `Player Over/Unders`; `moneyline` → `Moneylines`; else a `title`-based fallback. |
| `closedBettingNote(line)` | `string` | The italic in-progress note copy, market-type aware (game vs. non-game wording). |

### Grouping (two levels, in SportsbookScreen)

`openLines` is bucketed **game group → line category → lines** in one `useMemo`. The screen renders a plain `GAME N` heading (from `lineGroup`), and under it **one `<LineRowContainer>` per category** (from `lineCategory`). So a single game can show several independently-collapsible sections — Player Over/Unders today, Team Totals / Moneylines later. Containers **start collapsed** (`defaultCollapsed`); the collapsed bar summarizes the category (`label` + `N LINES` count). `SEASON`-scoped markets form their own outer group at the end.

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

### Recipe — adding a new market type to the board

The board needs **no new render code**:

1. **Schema / RPCs** — add the market type per [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §7 (`market_type`, selections, placement/settlement).
2. **Fetch** — add a `db.ts` query (or extend one) returning the new markets with the `MARKET_GRAPH` embed, and surface them in `usePinsinoData` so they land in `openLines`. *Today only `betMarkets.listActiveOUByWeek` feeds the board — season-long markets need a season-scoped fetch, and the `THIS WEEK'S LINES` header + empty-state copy are still week-shaped (revisit when that fetch lands).*
3. **`normalizeMarket`** — already generic; just confirm your selections carry `key` / `label` / `line` / `odds` / `sort_order`.
4. **Helpers** — add a `case` to `lineCategory` (section name) and, if a side bets against the subject, to `selectionBetsAgainstSubject`. Touch `lineGroup` only if the scope isn't per-game/season.
5. Done — `LineRow` / `LineRowContainer` / the grouping render it as-is.

> **Known assumption:** `lineCategory` maps `over_under → "Player Over/Unders"` because every O/U subject is a player today. A *team* over/under under the same `market_type` would need the category (and anti-tank) to key off the subject **kind** (player vs team), not `market_type` alone.
