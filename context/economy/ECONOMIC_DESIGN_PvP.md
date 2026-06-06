# Economic Design — PvP Challenge Contracts

This document summarizes the proposed **PvP challenge** expansion for the Pin Economy.

The PvP challenge system is intended to become a foundational economic sector alongside the existing **Pinsino** sportsbook. Where the Pinsino currently supports player-vs-house betting, PvP challenges introduce direct player-vs-player social engagement through opt-in economic contracts.

The core design objective is to create a high-social-engagement, strategic, poker-like metagame inside the bowling league app while preserving the integrity of the underlying bowling league.

---

## 1. Design Context

### 1.1 The Pin Economy as a Game Within a Game

The base layer of the league is standard bowling. Players bowl games, scores are recorded, team results are tracked, and individual performance generates weekly **pincome**.

The Pin Economy is the game within that game. It uses bowling results as raw material, but its mechanics should remain fully contained inside the app economy.

PvP challenges should therefore:

- Increase weekly engagement with the app.
- Create opportunities for direct player interaction.
- Support trash talk, rivalry, risk-taking, negotiation, and strategic depth.
- Create chaos and fun without compromising the underlying bowling league.
- Reward clever play across economic sectors.
- Allow players to win or lose based on voluntary economic decisions.

### 1.2 Non-Negotiable Integrity Constraint

PvP challenges must **never affect actual bowling league gameplay**.

They must not influence:

- League standings.
- Team wins or losses.
- Player handicaps.
- Lane assignments.
- Bowling order.
- Actual scores.
- Playoff qualification.
- Any competitive rule of the underlying bowling league.

Some bowlers may not care about the Pin Economy at all. Their ability to enjoy and compete in the actual bowling league must be protected.

### 1.3 Allowed Reward Space

PvP challenge rewards may affect:

- Pin balances.
- App leaderboard position.
- In-app cosmetics.
- Badges, titles, profile decorations, or trophies.
- Economy-only powers or modifiers.
- Access to economy-only events.
- Challenge history, rivalry history, and social-feed status.

PvP challenge rewards may not create any real-world or bowling-gameplay advantage.

---

## 2. Core Principle: Voluntary Risk

The most important behavioral guardrail is:

> **No accepted contract, no economic exposure.**

A player should only be able to lose pins because they voluntarily took an economic action, such as:

- Accepting a challenge.
- Posting an open challenge.
- Entering a side pot.
- Accepting a counteroffer.
- Buying a risky item.
- Taking a loan.
- Entering a tournament.
- Opting into a special event.

PvP challenges should not allow one player to unilaterally punish, embarrass, grief, or economically harm another player.

Losses should feel earned or self-inflicted, not imposed.

---

## 3. Challenge Contract

The **Challenge Contract** is the foundational object for PvP economic activity.

A Challenge Contract is a structured, opt-in agreement between two or more players. It defines the parties, stakes, economic terms, settlement condition, expiration, escrow behavior, and outcome handling.

All PvP challenge types should be expressible as Challenge Contracts.

---

## 4. Economic Model of a Challenge Contract

### 4.1 Contract Participants

A basic two-player contract includes:

- **Creator / Challenger:** the player who initiates the contract.
- **Counterparty / Opponent:** the player who accepts, declines, ignores, or counters the contract.
- **House / Pinsino:** the economic intermediary that escrows stakes, collects rake, and pays winnings.

Optional future contract structures may include:

- Multiple participants.
- Open challenge boards where the first eligible player can accept.
- Group side pots.
- Team-based economic contests.
- Admin-created challenge events.

### 4.2 Escrow Model

Once a contract is accepted:

1. Each required participant stakes pins.
2. The stakes are transferred into House escrow.
3. The staked pins are no longer available for other wagers or contracts.
4. The contract becomes active.
5. At settlement, the House pays the winner according to the contract outcome.
6. The House retains the documented rake.

This preserves the existing accounting style of the Pin Economy: pins move between players and the House rather than requiring direct wallet-to-wallet transfers.

### 4.3 Rake

