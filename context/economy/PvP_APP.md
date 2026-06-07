# PvP Challenge Contracts — App Implementation Spec

Handoff spec for the **app layer** (`app/src`) of the PvP Challenge Contracts feature.

> **⚠️ No rake — winner takes the whole pot.** The DB layer was built without any
> house cut: there is no `pvp_rake` `pin_ledger` type, no `rake` column, and the
> winner is paid the **full `total_pot`** (`payout_amount` always equals `total_pot`).
> Wherever this spec originally said "rake" / "net payout", read it as **"pot" /
> "winner's payout = pot"**.
>
> **⚠️ No expiry; Prop Duel hidden in the UI.** Challenges no longer expire on a
> clock — there is no `expires_at` / `p_expires_at` anywhere. A challenge stays open
> until the admin presses **Start Game** on Matchups (closes that game's open
> challenges) or the week is settled. Ignore every "expiration" mention below. Also,
> **Prop Duel is dropped from the UI for now** (not in `CONTRACT_TYPE_OPTIONS` or the
> board filter); the DB still supports `prop_duel`. See `PvP_DB.md` for the as-built
> design.

**Prerequisite:** the database spec (`economy/PvP_DB.md`) is fully applied
(`supabase db push`) **and** `app/src/utils/supabase/database.types.ts` has been
regenerated — follow the type-regeneration step in `PAGE_CREATION.md`. These must exist
in the generated types before starting:
- Tables `pvp_challenges`, `pvp_challenge_offers`, `pvp_ledger`.
- Column `pin_ledger.pvp_ledger_id` and the three new `pin_ledger.type` values
  (`pvp_stake`/`pvp_payout`/`pvp_refund` — there is no `pvp_rake`).
- RPCs `create_pvp_challenge`, `counter_pvp_challenge`, `accept_pvp_challenge`,
  `decline_pvp_challenge`, `cancel_pvp_challenge`, `void_pvp_challenge`,
  `settle_pvp_challenge`.

**Read first:** `economy/ECONOMIC_DESIGN_PvP.md` (§ refs below point to it) and the
"Pinsino" / "Betting display components" sections of `AGENTS.md`. The Loan Shark app
spec (`economy/LOAN_SHARK_APP.md`) is the closest existing analog — read it for the
worked hook/screen/modal/wiring patterns. Mirror existing patterns: hook → `useMemo` →
screen, `useRefresh(reload)`, a `<Toast/>` inside every `<Modal>`, RPC-then-`reload`,
admin gate via `useAuthStore(s => s.role) === 'admin'`.

## Scope (v1 — design §10 MVP)
Three contract types (**Line Duel**, **Player Prop Duel**, **Raw Score Duel**), the
**Open Challenge Board**, **counteroffers**, escrow (winner takes the whole pot — no
rake), auto-settlement
(server-side on archive — the app just reflects results), **admin manual-settle / cancel
/ void**, and **double-or-nothing rematch**. **No activity feed, no push notifications**
in v1 (§6 below) — the inbox, board, contract detail, and pull-to-refresh are the social
surfaces.

**Pattern templates to copy from:**
- Data hook: `app/src/hooks/usePinsinoData.ts`, `usePlayerPinsinoData.ts` (fetch → flatten;
  no memo in hook).
- Action modal: `app/src/components/SettleBetModal.tsx` (bottom sheet, `<Toast/>` inside,
  RPC→toast→`onDone`→`onClose`); `AdminEndSeasonModal.tsx` (centered confirm card,
  disabled-while-saving).
- Hub screen + tiles: `app/src/screens/PinsinoScreen.tsx`, `PinsinoAdminScreen.tsx`.
- Admin list + cancel UX: `app/src/screens/PinsinoSportsbookScreen.tsx`.
- Opponent picker: `app/src/components/PlayerPickerModal.tsx`.
- db.ts query objects + RPC wrappers: `app/src/utils/supabase/db.ts`.
- Ledger row rendering: `app/src/components/LedgerRow.tsx`.

---

## 1. `db.ts` — query objects + RPC wrappers

In `app/src/utils/supabase/db.ts`, add two query objects following the existing shape
(each method returns the supabase query/`rpc` builder; RPC params use the `p_` prefix as
in `bets.place` / `loans.take`).

