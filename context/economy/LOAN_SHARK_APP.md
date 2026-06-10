# Loan Shark — App Implementation Spec

Handoff spec for the **app layer** (`app/src`) of the Loan Shark feature.

**Prerequisite:** the database spec (`economy/LOAN_SHARK_DB.md`) is fully applied
(`supabase db push`) **and** `app/src/utils/supabase/database.types.ts` has been
regenerated — follow the type-regeneration step in [page-creation.md](../page-creation.md). The new
tables (`loan_products`, `loans`, `loan_ledger`), the `pin_ledger.loan_ledger_id`
column, and the RPCs (`take_loan`, `repay_loan`, `cancel_loan`,
`settle_loans_for_season_close`) must exist in the generated types before starting.

**Read first:** `economy/ECONOMIC_DESIGN_DEBT.md` (§ refs below point to it) and the
"Pinsino" / "Betting display components" sections of `AGENTS.md`. Mirror existing
patterns — hook → `useMemo` → screen, `useRefresh(reload)`, a `<Toast/>` inside
every `<Modal>`, RPC-then-`reload`, admin gate via `useAuthStore(s => s.role) === 'admin'`.

**Pattern templates to copy from:**
- Data hook: `app/src/hooks/usePinsinoData.ts`, `usePlayerPinsinoData.ts`.
- Action modal: `app/src/components/SettleBetModal.tsx` (bottom sheet, `<Toast/>` inside, RPC→toast→`onSettled`→`onClose`); `AdminEndSeasonModal.tsx` (centered confirm card, disabled-while-saving).
- Hub screen + tiles: `app/src/screens/PinsinoScreen.tsx`, `PinsinoAdminScreen.tsx`.
- Admin list + cancel: `app/src/screens/AdminSportsbookScreen.tsx`.
- db.ts query objects + RPC wrappers: `app/src/utils/supabase/db.ts`.

---

## 1. `db.ts` — query objects + RPC wrappers

In `app/src/utils/supabase/db.ts`, add three query objects following the existing
shape (each method returns the supabase query/`rpc` builder; RPC params use the
`p_` prefix as in `bets.place` / `betMarkets.settle`).

```ts
export const loanProducts = {
  list: () => supabase.from('loan_products').select('*').order('sort_order'),
  listAvailable: () =>            // is_active filter; full availability is re-checked server-side
    supabase.from('loan_products').select('*').eq('is_active', true).order('sort_order'),
}

export const loans = {
  listByPlayer: (playerId: string) =>
    supabase.from('loans').select('*, loan_products(*)').eq('player_id', playerId)
      .order('issued_at', { ascending: false }),
  listActiveBySeason: (seasonId: string) =>   // feeds net-worth leaderboard
    supabase.from('loans').select('id, player_id').eq('season_id', seasonId).eq('status', 'active'),
  take:  (productId: string)          => supabase.rpc('take_loan',  { p_loan_product_id: productId }),
  repay: (loanId: string, amount: number) => supabase.rpc('repay_loan', { p_loan_id: loanId, p_amount: amount }),
  cancel:(loanId: string)             => supabase.rpc('cancel_loan', { p_loan_id: loanId }),
}

export const loanLedger = {
  listByPlayerSeason: (playerId: string, seasonId: string) =>   // borrower payment history
    supabase.from('loan_ledger').select('*, weeks(week_number)')
      .eq('player_id', playerId).eq('season_id', seasonId)
      .order('created_at', { ascending: false }),
  listActiveBySeason: (seasonId: string) =>   // debt-per-player for the leaderboard
    supabase.from('loan_ledger').select('player_id, amount, loan_id, loans!inner(status)')
      .eq('season_id', seasonId).eq('loans.status', 'active'),
}
```

Add a `seasons.settleLoansForClose` (or extend the existing season-close call site)
wrapper: `supabase.rpc('settle_loans_for_season_close', { p_season_id })`.

> Confirm the exact embed syntax for `loan_ledger → loans` against the regenerated
> types; the `loans!inner(status)` filter mirrors how `pinLedger.listBySeasonForLeaderboard`
> joins `players`. If the embed filter is awkward, instead fetch active loan ids via
> `loans.listActiveBySeason` and sum `loan_ledger` rows for those loan ids client-side.

---

## 2. Net worth on the leaderboard (v1) — design §8.1