The House takes a **5% rake of contract winnings**.

This should be clearly displayed in the UI before contract acceptance.

Recommended default wording:

> **Challenge rake: 5% of gross winnings, retained by the House.**

For a standard even-stake contract:

- Player A stakes 100 pins.
- Player B stakes 100 pins.
- Total pot is 200 pins.
- Winner receives 190 pins.
- House retains 10 pins.

The rake is taken from the gross pot at settlement, not as an upfront fee.

### 4.4 Rake Rounding

A deterministic rounding rule is required.

Recommended rule:

> Rake is calculated as `floor(total_pot * 0.05)`.

This avoids fractional pins and slightly favors players on small contracts.

Example:

| Total Pot | 5% Exact | House Rake | Winner Payout |
|---:|---:|---:|---:|
| 20 | 1.0 | 1 | 19 |
| 25 | 1.25 | 1 | 24 |
| 50 | 2.5 | 2 | 48 |
| 100 | 5.0 | 5 | 95 |
| 200 | 10.0 | 10 | 190 |
| 500 | 25.0 | 25 | 475 |

### 4.5 Pushes, Voids, and Refunds

Contracts need clear treatment for non-winning outcomes.

Recommended rules:

- **Push:** If the contract outcome is tied, all stakes are refunded and no rake is collected.
- **Void:** If the contract cannot be settled fairly, all stakes are refunded and no rake is collected.
- **Admin cancellation before settlement:** All stakes are refunded and no rake is collected.
- **Cancellation after settlement:** Admin-only action that reverses the original payout and rake if necessary.

### 4.6 House Reserve Treatment

All rake and fees go to the House reserve.

The House can be treated as operationally infinite for trialing mechanics, but challenge rake still matters as:

- A balancing mechanism.
- A player-side sink.
- A narrative source of House revenue.
- A future reserve-health lever.

---

## 5. Challenge Contract Data Model

A Challenge Contract should contain enough structured data to support multiple contract types without custom one-off implementations.

### 5.1 Core Fields

Recommended core fields:

```yaml
contract_id: unique identifier
contract_type: enum
status: enum

creator_player_id: player id
counterparty_player_id: player id or null for open challenge
participants: list of player ids

season_id: season id
week_id: league week id
game_scope: enum or structured object

stake_terms:
  stake_type: fixed | asymmetric | variable | side_pot
  creator_stake: integer
  counterparty_stake: integer
  total_pot: integer
  rake_rate: 0.05
  rake_amount: integer
  payout_amount: integer

settlement_terms:
  metric_type: enum
  subject_player_ids: list of player ids
  target_score: optional integer
  spread: optional integer
  line_source: optional reference
  win_condition: structured expression
  push_condition: structured expression

lifecycle:
  created_at: timestamp
  expires_at: timestamp
  accepted_at: timestamp or null
  locked_at: timestamp or null
  settled_at: timestamp or null

messages:
  creator_message: optional text
  counter_message: optional text
  admin_note: optional text

result:
  winner_player_id: player id or null
  losing_player_ids: list
  settlement_values: structured result data
  payout_event_ids: list
  rake_event_id: event id
```

### 5.2 Statuses

Recommended status lifecycle:

```yaml
draft
pending
countered
accepted
escrowed
locked
settlement_pending
settled
pushed
voided
cancelled
expired
```

Definitions:

- **draft:** Contract is being composed but has not been sent or posted.
- **pending:** Contract has been sent to a counterparty or posted to the board.
- **countered:** A counteroffer exists and awaits response.
- **accepted:** Terms have been accepted by all required parties.
- **escrowed:** Stakes have been transferred to House escrow.
- **locked:** Contract can no longer be casually cancelled or modified.
- **settlement_pending:** Relevant bowling data exists or admin review is needed.
- **settled:** Contract has paid out.
- **pushed:** Contract tied and stakes were refunded.
- **voided:** Contract could not be settled fairly and stakes were refunded.
- **cancelled:** Admin cancelled the contract.
- **expired:** Contract was not accepted before expiration.

