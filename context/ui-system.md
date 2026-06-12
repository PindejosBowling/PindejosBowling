# UI System — Badges, State, Navigation & Components

## Player Badges

**File:** [src/utils/badges.ts](../app/src/utils/badges.ts) + [src/components/ui/PlayerBadges.tsx](../app/src/components/ui/PlayerBadges.tsx)

Status emojis shown next to a player's name (e.g. 👑 next to the reigning champion in Standings). The system is a declarative **rule list**, not scattered inline conditions.

- `badges.ts` holds the single `BADGE_RULES` array — the **source of truth** for every status → emoji mapping. Each rule is `{ key, emoji, label, applies(playerId, ctx) }`, where `applies` is a pure predicate over a `BadgeContext` (data the screen already loads — currently `lastSeasonChampionIds` + `standings`). `badgesForPlayer(playerId, ctx)` returns all matching `Badge`s.
- Array order = display/priority order; a player can match multiple rules and show multiple emojis.
- `PlayerBadges` is a thin presentational component that just joins the emojis.

**To add a new emoji rule:** append one entry to `BADGE_RULES` in `badges.ts`. If the predicate needs data not yet in `BadgeContext`, add the field to the `BadgeContext` type, populate it where the context is built (e.g. the `badgesByPlayer` `useMemo` in StandingsScreen), and have the hook expose any new raw data. No screen render changes are needed — screens read badges via the `badgesByPlayer` map.

> The champion badge is intentionally scoped to the **reigning** champion only — `useStandingsData` builds `championPlayerIds` from `seasons.getLastEnded()` → `seasonChampions.listBySeason()`, not all-time `seasonChampions.list()`.

---

## State Management

Four Zustand stores — all imported as `useXxxStore` hooks:

### `usePendingStore` ([src/stores/pendingStore.ts](../app/src/stores/pendingStore.ts))
Optimistic edit buffer — not persisted. Holds staged changes before save.
- `pendingRSVP: Record<playerName, 'In'|'Out'>` — staged RSVP changes
- `pendingScores: Record<'teamSlotId|gameNum', scoreString>` — staged score edits
- `genTeams` / `genNumTeams` / `genTeamSize` / `genAvgSource` / `genFillMode` / `genFillToSize` / `genSwapTarget` — state for the Generate Teams admin flow

Pending score key format: `"${teamSlotId}|${gameNum}"` where `gameNum` is the integer game number (1, 2, 3)

### `useUiStore` ([src/stores/uiStore.ts](../app/src/stores/uiStore.ts))
Ephemeral UI state — toggles, selections, toast queue. All fields via `set(partial)`. Key fields:
- `matchupsView` — `'scores'` | `'expected'`
- `expandedWeek` — week id for expanded row in past seasons
- `standingsSeason` — season filter for StandingsScreen
- `playerSeason` — season filter for PlayerDetailScreen
- `recordsSeason` — season filter for LeagueRecordsScreen (`'all'` or season id string)
- `pastGamesSeason` — season filter for PastGamesScreen
- `playerLogMode` — `'bowled'` | other — controls game log display in PlayerDetailScreen
- `chemMode` — `'pairs'` | `'trios'`
- `chemExpanded` — boolean, whether chemistry rows are expanded
- `h2hP1`, `h2hP2` — selected player names for head-to-head
- `oddsRevealed` — easter egg toggle on matchup screen
- `toasts` — call `showToast(msg, type)` to show an auto-dismissing toast; display time scales with message length (2.4s–10s) so long DB errors stay readable

### `useAvatarStore` ([src/stores/avatarStore.ts](../app/src/stores/avatarStore.ts))
Central signed-URL cache for player profile pictures. `load()` fetches `players.list()`, batch-signs every non-null `avatar_path` via `avatars.signedUrls()`, and builds `byId` (playerId → url) and `byName` (lowercased name → url) maps. Called once on sign-in (in [App.tsx](../app/App.tsx), gated on `role` since signed-URL reads need auth) and re-run after admin upload/delete. The `<PlayerAvatar>` component reads it; list screens that only have a player name still resolve a photo via `byName`.

---

## Navigation Architecture

**Root:** Bottom tabs (`@react-navigation/bottom-tabs`)

