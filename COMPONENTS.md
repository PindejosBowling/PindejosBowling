# Components Consolidation Audit

> **Status:** Audit / backlog. This document does **not** describe completed work — it
> identifies opportunities. Each opportunity below is independently executable.
>
> **Audience:** implementing agents. Every claim carries `file:line` references; every
> opportunity carries an explicit *Affected files / blast radius* list and an *Acceptance*
> line you can check against.
>
> **Scope of this audit:** `app/src/components/` — 41 components, ~6,834 lines. The
> directory's consistency enabled fast feature shipping, but rapid growth produced
> structural copy-paste. This document maps where that duplication is and how to collapse it
> into a small set of flexible building blocks.

---

## How to use this document

1. **Respect the build order.** Opportunities are ID'd and ordered *foundational-first*
   (`P*` primitives → `M*` modals → `R*/C*/L*` lists → `S*` selectors). Later items assume
   earlier ones exist (e.g. `<ConfirmDialog>` is built on `<ModalSheet>` + `<Button>`). Do
   not start `M2` before `M1`.
2. **One opportunity per PR.** Each is scoped to land independently. Within an opportunity,
   adopt consumers incrementally (lowest-risk screen first) — never do a big-bang replace of
   a primitive used by 30 files.
3. **No behavior change.** Every consolidation here is a pure refactor: the rendered UI and
   interactions must be pixel-identical before/after. Extract structure, keep content.