```ts
export const pvpChallenges = {
  // Inbox: everything involving this player for the current season.
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('pvp_challenges')
      .select('*, creator:players!pvp_challenges_creator_player_id_fkey(name), ' +
              'counterparty:players!pvp_challenges_counterparty_player_id_fkey(name)')
      .eq('season_id', seasonId)
      .or(`creator_player_id.eq.${playerId},counterparty_player_id.eq.${playerId}`)
      .order('created_at', { ascending: false }),

  // Open Challenge Board: open contracts awaiting any taker.
  listOpenBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select('*, creator:players!pvp_challenges_creator_player_id_fkey(name)')
      .eq('season_id', seasonId)
      .is('counterparty_player_id', null)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),

  // Admin: active/locked contracts for the season.
  listLockedBySeason: (seasonId: string) =>
    supabase.from('pvp_challenges')
      .select('*, creator:players!pvp_challenges_creator_player_id_fkey(name), ' +
              'counterparty:players!pvp_challenges_counterparty_player_id_fkey(name)')
      .eq('season_id', seasonId)
      .in('status', ['pending', 'countered', 'locked'])
      .order('created_at', { ascending: false }),

  // Detail page: one contract with its full negotiation trail + ledger.
  getById: (challengeId: string) =>
    supabase.from('pvp_challenges')
      .select('*, creator:players!pvp_challenges_creator_player_id_fkey(name), ' +
              'counterparty:players!pvp_challenges_counterparty_player_id_fkey(name), ' +
              'pvp_challenge_offers(*), pvp_ledger(*, weeks(week_number))')
      .eq('id', challengeId).single(),

  create:  (args: CreatePvpArgs)                 => supabase.rpc('create_pvp_challenge', { ...mapCreate(args) }),
  counter: (args: CounterPvpArgs)                => supabase.rpc('counter_pvp_challenge', { ...mapCounter(args) }),
  accept:  (challengeId: string)                 => supabase.rpc('accept_pvp_challenge',  { p_challenge_id: challengeId }),
  decline: (challengeId: string)                 => supabase.rpc('decline_pvp_challenge', { p_challenge_id: challengeId }),
  cancel:  (challengeId: string)                 => supabase.rpc('cancel_pvp_challenge',  { p_challenge_id: challengeId }),
  void:    (challengeId: string, note: string)   => supabase.rpc('void_pvp_challenge',    { p_challenge_id: challengeId, p_admin_note: note }),
  settle:  (challengeId: string, winnerId: string | null, note: string) =>
    supabase.rpc('settle_pvp_challenge',
      { p_challenge_id: challengeId, p_source: 'admin', p_winner_player_id: winnerId, p_admin_note: note }),
}

export const pvpLedger = {
  listByPlayerSeason: (playerId: string, seasonId: string) =>
    supabase.from('pvp_ledger').select('*, weeks(week_number)')
      .eq('player_id', playerId).eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
}
```

> Confirm the exact FK-constraint names for the `creator:`/`counterparty:` embeds against
> the regenerated types (Supabase names them `<table>_<column>_fkey`); the two-FK-to-
> `players` disambiguation **requires** the explicit `!fkey` hint. If an embed is awkward,
> fetch player names separately and join client-side (as some hooks already do). The
> `mapCreate`/`mapCounter` helpers translate the screen's form shape to the RPC's `p_*`
> params (`p_contract_type`, `p_counterparty_player_id`, `p_week_id`, `p_game_number`,
> `p_stake`, `p_prop_market_id`, `p_creator_selection`, `p_message`).

Reuse existing wrappers where they exist: `seasons.getCurrent()`, `weeks.getCurrent()`,
`players.list()` (opponent picker), `pinLedger.listByPlayerSeason` (balance), and the
sportsbook `betMarkets` reads (Prop Duel market selection).

---

## 2. Hooks

No memoization in hooks (project rule); screens derive display via `useMemo`.

