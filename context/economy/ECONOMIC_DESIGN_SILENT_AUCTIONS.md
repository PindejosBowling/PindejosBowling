# Economic Design — Silent Auctions

This document specifies the **Silent Auction** feature for the Pindejos Bowling League Pin Economy.

Silent Auctions are a House-run, limited-time market where players submit hidden pledge bids for scarce economy-only items, access passes, cosmetics, licenses, or special privileges. The feature is intended to create price discovery, midweek app engagement, player liquidity tension, and a meaningful player-to-House pin sink.

The core design decision is that Silent Auctions use a **pledge-and-settle** model rather than true escrow.

Because all pin movements are public and ledger-derived, bids should not move pins at bid time. A bid is a private commitment. Pins move only when the auction settles, either through a winning purchase or an immediate check-bounce penalty.

---

## 1. Purpose

Silent Auctions add a new economic sector to the Pinsino economy.

They give the House a way to sell scarce economy-only opportunities without using fixed prices. Instead of the House deciding exactly what something is worth, players compete to price it themselves.

Silent Auctions should create:

- a midweek app engagement loop;
- a meaningful player-to-House pin sink;
- public drama around scarce items;
- strategic decisions around valuation and liquidity;
- comedy from overcommitted bids and bounced checks;
- a reusable market format for future economy systems.

The best version of this feature should make players ask:

> How much is this thing worth, how badly does everyone else want it, and can I stay liquid until settlement?

---

## 2. Core Concept

A Silent Auction is a limited-time auction where:

1. The House lists one or more scarce items or privileges.
2. Players submit hidden pledge bids during the auction window.
3. No pins move when a bid is placed.
4. Bids remain hidden until the auction closes.
5. At settlement, the highest valid bidder who can still afford their pledge wins.
6. The winner pays their bid to the House.
7. The House grants the auction item.
8. If the highest bidder cannot pay, their check bounces.
9. A bounced bidder immediately pays a small penalty.
10. The auction then attempts settlement against the next-highest bidder.

Recommended v1 framing:

> **The House lists one scarce economy-only item. Players submit hidden pledge bids during a limited auction window. No pins move at bid time. At close, the highest bidder who can still afford their pledge wins and pays their bid to the House. If the highest bidder cannot pay, they immediately pay `min(balance, 50)` as a check-bounce penalty, the feed roasts them, and the auction settles against the next-highest valid bidder.**

---

## 3. Why Pledge Bids Instead of Escrow

The Pin Economy intentionally makes all real pin movements public and auditable.

If silent auction bids used true escrow, the escrow transfer itself would reveal that a bid happened and could potentially reveal useful information about the bid size. That conflicts with the silent-auction feel.

Therefore, a bid should be modeled as a **hidden pledge**, not as a pin transfer.

### 3.1 Bid-Time Behavior

At bid time:

- the player chooses a bid amount;
- the app checks that the player can afford the bid at that moment;
- the bid is stored as a private pledge;
- no `pin_ledger` event is created;
- no House transfer occurs;
- the player remains free to spend their pins elsewhere.

### 3.2 Settlement-Time Behavior

At settlement time:

- the system ranks bids;
- the highest bidder is checked against their current available pin balance;
- if they can pay, they win and pins move;
- if they cannot pay, they bounce and pay the bounce penalty;
- the system tries the next bidder.

This preserves the public ledger model while still creating a hidden-bid experience.

---

## 4. Auctionable Assets

Silent Auctions can sell any economy-contained asset or privilege.

Acceptable auction assets include:

| Asset Type | Examples |
|---|---|
| Merchant inventory item | Big Juicer, Golden Ticket, Parlay Rocket |
| Access pass | High Roller Room Key, After Hours Pass |
| Tournament seat | Reserved entry into a limited tournament |
| Bounty license | Right to post one custom bounty |
| Cosmetic | Leaderboard frame, profile badge, title |
| Loan Shark modifier | Interest freeze, garnishment reduction, debt coupon |
| Sportsbook privilege | Special market access, higher stake cap for one market |
| Challenge privilege | Featured challenge slot, reduced PvP rake coupon |