4. **Verify by running the app.** There is no test suite (`AGENTS.md` rule #6). After each
   change, `cd app && npx expo start` and exercise the touched screen.
5. **Theme rule.** New shared styles read tokens from [app/src/theme.ts](app/src/theme.ts).
   Do not introduce new hardcoded hex/rgba in shared primitives.
6. **Helpers belong in `utils/`, not components.** Pure (non-React) helpers don't belong in
   component files. When you refactor a component or its consumers, lift any exported helpers
   into `utils/<domain>.ts` — the convention `pvp.ts` / `bounty.ts` already follow. (Today
   only `BetDetailModal` violates this; L1 fixes it.)

---

## Inventory snapshot

41 components. "Lines" is current size; "Cat" groups by structural role.

| Component | Lines | Cat | Notes |
|---|---:|---|---|
| AdminGenerateTeamsModal | 711 | modal-form | Largest file; complex multi-step form |
| PvPChallengeDetailModal | 486 | modal-detail | Nests PvpAccept/PvpCounter modals |
| AdminOpenRegistrationModal | 341 | modal-form | |
| PvpCounterModal | 316 | modal-form | |
| AdminEditSeasonModal | 290 | modal-form | |
| SettleBetModal | 261 | modal-form | |
| AdminEndSeasonModal | 241 | modal-form | |
| BorrowConfirmModal | 218 | modal-confirm | Bottom-sheet variant |
| BetDetailModal | 206 | modal-detail | Also exports `resultBadge` / `betReturnText` helpers |
| PvpAdminActionModal | 203 | modal-form | |
| BountyHouseCreateModal | 200 | modal-form | |
| PinsinoLeaderboardTable | 193 | list-view | **Already well-consolidated** (mode-driven) |
| ActiveBetsView | 191 | list-view | Near-twin of SettledBetsView |
| OddsBlock | 190 | display | |
| PlayerScoreRow | 186 | row | Inline initials avatar |
| BountyAdminActionModal | 177 | modal-form | |
| AdminArchiveModal | 172 | modal-confirm | Centered variant |
| PlayerPickerModal | 162 | modal-select | |
| BetRow | 158 | row | |
| MarketMoveCard | 148 | card | Uses `PlayerAvatar` correctly |
| LedgerRow | 145 | row | |
| ProfileMenuModal | 142 | modal-select | Only used by AppHeader |
| LineRowContainer | 126 | row | **Already well-consolidated** |
| PvpAcceptModal | 122 | modal-confirm | |
| HistoricalTeamBlock | 118 | display | Inline initials avatar |
| LineRow | 113 | row | **Already well-consolidated** |
| BountyEntryModal | 109 | modal-confirm | |
| ConfirmBar | 104 | bar | Hardcoded gold-overlay literals |
| SettledBetsView | 102 | list-view | Near-twin of ActiveBetsView |
| PvpChallengeRow | 101 | card | |
| BountyCard | 89 | card | |
| AppHeader | 84 | header | App chrome — **do not merge** with ScreenHeader |
| Toast | 60 | primitive | Mounted per-screen / per-modal (see toast.md) |
| PlayerAvatar | 57 | display | Signed-URL avatar + initials fallback |
| PillFilter | 57 | selector | Scrollable pills |
| ToggleGroup | 54 | selector | Fixed-width toggles |
| LineDuelLines | 53 | display | **Already well-consolidated** |
| GamePicker | 49 | selector | `Game {n}` formatter |
| ScreenHeader | 45 | header | Per-screen back bar — **do not merge** with AppHeader |
| LoadingView | 33 | primitive | Most-used component (32 screens) |
| PlayerBadges | 21 | display | Trivial emoji map |

### Importer / blast-radius map

Counts are distinct importing files under `app/src` (verified via grep on
`from '../components/<Name>'`).

| Component | Importers | Count |
|---|---|---:|
| LoadingView | 32 screens | 32 |
| ScreenHeader | ~30 screens | 30 |
| PillFilter | 11 screens | 11 |
| Toast | 8 screens (+ mounted inside every modal) | 8 |
| ToggleGroup | 7 screens | 7 |
| AppHeader | 7 screens | 7 |
| BetDetailModal | SportsbookScreen, PinsinoSportsbookScreen, MarketMovesScreen, PlayerPinsinoScreen, + `LedgerRow` | 4 |
| PvPChallengeDetailModal | PvPScreen, PvPBoardScreen, MarketMovesScreen | 3 |
| PvpChallengeRow | PvPScreen, PvPBoardScreen, PvPAdminScreen | 3 |
| ActiveBetsView / SettledBetsView | SportsbookScreen, PinsinoSportsbookScreen | 2 each |
| LedgerRow | PinsinoAccountingScreen, PlayerPinsinoScreen | 2 |
| BetRow | SportsbookScreen, PlayerPinsinoScreen (+ both Bets views) | 2 |
| BountyCard | BountyBoardScreen, BountyAdminScreen | 2 |
| PinsinoLeaderboardTable | PinsinoScreen, PinsinoLeaderboardScreen | 2 |
| PlayerAvatar | PlayerDetailScreen, ProfilePicturesScreen (+ AppHeader, MarketMoveCard) | 2 |
| PlayerPickerModal | PvPCreateScreen, HeadToHeadScreen | 2 |
| ConfirmBar | MatchupsScreen, RsvpScreen | 2 |
| **Single-use** | Each imported by exactly one screen: all 5 `Admin*Modal`, `BorrowConfirmModal`, `BountyAdminActionModal`, `BountyEntryModal`, `BountyHouseCreateModal`, `SettleBetModal`, all `Pvp*Modal`, `GamePicker`, `LineRow`, `LineRowContainer`, `MarketMoveCard`, `OddsBlock`, `PlayerScoreRow`, `HistoricalTeamBlock`, `PlayerBadges` | 1 |
| `ProfileMenuModal` | Imported **only by AppHeader**, not by any screen | — |

> Single-use is *not* automatically a problem (a screen-specific modal is fine). It only
> tells you the blast radius is small — these are the safest places to adopt a new primitive
> first.

---

## Build order

```
P3 (theme tokens)  ──►  P1 (Button)   ──►  M1 (ModalSheet) ──►  M2 (ConfirmDialog)
                   └─►  P2 (Input)    ──►  (form modals adopt ModalSheet + Button + Input)

R1 (ListRow)   C1 (Card) ──► C2 (EmptyStateCard) ──► L1 (BetsView merge)   S1 (SegmentedControl)   A1 (AvatarCircle)
   └─ independent of the modal track; can proceed in parallel ─┘
```

Rationale: P-tier primitives and theme tokens are the shared substrate the modal/row/card
refactors consume. Do them first so each later refactor *removes* style code instead of
moving it.

---

## Opportunities catalog

### P3 — Theme token additions (do first)

**Problem:** [app/src/theme.ts](app/src/theme.ts) exposes only `colors`, `fonts`, `radius`.
Three categories of value are therefore hardcoded across components:
- **Modal overlay color** — 17 modals hardcode the backdrop fill, and they aren't even
  consistent: 16 use `'rgba(0,0,0,0.7)'` (e.g. [AdminArchiveModal.tsx:112](app/src/components/AdminArchiveModal.tsx#L112),
  [BorrowConfirmModal.tsx:114](app/src/components/BorrowConfirmModal.tsx#L114),
  [PvpAcceptModal.tsx:99](app/src/components/PvpAcceptModal.tsx#L99)) while
  [BetDetailModal.tsx:157](app/src/components/BetDetailModal.tsx#L157) uses `'rgba(0,0,0,0.5)'`.
- **An existing token re-derived as a literal** — `colors.accentDim` already equals
  `'rgba(232,255,71,0.12)'` ([theme.ts:9](app/src/theme.ts#L9)), yet
  [OddsBlock.tsx:135](app/src/components/OddsBlock.tsx#L135) and
  [OddsBlock.tsx:179](app/src/components/OddsBlock.tsx#L179) hardcode that exact rgba.
  `ConfirmBar` hardcodes gold-tint variants ([ConfirmBar.tsx:56](app/src/components/ConfirmBar.tsx#L56)
  `'rgba(251,191,36,0.3)'`, [ConfirmBar.tsx:83](app/src/components/ConfirmBar.tsx#L83)
  `'rgba(251,191,36,0.4)'`) that are tints of `colors.gold`.
- **A spacing scale** — magic numbers `8 / 10 / 12 / 14 / 16 / 24` recur in nearly every
  `StyleSheet` for padding/gap/margin with no shared source.

**Recommendation:** Extend `theme.ts` with:
```ts
export const colors = { /* …existing… */ overlay: 'rgba(0,0,0,0.7)' }
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
// Optional: text presets for the repeated Barlow-Condensed title/label combos
export const text = {
  title:    { fontFamily: fonts.barlowCondensed, fontSize: 22, color: colors.text, fontWeight: '700' },
  label:    { fontFamily: fonts.barlowCondensed, fontSize: 11, color: colors.muted, letterSpacing: 1.5 },
  body:     { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, lineHeight: 20 },
}
```
Then replace the literal overlay fills with `colors.overlay`, the `OddsBlock` literals with
`colors.accentDim`, and (incrementally) magic spacing with `spacing.*`.

**New file:** none — edit [app/src/theme.ts](app/src/theme.ts).

**Affected files / blast radius:** the 17 modal backdrops; `OddsBlock`; `ConfirmBar`; and
opportunistically any `StyleSheet` touched by P1/M1. The overlay + accentDim swaps are
mechanical and safe to do in one pass; the spacing migration can be lazy (only when a file is
edited for another reason).

**Acceptance:** `theme.ts` exposes `colors.overlay` and `spacing`; `grep -rn "rgba(0,0,0"
app/src/components` returns only `colors.overlay` references (or, deliberately, none);
`grep -rn "232,255,71" app/src` returns nothing. No visual change.

**Risk:** Low.

---

### P1 — `<Button>` primitive (highest-impact gap)

**Problem:** There is **no shared button component**. ~30 components each hand-roll a
`TouchableOpacity` + near-identical styles. The canonical primary-button shape recurs
verbatim:
- [AdminArchiveModal.tsx:155-168](app/src/components/AdminArchiveModal.tsx#L155-L168) —
  `btnPrimary` (`flex:1, paddingVertical:12, borderRadius:radius.cardSm,
  backgroundColor:colors.accent`) + `btnPrimaryText` (`barlowCondensed, 15, colors.bg,
  fontWeight:'700'`) + `btnDisabled` (`opacity:0.4`).
- [BorrowConfirmModal.tsx:195-209](app/src/components/BorrowConfirmModal.tsx#L195-L209) —
  same shape as `confirmBtn` / `confirmBtnText` / `confirmBtnDisabled`.
- A secondary/cancel variant repeats too ([AdminArchiveModal.tsx:141-154](app/src/components/AdminArchiveModal.tsx#L141-L154)
  `btnCancel`), and gold/destructive variants exist in
  [ConfirmBar.tsx:91-103](app/src/components/ConfirmBar.tsx#L91-L103).
- The loading state is also copy-pasted everywhere: `saving ? <ActivityIndicator size="small"
  color={colors.bg}/> : <Text>…</Text>` (e.g.
  [AdminArchiveModal.tsx:94-98](app/src/components/AdminArchiveModal.tsx#L94-L98),
  [BorrowConfirmModal.tsx:99-101](app/src/components/BorrowConfirmModal.tsx#L99-L101)).

**Recommendation:** Create `<Button>` owning the press target, label, loading spinner, and
disabled opacity:
```ts
interface ButtonProps {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' // default 'primary'
  size?: 'sm' | 'md'                                                // default 'md'
  loading?: boolean        // renders ActivityIndicator color={colors.bg}
  disabled?: boolean       // applies opacity:0.4, blocks onPress
  fullWidth?: boolean      // flex:1 for in-a-row layouts
  style?: StyleProp<ViewStyle>
}
```
Map existing usages: `btnPrimary/confirmBtn` → `variant="primary"`; `btnCancel` →
`variant="secondary"`; `ConfirmBar` save → `variant="gold"`; the `✕`/cancel destructive
chips → `variant="danger"`.

**New file:** `app/src/components/Button.tsx` (→ `ui/` after the reorg, see end).

**Affected files / blast radius:** Nearly every modal plus many screens. **Adopt
incrementally** — start with single-use, low-risk modals (`AdminArchiveModal`,
`BorrowConfirmModal`, `BountyEntryModal`) to validate the API, then fan out. Do **not** swap
all 30 in one PR.

**Acceptance:** `<Button>` exists with the 5 variants; the three pilot modals render their
actions via `<Button>` with identical appearance and the same disabled/loading behavior; each
pilot modal's local `btn*`/`confirmBtn*` styles are deleted.

**Risk:** Low per consumer (Medium only if done all at once — don't).

---

### P2 — `<TextField>` / `<Input>` primitive

**Problem:** The same text-input styling (`backgroundColor:colors.surface2`,
`borderColor:colors.border2`, Barlow font, consistent padding) is reimplemented across ~9
components: `SettleBetModal`, `AdminEditSeasonModal`, `AdminOpenRegistrationModal`,
`BountyAdminActionModal`, `BountyHouseCreateModal`, `PvpAdminActionModal`, `PvpCounterModal`,
`PlayerPickerModal` (search field), and `PlayerScoreRow` (score entry). Numeric inputs also
repeat the same `keyboardType` + sanitize-to-digits handling ad hoc.

**Recommendation:** Create `<TextField>` wrapping `TextInput` with an optional label, error
state, and a `numeric` helper that owns digit sanitization:
```ts
interface TextFieldProps {
  value: string
  onChangeText: (t: string) => void
  label?: string
  placeholder?: string
  numeric?: boolean         // keyboardType + strips non-digits
  error?: string
  style?: StyleProp<ViewStyle>
}
```

**New file:** `app/src/components/TextField.tsx` (→ `ui/`).

**Affected files / blast radius:** the ~9 components above. Adopt incrementally; the
numeric-stake inputs in `SettleBetModal` / `PvpCounterModal` / `BountyHouseCreateModal` are
the highest-value first targets (they share the most sanitize logic).

**Acceptance:** `<TextField>` exists; at least the three numeric-stake modals use it with
identical appearance and input behavior; their local input styles + sanitize helpers are
deleted.

**Risk:** Low.

---

### M1 — `<ModalSheet>` base

**Problem:** Every one of the 17 modals reimplements the same scaffolding: the RN `<Modal>`
wrapper, the dimmed backdrop, the sheet container, a title/subtitle/close header, the
`<Toast/>` mounted **inside** the Modal (required — see [context/toast.md](context/toast.md);
toasts are occluded by the native modal layer otherwise), and (for form modals)
`KeyboardAvoidingView` + `ScrollView`. Two layout variants exist and both must be preserved:

- **Centered** — [AdminArchiveModal.tsx:110-122](app/src/components/AdminArchiveModal.tsx#L110-L122):
  backdrop `justifyContent:'center'`, sheet `borderRadius:20`, `animationType="fade"`.
- **Bottom-sheet** — [BorrowConfirmModal.tsx:114-123](app/src/components/BorrowConfirmModal.tsx#L114-L123):
  backdrop `justifyContent:'flex-end'`, sheet `borderTopLeftRadius/borderTopRightRadius:20`,
  `paddingBottom: Platform.OS === 'ios' ? 40 : 24`, `animationType="slide"`.

The `<Toast/>`-inside-Modal pattern is currently duplicated in ~15 files (e.g.
[AdminArchiveModal.tsx:103-104](app/src/components/AdminArchiveModal.tsx#L103-L104)) — a
landmine if anyone "tidies" it out.

**Recommendation:** Create `<ModalSheet>` that owns the wrapper, backdrop (using
`colors.overlay` from P3), variant geometry, header, keyboard avoidance, scroll, and the
single `<Toast/>` mount:
```ts
interface ModalSheetProps {
  visible: boolean
  onClose: () => void
  title: string
  subtitle?: string
  variant?: 'center' | 'sheet'   // default 'center'
  scrollable?: boolean           // wraps children in keyboard-aware ScrollView
  dismissable?: boolean          // default true; pass false to block close while saving
  footer?: ReactNode             // action row (typically <Button>s)
  children: ReactNode
}
```
Tap-outside-to-close, the `✕` close button, and the inside-Modal `<Toast/>` live here once.
Form modals compose `ModalSheet` + `<TextField>` (P2) + `<Button>` (P1) in `footer`.

**New file:** `app/src/components/ModalSheet.tsx` (→ `ui/`).

**Affected files / blast radius:** all 17 modals (see inventory cats `modal-*`), reaching
~13 screens that mount one. Migrate single-use confirm modals first, then form modals, then
the two large detail modals (`PvPChallengeDetailModal`, `BetDetailModal`) last. When you reach
`BetDetailModal`, also do the helper extraction (see L1's sub-step + guardrail #6) if L1
hasn't already — its five exported helpers move to `app/src/utils/bet.ts`.

**Acceptance:** `<ModalSheet>` renders both variants pixel-identically to the originals; the
`<Toast/>` mount and keyboard handling live only in `ModalSheet`; migrated modals no longer
declare `backdrop`/`sheet`/`title` styles. The inside-Modal Toast still appears above the
sheet on a migrated screen.

**Risk:** Medium (it's the highest-traffic scaffold) — mitigate by migrating one modal,
verifying in-app, then proceeding.

---

### M2 — `<ConfirmDialog>` (built on M1 + P1)

**Problem:** Four modals are pure confirm dialogs — title + body copy + cancel/confirm, no
inputs — and each re-expresses that as ~110-220 lines:
[AdminArchiveModal](app/src/components/AdminArchiveModal.tsx) (172),
[BountyEntryModal](app/src/components/BountyEntryModal.tsx) (109),
[PvpAcceptModal](app/src/components/PvpAcceptModal.tsx) (122), and the confirm portion of
[BorrowConfirmModal](app/src/components/BorrowConfirmModal.tsx) (218; its stat grid stays,
its confirm/cancel footer collapses).

**Recommendation:** Create `<ConfirmDialog>` as a thin composition over `ModalSheet` +
`Button`:
```ts
interface ConfirmDialogProps {
  visible: boolean
  onClose: () => void
  title: string
  description?: string      // simple body; richer bodies pass children instead
  children?: ReactNode      // optional custom body (e.g. BorrowConfirm's stat grid)
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
  destructive?: boolean     // confirm renders as variant="danger"
}
```

**New file:** `app/src/components/ConfirmDialog.tsx` (→ `ui/`).

**Affected files / blast radius:** the four confirm modals above + their single importing
screens (`MatchupsScreen`, `BountyDetailScreen`, `PvPBoardScreen`, `LoanSharkScreen`).

**Acceptance:** `AdminArchiveModal` drops from 172 → ~45 lines with no behavior change;
`BountyEntryModal` and `PvpAcceptModal` likewise reduced; `BorrowConfirmModal` keeps its stat
grid as `children` but its footer comes from `ConfirmDialog`.

**Risk:** Low (depends on M1 + P1 landing first).

---

### R1 — `<ListRow>` primitive

**Problem:** Four row components re-declare the identical horizontal skeleton +
`isLast`-gated bottom border:
- [BetRow.tsx:97-107](app/src/components/BetRow.tsx#L97-L107) — `betRow` (`flexDirection:'row',
  alignItems:'center', paddingHorizontal:14, paddingVertical:12, gap:10`) + `lineRowBorder`.
- [LedgerRow.tsx:115-125](app/src/components/LedgerRow.tsx#L115-L125) — `row` (same, with
  `justifyContent:'space-between'`) + `rowBorder`.
- [PlayerScoreRow.tsx:102-105](app/src/components/PlayerScoreRow.tsx#L102-L105) — same row, but
  `paddingVertical:8` (a denser variant).
- `LineRow` uses the same shape (part of the betting stack; leave its content alone).

Each also re-implements the `isLast ? noBorder : border` conditional and the pressable/static
branch (`BetRow` toggles `TouchableOpacity` vs `View` on `onPress`,
[BetRow.tsx:69-92](app/src/components/BetRow.tsx#L69-L92); `LedgerRow` does the same,
[LedgerRow.tsx:98-111](app/src/components/LedgerRow.tsx#L98-L111)).

**Recommendation:** Create `<ListRow>` providing the skeleton, border logic, and
press-vs-static branch via slots:
```ts
interface ListRowProps {
  leading?: ReactNode     // avatar/icon
  middle: ReactNode       // flex:1 title+subtitle block
  trailing?: ReactNode    // value/badge/chevron
  isLast?: boolean        // suppress bottom border
  density?: 'normal' | 'compact'  // 'compact' = paddingVertical:8 (PlayerScoreRow)
  onPress?: () => void    // when present, wraps in TouchableOpacity
}
```
Move only the *container + border + press branch* into `ListRow`; keep each row's content
(the `betSubject`/`primary`/`amount` text) in place.

**New file:** `app/src/components/ListRow.tsx` (→ `ui/`).

**Affected files / blast radius:** `BetRow`, `LedgerRow`, `PlayerScoreRow` (and optionally
`LineRow`). These flow through `ActiveBetsView`/`SettledBetsView`, `PinsinoAccountingScreen`,
`PlayerPinsinoScreen`, `SportsbookScreen`, `MatchupsScreen` — but only the row internals
change, so consumers are untouched.

**Acceptance:** the three rows render identically; each row file no longer declares its own
`row`/`betRow` container or `*Border` style; the pressable/static branch exists once in
`ListRow`.

**Risk:** Low.

---

### C1 — `<Card>` shell

**Problem:** The same card shell — `backgroundColor:colors.surface, borderRadius:radius.cardMd,
borderWidth:1, borderColor:colors.border, padding:14, marginBottom:10` — is byte-identical in
three files:
- [BountyCard.tsx:67-74](app/src/components/BountyCard.tsx#L67-L74)
- [MarketMoveCard.tsx:75-82](app/src/components/MarketMoveCard.tsx#L75-L82)
- [PvpChallengeRow.tsx:63-70](app/src/components/PvpChallengeRow.tsx#L63-L70)

A `overflow:'hidden'` section-card variant (same shell, no inner padding, used to clip a list
of `ListRow`s) is *also* duplicated:
- [ActiveBetsView.tsx:169-176](app/src/components/ActiveBetsView.tsx#L169-L176)
- [SettledBetsView.tsx:80-87](app/src/components/SettledBetsView.tsx#L80-L87)

**Recommendation:** Create `<Card>`:
```ts
interface CardProps {
  children: ReactNode
  onPress?: () => void          // tappable cards (BountyCard, PvpChallengeRow) → TouchableOpacity
  padding?: number              // default 14; pass 0 for the section/list variant
  overflow?: 'hidden' | 'visible'
  marginBottom?: number         // default 10
  style?: StyleProp<ViewStyle>
}
```

**New file:** `app/src/components/Card.tsx` (→ `ui/`).

**Affected files / blast radius:** `BountyCard`, `MarketMoveCard`, `PvpChallengeRow`,
`ActiveBetsView`, `SettledBetsView`. Consumers unchanged.

**Acceptance:** all five render identically; the five local `card` style objects are deleted;
`padding={0} overflow="hidden"` reproduces the list-section variant exactly.

**Risk:** Low.

---

### C2 — `<EmptyStateCard>` (fold into C1)

**Problem:** Identical empty-state card in both Bets views:
[ActiveBetsView.tsx:177-184](app/src/components/ActiveBetsView.tsx#L177-L184) +
[SettledBetsView.tsx:88-95](app/src/components/SettledBetsView.tsx#L88-L95) (same shell with
`padding:20, alignItems:'center'`), each with a matching `emptyText` style.

**Recommendation:** A tiny `<EmptyStateCard message="…" />` built on `<Card>` (centered,
muted text). Bundle delivery with C1.

**New file:** `app/src/components/EmptyStateCard.tsx` (or export from `Card.tsx`).

**Affected files / blast radius:** the two Bets views (and reusable by any future empty list).

**Acceptance:** both empty states render via `<EmptyStateCard>`; local `emptyCard`/`emptyText`
styles deleted.

**Risk:** Low.

---

### L1 — Merge `ActiveBetsView` + `SettledBetsView` → `<BetsView groupBy>`

**Problem:** The two views are near-twins. Both: render `<BetRow>` inside a section `<Card>`,
use the identical section-label style
([ActiveBetsView.tsx:161-167](app/src/components/ActiveBetsView.tsx#L161-L167) ≡
[SettledBetsView.tsx:72-79](app/src/components/SettledBetsView.tsx#L72-L79)), share the same
`onBetPress`/`onCancelBet` gating, and share the empty-state card. The only real differences:
- **Grouping key:** `ActiveBetsView` groups by game number
  ([ActiveBetsView.tsx:38-51](app/src/components/ActiveBetsView.tsx#L38-L51)) and buckets
  parlays separately; `SettledBetsView` groups by week, newest-first
  ([SettledBetsView.tsx:24-37](app/src/components/SettledBetsView.tsx#L24-L37)).
- **Summary card:** Active-only ([ActiveBetsView.tsx:66-81](app/src/components/ActiveBetsView.tsx#L66-L81)).

**Recommendation:** Collapse into one `<BetsView>`:
```ts
interface BetsViewProps {
  bets: BetView[]
  groupBy: 'game' | 'week'    // 'game' (active) buckets parlays; 'week' sorts desc
  perspective?: 'player' | 'house'
  showSummary?: boolean        // game mode only
  hint?: string
  onBetPress?: (b: BetView) => void
  onParlayPress?: (b: BetView) => void
  onCancelBet?: (b: BetView) => void
}
```
Internally branch the grouping/summary on `groupBy`; everything else (rows, cards, labels,
empty state) is shared and should consume `<Card>`/`<EmptyStateCard>` from C1/C2.

**Sub-step (do as part of this merge — see guardrail #6):** `ActiveBetsView` and
`SettledBetsView` import betting helpers *from a modal* —
[ActiveBetsView.tsx:5](app/src/components/ActiveBetsView.tsx#L5) /
[SettledBetsView.tsx:5](app/src/components/SettledBetsView.tsx#L5) both do
`import { resultBadge, betReturnText } from './BetDetailModal'`, and
[PlayerPinsinoScreen.tsx:15](app/src/screens/PlayerPinsinoScreen.tsx#L15) imports the same
from the component. `BetDetailModal.tsx` is the only component that exports pure helpers — all
five: `resultBadge`, `betPayout`, `betReturn`, `betReturnDisplay`, `betReturnText`
([BetDetailModal.tsx:6-50](app/src/components/BetDetailModal.tsx#L6-L50)). Because L1 already
rewrites the Bets-view import lines, extract those five into a new
`app/src/utils/bet.ts` (alongside the existing `utils/pvp.ts` / `utils/bounty.ts`) and update
the three import sites — `BetsView`, `PlayerPinsinoScreen`, and `BetDetailModal` itself (which
imports them back). Doing it now avoids baking the modal coupling into the new `BetsView` and
touching these files twice. Cross-reference under M1 when migrating `BetDetailModal`.

**New file:** rename/replace into `app/src/components/BetsView.tsx`; delete the two old files
(or keep them as one-line wrappers during migration). Plus `app/src/utils/bet.ts` (extracted
betting helpers, per the sub-step above).

**Affected files / blast radius:** `SportsbookScreen` and `PinsinoSportsbookScreen` import
both views — update those two call sites to `<BetsView groupBy="game" showSummary/>` and
`<BetsView groupBy="week"/>`.

**Acceptance:** both screens render identically to today; `ActiveBetsView.tsx` /
`SettledBetsView.tsx` are gone (or thin shims); grouping, parlay bucketing, and the summary
card behave exactly as before; `app/src/utils/bet.ts` exists and **no component file exports
pure helpers** (`grep -rn "^export \(function\|const\)" app/src/components | grep -v "export
default"` returns nothing).

**Risk:** Medium — this one has branching logic, so verify both screens in-app. Land it
*after* C1/C2 so the shared shells already exist.

---

### S1 — `<SegmentedControl>` unifying `PillFilter` + `ToggleGroup` + `GamePicker`

**Problem:** Three selector controls share the active state and label typography and differ
only in layout:
- [PillFilter.tsx:38-57](app/src/components/PillFilter.tsx#L38-L57) — horizontal `ScrollView`,
  pill `borderRadius:20`.
- [ToggleGroup.tsx:41-54](app/src/components/ToggleGroup.tsx#L41-L54) — flex row
  `justifyContent:'space-around'`, `borderRadius:8`.
- [GamePicker.tsx:36-48](app/src/components/GamePicker.tsx#L36-L48) — flex row `flexWrap:'wrap'`,
  `borderRadius:8`, plus a `Game {n}` label formatter and an empty-state string.

The active treatment is identical in all three (`backgroundColor:colors.accentDim,
borderColor:colors.accent`; text `barlowCondensed, 13, colors.muted` → `colors.accent` when
active).

**Recommendation:** Create one `<SegmentedControl>`:
```ts
interface SegmentedControlProps<T extends string | number> {
  options: { key: T; label: string }[]
  value: T | null
  onChange: (key: T) => void
  scrollable?: boolean    // true → horizontal ScrollView (PillFilter)
  pill?: boolean          // true → borderRadius 20, else 8
  wrap?: boolean          // flexWrap for GamePicker
  emptyText?: string
}
```
Then make `GamePicker` a 5-line wrapper that maps `games` → `{key:n, label:`Game ${n}`}` and
delegates. Because `PillFilter` (11 screens) and `ToggleGroup` (7 screens) are widely used,
**keep the old names as thin wrappers** over `SegmentedControl` initially so no screen has to
change in the same PR; remove the wrappers later.

**New file:** `app/src/components/SegmentedControl.tsx` (→ `ui/`); `PillFilter`/`ToggleGroup`/
`GamePicker` become wrappers, then optionally removed.

**Affected files / blast radius:** 11 (`PillFilter`) + 7 (`ToggleGroup`) + 1 (`GamePicker`)
screens — but the wrapper approach means zero screen edits to land the core. See the
importer map for the full screen list.

**Acceptance:** `<SegmentedControl>` reproduces all three layouts; the three existing
components are wrappers delegating to it with no visual change on any of the 19 screens.

**Risk:** Low with the wrapper strategy (Medium if you rewrite all call sites at once — don't).

---

### A1 — `<AvatarCircle>` initials primitive (cleanup)

**Problem:** Two components reimplement an initials-circle avatar inline instead of reusing a
primitive: [PlayerScoreRow.tsx:56](app/src/components/PlayerScoreRow.tsx#L56) and
[HistoricalTeamBlock.tsx:26](app/src/components/HistoricalTeamBlock.tsx#L26) both render
`<Text>{initials(name)}</Text>` in a local circle, while
[MarketMoveCard.tsx:34](app/src/components/MarketMoveCard.tsx#L34) correctly uses
`<PlayerAvatar>`. `PlayerAvatar` fetches a signed URL from storage, which is overkill for
these two contexts that only ever want initials.

**Recommendation:** Either extract a lightweight `<AvatarCircle name size highlight?/>` (no
storage fetch, just the initials circle), or add an `initialsOnly` prop to
[PlayerAvatar.tsx](app/src/components/PlayerAvatar.tsx). Prefer the latter if it keeps one
avatar component.

**New file:** `app/src/components/AvatarCircle.tsx`, or extend `PlayerAvatar`.

**Affected files / blast radius:** `PlayerScoreRow`, `HistoricalTeamBlock`.

**Acceptance:** both render their initials via the shared primitive; the local `avatar`/
`avatarText` styles are removed; `PlayerScoreRow`'s champion highlight + `∅` fill marker are
preserved.

**Risk:** Low.

---

## Already well-consolidated — do NOT "fix"

These are correctly factored. Leave them alone unless a specific bug requires it.

- **`LineRow` + `LineRowContainer`** — already market-type-agnostic (moneyline and O/U both
  reuse them unchanged). See [context/betting-line-board.md](context/betting-line-board.md).
  `LineRow` *will* adopt `<ListRow>` (R1) for its container only; its content stays.
- **`LineDuelLines`** — small, purpose-specific PvP line display; reused by `PvPCreateScreen`,
  `PvpCounterModal`, `PvPChallengeDetailModal` with no duplication.
- **`PinsinoLeaderboardTable`** — single `mode`-driven table reused cleanly by two screens.
- **`AppHeader` vs `ScreenHeader`** — **different layers, do not merge.** `AppHeader` is the
  persistent app-chrome bar (logo, season/week, profile trigger; embeds `PlayerAvatar` +
  `ProfileMenuModal`). `ScreenHeader` is the per-screen back-button bar. They share no
  meaningful structure; merging would couple unrelated concerns.

---

## Optional — directory reorg + barrel index

> **Sequencing:** do this **after** the consolidation opportunities above land. The file
> moves are mechanical but touch every import; doing them mid-refactor creates needless merge
> churn.

Today `app/src/components/` is **flat** — 41 files, no `index.ts`, and every screen imports
via deep relative paths (`from '../components/<Name>'`). As the library grows, group by role
and add a barrel:

```
app/src/components/
  ui/        Button, TextField, Card, EmptyStateCard, ListRow, SegmentedControl,
             ModalSheet, ConfirmDialog, Toast, LoadingView, PlayerAvatar, AvatarCircle,
             PlayerBadges, AppHeader, ScreenHeader, ConfirmBar
  modals/    Admin*Modal, PlayerPickerModal, ProfileMenuModal
  betting/   BetRow, BetDetailModal, SettleBetModal, Active/SettledBetsView (→ BetsView),
             LineRow, LineRowContainer, OddsBlock, LineDuelLines
  pinsino/   LedgerRow, PinsinoLeaderboardTable, MarketMoveCard
  pvp/       Pvp*Modal, PvPChallengeDetailModal, PvpChallengeRow
  bounty/    Bounty*Modal, BountyCard
  index.ts   // re-export everything: `export { default as Button } from './ui/Button'` …
```

Then convert screen imports to the barrel (`import { Button, ModalSheet } from
'../components'`). This is independent of the consolidations and can be skipped or deferred
without affecting them.

**Affected files / blast radius:** every component file (moved) + every screen import.
Purely mechanical; verify the app still builds (`expo start`) after the move.

---

## Verification (for any change in this document)

1. `cd app && npx expo start` and exercise each touched screen — there is no test suite
   (`AGENTS.md` rule #6). Confirm no visual or interaction change.
2. For modal work, confirm the inside-Modal `<Toast/>` still renders above the sheet (the
   reason it's mounted there — [context/toast.md](context/toast.md)).
3. Re-grep for the eliminated duplication, e.g. after P3: `grep -rn "rgba(0,0,0" app/src/components`
   and `grep -rn "232,255,71" app/src`; after C1: that the `card` shell object is gone from
   the five files; after L1: `grep -rn "^export \(function\|const\)" app/src/components | grep
   -v "export default"` returns nothing (no component exports pure helpers — guardrail #6).
4. Keep each opportunity to its own PR; adopt shared primitives one consumer at a time.