### 5.3 Locking

A contract should lock at a predictable time.

Recommended default:

> Contracts lock when the relevant betting/game window closes for the applicable league week or game.

Once locked:

- Contract terms cannot be modified.
- Participants cannot withdraw casually.
- Admins may still cancel or void for integrity reasons.
- Settlement should occur automatically or through admin action after game archival.

### 5.4 Expiration

Pending contracts should expire automatically.

Recommended default:

- Direct challenges expire before league-night lock if not accepted.
- Open board challenges expire at the same lock time unless configured otherwise.
- Counteroffers reset or shorten expiration according to product rules.

Potential rule:

> A counteroffer inherits the original expiration unless the countering player proposes a shorter expiration.

---

## 6. Counteroffers

Counteroffers are a first-class mechanic.

They are essential because they turn challenges from simple accept/decline wagers into social, strategic negotiations.

### 6.1 Counteroffer Actions

Players should be able to counter:

- Stake amount.
- Contract type.
- Game scope.
- Series scope.
- Spread.
- Target score.
- Opponent.
- Expiration.
- Optional message.

Examples:

- Original: “Line Duel, Game 1, 100 pins.”
- Counter: “Make it 250 pins.”
- Counter: “I’ll do 250, but total series instead of Game 1.”
- Counter: “Raw score, but you get +20.”
- Counter: “Same terms, double or nothing next week.”

### 6.2 Counteroffer Lifecycle

Recommended lifecycle:

1. Player A creates a challenge.
2. Player B counters with modified terms.
3. Original challenge becomes inactive or superseded.
4. Player A can accept, decline, or counter again.
5. Once any counteroffer is accepted, the contract is finalized.
6. Stakes are escrowed.
7. Contract proceeds through lock and settlement.

### 6.3 Counteroffer Integrity Rules

Counteroffers must be explicit and auditable.

Rules:

- A counteroffer must show all changed terms.
- Accepting a counteroffer means accepting the full revised contract.
- Only the latest active offer can be accepted.
- Prior offers should be retained in contract history for auditability.
- A counteroffer should not silently preserve ambiguous terms.
- All stake, rake, and payout numbers must be recalculated and displayed before acceptance.

### 6.4 Counteroffer History

Contract history should record:

- Who made each offer.
- Which terms changed.
- When the offer was made.
- When it expired or was superseded.
- Whether it was accepted or declined.
- Any attached messages.

This history will support both auditability and social feed storytelling.

---

## 7. Challenge Engine

The **Challenge Engine** is the general system responsible for creating, negotiating, validating, escrowing, locking, settling, and displaying Challenge Contracts.

It should be implemented as a reusable service/module rather than as separate bespoke logic for each challenge type.

### 7.1 Responsibilities

The Challenge Engine should handle:

- Contract creation.
- Contract validation.
- Eligibility checks.
- Balance checks.
- Counteroffer generation.
- Expiration.
- Acceptance.
- Escrow.
- Locking.
- Settlement routing.
- Payouts.
- Rake collection.
- Refunds.
- Admin cancellation.
- Activity feed events.
- Player notifications.
- Ledger entries.
- Contract history.
- Player profile challenge stats.

### 7.2 Validation Responsibilities

The Challenge Engine should validate:

- All required participants exist.
- All participants are eligible for the contract.
- All participants have sufficient available pin balance.
- The contract does not violate anti-tanking rules.
- The contract does not affect real bowling gameplay.
- Stakes meet minimums.
- Rake and payout are calculated correctly.
- The relevant week/game/player data exists.
- The contract can be settled from available data or through admin action.
- Expiration and lock times are valid.
- Open challenges have clear acceptance rules.
- Counteroffers do not create invalid or ambiguous contracts.

### 7.3 Settlement Responsibilities

Settlement may be:

- Fully automatic from archived bowling scores.
- Semi-automatic with admin approval.
- Fully admin-adjudicated for social or custom contracts.

The Challenge Engine should provide a common settlement interface:

```yaml
settlement_input:
  contract_id: id
  settlement_source: automatic | admin
  observed_values: structured data
  admin_id: optional
  admin_note: optional

settlement_output:
  outcome: winner | push | void
  winner_player_id: optional
  payout_events: list
  rake_event: optional
  refund_events: list
  feed_event: id
```

### 7.4 Ledger Responsibilities

Every economic movement must be represented as append-only pin events.

A settled challenge may generate events such as:

- Stake transfer from Player A to House escrow.
- Stake transfer from Player B to House escrow.
- Payout transfer from House to winner.
- Rake retained by House.
- Refund transfer from House to Player A.
- Refund transfer from House to Player B.
- Admin reversal if necessary.

Challenge events should be traceable from both:

- The player pincome statement.
- The House ledger.
- The contract detail page.

### 7.5 Notifications

The Challenge Engine should support push or in-app notifications for:

- Challenge received.
- Challenge accepted.
- Challenge declined.
- Counteroffer received.
- Challenge expiring soon.
- Challenge locked.
- Challenge settled.
- Challenge pushed or voided.
- Rematch offered.
- Rivalry updated.
- Open challenge accepted.

### 7.6 Activity Feed Events

PvP challenges are social objects. The activity feed is a major part of the feature.

Recommended feed events:

- Challenge issued.
- Challenge accepted.
- Counteroffer made.
- Contract locked.
- Contract settled.
- Upset result.
- Large pot won.
- Rematch offered.
- Rivalry milestone.
- Side pot winner.
- King of the Hill title defended or lost.

Declines should generally not be amplified in a shaming way.

---

## 8. UI Product Surfaces

### 8.1 Challenge Creation Flow

Players should be able to create a challenge by choosing:

- Opponent or open board.
- Contract type.
- Week/game scope.
- Stake.
- Optional spread or target.
- Optional message.
- Expiration.
- Visibility.

The confirmation screen must show:

- Stake required.
- Total pot.
- House rake.
- Net payout.
- Settlement rule.
- Lock time.
- Whether the challenge affects bowling gameplay — always no.

### 8.2 Pending Challenge Inbox

Players need a surface for:

- Received challenges.
- Sent challenges.
- Counteroffers.
- Expiring offers.
- Accepted active contracts.
- Settled history.

Actions:

- Accept.
- Decline.
- Counter.
- View details.
- Mute/block challenge requests from a specific player if needed.

### 8.3 Challenge Board

The Challenge Board is a public marketplace for open contracts.

It should show:

- Contract type.
- Creator.
- Stake.
- Pot.
- Rake.
- Game/week scope.
- Expiration.
- Acceptance eligibility.
- Number of available slots if multi-player.

Players can:

- Accept open challenges.
- Counter if allowed.
- Filter by type, stake, week, or creator.
- Post their own open challenge.

### 8.4 Contract Detail Page

Every contract should have a detail page showing:

- Current status.
- Participants.
- Terms.
- Pot.
- Rake.
- Net payout.
- Settlement condition.
- Relevant player lines or historical context.
- Offer/counteroffer history.
- Ledger events.
- Activity feed events.
- Admin notes when applicable.

### 8.5 Player Profiles

Player profiles can display:

- Active challenges.
- Challenge record.
- Rivalry records.
- Biggest challenge win.
- Biggest challenge loss.
- Current titles.
- Challenge badges.
- Recent PvP history.

---

## 9. Guardrails

Recommended guardrails:

1. All PvP exposure must be opt-in.
2. No challenge can affect real bowling league gameplay.
3. No negative balances.
4. Stakes are escrowed when a contract is accepted.
5. Declines are not publicly shaming.
6. No contracts based on intentionally poor self-performance.
7. Players can mute/block challenge requests from specific players if needed.
8. Admins can cancel or void contracts.
9. All contract terms are visible before acceptance.
10. Rake is clearly displayed.
11. Contracts cannot be edited after acceptance except through explicit counteroffer before lock or admin action.
12. No hidden terms.
13. Open board contracts must be accepted under the exact posted terms unless countered.
14. Contract history is preserved for auditability.
15. Repeated harassment through challenge spam should be rate-limited or moderated.

