# REFACTOR.md — `app/` consolidation & tech-debt audit

> Scope: the React Native / Expo client under [`app/`](app/). Backend, migrations, and RPCs are out of
> scope except where the app duplicates logic that already lives server-side.

## Summary

The `app/` codebase grew feature-by-feature, and it shows most clearly in the **pin-economy stack** —
betting → loans → PvP → bounties → silent auctions → activity feed → LaneTalk stat bets were each built
in a separate pass. The good news: the **data layer is genuinely solid** and consistent. The debt is
concentrated in two places:

1. **Copy-paste at the UI and formatting layers** — the same card, the same balance pill, the same
   amount-input, the same `.toLocaleString()`, the same loading-hook skeleton, re-typed per feature.
2. **A handful of older features that never got brought in line** with a better pattern a later feature
   introduced (modal vs. screen detail surfaces; the `visible`-prop modal vs. the conditional-mount
   `BottomSheet`; badge-refresh-after-mutation done in some screens but not others).

None of this is an architectural emergency — it's accumulated duplication that taxes every new feature,
because new code copies the nearest local example instead of a shared primitive. Consolidating it makes
the next economy feature cheaper and keeps the look-and-feel from drifting.

### How to read this document

Findings are grouped into three tiers by **blast radius**, not importance:

- **Tier 1 — Quick wins.** Isolated, mechanical, high-confidence. Do these first.
- **Tier 2 — Shared UI primitives.** New reusable components; medium effort, mostly visual.
- **Tier 3 — Pattern standardization & data-layer hardening.** Wider blast radius / behavioral; land
  incrementally.

Each finding uses a fixed template: **What · Evidence · Why it matters · Proposed consolidation ·
Effort / Confidence / Risk.** Counts were verified by grep against the tree at the time of writing.

> ⚠️ **Constraints any executor must respect** (from [`AGENTS.md`](AGENTS.md)): all data access stays in
> `src/utils/supabase/db.ts` (no ad-hoc client joins); compute functions stay pure and `useMemo`'d at
> the screen level; the app has **no test suite** — verification is the Expo dev server, so wide changes
> must land in small, screen-by-screen PRs.

---

## What's already healthy (do not "fix" these)

A balanced audit names what's working, so effort isn't wasted re-litigating it:

- **One data layer.** Every query goes through typed objects in
  [`src/utils/supabase/db.ts`](app/src/utils/supabase/db.ts). No raw client joins scattered in screens.
- **A consistent hook template.** ~21 of the 22 `use*Data` hooks follow the same shape — that
  consistency is *why* the consolidation in Tier 3 is feasible.
- **`seasons.getCurrent()` is used everywhere** (~32 call sites) — the documented "current season ≠
  highest number" pitfall (`is_active=true AND registration_open=false`) is correctly avoided; no
  `getLatest()` misuse found.
- **Clean Zustand stores.** Five single-responsibility stores (`authStore`, `uiStore`,
  `notificationStore`, `pendingStore`, `avatarStore`) with no server-state duplicated into client state.
- **Realtime is contained** to [`useWeekClock`](app/src/hooks/useWeekClock.ts) and
  [`usePlayoffDraftData`](app/src/hooks/usePlayoffDraftData.ts) — no duplicated subscription boilerplate.
- **Centralized cross-cutting frameworks** already exist and are good: the activity-feed templates
  ([`activityFeedTemplates.ts`](app/src/utils/activityFeedTemplates.ts)), the badge rules
  ([`badges.ts`](app/src/utils/badges.ts)), the toast store, and the `NOTIFICATION_SOURCES` fan-out
  ([`notifications.ts`](app/src/utils/notifications.ts)). The Tier 3 items *extend* these, not replace.

---

## Tier 1 — Quick wins (high confidence, low effort, isolated)

### 1.1 Centralize pin/currency/time formatting → `utils/formatting.ts`