The auctioned asset must never affect actual bowling league gameplay.

It may affect:

- pin balances;
- in-app cosmetics;
- access to economy-only markets;
- future economy-only actions;
- app-visible status or flair.

It must not affect:

- actual bowling scores;
- handicaps;
- team standings;
- lane assignments;
- playoff qualification;
- any real-world competitive advantage.

---

## 5. Recommended V1 Format

V1 should be intentionally simple.

Recommended format:

| Setting | Recommendation |
|---|---|
| Auction type | Single-item sealed-bid auction |
| Pricing model | First-price auction |
| Bid visibility | Hidden until close |
| Bid timing | Limited auction window |
| Bid movement | No pin movement at bid time |
| Settlement | Highest affordable pledge wins |
| Bounce penalty | `min(player_balance, 50)` |
| Tie-breaker | Earliest submitted final bid |
| Auction operator | House/Admin only |
| Player-run auctions | Out of scope for v1 |
| Multi-unit auctions | Out of scope for v1 |

### 5.1 First-Price Settlement

Use first-price settlement in v1:

```text
winner pays their own bid
```

This is not the most theoretically elegant auction format, but it is the best fit for the Pinsino economy.

Why first-price is preferred:

- easiest to understand;
- easiest to explain in the feed;
- creates overpaying drama;
- creates stronger House revenue;
- rewards valuation skill;
- creates liquidity pressure;
- makes check-bounce events funnier.

Second-price auctions can be considered later, but they are less emotionally satisfying for this league. The goal is not auction-theory purity. The goal is controlled economic chaos.

---

## 6. Auction Lifecycle

## 6.1 Auction Creation

Admins create an auction by configuring:

| Field | Meaning |
|---|---|
| Auction item | The asset or privilege being sold |
| Season | Current season |
| Optional week | Week associated with the auction |
| Opens at | When bidding begins |
| Closes at | When bidding ends |
| Minimum bid | Lowest allowed bid |
| Bid increment | Optional minimum increase step |
| Settlement type | First-price for v1 |
| Bounce fee | Default 50 pins |
| Tie-breaker rule | Default earliest final bid |
| Visibility | Public auction, hidden bids |
| Status | Draft, open, closed, settled, cancelled |

Example auction:

```text
Item: Golden Parlay Pass
Minimum bid: 100 pins
Bid increment: 25 pins
Opens: Wednesday 5:00 PM ET
Closes: Monday 7:00 PM ET
Settlement: First-price sealed bid
Bounce penalty: 50 pins
Tie-breaker: Earliest final bid
```

## 6.2 Bidding Window

During the auction window, players may submit bids.

Rules:

- a player may have at most one active bid per auction;
- a player may increase their bid before close;
- lowering or withdrawing bids should be disallowed in v1;
- the player must be able to afford the bid at submission time;
- no pins move at submission time;
- bid values remain hidden from other players;
- the player's own bid is visible to them.

Recommended bid eligibility:

```text
auction.status = open
AND now >= auction.opens_at
AND now <= auction.closes_at
AND bid_amount >= auction.minimum_bid
AND bid_amount follows bid increment rule
AND player_available_balance >= bid_amount
```

## 6.3 Auction Close

At close:

- no new bids are accepted;
- existing bids become locked;
- bid updates are no longer allowed;
- the auction moves to settlement;
- bids may be revealed immediately or after settlement, depending on product choice.

Recommended behavior:

> Reveal the winner immediately after settlement. Reveal the full bid table only on the auction detail page.

## 6.4 Settlement

Settlement ranks all active bids from highest to lowest.

For each bid in order:

1. Derive the bidder's current available pin balance.
2. If the bidder can afford the bid, they win.
3. Create the winning purchase ledger events.
4. Grant the auction item.
5. Mark the auction as settled.
6. Publish auction result feed events.
7. Stop.

If the bidder cannot afford the bid:

