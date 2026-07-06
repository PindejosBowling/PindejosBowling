# REFACTOR_TODO.md — execution checklist

Agent-executable checklist for the refactors specified in [REFACTOR.md](REFACTOR.md). **Context lives in
REFACTOR.md; progress lives here.** This file deliberately omits the *why* — each task links back to its
REFACTOR.md section (e.g. `↪ §1.1`) for evidence and justification. Keep it that way: don't paste
rationale here, and don't track progress in REFACTOR.md.

## How an agent should use this file

1. **Pick the lowest-numbered unchecked task whose dependencies are met.** Tiers are ordered by safety;
   within a tier, top-to-bottom.
2. **Trust the `Verify` line over the checkbox.** Checkboxes can go stale across sessions. Each task's
   `Verify` is a runnable command whose output tells you the *actual* state — run it before starting (is
   it already done?) and after finishing (is it really done?). If a checkbox and its `Verify` disagree,
   fix the checkbox. Baseline counts (`was: N`) are the values at audit time, so any movement is progress.
3. **Tick sub-steps as you go** so partial progress is visible. Mark a task `- [x]` only when `Verify`
   passes. Use `- [~]` for "started, not done".
4. **One task per PR.** There is **no app-layer test suite** — verify each change by running the Expo dev
   server (`cd app && expo start`) and exercising the affected screen. Note it under `Manual check`.
5. **Respect the hard constraints** in [`AGENTS.md`](AGENTS.md): all data access stays in
   `src/utils/supabase/db.ts`; compute functions stay pure + `useMemo`'d; no direct DB writes.

**Status legend:** `- [ ]` not started · `- [~]` in progress · `- [x]` done & verified.

> Run `Verify` lines from the **repo root**. They use `grep -rn … | wc -l`; on this tree `rg -c` works too.

## Progress at a glance

Re-derive this table from the `Verify` commands if in doubt — do not trust it blindly.

| Tier | Task | Status |
|---|---|---|
| 1 | 1.1 `utils/formatting.ts` | [x] |
| 1 | 1.2 `<BalancePill>` | [x] |
| 1 | 1.3 `computeBalance` / `utils/ledger.ts` | [x] |
| 1 | 1.4 theme tint/shadow tokens | [x] |
| 1 | 1.5 `useDatePicker` | [x] |
| 1 | 1.6 doc-rot (`references/` path) | [x] |
| 2 | 2.1 `<EconomyCard>` | [x] |
| 2 | 2.2 `<StatRow>` | [x] |
| 2 | 2.3 `<PinAmountInput>` | [x] |
| 2 | 2.4 shared admin-modal styles | [x] |
| 2 | 2.5 `<ScreenContainer>` | [x] |
| 3 | 3.1 `useAsyncData` | [x] |
| 3 | 3.2 `useEconomyRefresh` + `bounty` source | [~] |
| 3 | 3.3 migrate `visible`-prop admin modals | [ ] |
| 3 | 3.4 `db.ts` embed/filter helpers | [ ] |
| 3 | 3.5 compute-in-hooks | [ ] |
| 3 | 3.6 detail-surface convention | [ ] |
| 3 | 3.7 type-safety pass (optional) | [ ] |
| 3 | 3.8 validators (optional) | [ ] |

_Baseline: none started — every task below was identified by the audit; no refactor work has landed yet._

---

## Tier 1 — Quick wins

### 1.1 — Centralize formatting → `utils/formatting.ts`  ↪ §1.1
- [ ] Create `app/src/utils/formatting.ts` with `formatPins(n, { signed })`, `formatCountdown(iso, now)`, `formatCloseTime(iso)`.
- [ ] Move `signed` (from `utils/bets.ts`), `formatStakes`/`formatHandicap` (`utils/pvp.ts`), `formatCloseTime` (`utils/bounty.ts`), `formatTimeRemaining`/`formatCountdown` (`utils/auction.ts`) into it; **re-export from the old modules** for back-compat.
- [ ] Replace inline `.toLocaleString()` pin rendering in components/screens with `formatPins`.
- **Depends on:** none. **Unblocks:** 1.2, 2.1.
- **Verify:** `test -f app/src/utils/formatting.ts && grep -rn "toLocaleString" app/src/components app/src/screens | wc -l` → trends to ~0 _(was: 96 across 27 files)_.
- **Manual check:** open Bounties/Auction/PvP screens; amounts and countdowns render identically.

### 1.2 — `<BalancePill>` component  ↪ §1.2
- [x] Create `app/src/components/ui/BalancePill.tsx` (`balance: number`, optional `label`/`style`), using `formatPins` from 1.1.
- [x] Replace the inline pill + `balancePill*` styles in the 5 screens with `<BalancePill balance={…} />`.
- **Depends on:** 1.1.
- **Verify:** `grep -rln "balancePill" app/src/screens | wc -l` → `0` _(was: 5: BountyBoard, AuctionHouse, PvP, LoanShark, BountyCreate)_.