---

## 10. Recommended MVP Scope

The first implementation should focus on the general **Challenge Engine** and a small set of high-value contract types.

Recommended MVP:

1. **Direct Line Duel**
2. **Player Prop Duel**
3. **Open Challenge Board**
4. **Counteroffers**
5. **Escrow**
6. **5% House rake**
7. **Settlement from archived bowling data**
8. **Challenge activity feed events**
9. **Admin cancel/void tools**
10. **Double-or-Nothing Rematch**

Do not try to implement every challenge type in the first release. The priority is to build the reusable contract foundation correctly.

---

# 11. Suggested PvP Contract Types

The following contract types summarize the initial brainstorming set. They do not all need to be implemented immediately.

---

## 11.1 Head-to-Head Line Duel

### Summary

Two players compete on who performs better relative to their own Pinsino line.

### Example

| Player | Pinsino Line | Actual Score | Net vs. Line |
|---|---:|---:|---:|
| Garrett | 155 | 172 | +17 |
| Mike | 185 | 194 | +9 |

Garrett wins because he beat his line by more.

### Why It Works

This is likely the best default PvP challenge type.

It allows players of different skill levels to compete meaningfully because the contest is based on overperformance relative to expectation, not raw score.

### Settlement Metric

```yaml
actual_score - player_line
```

Highest value wins.

### Push Condition

Both players finish with the same net value versus their lines.

### MVP Priority

Very high.

This should be one of the first implemented PvP contract types.

---

## 11.2 Raw Score Duel

### Summary

Two players compete on raw score.

### Example

“Game 2, straight up, 100 pins.”

Highest score wins.

### Why It Works

It is simple, intuitive, and good for direct trash talk.

### Risk

Better bowlers have a structural advantage.

### Design Recommendation

Support this as an optional challenge type, but do not make it the default.

### MVP Priority

Medium.

---

## 11.3 Series Duel

### Summary

Two players compete across the full league night rather than a single game.

### Example

“Total series, all games, 500 pins.”

Highest total score wins.

### Variants

- Raw total series.
- Net versus projected series.
- Best two out of three games.
- Biggest single-game overperformance.

### Why It Works

Creates suspense across the full night and rewards consistency.

### MVP Priority

Medium.

---

## 11.4 Spread Challenge

### Summary

One player gives another player an economic spread inside the contract.

### Example

“I’ll give you +25 on total series.”

Player A must beat Player B’s total series by more than 25 pins to win.

### Why It Works

Introduces negotiation and pricing skill.

This is one of the most poker-like challenge types because the value is in the terms, not just the outcome.

### Integrity Note

The spread exists only inside the Pin Economy contract. It must not affect bowling league handicap or scoring.

### MVP Priority

Medium to high if counteroffer infrastructure is already strong.

---

## 11.5 Call Your Shot

### Summary

A player declares a positive performance target, and another player accepts the other side.

### Example

“I will bowl at least 175 in Game 1.”

If the player hits 175 or higher, they win. Otherwise the opponent wins.

### Why It Works

This is highly social and bravado-driven.

It creates a clear moment for the league to watch.

### Guardrail

Targets should be positive-performance only.

Avoid contracts where a player profits from performing poorly.

### MVP Priority

Medium.

---

## 11.6 Accuracy Duel

### Summary

Two players predict a third player’s score. Closest prediction wins.

### Example

Garrett predicts John bowls 151.

Mike predicts John bowls 164.

John bowls 158.

Garrett is off by 7. Mike is off by 6. Mike wins.

### Why It Works

This rewards knowledge of the league and creates social interaction without economically affecting the third player.

### Important Constraint

The subject player is not financially affected by the contract unless they voluntarily participate separately.

### MVP Priority

High potential, but may require additional UI for score predictions.

---

## 11.7 Player Prop Duel

### Summary

Two players take opposite sides of an existing Pinsino prop or line.

### Example

Garrett takes “Mike over 178.5.”

