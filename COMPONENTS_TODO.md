# Components Consolidation — Execution TODO

> **Sister document to [COMPONENTS.md](COMPONENTS.md).** That file is the *audit* (why +
> what); this file is the *execution list* (atomic, ordered, checkable). Every task is tagged
> with the COMPONENTS.md section that defines its context — the task ID encodes it (`P1·2` →
> section P1) and each phase header links the section directly.
>
> **Read the linked COMPONENTS.md section before starting any task** — it carries the
> `file:line` evidence, the prop/API sketch, and the full acceptance criteria. This file does
> not repeat them; it sequences the work.

## How to use this list

- **Status:** `- [ ]` todo · `- [~]` in progress · `- [x]` done. Check boxes as you land work.
- **One task ≈ one focused, independently-verifiable change.** Most are a single PR; "create
  primitive" + each adoption are separate tasks so you never big-bang a 30-file swap.
- **Respect dependencies.** Each phase lists `Depends on:`. The two top-level tracks — the
  **Modal track** (P3→P1/P2→M1→M2) and the **List track** (R1, C1/C2→L1, S1, A1) — are
  independent and may proceed in parallel (per [COMPONENTS.md § Build order](COMPONENTS.md#build-order)).
- **Every task inherits the global rules** from [COMPONENTS.md § How to use](COMPONENTS.md#how-to-use-this-document):
  no behavior change (pixel-identical before/after), verify by running the app (`cd app &&
  npx expo start` — no test suite), shared styles read from `theme.ts`, helpers live in
  `utils/` not components.
- **`·V` tasks are verification gates** — do not check the phase done until its `·V` passes.

### Efficiency note (avoid double-touching files)

Button (P1) and TextField (P2) adoption *inside modals* overlaps with the M1 migration of
those same modals. Land **P1·1–P1·4** and **P2·1** (create + pilots) first to lock the APIs,
then fold the bulk modal adoption of `<Button>`/`<TextField>` **into the M1 migration of each
modal** rather than editing each modal twice. Tasks below flag this where it applies.

---

## Phase 0 — Theme foundation

**Section:** [COMPONENTS.md § P3](COMPONENTS.md#p3--theme-token-additions-do-first) · **Depends on:** nothing · **Track:** shared substrate (do first)

- [ ] **P3·1** — Add tokens to [app/src/theme.ts](app/src/theme.ts): `colors.overlay`
  (`'rgba(0,0,0,0.7)'`), a `spacing` scale (`xs/sm/md/lg/xl`), and (optional) the `text`
  preset map. _No consumers change in this task — just the token surface._
- [ ] **P3·2** — Replace the hardcoded modal backdrop literals with `colors.overlay` across
  all 17 modal files; unify [BetDetailModal.tsx:157](app/src/components/BetDetailModal.tsx#L157)
  (`rgba(0,0,0,0.5)` → `colors.overlay`) so the dim is consistent.
- [ ] **P3·3** — Replace the two `rgba(232,255,71,0.12)` literals in
  [OddsBlock.tsx:135](app/src/components/OddsBlock.tsx#L135) /
  [OddsBlock.tsx:179](app/src/components/OddsBlock.tsx#L179) with the existing `colors.accentDim`.
- [ ] **P3·4** _(optional)_ — Add a gold-tint token (e.g. `colors.goldDim`) and swap
  [ConfirmBar.tsx:56](app/src/components/ConfirmBar.tsx#L56) / [:83](app/src/components/ConfirmBar.tsx#L83)
  literals onto it. Lower priority; skip if not adding the token.
- [ ] **P3·5** _(ongoing, not a blocker)_ — Migrate magic spacing numbers to `spacing.*`
  **lazily**, only when a file is edited for another reason. Do not sweep all files.
- [ ] **P3·V** — Verify: `grep -rn "rgba(0,0,0" app/src/components` returns only
  `colors.overlay` (or nothing); `grep -rn "232,255,71" app/src` returns nothing; app boots
  with no visual change to any modal/odds surface.

---

## Phase 1 — Core primitives

### `<Button>`

**Section:** [COMPONENTS.md § P1](COMPONENTS.md#p1--button-primitive-highest-impact-gap) · **Depends on:** P3 · **Track:** Modal track (substrate)

- [ ] **P1·1** — Create [app/src/components/Button.tsx](app/src/components/Button.tsx) with
  `variant` (`primary|secondary|ghost|danger|gold`), `size`, `loading`, `disabled`,
  `fullWidth`. Loading renders `ActivityIndicator color={colors.bg}`; disabled applies
  `opacity:0.4` and blocks `onPress`.
- [ ] **P1·2** — Pilot adopt in [AdminArchiveModal.tsx](app/src/components/AdminArchiveModal.tsx)
  (primary + secondary); delete its local `btn*` styles. Validates the API.
- [ ] **P1·3** — Pilot adopt in [BorrowConfirmModal.tsx](app/src/components/BorrowConfirmModal.tsx)
  (`confirmBtn` → primary; cancel link → ghost/secondary).
- [ ] **P1·4** — Pilot adopt in [BountyEntryModal.tsx](app/src/components/BountyEntryModal.tsx).
- [ ] **P1·5** — Adopt `gold`/`danger` variants where they exist:
  [ConfirmBar.tsx](app/src/components/ConfirmBar.tsx) save (`gold`) + discard, and the cancel
  (`✕`) destructive chips in row/bet components (`danger`).
- [ ] **P1·6** — Fan out to remaining **modal** action buttons. _Prefer folding this into each
  modal's M1 migration (see efficiency note) rather than a standalone pass._ Clusters:
  Admin\* (Edit/End/Open/Generate), Bounty\* (Admin/HouseCreate), Pvp\* (Accept/Admin/Counter/Detail),
  Bet (Settle/Detail).
- [ ] **P1·7** — Fan out to **screen** inline buttons (e.g. `BountyCreateScreen`, LoanShark
  screens). One screen-cluster per PR.
- [ ] **P1·V** — Verify: pilots render identically with working loading/disabled states;
  migrated files declare no local button styles; app boots.

### `<TextField>` / `<Input>`

**Section:** [COMPONENTS.md § P2](COMPONENTS.md#p2--textfield--input-primitive) · **Depends on:** P3 · **Track:** Modal track (substrate)

- [ ] **P2·1** — Create [app/src/components/TextField.tsx](app/src/components/TextField.tsx)
  wrapping `TextInput` with optional `label`, `error`, and a `numeric` mode that owns
  digit sanitization + `keyboardType`.
- [ ] **P2·2** — Adopt in the numeric-stake modals first (highest shared logic):
  [SettleBetModal](app/src/components/SettleBetModal.tsx),
  [PvpCounterModal](app/src/components/PvpCounterModal.tsx),
  [BountyHouseCreateModal](app/src/components/BountyHouseCreateModal.tsx). Delete their local
  input styles + ad-hoc sanitize helpers.
- [ ] **P2·3** — Adopt in remaining input modals (`AdminEditSeasonModal`,
  `AdminOpenRegistrationModal`, `BountyAdminActionModal`, `PvpAdminActionModal`,
  `PlayerPickerModal` search). _Fold into M1 migration where possible._
- [ ] **P2·4** — Adopt in [PlayerScoreRow.tsx](app/src/components/PlayerScoreRow.tsx) score
  entry.
- [ ] **P2·V** — Verify: the three numeric modals accept/sanitize input identically; no local
  input styles remain in migrated files.

---

## Phase 2 — Modals

### `<ModalSheet>` base

**Section:** [COMPONENTS.md § M1](COMPONENTS.md#m1--modalsheet-base) · **Depends on:** P3, P1, P2 · **Track:** Modal track

- [ ] **M1·1** — Create [app/src/components/ModalSheet.tsx](app/src/components/ModalSheet.tsx):
  RN `<Modal>` wrapper, backdrop (`colors.overlay`), **both** variants (`center` /
  `sheet` with the iOS `paddingBottom` inset), title/subtitle/`✕` header, `scrollable`
  keyboard-aware body, `dismissable`, `footer` slot, and the **single `<Toast/>` mounted
  inside** the Modal.
- [ ] **M1·2** — Migrate one pilot confirm modal end-to-end
  ([AdminArchiveModal](app/src/components/AdminArchiveModal.tsx)). **Verify in-app that the
  inside-Modal Toast still renders above the sheet** and keyboard behavior is unchanged before
  proceeding.
- [ ] **M1·3** — Migrate remaining confirm modals: `BorrowConfirmModal` (sheet variant),
  `BountyEntryModal`, `PvpAcceptModal`.
- [ ] **M1·4** — Migrate Admin form modals: `AdminEditSeasonModal`, `AdminEndSeasonModal`,
  `AdminOpenRegistrationModal`, `AdminGenerateTeamsModal` (largest — do last in this cluster).
  Adopt `<Button>`/`<TextField>` here too (efficiency note).
- [ ] **M1·5** — Migrate Bounty/Pvp form modals: `BountyAdminActionModal`,
  `BountyHouseCreateModal`, `PvpAdminActionModal`, `PvpCounterModal`.
- [ ] **M1·6** — Migrate select modals: `PlayerPickerModal`, `ProfileMenuModal`.
- [ ] **M1·7** — Migrate the two detail modals **last**: `PvPChallengeDetailModal`,
  `BetDetailModal`. When touching `BetDetailModal`, also do the helper extraction
  (→ `utils/bet.ts`) **if L1·2 hasn't already** — see guardrail #6.
- [ ] **M1·V** — Verify: both variants pixel-match originals; `backdrop`/`sheet`/`title`
  styles exist only in `ModalSheet`; Toast + keyboard handling centralized; every migrated
  screen exercised in-app.

### `<ConfirmDialog>`

**Section:** [COMPONENTS.md § M2](COMPONENTS.md#m2--confirmdialog-built-on-m1--p1) · **Depends on:** M1, P1 · **Track:** Modal track

- [ ] **M2·1** — Create [app/src/components/ConfirmDialog.tsx](app/src/components/ConfirmDialog.tsx)
  as a thin composition over `ModalSheet` + `Button` (`title`, `description`/`children`,
  `confirmLabel`, `onConfirm`, `loading`, `destructive`).
- [ ] **M2·2** — Refactor `AdminArchiveModal` → `ConfirmDialog` (target ~45 lines).
- [ ] **M2·3** — Refactor `BountyEntryModal` and `PvpAcceptModal` → `ConfirmDialog`.
- [ ] **M2·4** — Refactor `BorrowConfirmModal` → `ConfirmDialog`, passing its stat grid as
  `children` (keep the grid, collapse only the confirm/cancel footer).
- [ ] **M2·V** — Verify: all four confirm flows behave identically; the bespoke confirm/cancel
  footers are gone.

---

## Phase 3 — Rows / Cards / Lists  *(parallel track — independent of Phase 1–2)*

### `<ListRow>`

**Section:** [COMPONENTS.md § R1](COMPONENTS.md#r1--listrow-primitive) · **Depends on:** nothing · **Track:** List track

- [ ] **R1·1** — Create [app/src/components/ListRow.tsx](app/src/components/ListRow.tsx):
  `leading` / `middle` (flex:1) / `trailing` slots, `isLast` border gating, `density`
  (`normal` / `compact`=`paddingVertical:8`), and the pressable-vs-static branch.
- [ ] **R1·2** — Adopt in [BetRow.tsx](app/src/components/BetRow.tsx); keep its content
  (`betSubject`/badge/return), drop the container + `lineRowBorder` + press branch.
- [ ] **R1·3** — Adopt in [LedgerRow.tsx](app/src/components/LedgerRow.tsx) (`space-between`
  trailing).
- [ ] **R1·4** — Adopt in [PlayerScoreRow.tsx](app/src/components/PlayerScoreRow.tsx)
  (`density="compact"`).
- [ ] **R1·5** _(optional)_ — Adopt the container only in
  [LineRow.tsx](app/src/components/LineRow.tsx); leave its market content untouched (it's in
  the "do not fix" list for content).
- [ ] **R1·V** — Verify: rows render identically across Sportsbook / Pinsino accounting /
  Matchups; no row file declares its own container/`*Border` style.

### `<Card>` + `<EmptyStateCard>`

**Sections:** [COMPONENTS.md § C1](COMPONENTS.md#c1--card-shell) · [COMPONENTS.md § C2](COMPONENTS.md#c2--emptystatecard-fold-into-c1) · **Depends on:** nothing · **Track:** List track

- [ ] **C1·1** — Create [app/src/components/Card.tsx](app/src/components/Card.tsx) (`padding`
  default 14, `marginBottom` default 10, `overflow`, optional `onPress`).
- [ ] **C2·1** — Create [app/src/components/EmptyStateCard.tsx](app/src/components/EmptyStateCard.tsx)
  on top of `<Card>` (centered, muted message). _Bundle with C1·1._
- [ ] **C1·2** — Adopt `<Card>` in `BountyCard`, `MarketMoveCard`, `PvpChallengeRow`; delete
  the three byte-identical local `card` shells.
- [ ] **C1·3** — Adopt the `padding={0} overflow="hidden"` section variant in
  `ActiveBetsView` / `SettledBetsView` (the list-clipping card).
- [ ] **C2·2** — Replace the duplicated empty-state cards in both Bets views with
  `<EmptyStateCard>`.
- [ ] **C·V** — Verify: all five card surfaces + both empty states render identically; the
  five `card` objects and two `emptyCard`/`emptyText` objects are deleted.

### Merge `ActiveBetsView` + `SettledBetsView` → `<BetsView>`

**Section:** [COMPONENTS.md § L1](COMPONENTS.md#l1--merge-activebetsview--settledbetsview--betsview-groupby) · **Depends on:** C1, C2 · **Track:** List track

- [ ] **L1·1** — Create [app/src/components/BetsView.tsx](app/src/components/BetsView.tsx):
  `groupBy:'game'|'week'` (game buckets parlays + sorts asc; week sorts desc), `showSummary`
  (game only), shared rows/labels consuming `<Card>` / `<EmptyStateCard>`.
- [ ] **L1·2** — **Sub-step (guardrail #6):** extract `resultBadge`, `betPayout`, `betReturn`,
  `betReturnDisplay`, `betReturnText` from
  [BetDetailModal.tsx:6-50](app/src/components/BetDetailModal.tsx#L6-L50) into a new
  `app/src/utils/bet.ts`; update the 3 import sites (`BetsView`,
  [PlayerPinsinoScreen.tsx:15](app/src/screens/PlayerPinsinoScreen.tsx#L15), and
  `BetDetailModal` itself importing them back).
- [ ] **L1·3** — Swap the two call sites: `SportsbookScreen` (`groupBy="game" showSummary`) and
  `PinsinoSportsbookScreen` (`groupBy="week"`), passing the existing perspective/handlers.
- [ ] **L1·4** — Delete `ActiveBetsView.tsx` / `SettledBetsView.tsx` (or leave one-line shims
  during a transition, then remove).
- [ ] **L1·V** — Verify: both Sportsbook screens render identically (grouping, parlay
  bucketing, summary card); `app/src/utils/bet.ts` exists; `grep -rn "^export \(function\|const\)"
  app/src/components | grep -v "export default"` returns nothing.

---

## Phase 4 — Selectors

### `<SegmentedControl>`

**Section:** [COMPONENTS.md § S1](COMPONENTS.md#s1--segmentedcontrol-unifying-pillfilter--togglegroup--gamepicker) · **Depends on:** nothing · **Track:** List track

- [ ] **S1·1** — Create [app/src/components/SegmentedControl.tsx](app/src/components/SegmentedControl.tsx)
  with `options`, `value`, `onChange`, `scrollable`, `pill` (radius 20 vs 8), `wrap`,
  `emptyText`.
- [ ] **S1·2** — Reimplement [PillFilter.tsx](app/src/components/PillFilter.tsx) as a thin
  wrapper (`scrollable pill`) over `SegmentedControl` — **no screen edits** (11 screens keep
  importing `PillFilter`).
- [ ] **S1·3** — Reimplement [ToggleGroup.tsx](app/src/components/ToggleGroup.tsx) as a wrapper
  (default radius 8, `space-around`).
- [ ] **S1·4** — Reimplement [GamePicker.tsx](app/src/components/GamePicker.tsx) as a wrapper
  that maps each game number to an option labelled "Game N", with `wrap` and `emptyText` set.
- [ ] **S1·5** _(optional, later)_ — Migrate screen call sites directly onto
  `SegmentedControl` and remove the three wrappers.
- [ ] **S1·V** — Verify: spot-check one screen each for PillFilter / ToggleGroup / GamePicker —
  no visual change across the 19 consuming screens.

---

## Phase 5 — Avatar cleanup

**Section:** [COMPONENTS.md § A1](COMPONENTS.md#a1--avatarcircle-initials-primitive-cleanup) · **Depends on:** nothing · **Track:** List track

- [ ] **A1·1** — Add an `initialsOnly` mode to
  [PlayerAvatar.tsx](app/src/components/PlayerAvatar.tsx) (preferred — one avatar component),
  or create a lightweight `AvatarCircle.tsx` that skips the storage fetch.
- [ ] **A1·2** — Adopt in [PlayerScoreRow.tsx:56](app/src/components/PlayerScoreRow.tsx#L56);
  preserve the champion highlight + `∅` fill marker; drop local `avatar`/`avatarText` styles.
- [ ] **A1·3** — Adopt in [HistoricalTeamBlock.tsx:26](app/src/components/HistoricalTeamBlock.tsx#L26).
- [ ] **A1·V** — Verify: both render identical initials circles; Matchups champion treatment
  intact.

---

## Phase 6 — Directory reorg + barrel  *(optional; do LAST)*

**Section:** [COMPONENTS.md § Optional](COMPONENTS.md#optional--directory-reorg--barrel-index) · **Depends on:** all consolidation phases landed · **Track:** both

> Mechanical but touches every import — only after the above to avoid merge churn.

- [ ] **RO·1** — Create subfolders (`ui/`, `modals/`, `betting/`, `pinsino/`, `pvp/`,
  `bounty/`) and move each component file per the map in COMPONENTS.md.
- [ ] **RO·2** — Add `app/src/components/index.ts` re-exporting everything.
- [ ] **RO·3** — Convert screen imports to the barrel (`import { Button, ModalSheet } from
  '../components'`).
- [ ] **RO·V** — Verify: `npx expo start` builds clean; no dangling deep import paths remain.

---

## Progress tracker

Tick a row when **every** `·V` gate in that phase passes.

| Phase | Section(s) | Track | Status |
|---|---|---|---|
| 0 · Theme tokens | P3 | shared | ☐ |
| 1 · Button | P1 | modal | ☐ |
| 1 · TextField | P2 | modal | ☐ |
| 2 · ModalSheet | M1 | modal | ☐ |
| 2 · ConfirmDialog | M2 | modal | ☐ |
| 3 · ListRow | R1 | list | ☐ |
| 3 · Card / EmptyStateCard | C1, C2 | list | ☐ |
| 3 · BetsView merge | L1 | list | ☐ |
| 4 · SegmentedControl | S1 | list | ☐ |
| 5 · Avatar cleanup | A1 | list | ☐ |
| 6 · Reorg + barrel | Optional | both | ☐ |
