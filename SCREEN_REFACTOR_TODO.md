# SCREEN_REFACTOR_TODO — Presentation-Layer Consolidation

> **For the executing agent.** This is a phased, self-contained work order. Each phase is
> independently shippable (own branch + PR). Do phases in order; do NOT batch multiple phases
> into one PR. Read the "Hard rules" and "Ground truth" sections before writing any code.

## Objective

`/app` has already consolidated its **data layer** (`useAsyncData`), **query layer** (`db.ts`),
**modal chrome** (`BottomSheet`/`CenterModal`), and **formatting** (`utils/formatting.ts`). The one
architectural seam with **zero consolidation** is the **presentation layer**: screens re-paste the
same frame and the same composite styles because the app has design *tokens* (`theme.ts`) but no
composed layer above them.

This project closes that gap by (a) finishing adoption of the **existing** `ScreenContainer`
scaffold, (b) adding a thin `requireAdmin` + `TabbedScreen` layer, and (c) introducing composite
style primitives (`Card`, `Row`, `SectionLabel`, `Text`) and migrating duplicating files onto them.

Measured duplication being removed:
- "Surface card" style block redeclared in **28 files**
- Small-caps section label redeclared in **16 files** (a copy of the existing `sheetStyles.section`)
- Flex `row:` block in **28 files**
- `fontFamily` respecified manually **735×**; muted-text color **397× across 106 files**
- **19 of 46 screens** hand-roll the root container instead of `ScreenContainer`
- The inline `const isAdmin = useAuthStore(s => s.role) === 'admin'` line in **14+ screens**, with the
  "Admins only" gate already **drifting** (bare / `margin:16` / `marginHorizontal:16` / `marginTop:12`,
  and one raw `<Text>` variant)
- 4 tab-view screens share a near-identical skeleton end-to-end

## Hard rules (do not violate)

1. **App layer has NO test suite.** Every phase's mechanical gate is `cd app && npx tsc --noEmit`
   (must stay green). Its runtime gate is the Expo dev server (`cd app && npx expo start`) — launch
   and manually open every screen the PR touched. See `AGENTS.md`.
2. **Never touch DB / migrations / `db.ts` in this project.** This is presentation-only.
3. **Do NOT move `useMemo(compute…)` derivations.** Screens legitimately differ in their per-domain
   memoized computations. Scaffolds own the *frame* only (container, header, refresh, loading, admin
   gate, tab strip). Leave every `useMemo` where it is, in the screen.
4. **Purely visual parity.** These are refactors: rendered output must not change (except the
   intentional admin-gate style normalization in Phase 1). If a migration changes spacing/colors,
   you did it wrong — match the previous local style exactly.
