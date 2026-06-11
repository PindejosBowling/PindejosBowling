# Components Index

Every reusable component in [app/src/components/](../app/src/components/), grouped by domain. The directory is organized into domain subfolders — `ui/`, `charts/`, `league/`, `admin/`, `betting/`, `pvp/`, `bounty/`, `economy/` — matching the section groupings below (each heading names its folder). Check here **before building anything new for a screen** — most list rows, modals, pickers, and chart pieces already exist. One component per file, default export, named after the file.

## Shared conventions

- **Theme tokens only.** Every component styles via `colors` / `fonts` / `radius` from `src/theme` — never hard-coded values.
- **Two modal-mounting patterns.** Older modals take a `visible` prop and stay mounted; newer ones (everything in the betting / loan / PvP / bounty families) are **mounted conditionally** (`{thing && <Modal … />}`) so their internal state resets between opens. Each entry below notes which.
- **`<Toast />` inside every RN `<Modal>` that calls `showToast`** — the app-root Toast is occluded by the native modal layer (see [toast.md](toast.md)).
- **Presentational rows gate behavior by callback.** List rows (`BetRow`, `LineRow`, …) become tappable/cancellable only when the caller passes `onPress` / `onCancelPress`-style callbacks; read-only surfaces simply omit them. Reuse this pattern instead of `isAdmin` props.
- **Betting data shape.** The betting components all consume the flat `BetView` / `LineView` / `LedgerEntry` views produced by the hooks (`usePinsinoData`, `usePlayerPinsinoData`) — never raw DB rows.

## Core primitives (`components/ui/`)

| Component | Props | Purpose |
|---|---|---|
| `Button` | `{ label?, onPress, variant?, size?, tone?, loading?, disabled?, fullWidth?, selectable?, value?, placeholder?, style? }` | **The** button. Variants `primary \| secondary \| ghost \| danger \| gold \| outline`; sizes `md \| lg`; `loading` swaps the label for a spinner; `tone: 'danger'` recolors the outline variant. `selectable` mode renders a form-field-style select trigger (shows `value` or muted `placeholder` + chevron) — use it for "tap to open a picker" fields. Used on ~15 screens + every modal. |
| `Toast` | none (reads `uiStore.toasts`) | Absolute-positioned auto-dismissing toast. Mounted at app root **and** inside any `<Modal>` that toasts. Mount-baseline guard prevents duplicate toasts during nav transitions. See [toast.md](toast.md). |
| `LoadingView` | `{ label? }` | Centered full-screen spinner + uppercase label (default "Loading"). The standard `if (loading) return <LoadingView />` for every screen. |
| `ScreenHeader` | `{ title, subtitle?, onBack }` | Back-arrow + title (+ subtitle) header for every inner stack screen (used by 30+ screens). |
| `AppHeader` | none | *(lives in `components/league/`)* Tab-root header: 🎳 PINDEJOS logo + "Season N · Week N" subline (self-loads via `weeks`/`seasons`, re-fetches on `uiStore.weekVersion`) + top-right `PlayerAvatar` that opens `ProfileMenuModal`. Used on the five tab home screens. |
| `ConfirmBar` | `{ icon, title, subtext?, saving, onDiscard, onSave }` | Sticky bottom Save/Discard bar for staged edits (RSVP, scores, week editor). Shows a spinner while `saving`. |
| `BottomSheet` | `{ title, subtitle?, onClose, busy?, children, footer?, keyboardAvoiding?, bodyMaxHeight? }` | **The bottom-sheet scaffold** — transparent slide Modal → backdrop dismiss-touchable (blocked while `busy`) → sheet → title/subtitle → body (ScrollView when `bodyMaxHeight` set) → `footer`. Renders `<Toast />` inside the Modal unconditionally, so converted sheets can't forget the toast rule. Always-visible; callers keep the conditional-mount contract. Used by the betting/economy/pvp/bounty confirm + admin sheets. |
| `ConfirmActionSheet` | `{ title, subtitle?, children, confirmLabel, confirmVariant?, action, successMessage, failureMessage?, bodyMaxHeight?, onClose, onDone }` | **The confirm-flow semantic** for "terms sheet → one RPC" modals, built on `BottomSheet`: owns the saving flag, try/catch/finally, server-message error toast, success toast, and `onDone()` → `onClose()` ordering. `BorrowConfirmModal`, `BountyEntryModal`, and `PvpAcceptModal` are thin wrappers over it. |

