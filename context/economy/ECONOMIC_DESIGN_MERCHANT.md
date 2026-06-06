# Economic Design — Traveling Merchant / Item Shop

This document specifies the **Traveling Merchant** feature for the Pindejos Bowling League Pin Economy.

The Merchant is a rotating, limited-inventory item shop where players spend pins on functional, economy-only items. The feature is intended to create a meaningful pin sink, increase weekly app engagement, and add strategic decisions to the existing Pinsino betting economy.

This document is self-contained and written to support database and application-layer implementation.

---

## 1. Purpose

The Traveling Merchant gives players something useful to spend pins on.

The current Pin Economy has strong pin generation through weekly bowling scores and betting activity through the Pinsino. The Merchant adds a new economic sector:

> Players spend pins to buy limited-use items that modify future pin-economy actions.

For v1, Merchant items modify **Pinsino bets only**.

The Merchant should create:

- a recurring weekly app engagement loop,
- a meaningful player-to-House pin sink,
- strategic decisions around limited inventory,
- sportsbook-style bet promotions,
- more texture around the existing betting economy.

---

## 2. Core Constraints

### 2.1 No Bowling League Impact

Merchant items must never affect actual bowling league gameplay.

They must not affect:

- bowling scores,
- team wins or losses,
- handicaps,
- lane assignments,
- bowling order,
- playoff qualification,
- standings in the real bowling league,
- any real-world league advantage.

Merchant items may only affect:

- pin balances,
- Pinsino bet payouts or rebates,
- app-visible economy state,
- future economy-only mechanics.

### 2.2 V1 Target Scope

For v1, Merchant items may only attach to:

```text
pinsino_bet
```

V1 explicitly excludes item usage on:

- PvP challenge contracts,
- loans,
- merchant purchases,
- side pots / tournaments,
- cosmetics,
- auto-triggered protection effects.

This keeps the first implementation focused and avoids complicating PvP settlement or Loan Shark mechanics.

### 2.3 Purchases Are Final

All player Merchant purchases are final.

Players cannot self-refund or undo a purchase. Admins may cancel a purchase through a destructive rollback operation if needed.

---

## 3. Weekly Merchant Drop Schedule

The Merchant uses a weekly drop model.

Default schedule:

| Event | Time |
|---|---|
| Merchant opens | Wednesday 5:00 PM ET |
| Merchant closes | Monday 7:00 PM ET |

Monday 7:00 PM ET is game time, so players may buy items up to the beginning of league-night activity.

Closing the Merchant only stops new purchases. It does not affect existing player inventory or item usage. Players should have 24/7 access to their inventory.

Admins may manually close, reopen, delay, or extend a Merchant drop if needed.

---

## 4. Conceptual Data Model

The Merchant system separates item definitions from weekly listings and player-owned instances.

```text
merchant_items          = reusable item definitions / effects
merchant_drops          = weekly Merchant appearances
merchant_drop_items     = specific items listed in a drop, with price and quantity
player_inventory_items  = individual purchased item instances
item_usages             = consumed items attached to economic actions
pin_ledger              = actual pin movement from item purchases
```

This distinction is important:

- `merchant_items` define what an item does.
- `merchant_drop_items` define what the Merchant is selling that item for in a specific drop.
- `player_inventory_items` are the copies owned by players.
- `item_usages` link consumed inventory items to the target economic action.

---

## 5. Item Definitions

### 5.1 `merchant_items`

`merchant_items` define reusable item behavior.

Recommended schema:

```sql
merchant_items
--------------
id uuid primary key

display_name text not null
description text

effect_key text not null
effect_config jsonb not null default '{}'

eligible_target_type text not null
eligible_bet_type text
eligible_market_types text[]

max_stake int
max_potential_payout int

default_expiration_type text not null

is_active boolean not null default true
sort_order int not null default 0

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

### 5.2 Controlled Effect Model

The system uses a controlled hybrid effect model:

```text
effect_key + effect_config
```

Application code implements known `effect_key` behavior. The database stores safe parameters in `effect_config`.

This is intentionally not a full rules engine. Admins should not be able to create arbitrary item logic from configuration alone.

Example:

```json
{
  "effect_key": "bet_payout_boost",
  "effect_config": {
    "boost_percent": 10,
    "max_boost": 250,
    "applies_to": "gross_payout"
  }
}
```

The application code owns the meaning of `bet_payout_boost`.

### 5.3 Immutable Functional Fields

Once a `merchant_items` row is created, its functional behavior must not change.

Immutable fields:

```text
effect_key
effect_config
eligible_target_type
eligible_bet_type
eligible_market_types
max_stake
max_potential_payout
default_expiration_type
```

Reason:

> A purchased item must always do what it did when the player bought it.

If admins want to rebalance an item, they should deactivate the old item and create a new `merchant_items` row.

### 5.4 Mutable Metadata Fields

These fields may be edited by admins:

```text
display_name
description
is_active
sort_order
updated_at
```

Metadata is nonfunctional. Historical inventory views should display current metadata from `merchant_items`; no item name or description snapshot is required on inventory rows.

---

## 6. Merchant Drops

### 6.1 `merchant_drops`

`merchant_drops` represent weekly Merchant appearances.

Recommended schema:

```sql
merchant_drops
--------------
id uuid primary key

season_id uuid not null references seasons(id) on delete cascade
week_id uuid references weeks(id) on delete set null

opens_at timestamptz not null
closes_at timestamptz not null

is_active boolean not null default false
status text

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Default values:

```text
opens_at = Wednesday 5:00 PM ET
closes_at = Monday 7:00 PM ET
```

### 6.2 Mutability

`merchant_drops` are operational records and may be changed by admins.

Admins may update:

```text
opens_at
closes_at
is_active
status
updated_at
```

This allows admins to close/reopen the Merchant to address issues.

---

## 7. Merchant Listings

### 7.1 `merchant_drop_items`

`merchant_drop_items` define what the Merchant sells in a specific drop.

Recommended schema:

```sql
merchant_drop_items
-------------------
id uuid primary key

merchant_drop_id uuid not null references merchant_drops(id) on delete cascade
merchant_item_id uuid not null references merchant_items(id) on delete restrict

price int not null
quantity_available int not null
quantity_sold int not null default 0
per_player_limit int

is_active boolean not null default true
sort_order int not null default 0

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

### 7.2 Finite Quantity Required

Every listing must have a finite `quantity_available`.

There is no `NULL` / unlimited quantity behavior in v1. If an item should be effectively unlimited, admins can set a very high finite quantity.

### 7.3 Per-Player Limit

A listing may define:

```text
per_player_limit
```

Examples:

| Quantity Available | Per-Player Limit | Meaning |
|---:|---:|---|
| 5 | null | Five total available; one player could buy all five |
| 5 | 1 | Five total available; each player can buy at most one |
| 10 | 2 | Ten total available; each player can buy at most two |

### 7.4 Immutable Offer Terms

The following fields are immutable after creation:

```text
merchant_drop_id
merchant_item_id
price
quantity_available
per_player_limit
```

Reason:

> A Merchant listing represents a specific offer: this item, in this drop, at this price, with this supply and per-player limit.

If admins want a different price or quantity, they should create a new listing.

### 7.5 Mutable Operational Fields

These fields may change:

```text
quantity_sold
is_active
sort_order
updated_at
```

`quantity_sold` updates during purchases. `is_active` flips to `false` when sold out or manually disabled.

---

## 8. Player Inventory

### 8.1 `player_inventory_items`

Each purchase creates one distinct player-owned inventory item.

If a player buys two copies of the same Merchant item, they receive two separate inventory rows.

Recommended schema:

```sql
player_inventory_items
----------------------
id uuid primary key

player_id uuid not null references players(id) on delete cascade
season_id uuid not null references seasons(id) on delete cascade
merchant_drop_item_id uuid not null references merchant_drop_items(id) on delete restrict

status text not null

expires_at timestamptz not null

purchased_at timestamptz not null default now()
consumed_at timestamptz
expired_at timestamptz

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Valid statuses:

```text
available
consumed
expired
```

Do not use an `admin_cancelled` status. Admin cancellation deletes records outright.

### 8.2 No `merchant_item_id` on Inventory

`player_inventory_items` does not need `merchant_item_id`.

The item definition is derived through:

```text
player_inventory_items
→ merchant_drop_items
→ merchant_items
```

This avoids duplicating data.

### 8.3 Inventory Rules

Inventory is:

- season-scoped,
- player-owned,
- non-transferable,
- use-it-or-lose-it,
- accessible 24/7,
- reset at season close.

