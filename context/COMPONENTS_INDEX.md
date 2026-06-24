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
| `LoadingView` | `{ label?, transparent?, delayed? }` | Centered full-screen spinner + uppercase label (default "Loading"). The standard `if (loading) return <LoadingView />` for every screen. `transparent` drops the solid bg so a pixel-art backdrop can show behind the spinner; `delayed` hides the spinner for the first 5s so Pinsino-stack transitions read as an instant art change (every Pinsino-stack screen mounts its backdrop + `<LoadingView transparent delayed />` while loading). |
| `EmptyCard` | `{ text, style? }` | The canonical empty state — surface card + centered muted condensed message. Pass margins via `style`. Used by the bet views, leaderboard table, and ~13 screens; visually different empty states (barlow/centered copy) keep their own styles. |
| `ScreenHeader` | `{ title, subtitle?, onBack, right? }` | Back-arrow + title (+ subtitle) header for every inner stack screen (used by 30+ screens). `right` pins an element top-right — the six pixel-art-backdrop screens pass `<ArtworkToggle />`. |
| `AppHeader` | `{ artworkToggle? }` | *(lives in `components/league/`)* Tab-root header: 🎳 PINDEJOS logo + "Season N · Week N" subline (self-loads via `weeks`/`seasons`, re-fetches on `uiStore.weekVersion`) + top-right `PlayerAvatar` that opens `ProfileMenuModal`. Used on the five tab home screens; `artworkToggle` adds the `ArtworkToggle` next to the avatar (Pinsino landing only — the one tab home with a backdrop). |
| `ArtworkToggle` | none | Header button that toggles `uiStore.artworkReveal`: mostly transparent when off, accent-colored when on. When on, art screens hide their foreground UI so the pixel-art backdrop shows in full. Resets to off on screen blur (via `useFocusEffect`) so navigating away never strands a hidden interface. Mounted in `AppHeader` (landing) and `ScreenHeader.right` (the six backdrop sub-screens). |
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

## Pixel-art backdrops (`components/pixelart/`, react-native-svg)

Ambient retro pixel-art scenes behind the Pinsino landing screens — decorative only, never interactive. **Art direction & vibe brief: [app/src/components/pixelart/DESIGN.md](../app/src/components/pixelart/DESIGN.md) — read it before producing any new scene.** Colors come from theme tokens plus the dedicated `colors.pixelArt` tint group (theme.ts); scenes are sprite-composed in `scenes.ts`, not hand-drawn ASCII blocks. **`config.ts` is the central standard** — cell size (`FIELD_PIXEL`), the opacity ladder (`BACKDROP_OPACITY`), anchor insets, and the mounting rule that art extends to the physical bezel (under the status bar) with headers carrying no background: fixed scenes/viewport fields mount as the first child inside the SafeAreaView; scroll-length fields mount inside the ScrollView **with the ScreenHeader also inside the ScrollView**, and their screens use a plain View + `paddingTop: insets.top` on the scroll content instead of a top-edge SafeAreaView. New backdrops must pull their values from `config.ts`, never inline them.