Chris takes “Mike under 178.5.”

Each stakes 100 pins.

Winner takes the pot after rake.

### Why It Works

This converts existing player-vs-house sportsbook markets into player-vs-player disagreements.

It reuses existing line generation and settlement logic.

### MVP Priority

Very high.

This should be part of the initial PvP release.

---

## 11.8 Challenge Board

### Summary

A public board where players can post open challenges for others to accept.

### Example Listings

- “I’ll beat my Game 1 line by more than you beat yours. 100 pins. First taker.”
- “Raw total series duel. 250 pins.”
- “Closest prediction on Dave’s Game 2 score. 50 pins.”
- “I’ll go over 500 series. Who wants the under?”

### Why It Works

The board creates app engagement throughout the week.

It allows players to browse available action, accept challenges, counter terms, and create social momentum.

### MVP Priority

Very high.

The Challenge Board should be a core product surface.

---

## 11.9 Rivalry Challenge

### Summary

A multi-week challenge series between two players.

### Example

Best 3 out of 5 weekly line duels.

Each weekly duel has a 100-pin stake.

The overall rivalry winner may receive an additional bonus pot, title, badge, or cosmetic trophy.

### Why It Works

Creates season-long narrative.

Rivalries can become visible storylines in the app.

### MVP Priority

Medium to low for initial release, but high long-term potential.

---

## 11.10 Double-or-Nothing Rematch

### Summary

After a player loses a challenge, they can propose a rematch for double the previous stake.

### Example

Player A loses a 100-pin duel.

The app prompts: “Run it back next week for 200?”

Player B can accept, decline, or counter.

### Why It Works

This captures poker-table energy.

It creates ego, escalation, and memorable bad decisions while remaining opt-in.

### Guardrail

Both players must accept the rematch.

### MVP Priority

High.

This is a lightweight feature that creates a strong social loop.

---

## 11.11 Side Pot Challenge

### Summary

Multiple players enter a shared contest. Winner takes the pot after rake.

### Example

“Highest score above personal line this week.”

Ten players enter for 100 pins each.

Total pot is 1,000 pins.

House rake is 50 pins.

Winner receives 950 pins.

### Why It Works

This is social, scalable, and accessible.

It gives lower-ranked players a high-upside shot without creating artificial catch-up bonuses.

### MVP Priority

Medium.

This may be best treated as a bridge between PvP Challenges and Tournaments.

---

## 11.12 King of the Hill

### Summary

One player holds a title. Other players can challenge them for it.

### Example

Current title: **Kingpin**.

A challenger stakes 200 pins to challenge the Kingpin.

If the challenger wins, they receive the pot and take the title.

If the Kingpin wins, they keep the title and receive the pot.

### Why It Works

Creates status, recurring narrative, and public targets.

### Guardrail

Avoid dogpiling.

Potential limits:

- One active challenge at a time.
- Weekly challenge cap.
- Kingpin can accept only a limited number of challengers.
- Eligibility based on challenge board order.

### MVP Priority

Low to medium.

High flavor value, but likely not necessary for the first implementation.

---

# 12. Example Contract Lifecycle

## 12.1 Direct Challenge

1. Garrett creates a Line Duel against Mike.
2. Garrett sets the stake at 100 pins.
3. The app shows:
   - Garrett stake: 100
   - Mike stake: 100
   - Total pot: 200
   - House rake: 10
   - Winner payout: 190
4. Mike receives a notification.
5. Mike counters: “Make it 250 pins.”
6. Garrett accepts.
7. Both players stake 250 pins.
8. Total pot is 500.
9. House rake will be 25.
10. Winner payout will be 475.
11. Contract locks before league night.
12. Scores are archived after Monday games.
13. The contract is settled.
14. Winner receives 475 pins.
15. House keeps 25 pins.
16. Activity feed posts the result.
17. Loser can offer a double-or-nothing rematch.

## 12.2 Open Challenge Board

1. Garrett posts an open challenge:
   - “Line Duel, Game 1, 100 pins, first taker.”