1. Calculate `bounce_fee = min(player_available_balance, configured_bounce_fee)`.
2. If `bounce_fee > 0`, create bounced-check ledger events.
3. Mark the bid as bounced.
4. Publish a bounced-check feed event.
5. Continue to the next-highest bid.

If all bidders bounce or no valid bids exist:

- mark auction as `no_sale` or `settled_no_winner`;
- no item is granted;
- publish optional no-sale feed event.

---

## 7. Check-Bounce Mechanic

The check-bounce mechanic is the funniest and most important part of the pledge model.

A player is allowed to bid only up to their available balance at bid time. However, because bids do not escrow pins, the player may later spend down their balance before settlement.

If they win on paper but cannot pay at settlement, their check bounces.

### 7.1 Bounce Fee

Default rule:

```text
bounce_fee = min(player_available_balance, 50)
```

This means:

- the bounce penalty is settled immediately;
- it never creates an ongoing debt obligation;
- it never creates a negative balance;
- it is funny without being season-ending;
- it creates a visible consequence for reckless liquidity management.

### 7.2 Bounce Settlement

If a player bounces:

- the player pays the bounce fee to the House;
- the bid is marked `bounced`;
- the player does not receive the auction item;
- the system attempts settlement against the next-highest bidder.

Ledger event type:

```text
auction_check_bounce
```

Suggested feed copy:

> Garrett's check bounced at the Golden Parlay Pass auction. The House collected 50 pins.

### 7.3 Repeated Bounces

V1 can simply allow repeated bounces because the penalty and public feed event are already meaningful.

Future guardrails may include:

- temporary auction cooldown;
- higher bounce penalties for repeat offenders;
- visible bounced-check count;
- temporary requirement to prepay or escrow future auction bids;
- admin review for obvious abuse.

Do not add these in v1 unless the behavior becomes a real problem.

---

## 8. Visibility Model

Silent Auctions should be public, but bids should be private until close.

## 8.1 Public During Auction

Players may see:

| Public Field | Purpose |
|---|---|
| Auction item | Know what is being sold |
| Item description | Understand value |
| Time remaining | Drive urgency |
| Minimum bid | Set floor |
| Number of bidders | Create social proof |
| Whether current user has bid | Support player state |
| Current user's own bid | Let player track their pledge |

## 8.2 Hidden During Auction

Players should not see:

| Hidden Field | Reason |
|---|---|
| Highest bid | Would turn it into open auction |
| Bid rankings | Would reveal market position |
| Other players' bid amounts | Breaks silent-auction tension |
| Other players' identities, optional | Could reduce secrecy |

V1 recommendation:

- show number of bidders;
- hide bidder identities and bid amounts;
- show the current user's own bid.

## 8.3 After Settlement

After settlement, reveal:

- winner;
- winning price;
- bounced top bids, if any;
- number of bidders.

On the auction detail page, optionally reveal the full bid table:

| Rank | Player | Bid | Result |
|---:|---|---:|---|
| 1 | Garrett | 600 | Bounced |
| 2 | Mike | 475 | Won |
| 3 | Sarah | 450 | Lost |
| 4 | Chris | 300 | Lost |

The main feed should stay curated and show only notable events.

---

## 9. Strategic Behavior

Silent Auctions add a distinct strategy layer to the Pin Economy.

They reward:

- valuation skill;
- social reads;
- liquidity discipline;
- timing;
- risk appetite;
- bankroll management;
- controlled overcommitment.

Players must decide:

| Strategic Question | Tension |
|---|---|
| What is this item worth? | Valuation |
| How badly does everyone else want it? | Social read |
| Should I overbid to guarantee it? | Risk appetite |
| Can I stay liquid until close? | Bankroll discipline |
| Should I spend elsewhere before settlement? | Opportunity cost |
| Should I take a Loan Shark loan to cover the bid? | Leverage |
| Am I baiting someone else into overpaying? | Meta-game |

The most important behavior pattern is:

> I may have the high bid, but I need to stay liquid until Monday.

That creates app engagement between bid placement and settlement.

---

## 10. Weekly Rhythm

Recommended default schedule:

| Day | Auction Activity |
|---|---|
| Tuesday | Auction announced after weekly fallout |
| Wednesday | Bidding opens |
| Thursday-Sunday | Players adjust bids and manage liquidity |
| Monday 6:30 PM | Final warning |
| Monday 7:00 PM | Auction closes at league lock |
| Monday post-lock | Winner revealed |
| Post-archive | Any week-dependent assets become usable, if applicable |

This gives players a reason to open the app throughout the week.

Silent Auctions pair especially well with:

- Merchant drops;
- Loan Shark offers;
- Market Moves;
- Weekly Recaps;
- Sportsbook market openings;
- tournament registration windows.

---

## 11. Economic Model

Silent Auctions are primarily a player-to-House sink.

No pins are minted.

No pins are burned.

Pins move only when:

1. the winner pays the House; or
2. a bounced bidder pays the House.

### 11.1 Winning Purchase

Ledger event type:

```text
auction_purchase
```

Player row:

```text
player_id = winning player
amount = -winning_bid
is_house = false
auction_id = auction id
```

House row:

```text
player_id = null
amount = +winning_bid
is_house = true
auction_id = auction id
```

### 11.2 Bounced Check

Ledger event type:

```text
auction_check_bounce
```

Player row:

```text
player_id = bounced bidder
amount = -bounce_fee
is_house = false
auction_id = auction id
```

House row:

```text
player_id = null
amount = +bounce_fee
is_house = true
auction_id = auction id
```

### 11.3 Losing Bids

Losing bids do not create ledger events.

A losing bid is not a financial transaction.

### 11.4 No Bid-Time Ledger Events

A bid placement should not create a `pin_ledger` event.

This is essential to preserve the silent-auction experience.

---

## 12. Activity Feed / Market Moves Integration

Silent Auctions should publish into Market Moves / Activity Feed as curated public events.

The feed should show auction stories, not every bid.

Recommended event types:

| Event Type | Example Copy |
|---|---|
| `auction_opened` | The Golden Parlay Pass is up for silent auction. |
| `auction_final_warning` | Final bids are due soon for the Golden Parlay Pass. |
| `auction_closed` | Bidding has closed for the Golden Parlay Pass. |
| `auction_won` | Mike won the Golden Parlay Pass for 475 pins. |
| `auction_check_bounce` | Garrett's check bounced. The House collected 50 pins. |
| `auction_no_sale` | Nobody walked away with the Golden Parlay Pass. |
| `auction_big_overpay` | Sarah paid 900 pins for Shark Repellent. Respectfully: concerning. |

Do not publish feed events for:

- every bid placement;
- every bid update;
- losing bids by default;
- admin settlement internals;
- cancelled auctions, unless a non-public admin audit log needs them.

Feed events should deep-link to the auction detail page when appropriate.

---

## 13. Data Model Sketch

Silent Auctions should use dedicated source tables and publish into the Activity Feed through an explicit nullable FK.

Potential future Activity Feed FK:

```sql
auction_id uuid REFERENCES auctions(id) ON DELETE CASCADE
```

## 13.1 `auctions`

Recommended conceptual fields:

```text
id
season_id
week_id nullable
status

auction_type
settlement_type
asset_type
asset_id nullable
asset_payload

display_name
description

opens_at
closes_at
settled_at
cancelled_at

minimum_bid
bid_increment
bounce_fee

tie_breaker_rule
visibility_mode

winning_bid_id nullable
winner_player_id nullable
winning_price nullable

created_at
updated_at
```

Recommended statuses:

```text
draft
scheduled
open
closed
settlement_pending
settled
settled_no_winner
cancelled
```

## 13.2 `auction_bids`

Recommended conceptual fields:

```text
id
auction_id
player_id
season_id

bid_amount
status

submitted_at
superseded_at nullable
settled_at nullable

player_balance_at_submission
settlement_balance nullable
bounce_fee_charged nullable

created_at
updated_at
```