5. **One concern per commit**, small commits, conventional-commit messages. One phase = one PR.
6. **Respect `backdrop` screens.** Screens with a pixel-art backdrop or that scroll themselves
   (`FlatList`, Sportsbook's long field) do not fit the plain `ScrollView` shell — see the
   per-phase exclusion notes. Do not force them.
7. **Additive theme changes only.** Extend `theme.ts`; never change existing token *values*.

## Ground truth — existing primitives (build ON these, do not reinvent)

| Primitive | Path | Key API |
|---|---|---|
| `ScreenContainer` | `app/src/components/ui/ScreenContainer.tsx` | props: `title`, `subtitle`, `onBack?`, `headerRight?`, `onHelp?`, `backdrop?`, `loading?`, `loadingLabel?`, `onRefresh?` (enables pull-to-refresh, owns spinner), `scroll?` (false = children mount raw, for FlatList), `pinned?` (stays fixed below header — use for toggle strips/filters), `overlay?` (outside ScrollView — Toast/ConfirmBar), `contentStyle?`. **Already covers most of the frame.** |
| `ScreenHeader` | `app/src/components/ui/ScreenHeader.tsx` | `title`, `subtitle?`, `onBack`, `right?`, `onHelp?` |
| `ToggleGroup` | `app/src/components/ui/ToggleGroup.tsx` | `options: {key,label}[]`, `value`, `onChange`, `variant?: 'segment'|'pill'|'bar'` |
| `PillFilter` | `app/src/components/ui/PillFilter.tsx` | thin wrapper over `ToggleGroup` |
| `EmptyCard` | `app/src/components/ui/EmptyCard.tsx` | `text`, `style?` |
| `LoadingView` | `app/src/components/ui/LoadingView.tsx` | `label?`, `transparent?`, `delayed?` |
| `useRefresh` | `app/src/hooks/useRefresh.ts` | `useRefresh(fn) → { refreshing, onRefresh }` |
| `sheetStyles` | `app/src/theme.ts` | `.section` / `.label` / `.input` / `.actSpacing` — **`.section` IS the duplicated section-label** |
| tokens | `app/src/theme.ts` | `colors`, `spacing`, `fonts`, `radius` |

**Key realization:** `ScreenContainer` already supports `loading`, `onRefresh`, `pinned`, `overlay`,
`onHelp`. Most of "the scaffold" already exists — the work is *adoption*, plus a small
`requireAdmin` extension and a `TabbedScreen` convenience wrapper.

## Self-check greps (run from `app/src` to find remaining work at any time)

```bash
# Screens still bypassing ScreenContainer:
comm -23 <(ls screens|sed 's/.tsx//'|sort) <(grep -rln ScreenContainer screens|xargs -n1 basename|sed 's/.tsx//'|sort)
# Inline admin-role checks left:
grep -rln "role) === 'admin'\|role === 'admin'" screens components
# Local card blocks left:
grep -rln "^\s*card: {" screens components
# Local section-label blocks left (should point at sheetStyles.section):
grep -rlnE "^\s*(sectionTitle|section|sectionLabel): \{" screens components
# Manual fontFamily uses (target for <Text>/typography adoption):
grep -rc "fontFamily: fonts\." screens components | grep -v ':0' | awk -F: '{s+=$2} END{print s}'
```

---

## Phase 0 — `useIsAdmin()` + `<AdminGate>` (smallest, do first)

**Goal:** kill the 14 copies of the inline admin check and the drifting "Admins only" gate.

**New code:**
- `app/src/hooks/useIsAdmin.ts` — `export const useIsAdmin = () => useAuthStore(s => s.role) === 'admin'`
  (match the exact selector currently used at the call sites).
- `app/src/components/ui/AdminGate.tsx` — renders `children` when admin; otherwise renders the
  standard header + `<EmptyCard text="Admins only" />`. Prop: `{ children: ReactNode }`. It must
  reproduce the *most common* current gate exactly so the normalization is invisible on the
  majority of screens.

**Target files (replace inline `role === 'admin'` + gate):**
`AdminSportsbookScreen`, `ArchivesScreen`, `AuctionHouseAdminScreen`, `BountyAdminScreen`,
`BroadcastAdminScreen`, `HistoryScreen`, `LanetalkImportAdminScreen`, `LoanSharkAdminScreen`,
`MarketMovesAdminScreen`, `MatchupsScreen`, `MoreHomeScreen`, `PinsinoAccountingScreen`,
`PinsinoAdminScreen`, `PlayoffsScreen`, `PvPAdminScreen`, `RegistrationAdminScreen`,
`RsvpBonusAdminScreen`, `RsvpScreen`, `SeasonRegistrationScreen`.

**Per-file steps:** replace the inline const with `const isAdmin = useIsAdmin()`; where a screen
early-returns an "Admins only" card, either keep that inline (Phase 0) OR defer the gate visual to
`<AdminGate>` when the screen is `ScreenContainer`-based (some aren't yet — that's Phase 1). Keep
Phase 0 mechanical: at minimum, every inline `role === 'admin'` becomes `useIsAdmin()`.

**DoD:** self-check grep for inline admin checks returns 0 in `screens`; `tsc` green; Expo smoke of
3 admin screens (accounting, playoffs, one that is non-admin for the current user to see the gate).

---

## Phase 1 — Finish `ScreenContainer` adoption

**Goal:** migrate the 19 screens that hand-roll `SafeAreaView`/`ScrollView`/`RefreshControl`/loading
onto the existing `ScreenContainer`. Fold each screen's `useRefresh` + `<RefreshControl>` +
`if (loading) return <LoadingView/>` + admin gate into container props.

**Extend `ScreenContainer` first (one small commit):** add an optional `requireAdmin?: boolean`
prop. When `true` and the viewer is not admin, render the header + `<EmptyCard text="Admins only" />`
instead of children (reuse the Phase 0 `AdminGate` internals). This lets admin screens drop their
hand-rolled gate entirely.

**Target files (19 — bypassing ScreenContainer today):**
`AdminSportsbookScreen`, `ArchivesScreen`, `FrameStatsScreen`, `LoanSharkScreen`, `LoginScreen`,
`MatchupsScreen`, `MoreHomeScreen`, `PinsinoAccountingScreen`, `PinsinoAdminScreen`,
`PinsinoLeaderboardScreen`, `PinsinoScreen`, `PlayerDetailScreen`, `PlayerManagementScreen`,
`PlayerPinsinoScreen`, `ProfilePicturesScreen`, `RsvpScreen`, `SportsbookScreen`, `StandingsScreen`,
`TrashBoardScreen`.

**Exclusions / careful cases (verify individually, migrate only if it fits):**
- `LoginScreen` — pre-auth, no header/back; likely **skip** (not a standard inner screen).
- `SportsbookScreen` — long scroll field + backdrop; may need `scroll={false}` or `backdrop`. See the
  `pixelart/config.ts` note in `ScreenContainer`'s doc comment. Migrate cautiously or defer.
- Any screen driving its own `FlatList` → use `scroll={false}` and mount the list as `children`.

**Per-file recipe:**
1. Replace the outer `<SafeAreaView>…</SafeAreaView>` with `<ScreenContainer title=… onRefresh={reload} loading={loading} …>`.
2. Delete the local `useRefresh(...)`, the `<RefreshControl>`, and the `if (loading) return <LoadingView/>` — the container owns all three.
3. Move any pinned filter/toggle strip into the `pinned` prop; move `<Toast/>`/sticky bars into `overlay`.
4. For admin screens, pass `requireAdmin` and delete the hand-rolled gate.
5. Delete now-unused local styles (`safe`, `content`, `container` root blocks).

**DoD:** self-check grep for ScreenContainer bypass shrinks to only the documented exclusions; no
screen imports `RefreshControl`/`SafeAreaView` directly except exclusions; `tsc` green; Expo smoke of
every migrated screen incl. pull-to-refresh + loading + one admin-gated screen as a non-admin.

---

## Phase 2 — `<TabbedScreen>` for the segmented-view screens

**Goal:** collapse the 4 screens sharing the `useState<view>` + `ToggleGroup` + `{view === 'x' && …}`
skeleton, and pull the 2 hand-rolled-chip screens onto the shared control.

**New code:** `app/src/components/ui/TabbedScreen.tsx` — composes `ScreenContainer` and owns the tab
state. Suggested API:
```
<TabbedScreen title=… onRefresh=… loading=… requireAdmin?=…
  tabs={[{ key:'active', label:'Active' }, …]}
  initial="active"
  views={{ active: <ActiveBetsView/>, settled: <SettledBetsView/> }} />
```
Internals: `useState(initial)`, render the `ToggleGroup` via `ScreenContainer`'s `pinned` prop, render
`views[current]` as children. Keep it thin — it is `ScreenContainer` + tab state, nothing more.

**Primary targets (tab skeleton):** `SportsbookScreen`, `AdminSportsbookScreen`,
`PinsinoAccountingScreen`, `PlayerPinsinoScreen`.
**Secondary (hand-rolled chips → ToggleGroup/TabbedScreen):** `HeadToHeadScreen` (season chip
filter), `BroadcastAdminScreen`.

**Rule:** the `useMemo` derivations that produce each view's data stay in the screen and are passed
into the view components as props. `TabbedScreen` never computes domain data.

**DoD:** the 4 primary screens no longer declare local tab `useState` + `ToggleGroup` wiring; the 2
hand-rolled chip controls are gone; `tsc` green; Expo smoke toggling every tab on all 6 screens.

---

## Phase 3 — Composite style primitives

**Goal:** replace the copy-pasted composite style blocks with shared pieces. Prefer **style tokens**
over components where the block dresses arbitrary children, and a small **component** where it wraps
children with layout.

**New code (extend `app/src/theme.ts`, additive):**
- `surfaceStyles.card` — `{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: 14 }` (match the 28-file consensus exactly; verify against 3–4 sample files before committing the canonical values).
- `surfaceStyles.row` — `{ flexDirection: 'row', alignItems: 'center' }`.
- Reuse the **existing** `sheetStyles.section` for the small-caps section label — do NOT add a new one.

**New component (optional, if a wrapping component reads cleaner than a style token):**
- `app/src/components/ui/Card.tsx` — `{ style?, children }` view applying `surfaceStyles.card`.

**Target files:**
- **Card blocks (28):** `ActiveBetsView`, `ArchivesScreen`, `AuctionDetailScreen`, `BountyDetailScreen`,
  `BroadcastAdminScreen`, `ChemistryScreen`, `FeatureAccordion`, `HeadToHeadScreen`, `HistoryScreen`,
  `LanetalkImportAdminScreen`, `LeagueRecordsScreen`, `LineDuelLines`, `LineRowContainer`,
  `LoanSharkAdminScreen`, `LoginScreen`, `MarketMovesAdminScreen`, `PinsinoAccountingScreen`,
  `PlayerDetailScreen`, `PlayerPinsinoScreen`, `PlayoffsScreen`, `PvpChallengeDetailModal`,
  `RsvpBonusAdminScreen`, `SettledBetsView`, `SportsbookScreen`, `StandingsScreen`
  (skip `CenterModal`, `EconomyCard`, `EmptyCard` — those are the *definitions* the pattern came from).
- **Section-label blocks (16) → `sheetStyles.section`:** `AdminGenerateTeamsModal`, `AuctionDetailScreen`,
  `AuctionHouseAdminScreen`, `AuctionHouseScreen`, `BountyBoardScreen`, `BountyDetailScreen`,
  `ItemInfoSheet`, `LoanSharkScreen`, `PinsinoHelpScreen`, `PinsinoScreen`, `PvPBoardScreen`, `PvPScreen`,
  `PvpChallengeDetailModal`, `RegistrationScreen`, `RsvpScreen`, `SeasonRegistrationScreen`.
- **Row blocks (28):** migrate opportunistically as you touch each file.

**Per-file recipe:** for each local `card:`/`sectionTitle:`/`row:` style key, confirm it's value-equal
to the shared token (diff the properties). If equal → replace usages with the shared token/component
and delete the local key. If it diverges (extra padding, different radius) → leave it and note why in
the PR; do not silently normalize a visual difference.

**DoD:** self-check greps for local `card:` and section-label keys shrink to only intentional
divergences (documented in the PR); `tsc` green; Expo smoke of a representative screen per domain
(betting, auction, pvp, league) confirming pixel parity.

---

## Phase 4 — `<Text>` / typography primitive

**Goal:** stop respecifying `fontFamily`/size/color inline 735×. Introduce a typography component so
text styles compose from named variants.

**New code:** `app/src/components/ui/Text.tsx` — wraps RN `Text`, prop `variant`:
- `heading` → `barlowCondensedHeavy`
- `title` → `barlowCondensed`
- `body` → `barlow`
- `label` → small-caps `barlowCondensed` + `letterSpacing` + `muted` (matches `sheetStyles.label`)
- `muted` → `barlow` + `colors.muted`
Accept `style?` override and all RN `Text` props. Pick variant names from the actual usage clusters
before finalizing (grep the `fontFamily: fonts.*` + `color:` combinations).

**Adoption:** this is the largest surface (106+ files) — do it **incrementally, domain by domain**, in
separate PRs under Phase 4 (4a betting, 4b auction, 4c pvp/bounty, 4d league, 4e admin). Do NOT
attempt all files in one PR. Each sub-PR: migrate one domain's screens/components, `tsc` green, Expo
smoke that domain.

**DoD (per sub-PR):** manual `fontFamily: fonts.*` count drops for that domain; visual parity; `tsc`
green.

---

## Progress tracker (update as you land each PR)

| Phase | Scope | PR | Status |
|---|---|---|---|
| 0 | `useIsAdmin` + `AdminGate` | — | ☐ not started |
| 1 | `ScreenContainer` adoption (19 screens) + `requireAdmin` | — | ☐ not started |
| 2 | `TabbedScreen` (4 primary + 2 secondary) | — | ☐ not started |
| 3 | Composite style primitives (`card`/`row`/section-label) | — | ☐ not started |
| 4a–e | `<Text>` typography, per domain | — | ☐ not started |

## Definition of done (whole project)

- All self-check greps return only explicitly-documented exclusions.
- `cd app && npx tsc --noEmit` green.
- Every touched screen manually verified in the Expo dev server with visual parity.
- No behavioral change beyond the intentional admin-gate normalization (Phase 0/1).
- `context/ui-system.md` and `context/COMPONENTS_INDEX.md` updated to document the new primitives
  (`useIsAdmin`, `AdminGate`, `TabbedScreen`, `Card`, `Text`) and the `ScreenContainer.requireAdmin`
  prop.