| Tab label | Navigator / Screen | Route name |
|---|---|---|
| Standings | StandingsStackNavigator | `Standings` |
| RSVP | RsvpScreen | `RSVP` |
| This Week | MatchupsScreen | `Matchups` |
| Pinsino | PinsinoStackNavigator | `Pinsino` |
| More | MoreStackNavigator | `More` |

> The **Pinsino** tab (route `Pinsino`, label "Pinsino", 🏦 icon) is a native stack navigator (after This Week). Its `PinsinoHome` screen renders `AppHeader` (no back button) like the other tabs.

**Pinsino tab** is a native stack navigator:

| Route | Screen |
|---|---|
| `PinsinoHome` | PinsinoScreen — hub: balance card + top-3 leaderboard preview + tile menu |
| `PinsinoLeaderboard` | PinsinoLeaderboardScreen — full pin-balance leaderboard ("Titans of Pindustry"); uses `PinsinoLeaderboardTable` (no limit) |
| `Sportsbook` | SportsbookScreen — Place Bets / Active Bets / Settled Bets toggle; bet placement, parlay slip, `BetDetailModal` (public; read-only Active/Settled) |
| `PlayerPinsino` | PlayerPinsinoScreen — one player's betting record; receives `{ playerId, name }` (opened by tapping a leaderboard row) |
| `LoanShark` | LoanSharkScreen — borrower hub: active loan panel (debt, repayment form, payment history) or available products list (when no active loan) |

**Standings tab** is a native stack navigator:

| Route | Screen |
|---|---|
| `StandingsList` | StandingsScreen |
| `PlayerDetail` | PlayerDetailScreen — receives `{ name: string }` param |

**More tab** is a native stack navigator:

| Route | Screen |
|---|---|
| `MoreHome` | MoreHomeScreen — tile grid entry point |
| `LeagueRecords` | LeagueRecordsScreen |
| `HeadToHead` | HeadToHeadScreen |
| `Chemistry` | ChemistryScreen |
| `PastSeasons` | PastSeasonsScreen — season-by-season summary |
| `TrashBoard` | TrashBoardScreen |
| `Playoffs` | PlayoffsScreen |
| `PlayerManagement` | PlayerManagementScreen — add, edit, and toggle active/inactive players |
| `ProfilePictures` | ProfilePicturesScreen — admin uploads/deletes player profile photos on behalf of any player (admin only) |
| `PastGames` | PastGamesScreen — browse historical week rosters and scores by season |
| `Registration` | RegistrationScreen — per-season sign-ups; admins open/close registration, manage the roster, and delete an open season |
| `PinsinoAdmin` | PinsinoAdminScreen — **admin-only** hub: tile menu with Accounting, Market Moves, Sportsbook, PvP, Bounties, Loan Shark, and Auction House subpages |
| `AuctionHouseAdmin` | AuctionHouseAdminScreen — **admin-only** Auction House administration: auction create/manage, item-catalog curation, item grants (player screens carry no admin controls) |
| `PinsinoAccounting` | PinsinoAccountingScreen — **admin-only** house ledger: House Balance collapsible statement card + Activity / Weekly P&L toggle |
| `AdminSportsbook` | AdminSportsbookScreen — **admin-only** Active Bets / Settled Bets toggle; admin settle (`SettleBetModal`) and cancel (`cancel_bet`) actions |
| `LoanSharkAdmin` | LoanSharkAdminScreen — **admin-only** list of active loans (player, product, outstanding); cancel (✕) → confirm → `loans.cancel` + reload |

**PinsinoHome** (hub) — PinsinoScreen renders a **balance card** (tap → your own `PlayerPinsino`) + optional **debt / net-worth lines** under the balance when the player has an active loan ("OWED −{debt}" in danger + "NET {netWorth}") + a **"TITANS OF PINDUSTRY" header row** (tap "VIEW ALL ›" → `PinsinoLeaderboard`) + a top-3 preview via `<PinsinoLeaderboardTable limit={3} />` + a **tile menu** (two tiles: **Sportsbook** 🏟️ → `Sportsbook`, **Loan Shark** 🦈 → `LoanShark`). Add future tiles to `MENU_TILES` in that screen.

**PinsinoLeaderboardScreen** — full leaderboard via `<PinsinoLeaderboardTable />` (no limit). Pin-balance scoreboard of active players, season balances summed from the ledger, Standings-style, with an "Upside" column = projected balance if all that player's still-pending bets win, sorted descending. Tap a row → `PlayerPinsino`.