### `app/src/hooks/usePvpData.ts` (new)
`usePvpData(playerId)` returns:
```ts
{
  loading: boolean
  balance: number                       // season-scoped pin balance (for stake validation)
  inbox: {
    received: PvpChallengeView[]         // pending/countered where it's my turn
    sent: PvpChallengeView[]             // pending/countered I'm waiting on
    active: PvpChallengeView[]           // locked
    settled: PvpChallengeView[]          // settled/pushed/voided/cancelled/expired
  }
  openBoard: PvpChallengeView[]          // open contracts I can accept (excludes my own)
  record: { wins: number; losses: number; pushes: number }   // §11/§8.5; pushes counted separately (v1)
  reload: () => Promise<void>
}
```
- Resolve current season (`seasons.getCurrent()`), balance
  (`pinLedger.listByPlayerSeason` sum), all challenges involving the player
  (`pvpChallenges.listByPlayerSeason`) bucketed into the inbox lanes by status + whose
  turn it is (the open offer's `offered_by_player_id` vs `playerId`), the open board
  (`pvpChallenges.listOpenBySeason`, filter out the caller's own), and derive the
  challenge record from settled rows (`winner_player_id` vs `playerId`; status `pushed`
  → push).

### `app/src/hooks/usePvpChallengeDetail.ts` (new)
`usePvpChallengeDetail(challengeId)` returns `{ loading, challenge, offers, ledger,
reload }` from `pvpChallenges.getById`. `offers` sorted by `offer_no`; `ledger` newest-
first. The screen derives the "current actionable state for the viewer" (accept /
decline / counter / rematch / nothing) via `useMemo` from `challenge.status`, the latest
active offer, and the viewer's role.

---

## 3. Screens (Pinsino stack)

All use `SafeAreaView` + `ScreenHeader` + `ScrollView`/`FlatList` with
`RefreshControl` from `useRefresh(reload)`; theme via `colors/fonts/radius`.

### `app/src/screens/PvPScreen.tsx` (new) — the hub
Layout (design §8.2):
- **Challenge record** summary card (W–L–P) from `usePvpData().record`.
- **Inbox** sections: Received (action needed), Sent (awaiting), Active (locked),
  Settled (history). Each row = a `PvpChallengeRow` showing type, opponent, stake/pot,
  status, and a status-appropriate CTA; tap → `PvPChallengeDetail`.
- Two primary entry points: **"New Challenge"** → `PvPCreate`, **"Challenge Board"** →
  `PvPBoard`.

### `app/src/screens/PvPBoardScreen.tsx` (new) — open marketplace (design §8.3)
- List open contracts (`usePvpData().openBoard`): contract type, creator, stake, **pot
  (= winner's payout)**, game/week scope, expiration.
- Filters (type / stake / week / creator) — reuse `PillFilter` / `ToggleGroup`.
- Per row: **Accept** (→ accept-confirm modal) and **Counter** (→ counteroffer modal).
- **"Post Open Challenge"** button → `PvPCreate` with opponent unset (open board).

### `app/src/screens/PvPCreateScreen.tsx` (new) — creation flow (design §8.1)
Form fields:
- **Opponent**: a specific player (via `PlayerPickerModal`) **or** "Open board" toggle.
- **Contract type**: Line Duel / Prop Duel / Raw Score Duel (`ToggleGroup`).
- **Scope**: current week (default; cannot create after week lock — v1) + **game number**
  (required for Line/Raw; Prop Duel picks an existing market instead).
- **Prop Duel only**: pick the subject's open `bet_market` + the creator's side
  (`over`/`under`); reuse the sportsbook market reads + `OddsBlock` for display.
- **Stake** (numeric; min 10, ≤ balance — client mirror of the RPC).
- **Optional message**, **expiration** (default = week lock = `bowled_at`).
- **Confirmation panel** (always shown before submit — design §8.1, §4.3): **stake
  required, total pot (= the winner's payout — winner takes all, no rake), the settlement
  rule in plain words, lock time, and "This does not affect bowling gameplay — always
  no."** Submit → `pvpChallenges.create` → toast + navigate to the new detail page.

### `app/src/screens/PvPChallengeDetailScreen.tsx` (new) — contract detail (design §8.4)
From `usePvpChallengeDetail`:
- Status badge, participants, terms, **pot (= winner's payout)**, settlement condition,
  and (Line Duel) the **snapshot lines** for each side.
- **Offer / counteroffer history** (from `pvp_challenge_offers`, oldest→newest): who
  offered, which terms changed, message, timestamp, accepted/declined/superseded marker
  (design §6.4).
- **Ledger events** (from `pvp_ledger`): stake / payout / refund rows with signs.
- **Result** when settled: each side's score + net-vs-line from `result_detail`; winner.
- **Admin note** when present.
- Action buttons by status + viewer role: **Accept / Decline / Counter** (when it's the
  viewer's turn), **Rematch** (loser of a settled contract — opens create prefilled,
  double stake, same type), or none.

### Counteroffer modal + Accept-confirm modal (`app/src/components/`)
Both modeled on `SettleBetModal` (bottom sheet, `<Toast/>` inside, mounted conditionally
so they reset between opens, disabled-while-saving).
- **`PvpAcceptModal`**: re-displays the full revised terms and **recomputed
  stake/pot (= payout)** before acceptance (design §6.3 — accepting = accepting the
  full revised contract). Confirm → `pvpChallenges.accept` → toast + `reload` + close.
- **`PvpCounterModal`**: form for the counter-able terms (stake, type, scope/game,
  selection, optional shorter expiration, message) with the recomputed pot/payout
  shown live. Confirm → `pvpChallenges.counter` → toast + `reload` + close.

---

## 4. Wiring

### `app/src/screens/PinsinoScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '⚔️', label: 'PvP', route: 'PvP' }`. Extend the
  `MENU_TILES` route union type to include `'PvP'`.

### `app/src/screens/PinsinoAdminScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '⚔️', label: 'PvP', route: 'PvPAdmin' }`. Extend
  its route union to include `'PvPAdmin'`.

### Navigation
- `app/src/navigation/types.ts`:
  - `PinsinoStackParamList`: add `PvP: undefined`, `PvPBoard: undefined`,
    `PvPCreate: { opponentId?: string; rematchOfId?: string } | undefined`,
    `PvPChallengeDetail: { challengeId: string }`.
  - `MoreStackParamList`: add `PvPAdmin: undefined`.
- `app/src/navigation/PinsinoStackNavigator.tsx`: register `PvP`, `PvPBoard`,
  `PvPCreate`, `PvPChallengeDetail` (titles "PvP", "Challenge Board", "New Challenge",
  "Challenge").
- `app/src/navigation/MoreStackNavigator.tsx`: register `PvPAdmin` → `PvPAdminScreen`
  (title "PvP Admin").

### Ledger rendering — PvP-aware rows
`app/src/components/LedgerRow.tsx`: add action labels for the three new `pin_ledger` PvP
types, for both perspectives (player vs house):
- `pvp_stake` → player "CHALLENGE STAKE", house "CHALLENGE ESCROW"
- `pvp_payout` → player "CHALLENGE WIN", house "CHALLENGE PAYOUT"
- `pvp_refund` → player "CHALLENGE REFUND", house "REFUND ISSUED"

These are transfers with no `bet` graph, so render them as **static rows** (like
`score_credit`/loan rows), not tappable bet rows. In `usePlayerPinsinoData.ts` /
`useHousePinsinoData.ts`, the existing `LedgerEntry` normalization passes unknown types
through with their raw `description`; confirm the new types flow through and `LedgerRow`
labels them. Optionally make a PvP pin row tappable → navigate to its
`PvPChallengeDetail` (look up `challenge_id` via `pvp_ledger`); not required for v1.

---

## 5. Admin (manual settle + cancel/void) — design §14

### `app/src/screens/PvPAdminScreen.tsx` (new, More stack)
- Admin gate (`useAuthStore(s => s.role) === 'admin'`, else an admins-only message,
  matching the other admin screens).
- List active/locked contracts for the current season
  (`pvpChallenges.listLockedBySeason`), filterable by status / week / type (`PillFilter`).
  Each row: type, both players, pot, status; tap → detail.
- Per-contract admin actions (in a modal, `<Toast/>` inside):
  - **Manual Settle** — pick winner (creator / counterparty / **push** / **void**) →
    `pvpChallenges.settle(id, winnerId|null, note)` (push/void map to the appropriate
    server outcome) → toast + reload.
  - **Cancel** (pre-settlement) → confirm → `pvpChallenges.cancel(id)` → toast + reload.
    Mirror the cancel UX in `PinsinoSportsbookScreen`.
  - **Void** → confirm + note → `pvpChallenges.void(id, note)` → toast + reload.
- Show escrow held and the offer history per contract (reuse the detail components).

### `app/src/screens/PinsinoAdminScreen.tsx`
- Already covered in §4 (tile added).

> **Season close:** PvP auto-settlement runs server-side via `settle_betting_for_week`
> on each week's archive, so by season end all auto-settleable contracts are resolved.
> Any still-`locked` contracts (e.g. a week never archived) should be settled or voided
> by the admin before close. **No change to `AdminEndSeasonModal` is required for v1**;
> if a guard is wanted, surface a count of unsettled PvP contracts there.

---

## 6. Out of v1 scope (do not build)

- **Activity / social feed** events (design §7.6, §13) and **King of the Hill / rivalry
  milestones** — no feed table exists; deferred to a later phase.
- **Push / in-app notifications** (design §7.5) — none exist; v1 relies on the inbox +
  pull-to-refresh. Deferred.
- **Later contract types**: Series, Spread, Accuracy, Call-Your-Shot, Side Pot, Rivalry,
  King of the Hill (design §11.3–§11.6, §11.9, §11.11–§11.12). The schema supports them;
  the UI/RPC branches are a later phase.
- **Asymmetric / spread stakes**, **mute/block challenge requests**, **challenge-spam
  rate-limiting / message moderation** (design §6.x, §9.7, §9.15). v1 = symmetric stakes,
  free-text messages, admin void as the only moderation lever.

---

## 7. v1 defaults baked into this spec (resolving design §15)

| # | Question | v1 default |
|---|---|---|
| 1 | Min stake | **10 pins** |
| 2–3 | Max stake | **No hard max**; capped by available balance |
| 4 | Asymmetric stakes | **No** — symmetric only (schema allows future) |
| 5 | Open board acceptance | **First-come-first-served**, exact posted terms unless countered |
| 6 | Multiple challenges vs same opponent | **Allowed** |
| 7 | Mute/block | **Deferred** |
| 8 | Declines in feed | **Never** (no feed in v1) |
| 9 | Counteroffer history visibility | **Fully visible** on the contract detail page |
| 10 | Line frozen when? | **Snapshot at acceptance** (server-side) |
| 11 | Contracts after games start | **No** — cannot create after the week lock |
| 13 | Rematch type | **Inherits original type**, double stake, both must accept |
| 14 | Messages moderated? | **Free text**, admin void as the lever (no templates) |
| 15 | Pushes in record | **Counted separately** from W/L |

---

## 8. Verification (manual, Expo dev server — no test suite)

Run `expo start` from `app/`. Use a throwaway/non-prod season. Pair with the DB spec's
SQL checks (`PvP_DB.md` §6).

1. **Tiles** — PvP tile appears on the Pinsino hub; PvP tile appears on Pinsino Admin
   (admin only).
2. **Create** — creating a direct Line Duel shows the confirmation panel with correct
   stake / pot (= winner's payout) / settlement rule / lock time / "does not
   affect bowling"; submitting leaves balances unchanged (no escrow yet) and the contract
   appears in the creator's Sent and the opponent's Received.
3. **Counter** — countering recomputes and displays pot/payout; the prior offer is
   marked superseded in the detail history; only the latest offer is acceptable.
4. **Accept** — accepting escrows both stakes (both balances drop by the stake; net
   unchanged conceptually until settle); status flips to Active/locked; Line Duel snapshot
   lines show on the detail page.
5. **Open board** — posting an open challenge lists it on the Board with pot/payout;
   a different player accepts it FCFS; it leaves the board.
6. **Settle (archive)** — archiving the contract's week auto-settles it: winner's balance
   rises by the full pot, loser's stake is gone, the detail page shows both scores/nets and
   the winner; the ledger shows stake/payout rows. A tied Line Duel pushes and
   refunds both.
7. **Ledger labels** — borrower/player PlayerPinsino Activity and the house Accounting
   Activity show PvP rows with correct labels/signs; the house nets 0 per settled contract.
8. **Rematch** — the loser of a settled contract can open a Rematch (prefilled, same type,
   double stake); the other player accepts/declines/counters.
9. **Admin** — admin can manual-settle (pick winner / push / void), cancel a pre-
   settlement contract (escrow reverts), and void a locked contract (both refunded);
   each action toasts and reloads.
10. **Integrity** — confirm nothing in this flow touches league standings, team results,
    or scores (read-only against `scores`/`weeks`); a player with no accepted contract has
    zero PvP exposure (design §2).

---

> After creating this file and `PvP_DB.md`, add their two rows to the
> "Economy design & feature specs" table in `AGENTS.md` (mirroring the Loan Shark rows)
> so they are discoverable.