| Component | Props | Purpose |
|---|---|---|
| `PixelArtBackdrop` | `{ scene: SceneName }` | **The standard mount for fixed scenes.** Absolute-fill, `pointerEvents="none"` layer placed as the first child inside a screen's SafeAreaView (behind header + ScrollView). Resolves the scene's anchor (`bottom` full-bleed / `bottomCenter` / `bottomRight` / `topRight`) and whisper-quiet opacity (0.12 sparse, 0.08 dense screens, 0.18 hero scenes like the PvP shootout). One scene per Pinsino landing screen: `marketmoves`, `auction`. |
| `PinsinoNoirBackdrop` | none | The Pinsino landing's art is a **full-viewport desert-noir field** (glitzy-but-dangerous, deliberately minimal): sparse starfield + moon, a single neon diamond, one dune ridge with a lone saguaro, and a pair of red eyes in the dark. Mounted as the first child inside the SafeAreaView; sized synchronously from useWindowDimensions (art commits the same frame as the screen), content scrolls over it. |
| `PvPShootoutBackdrop` | none | PvP's art is a **full-viewport hero field** (the loudest rung, `sceneHero`): a midnight Texas shootout — bezel-to-ground procedural starfield (thinned over the central column, generous negative space) with a shooting star, one bright four-point star, and two buzzards circling above the duel; the shootout (gunslinger pins, holster glints, tumbleweed, saguaro, red eyes) pins to the bottom of the viewport. Mounted as the first child inside the SafeAreaView; sized synchronously from useWindowDimensions (art commits the same frame as the screen). |
| `BountyBoardBackdrop` | none | Bounties' art is a **full-viewport western notice board**: dark-wood frame with corner nails, dashed plank seams + rare knots for grain. The top third stays bare planks by design — the house bounty card renders there conspicuously; pinned details (big sheriff-star poster, small poster with red eyes, an empty nail with a torn scrap) sit below `DETAIL_TOP` (38%), with the grain cleared behind each poster so paper occludes the board. Mounted as the first child inside the SafeAreaView; sized synchronously from useWindowDimensions (art commits the same frame as the screen). |
| `SportsbookPokerTableBackdrop` | none | The Sportsbook's art is a **scroll-length nine-seat poker table** seen from above, not a fixed scene: a two-cell dark-wood rail (`colors.pixelArt.wood`) wrapping the entire scroll length with rounded corners and a felt line inside, nine seat cushions around the rail (3 top / 2 per side / 2 bottom) dressed with trinkets — fanned cards, chip stacks, a martini, dice, the dealer button — and a red eye pair under the table. Side seats sit at fractions of the measured length, so the table re-lays itself when toggles/collapsible groups change the content height. Mounted as the first child **inside the ScrollView**; first frame paints at window size (also mounted behind the loading spinner), then onLayout extends it to the true scroll length. |
| `LoanSharkDepthBackdrop` | none | Loan Shark's art is a **scrolling full-bleed depth field**, not a fixed scene: a procedural pixel field the full length of the scroll content (window-size first frame + behind the loading spinner, then onLayout extends it) telling a depth story that tracks loan risk top-to-bottom — solid beach (pebbles, abandoned dice, footprints walking into the surf) → surf → shallows → mid-water fins → deep → abyss with red eyes. Speckle density is full in the side gutters and sporadic behind the cards. Mounted as the first child **inside the ScrollView** so it scrolls with the page. |
| `PixelArt` | `{ grid: PixelGrid, pixelSize }` | Generic renderer: a `PixelGrid` (rows of palette-keyed chars, `'.'` transparent) drawn as one SVG `<Rect>` per cell. Reusable anywhere pixel art is needed. |
| `scenes.ts` | exports `SCENES`, `SceneName`, `SceneDef` | Scene catalog + the `compose`/`rekey` sprite-stamping helpers and sprite library (PIN, BALL, SHARK_FIN, GAVEL…). To add a scene: define sprites, `compose()` a grid, pick anchor/opacity, add to `SCENES`, mount `<PixelArtBackdrop scene="…" />` on the screen. |

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
| `BetDetailModal` | `{ bet: BetView \| null, onClose, canHaunt?, alreadyHaunted?, onRequestHaunt? }` | Canonical single-bet breakdown overlay (bettor/season/week, a SPECIAL row with the custom line's snapshotted title + description when tagged, consolidated legs with settled scores color-coded, wager/status/return). Renders nothing when `bet` is null. The bet display helpers (`resultBadge`, `betPayout`, `betReturn`, `betReturnDisplay`, `betReturnText`, `signed`) live in `src/utils/bets.ts`. **Ghost in the Slip:** on a `won` bet it fetches `haunts.listForBet` and shows the reveal (who haunted + their cuts); when `canHaunt` (a foreign pending bet, viewer holds a Ghost, not already haunted) it shows the "👻 Haunt this bet" CTA — `onRequestHaunt` lets the parent open the confirm sheet at screen level (no nested modals). Only `SportsbookScreen` wires the haunt props. |
| `SettleBetModal` | `{ bet, onClose, onSettled }` | Admin manual settlement (`settle_market` RPC, idempotent): one score input per unresolved O/U leg (moneyline legs settle server-side), already-settled legs shown locked. **Mount conditionally.** AdminSportsbookScreen only. |
| `LineRow` | `{ lines: LineView[], isLast, relation?, inProgress?, selectionState?, onSelect? }` — exports `SelectionUiState` | One betting **subject** (≥1 markets) on the Place Bets board: player rows stack the name over an evenly-spaced button set (one pill per (line, selection), labels via `selectionButtonLabel` — "142.5+ PINS"); moneyline rows keep the horizontal name/WIN layout. `relation` paints the with/against (green/red) wash. Market-type-agnostic. Caller computes per-selection `{ selected, disabled }` (cosmetic — disabled pills stay pressable so the screen can toast). |
| `WagerSheet` | `{ title, titleColor?, oddsPrefix?, odds, wager, onChangeWager, balance, ctaLabel, onSubmit, busy?, onClose, children? }` | **The shared bet-confirmation sheet** on `BottomSheet`: title → "… PAYS ×odds" → caller's body (pick toggle / leg list as `children`) → wager input with a **live to-win preview** (`floor(wager × odds)`) → can't-cancel warning → CTA. Backs all three SportsbookScreen flows (single, parlay, special take); the screen owns betting state + placement RPCs. **Mount conditionally.** |
| `LineRowContainer` | `{ title, count, note?, defaultCollapsed?, disabled?, rows: CollapsibleRow[] }` — exports `CollapsibleRow { key, pinned?, render(isLast) }` | Collapsible board section owning its own collapse state; `pinned` rows (legs in the parlay slip) stay visible while collapsed; `disabled` = game in progress. |
| `CustomLineRow` | `{ line: CustomLineView, isLast, inProgress?, disabled?, onTake? }` | One admin custom line ("special") on the board: title/description/leg summary + a single oversized `×odds` multiplier button (the multiplier is the button — no label). `category='special'` → gold treatment; no chip, color is the distinguishing mark. Same callback-gating as `LineRow` (`disabled` dims but stays pressable so the screen can toast). See [betting-line-board.md](betting-line-board.md) §Custom lines. |
| `CustomLineCreateModal` | `{ currentWeekId, seasonId, initial?, onClose, onDone }` | Admin create/edit sheet for custom lines on `BottomSheet` (title/description/style, This Week / Pick Weeks / Every Week scope, leg builder via `PlayerPickerModal` with a Specific Player / **Whoever Takes It** subject toggle — self legs are over-only — and a `G1/G2/BOTH/EACH` game picker: **BOTH** stages one leg per official game in one cross-game bet, **EACH** materializes the special once per game). Direct `customLines` table writes through admin RLS. **Mount conditionally**; pass `initial` (raw row) for Edit. |
| `CustomLineAdminActionModal` | `{ line, onClose, onDone, onEdit }` | Admin per-line action sheet on `BottomSheet` + `useAdminAction` (Edit / Enable–Disable / Delete with destructive confirm). No pin movement — placed bets keep their selections. **Mount conditionally.** AdminSportsbookScreen's Specials view only. |
| `LedgerRow` | `{ entry: LedgerEntry, perspective: 'player'\|'house', isLast }` | The single renderer for both pin-ledger Activity surfaces. Derives an action label from `(type, perspective)` for every ledger type (bet/score/bonus/loan/pvp/bounty); a special's bet shows only its snapshotted title (gold for `special`) — legs live in the detail overlay; bet-backed rows are tappable and open `BetDetailModal` internally. |
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

## Auction House (`components/auction/`)

All sheets **mounted conditionally**. Components bind to the view types in `utils/auction.ts`, fed by `useAuctionHouseData` / `useAuctionDetailData` over the `auctions` / `itemCatalog` / `inventoryItems` / `auctionLedger` objects in `db.ts` (see [economy/AUCTION_FINDINGS.md](economy/AUCTION_FINDINGS.md) §8). Sealed-bid contract: bid amounts render only for their owner (`my_bid_amount` RPC — the column is ciphertext).

| Component | Props | Purpose |
|---|---|---|
| `AuctionCard` | `{ auction: AuctionView, onPress }` | One auction row: item + status, description, min-bid / bidder-count / time cells. Carries a **BID PLACED tag only — never the amount**. Scheduled cards dim + show OPENS IN; settled cards show winner + price (or NO SALE) + bounce count. |
| `AuctionBidSheet` | `{ auction, balance, onClose, onDone }` | Place/edit the sealed bid on `BottomSheet`: balance row, amount input (prefilled min bid or current bid), free re-pricing (no increment), §18.3 pledge copy always, large-bid warning at ≥50% of balance, CTA `Pledge X pins`. |
| `AuctionCreateModal` | `{ initial?, onClose, onDone }` | Admin create/edit: catalog item chips (the item's catalog copy shown read-only and submitted as the auction description — no free-text pitch), min bid, quantity (1–50; top-N pay-as-bid, helper copy when > 1), opens/closes pickers (close defaults next Mon 7 PM ET), bounce fee shown read-only. No drafts — creates straight into scheduled/open. Pass `initial` for Edit (scheduled only). |
| `AuctionAdminActionModal` | `{ auction, onClose, onDone, onEdit }` | Admin actions by status via `useAdminAction`: Edit / Open Now (scheduled), Settle Now (open), Cancel-erase or Reverse-settlement (destructive). **No bid inspection — sealed means sealed, even for admins.** Mounts on `AuctionHouseAdminScreen` only. |
| `CatalogItemModal` | `{ initial?, onClose, onDone }` | Admin create/edit of an `item_catalog` row: key (create only, permanent), icon/name/description, effect-type + activation chips, effect-params JSON, active toggle (edit). Functional fields render frozen once instances exist (mirrors the DB guard). |
| `GrantItemSheet` | `{ playerOptions, catalog, onClose, onDone }` | Admin grant: player dropdown + active-item chips + quantity (1–50) → `inventoryItems.grant`. No pins move — grants are House gifts. |
| `MyItemRow` | `{ group: InventoryGroupView, onPress }` | One grouped inventory row — items are **atomic single-use**, identical ones display as ×N (`groupInventory`). Consumed groups stay visible greyed-out with an **EXPIRED** tag. |
| `ItemInfoSheet` | `{ group, onClose }` | Info-only sheet: what it does / how to use it / per-item provenance lines. No actions — activation lives at the point of use. |
| `GoldenTicketToggle` | `{ ticketCount, enabled, onToggle, disabled? }` | The "use Golden Ticket" row for `WagerSheet`'s children slot. Default OFF; renders nothing at 0 tickets; ON-state copy states the ticket is spent at placement win or lose. **Not yet mounted** — wires into SportsbookScreen when `placeHouseBet` gains the insurance arg. |

## Activity Feed ("Market Moves") (`components/economy/`)

| Component | Props | Purpose |
|---|---|---|
| `MarketMoveCard` | `{ event: FeedEventView, onPress? }` | One feed row: feature icon + actor avatar, line rendered client-side by `renderFeedEvent` (no stored text), relative timestamp + source, optional amount badge, optional 🏆 WINNER banner. Non-tappable when `onPress` omitted. See [activity-feed.md](activity-feed.md). |