**SportsbookScreen** (`Pinsino` stack) — public betting: **Place Bets** (open markets as collapsible board — see [Betting Line Board](betting-line-board.md)), **Active Bets** (read-only `ActiveBetsView`), **Settled Bets** (read-only `SettledBetsView`) toggled via `ToggleGroup`. Single and parlay placement, sticky parlay slip, `BetDetailModal`. `<Toast />` inside each `<Modal>`.

**PinsinoAdminScreen** (hub) — pure tile menu: **Accounting** 📒 → `PinsinoAccounting`, **Market Moves** 👀 → `MarketMovesAdmin`, **Sportsbook** 🏟️ → `AdminSportsbook`, **PvP** ⚔️ → `PvPAdmin`, **Bounties** 🎯 → `BountyAdmin`, **Loan Shark** 🦈 → `LoanSharkAdmin`, **Auction House** 🔨 → `AuctionHouseAdmin`. No content of its own beyond the admin gate.

**PinsinoAccountingScreen** (`More` stack, admin-only) — house financials: collapsible **House Balance** statement card (stats: W-L-P record, hold%, exposure, biggest payout/take; ledger flows: stakes taken, payouts, refunds, bonuses; `signed()` helper for ± display) + season subtitle (`SEASON N · THE HOUSE`) + **Activity / Weekly P&L** toggle. Activity groups house ledger rows by week via `LedgerRow`; P&L lists per-week house net. Uses `useHousePinsinoData()`.

**AdminSportsbookScreen** (`More` stack, admin-only) — admin bet management: **Active Bets / Settled Bets** toggle. Active: tap a bet → `SettleBetModal` to settle its line(s); ✕ → confirm-cancel via `bets.cancel`. Settled: tap → `BetDetailModal`; ✕ → confirm-cancel. Uses `useHousePinsinoData()`.

**PlayerPinsinoScreen** (`Pinsino` stack) and **PinsinoAccountingScreen** (`More` stack) are the two opposite sides of one player↔house ledger. Each has an **Activity** view built from `LedgerRow` (player `perspective` vs. house `perspective`); PlayerPinsino adds Open / Settled Bets tabs (`BetRow`), PinsinoAccounting adds Weekly P&L. **Admin settle/cancel lives on AdminSportsbookScreen** (tap an active single bet → `SettleBetModal`; ✕ on any bet → cancel via `cancel_bet`).

**Cross-tab navigation to PlayerDetail** (e.g. from More tab):
```tsx
(navigation as any).navigate('Standings', { screen: 'PlayerDetail', params: { name } })
```

---

## Component Inventory

> The complete per-component index (props, mount patterns, shared conventions, all 49 components grouped by domain) lives in [COMPONENTS_INDEX.md](COMPONENTS_INDEX.md). The tables below keep the narrative detail for the core + betting components.