### `app/src/hooks/usePinsinoData.ts`
- Fetch per-player active-loan debt for the current season (`loanLedger.listActiveBySeason`),
  build a `debtByPlayer: Record<playerId, number>` (sum of `amount`).
- Extend each leaderboard entry with `debt` and `netWorth = balance − debt`, and
  **change the sort key to `netWorth`** (descending). Keep `potential` (upside) for
  the existing Upside column. Update the `LeaderboardEntry` type accordingly (the
  movement/`priorBalance` logic stays as-is — it can keep ranking on balance or be
  switched to net worth; keep on balance for v1 to avoid churn unless trivial).
- Also surface the **caller's own** figures in the hook's return: `debt` (their
  active-loan outstanding) and an `activeLoan` summary (or `null`). `netWorth = balance − debt`.

### `app/src/components/PinsinoLeaderboardTable.tsx`
- Add two right-aligned columns between **Pins** and **Upside** (design §8.1):
  **Debt** (rendered in `colors.danger`, shown as `−N` or blank when 0) and **Net**
  (`colors.text`, or `colors.danger` when negative). Reuse the existing
  `sbHeaderCell` / right-aligned cell styles; match the 56-width column pattern.
- This single component change covers both consumers — the `PinsinoScreen` top-3
  preview (`limit={3}`) and the full `PinsinoLeaderboardScreen`.

---

## 3. Borrower hook + screen

### `app/src/hooks/useLoanSharkData.ts` (new)
`useLoanSharkData(playerId)` returns:
```ts
{
  loading: boolean
  balance: number                 // player's pin balance (reuse the season-scoped sum)
  products: LoanProductView[]     // available products (with derived `available` flag)
  activeLoan: ActiveLoanView | null   // { loanId, product, outstanding, paymentHistory: DebtLedgerEntry[] }
  reload: () => Promise<void>
}
```
- Resolve current season (`seasons.getCurrent()`), player balance (sum
  `pinLedger.listByPlayerSeason`), the player's loans (`loans.listByPlayer` → the
  one with `status='active'`), and that loan's `loan_ledger` history
  (`loanLedger.listByPlayerSeason`); outstanding = sum of its `amount`.
- No memoization in the hook (project rule); screen derives display via `useMemo`.

### `app/src/screens/LoanSharkScreen.tsx` (new, Pinsino stack)
Layout (design §8.2):
- **Current loan / debt panel** (when `activeLoan`): product name, outstanding debt,
  weekly interest + garnishment rates (private to borrower, §8.1), a **manual
  repayment form** (numeric input → `loans.repay`), and a collapsible payment
  history from `loan_ledger` (labels per type: BORROWED / REPAYMENT / GARNISHED /
  INTEREST / SEASON-CLOSE).
- **Available products** (when no active loan, since v1 = one loan at a time §3.3):
  one card per available product — borrow amount, weekly interest, garnishment rate,
  risk level, description, special warning text. A **Borrow** button opens the
  mandatory confirmation modal.
- Repayment validation (client mirror of the RPC, §5.7): positive integer,
  `≤ outstanding`, `≤ balance`. Server re-checks regardless.

### Confirmation modal (mandatory, every borrow) — design §8.3
- Bottom-sheet modal modeled on `SettleBetModal`. **Mount conditionally** so it
  resets between opens. `<Toast/>` rendered inside the `<Modal>`.
- Shows: amount borrowed, weekly interest rate, garnishment rate, the "does not
  improve net worth by itself" statement, missed-week warning, season-end warning,
  manual-repayment note, and the product's `special_warning_text` when present
  (the **Blood in the Water** copy, §4.2). General warning copy from §8.3.
- Confirm → `loans.take(productId)` → on error `showToast(error.message,'error')`;
  on success toast + `reload()` + close. **No amortization preview** (§8.4).

---

## 4. Wiring

### `app/src/screens/PinsinoScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '🦈', label: 'Loan Shark', route: 'LoanShark' }`.
- Surface the caller's **debt + net worth** near the balance card (design §8 — net
  worth context): e.g. under "YOUR BALANCE", show "OWED −{debt}" (danger) and "NET
  {netWorth}" when `debt > 0`. Pull `debt`/`netWorth` from `usePinsinoData`.