- **What:** A single module for display formatting of pins, signed amounts, and countdowns/deadlines.
- **Evidence:** [`helpers.ts`](app/src/utils/helpers.ts) has date helpers but **no** pin/currency
  formatting. Formatting is instead scattered per feature: `signed()` in
  [`utils/bets.ts`](app/src/utils/bets.ts), `formatStakes()` / `formatHandicap()` in
  [`utils/pvp.ts`](app/src/utils/pvp.ts), `formatCloseTime()` in [`utils/bounty.ts`](app/src/utils/bounty.ts),
  `formatTimeRemaining()` / `formatCountdown()` in [`utils/auction.ts`](app/src/utils/auction.ts). On top
  of that, **~96 inline `.toLocaleString()` calls across 27 component/screen files** render pin amounts
  by hand (e.g. [`BountyCard.tsx:39,43,59`](app/src/components/bounty/BountyCard.tsx#L39)).
- **Why it matters:** There is no single contract for "1,234 pins", "+500", or a countdown string, so
  they drift (some show a "pins" suffix, some don't; "+" handling is re-implemented each time). Money/
  time display is exactly the thing that should be defined once.
- **Proposed consolidation:** Create `utils/formatting.ts` with `formatPins(n, { signed })`,
  `formatCountdown(iso, now)`, `formatCloseTime(iso)`; move the existing per-feature helpers there and
  **re-export from their old modules** for back-compat. Then replace inline `.toLocaleString()` calls.
- **Effort: M · Confidence: High · Risk: Low.**

### 1.2 `<BalancePill>` component

- **What:** The "BALANCE … {n} pins" header pill that fronts every economy screen.
- **Evidence:** Identical markup + three style objects (`balancePill`, `balancePillLabel`,
  `balancePillValue`) copy-pasted across **5 screens**: [`BountyBoardScreen`](app/src/screens/BountyBoardScreen.tsx),
  [`AuctionHouseScreen`](app/src/screens/AuctionHouseScreen.tsx), [`PvPScreen`](app/src/screens/PvPScreen.tsx),
  [`LoanSharkScreen`](app/src/screens/LoanSharkScreen.tsx), [`BountyCreateScreen`](app/src/screens/BountyCreateScreen.tsx).
- **Why it matters:** Five copies guarantee eventual divergence in a high-visibility element.
- **Proposed consolidation:** `<BalancePill balance={n} />` in `src/components/ui/`. Pairs naturally
  with 1.1 (`formatPins`).
- **Effort: S · Confidence: High · Risk: Low.**

### 1.3 `computeBalance(ledger)` → `utils/ledger.ts`

- **What:** Summing a `pin_ledger` slice into a balance.
- **Evidence:** `ledger.reduce((sum, e) => sum + e.amount, 0)` appears in **9 hooks** —
  `usePinsinoData`, `usePlayerPinsinoData`, `useHousePinsinoData`, `useBountyBoardData`
  ([line 117](app/src/hooks/useBountyBoardData.ts#L117)), `useAuctionHouseData`, `useAuctionDetailData`,
  `usePvpData`, `useLoanSharkData`, `useWeekEditor`.
- **Why it matters:** Balance is the single most important number in the economy UI; its aggregation
  rule should live in exactly one place (and be the obvious hook for future filtering, e.g. excluding
  pending holds).
- **Proposed consolidation:** `computeBalance(rows)` (and a sibling `computeDebt`) in `utils/ledger.ts`.
- **Effort: S · Confidence: High · Risk: Low.**

### 1.4 Theme tokens for the remaining hardcoded tints

- **What:** Replace inline `rgba(...)` / `#000` values with theme tokens.
- **Evidence:** [`theme.ts`](app/src/theme.ts) **already** defines gold/accent tints (`goldDim`,
  `goldTint`, `accentDim`) — *those cases are covered.* What remains hardcoded are success/danger tints
  and shadow colors, e.g. `rgba(74,222,128,0.05)` / `rgba(239,68,68,0.05)` in
  [`LineRow.tsx`](app/src/components/betting/LineRow.tsx), `rgba(255,79,109,0.12)` in
  [`BorrowConfirmModal.tsx`](app/src/components/economy/BorrowConfirmModal.tsx), and `shadowColor:'#000'`
  in [`Dropdown.tsx`](app/src/components/ui/Dropdown.tsx) / [`Toast.tsx`](app/src/components/ui/Toast.tsx).
- **Why it matters:** Small, but these are the colors most likely to be tweaked for contrast/theming;
  a token means one edit instead of a hunt.
- **Proposed consolidation:** Add `successTint`, `dangerTint`, `shadow` to `theme.ts`; replace the
  inline values.
- **Effort: S · Confidence: High · Risk: Low.**

### 1.5 `useDatePicker(initial)` hook

- **What:** The deadline/close-time picker state machine.
- **Evidence:** The same `useState<Date>` + `pickerOpen` boolean + Android-dismiss handler
  (`if (Platform.OS === 'android') setPickerOpen(false)`) is re-implemented in
  [`BountyCreateScreen`](app/src/screens/BountyCreateScreen.tsx),
  [`BountyHouseCreateModal`](app/src/components/bounty/BountyHouseCreateModal.tsx), and
  [`AuctionCreateModal`](app/src/components/auction/AuctionCreateModal.tsx).
- **Why it matters:** Platform-specific picker behavior is easy to get subtly wrong; centralizing keeps
  iOS/Android parity.
- **Proposed consolidation:** `useDatePicker(initial)` returning `{ value, open, setOpen, onChange }`.
- **Effort: S · Confidence: High · Risk: Low.**

### 1.6 Doc-rot: stale `references/` path

- **What:** A comment points at a directory that was renamed.
- **Evidence:** [`notifications.ts:11`](app/src/utils/notifications.ts#L11) says "See
  references/notifications.md", but that tree is now `context/` (per `AGENTS.md`, the `references/`
  directory was removed).
- **Why it matters:** Trivially, but it sends readers to a dead path; a grep for other `references/`
  mentions while here is cheap insurance.
- **Effort: XS · Confidence: High · Risk: None.**

---

## Tier 2 — Shared UI primitives (high confidence, medium effort)

### 2.1 `<EconomyCard>` wrapper

- **What:** One card primitive behind the four economy list cards.
- **Evidence:** [`BountyCard`](app/src/components/bounty/BountyCard.tsx),
  [`AuctionCard`](app/src/components/auction/AuctionCard.tsx),
  [`PvpChallengeRow`](app/src/components/pvp/PvpChallengeRow.tsx), and
  [`MarketMoveCard`](app/src/components/economy/MarketMoveCard.tsx) share ~80% of their structure and
  StyleSheet. Verified against `BountyCard.tsx`: the `card` / `headerRow` / `title` / `status` /
  `amountRow` / `amountCell` / `amountValue` / `amountLabel` / `meta` blocks are the common skeleton,
  re-declared in each file.
- **Why it matters:** This is the single largest chunk of duplicated styling (~180 lines across four
  files) and the most likely to drift visually as features evolve. A new economy feature should get a
  consistent card for free.
- **Proposed consolidation:** `<EconomyCard title subtitle? badge? stats={StatCell[]} footer? onPress />`
  owning the base layout; features pass data, not styles. Keep feature-specific footers as `children`.
- **Effort: M · Confidence: High · Risk: Low.**

### 2.2 `<StatRow>` / key-value primitive

- **What:** The two-column "Label … Value" row used in confirm sheets and detail views.
- **Evidence:** Re-implemented in [`BorrowConfirmModal`](app/src/components/economy/BorrowConfirmModal.tsx),
  [`BountyAdminActionModal`](app/src/components/bounty/BountyAdminActionModal.tsx), and
  [`PvpAcceptModal`](app/src/components/pvp/PvpAcceptModal.tsx) with near-identical `row` / `rowLabel` /
  `rowValue` styles. The `amountCell` triplet inside `<EconomyCard>` (2.1) is the same idea.
- **Proposed consolidation:** `<StatRow label value variant?='normal'|'accent'|'big' />`.
- **Effort: S · Confidence: High · Risk: Low.**

### 2.3 `<PinAmountInput>` component

- **What:** A pin-amount text field that owns digit-filtering + the shared input styling.
- **Evidence:** The filter `t.replace(/[^0-9]/g, '')` recurs in **10 files**: `WagerSheet`,
  `SettleBetModal`, `AuctionBidSheet`, `AuctionCreateModal`, `GrantItemSheet`, `BountyHouseCreateModal`,
  `PvpCounterModal`, `PvPCreateScreen`, `LoanSharkScreen`, `BountyCreateScreen`. The input *styling*
  (`backgroundColor: surface2`, `borderColor: border2`, `radius.cardSm`, the same paddings/fonts) is
  pasted alongside each.
- **Why it matters:** Amount entry is the riskiest input in the app (it spends real balance); one
  component means one place for validation/keyboard/sanitization rules.
- **Proposed consolidation:** `<PinAmountInput value onChange max? />`; optionally a more general
  `<FormInput>` for the non-amount text fields that share the same styling.
- **Effort: S–M · Confidence: High · Risk: Low.**

### 2.4 Shared admin-action-modal styles

- **What:** The `section` / `label` / `input` style objects in the per-feature admin modals.
- **Evidence:** Byte-identical definitions across
  [`BountyAdminActionModal`](app/src/components/bounty/BountyAdminActionModal.tsx),
  [`PvpAdminActionModal`](app/src/components/pvp/PvpAdminActionModal.tsx), and
  [`AuctionAdminActionModal`](app/src/components/auction/AuctionAdminActionModal.tsx).
- **Proposed consolidation:** A shared `adminModalStyles` object (or fold into 2.3's `<FormInput>` +
  a `<SectionLabel>`). Smallest version: export the three style objects from `theme.ts`.
- **Effort: S · Confidence: High · Risk: Low.**

### 2.5 `<ScreenContainer>` scaffold

- **What:** The `SafeAreaView` + `ScreenHeader` + `ScrollView` + `RefreshControl` shell every inner
  stack screen repeats.
- **Evidence:** ~30 screens repeat this 8–12 line scaffold (using the existing
  [`useRefresh`](app/src/hooks/useRefresh.ts) for the pull-spinner). Several also layer a pixel-art
  backdrop with the same conditional wiring.
- **Why it matters:** It's the most-repeated boilerplate in the screens layer; a wrapper makes new
  screens a one-import affair and centralizes safe-area/refresh behavior.
- **Proposed consolidation:** `<ScreenContainer title subtitle? onRefresh refreshing headerRight? artwork?>`
  owning the shell. Migrate incrementally — visual diffs are per-screen, so this is the riskiest Tier 2
  item.
- **Effort: M · Confidence: Med-High · Risk: Med** (per-screen visual verification needed).

---

## Tier 3 — Pattern standardization & data-layer hardening (wider blast radius)

### 3.1 Generic `useAsyncData<T>` lifecycle hook

- **What:** A reusable loading/error/refetch lifecycle behind the data hooks.
- **Evidence:** The identical skeleton — `useState(loading)`, a `loadedOnce` ref soft-load gate, a
  `load` callback, `try/catch console.error`, `finally setLoading(false)`, `useEffect(() => { load() }, [load])`,
  `return { …, reload: load }` — appears in **21 hooks** (the `useEffect(() => { load() })` line alone
  greps 21×; the `loadedOnce` soft-load ref in 6 of them). Verified end-to-end in
  [`useBountyBoardData.ts:88–145`](app/src/hooks/useBountyBoardData.ts#L88). This is **complementary to**
  the existing `useRefresh` (which only owns the pull-to-refresh spinner, not the load lifecycle).
- **Why it matters:** Error handling is currently `console.error` in every hook — there's no shared
  place to add user-facing error states, retry, or stale-while-revalidate. One lifecycle hook gives all
  21 a consistent loading/error contract and removes thousands of lines.
- **Proposed consolidation:** `useAsyncData(fetcher, deps)` → `{ loading, data, error, reload }` with the
  soft-load gate built in. Migrate hooks a few at a time (each migration is independently verifiable on
  its screen).
- **Effort: L · Confidence: Med · Risk: Med** (touches every screen's data source).

### 3.2 `useEconomyRefresh()` + notification-source parity

- **What:** Make "refetch + refresh tab badges" consistent after an economy mutation, and fill the one
  missing notification source.
- **Evidence:** Badge refresh after a mutation is done in
  [`PvPScreen.tsx:35`](app/src/screens/PvPScreen.tsx#L35) and the
  [`PinsinoScreen`](app/src/screens/PinsinoScreen.tsx) hub, but **not** in `BountyBoardScreen`,
  `AuctionHouseScreen`, or `LoanSharkScreen` — so those tab badges can go stale until the next focus.
  Separately, [`NOTIFICATION_SOURCES`](app/src/utils/notifications.ts#L18) already contains `pvp` and
  `auction`; the real gap is a **`bounty`** source (open bounties with slots the player hasn't joined).
- **Why it matters:** The badge framework is good, but inconsistent wiring makes counts feel buggy. This
  is a clear "older screens never adopted the newer pattern" case.
- **Proposed consolidation:** A `useEconomyRefresh(reload)` hook (`Promise.all([reload(),
  notificationStore.refresh()])`) used by every economy screen; add the `bounty` entry to
  `NOTIFICATION_SOURCES`.
- **Effort: S–M · Confidence: High · Risk: Low.**

### 3.3 Migrate the old admin modals to the `BottomSheet` / `ConfirmActionSheet` standard

- **What:** Bring the legacy admin modals onto the current sheet standard.
- **Evidence:** The current standard is conditional-mount [`BottomSheet`](app/src/components/ui/BottomSheet.tsx) /
  [`ConfirmActionSheet`](app/src/components/ui/ConfirmActionSheet.tsx), which render `<Toast />`
  themselves. But **all 6 admin modals still use the old `visible`-prop pattern** (`AdminArchiveModal`,
  `AdminEndSeasonModal`, `AdminEditSeasonModal`, `AdminGenerateTeamsModal`, `AdminOpenRegistrationModal`,
  `LanetalkConfirmModal`) and **hand-roll their own `<Toast />`** because of it.
  *Note:* per-**screen** `<Toast />` mounting is **correct and by design** (RN `Modal` overlays its own
  layer — see `context/toast.md`); the smell is specifically modals re-rendering Toast instead of
  composing the sheet that already provides it.
- **Why it matters:** The hand-rolled-Toast-in-modal pattern is the documented source of duplicate-toast
  bugs, and the `visible`-prop modals miss the mount-baseline guard the standard sheets provide.
- **Proposed consolidation:** Migrate the confirm-style admin modals (single-RPC → toast → done) to
  `ConfirmActionSheet`; drop their manual `<Toast />`. The genuinely form-heavy ones
  (`AdminGenerateTeamsModal`) can move to `BottomSheet` while keeping their body.
- **Effort: M · Confidence: Med-High · Risk: Med.**

### 3.4 `db.ts` embed & filter helpers

- **What:** Extend the embed-constant pattern already used for graph selects.
- **Evidence:** `db.ts` already has nice constants like `MARKET_GRAPH` / `FEED_GRAPH` — but
  `players(name)` is still written inline **21 times**, `.order('created_at', { ascending: false })`
  **15 times**, and the archived-scores filter chain
  (`.eq('…weeks.is_archived', true).eq('…is_fill', false).not('score','is',null)`) is repeated across
  `scores.listBySeason` / `listAllArchived` / `listForStandings`.
- **Why it matters:** These are the joins/filters most likely to need a coordinated change (e.g. adding
  a column to the player embed, or changing what "counts" for standings); inline repetition makes that a
  find-and-replace across 21 sites.
- **Proposed consolidation:** `const WITH_PLAYER_NAME = 'players(name)'`, `const DESC = { ascending: false }`,
  and a small `archivedScores(q)` chain helper. Follows the existing constant style; low risk.
- **Effort: S–M · Confidence: Med-High · Risk: Low.**

### 3.5 Push compute into hooks (return render-ready data)

- **What:** Hooks should return typed, ready-to-render rows, not raw query output the screen must
  transform.
- **Evidence:** [`useStandingsData`](app/src/hooks/useStandingsData.ts) returns `rawScores` +
  `rawSchedule`, and the screen calls `computeStandingsFromSupabase(...)`; same shape in
  [`usePlayoffDraftData`](app/src/hooks/usePlayoffDraftData.ts).
- **Why it matters:** It couples screens to raw DB row shapes and spreads compute logic into the view.
  (The project rule that compute stays pure + `useMemo`'d is still satisfied — the `useMemo` simply moves
  into the hook.)
- **Proposed consolidation:** Compute inside the hook within a `useMemo`, return `standingsRows`.
- **Effort: M · Confidence: Med · Risk: Med.**

### 3.6 Standardize the detail surface: modal vs. screen

- **What:** Decide and document whether feature detail views are modals or pushed screens.
- **Evidence:** Older features open **modals** ([`BetDetailModal`](app/src/components/betting/BetDetailModal.tsx),
  [`PvpChallengeDetailModal`](app/src/components/pvp/PvpChallengeDetailModal.tsx)); newer features push
  **screens** ([`BountyDetailScreen`](app/src/screens/BountyDetailScreen.tsx), [`AuctionDetailScreen`](app/src/screens/AuctionDetailScreen.tsx)).
- **Why it matters:** It's an inconsistency users feel (different back-gestures, different depth) and it
  makes composition harder (a modal can't easily push a sub-detail). This is a **direction-setting**
  item, not a mechanical one — flagged for a decision rather than a rote change.
- **Proposed consolidation:** Document the convention (lean toward pushed screens for navigability) and
  migrate opportunistically when a detail view is next touched.
- **Effort: L · Confidence: Low-Med · Risk: Med.**

### 3.7 Type-safety pass (optional)

- **What:** Reduce `any` in normalizers and query reads.
- **Evidence:** Normalizers take `row: any` (e.g. `normalizeBounty(row: any)` in
  [`useBountyBoardData.ts:38`](app/src/hooks/useBountyBoardData.ts#L38)) and `usePvpData` uses `c: any`.
- **Why it matters:** The embedded-join shapes are exactly where a schema change should break the build,
  but `any` swallows it. Lower urgency than the duplication items.
- **Proposed consolidation:** Derive row types from the generated `database.types.ts` (e.g.
  `Tables<'bounty_posts'> & { sponsor: Pick<Tables<'players'>,'name'> }`) and type the normalizer inputs.
- **Effort: L · Confidence: Med · Risk: Low.**

### 3.8 Form validators (optional, low payoff)

- **What:** Extract per-feature create-form validation.
- **Evidence:** Each create flow has a `useMemo` → `error` → `disabled={!!error}` block
  (`BountyCreateScreen`, `PvPCreateScreen`, `AuctionCreateModal`, `BountyHouseCreateModal`).
- **Why it matters:** Modest — the rules are genuinely domain-specific, so the shared surface is thin.
  Listed for completeness; do last or skip.
- **Proposed consolidation:** `utils/validators.ts` with `validateBounty(...)` etc.
- **Effort: M · Confidence: Low · Risk: Low.**

---

## Suggested sequencing

1. **Tier 1, in order.** All isolated and mechanical; each is a self-contained PR. 1.1 (`formatPins`) and
   1.3 (`computeBalance`) unlock cleaner versions of the Tier 2 components, so do them first.
2. **Tier 2 primitives.** Build `<StatRow>`, `<PinAmountInput>`, `<BalancePill>` (depends on 1.1), then
   `<EconomyCard>`. Save `<ScreenContainer>` (2.5) for last — it has the most per-screen visual surface.
3. **Tier 3, lowest-risk first:** 3.2 (badge parity) and 3.4 (db.ts helpers) are quick and safe. 3.3
   (modal migration) and 3.1 (`useAsyncData`) are larger and should land hook-by-hook / modal-by-modal.
   3.6 (detail-surface direction) needs a product decision before any code moves.

Because there is **no app-layer test suite**, every PR must be verified by running the Expo dev server
and exercising the affected screen. Keep PRs small (one primitive or a few hooks) so a visual regression
is easy to localize.

---

## Appendix — representative file inventory

| Area | Paths |
|---|---|
| Formatting | [`utils/helpers.ts`](app/src/utils/helpers.ts), [`utils/bets.ts`](app/src/utils/bets.ts), [`utils/pvp.ts`](app/src/utils/pvp.ts), [`utils/bounty.ts`](app/src/utils/bounty.ts), [`utils/auction.ts`](app/src/utils/auction.ts) |
| Economy cards | [`bounty/BountyCard.tsx`](app/src/components/bounty/BountyCard.tsx), [`auction/AuctionCard.tsx`](app/src/components/auction/AuctionCard.tsx), [`pvp/PvpChallengeRow.tsx`](app/src/components/pvp/PvpChallengeRow.tsx), [`economy/MarketMoveCard.tsx`](app/src/components/economy/MarketMoveCard.tsx) |
| Balance pill (5) | `BountyBoardScreen`, `AuctionHouseScreen`, `PvPScreen`, `LoanSharkScreen`, `BountyCreateScreen` |
| Amount input (10) | `WagerSheet`, `SettleBetModal`, `AuctionBidSheet`, `AuctionCreateModal`, `GrantItemSheet`, `BountyHouseCreateModal`, `PvpCounterModal`, `PvPCreateScreen`, `LoanSharkScreen`, `BountyCreateScreen` |
| Hook lifecycle | canonical: [`useBountyBoardData.ts`](app/src/hooks/useBountyBoardData.ts); + ~20 sibling `use*Data.ts`; existing [`useRefresh.ts`](app/src/hooks/useRefresh.ts) |
| Admin modals (6, `visible`-prop) | [`admin/`](app/src/components/admin/): `AdminArchiveModal`, `AdminEndSeasonModal`, `AdminEditSeasonModal`, `AdminGenerateTeamsModal`, `AdminOpenRegistrationModal`, `LanetalkConfirmModal` |
| Sheet standard | [`ui/BottomSheet.tsx`](app/src/components/ui/BottomSheet.tsx), [`ui/ConfirmActionSheet.tsx`](app/src/components/ui/ConfirmActionSheet.tsx) |
| Notifications / badges | [`utils/notifications.ts`](app/src/utils/notifications.ts), [`stores/notificationStore.ts`](app/src/stores/notificationStore.ts), [`utils/badges.ts`](app/src/utils/badges.ts) |
| Theme | [`theme.ts`](app/src/theme.ts) |
| Data layer | [`utils/supabase/db.ts`](app/src/utils/supabase/db.ts) |