2. The challenge appears on the Challenge Board.
3. Mike accepts.
4. Stakes are escrowed.
5. The challenge proceeds like a direct challenge.
6. The board listing closes once accepted.

## 12.3 Push

1. Garrett and Mike enter a Line Duel.
2. Both beat their lines by exactly +12.
3. The contract pushes.
4. Both stakes are refunded.
5. No rake is collected.
6. Activity feed may show a neutral result.

---

# 13. Social Feed Examples

### Challenge Issued

> Garrett challenged Mike to a Line Duel for 100 pins.

### Counteroffer Made

> Mike countered Garrett’s challenge: 250 pins, total series.

### Challenge Accepted

> Garrett accepted. 500 pins are on the line.

### Contract Settled

> Garrett beat his line by +17. Mike beat his by +9. Garrett wins 475 pins after rake.

### Rematch Offered

> Mike wants to run it back next week for 500 pins.

### Side Pot Won

> Chris won the weekly overperformance side pot and took home 950 pins.

### King of the Hill

> Sarah defended the Kingpin title and collected 190 pins.

---

# 14. Admin Tools

PvP challenges should be integrated into the existing Pinsino Admin framework.

Admin functions should include:

- View all active contracts.
- Filter by status, week, player, and contract type.
- Manually lock a contract.
- Manually settle a contract.
- Void a contract.
- Cancel a pending or active contract.
- Reverse an incorrectly settled contract.
- View contract history.
- View escrowed stakes.
- View rake collected.
- Add admin notes.
- Suppress inappropriate feed messages.
- Rate-limit or moderate challenge spam if necessary.

Admin action should be logged.

---

# 15. Open Design Questions

These questions should be resolved before implementation.

1. What is the minimum stake for a PvP contract?
2. Should stake sizes have a maximum?
3. Should maximum stake depend on player balance?
4. Can asymmetric stakes be supported in v1?
5. Are open board challenges always first-come-first-served?
6. Can a player have multiple active challenges against the same opponent?
7. Should players be able to mute challenge requests from specific people?
8. Should declines ever appear in the feed?
9. How much of the counteroffer history is public?
10. Should player lines be frozen when the contract is accepted or when betting locks?
11. Should contracts be allowed after league-night games have started?
12. Should side pot contracts collect rake from the total pot or only from winnings?
13. Should rematches inherit the original contract type automatically?
14. Should player-created messages be moderated or constrained by templates?
15. Should challenge records count pushes separately from wins/losses?

---

# 16. Implementation Recommendation

Build the system in this order:

## Phase 1 — Challenge Foundation

- Challenge Contract model.
- Contract statuses.
- Escrow events.
- Rake calculation.
- Accept/decline.
- Counteroffers.
- Contract detail page.
- Admin cancellation/voiding.
- Ledger integration.

## Phase 2 — First Contract Types

- Head-to-Head Line Duel.
- Player Prop Duel.
- Raw Score Duel if easy to support.
- Open Challenge Board.

## Phase 3 — Social Loop

- Activity feed events.
- Push notifications.
- Rematch offers.
- Player profile challenge history.
- Biggest win/loss stats.

## Phase 4 — Expanded PvP

- Accuracy Duel.
- Call Your Shot.
- Spread Challenge.
- Series Duel.
- Side Pot Challenge.

## Phase 5 — Season Narrative

- Rivalry Challenge.
- King of the Hill.
- Titles and trophies.
- Cosmetic rewards.
- Season-end challenge awards.

---

# 17. Summary

PvP challenges should be built around a reusable **Challenge Contract** and **Challenge Engine**.

The engine should support opt-in economic contracts, first-class counteroffers, House escrow, a clear 5% rake on contract winnings, settlement through bowling data or admin action, and public social-feed moments.

The initial implementation should focus on a small number of contract types while making the underlying contract infrastructure general enough to support richer PvP formats later.

The most important design rule is that PvP challenge losses must come from voluntary economic decisions. This keeps the Pin Economy social, strategic, and chaotic without compromising the actual bowling league or making players feel unfairly targeted.
