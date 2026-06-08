# Bounty Board — App Implementation Spec

> **⚠️ Updated for the "All Comers" redesign.** The hunter mechanic changed from
> early-hunter anti-dilution to a flat per-hunter reward (see
> `ECONOMIC_DESIGN_BOUNTIES.md` §13–§14 and migration
> `20260607220000_bounty_all_comers.sql`). The as-built app reflects the new model:
> sponsors set **reward per hunter `R`**, **hunter stake `H`**, and **max hunters `m`**
> (escrowing `R × m`); every hunter wins `H + R` regardless of order/count; the board
> shows `n/m` hunters + "slots left" instead of a declining "next hunter profit"; the
> entry modal stresses "every hunter gets the same reward, and if any hunter wins the
> whole pack wins." Pure helpers live in `app/src/utils/bounty.ts`
> (`sponsorMaxLiability`, `hunterPayout`, `bountyEconomics`). References below to
> "protected profit", "anti-dilution preview", or "House seed estimate" are historical.
>
> **v1 is House-only.** The player "Post a Bounty" CTA on `BountyBoardScreen` is hidden
> (see the comment there) — players join as hunters only; bounties are created by admins
> via the Bounty Admin "Create House Bounty" flow. The `BountyCreate` route, screen, and
> `bountyPosts.createSponsor` wrapper are **kept** for a future player-sponsor phase; only
> the entry point is removed (the DB also revokes the RPC — see the DB spec banner). To
> restore: re-add the CTA. Rationale: `ECONOMIC_DESIGN_BOUNTIES.md` §3.3.

Handoff spec for the **app layer** (`app/src`) of the Bounty Board feature, surfaced as a
new Pinsino tile **"Bounties"**.

**Prerequisite:** the database spec (`economy/BOUNTIES_DB.md`) is fully applied
(`supabase db push`) **and** `app/src/utils/supabase/database.types.ts` has been regenerated
— follow the type-regeneration step in `PAGE_CREATION.md`. These must exist in the generated
types before starting:
- Tables `bounty_post`, `bounty_hunter_stakes`, `bounty_settlements`, `bounty_payouts`.
- Column `pin_ledger.bounty_post_id` and the three new `pin_ledger.type` values
  (`bounty_sponsor_stake` / `bounty_hunter_stake` / `bounty_payout`).
- RPCs `create_sponsor_bounty`, `create_house_bounty`, `enter_bounty_as_hunter`,
  `close_bounty`, `settle_bounty`, `cancel_bounty`.
- The Activity Feed column `activity_feed_events.bounty_post_id` and the five
  `bounty_board_*` event types (server-side publish only — the app never calls the writer;
  feed rows appear as the bounty RPCs run).

**Read first:** `economy/ECONOMIC_DESIGN_BOUNTIES.md` (§ refs below point to it) and the
"Pinsino" / "Betting display components" / "notification framework" sections of `AGENTS.md`.
The **PvP app spec** (`economy/PvP_APP.md`) is the closest analog (inbox/board/detail
screens, escrow display, admin settle/cancel, ledger labels); the **Loan Shark app spec**
(`economy/LOAN_SHARK_APP.md`) is the next closest. Mirror existing patterns: hook (no memo) →
`useMemo` in the screen, `useRefresh(reload)`, a `<Toast/>` inside every `<Modal>`,
RPC-then-`reload`, admin gate via `useAuthStore(s => s.role) === 'admin'`.

## Scope (v1 — design §6)

A public Bounty Board (list + detail), a player **sponsor-creation** flow, a **hunter-entry**
confirm flow with the anti-dilution preview, an **admin** screen (create House bounties,
close, manual settle with required reasoning, destructive cancel), the three new ledger row
labels, and the five Activity Feed render cases. **No** auto-settlement, void outcome, rake,
hunter comments/counteroffers, multiple entries per player, sponsor self-cancel after hunters
enter, or partial refunds (design §6).

**Pattern templates to copy from:**
- Data hook (fetch → flatten; no memo in hook): `app/src/hooks/usePvpData.ts`,
  `usePinsinoData.ts`.
- Detail hook: `app/src/hooks/usePvpChallengeDetail.ts`.
- Hub + board + detail + create screens: `app/src/screens/PvPScreen.tsx`,
  `PvPBoardScreen.tsx`, `PvPChallengeDetailScreen.tsx`, `PvPCreateScreen.tsx`.