## Selection controls & pickers (`components/ui/`)

| Component | Props | Purpose |
|---|---|---|
| `ToggleGroup` | `{ options: Option[], value: T \| null, onChange, empty?, variant?: 'segment'\|'pill', scrollable?, style? }` (generic over key; exports `Option<T>`) | **The single pill-button implementation.** `'segment'` (default) = the standard view switcher (Place/Active/Settled Bets, Activity/P&L, scores/expected…); `'pill'` = the radius-20 filter look. `null` value = nothing selected; `empty` text renders when `options` is empty. `GamePicker` and `PillFilter` are thin wrappers over it. |
| `PillFilter` | `{ items: string[], value, onChange, renderLabel?, style? }` | Horizontal scrolling pill row — the standard season/week/status filter (12 screens). Thin wrapper over `ToggleGroup` (`variant="pill"`, `scrollable`). |
| `Dropdown` | `{ options: {key,label,color?,tint?}[], value, onChange, disabled?, style? }` (generic) | Compact anchored dropdown: bordered trigger + floating menu in a transparent Modal positioned beneath it (kept on-screen). Options can carry a per-option accent color/tint. |
| `GamePicker` | `{ games: number[], value, onChange, emptyText? }` | Pill selector over the game numbers actually scheduled this week — use anywhere a game number is chosen (never a free-form input). Thin wrapper over `ToggleGroup` mapping `number ↔ string` keys. |
| `PlayerPickerModal` | `{ visible, onClose, title?, players?+onSelect \| items?+onSelectItem }` | Bottom-sheet player search/select. Two modes: name-only (`players: string[]`) or id-aware (`items: {id,name}[]`). Rows render `PlayerAvatar` (photo, initials fallback). `visible`-prop mounted. |
| `PlayerAvatar` | `{ name?, playerId?, size?, style? }` | Profile photo resolved from `useAvatarStore` (by id, else lowercased name), falling back to an initials circle. |
| `PlayerBadges` | `{ badges: Badge[], style? }` | Inline status emojis after a player's name; takes `badgesForPlayer()` output, renders nothing when empty. See [ui-system.md](ui-system.md) §Player Badges. |

## Charts (`components/charts/`, react-native-svg)

| Component | Props | Purpose |
|---|---|---|
| `StatDonut` | `{ value (0..1), valueText, label, color, size? }` | Donut/progress ring with big center text + caption (FrameStatsScreen). |
| `StatRadarChart` | `{ axes: RadarAxis[], size? }` — exports `RadarAxis { label, valueText, radial (0..1) }` | N-spoke radar/web chart; caller pre-normalizes each axis to 0..1 (FrameStatsScreen). |

## League / matchup display (`components/league/`)

| Component | Props | Purpose |
|---|---|---|
| `PlayerScoreRow` | `{ player, gameNum, mode: 'scores'\|'expected', leagueAvg, onCommit?, readOnly? }` | One player row in the live matchup: `PlayerAvatar` (photo/initials; fill rows keep the `∅` glyph), editable score input writing to `usePendingStore` (key `"${teamSlotId}\|${gameNum}"`), or expected-avg display. `onCommit` (admin) flushes on blur; `readOnly` renders static text. |
| `EditableWeek` | `{ editor: WeekEditor }` | Inline per-game roster/score editor for one week (swap/add/remove players via `PlayerPickerModal`). Purely presentational — all mutations go through the `useWeekEditor` editor object. Rendered in edit mode by MatchupsScreen + HistoryScreen. |
| `HistoricalTeamBlock` | `{ team, players: {name,score?,present,isFill?}[], total, winner }` | Archived-week team card: roster with `PlayerAvatar`s and scores, OUT tags, League-Avg-Fill rows (`∅` glyph), winner-highlighted total. |
| `OddsBlock` | `{ teamA, teamB, leagueAvg, label }` | Betting-style spread + moneyline card computed from expected team scores (`spreadAndML` helper). Easter egg on MatchupsScreen (`Expected` mode). |

## Admin season/week modals (`components/admin/`, `visible`-prop mounted)

