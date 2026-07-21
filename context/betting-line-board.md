# Betting Line Board — Place Bets composition

The **Place Bets** view in [src/screens/SportsbookScreen.tsx](../app/src/screens/SportsbookScreen.tsx) renders open betting markets as a **flat, filter-driven board**: a scope selector (Weekly / Game N pills) plus a player dropdown, showing the chosen player's available lines for the chosen scope (the collapsible-section board is ⚰️ retired — see below). It is built as a **reusable, market-type-agnostic stack** so new market kinds (props, team totals, season-long futures) drop in by adding data + a few pure helpers — **with no new rendering code**. Over/under was the first consumer; **game moneylines** were the second — the board rendered them with no new component code, validating the seam. **Read this before adding a market type to the board.** (Schema/RPC side of adding a bet type lives in [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §7 — keep that authoritative; this section is the **UI** counterpart.)

### The layers (data → screen)

```
usePinsinoData.ts                         (data shapes + market-type seams)
  LineView  ── normalizeMarket(raw) ──  one bettable market, flattened
  SelectionView                          one bettable side (over/under/yes/…)
  helpers: lineGroup · selectionBetsAgainstSubject · closedBettingNote
        │  openLines: LineView[] · weekGameNumbers: number[]
        ▼
SportsbookScreen   filters openLines:  scope (Weekly / Game N) + selected player
        │                              → one flat card of the player's rows
        ▼
LineRow / CustomLineRow   one subject row / one special; N selection buttons
```

### Data shapes (`usePinsinoData.ts`)

- **`SelectionView`** — one `bet_selections` row, flattened: `{ selectionId, key, label, line, odds }`. `key` is the stable side key (`'over'`, `'under'`, `'yes'`, a player id, …); `label` is the display text (rendered uppercased). **Generic** — carries any side, not just over/under.
- **`LineView`** — one market + its selections: `{ marketId, marketType, title, subjectPlayerId, subjectName, gameNumber, line, statKey, teamId, selections: SelectionView[], inProgress }`. `statKey` = `params.stat` for prop/team_prop markets; `teamId` = `params.team_id` for team_prop markets (null otherwise). `line` is the **shared** line only when every selection agrees on one (the O/U case); otherwise `null`. `inProgress` = market closed for betting (`status = 'closed'`). `gameNumber` is **nullable** (season-long markets have none).
- `normalizeMarket(raw)` builds a `LineView` from the `MARKET_GRAPH` embed (`bet_selections(*)`), sorting selections by `sort_order`. The hook's `openLines` is `LineView[]`.

### Market-type seams — the **only** places that branch on `market_type`

All three are **pure, exported** functions in `usePinsinoData.ts`. Adding a market type means adding a `case` here, not touching the components.

| Helper | Returns | Role |
|---|---|---|
| `selectionBetsAgainstSubject(marketType, selectionKey)` | `boolean` | **Anti-tanking.** `true` for the side that bets *against* the subject (the `under` on O/U). The screen blocks a player backing this on their own market — also enforced by the `bet_legs_no_self_tank` trigger + the `place_house_bet` RPC (defense in depth). |
| `lineGroup(line)` | `LineGroup {key,label,sortOrder}` | A market's **scope**: per-game → `game-N`; no game + night-capable type → `weekly`; else `season`. Doubles as the board's **scope-filter key** (`lineGroup(line).key === scope`) and as the Active Bets grouping (via the underlying `marketGroup`). |
| `closedBettingNote(line)` | `string` | The italic in-progress note copy, market-type aware (game vs. non-game wording). |

### Filters + flat board (in SportsbookScreen)

The board is driven by **two screen-local filters** (plain `useState`, reset on each visit), plus the Combine chip:

- **Scope pills** — `Weekly` + one `Game N` pill per entry in the hook's `weekGameNumbers` (schedule ∪ any per-game lines, so the count follows the actual schedule, not a hardcoded 2). Scope keys are `lineGroup` keys, so matching lines to the scope reuses the existing seam. *Accepted gap:* season-long markets (`lineGroup → 'season'`) have no pill — no season-scoped fetch exists yet; add a `Season` pill when it lands.
- **Player select** — a full-width anchored `Dropdown` (the SeasonDropdown trigger idiom; no separate sheet), populated **only by players with in-scope availability**: their own visible lines ∪ combo membership ∪ special involvement. Names seed from `rsvpInPlayers` first so resolved-leg display names ("You") never leak into the picker; the viewer's entry is suffixed `(you)`. Hidden when the scope is empty (the empty-scope card shows instead).
- **COMBINE chip** (a `PickChip` trailing the scope pills) — enters board-native combo building; see the combine-mode section below.