| Component | Purpose |
|---|---|
| `AppHeader` | App logo + current Week/Season badge, reads from Supabase (`weeks.getCurrent`, `seasons.getCurrent`). Top-right avatar is a `<PlayerAvatar>` opening `ProfileMenuModal` |
| `PlayerAvatar` | Player profile picture (`{ name?, playerId?, size }`) — resolves a signed URL from `useAvatarStore` (by id, else by name) and renders `<Image>`, falling back to an `initials()` circle. Used in AppHeader, PlayerDetailScreen, ProfilePicturesScreen |
| `PlayerBadges` | Renders a player's status emojis inline (`{ badges, style? }`) — takes a `Badge[]` from `badgesForPlayer()` and joins their emojis after the name. Renders nothing when empty. Used in StandingsScreen. See **Player Badges** |
| `ScreenHeader` | Reusable titled header for inner screens |
| `Toast` | Absolute-positioned animated toast, reads from `uiStore.toasts`. **Render a `<Toast />` inside any RN `<Modal>` that calls `showToast`** — the app-root `<Toast />` (App.tsx) sits behind the native modal layer and is occluded while a modal is open (see [Key Patterns](patterns.md)) |
| `ConfirmBar` | Sticky bottom bar for pending saves (RSVP, scores) |
| `PlayerScoreRow` | One player row in the live matchup view — editable score input or expected avg display |
| `OddsBlock` | Betting-style spread + moneyline card (easter egg, `Expected` mode only) |
| `LoadingView` | Centered spinner with label |
| `PillFilter` | Horizontal pill-style filter row for season/week selectors |
| `ToggleGroup` | Segmented toggle control for multi-option switches |
| `HistoricalTeamBlock` | Team block for displaying archived week rosters |
| `ProfileMenuModal` | Bottom sheet opened from the avatar in `AppHeader` — shows player identity and per-user actions (My Profile, Log Out) |
| `PlayerPickerModal` | Full-screen player search/select for H2H |
| `AdminArchiveModal` | Confirm dialog — archives active week (`is_archived = true`, creates next week row), then calls the `settle_betting_for_week` RPC: credits game scores to the ledger and auto-settles all open O/U markets (double-entry) |
| `AdminEndSeasonModal` | Confirm dialog — calls `seasons.settleLoansForClose` first (aborts on error), then records season champions and marks the current season ended (`is_active = false`); reads the current season via `seasons.getCurrent()` |
| `AdminOpenRegistrationModal` | Create the next season (`seasons.insert` with `registration_open = true`) and open its registration window; next number derived from `seasons.getLatest()`; credits +100 pin champion bonus to prior-season champions |
| `AdminGenerateTeamsModal` | Generate balanced teams from RSVP list, preview swaps, write teams/slots/schedule to Supabase. **Not the source of base O/U markets** (those come from RSVP) — after gen it calls `sync_over_under_markets_for_week(weekId, scheduleGames)`, which adds markets for any schedule game number not yet present (game 3 when `numTeams ∈ {3,5}`), idempotently |
| `PinsinoLeaderboardTable` | Shared pin-balance leaderboard table (`{ leaderboard, playerId, limit?, onRowPress }`). Renders rank badge, name with movement arrows ▲▼, balance, **Debt** (shown as `−N` in danger color, blank when 0), **Net** (net worth; danger color when negative), and Upside columns. Sorted by net worth. `limit` caps the rows shown (e.g. `3` for the PinsinoScreen preview; omit for full list). Used by PinsinoScreen (top-3 preview) and PinsinoLeaderboardScreen (full list) |

### Betting display components

These render the betting/pin-economy UI and are reused across SportsbookScreen (public), AdminSportsbookScreen (admin), and the two ledger screens. They all consume the flat `BetView` (from `usePinsinoData.ts`) so a bet looks identical everywhere it appears. **`ActiveBetsView` and `SettledBetsView` are the shared "list of bets" surfaces** — both SportsbookScreen (read-only) and AdminSportsbookScreen (admin-actionable) render the same component; the *only* difference is which callbacks they pass.