Items do not carry over between seasons.

### 8.4 Expiration

Each inventory item stores its own calculated expiration:

```text
expires_at
```

This is calculated at purchase time from the item’s `default_expiration_type` and the current season/drop/week context.

Supported expiration types should include at least:

| Expiration Type | Meaning |
|---|---|
| `season_end` | Expires when the season closes |
| `drop_end` | Expires when the Merchant drop closes |
| `week_end` | Expires when the active week settles |
| `fixed_datetime` | Expires at a configured timestamp, if supported later |

Default behavior should be `season_end`.

An item is usable only if:

```text
status = 'available'
AND expires_at > now()
```

A cleanup job may later mark stale items as `expired`, but the app must always check `expires_at` before allowing usage.

---

## 9. Item Usage

### 9.1 No Auto-Triggering in V1

V1 does not support auto-triggered items.

A player must explicitly attach an item to an eligible economic action.

### 9.2 Usage Timing

Items must be attached at the time the target economic action is created.

For v1:

```text
usage_timing = at_target_creation
```

No retroactive attachment is allowed.

This prevents players from adding:

- payout boosts after a bet starts looking likely to win,
- protection after a bet starts looking likely to lose,
- any modifier after the target has already been created.

### 9.3 Consumption on Attachment

An item is consumed immediately when attached to an economic action.

The item is consumed regardless of whether its effect ultimately matters.

Example:

- Player attaches Bet Insurance to a bet.
- The item is immediately marked consumed.
- If the bet wins, the insurance does nothing.
- The item is still spent.

### 9.4 `item_usages`

`item_usages` records the link between a consumed inventory item and the target economic action.

Recommended schema:

```sql
item_usages
-----------
id uuid primary key

player_inventory_item_id uuid not null references player_inventory_items(id) on delete cascade
player_id uuid not null references players(id) on delete cascade
season_id uuid not null references seasons(id) on delete cascade

target_type text not null
target_id uuid not null

used_at timestamptz not null default now()
created_at timestamptz not null default now()
```

For v1:

```text
target_type = pinsino_bet
```

### 9.5 Multiple Items on One Bet

A single Pinsino bet may have multiple attached items, as long as each attached item has a different `effect_key`.

Rule:

```text
For a given bet, player, and target:
  at most one attached item per effect_key
```

This allows an odds boost and loss insurance on the same bet, but prevents stacking two odds boosts.

Validation can be performed by joining:

```text
item_usages
→ player_inventory_items
→ merchant_drop_items
→ merchant_items
```

---

## 10. Purchase Rules

### 10.1 Purchase Eligibility

A player may purchase a Merchant item if:

```text
merchant_drops.is_active = true
AND merchant_drop_items.is_active = true
AND now >= merchant_drops.opens_at
AND now <= merchant_drops.closes_at
AND merchant_drop_items.quantity_sold < merchant_drop_items.quantity_available
AND player has enough available pin balance
AND (
  merchant_drop_items.per_player_limit IS NULL
  OR player_purchase_count_for_this_drop_item < merchant_drop_items.per_player_limit
)
```

Purchases are based on available pin balance, not net worth.

Debt does not restrict item purchases. Pins are fungible.

### 10.2 Purchase Transaction

Purchases must execute atomically.

Transaction steps:

1. Lock or otherwise serialize the relevant `merchant_drop_items` row.
2. Validate the Merchant drop is active.
3. Validate the listing is active.
4. Validate current time is within the drop window.
5. Validate `quantity_sold < quantity_available`.
6. Validate the player has not exceeded `per_player_limit`, if present.
7. Validate the player has enough available pins.
8. Increment `quantity_sold`.
9. If the new `quantity_sold = quantity_available`, set `merchant_drop_items.is_active = false`.
10. Create one `player_inventory_items` row.
11. Create player `pin_ledger` row for the purchase.
12. Create House `pin_ledger` row for the purchase.
13. Commit.

The app may query `merchant_drop_items.is_active` to determine display availability, but the transaction should still check both `is_active` and quantity.

### 10.3 `pin_ledger` Event

Each purchase creates corresponding `pin_ledger` rows with:

```text
type = merchant_purchase
```

Player row:

```text
player_id = purchasing player
amount = -price
is_house = false
player_inventory_item_id = purchased inventory item
```

House row:

```text
player_id = null
amount = +price
is_house = true
player_inventory_item_id = purchased inventory item
```

The `pin_ledger` schema should be extended to include:

```text
player_inventory_item_id uuid references player_inventory_items(id) on delete set null
```

This keeps Merchant purchases auditable while preserving the existing conservative transfer model.

---

## 11. Admin Cancellation

Admin cancellation is a destructive rollback.

If an admin cancels a Merchant purchase, the system should:

1. Delete the `player_inventory_items` row.
2. Delete any related `item_usages` rows.
3. Delete related `pin_ledger` rows with `type = merchant_purchase`.
4. Decrement `merchant_drop_items.quantity_sold` by 1.
5. If quantity is now available again, set `merchant_drop_items.is_active = true`.

Condition:

```text
if quantity_sold < quantity_available:
  merchant_drop_items.is_active = true
```

The result should be as if the purchase never happened.

If the item had already been consumed on a bet, admins should be careful: deleting the usage removes the record of the item attachment, but any already-settled bet may also need to be cancelled/re-settled through existing Pinsino admin tools.

---

## 12. V1 Pinsino Bet Modifier Scope

### 12.1 Bet Item Eligibility

Merchant items may restrict by bet type:

```text
eligible_bet_type = single | parlay | any
```

For v1:

- Single-bet items should use `single`.
- Parlay items should use `parlay`.
- Use `any` sparingly and only for effects explicitly implemented to work on both.

Parlays should only accept parlay-specific items. Single-leg boosts cannot be attached to parlays.

### 12.2 Market Type Eligibility

Items may restrict by market type:

```text
eligible_market_types text[]
```

If `eligible_market_types` is `NULL`, the item can apply to any market type allowed by the other eligibility fields.

If set for a single bet:

```text
the bet market_type must be in eligible_market_types
```

If set for a parlay:

```text
every parlay leg market_type must be in eligible_market_types
```

No partial-leg application in v1.

### 12.3 Stake and Payout Caps

Items may optionally restrict usage by:

```text
max_stake
max_potential_payout
```

Validation:

```text
max_stake IS NULL OR bet.stake <= max_stake
max_potential_payout IS NULL OR bet.potential_payout <= max_potential_payout
```

These fields provide a balancing lever for high-upside item effects.

---

## 13. V1 Effect Keys

V1 supports four effect keys.

### 13.1 `bet_payout_boost`

Applies to single bets.

Trigger:

```text
single bet resolves as a true win
```

Effect:

```text
increase gross payout by configured percent or amount
```

Does not trigger on loss or push.

Recommended config shape:

```json
{
  "boost_percent": 10,
  "max_boost": 250,
  "applies_to": "gross_payout"
}
```

Boosts apply to gross payout, not profit only.

Example:

| Field | Amount |
|---|---:|
| Stake | 100 |
| Base gross payout | 200 |
| 10% boost | +20 |
| Final payout | 220 |

### 13.2 `bet_loss_rebate`

Applies to single bets.

Trigger:

```text
single bet resolves as a true loss
```

Effect:

```text
rebate part of the stake
```

Does not trigger on win or push.

Recommended config shape:

```json
{
  "rebate_percent": 25,
  "max_rebate": 250,
  "applies_to": "stake"
}
```

Insurance/rebate always applies to stake, because stake is what the player is protecting.

### 13.3 `parlay_payout_boost`

Applies to parlays.

Trigger:

```text
parlay resolves as a true win
```

Effect:

```text
increase gross parlay payout by configured percent or amount
```

Does not trigger on loss or push.

Recommended config shape:

```json
{
  "boost_percent": 15,
  "max_boost": 500,
  "applies_to": "gross_payout"
}
```

### 13.4 `parlay_loss_rebate`

Applies to parlays.

Trigger:

```text
parlay resolves as a true loss
```

Effect:

```text
rebate part of the stake
```

Does not trigger on win or push.

Recommended config shape:

```json
{
  "rebate_percent": 25,
  "max_rebate": 250,
  "applies_to": "stake"
}
```

### 13.5 Push Behavior

Pushes are not wins or losses.

Therefore:

- payout boosts do not apply,
- insurance/rebate does not apply,
- normal push/refund behavior applies.

---

## 14. Bet Creation With Attached Items

Items must be attached during bet creation.

Recommended flow:

1. Player selects a Pinsino bet.
2. App fetches eligible available inventory items.
3. Player optionally attaches one or more eligible items.
4. App validates:
   - item belongs to player,
   - item status is `available`,
   - `expires_at > now`,
   - item target type is `pinsino_bet`,
   - item bet type matches,
   - market restrictions pass,
   - stake/payout caps pass,
   - no duplicate `effect_key` is attached to the same bet.
5. App creates the bet.
6. App creates `item_usages` rows.
7. App marks attached inventory items `consumed`.
8. App commits atomically.

If bet creation fails, item consumption must also fail.

---

## 15. Bet Settlement With Attached Items

### 15.1 House Funds All Payouts

The House is always the counterparty for Pinsino bets.

If an attached item increases payout or creates a rebate, the House funds that amount as part of normal bet settlement.

### 15.2 Ledger Treatment

Item-generated bet effects are folded into the normal bet payout ledger event.

Example:

```text
Base payout: 200
Odds Boost: +20
Final payout: 220
```

The `pin_ledger` should record one normal bet payout event:

```text
bet_payout +220
```

Do not create a separate `merchant_item_payout` ledger event.

### 15.3 Bets Table Treatment

The `bets` table must store the final item-adjusted payout according to the existing Pinsino settlement implementation.

The item impact can be derived by comparing:

```text
base payout from bet_market terms
vs.
final payout after attached item effects
```

and by reading attached item usages:

```text
bet
→ item_usages
→ player_inventory_items
→ merchant_drop_items
→ merchant_items
```

### 15.4 Bet Detail Display

The compact `BetRow` component should show attached item badges or labels.

The bet detail / settlement breakdown should show how items modified the outcome.

Examples:

Winning boosted bet:

```text
Base result: Win
Base payout: 200
Juiced Ticket: +20
Final payout: 220
```

Losing insured bet:

```text
Base result: Loss
Base payout: 0
Safety Ticket: +25 rebate
Final payout: 25
```

Push:

```text
Base result: Push
Stake refunded
Attached items did not trigger
```

---

## 16. V1 Item Catalog

The initial v1 Merchant catalog contains five sportsbook-style items.

These are definitions in `merchant_items`. Actual weekly price, quantity, and per-player limits are controlled by `merchant_drop_items`.

### 16.1 Juiced Ticket

| Field | Value |
|---|---|
| Display Name | Juiced Ticket |
| Effect Key | `bet_payout_boost` |
| Eligible Target | `pinsino_bet` |
| Eligible Bet Type | `single` |
| Behavior | +10% gross payout on true win |
| Suggested Risk | Low / Medium |
| Suggested Config | `{ "boost_percent": 10, "max_boost": 250, "applies_to": "gross_payout" }` |

Suggested listing defaults:

| Field | Value |
|---|---:|
| Price | 100 |
| Quantity | 5 |
| Per-Player Limit | 1 |
| Max Stake | 250 |
| Max Potential Payout | 750 |

### 16.2 Big Juicer

| Field | Value |
|---|---|
| Display Name | Big Juicer |
| Effect Key | `bet_payout_boost` |
| Eligible Target | `pinsino_bet` |
| Eligible Bet Type | `single` |
| Behavior | +25% gross payout on true win, capped |
| Suggested Risk | High |
| Suggested Config | `{ "boost_percent": 25, "max_boost": 250, "applies_to": "gross_payout" }` |

Suggested listing defaults:

| Field | Value |
|---|---:|
| Price | 250 |
| Quantity | 2 |
| Per-Player Limit | 1 |
| Max Stake | 250 |
| Max Potential Payout | 1,000 |

### 16.3 Safety Ticket

| Field | Value |
|---|---|
| Display Name | Safety Ticket |
| Effect Key | `bet_loss_rebate` |
| Eligible Target | `pinsino_bet` |
| Eligible Bet Type | `single` |
| Behavior | 25% stake rebate on true loss |
| Suggested Risk | Medium |
| Suggested Config | `{ "rebate_percent": 25, "max_rebate": 250, "applies_to": "stake" }` |

Suggested listing defaults:

| Field | Value |
|---|---:|
| Price | 125 |
| Quantity | 5 |
| Per-Player Limit | 1 |
| Max Stake | 300 |
| Max Potential Payout | null |

### 16.4 Parlay Rocket