All follow confirm → `db.ts` call(s) → toast → close, with `<Toast />` inside the Modal.

| Component | Props | Purpose |
|---|---|---|
| `AdminArchiveModal` | `{ visible, onClose }` | Archives the active week via the atomic `archive_week` RPC (snapshot → lock → settle → next week). If the no-pending-bets backstop rejects, shows the warning and arms a **force** retry (voids + refunds). See [archive-and-settlement.md](archive-and-settlement.md). |
| `AdminEndSeasonModal` | `{ visible, onClose }` | Ends the current season: settles active loans first (`seasons.settleLoansForClose`, aborts on error), records selected champions, sets `is_active = false`. |
| `AdminOpenRegistrationModal` | `{ visible, onClose, onCreated? }` | Creates season N+1 with `registration_open = true` (number from `seasons.getLatest()`), date pickers for start/end, +100 pin champion bonus to prior champs. |
| `AdminEditSeasonModal` | `{ season: SeasonOption \| null, onClose, onSaved? }` | Edits a season's bowling night + start/end dates (local-date-safe ISO handling). Conditionally mounted via the `season` prop. |
| `AdminGenerateTeamsModal` | `{ visible, onClose }` | Generates balanced teams from RSVPs (state in `usePendingStore.gen*`), writes teams/slots/schedule, then idempotently syncs O/U markets via `sync_over_under_markets_for_week`. |
| `ProfileMenuModal` | `{ visible, onClose }` | *(lives in `components/league/`)* Bottom sheet from the AppHeader avatar: identity (`PlayerAvatar`, 64px) + My Profile (cross-tab nav to PlayerDetail) + Log Out. |

## Betting / Sportsbook & ledger (`components/betting/`)

See [betting-line-board.md](betting-line-board.md) for the line-board stack and [ui-system.md](ui-system.md) §Betting display components for the deeper narrative.

| Component | Props | Purpose |
|---|---|---|
| `ActiveBetsView` | `{ bets: BetView[], perspective?, hint?, onBetPress?, onParlayPress?, onCancelBet? }` | Shared **Active Bets** surface: wager summary (BETS / PINS WAGERED / BETTORS) + pending bets grouped by game, parlays bucketed separately. Same component on public Sportsbook (no callbacks) and AdminSportsbook (settle/cancel callbacks + `hint`). `perspective: 'house'` negates returns. |
| `SettledBetsView` | `{ bets, perspective?, onBetPress?, onCancelBet? }` | Shared **Settled Bets** surface: season's settled bets grouped by week, newest first. Same public/admin reuse pattern. |
| `BetRow` | `{ bet, isLast, badge, betReturnText, onPress?, onCancelPress? }` | One bet/parlay row (`subject · PICK line · G#`, or one line per leg) + status badge + signed return. Purely presentational; callbacks gate tap/cancel. |
| `BetDetailModal` | `{ bet: BetView \| null, onClose }` | Canonical single-bet breakdown overlay (bettor/season/week, consolidated legs with settled scores color-coded, wager/status/return). Renders nothing when `bet` is null. The bet display helpers (`resultBadge`, `betPayout`, `betReturn`, `betReturnDisplay`, `betReturnText`, `signed`) live in `src/utils/bets.ts`. |
| `SettleBetModal` | `{ bet, onClose, onSettled }` | Admin manual settlement (`settle_market` RPC, idempotent): one score input per unresolved O/U leg (moneyline legs settle server-side), already-settled legs shown locked. **Mount conditionally.** AdminSportsbookScreen only. |
| `LineRow` | `{ line: LineView, isLast, inProgress?, selectionState?, onSelect? }` — exports `SelectionUiState` | One bettable market on the Place Bets board: subject + one pill per selection. Market-type-agnostic. Caller computes per-selection `{ selected, disabled }` (cosmetic — disabled pills stay pressable so the screen can toast). |
| `LineRowContainer` | `{ title, count, note?, defaultCollapsed?, disabled?, rows: CollapsibleRow[] }` — exports `CollapsibleRow { key, pinned?, render(isLast) }` | Collapsible board section owning its own collapse state; `pinned` rows (legs in the parlay slip) stay visible while collapsed; `disabled` = game in progress. |
| `LedgerRow` | `{ entry: LedgerEntry, perspective: 'player'\|'house', isLast }` | The single renderer for both pin-ledger Activity surfaces. Derives an action label from `(type, perspective)` for every ledger type (bet/score/bonus/loan/pvp/bounty); bet-backed rows are tappable and open `BetDetailModal` internally. |
| `PinsinoLeaderboardTable` | `{ leaderboard, playerId, onRowPress, limit?, mode?: 'summary'\|'detail' }` | Pin-balance leaderboard table (rank, name + movement arrows, Pins/Open/Debt/Net columns in `detail`; name + net only in `summary`). `limit` for previews (top 3 on PinsinoScreen). |