- Action/confirm modal (`<Toast/>` inside, RPC→toast→`onDone`→`onClose`):
  `app/src/components/SettleBetModal.tsx`, `PvpAcceptModal.tsx`.
- Hub screen + tiles: `app/src/screens/PinsinoScreen.tsx`, `PinsinoAdminScreen.tsx`.
- Admin list + cancel/settle UX: `app/src/screens/PvPAdminScreen.tsx`,
  `PinsinoSportsbookScreen.tsx`.
- Ledger row rendering: `app/src/components/LedgerRow.tsx`.
- db.ts query objects + RPC wrappers: `app/src/utils/supabase/db.ts`.
- Feed render + feature meta: `app/src/utils/activityFeedTemplates.ts`,
  `app/src/hooks/useMarketMovesData.ts`, `app/src/screens/MarketMovesScreen.tsx`.

---

## 1. `db.ts` — query objects + RPC wrappers

In `app/src/utils/supabase/db.ts`, add two query objects following the existing shape
(`pvpChallenges` / `loans` are the templates; RPC params use the `p_` prefix).

```ts
export const bountyPosts = {
  // Public board: open bounties accepting hunters, current season.
  listOpenBySeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, sponsor:players!bounty_post_sponsor_player_id_fkey(name), ' +
              'bounty_hunter_stakes(id, player_id, entry_number, protected_hunter_profit)')
      .eq('season_id', seasonId)
      .eq('status', 'open')
      .order('created_at', { ascending: false }),

  // Everything involving this player (sponsored or hunted) for the season.
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, sponsor:players!bounty_post_sponsor_player_id_fkey(name), ' +
              'bounty_hunter_stakes(*)')
      .eq('season_id', seasonId)
      .or(`sponsor_player_id.eq.${playerId},bounty_hunter_stakes.player_id.eq.${playerId}`)
      .order('created_at', { ascending: false }),

  // Admin: bounties to manage for the season (filter client-side by status/type/week).
  listBySeason: (seasonId: string) =>
    supabase.from('bounty_post')
      .select('*, sponsor:players!bounty_post_sponsor_player_id_fkey(name), ' +
              'bounty_hunter_stakes(*)')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false }),

  // Detail: one bounty with hunters, settlement, payouts, and its bounty ledger rows.
  getById: (bountyId: string) =>
    supabase.from('bounty_post')
      .select('*, sponsor:players!bounty_post_sponsor_player_id_fkey(name), ' +
              'bounty_hunter_stakes(*, players(name)), ' +
              'bounty_settlements(*), bounty_payouts(*, players(name))')
      .eq('id', bountyId).single(),

  createSponsor: (args: CreateSponsorBountyArgs) =>
    supabase.rpc('create_sponsor_bounty', { ...mapCreateSponsor(args) }),
  createHouse: (args: CreateHouseBountyArgs) =>
    supabase.rpc('create_house_bounty', { ...mapCreateHouse(args) }),
  enter:  (bountyId: string) => supabase.rpc('enter_bounty_as_hunter', { p_bounty_post_id: bountyId }),
  close:  (bountyId: string) => supabase.rpc('close_bounty',           { p_bounty_post_id: bountyId }),
  settle: (bountyId: string, outcome: 'sponsor_win' | 'hunter_win', reasoning: string) =>
    supabase.rpc('settle_bounty',
      { p_bounty_post_id: bountyId, p_outcome: outcome, p_admin_settlement_reasoning: reasoning }),
  cancel: (bountyId: string) => supabase.rpc('cancel_bounty', { p_bounty_post_id: bountyId }),
}

// Bounty-related ledger rows are plain pin_ledger rows tagged with bounty_post_id.
export const bountyLedger = {
  listByPost: (bountyId: string) =>
    supabase.from('pin_ledger').select('*, players(name)')
      .eq('bounty_post_id', bountyId)
      .order('created_at', { ascending: false }),
}
```