| Component | Purpose |
|---|---|
| `ActiveBetsView` | Shared **Active Bets** surface (`{ bets, hint?, onBetPress?, onParlayPress?, onCancelBet? }`). Renders a wager summary (BETS / PINS WAGERED / BETTORS) + this week's pending bets grouped by game (parlays bucketed on their own), each via `BetRow`. Self-contained grouping. Callbacks are optional: SportsbookScreen passes `onBetPress`/`onParlayPress` = open `BetDetailModal` (read-only); AdminSportsbookScreen passes `onBetPress` = open `SettleBetModal`, `onParlayPress` = details, `onCancelBet` = confirm-cancel, plus a `hint` |
| `SettledBetsView` | Shared **Settled Bets** surface (`{ bets, onBetPress?, onCancelBet? }`). This season's settled bets grouped by week (newest first), each via `BetRow`. SportsbookScreen passes `onBetPress` = details; AdminSportsbookScreen adds `onCancelBet` = confirm-cancel |
| `SettleBetModal` | Admin single-market settlement overlay (`{ bet, onClose, onSettled }`). Self-contained: takes an actual-score input, calls `settle_market` via `betMarkets.settle(bet.marketId, score)`, toasts, and calls `onSettled` (reload). **Mount conditionally** (`{settleBet && <SettleBetModal …/>}`) so the input resets between opens. Used only by AdminSportsbookScreen |
| `BetRow` | One bet row in a betting list (`{ bet, isLast, badge, betReturnText, onPress?, onCancelPress? }`). Renders a single bet or parlay — `subject · PICK line · G#`, or one line per leg — with its status badge (or `PENDING`) and signed return. **Presentational**: the row is tappable when given an `onPress` and shows an inline cancel (✕) when given an `onCancelPress` — callers gate those (read-only surfaces omit them; admin surfaces pass them). Used by `ActiveBetsView` / `SettledBetsView` and in PinsinoScreen (My Bets) / PlayerPinsinoScreen (Open / Settled Bets) |
| `LedgerRow` | One `pin_ledger` activity row (`{ entry, perspective, isLast }`) — the **single shared renderer for both ledger surfaces**. Shows the bet specifics when the entry carries an associated `bet` (`subject · PICK line · G#`, or per-leg for parlays), else the raw `description`; plus an **action label** derived from `(type, perspective)` (`BET PLACED`/`BET TAKEN`, `WINNING PAYOUT`, `PUSH · REFUND`, `GAME SCORE`, `BONUS`; and for loan types: `LOAN ADVANCE`/`LOAN ISSUED`, `REPAYMENT`/`REPAYMENT RECEIVED`, `GARNISHED`/`GARNISHMENT`, `SEASON-CLOSE PAYMENT`/`SEASON-CLOSE COLLECTION`), the bettor name on the house side, the date, and the signed amount (gold for bonuses). `perspective` = `'player'` \| `'house'`. **Bet-backed rows are tappable** and open the shared `BetDetailModal`; mint and loan rows render as static `View`s. Used in PlayerPinsinoScreen (Activity) + PinsinoAccountingScreen (Activity) |
| `BetDetailModal` | Shared **"Bet Details" overlay** (`{ bet: BetView \| null, onClose }`; renders `null` when `bet` is null). The canonical single-bet breakdown: bettor / season / week, a **consolidated leg view for 1+ legs** (a single bet is just one leg — labeled `SELECTION`, parlays `LEGS (N)`), then wager / status / return. Each leg shows `subject · PICK line · G#` and, once settled, a ` -- ` divider followed by the leg's actual score **color-coded to its win/loss/push outcome** (status word is not repeated — the bet `status` row reports it once). When `BetView.customLineTitle` is set (client-matched special), a `SPECIAL` row with the title (gold for `special` category) precedes the legs. Also **exports the `resultBadge(status)` and `betReturnText(bet)` helpers** (status→badge color/label; signed return text) reused by BetRow callers. Opened from `BetRow` taps (SportsbookScreen + AdminSportsbookScreen Active/Settled) and `LedgerRow` taps (both ledger Activity tabs) |
| `CustomLineRow` | One admin custom line ("special") on the Place Bets board (`{ line: CustomLineView, isLast, inProgress?, disabled?, onTake? }`). Title + description + per-leg summary left, a single oversized `×odds` multiplier button right (no "TAKE" label — the multiplier is the button); `category === 'special'` → gold title/button, `default` → standard accent; no chip, color is the distinguishing mark. Mirrors `LineRow`'s callback-gating (`disabled` dims but stays pressable for toasts). See **Betting Line Board → Custom lines** |
| `CustomLineCreateModal` | Admin create/edit sheet for custom lines on `BottomSheet` (`{ currentWeekId, seasonId, initial?, onClose, onDone }`). Title/description/style, scope (This Week / Pick Weeks / Every Week), and a leg builder (Player O/U or Team Win, subject = a specific player or **Whoever Takes It** — a self-referential leg resolved per-taker, over-only for O/U; game chips `G1/G2/BOTH/EACH` — **BOTH** stages one leg per official game in one cross-game bet, **EACH** materializes the special once per game that week; over/under pick). Direct `customLines` table writes through admin RLS. **Mount conditionally**; pass `initial` (raw row) for Edit |
| `CustomLineAdminActionModal` | Admin per-line action sheet on `BottomSheet` + `useAdminAction` (`{ line, onClose, onDone, onEdit }`): Edit / Enable–Disable / Delete (destructive confirm — placed bets keep their selections and settle normally). **Mount conditionally.** Used only by AdminSportsbookScreen's Specials view |

> **Ledger Activity is bet-aware.** `pinLedger.listByPlayerSeason` / `listHouseBySeason` embed the bet graph (`bets(*, players(name), <LEG_GRAPH>)`) off `pin_ledger.bet_id`; the hooks (`usePlayerPinsinoData`, `useHousePinsinoData`) normalize it onto each `LedgerEntry.bet` via `normalizeBet`, so a `bet_*` ledger row can render the same bet detail (and open the same overlay) as the Bets tabs. `score_credit` / `bonus` rows have no `bet_id` → `bet` is `null`.
