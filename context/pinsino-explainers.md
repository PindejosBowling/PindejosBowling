# Pinsino Explainer Framework

How game mechanics are explained to players, and where every piece of that copy lives. Built to fix the "players don't understand the mechanics" feedback (2026-07): one content source, served contextually.

## The single source of truth

**All explanation copy lives in [app/src/data/pinsinoExplainers.ts](../app/src/data/pinsinoExplainers.ts).** Never inline explainer or terms copy in a screen/sheet — add it to the catalog and render it through the shared components.

Two catalogs in that file:

- `EXPLAINERS: Record<PinsinoFeatureKey, FeatureExplainer>` — per-feature `{ icon, title, hook, tileHook?, bullets[], caveat? }`. Keys: `sportsbook | statProps | pvp | bounties | loanShark | auctionHouse | marketMoves | items` (`statProps`/`items` have no hub tile; they exist for the help screen).
- `TERMS: Record<TermsKey, TermsCopy>` — per-**confirm-flow** `{ lines[], caution? }`. Keys: `loanBorrow | pvpAccept | pvpCreate | bountyEnter | auctionBid | haunt | betSlip`. Lines are static rule statements; dynamic numbers (stakes, bounce fees) stay in the sheet's stat cells or are passed via `TermsBlock`'s `extraLines`.

## Voice contract (two layers)

- `hook` / sheet subtitles / headlines: the noir house persona.
- `bullets` and `terms.lines`: plain ELI5 mechanics — one rule per line, no puns.
- "Pincome"/"pinterest" survive only as the one defined flavor aside (Loan Shark bullets); the canonical mechanical terms are **"weekly interest"** and **"weekly pinfall"**. (The `PINCOME` ledger label on the Pinsino statement is the score-credit taxonomy, not loan copy.)

## The four delivery surfaces (all read the catalog)

1. **Central help screen** — [PinsinoHelpScreen.tsx](../app/src/screens/PinsinoHelpScreen.tsx): `FeatureAccordion` per key, ordered by the `GAMES`/`MONEY` arrays. Auction House **and Items** accordions gate on `SHOW_AUCTION_HOUSE` together.
2. **Per-screen `?`** — every feature screen passes `onHelp` (via `ScreenContainer`, or `ScreenHeader` directly on the hand-rolled Sportsbook/LoanShark shells) opening a `FeatureExplainerSheet` with its own key. `onHelp` deliberately survives backdrop screens (unlike `headerRight`, which backdrops replace with the ArtworkToggle).
3. **Hub tile hooks** — [PinsinoScreen.tsx](../app/src/screens/PinsinoScreen.tsx) `MENU_TILES` carry a `key` and render `tileHook ?? hook` under the label. Keep `tileHook` ≤ ~28 chars (two 10–11pt lines on a third-width tile).
4. **Confirm-sheet terms** — `TermsBlock` (`components/ui/TermsBlock.tsx`) renders `TERMS.<flow>` inside every confirm flow (borrow, PvP accept/create, bounty entry, auction bid, haunt, bet slip).

Shared components: `ExplainerBody` (bullets+caveat interior, shared by accordion + sheet), `FeatureExplainerSheet` (BottomSheet, conditional-mount contract), `TermsBlock`.

## Loan payoff schedule

The Loan Shark's personalized "will I get out of this" diagram:

- **Math**: [app/src/utils/loanSchedule.ts](../app/src/utils/loanSchedule.ts) `simulateLoanPayoff` — pure, mirrors `process_weekly_loans` exactly (garnish `ceil(pinfall×g)` capped at debt, then interest `ceil(rest×i)`). Statuses: `paid_off | truncated | spiral | no_data`; caps at `MAX_SIMULATED_WEEKS = 10`. `spiral` is shown honestly ("the shark wins") — intended.
- **Weekly pinfall estimate** = `round(seasonAvg) × GAMES_PER_WEEK`. `GAMES_PER_WEEK = 2` is the league-structure global in [app/src/utils/helpers.ts](../app/src/utils/helpers.ts). Season avg comes from `aggregatePlayerAverages`/`effectiveAverage` over `scoreRows` that `useLoanSharkData` now fetches (`scores.listBySeason`, skipped in read-only); league-avg fallback for players with no bowled games.
- **UI**: [LoanPayoffSchedule.tsx](../app/src/components/economy/LoanPayoffSchedule.tsx) (headline + week rows + shrinking debt bar, plain Views). Rendered in `BorrowConfirmModal` (from `borrow_amount`) and as a collapsible "PROJECTED PAYOFF" on the active-loan card (from `outstanding`, hidden in read-only).

## Adding a new feature or confirm flow

1. Add the `FeatureExplainer` (and any `TermsCopy`) to the catalog.
2. Help screen: add the key to the `GAMES`/`MONEY` array.
3. Hub tile (if any): add `key` to `MENU_TILES` and write a ≤28-char `tileHook`.
4. Feature screen: `onHelp` + conditional-mount `FeatureExplainerSheet`.
5. Confirm sheet: `<TermsBlock terms={TERMS.x} />`, dynamic values via `extraLines`.

Ghost in the Slip rule: its existence and mechanics are public copy; who owns/used ghosts is never hinted anywhere — reveals stay win-only.