> Confirm the exact FK-constraint name for the `sponsor:` embed against the regenerated types
> (Supabase names it `bounty_post_sponsor_player_id_fkey`). Since `bounty_post` has a single
> `players` FK the hint is optional, but `bounty_hunter_stakes` / `bounty_payouts` join
> `players` too — use the implicit `players(name)` embed there. If the `.or()` across the
> embedded `bounty_hunter_stakes` relation proves awkward (it filters the embed, not the
> parent), split the "my hunted" query into a separate `bounty_hunter_stakes` lookup by
> `player_id` and fetch those posts by id, joining client-side (some hooks already do this).
> `mapCreateSponsor` / `mapCreateHouse` translate the form shape to the RPC `p_*` params
> (`p_week_id`, `p_title`, `p_description`, `p_sponsor_bounty_amount`,
> `p_hunter_stake_amount`, `p_closes_at`).

Reuse existing wrappers: `seasons.getCurrent()`, `weeks.getCurrent()`, `players.list()`,
`pinLedger.listByPlayerSeason` (balance).

---

## 2. Hooks

No memoization in hooks (project rule); screens derive display via `useMemo`.

### `app/src/hooks/useBountyBoardData.ts` (new)

`useBountyBoardData(playerId)` returns:

```ts
{
  loading: boolean
  balance: number                    // season-scoped pin balance (for stake validation)
  openBoard: BountyView[]            // open bounties (annotate "I sponsor" / "I entered" / next-hunter terms)
  mySponsored: BountyView[]          // bounties I posted
  myHunted: BountyView[]             // bounties I entered as hunter
  settled: BountyView[]              // settled history involving me
  reload: () => Promise<void>
}
```

Resolve current season (`seasons.getCurrent()`), balance (`pinLedger.listByPlayerSeason`
sum), the open board (`bountyPosts.listOpenBySeason`), and the player's involvement
(`bountyPosts.listByPlayerSeason`) bucketed into sponsored / hunted / settled. For each open
bounty, compute the **next hunter terms** (`entry_number = current_hunters + 1`,
`protected_profit = floor(sponsor_bounty_amount / entry_number)`) and `current_estimated_seed`
(see §4) so the board card and detail can preview without a round trip.

### `app/src/hooks/useBountyDetail.ts` (new)

`useBountyDetail(bountyId)` returns `{ loading, bounty, hunters, settlement, payouts,
ledger, reload }` from `bountyPosts.getById` (+ `bountyLedger.listByPost` for the ledger
rows). `hunters` sorted by `entry_number`; `ledger` newest-first. The screen derives the
viewer's actionable state (enter / sponsor-view / admin-settle / nothing) and the **payout
previews** (§4) via `useMemo`.

---

## 3. Bounty math helpers (pure utilities)

Add to `app/src/utils/helpers.ts` (or a new `app/src/utils/bounty.ts`) — pure, uncached,
wrapped in `useMemo` at the screen level (AGENTS.md §5). These mirror the DB's settlement
math (design §13, §14, §26) so the UI can preview without the server:

- `protectedProfit(sponsorAmount, entryNumber) → Math.floor(sponsorAmount / entryNumber)`.
- `bountyEconomics(sponsorAmount, hunters[]) → { totalHunterStakes, totalProtectedProfit,
  totalHouseSeed, totalPot }` where `totalHouseSeed = Math.max(0, totalProtectedProfit -
  sponsorAmount)` and `totalPot = sponsorAmount + totalHunterStakes + totalHouseSeed`.
- `hunterPayout(stake, protectedProfit) → stake + protectedProfit` (the hunter-win payout).

### The `closes_at` business-rule default (design §11)

Add `defaultBountyCloseAt(now = new Date()) → Date` computing **"upcoming Monday 7:00 PM
America/New_York"**: if `now` is before this week's Monday 7 PM ET, use that Monday; if at/
after, use the following Monday. Compute in app logic (not a DB default, design §11) — the DB
column has no default and the create RPC requires `p_closes_at`. Handle the ET offset
explicitly (the app already deals with `America/New_York` for league night; reuse any
existing tz helper rather than introducing a new dependency). The create form seeds its
"Close time" field from this and lets the user override.

---

## 4. Payout-preview derivations (the feature's UX core — design §13, §16, §29)

Both the board card and the detail/entry flows must explain the anti-dilution mechanic
up front. Derive (via the §3 helpers) and display:

- **Next hunter terms** (open bounty): "You would be Hunter #N · stake H · protected profit
  +P · total if hunters win H+P · additional hunters won't reduce your payout" (design §16,
  §29.3).
- **Current estimated House seed** (open/closed, pre-settlement): `bountyEconomics(...)
  .totalHouseSeed` over the current hunters (design §34.4 — show the estimate before
  settlement, the final snapshot after).
- **Sponsor-win / hunter-win payout previews** (detail): the sponsor would receive
  `totalPot`; each hunter would receive `stake + protectedProfit` (design §29.2).

---

## 5. Screens (Pinsino stack)

All use `SafeAreaView` + `ScreenHeader` + `ScrollView`/`FlatList` with `RefreshControl` from
`useRefresh(reload)`; theme via `colors/fonts/radius`.

### `app/src/screens/BountyBoardScreen.tsx` (new) — the hub + board (design §29.1)

- Section list from `useBountyBoardData`: **Open bounties** (the board), **My sponsored**,
  **My hunted**, **Settled** history.
- Each board card (design §29.1): title; sponsor identity (Pinsino or player); bounty type;
  sponsor bounty amount; hunter stake amount; hunter count; close time; **next hunter
  profit**; status; "you entered" / "you sponsor" badges; tap → `BountyDetail`.
- Primary CTA: **"Post a Bounty"** → `BountyCreate`.

### `app/src/screens/BountyDetailScreen.tsx` (new) — detail (design §29.2, §29.5)

From `useBountyDetail`:
- Title, description, sponsor, sponsor bounty + hunter stake amounts, close time, status.
- **Hunter list** with entry numbers and each hunter's protected profit; current total
  protected profit; **current estimated House seed**.
- **Payout previews** for sponsor win and hunter win (§4).
- **Ledger events** (from `bountyLedger`): sponsor-stake / hunter-stake / payout rows w/ signs.
- After settlement: winning side, **admin settlement reasoning** (public, design §34.3),
  total sponsor bounty / hunter stakes / protected profit / **final House seed** / final
  payouts (design §29.5).
- Action button by viewer + status: **"Join the Hunt"** (open, not sponsor, not already in)
  → `BountyEntryModal`; otherwise none.

### `app/src/screens/BountyCreateScreen.tsx` (new) — sponsor creation (design §25.1.1, §29.4)

Player-facing form fields only (design §25.1.1): **Title**, **Description**, **Sponsor bounty
amount**, **Hunter stake amount**, **Close time** (defaulted via `defaultBountyCloseAt`).
Do **not** expose house-seed mode, seed controls, or admin settlement fields.

Live preview (design §29.4): "You are risking S pins. Hunters stake H pins each. Hunter #1
profit if hunters win: +S. Hunter #2: +floor(S/2). Hunter #3: +floor(S/3). More hunters get
progressively lower protected profit. The Pinsino seeds the pot if needed to protect early
hunters." Plus the integrity disclaimer: **"This does not affect bowling gameplay."**

Client validation mirrors the RPC: title ≤80 / description ≤1000 chars; `S ≥ 50`; `H ≥ 25`;
`S ≤ balance`; `closes_at > now`. Submit → `bountyPosts.createSponsor` → toast + navigate to
the new `BountyDetail`.

### `app/src/components/BountyEntryModal.tsx` (new) — hunter confirm (design §16, §29.3)

Modeled on `SettleBetModal` / `PvpAcceptModal` (bottom sheet, `<Toast/>` inside, mounted
conditionally so it resets between opens, disabled-while-saving). Before entry, show the
exact anti-dilution copy (design §29.3):

```
You are joining as Hunter #N.
You will stake H pins.
If hunters win, you receive H + P pins total.
Your protected profit is +P pins.
Additional hunters will not reduce your payout.
An admin will manually settle this bounty based on the posted description.
```

Confirm → `bountyPosts.enter(bountyId)` → toast + `reload` + close. Handle the RPC's race
losers gracefully (e.g. "Bounty closed" / "Already entered") — the entry number shown is an
estimate until the server assigns it.

---

## 6. Wiring

### `app/src/screens/PinsinoScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '🎯', label: 'Bounties', route: 'BountyBoard' }`.
  Extend the `MENU_TILES` route union to include `'BountyBoard'`.