## Loan Shark (`components/economy/`)

| Component | Props | Purpose |
|---|---|---|
| `BorrowConfirmModal` | `{ product: LoanProductView, onClose, onBorrowed }` | Borrow confirmation (terms: interest %, garnishment %, warning copy) → `take_loan` RPC. **Mount conditionally.** |

## PvP Challenge Contracts (`components/pvp/`)

All viewer-relative: `viewerId` maps "you vs opponent" onto the role-fixed creator/counterparty fields. All modals **mounted conditionally**.

| Component | Props | Purpose |
|---|---|---|
| `PvpChallengeRow` | `{ challenge: PvpChallengeView, viewerId, onPress, cta? }` | One challenge card: type/custom title, viewer-relative opponent + result chip (WON/LOST/PUSH/ACTIVE/…), scope · stakes · pot. Used on board, my-challenges, and admin lists. |
| `PvpChallengeDetailModal` | `{ challengeId, onClose, onChanged }` | Full contract detail — **self-loading** via `usePvpChallengeDetail` (offers, escrow ledger, pull-to-refresh) with accept / counter / decline / cancel actions opening the modals below. |
| `PvpAcceptModal` | `{ challenge, viewerId, onClose, onDone }` | Confirm acceptance of the full revised contract (shows both sides' stakes — they may be asymmetric) → `accept` RPC. |
| `PvpCounterModal` | `{ challenge, viewerId, balance, onClose, onDone }` | Counter-offer sheet: stakes (optionally asymmetric), game scope via `GamePicker`, message; Line Duel taker sets their own line. → `counter` RPC. |
| `PvpAdminActionModal` | `{ challenge, onClose, onDone }` | Admin settle / void / cancel with note, native confirm alerts, mapped to the live RPCs. |
| `LineDuelLines` | `{ sides: [LineSide, LineSide], label?, note? }` | Shared "LINES TO BEAT" card for a Line Duel (create screen, counter modal, detail). Each side is `{ name, value }` with the value preformatted by the caller. |

## Bounty Board (`components/bounty/`)

All bounty modals **mounted conditionally**; All-Comers model (see [economy/BOUNTIES_APP.md](economy/BOUNTIES_APP.md)).

| Component | Props | Purpose |
|---|---|---|
| `BountyCard` | `{ bounty: BountyView, viewerId?, onPress, manageHint? }` | One bounty row: title + status, sponsor line with YOU SPONSOR / YOU ENTERED tags, stake / reward-each / hunters cells, close time. `manageHint` swaps the footer for "Tap to manage" (admin list). |
| `BountyEntryModal` | `{ bounty, onClose, onDone }` | "Join the Hunt" confirmation (entry number + protected profit are estimates until the server assigns them) → `enter` RPC. |
| `BountyHouseCreateModal` | `{ weekId, onClose, onDone }` | Admin creates a House bounty (title, description, reward, hunter stake, max hunters — defaults to season player count — close time). Validates against `utils/bounty` min/max constants. |
| `BountyAdminActionModal` | `{ bounty, onClose, onDone }` | Admin close / settle (sponsor-win or hunter-win, **reasoning required**, amounts computed by `bountyEconomics` — never entered) / cancel-with-clawback. |

## Activity Feed ("Market Moves") (`components/economy/`)

| Component | Props | Purpose |
|---|---|---|
| `MarketMoveCard` | `{ event: FeedEventView, onPress? }` | One feed row: feature icon + actor avatar, line rendered client-side by `renderFeedEvent` (no stored text), relative timestamp + source, optional amount badge, optional 🏆 WINNER banner. Non-tappable when `onPress` omitted. See [activity-feed.md](activity-feed.md). |