Recommended bid statuses:

```text
active
superseded
withdrawn
lost
won
bounced
invalidated
```

V1 should usually avoid `withdrawn` unless bid withdrawals are explicitly supported.

## 13.3 `auction_awards`

Optional table if auctioned assets require separate delivery records.

```text
id
auction_id
auction_bid_id
player_id
asset_type
asset_id nullable
asset_payload
awarded_at
created_at
```

For Merchant items, delivery may instead create a `player_inventory_items` row and link it back to the auction.

---

## 14. Validation Rules

## 14.1 Bid Submission Validation

Before accepting a bid:

```text
auction exists
auction.status = open
now is within opens_at / closes_at
player belongs to active season
bid_amount >= minimum_bid
bid_amount follows bid_increment rule
player has available balance >= bid_amount
player is eligible to bid
auction asset is still available
```

If the player already has an active bid:

```text
new_bid_amount > existing_active_bid_amount
```

Then mark the prior bid `superseded` and create the new active bid.

## 14.2 Settlement Validation

Before settling:

```text
auction.status IN closed, settlement_pending
now >= closes_at
auction has not already settled
auction asset has not already been granted
active bids are ranked deterministically
```

For each bid:

```text
current_player_balance >= bid_amount -> winner
current_player_balance < bid_amount -> bounced
```

## 14.3 Delivery Validation

Before granting the item:

```text
winning purchase ledger events committed
asset is eligible for delivery
winner has not already received the asset
auction status has not changed during settlement
```

Settlement should be atomic.

---

## 15. Tie-Breaking

Recommended v1 tie-breaker:

> If two players submit the same highest valid bid, the earlier final active bid wins.

Example:

| Player | Bid | Submitted At | Result |
|---|---:|---|---|
| Garrett | 500 | Thursday 9:00 PM | Wins |
| Mike | 500 | Sunday 2:00 PM | Loses |

This rewards early conviction and avoids random outcomes.

Alternative future tie-breakers:

- random winner;
- higher current net worth loses, as underdog preference;
- admin choice;
- sudden-death rebid window.

Use earliest final bid in v1.

---

## 16. Admin Tools

Admins should be able to:

- create auctions;
- edit draft auction metadata;
- schedule auctions;
- open auctions;
- close auctions;
- settle auctions;
- cancel auctions before settlement;
- inspect bids after close;
- inspect hidden bids during live auction only if needed for moderation/debugging;
- manually mark an auction as no-sale;
- reverse/cancel settled auctions if necessary;
- suppress related feed events;
- verify item delivery;
- view bounced-check events.

### 16.1 Admin Cancellation

Admin cancellation should be a destructive rollback where possible.

If an auction is cancelled before settlement:

- no ledger events should exist;
- bids may be deleted or marked cancelled depending on audit needs;
- public feed events should be deleted or suppressed according to the Activity Feed policy.

If an auction is cancelled after settlement:

- reverse or delete winning purchase ledger events according to existing admin rollback conventions;
- revoke the awarded asset if possible;
- delete or suppress related feed events;
- handle consumed assets carefully if the winner already used the item.

The ideal cancellation result is:

> The auction behaves as if it never happened.

---

## 17. Failure Modes and Guardrails

| Risk | Guardrail |
|---|---|
| Fake huge bids | Bid must be affordable at submission time |
| Hidden insolvency at close | Check-bounce settlement |
| Repeated bouncing | Public bounce events and optional future cooldown |
| Bid spam | One active bid per player; only raises allowed |
| Last-second mistakes | Confirmation screen for bid increases |
| Collusion | Generally acceptable unless abusive |
| Negative balances | Bounce fee capped by current balance |
| Auction griefing | Players cannot bid on behalf of others |
| Admin mistakes | Admin cancellation and rollback tools |
| Feed noise | Do not publish every bid |

Silent Auctions should create consequences, not griefing.