### 1.3 — `computeBalance(ledger)` → `utils/ledger.ts`  ↪ §1.3
- [x] Create `app/src/utils/ledger.ts` exporting `computeBalance(rows)` (and `computeDebt` if useful).
- [x] Replace `reduce((sum, e) => sum + e.amount, 0)` in the 9 hooks with `computeBalance(...)`. _(Actual scope was 8 hooks + the loan-debt reduce in `useLoanSharkData` → `computeDebt`; the audit's 9th hook, `useWeekEditor`, sums team scores, not ledger amounts — left as-is.)_
- **Depends on:** none. **Unblocks:** cleaner hooks for 3.1.
- **Verify:** `grep -rln "reduce((sum, e) => sum + e.amount" app/src/hooks | wc -l` → `0` _(was: 9 hooks)_.

### 1.4 — Theme tint/shadow tokens  ↪ §1.4
- [x] Add `successTint`, `dangerTint`, `shadow` to `app/src/theme.ts` (gold tints already exist — leave them). _(Also added `successDim`/`dangerDim` at 0.12, mirroring `goldDim`/`goldTint`.)_
- [x] Replace inline `rgba(74,222,128,…)` / `rgba(239,68,68,…)` / `rgba(255,79,109,…)` / `shadowColor: '#000'` with the tokens (`LineRow`, `BorrowConfirmModal`, `ConfirmBar`, `Dropdown`, `Toast`). _(ConfirmBar's rgba values are gold borders at bespoke alphas — out of scope. **Screens** still have ~17 success/danger rgba literals at bespoke alphas (RsvpScreen, LanetalkImportAdminScreen, MatchupsScreen, …) — adopt tokens opportunistically; note `rgba(239,68,68,…)` sites were red-500, now consolidated to theme danger where converted.)_
- **Verify:** `grep -n "successTint\|dangerTint" app/src/theme.ts` is non-empty **and** `grep -rn "rgba(74,222,128\|rgba(239,68,68\|shadowColor: '#000'" app/src/components | wc -l` → `0`.

### 1.5 — `useDatePicker(initial)` hook  ↪ §1.5
- [x] Create `app/src/hooks/useDatePicker.ts` returning `{ value, open, setOpen, onChange }` with the Android-dismiss handling.
- [x] Adopt it in `BountyCreateScreen`, `BountyHouseCreateModal`, `AuctionCreateModal`. _(Auction uses two instances — one per date — with toggles closing the other, replacing the `pickerFor` multiplex. Three more `DateTimePicker` sites exist (`EditableWeek`, `AdminOpenRegistrationModal`, `AdminEditSeasonModal`) with multi-picker/nullable-date shapes — adopt opportunistically, e.g. alongside 3.3.)_
- **Verify:** `grep -rln "useDatePicker" app/src | wc -l` → `≥4` (hook + 3 callers).

### 1.6 — Doc-rot: stale `references/` path  ↪ §1.6
- [x] Fix the `references/notifications.md` comment in `app/src/utils/notifications.ts` → `context/notifications.md`.
- [x] Grep the tree for other stale `references/` mentions and fix any.
- **Verify:** `grep -rn "references/" app/src | wc -l` → `0`.

---

## Tier 2 — Shared UI primitives

### 2.1 — `<EconomyCard>` wrapper  ↪ §2.1
- [x] Create `app/src/components/ui/EconomyCard.tsx` taking `{ title, subtitle?, badge?, stats: StatCell[], footer?, onPress }`.
- [x] Refactor `BountyCard`, `AuctionCard`, `PvpChallengeRow`, `MarketMoveCard` to render it (feature-specific bits as `footer`/children). _(PvP title/subtitle standardize to the shared 17pt/12pt skeleton — was 16pt/13pt; MarketMoveCard uses the shell only.)_
- **Depends on:** 1.1 (for stat formatting). **Pairs with:** 2.2.
- **Verify:** `grep -rln "EconomyCard" app/src/components/{bounty,auction,pvp,economy} | wc -l` → `≥4`.
- **Manual check:** all four lists look unchanged.

### 2.2 — `<StatRow>` / KV primitive  ↪ §2.2
- [x] Create `app/src/components/ui/StatRow.tsx` (`label`, `value`, `variant?`).
- [x] Adopt in `BorrowConfirmModal`, `BountyAdminActionModal`, `PvpAcceptModal` (and inside `EconomyCard` stat cells if natural). _(Not natural — EconomyCard's stat cells are vertical value-over-label; StatRow is the horizontal KV pair. Bounty admin kv rows standardize to the shared 14pt/16pt row.)_
- **Verify:** `grep -rln "StatRow" app/src/components | wc -l` → `≥4`.

### 2.3 — `<PinAmountInput>` component  ↪ §2.3
- [x] Create `app/src/components/ui/PinAmountInput.tsx` owning the `replace(/[^0-9]/g, '')` filter + shared input styling.
- [x] Adopt across the 10 amount-entry sites. _(Actual scope was 19 sites in 11 files — typography tiers preserved as `form`/`stake`/`wager`/`big` variants; `allowDecimal` covers SettleBetModal's prop-line decimals. Only the component itself contains the filter now.)_
- **Verify:** `grep -rln "replace(/\[\^0-9\]/g" app/src/components app/src/screens | wc -l` → `≤1` _(was: 10 files)_.

### 2.4 — Shared admin-modal styles  ↪ §2.4
- [x] Extract the duplicated `section` / `label` / `input` style objects (export from `theme.ts` or a `<SectionLabel>` + the 2.3 input). _(Went with `sheetStyles` exported from `theme.ts` — the reasoning inputs are multiline text, not numeric, so the 2.3 component didn't apply. Also includes `actSpacing`. Standardized drift: input `minHeight` 70/56 → 64; bounty's label gains the shared `marginTop: 12`.)_
- [x] Remove the local copies from `BountyAdminActionModal`, `PvpAdminActionModal`, `AuctionAdminActionModal`.
- **Depends on:** 2.3 (input). **Verify:** the three files no longer each declare their own `section`/`label`/`input` StyleSheet entries.

### 2.5 — `<ScreenContainer>` scaffold  ↪ §2.5
- [x] Create `app/src/components/ui/ScreenContainer.tsx` wrapping `SafeAreaView` + `ScreenHeader` + `ScrollView` + `RefreshControl` (+ optional pixel-art backdrop), using `useRefresh`. _(Also grew `pinned` (fixed filter row between header and scroll) and `overlay` (absolutely-positioned siblings outside the scroll — `<Toast />`, `ConfirmBar`) slots, plus `scroll={false}` for FlatList screens and a `loading` prop reproducing both LoadingView variants.)_
- [x] Migrate inner stack screens incrementally (one PR each); tick this when the bulk (~30) are converted. _(24 screens converted in one sweep — every screen matching the fixed-header shell. The ~13 remaining `SafeAreaView` files are structurally different, not backlog: 9 mount `ScreenHeader` inside the ScrollView so it scrolls away (AdminSportsbook, Archives, FrameStats, LoanShark, PinsinoAdmin/Accounting/Leaderboard, PlayerDetail, PlayerPinsino — converting changes behavior; decide fixed-vs-scrolling header first), plus Sportsbook (scroll-length backdrop per pixelart/config.ts), PlayerManagement/TrashBoard (KeyboardAvoidingView shells), ProfilePictures (inline header-visible loading), and the tab roots. Accepted deviations: RefreshControl tint standardized to `colors.muted` (was `colors.accent` on 4 screens); admin-gate/not-found `EmptyCard`s now sit inside the padded scroll; PinsinoHelp gains the ArtworkToggle + reveal-hiding it previously lacked.)_
- **Verify:** `grep -rln "ScreenContainer" app/src/screens | wc -l` rising toward ~30 _(now: 24)_, while `grep -rln "SafeAreaView" app/src/screens | wc -l` falls _(42 → 18)_.
- **Manual check:** each migrated screen — safe-area insets, header, and pull-to-refresh unchanged.

---

## Tier 3 — Pattern standardization & data-layer hardening

### 3.1 — Generic `useAsyncData<T>` lifecycle  ↪ §3.1
- [x] Create `app/src/hooks/useAsyncData.ts` → `{ loading, data, error, reload }` with the `loadedOnce` soft-load gate built in (complements, doesn't replace, `useRefresh`). _(Pattern: hooks define a `Payload` type + `EMPTY` constant, the fetcher returns the payload, and the hook spreads `{ loading, ...(data ?? EMPTY), reload }` — see `useBountyBoardData` for the template. Third arg is the error-log label.)_
- [x] Migrate the ~21 `use*Data` hooks **incrementally** (a few per PR), starting with `useBountyBoardData` (the canonical shape). _(All 22 standard hooks migrated across two batches. **One deliberate exception:** `useMarketMovesData` does NOT fit — filter-parameterized reload + cursor pagination appending to state; leave it hand-rolled or extend `useAsyncData` first. Accepted standardizations: hooks without a `loadedOnce` ref previously hard-loaded (spinner on every reload) — all reloads are now silent soft-loads (incl. playoff-draft realtime refetches, where the spinner-flash was a bug); mid-load partial state flushes (`usePinsinoData`, `useHousePinsinoData`) now land atomically; errors keep stale data + log under the hook's name and three auction hooks that previously had no catch now get it.)_
- **Depends on:** 1.3 helps. **Verify:** `grep -rln "loadedOnce" app/src/hooks | wc -l` → `2` = `useAsyncData.ts` itself + `useMarketMovesData` _(was: 6 legacy)_ **and** `grep -rn "useEffect(() => { load() }" app/src/hooks | wc -l` → `1` = `useAsyncData.ts` itself _(was: 21 hand-rolled)_.

### 3.2 — `useEconomyRefresh` + `bounty` notification source  ↪ §3.2
- [ ] Create `app/src/hooks/useEconomyRefresh.ts` (`Promise.all([reload(), notificationStore.refresh()])`).
- [ ] Use it in `BountyBoardScreen`, `AuctionHouseScreen`, `LoanSharkScreen` (PvP/Pinsino already refresh).
- [x] Add a `bounty` entry to `NOTIFICATION_SOURCES` in `app/src/utils/notifications.ts` (open bounties with slots the player hasn't joined). _(landed independently of this checklist — verified 2026-07-06)_
- **Verify:** `grep -n "key: 'bounty'" app/src/utils/notifications.ts` is non-empty **and** `grep -rln "useEconomyRefresh" app/src/screens | wc -l` → `≥3`.
- **Manual check:** join a bounty / place a bid → the tab badge updates without re-focusing.

### 3.3 — Migrate `visible`-prop admin modals to the sheet standard  ↪ §3.3
- [ ] Move the confirm-style admin modals to `ConfirmActionSheet` (conditional mount; it renders `<Toast />` itself); move form-heavy ones (`AdminGenerateTeamsModal`) to `BottomSheet`.
- [ ] Delete the hand-rolled `<Toast />` from those modals (per-**screen** Toast stays — it's by design).
- **Targets (6):** `AdminArchiveModal`, `AdminEndSeasonModal`, `AdminEditSeasonModal`, `AdminGenerateTeamsModal`, `AdminOpenRegistrationModal`, `LanetalkConfirmModal`.
- **Verify:** `grep -rln "visible" app/src/components/admin | wc -l` → `0` _(was: 6)_ **and** `grep -rln "<Toast" app/src/components/admin | wc -l` → `0`.

### 3.4 — `db.ts` embed/filter helpers  ↪ §3.4
- [ ] Add `WITH_PLAYER_NAME = 'players(name)'`, `DESC = { ascending: false }`, and an `archivedScores(q)` chain helper near the existing graph constants in `app/src/utils/supabase/db.ts`.
- [ ] Replace the inline occurrences.
- **Verify:** `grep -c "players(name)" app/src/utils/supabase/db.ts` → drops toward ~1 _(was: 21)_ and `grep -c "created_at', { ascending: false }" app/src/utils/supabase/db.ts` → drops toward ~1 _(was: 15)_.

### 3.5 — Push compute into hooks  ↪ §3.5
- [ ] In `useStandingsData`, compute inside a `useMemo` and return `standingsRows` instead of `rawScores`/`rawSchedule`; update the screen to consume it. Repeat for `usePlayoffDraftData`.
- **Verify:** `grep -n "rawScores\|rawSchedule" app/src/hooks/useStandingsData.ts | wc -l` → `0`.

### 3.6 — Detail-surface convention (decision)  ↪ §3.6
- [ ] **Decide** modal vs. pushed-screen for feature detail views (REFACTOR.md leans toward screens).
- [ ] Record the decision in the appropriate `app/context/*.md` (e.g. `ui-system.md` / `patterns.md`).
- [ ] Migrate `BetDetailModal` / `PvpChallengeDetailModal` opportunistically when next touched.
- **Verify:** the convention is written down in a `context/` file; this task is a direction-setter, not a mechanical sweep.

### 3.7 — Type-safety pass (optional)  ↪ §3.7
- [ ] Type normalizer inputs from `database.types.ts` (e.g. `normalizeBounty(row: Tables<'bounty_posts'> & { sponsor: … })`); reduce `row: any` / `c: any`.
- **Verify:** `grep -rn "row: any" app/src/hooks | wc -l` trends down; build (`cd app && npx tsc --noEmit`) stays green.

### 3.8 — Validators (optional, lowest payoff)  ↪ §3.8
- [ ] If pursued: `app/src/utils/validators.ts` with `validateBounty(...)`, `validateAuction(...)`; adopt in the create flows.
- **Verify:** `test -f app/src/utils/validators.ts`.