The pipeline is three `useMemo`s: `visibleLines` (the under-hide policy applied once — see below), `scopeOptions`, and `board`, which scope-filters lines + specials, derives the available-player pool, resolves the **effective selection** (derived, not synced — no reconciling effect): the user's explicit pick while still available → the viewer when they have in-scope lines → the first available player → none (an empty-scope card: "No Weekly lines are open yet"). Membership rules: a **combo** shows when the selected player is in its `comboMemberIds`; a **special** when any resolved leg's `subjectPlayerId` is the selected player (self-referential specials resolve legs to the viewer's id, so they surface only under the viewer's own entry); a special's scope is its derived `gameNumber` (`null` → Weekly).

Render order, one flat card: **specials → the player's consolidated row → their combos**. The player's markets consolidate into ONE `LineRow` — a unified button set (`142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES`, score line first, then stat props); each combo is its own row. The row carries the `subjectRelation` tint (green-cast teammate / red-cast matchup opponent; combos neutral). Any closed market in scope locks the whole scope (`scopeInProgress` → the italic note + inert rows), mirroring the old group-level lock.

> ⚰️ **RETIRED (2026-07-21): the collapsible board.** `LineRowContainer` (per-group collapsible sections with `pinned` rows keeping slip picks visible while collapsed) and the `lineCategory` seam were deleted with the flat-filter cutover — the two filters ARE the navigation. **Pinning has no replacement and needs none:** the slip is global (`BetSlipProvider`), so staged picks persist in the slip bar while the user switches player/scope — that bar is the cross-section-building affordance now.

### Board-native combo building (combine mode)

Combos are built **on the board itself** (the ⚰️ `ComboComposerSheet` + "+ Build a Combo" CTA retired 2026-07-21). Screen state: `combo: { stat: string | null; members: Set<string> } | null` — `null` off, `{stat: null}` **armed**, stat set = the **stat-view pivot**.

1. **Arm** — the COMBINE chip in the filter row (rendered when a live week/season exists; dim-but-pressable → toast under 2 RSVP'd players; tap while on = cancel). While armed, `renderLineSet`'s `onSelect` switches from `stagePick` to `enterStatView` and `selectionState` returns `{}` (no anti-tank dim — over-on-self is legal for combos).
2. **Seed** — tapping any stat pill seeds the combo: `comboStatOf` maps the score O/U → `total_pins`, a prop → its `statKey` (combo/special chips can't seed → toast); the tapped subject becomes the first member.
3. **Pivot** — the board swaps to a member-picking list: **every RSVP'd-in player** (`rsvpInPlayers` — RSVP is the compose RPC's only eligibility rule; a player with no individual line still combines), viewer first, each row showing their solo line for the stat as context and a `+`/`✓` `PickChip`. The player select and specials/combo rows hide; **the scope pills stay live** — the combo's scope follows the board's scope filter (Weekly → `night` w/ `nGames = max(weekGameNumbers.length, 1)`, Game N → `game`), and a mid-build switch just re-previews.
4. **BuilderBar** — a floating bar in the slip bar's exact footprint (the provider's **`setSlipBarHidden`** flag yields it; restored by an effect cleanup on every exit). Left: member names + the debounced live line (`useComboLinePreview` → `betMarkets.previewComboLine`, 250ms); right: Cancel + **Add** (disabled until 2+ members and a line, or when the scope is in progress — the RPC would reject). The staging key is the canonical `stat|('night'|gameN)|sortedMemberIds` — when that exact combo is already staged the CTA flips to **Remove** (`stageCombo` toggles by key; a blind Add would silently unstage).
5. **Add** — builds the `SlipCombo` spec, `stageCombo`s it, and exits combine mode; the combo just lands in the slip bar like any staged pick (no auto-raise of the placement sheet). Exit paths: Cancel, Add, view change / readOnly flip (effect reset), unmount.

### Components