### Navigation
- `app/src/navigation/types.ts`: add `LoanShark: undefined` to `PinsinoStackParamList`;
  add `LoanSharkAdmin: undefined` to `MoreStackParamList`.
- `app/src/navigation/PinsinoStackNavigator.tsx`: register `LoanShark` → `LoanSharkScreen`.
- `app/src/navigation/MoreStackNavigator.tsx`: register `LoanSharkAdmin` → `LoanSharkAdminScreen`.

### Ledger rendering — loan-aware rows
- `app/src/components/LedgerRow.tsx`: add action labels for the four new `pin_ledger`
  loan types, for both perspectives:
  - `loan_issued` → player "LOAN ADVANCE", house "LOAN ISSUED"
  - `loan_manual_repayment` → "REPAYMENT" / "REPAYMENT RECEIVED"
  - `loan_weekly_garnishment` → "GARNISHED" / "GARNISHMENT"
  - `loan_season_close_settlement` → "SEASON-CLOSE PAYMENT" / "SEASON-CLOSE COLLECTION"
  These are mint-less transfers with no `bet` graph, so render them as **static rows**
  (like `score_credit`/`bonus`), not tappable bet rows.
- `app/src/hooks/usePlayerPinsinoData.ts` + `useHousePinsinoData.ts`: the existing
  `LedgerEntry` normalization already passes unknown types through with their raw
  `description`; just confirm the new types flow through and `LedgerRow` labels them.
  `weekly_interest` lives in `loan_ledger` only, so it appears in the borrower's loan
  payment history (§3), **not** in these pin-ledger Activity views.

---

## 5. Admin (seed + cancel only) — design §12

### `app/src/screens/LoanSharkAdminScreen.tsx` (new, More stack)
- Admin gate (`useAuthStore(s => s.role) === 'admin'`, else an admins-only message,
  matching the other admin screens).
- List active loans (player name, product, outstanding debt). Fetch via a new
  `loans.listActiveDetailed` (or reuse `loans.listActiveBySeason` joined to players +
  summed `loan_ledger`) — add the query to `db.ts` as needed.
- Each row has a destructive **Cancel** (✕) → confirm → `loans.cancel(loanId)` →
  toast + reload. Mirror the cancel UX in `AdminSportsbookScreen`. `<Toast/>` inside
  any modal used.

### `app/src/screens/PinsinoAdminScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '🦈', label: 'Loan Shark', route: 'LoanSharkAdmin' }`.

### `app/src/components/AdminEndSeasonModal.tsx` — season-close settlement (§7)
- **Before** `seasons.update(season.id, { is_active: false })`, call
  `settle_loans_for_season_close(season.id)` (the new wrapper). On error, surface via
  toast and abort (do not close the season). This makes final standings reflect
  post-settlement net worth (design §7.1, steps 5–7).

---

## 6. Out of v1 scope (do not build)

- Loan **product CRUD** admin UI (create/edit/deactivate). Products are seeded by the
  DB migration; the immutability trigger still ships. (Per scope decision.)
- **Activity feed** events (design §8.5 — optional).

---

## 7. Verification (manual, Expo dev server — no test suite)

Run `expo start` from `app/`. Use a throwaway/non-prod season. Pair with the DB
spec's SQL checks.

1. **Tile + borrow flow** — Loan Shark tile appears on the Pinsino hub; tapping a
   product opens the mandatory confirmation modal showing all required disclosures
   (and the Blood-in-the-Water special warning for that product); confirming borrows
   and the balance card jumps by the borrow amount while **Net worth is unchanged**.
2. **Repay** — manual repayment reduces debt; input rejects amounts `> debt` or
   `> balance`; full repayment clears the active loan and re-enables borrowing.
3. **Leaderboard** — `PinsinoLeaderboardTable` (preview + full) shows Debt + Net
   columns and ranks by net worth; a borrower's Pins rise but Net is flat right after
   borrowing.
4. **Ledger** — borrower's PlayerPinsino Activity and the house Accounting Activity
   show the loan rows with correct labels/signs; interest shows in the loan payment
   history (borrower screen), not the pin-ledger Activity.
5. **Admin** — Loan Shark admin tile lists active loans; cancel removes the loan and
   the borrower's balance/debt revert (cross-check with the DB cancel test).
6. **Season close** — ending the season runs `settle_loans_for_season_close` first;
   final standings reflect settled net worth (residual debt → negative net worth).