### `app/src/screens/PinsinoAdminScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '🎯', label: 'Bounties', route: 'BountyAdmin' }`.
  Extend its route union to include `'BountyAdmin'`.

### Navigation
- `app/src/navigation/types.ts`:
  - `PinsinoStackParamList`: add `BountyBoard: undefined`,
    `BountyCreate: undefined`, `BountyDetail: { bountyId: string }`.
  - `MoreStackParamList`: add `BountyAdmin: undefined`.
- `app/src/navigation/PinsinoStackNavigator.tsx`: register `BountyBoard`, `BountyCreate`,
  `BountyDetail` (titles "Bounties", "Post a Bounty", "Bounty").
- `app/src/navigation/MoreStackNavigator.tsx`: register `BountyAdmin` → `BountyAdminScreen`
  (title "Bounty Admin").

### Ledger rendering — bounty-aware rows
`app/src/components/LedgerRow.tsx`: add action labels for the three new `pin_ledger` types,
for both perspectives (player vs house). These are transfers with no bet graph — render as
**static rows** (like `score_credit` / loan / PvP rows), not tappable bet rows:
- `bounty_sponsor_stake` → player "BOUNTY POSTED", house "BOUNTY ESCROW"
- `bounty_hunter_stake` → player "JOINED A HUNT", house "BOUNTY ESCROW"
- `bounty_payout` → player "BOUNTY WIN", house "BOUNTY PAYOUT"

Confirm the new types flow through the `LedgerEntry` normalization in
`usePlayerPinsinoData.ts` / `useHousePinsinoData.ts` (unknown types pass through with their
raw `description`) and that `LedgerRow` labels them. Optionally make a bounty pin row
tappable → `BountyDetail` via its `bounty_post_id`; not required for v1.

---

## 7. Admin screen (create House bounty + close / settle / cancel — design §30)

### `app/src/screens/BountyAdminScreen.tsx` (new, More stack)
- Admin gate (`useAuthStore(s => s.role) === 'admin'`, else an admins-only message, matching
  the other admin screens).
- List all bounties for the current season (`bountyPosts.listBySeason`), filterable by status
  / type / week (`PillFilter`). Each row: title, sponsor (Pinsino/player), type, amounts,
  hunter count, status; tap → detail.
- **Create House bounty** button → a form (Title / Description / Sponsor bounty amount /
  Hunter stake amount / Close time) → `bountyPosts.createHouse` → toast + reload.
- Per-bounty admin actions (in a modal, `<Toast/>` inside):
  - **Close** (open → closed) → confirm → `bountyPosts.close(id)` → toast + reload. Optional —
    settling no longer requires a prior close.
  - **Settle** (any non-`settled` bounty — `open` or `closed`) → pick **Sponsor Wins** or
    **Hunters Win** + required `admin_settlement_reasoning` (with the payout preview from §4
    shown — the admin **never** enters amounts, design §8, §25.5) →
    `bountyPosts.settle(id, outcome, reasoning)` → toast + reload. Backed by migration
    `…222000_bounty_settle_anytime` (the RPC accepts `open`/`closed`).
  - **Cancel** (destructive, **any** state incl. `settled`) → confirm with a clear "this
    erases the bounty economically and publicly" warning → `bountyPosts.cancel(id)` → toast +
    reload. Post-settlement this claws back the distributed payouts (the copy adapts for the
    `settled` case). Mirror the cancel UX in `PvPAdminScreen` / `PinsinoSportsbookScreen`.
- Show escrow held + hunter list per bounty (reuse the detail components).

---

## 8. Market Moves (Activity Feed) app side — design §24

The feed rows are written server-side; the app only needs to render them. In the existing
Market Moves files:
- `app/src/hooks/useMarketMovesData.ts`: add `bountySourceId` to `FeedEventView` +
  `normalizeFeedRow` (off `row.bounty_post_id`); add a `'bounty_board'` value to `FeedFilter`
  + `fetchPage` if you want a dedicated tab.