Players lose pins only because they voluntarily bid or overextended themselves.

---

## 18. UI Product Surface

## 18.1 Auction List

The Auction list should show:

- active auctions;
- scheduled auctions;
- recently settled auctions;
- item name;
- short description;
- time remaining;
- minimum bid;
- number of bidders;
- current user's bid state.

## 18.2 Auction Detail

The Auction detail page should show:

- item details;
- auction rules;
- open/close time;
- minimum bid;
- bid increment;
- bounce penalty;
- user's current bid;
- bid submission form;
- confirmation screen;
- settlement result after close;
- bid table after settlement, if enabled;
- feed events;
- ledger events for the winner or bounced bidders.

## 18.3 Bid Confirmation

Bid confirmation should clearly state:

> You are pledging X pins. No pins move now, but if you win this auction and still have enough pins at settlement, you will pay X pins to the House. If you cannot pay at settlement, your check will bounce and you will immediately pay up to 50 pins.

For large bids, add stronger copy:

> This bid represents a large share of your current balance. If you spend these pins before settlement, your check may bounce.

---

## 19. Future Variants

## 19.1 Second-Price Silent Auction

Highest bidder wins but pays the second-highest valid bid.

Pros:

- theoretically elegant;
- encourages truthful bidding;
- reduces overpayment regret.

Cons:

- less funny;
- harder to explain;
- weaker House sink;
- less on-brand for Pinsino chaos.

Not recommended for v1.

## 19.2 Multi-Unit Sealed Auction

The House sells multiple copies of the same item.

Example:

> Three Parlay Rockets are available. Top three valid bidders win.

Open design question:

- winners pay their own bids;
- or all winners pay the lowest winning bid.

## 19.3 Player-Run Auctions

Players auction eligible inventory items to other players.

Potential House fees:

- listing fee;
- final-value fee;
- cancellation fee;
- relisting fee.

This becomes very powerful once the Merchant and Secondary Market systems are mature.

## 19.4 Dutch Auction

The item starts at a high price and the price drops over time until someone buys.

This is not truly silent, but it creates panic and timing tension.

## 19.5 Debt Auction

The Loan Shark offers one special loan product or debt modifier by auction.

Example:

> One Shark Repellent is available this week. Highest valid bidder gets one week of interest frozen.

This is dangerous but very on-brand.

---

## 20. Recommended MVP Scope

V1 should include:

- House-created single-item auctions;
- sealed pledge bids;
- one active bid per player per auction;
- bid raises only;
- no bid-time ledger events;
- bid-time affordability check;
- first-price settlement;
- highest affordable bidder wins;
- immediate `min(balance, 50)` check-bounce penalty;
- next-highest-bidder fallback;
- winning purchase ledger events;
- auction result feed events;
- bounced-check feed events;
- admin cancellation tools;
- auction detail page;
- post-settlement winner display.

V1 should exclude:

- player-run auctions;
- second-price auctions;
- multi-unit auctions;
- bid withdrawals;
- bid escrow;
- comments or reactions;
- automated repeat-bid agents;
- arbitrary user-authored auction copy;
- complex anti-collusion tooling.

---

## 21. Summary

Silent Auctions are a sealed-bid, pledge-based market for scarce economy-only assets.

They should not use escrow because escrow would create visible pin movements and undermine bid secrecy. Instead, players privately pledge bids, no pins move at bid time, and settlement happens only when the auction closes.

The highest bidder who can still afford their pledge wins and pays the House. If the highest bidder cannot pay, their check bounces, they immediately pay `min(balance, 50)` as a penalty, and the auction attempts settlement against the next-highest valid bidder.

The feature adds a new economic skill axis: valuation, liquidity management, and social reads. It creates House revenue, midweek engagement, Market Moves content, and public comedy without affecting the underlying bowling league.

In short:

> **Silent Auctions turn scarce Pinsino opportunities into public price-discovery drama, while the bounced-check rule turns reckless overbidding into exactly the kind of self-inflicted chaos this economy wants.**