- **`LineRow`** (`{ lines, isLast, relation?, inProgress?, selectionState?, onSelect? }`) — presentational row for **one betting subject** holding ≥1 markets. Subject (+ optional `subtitle` metadata) on the left; **one pick button per (line, selection)** across all its markets on the right (data-driven, never hardcoded over/under; buttons wrap when the set outgrows the row). Single-market rows are the one-element case. **The button IS the line being agreed to** (`selectionButtonLabel`): every offered side is an over (unders are UI-hidden — all bets are over by definition), so an over side renders as the full condition — threshold + what's counted: `142.5+ PINS` on a score line, `4.5+ STRIKES` / `12.5+ CLEAN FRAMES` on a stat prop — while lineless sides (moneyline) keep their label (`WIN`). Mirrors `BetRow`'s "callers gate the callbacks" design:
  - `onSelect(sel)` — what a tap does. Omitted / `inProgress` → inert pills.
  - `selectionState(sel) → { selected?, disabled? }` — **cosmetic only**. `disabled` dims a button but leaves it **pressable**, so the screen's handler still runs (e.g. to toast the anti-tank message). Pressability is governed solely by `inProgress` / presence of `onSelect`.
- **`Dropdown`** (`components/ui/Dropdown.tsx`) — the anchored menu backing the board's player filter (full-width trigger, floating menu, `✓` on the active row).
- **`PickChip`** (`{ label, sublabel?, selected?, disabled?, inert?, gold?, size?, grid?, onPress? }`) — the shared ticket-style pick/odds cell: soft-tinted at rest, solid accent (gold for specials) when selected, `disabled` cosmetic-only (still pressable → toasts), `inert` for in-progress. `LineRow`'s pick buttons, `CustomLineRow`'s ×odds multiplier, the COMBINE chip, and the pivot's `+`/`✓` checks are all PickChips.
- **`TicketCard`** (`{ header?, gold?, haunted?, onPress?, footer?, children }`) — the ticket shell (**one card = one bet**): accent top rail, optional title+badge header, dashed "perforation" before the footer; gold trim for specials, gold outline for haunted. Shared by the slip's build tickets, `CustomLineRow`, and `BetRow` — what you build looks like what you placed. Styles live in `theme.ts` `ticketStyles`.
- **`BuilderBar`** (`{ memberNames, statLabel, scopeLabel, line, minMembers, alreadyStaged, blocked?, onAdd, onCancel }`) — the combine-mode floating bar (slip-bar footprint).
- **The slip sheet** (`BetSlip`) renders **one `TicketCard` per resulting bet**: parlay mode = one ticket holding every pick/combo leg (each with its ✕) + one stake; singles = a ticket per pick/combo with its own stake; specials always their own gold-trimmed tickets. The Singles/Parlay toggle merges/splits the tickets; the item toggles (Golden Ticket / Winner's Crutch / Energy Drink) render **inside the sole ticket's footer** when the slip resolves to one bet (crutch additionally multi-leg).

### How the screen wires selection behavior

The screen owns the betting context (balance, parlay slip, identity) and passes per-mode callbacks into each `LineRow`:

- **Single mode** — `onSelect` opens the wager sheet pre-picked to that selection; `selectionState` dims for `balance < 10` or anti-tank.
- **Parlay mode** — `onSelect` toggles the selection in/out of the slip (one selection per market); `selectionState` marks the slip's selection `selected` and dims anti-tank sides. Staged picks persist in the global slip bar while the player/scope filters change, so parlays build across players and scopes.
- **In progress** — `inProgress` dims the whole row and makes every side inert.

`isSelfTank(line, sel)` in the screen is the single anti-tank predicate: `selectionBetsAgainstSubject(line.marketType, sel.key)` AND ownership — `line.subjectPlayerId === playerId` for player markets, `line.teamId === weekTeams.myTeamId` for team_prop markets. It gates the single sheet, the parlay toggle, and the placement (the server re-checks regardless via the `prevent_self_tank` trigger).

### UI-hidden selections — the "under" is disabled in the Sportsbook

The **"under" side of player O/U lines is intentionally not bettable** from the Sportsbook. In a small rec league, betting on a leaguemate to do *poorly* has negative social dynamics, so the pick is removed from the board rather than offered. This is a **pure presentation policy**, not a mechanic change:

- **Where:** `SportsbookScreen.tsx` — `isSelectionHiddenInUI(line, sel)` (the policy predicate, `over_under` + `key === 'under'`) and `withVisibleSelections(line)` (strips hidden selections), applied once in the `visibleLines` `useMemo`. Because the filtered `LineView` is what flows into `LineRow`, the parlay slip, and the single-bet sheet, the `under` cannot be selected, parlayed, or shown anywhere downstream. A line that ends up with zero visible selections is dropped from the board.
- **What is *not* touched:** the `under` `bet_selections` row, `normalizeMarket`, `selectionBetsAgainstSubject` (anti-tank still encodes `under` as the against-subject side), and the DB/RPC layer (`place_house_bet`, settlement) all handle `under` exactly as before. The mechanic is fully preserved server-side.
- **Re-enabling:** delete `isSelectionHiddenInUI` / `withVisibleSelections` and let `visibleLines` pass `openLines` through unchanged. No DB or migration work needed. To hide a *different* side (or a side on a future market type) instead, extend `isSelectionHiddenInUI`.

### Game moneylines (the second consumer) — ⚰️ RETIRED for generation (2026-07-21)

> **Moneyline generation is retired** with the combo-lines cutover
> ([combo-lines.md](combo-lines.md)): `sync_moneyline_markets_for_week` is a
> no-op stub, the board no longer fetches moneylines, and
> `toYourTeamMoneyline` was removed from the hook. The section below is kept
> as the **historical rendering contract** — settled moneyline bets still
> render via `normalizeMarket`/`betLineSuffix`, the settle path
> (`settle_moneyline_market[_internal]`) survives for historical
> unarchive/resettle, and the status toggles remain for any bets open at
> cutover. Head-to-head has no replacement (accepted gap; PvP covers it).

**Moneylines** ("which team wins this game?") were live alongside O/U, proving the seam — they reused `LineRow` / `LineRowContainer` / the grouping unchanged. Key differences from O/U, all absorbed by the existing shapes:

- **Subject = a game, not a player.** A new `bet_markets.subject_game_id` (uuid → `games.id`) points at the matchup; `subject_player_id` is null. In the DB a moneyline market has **two** selections (`bet_selections.key = team_id`, `label = "Team N"`, `line = null`, even-money). The *board* reshapes this — see the next bullet.
- **"Your Team" only (social policy), shaped like a player prop.** A player may bet **only their own team to win**. The hook ([usePinsinoData.ts](../app/src/hooks/usePinsinoData.ts) `toYourTeamMoneyline`) reduces each moneyline `LineView` to the single selection whose `key` matches the player's week team (`teamSlots.getTeamForPlayerWeek`) and reshapes the row to mirror an O/U prop: `subjectName = "Your Team"`, `teamId` stamped with the viewer's team (so the board consolidates it with the team's team_prop lines — see the team-props section), `subtitle = "vs <opponent>"` (the opponent's label, captured before its selection is dropped), and the surviving selection relabeled `"Win"` (→ a `WIN` button leading the team row). Matchups the player isn't in **drop out**, so per game a player sees exactly one moneyline. The opponent side is hidden from the UI but still exists in the DB (settlement needs both). *This is a player-board policy; the house/admin views (`useHousePinsinoData`) and placed-bet history show the real team.*
- **`LineView.subtitle`.** A generic optional left-column metadata line (`LineRow` renders it when set). The line value itself is no longer drawn on the left — it lives in the pick button (`selectionButtonLabel`).
- **No separate section.** `lineCategory` maps moneyline into `player_ou`, so the WIN button renders inside the game's collapsible listing as part of the viewer's **team row** (consolidated with the team's team_prop lines via the stamped `teamId`; the team row leads the team's player rows).
- **No line.** `LineView.line = null` ⇒ `LineRow` shows the `subtitle` instead. Placed-bet views (`BetRow`, `BetDetailModal`, `SettleBetModal`, the admin cancel-confirm) gate `line.toFixed(1)` behind `marketType === 'over_under'`; `LegView`/`BetView` carry `marketType`, and `pick` is the selection **label** rather than its key (a uuid).
- **Even money.** Both sides are `2.000`, so `parlayOdds = 2^N` stays exactly correct and moneyline legs parlay freely with O/U legs.
- **No anti-tank.** `selectionBetsAgainstSubject` returns false for moneyline (backing your own team to win is the *only* allowed bet).
- **Auto-generated, auto-settled.** `sync_moneyline_markets_for_week` creates one even-money market per `games` row (wired to **team generation / add-game**, not RSVP — moneylines derive from the schedule). Settlement is automatic on week-archive (`settle_betting_for_week`): winner = the team with the higher combined game score, ties → push. The admin `SettleBetModal` also exposes a manual per-leg path (`settle_moneyline_market`, no score input — derived from entered scores). DB details: [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md).

### LaneTalk stat props (the third consumer)

**LaneTalk stat lines** (strikes + spares + clean frames O/U at BOTH scopes — per game and per night — since the 2026-07-01 standardization; first-ball avg retired for new markets; `market_type='prop'`, `params.stat`/`params.scope`) render through the stack with zero new row components — full feature doc: [lanetalk-stat-bets.md](lanetalk-stat-bets.md). Board specifics:

- **Fetch:** `betMarkets.listActivePropByWeek` merged into `openLines` alongside O/U + moneyline.
- **`LineView.statKey`** (from `params.stat`) — the full condition renders in the pick button (`4.5+ STRIKES`, via `selectionButtonLabel`); prop rows carry no subtitle.
- **Scoping:** per-game props land in that game's scope alongside the score O/U; night props (`gameNumber == null`) land in the **Weekly** scope (`marketGroup` routes null-game over_unders/props to `weekly`). The **player night total-pins O/U** (`market_type='over_under'`, `game_number` null, `params.scope='night'` — settled at archive from Σ the player's scores, NOT a LaneTalk market) joins the same Weekly row. **One stat order** (`kindOrder` in the board memo): the player's consolidated row reads `PINS · CLEAN FRAMES · STRIKES · SPARES` (night pins button reads `TOTAL PINS`).
- **Anti-tank + under-hide:** `selectionBetsAgainstSubject('prop','under') → true`, and `isSelectionHiddenInUI` hides the prop under exactly like the score O/U under (same social policy, same trivial revert).
- **Open/close:** props ride the game toggles (`setPropStatusByWeekGame`); closing game 1 also closes the night markets (incl. the night total-pins O/U via `setOUStatusByWeekGame`'s null-game branch); `reopenOUForWeek` reopens props too.
- **Placed-bet surfaces** (`BetRow`, `BetDetailModal`, `SettleBetModal`, `LedgerRow`) render the shared `betLineSuffix` helper ("OVER 4.5 STRIKES"); `LegView`/`BetView` carry `statKey`.

### Team-aggregate props (the fourth consumer) — ⚰️ RETIRED for generation (2026-07-21)

> **Team-prop generation is retired** — **combo lines replaced them**
> ([combo-lines.md](combo-lines.md)): `sync_team_prop_markets_for_week` is
> dropped from the resync fan-out, the board no longer fetches team props, and
> the "Your Team" relabel is gone from the hook. Kept for history + cutover:
> the settle branches (c′/c″), `team_prop_seed_line`, the `prevent_self_tank`
> team branch, `setTeamPropStatusByWeekGame`, and `normalizeMarket`'s `Team N`
> labeling (settled team bets still render). The section below is the
> historical contract.

**Team props** (team total pins / clean frames / strikes / spares — per game
AND per night since the 2026-07-01 standardization;
`market_type='team_prop'`, `params={stat, scope, team_id, team_number, clock}`)
rendered through the stack with zero new row components. Night team markets have
`game_number` and `subject_game_id` **null** (the first team_props with no game
anchor — pruned by week-team membership instead of the games cascade). Board
specifics:

- **Fetch:** `betMarkets.listActiveTeamPropByWeek` merged into `openLines` alongside O/U + moneyline + props.
- **Subject = a team.** `subject_game_id` anchors the matchup (like moneyline) and `params.team_id` picks the side; `subject_player_id` is null, so `normalizeMarket` labels the row `Team N` from `params.team_number` — relabeled **"Your Team"** in the hook's board-build loop when `params.team_id` is the viewer's week team. Every team's lines are shown (not just the viewer's — unlike the moneyline reduction).
- **Grouping — team rows live inside the game listing, no separate section.** `lineCategory` maps `moneyline` and per-game `team_prop` into `player_ou`, and `toYourTeamMoneyline` stamps `teamId` on the reshaped WIN row, so a team's moneyline + four stat markets consolidate into ONE row (`rowKey = line.teamId`): **"Your Team" — `WIN · 612.5+ TOTAL PINS · 9.5+ CLEAN FRAMES · …`** (moneyline first via `kindOrder`, then total_pins → clean_frames → strikes → spares; labels via the shared `STAT_LABELS`/`selectionButtonLabel`). Opponent team rows have no WIN button (own-team-only moneyline policy). The screen's team-block sort puts **each team's row above that team's player rows** (viewer's team block first). Row tint: green for the viewer's team, red for the game's opponent (keyed off `teamId` directly, not `subjectRelation`). **Night team props** (`gameNumber == null`) map to `night_props` instead (and `marketGroup` sends null-game team_props to `WEEKLY`, not `SEASON`), so each team gets ONE consolidated night row in the WEEKLY group above the night player rows; the red "against" tint keys off the team opposing the viewer in ANY of the night's games.
- **Anti-tank + under-hide:** `selectionBetsAgainstSubject('team_prop','under') → true`; `isSelectionHiddenInUI` hides the team under like the player unders (same social policy). `isSelfTank` blocks the viewer backing their **own team's** under (`teamId === weekTeams.myTeamId`); the DB `prevent_self_tank` team branch is the authoritative backstop (any non-fill roster membership on `params.team_id`).
- **Placed-bet surfaces** reuse `betLineSuffix` (`OVER 612.5 TOTAL PINS`) — `team_prop` is in its market-type gate alongside `prop`.
- **Open/close:** team props ride the game toggles (`setTeamPropStatusByWeekGame`, called alongside the O/U/moneyline/prop toggles); closing game 1 also closes the night team markets; `reopenOUForWeek` reopens team props too.
- **Two settlement clocks** (DB concern, invisible to the board): `total_pins` settles at archive (night total_pins = Σ the team's scores across the whole night); the frame stats settle on the LaneTalk clock via `settle_lanetalk_props_for_week` (game + night scope). See [archive-and-settlement.md](archive-and-settlement.md) §3 and [lanetalk-stat-bets.md](lanetalk-stat-bets.md).

### Combo lines (the fifth consumer — the team-prop replacement)

**Combos** (player-composed aggregate over/unders on an explicit member set;
`market_type='combo'`, `params={stat, scope, clock, member_ids, member_names,
combo_key}`) render through the stack with zero new row components — full
feature doc: [combo-lines.md](combo-lines.md). Board specifics:

- **Fetch:** `betMarkets.listActiveComboByWeek` merged into `openLines` alongside O/U + props.
- **Subject = a member set.** `subject_player_id`/`subject_game_id`/`teamId` all null; `normalizeMarket` labels the row by joining `params.member_names` (`Alice + Bob + Carl`) and stamps `LineView.comboMemberIds`/`comboMemberNames`. `rowKey` falls through to `marketId` — one row per combo, plain tint (`subjectRelation` null).
- **Scoping + the player filter:** `marketGroup` routes game-scope combos to their game and null-game combos to `weekly`. On the flat board a combo shows under **every member's** entry (`comboMemberIds.includes(selectedPlayerId)`), rendered as its own row after the player's consolidated row; combo membership also makes a player appear in the picker even if they have no individual lines in scope.
- **Combine mode → the bet slip:** combos are built **on the board** (the ⚰️ `ComboComposerSheet` + "+ Build a Combo" CTA retired 2026-07-21 — see the combine-mode section above). The BuilderBar's Add stages a `SlipCombo` **spec** into the standard slip, where it coexists with regular picks and other combo specs (Singles/Parlay, odds 2^units). At placement `BetSlipProvider.placeSlip` routes combo-bearing entries through `bets.composeCombo` → `compose_combo_bet` (specs array + the regular picks' selection ids as extras) — the market is created atomically WITH the bet, so compose = bet still holds and one ticket can parlay a combo with singles and with other combos.
- **Anti-tank + under-hide:** `selectionBetsAgainstSubject('combo','under') → true`; `isSelectionHiddenInUI` hides the combo under; `isSelfTank` blocks the under on any combo whose `comboMemberIds` contains the viewer (over-on-self allowed); the `prevent_self_tank` combo branch is authoritative.
- **Placed-bet surfaces** reuse `betLineSuffix` (`OVER 12.5 STRIKES`) — `combo` is in its gate alongside `prop`/`team_prop`; copy-bet via BetDetail works unchanged (`getByIds` is market-type-agnostic).
- **Open/close:** combos ride the game toggles (`setComboStatusByWeekGame`; night combos ride game 1); `reopenOUForWeek` reopens them.
- **Lifecycle (DB concern):** RSVP-out of any member **erases** the market (delete-refund, final); both settlement clocks with a per-member complete-data guard. See [combo-lines.md](combo-lines.md).

### Recipe — adding a new market type to the board

The board needs **no new render code**:

1. **Schema / RPCs** — add the market type per [supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md) §7 (`market_type`, selections, placement/settlement).
2. **Fetch** — add a `db.ts` query (or extend one) returning the new markets with the `MARKET_GRAPH` embed, and surface them in `usePinsinoData` so they land in `openLines`. The *placed-bet* queries (`bets.listByWeek`, `listByPlayer`, `listSettledBySeason`) are deliberately market-type-agnostic — never add a `market_type` filter to them (an inner-join type filter both drops bets with no qualifying leg and prunes legs from mixed parlays' embeds). *Today only `betMarkets.listActiveOUByWeek` feeds the board — season-long markets need a season-scoped fetch, and the empty-state copy is still week-shaped (revisit when that fetch lands).*
3. **`normalizeMarket`** — already generic; just confirm your selections carry `key` / `label` / `line` / `odds` / `sort_order`.
4. **Helpers** — make sure `marketGroup` routes the type to the right scope (`weekly` for null-game night markets, `game-N` per game) and, if a side bets against the subject, add a `case` to `selectionBetsAgainstSubject`.
5. Done — the board's scope filter picks it up via `lineGroup`, and it appears under every subject/member the availability rules resolve (`subjectPlayerId`, combo membership, or special involvement — a type with none of these needs a new availability rule in the screen's `board` memo).

### Custom lines ("Specials") — admin-authored bundles of existing selections

**Specials are not markets.** A row in `custom_lines` (one table; see the `…custom_lines` migration header for the DDL) is an admin-authored *presentation template* — title, description, `category` (`'default' | 'special'` → standard vs gold styling) — over existing `bet_selections`. Taking one calls the **unchanged** `bets.place(selectionIds, stake)`; the resulting row is an **ordinary single/parlay** that settles, refunds, archives, and unarchives on the existing rails. There is no specials settlement code anywhere.

- **Legs are abstract specs, resolved weekly.** `custom_lines.legs` is jsonb: `[{ kind: 'over_under'|'moneyline'|'prop'|'team_prop', player_id, stat?, scope?, game_number, pick: 'over'|'under'|'win' }]`. Specs (not selection FKs) because markets/teams regenerate weekly. All four market types are expressible — the builder groups them as two **families** (who the leg is about) with the line kind as a stat chip: **Player Stat** (`Score` → `over_under`, plus `strikes|spares|clean_frames` → `prop`; `first_ball_avg` is retired and not offered) and **Team Stat** (`Win` → `moneyline`, plus `total_pins|clean_frames|strikes|spares` → `team_prop`). `stat` carries the stat key for prop/team_prop legs only — `score`/`win` are the kind itself, not a stored stat. **Team legs (`moneyline`, `team_prop`) are always player-anchored** — *"the team containing `player_id`"* — because team ids don't persist across weeks.
- **Scope** (`scope: 'game'|'night'`, absent = legacy = `'game'`): a `night` leg resolves once against the subject's null-game night market (night O/U / night stat prop / night team prop) and ignores `game_number`; night is reachable only via an explicit `scope: 'night'`, so legacy rows keep their exact semantics. Team Win is game-scope only.
- **Over-only creation.** The builder emits only `'over'` / `'win'` picks — the board's no-unders social policy applied to specials. Stored legacy `'under'` legs still resolve, display, and anti-tank-block their own subject; they just can't be authored anymore.
- **Self-referential legs** (`player_id: null`) make the **taker** the subject — "you beat your over", "your team wins the game", "your team beats its line". The line then resolves **per-viewer** (subject = the viewer), so each player sees their own framing (`You` / `Your Team` on the row) and the line hides for viewers it can't resolve for (not RSVP'd / not slotted / no LaneTalk markets). Fixed and self legs mix freely on one line.
- **Each-game legs** (`game_number: null` at **game** scope) make the line **materialize once per game** on the week's schedule — each instance binds its null-game legs to that game ("the bettor bowls their over *in this game*" → one offering in each game's group). Night legs also carry `game_number: null` but resolve once — `resolveInstances` keys per-game materialization off `game_number == null && (scope ?? 'game') === 'game'`. Instances get synthetic ids (`<rowId>:g<N>`) and flow through the normal per-game board placement; an instance whose game can't resolve (subject not in that game's lineup) is hidden individually.
- **Game picker = `G1 / G2 / BOTH / EACH`**, shown only at game scope (two official games per night; resolution follows the actual schedule, so an extra game still resolves — the builder just doesn't offer it). `BOTH` is builder sugar for the **week-level cross-game bundle**: it stages one leg per official game in ONE bet ("you beat your over in both games") — the legs land on different markets, the line's derived `gameNumber` goes null, and it renders in the top-of-board card. `EACH` stores `game_number: null` (the per-game offering above). Collisions are checked on the tuple (kind, subject, stat, scope): an EACH leg blocks any fixed-game leg of the same tuple (the instance would double up on one market); a game leg and a night leg of the same tuple never collide (different markets).
- **Lifecycle.** `week_ids uuid[]`: `NULL` = permanent (offered every week while `is_active`); otherwise only in the listed weeks. `is_active = false` pulls it from the board without deleting. Admin CRUD is **direct table writes through RLS** (read-all, admin-write — the `bet_markets` policy set); no money moves at create/edit/delete time.
- **Client-side resolution** (`resolveCustomLine` in [usePinsinoData.ts](../app/src/hooks/usePinsinoData.ts)): each spec is looked up against the **raw** normalized markets — *before* `toYourTeamMoneyline` and the under-hide policy, since a special may bundle selections the viewer's own board hides (specials are **exempt from the hide-the-under policy**: they're admin-curated). Team anchors (moneyline + team_prop) resolve via `teamSlots.listByWeek` (player → week team → moneyline selection `key = team_id` / team_prop market `params.team_id`); stat legs additionally match on `params.stat` + scope. The line is **hidden** for the week when any leg is unresolvable (subject not bowling, no such game) **or two legs land on the same market** (a degenerate parlay `place_house_bet` would reject). A resolved line with any `closed` leg market renders **inert** (`inProgress`), like every other row.
- **Shapes.** `CustomLegView` (resolved leg: selection/market ids, `subjectName` — `"<anchor>'s Team"` for team legs — `pick`, `selectionKey`, `line`, `statKey`, `gameNumber`, `odds`, `inProgress`; `customLegLabel(leg)` is the shared display string — "Alice · OVER 4.5 STRIKES · G1", "Your Team · OVER 612.5 TOTAL PINS · NIGHT" — used by `CustomLineRow` and the slip summary) and `CustomLineView` (`legs`, `selectionIds`, `combinedOdds` = Π leg odds, derived `gameNumber`, `inProgress`). `customLineSelfTank(line, playerId)` mirrors anti-tank for bundles containing an `under` on the viewer's own market (server re-checks regardless).
- **Board placement is derived — specials lead.** A special's scope is its derived `gameNumber` (all legs in one game → that game's scope; mixed/cross-game or night → `null` → the Weekly scope), and it shows under the entry of **every player a resolved leg is about** (`leg.subjectPlayerId`; self-referential legs resolve to the viewer, so self specials appear only under the viewer's own entry). Matching specials render at the **top of the filtered board**, above the player's rows, with **no extra header** (the rows' styling is the distinguishing mark). Rendered by **`CustomLineRow`** (`{ line, isLast, inProgress?, disabled?, onTake? }`): title/description/leg summary left, one oversized `×odds` multiplier button right (the multiplier *is* the button — no "TAKE" label); `category === 'special'` golds the title + button, `default` uses the standard accent.
- **Take flow.** Tapping the multiplier opens a dedicated wager sheet (leg list, `PAYS ×odds`, to-win preview) → `bets.place(line.selectionIds, wager)`. Specials **never enter the parlay slip** (they already are a bundle), so the button behaves identically in Single and Parlay modes.
- **Bet branding is DB-snapshotted at placement.** `place_house_bet(…, p_custom_line_id)` stamps `bets.custom_line_id` + a **title/description/category snapshot** onto the bet, so the branding is durable — it survives line edits/deletion and renders in historical surfaces (ledger activity, past-week lists, admin views) where live-market matching can't reach. `normalizeBet` reads the columns into `BetView.customLineTitle/Description/Category`; `BetRow`/`LedgerRow` headline the title (gold for `special`) and `BetDetailModal` shows title + description in a `SPECIAL` row. **Legacy fallback:** bets placed before tagging existed are still client-matched by selection-set equality against the current week's resolved specials (incl. per-bettor re-resolution of self-referential lines) — the DB snapshot always wins when present.
- **Admin manager.** `AdminSportsbookScreen` → the `Specials` toggle: list (incl. disabled) → `CustomLineCreateModal` (create/edit: title, description, style, scope This Week / Pick Weeks / Every Week, leg builder) and `CustomLineAdminActionModal` (edit / enable–disable / delete). Edits replace `legs` wholesale and **never affect placed bets** (they hold concrete selection ids).
