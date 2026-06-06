# Economic Design — Debt & Leverage / Loan Shark

This document defines the **Debt & Leverage** feature for the Pin Economy.

The feature introduces a **Loan Shark** desk: a House-funded lending mechanism that lets players borrow pins, increase their available liquidity, and take on season-scoped debt. The design is intentionally risky. Loans create strategic leverage, not free wealth. Players may use borrowed pins to make aggressive economic moves, but unpaid debt reduces net worth, accrues weekly interest, and can spiral out of control.

This document is self-contained and is intended to support implementation at both the database and application layer.

---

## 1. Design Goals

The Pin Economy is a game within the bowling league. Bowling performance creates weekly pin income, while the surrounding economy gives players ways to use those pins strategically.

The Debt & Leverage feature should:

- Give players a way to access liquidity before earning it naturally.
- Create strategic risk-taking opportunities.
- Give trailing players a legitimate “go big or go broke” comeback tool.
- Add social narrative and app engagement.
- Preserve the integrity of the actual bowling league.
- Keep all consequences contained to the Pin Economy.
- Make losses self-inflicted and voluntary.

The core product principle is:

> **Loans create liquidity, not wealth.**

A player’s leaderboard position should improve only if they use borrowed pins profitably.

---

## 2. Core Concepts

### 2.1 Available Balance

A player’s **available balance** is their spendable pin balance for the current season.

It is derived from the existing `pin_ledger`:

```text
pin_balance(player, season) = SUM(pin_ledger.amount)
```

### 2.2 Outstanding Debt

A player’s outstanding debt is the sum of active loan debt for that season.

Debt is derived from the new `debt_ledger`:

```text
loan_balance(loan) = SUM(debt_ledger.amount)
```

For v1, a player may only have one active loan, but the schema should not hard-code that assumption.

### 2.3 Net Worth

The economic leaderboard ranks players by **net worth**:

```text
net_worth = available_pin_balance - outstanding_debt
```

Taking a loan increases available balance and debt by the same amount, so it does not improve net worth by itself.

Example:

| Action | Available Balance | Debt | Net Worth |
|---|---:|---:|---:|
| Before loan | 500 | 0 | 500 |
| Borrow 1,000 pins | 1,500 | 1,000 | 500 |
| Win 800 pins | 2,300 | 1,000 | 1,300 |
| Lose 800 pins | 700 | 1,000 | -300 |

This is the central leverage mechanic.

---

## 3. Economic Rules

### 3.1 Funding Source

Loans are funded by the **House reserve**.

A loan is not minted supply. It is a House-to-player pin transfer plus a player debt liability.

When a player borrows:

- Player available balance increases.
- House reserve decreases.
- Player debt increases.
- Player net worth is unchanged.

The House may be treated as having effectively infinite reserves for feature operation, but the pin transfer should still be recorded as a House-funded event.

### 3.2 Eligibility

For v1, a player may take a loan if:

- The player belongs to the active season.
- The player has no active loan.
- The chosen loan product is available.
- There is still active economic activity remaining in the season.

No minimum balance is required.

A player with 0 pins and no debt may take any available loan product.

### 3.3 One Active Loan in v1

V1 application behavior:

> A player may have only one active loan at a time.

If a player wants another loan, they must fully repay the current loan first.

This is an application-layer rule only. Do **not** enforce it with a hard database constraint, because future versions may allow multiple concurrent loans.

### 3.4 Borrowed Pins Are Fungible

Borrowed pins become part of the player’s available balance.

They may be used for any economic activity:

- Pinsino bets.
- PvP challenge contracts.
- Merchant purchases.
- Side pots.
- Cosmetics.
- Manual loan repayment.
- Any future pin-economy mechanic.

The system does not track which pins were borrowed versus earned.

### 3.5 No Spending Restrictions While Indebted

An indebted player faces no restrictions on other economic activity.

If the player has available pins, they may use them however they choose.

Debt affects:

- Net worth.
- Future bowling pincome through garnishment.
- Weekly interest exposure.
- Season-close settlement.

Debt does not prevent spending, wagering, staking, purchasing, or repaying.

---

## 4. V1 Loan Products

The league generally bowls 2–3 games per player per week. With an average score around 115 pins per game, typical weekly pincome is roughly 200–300 pins.

The v1 Loan Shark products are sized against that earning environment.

| Product | Borrow Amount | Weekly Interest | Bowling Pincome Garnishment | Risk Level |
|---|---:|---:|---:|---|
| **Minnow Loan** | 250 | 8% | 25% | `low` |
| **Shark Bite** | 500 | 10% | 35% | `medium` |
| **Feeding Frenzy** | 750 | 12% | 45% | `high` |
| **Blood in the Water** | 1,000 | 15% | 55% | `extreme` |

### 4.1 Product Descriptions

| Product | Description | Special Warning |
|---|---|---|
| **Minnow Loan** | A small liquidity bump for players who need a few extra pins to get back in the action. | `NULL` |
| **Shark Bite** | A standard Loan Shark product for players looking to make a meaningful move. | `NULL` |
| **Feeding Frenzy** | Aggressive leverage for players who want enough firepower to chase bigger opportunities. | This loan may require strong weekly pincome, winnings, or manual repayments to escape cleanly. |
| **Blood in the Water** | A dangerous high-leverage loan for players trying to make a major move. | At average league pincome, automatic garnishment may only slow this debt rather than repay it. Missing league nights can cause the balance to spiral quickly. |

### 4.2 Blood in the Water Warning

The **Blood in the Water** loan requires a special confirmation warning.

At average league pincome, 55% garnishment mostly allows the borrower to tread water against 15% weekly interest. The loan may not be repayable through normal pincome alone. The borrower may need Pinsino winnings, PvP winnings, or manual repayments to escape it.

Suggested warning copy:

> **Warning: Blood in the Water is a high-risk Loan Shark product. At average league pincome, automatic garnishment may only slow the growth of this debt. You may need PvP, Pinsino, or manual repayments to escape it. Missing league nights can cause this loan to spiral quickly.**

---

## 5. Interest, Garnishment, and Repayment

### 5.1 Weekly Interest

Loans accrue weekly compounding interest.

Interest is assessed once per week during the weekly settlement/archive process.

Interest is calculated after weekly garnishment has already reduced the loan balance.

```text
interest_amount = ceil(remaining_debt_after_garnishment * weekly_interest_rate)
```

Interest creates a `debt_ledger` event only. It does not create a `pin_ledger` event because no pins move when interest accrues.

### 5.2 No Debt Cap

Debt has no cap.

Loan balances may compound without limit until repaid or until the season closes.

This is intentional. The risk is contained by the season reset.

### 5.3 Bowling Pincome Garnishment

Garnishment applies only to newly minted weekly bowling pincome.

It does not automatically apply to:

- Pinsino winnings.
- PvP winnings.
- Bonuses.
- Refunds.
- Merchant activity.
- Existing balance.
- Any non-bowling incoming pins.

The player may manually use those pins to repay debt, but automatic garnishment only touches bowling pincome.

### 5.4 Garnishment Calculation

For an active loan:

```text
calculated_garnishment = ceil(weekly_bowling_pincome * garnishment_rate)
actual_garnishment = min(calculated_garnishment, outstanding_loan_balance)
```

The system must never garnish more than the remaining payoff amount.

Example:

| Item | Amount |
|---|---:|
| Outstanding debt | 40 |
| Weekly pincome | 300 |
| Garnishment rate | 35% |
| Calculated garnishment | 105 |
| Actual garnishment | 40 |
| Remaining pincome to player | 260 |
| Interest charged | 0 |
| Ending debt | 0 |

### 5.5 Rounding

Both garnishment and interest round up using ceiling.

Examples:

| Calculation | Exact | Charged |
|---|---:|---:|
| 255 pincome × 35% garnishment | 89.25 | 90 |
| 850 debt × 15% interest | 127.5 | 128 |
| 333 debt × 10% interest | 33.3 | 34 |

This is consistent, easy to explain, and slightly favors the House. The borrower is already favored by applying garnishment before interest.

### 5.6 Missed Weeks

If a player with an active loan misses a league week:

- They generate no bowling pincome.
- There is nothing to garnish.
- Weekly interest applies to the full outstanding loan balance.

Players must account for attendance risk when borrowing.

### 5.7 Manual Repayment

Players may manually repay any whole-pin amount at any time during an active week.

Rules:

- Repayment amount must be a positive integer.
- Repayment amount cannot exceed the outstanding loan balance.
- Repayment amount cannot exceed the player’s available pin balance.
- A player may repay 1 pin, the full balance, or any whole-pin amount in between.
- There is no penalty for early or partial repayment.

Manual repayment uses the player’s available pin balance, regardless of where those pins came from.

### 5.8 Immediate Repayment

Once a loan is issued, the borrowed pins are available immediately and the loan can be repaid immediately.

This allows a player to take a loan, reconsider, and repay it before the next settlement without interest consequences.

This is economically pointless but acceptable and ledger-consistent because there is no origination fee.

### 5.9 No Origination Fee

V1 loans have no origination fee.

Debt starts equal to the borrow amount.

---

## 6. Weekly Settlement Process

The weekly settlement/archive process closes one active week and moves the economy to the next.

Loan processing should occur inside this single settlement flow. There should be no intermediate player-action window between garnishment and interest.

Recommended order:

1. Week closes / games are archived.
2. Bowling pincome is minted.
3. Loan garnishment is calculated and applied to active loans.
4. Remaining pincome is deposited to player balances.
5. Weekly loan interest is assessed on any remaining debt.
6. Net worth is recalculated.
7. Scoreboard, ledgers, and pincome statements update.

If garnishment fully repays a loan, no interest is charged for that loan during that settlement.

---

## 7. Season Close

At season close, all debt is settled as part of closing the books.

Final net worth and final season standings must be determined after debt settlement.

### 7.1 Season-Close Order

1. Final active economic activity settles.
2. Final bowling pincome is minted if applicable.
3. Final loan garnishment is applied if applicable.
4. Final weekly loan interest is assessed if applicable.
5. Player’s available balance is automatically applied toward outstanding debt.
6. Final net worth is calculated.
7. Economic standings and awards are determined.
8. New season starts from a clean slate.

### 7.2 Settlement Examples

| Available Balance | Outstanding Debt | Season-Close Payment | Final Net Worth |
|---:|---:|---:|---:|
| 900 | 500 | 500 | 400 |
| 300 | 1,000 | 300 | -700 |
| 0 | 850 | 0 | -850 |

Players may finish the season with negative net worth.

This is acceptable because all players start fresh next season.

---

## 8. Visibility and UI

### 8.1 Scoreboard Visibility

Debt is partially public.

The scoreboard should show enough information to explain net worth:

| Player | Available Balance | Debt | Net Worth |
|---|---:|---:|---:|
| Garrett | 1,750 | 600 | 1,150 |
| Mike | 1,200 | 0 | 1,200 |

Publicly visible:

- Available balance.
- Outstanding debt total.
- Net worth.
- Optional “leveraged” indicator.

Private to the borrower:

- Loan product.
- Interest rate.
- Garnishment rate.
- Product warning text.
- Payment history.
- Manual repayment controls.

### 8.2 Loan Shark Menu

The borrower-facing Loan Shark menu should show:

- Available loan products.
- Borrow amount.
- Weekly interest rate.
- Garnishment rate.
- Risk level.
- Description.
- Special warning text where applicable.
- Current active loan if one exists.
- Current outstanding debt.
- Manual repayment form.

### 8.3 Mandatory Confirmation Screen

Taking a loan requires an explicit confirmation screen every time.

The confirmation screen should show:

- Amount borrowed.
- Weekly interest rate.
- Bowling pincome garnishment rate.
- Statement that the loan does not improve net worth by itself.
- Missed-week warning.
- Season-end warning.
- Manual repayment note.
- Special product warning, if present.

Suggested general warning copy:

> Borrowed pins increase your available balance, but not your net worth. Debt accrues weekly interest until repaid. If you miss a week, there may be no pincome to garnish, but interest still applies. Outstanding debt counts against final season standings.

### 8.4 No Amortization Preview

The Loan Shark should not provide repayment projections or amortization schedules.

Strategic players can calculate the implications from the disclosed terms. The UI should disclose the rules clearly but should not coach players through the math.

### 8.5 Activity Feed

Loan-related feed events may exist, but they should be public and vague.

Acceptable examples:

- “Garrett visited the Loan Shark.”
- “Mike made a deal with the Loan Shark.”
- “Sarah cleared things up with the Loan Shark.”
- “Chris is back in the Shark’s good graces.”

Avoid public feed events that expose detailed or shaming information:

- “Garrett took out Blood in the Water.”
- “Mike now owes 1,432 pins.”
- “Sarah had 220 pins garnished.”
- “Chris is drowning in 15% weekly interest.”

The scoreboard may show debt because it is part of net worth, but the activity feed should preserve some privacy and keep the tone playful.

---

## 9. Database Model

The debt feature uses four main structures:

```text
pin_ledger     = actual pin movements
loan_products  = immutable historical Loan Shark offers
loans          = issued loan accounts and lifecycle state
debt_ledger    = append-only debt balance events
```

### 9.1 Existing `pin_ledger`

The existing `pin_ledger` is the source of truth for pin balances.

It is an append-only event log:

```text
balance(player, season) = SUM(pin_ledger.amount)
```

Loan-related `pin_ledger` events are created only when actual pins move between a player and the House.

V1 loan-related `pin_ledger.type` values:

```text
loan_issued
loan_manual_repayment
loan_weekly_garnishment
loan_season_close_settlement
```

Weekly interest does not create a `pin_ledger` event.

The only new loan-specific metadata required on `pin_ledger` is a nullable link to the corresponding debt ledger event:

```text
debt_ledger_id uuid NULL -> debt_ledger.id
```

All other loan metadata can be derived through:

```text
pin_ledger -> debt_ledger -> loans -> loan_products
```

### 9.2 `loan_products`

`loan_products` represents available or historical Loan Shark offers.

A `loan_products` row is a fixed historical offer. Existing loans continue to reference their original product even if the product is later inactive.

Recommended columns:

| Column | Notes |
|---|---|
| `id` uuid PK | Canonical product identifier. |
| `season_id` uuid nullable | Null means global/default product. Non-null means season-specific. Immutable. |
| `display_name` text | Admin-editable display name. |
| `description` text | Admin-editable product description. |
| `special_warning_text` text nullable | Admin-editable extra warning. |
| `risk_level` text | `low`, `medium`, `high`, `extreme`. Admin-editable metadata. |
| `borrow_amount` int | Principal amount transferred to player. Immutable. |
| `weekly_interest_rate` numeric | Weekly interest rate. Immutable. |
| `garnishment_rate` numeric | Percent of weekly bowling pincome garnished. Immutable. |
| `is_active` bool | Controls whether product is available for new loans. |
| `available_from` timestamp nullable | Availability start. Immutable. |
| `available_until` timestamp nullable | Availability end. Immutable. |
| `max_uses` int nullable | Null means unlimited. Immutable. |
| `sort_order` int | UI ordering. |
| `created_at` timestamp | |
| `updated_at` timestamp | |

#### 9.2.1 No `product_key`

No `product_key` is required.

Use `loan_products.id` as the canonical reference.

If terms change, create a new `loan_products` row. Do not mutate the old row.

### 9.3 Immutable `loan_products` Fields

The following fields must be immutable after creation:

```text
season_id
borrow_amount
weekly_interest_rate
garnishment_rate
max_uses
available_from
available_until
```

These fields define the economic and availability terms of the offer.

Admins may edit:

```text
display_name
description
special_warning_text
risk_level
is_active
sort_order
updated_at
```

This lets admins clean up copy or deactivate products without changing the functional terms of historical loans.

#### 9.3.1 Database-Level Protection

Immutability should be enforced at the database level with an update trigger or equivalent mechanism.

The database should reject any update that changes protected fields after creation.

Conceptual PostgreSQL trigger:

```sql
CREATE OR REPLACE FUNCTION prevent_loan_product_term_updates()
RETURNS trigger AS $$
BEGIN
  IF OLD.season_id IS DISTINCT FROM NEW.season_id
     OR OLD.borrow_amount IS DISTINCT FROM NEW.borrow_amount
     OR OLD.weekly_interest_rate IS DISTINCT FROM NEW.weekly_interest_rate
     OR OLD.garnishment_rate IS DISTINCT FROM NEW.garnishment_rate
     OR OLD.max_uses IS DISTINCT FROM NEW.max_uses
     OR OLD.available_from IS DISTINCT FROM NEW.available_from
     OR OLD.available_until IS DISTINCT FROM NEW.available_until THEN
    RAISE EXCEPTION 'loan product functional terms are immutable after creation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loan_products_immutable_terms
BEFORE UPDATE ON loan_products
FOR EACH ROW
EXECUTE FUNCTION prevent_loan_product_term_updates();
```

### 9.4 `loans`

`loans` tracks issued loan accounts and lifecycle state.

It does not store current debt. Current debt is derived from `debt_ledger`.

Recommended columns:

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `player_id` uuid -> players | Borrower. |
| `season_id` uuid -> seasons | Season in which the loan was issued. |
| `loan_product_id` uuid -> loan_products | Product terms accepted by borrower. |
| `status` text | `active`, `paid_off`, `season_closed`. |
| `issued_at` timestamp | |
| `paid_off_at` timestamp nullable | Set when loan reaches zero during season. |
| `season_closed_at` timestamp nullable | Set when resolved at season close. |
| `created_at` timestamp | |
| `updated_at` timestamp | |

Allowed statuses:

| Status | Meaning |
|---|---|
| `active` | Loan is outstanding and participates in garnishment/interest. |
| `paid_off` | Loan was fully repaid during the season. |
| `season_closed` | Loan was resolved during season-close settlement. |

Do not include `voided` or `admin_cancelled`. Admin cancellation is destructive rollback.

### 9.5 `debt_ledger`

`debt_ledger` is the append-only event log for debt balances.

Debt is derived exactly like pin balances:

```text
loan_balance(loan) = SUM(debt_ledger.amount)
```

Recommended columns:

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `loan_id` uuid -> loans | `ON DELETE CASCADE`. |
| `player_id` uuid -> players | Denormalized for easier querying. |
| `season_id` uuid -> seasons | Denormalized for easier querying. |
| `week_id` uuid nullable -> weeks | Used for weekly garnishment/interest events where applicable. |
| `amount` int | Signed. Positive increases debt; negative reduces debt. |
| `type` text | Debt event type. |
| `description` text | Human-readable. |
| `pin_ledger_id` uuid nullable -> pin_ledger | Present when the debt event corresponds to actual pin movement. |
| `created_at` timestamp | |

V1 `debt_ledger.type` values:

```text
loan_issued
manual_repayment
weekly_garnishment
weekly_interest
season_close_settlement
```

Sign convention:

| Debt Event Type | Amount Sign | Meaning |
|---|---:|---|
| `loan_issued` | Positive | Principal debt created. |
| `manual_repayment` | Negative | Player manually reduces debt. |
| `weekly_garnishment` | Negative | Garnished pincome reduces debt. |
| `weekly_interest` | Positive | Interest increases debt. |
| `season_close_settlement` | Negative | Season-close payment reduces debt. |

Example:

| Type | Amount | Running Loan Balance |
|---|---:|---:|
| `loan_issued` | +500 | 500 |
| `weekly_garnishment` | -90 | 410 |
| `weekly_interest` | +41 | 451 |
| `manual_repayment` | -100 | 351 |

### 9.6 Payoff as Outcome, Not Event Type

Do not create a separate `loan_payoff` event type.

A payoff is an outcome of a repayment event.

For example:

- A `manual_repayment` may fully pay off the loan.
- A `weekly_garnishment` may fully pay off the loan.
- A `season_close_settlement` may fully or partially settle the loan.

The application can determine payoff status by checking whether the resulting derived loan balance is zero.

Player-facing UI may render a payoff specially, such as “Loan Paid Off,” but the internal event type should preserve the source of repayment.

---

## 10. Product Availability

A loan product is available for issuance if all conditions are true:

```text
is_active = true

AND (season_id IS NULL OR season_id = current_season_id)

AND (available_from IS NULL OR now >= available_from)

AND (available_until IS NULL OR now <= available_until)

AND (max_uses IS NULL OR issued_count < max_uses)

AND current time is before the final economic lock

AND the player has no active loan
```

Enforcement split:

| Rule | Enforcement |
|---|---|
| Immutable product terms | Database trigger / equivalent database-level protection |
| `max_uses` product cap | Database / transaction-level enforcement |
| One active loan per player | Application-layer rule |
| `is_active` | Application-layer rule |
| Availability window | Application-layer rule |
| Season matching | Application-layer rule |
| Final economic lock | Application-layer rule |

### 10.1 `max_uses` Enforcement

`max_uses` is part of the economic scarcity of a product and should be enforced at the database/transaction level.

If `max_uses IS NULL`, usage is unlimited.

If `max_uses` is set, no more than that number of loans may be issued against the product.

Loan issuance for capped products should be atomic:

1. Begin transaction.
2. Lock or otherwise serialize access to the relevant `loan_products` row.
3. Count existing loans for the `loan_product_id`.
4. Confirm `issued_count < max_uses`.
5. Create the `loans` row.
6. Create the `pin_ledger` loan issuance rows.
7. Create the `debt_ledger` loan issuance row.
8. Commit transaction.

This prevents multiple players from simultaneously claiming the final limited-use offer.

---

## 11. Application Workflows

### 11.1 Loan Issuance

When a player takes a loan:

1. Validate player eligibility.
2. Validate product availability.
3. If `max_uses` is set, enforce cap transactionally.
4. Create `loans` row with `status = active`.
5. Create `pin_ledger` entry or entries representing House-to-player transfer.
6. Create `debt_ledger` entry with `type = loan_issued` and `amount = borrow_amount`.
7. Link the loan issuance pin event to the debt event.
8. Emit optional vague activity feed event.

Pin ledger event type:

```text
loan_issued
```

Debt ledger event type:

```text
loan_issued
```

Debt ledger amount:

```text
+borrow_amount
```

### 11.2 Manual Repayment

When a player manually repays debt:

1. Confirm player has an active loan.
2. Derive outstanding loan balance from `SUM(debt_ledger.amount)`.
3. Validate repayment amount:
   - positive whole-pin integer,
   - not greater than outstanding debt,
   - not greater than player available balance.
4. Create `pin_ledger` player-to-House transfer.
5. Create `debt_ledger` event with negative amount.
6. Link the pin event to the debt event.
7. If derived loan balance becomes zero, update `loans.status = paid_off` and set `paid_off_at`.

Pin ledger event type:

```text
loan_manual_repayment
```

Debt ledger event type:

```text
manual_repayment
```

Debt ledger amount:

```text
-repayment_amount
```

### 11.3 Weekly Garnishment

During weekly settlement, for each active loan:

1. Calculate weekly bowling pincome for the player.
2. Derive outstanding debt from `SUM(debt_ledger.amount)`.
3. If outstanding debt is zero, mark paid off if needed and skip.
4. Calculate:

```text
calculated_garnishment = ceil(weekly_bowling_pincome * garnishment_rate)
actual_garnishment = min(calculated_garnishment, outstanding_debt)
```

5. If actual garnishment is greater than zero:
   - create `pin_ledger` transfer to House,
   - create `debt_ledger` negative event,
   - link the events.
6. If loan balance is now zero:
   - mark loan `paid_off`,
   - do not assess interest.
7. Otherwise assess weekly interest.

Pin ledger event type:

```text
loan_weekly_garnishment
```

Debt ledger event type:

```text
weekly_garnishment
```

Debt ledger amount:

```text
-actual_garnishment
```

### 11.4 Weekly Interest

After garnishment during weekly settlement:

1. Derive remaining outstanding debt.
2. If remaining debt is zero, skip interest.
3. Calculate:

```text
interest_amount = ceil(remaining_debt * weekly_interest_rate)
```

4. Create `debt_ledger` event with positive amount.
5. Do not create a `pin_ledger` event.

Debt ledger event type:

```text
weekly_interest
```

Debt ledger amount:

```text
+interest_amount
```

### 11.5 Season-Close Settlement

At season close, after final weekly settlement steps:

1. For each active loan, derive outstanding debt.
2. Derive player available balance.
3. Calculate:

```text
season_close_payment = min(available_balance, outstanding_debt)
```

4. If payment is greater than zero:
   - create `pin_ledger` player-to-House transfer,
   - create `debt_ledger` negative event,
   - link the events.
5. Mark loan `season_closed`.
6. Calculate final net worth after settlement.
7. Use final net worth for season standings.

Pin ledger event type:

```text
loan_season_close_settlement
```

Debt ledger event type:

```text
season_close_settlement
```

Debt ledger amount:

```text
-season_close_payment
```

If the player cannot cover the full debt, the remaining loan balance still contributes to negative final net worth before the next season resets.

---

## 12. Admin Cancellation

Admin cancellation is a destructive rollback.

This matches the existing bet-cancellation behavior.

When an admin cancels a loan, the system deletes:

1. The `loans` row.
2. All related `debt_ledger` rows.
3. All related `pin_ledger` rows linked through those debt ledger entries.

The result should be as if the loan never existed.

Consequences:

- Original borrowed-pin credit is removed.
- Manual repayments are removed.
- Weekly garnishments are removed.
- Season-close settlement entries are removed if applicable.
- Derived pin balance and derived debt balance return to their no-loan state.

No `voided` or `admin_cancelled` loan status is needed.

---

## 13. Ledger Linking

When a loan event involves actual pin movement, both ledgers should be connected.

Examples:

### Loan Issuance

`pin_ledger`:

```text
type = loan_issued
amount = +borrow_amount for player-side entry
```

`debt_ledger`:

```text
type = loan_issued
amount = +borrow_amount
pin_ledger_id = linked loan issuance pin event
```

### Manual Repayment

`pin_ledger`:

```text
type = loan_manual_repayment
amount = -repayment_amount for player-side entry
```

`debt_ledger`:

```text
type = manual_repayment
amount = -repayment_amount
pin_ledger_id = linked repayment pin event
```

### Weekly Interest

`debt_ledger` only:

```text
type = weekly_interest
amount = +interest_amount
pin_ledger_id = NULL
```

### Notes on House Rows

If the existing `pin_ledger` convention records both player-side and House-side entries for transfers, follow that convention for loan transfers.

The debt ledger should link to the player-side pin ledger event, or to whichever event is canonical in the existing implementation.

---

## 14. Leaderboard and Net Worth Queries

### 14.1 Pin Balance

Use the existing balance query:

```sql
SELECT player_id, season_id, SUM(amount) AS pin_balance
FROM pin_ledger
WHERE is_house = false
GROUP BY player_id, season_id;
```

### 14.2 Active Debt

For current in-season standings:

```sql
SELECT l.player_id, l.season_id, SUM(dl.amount) AS outstanding_debt
FROM loans l
JOIN debt_ledger dl ON dl.loan_id = l.id
WHERE l.status = 'active'
GROUP BY l.player_id, l.season_id;
```

For season-close final standings, include loans marked `season_closed` as needed during final calculation before reset/archival.

### 14.3 Net Worth

```text
net_worth = pin_balance - outstanding_debt
```

In SQL terms, this should be implemented as a view or query that joins derived pin balances with derived outstanding debt.

---

## 15. Failure Modes and Guardrails

### 15.1 Free Leaderboard Inflation

Risk:

A player borrows pins and appears richer.

Mitigation:

Leaderboard ranks by net worth, not available balance.

### 15.2 Debt Shame

Risk:

Players may feel embarrassed by debt.

Mitigation:

Debt total is public only because it is required for net worth. Loan details remain private. Activity feed events are vague and playful.

### 15.3 Debt Spiral

Risk:

Debt can compound beyond a player’s ability to repay.

Mitigation:

This is intentional. Confirmation screens must disclose weekly interest, garnishment, missed-week risk, and season-end treatment.

### 15.4 Missed Attendance

Risk:

Players miss a week, generate no pincome, and interest accrues on full debt.

Mitigation:

Disclose missed-week risk on confirmation screen.

### 15.5 Product Mutation

Risk:

Changing a loan product after issuance changes historical loan terms.

Mitigation:

Functional product fields are immutable at the database level. New terms require a new product row.

### 15.6 Limited Product Race Conditions

Risk:

More players claim a limited-use loan than allowed.

Mitigation:

Enforce `max_uses` transactionally at the database level.

### 15.7 Accidental Loan Activity

Risk:

A player takes a loan by mistake.

Mitigation:

Mandatory confirmation screen. Immediate repayment is allowed before interest accrues.

---

## 16. Implementation Checklist

### Database

- [ ] Create `loan_products` table.
- [ ] Create `loans` table.
- [ ] Create `debt_ledger` table.
- [ ] Add nullable `debt_ledger_id` reference to `pin_ledger` if compatible with existing schema.
- [ ] Add database trigger to protect immutable `loan_products` fields.
- [ ] Implement transaction-level enforcement for `max_uses`.
- [ ] Seed v1 loan products.

### Application Logic

- [ ] Add Loan Shark menu.
- [ ] Add loan product availability query.
- [ ] Add mandatory loan confirmation screen.
- [ ] Add loan issuance flow.
- [ ] Add manual repayment flow.
- [ ] Add weekly garnishment processing.
- [ ] Add weekly interest processing.
- [ ] Add season-close debt settlement.
- [ ] Add net-worth leaderboard calculation.
- [ ] Add borrower-only loan detail view.
- [ ] Add public scoreboard debt column.
- [ ] Add vague activity feed events if desired.
- [ ] Add admin loan cancellation flow.

### Admin

- [ ] Create loan products.
- [ ] Deactivate loan products.
- [ ] Edit product metadata.
- [ ] View active loans.
- [ ] View debt ledger history.
- [ ] Cancel loan destructively.
- [ ] Verify capped product usage.

---

## 17. Summary

The Loan Shark feature adds strategic leverage to the Pin Economy.

Players may borrow pins from the House, use them freely, and attempt to improve their net worth through economic activity. Debt accrues weekly interest, is partially repaid through bowling pincome garnishment, and can be manually repaid at any time.

The feature is intentionally dangerous. Large loans, especially **Blood in the Water**, can become season-wrecking liabilities if the borrower fails to generate returns or misses league nights.

The core invariant is:

> **Borrowing increases liquidity, but net worth only changes based on what the player does with that liquidity.**

The implementation should preserve the existing ledger-first philosophy:

```text
pin_balance = SUM(pin_ledger.amount)
loan_balance = SUM(debt_ledger.amount)
net_worth = pin_balance - loan_balance
```

This keeps the economy auditable, consistent, and ready for future expansion.