| Field | Value |
|---|---|
| Display Name | Parlay Rocket |
| Effect Key | `parlay_payout_boost` |
| Eligible Target | `pinsino_bet` |
| Eligible Bet Type | `parlay` |
| Behavior | +15% gross payout on true parlay win |
| Suggested Risk | High |
| Suggested Config | `{ "boost_percent": 15, "max_boost": 500, "applies_to": "gross_payout" }` |

Suggested listing defaults:

| Field | Value |
|---|---:|
| Price | 200 |
| Quantity | 3 |
| Per-Player Limit | 1 |
| Max Stake | 150 |
| Max Potential Payout | 1,500 |

### 16.5 Parlay Parachute

| Field | Value |
|---|---|
| Display Name | Parlay Parachute |
| Effect Key | `parlay_loss_rebate` |
| Eligible Target | `pinsino_bet` |
| Eligible Bet Type | `parlay` |
| Behavior | 25% stake rebate on true parlay loss |
| Suggested Risk | Medium |
| Suggested Config | `{ "rebate_percent": 25, "max_rebate": 250, "applies_to": "stake" }` |

Suggested listing defaults:

| Field | Value |
|---|---:|
| Price | 175 |
| Quantity | 3 |
| Per-Player Limit | 1 |
| Max Stake | 150 |
| Max Potential Payout | null |

---

## 17. Application-Layer Validation Checklist

### 17.1 Purchase Validation

Before purchase:

```text
drop active
listing active
within open/close window
quantity remaining
per-player limit not exceeded
player has enough pin balance
item definition active, unless purchasing historical listing is intentionally allowed
```

### 17.2 Usage Validation

Before item attachment:

```text
inventory item belongs to player
inventory item status = available
inventory item expires_at > now
target type matches eligible_target_type
bet type matches eligible_bet_type
market type restrictions pass
stake cap passes
potential payout cap passes
no duplicate effect_key already attached
target is being created now
```

### 17.3 Settlement Validation

During bet settlement:

```text
load attached item usages
resolve base bet result
apply item effects only if trigger condition matches
apply boosts only on true wins
apply rebates only on true losses
apply no item effects on pushes
calculate final payout
store final item-adjusted payout on bet
write normal bet settlement ledger event
```

---

## 18. Database Enforcement Recommendations

### 18.1 Immutability Triggers

Use database triggers to prevent updates to immutable functional fields.

For `merchant_items`, protect:

```text
effect_key
effect_config
eligible_target_type
eligible_bet_type
eligible_market_types
max_stake
max_potential_payout
default_expiration_type
```

For `merchant_drop_items`, protect:

```text
merchant_drop_id
merchant_item_id
price
quantity_available
per_player_limit
```

### 18.2 Quantity Enforcement

Purchase transactions should serialize updates to `merchant_drop_items` so limited inventory cannot oversell.

The transaction must atomically increment `quantity_sold` and set `is_active = false` when sold out.

### 18.3 No Hard Constraint on Item Variety

Do not hard-code item names into settlement logic.

Settlement should switch on supported `effect_key`s.

---

## 19. Future Expansion Ideas

The v1 schema is intentionally designed to support future Merchant expansion.

Potential future target types:

```text
loan
merchant_purchase
side_pot
pvp_challenge
profile_cosmetic
```

Potential future item families:

- Loan Shark interest freeze
- Loan Shark garnishment reduction
- Merchant coupons
- Side-pot entry passes
- PvP challenge modifiers
- PvP rake discounts
- Cosmetic titles or profile frames
- Special market access passes
- Weekly chaos items

PvP item usage should remain excluded until the PvP contract system is mature enough to handle visibility, consent, and settlement complexity.

---

## 20. Summary

The Traveling Merchant is a weekly, limited-inventory pin sink that sells functional, economy-only items.

For v1, the Merchant focuses exclusively on Pinsino bet modifiers. Players buy items, receive season-scoped inventory instances, and may attach items only when creating eligible bets. Attached items are consumed immediately. Bet settlement applies supported item effects and stores the final item-adjusted payout.

The core implementation principles are:

- item behavior is immutable,
- listing terms are immutable,
- purchases are final,
- inventory is season-scoped,
- items are non-transferable,
- purchases pay the House,
- item usage is explicit and linked to a target,
- no retroactive item attachment,
- no PvP item effects in v1,
- no bowling gameplay impact ever.