- `app/src/utils/activityFeedTemplates.ts`:
  - `FEATURE_META`: add `bounty_board → { icon: '🎯', sourceLabel: 'Bounty Board' }`.
  - `renderFeedEvent`: add a `case` for each of the five `bounty_board.*` template keys,
    returning `FeedRenderParts` (copy from design §24.3 — e.g. `bounty_board.bounty_posted`
    → "{actor} posted a bounty: "{bounty_title}."" with the Pinsino as actor when
    `actor` is absent; `bounty_board.hunters_won` → "The hunters got paid on
    "{bounty_title}."" with a pot/seed badge). Keep copy short, playful, public-safe; the
    `bounty_title` comes from `public_payload`, never stored rendered text.
- `app/src/screens/MarketMovesScreen.tsx`: wire the new filter chip if added; privacy-aware
  tap-through keys off the `bounty_post_id` source FK → `BountyDetail`.

The renderer's `default` branch already keeps an older client from crashing on an unknown
`template_key` (forward-compatible by construction).

---

## 9. Out of v1 scope (do not build)

- **Auto-settlement** / machine-readable conditions (design §6) — all settlement is manual.
- **Void outcome** (design §9) — use destructive cancel instead.
- **Rake / House fees** (design §17.3).
- **Hunter comments / discussion threads / counteroffers** (design §6).
- **Multiple entries per player**, **sponsor self-cancel after hunters enter**, **partial
  refunds** (design §6).
- **Notification badges** for bounties — not part of the Pinsino notification framework in
  v1 (the board + pull-to-refresh are the surfaces). Add later if desired.

---

## 10. v1 defaults baked into this spec (resolving design §34)

| # | Question | v1 default |
|---|---|---|
| §34.1 | Title / description length | **80 / 1000 chars** (client + matches RPC) |
| §34.2 | Hunter-join feed volume | **First hunter join only** (the `(bounty_post_id, event_type)` unique index gives this for free; always call publish) |
| §34.3 | Settlement reasoning visibility | **Public** on the bounty detail page |
| §34.4 | House seed reporting | **Estimate before settlement** + **final snapshot after** |
| §34.5 | Stake limits | **Min sponsor 50, min hunter 25; no hard max** (capped by balance) |
| §34.6 | Admin audit log | **Deferred** (reuse a general admin audit log if one exists; don't keep cancelled `bounty_post` rows) |

---

## 11. Verification (manual, Expo dev server — no test suite)

Run `expo start` from `app/`. Use a throwaway / non-prod season. Pair with the DB spec's SQL
checks (`BOUNTIES_DB.md` §5).

1. **Tiles** — Bounties tile appears on the Pinsino hub; Bounties tile appears on Pinsino
   Admin (admin only).
2. **Sponsor create** — posting a sponsor bounty shows the anti-dilution preview + "does not
   affect bowling" disclaimer; submitting drops the sponsor's balance by `S`, lists the
   bounty on the board, and shows a "Bounty posted" Market Moves card.
3. **Hunter entry** — the entry modal shows the correct "Hunter #N / stake H / protected
   +P / total H+P / additional hunters won't reduce your payout"; confirming drops the
   hunter's balance by `H` and increments the hunter count + estimated seed; the sponsor
   cannot join their own bounty; a second join by the same player is blocked.
4. **House bounty (admin)** — creating a House bounty from the admin screen leaves all
   balances unchanged (no escrow) and lists it as "Posted by the Pinsino".
5. **Settle sponsor win** — admin closes then settles Sponsor Wins with reasoning: the
   sponsor's balance rises by `total_pot` (incl. seed); hunters keep nothing; the detail page
   shows the public reasoning + final seed; a "sponsor won" feed card appears.
6. **Settle hunter win** — settling Hunters Win pays each hunter `stake + protected_profit`;
   the detail page shows per-hunter payouts + final House seed; a "hunters won" feed card
   appears.
7. **Cancel** — destructive cancel removes the bounty from the board, the players' history,
   and the feed; balances reflect the escrow having been erased (as if it never happened).
8. **Ledger labels** — player PlayerPinsino activity and house Accounting activity show
   bounty rows with the correct labels/signs (§6).
9. **Integrity** — confirm nothing in this flow touches league standings, team results, or
   scores; a player who neither sponsors nor hunts has zero bounty exposure (design §28.1).

---

> After creating this file and `BOUNTIES_DB.md`, add their two rows to the "Economy design &
> feature specs" table in `AGENTS.md` (mirroring the PvP rows) so they are discoverable.
```
