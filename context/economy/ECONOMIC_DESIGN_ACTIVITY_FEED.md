# Economic Design — Activity Feed

This document specifies the **Activity Feed** feature for the Pindejos Bowling League Pin Economy.

The Activity Feed is a public, curated, social event stream that consolidates notable economic activity from existing and future Pin Economy systems. It is intended to become a foundational app surface that new economic features can publish into as they are built.

For v1, the Activity Feed supports two existing economic sectors:

- **Sportsbook**
- **Loan Shark**

Future systems such as the Traveling Merchant, PvP Challenge Contracts, Bounty Boards, Auctions, Side Pots, Weekly Recaps, and Admin Announcements should integrate with the same Activity Feed architecture.

---

## 1. Purpose

The Activity Feed is the app's public economic newswire.

It answers:

> What is happening in the league economy right now?

The feed should turn economic activity into visible league stories:

- big Sportsbook tickets;
- parlays placed and hit;
- major wins;
- bad beats;
- House weekly results;
- Loan Shark visits;
- loans fully repaid;
- special offers;
- future PvP challenges;
- future Merchant drops;
- future Bounty Board activity;
- future auction results;
- weekly recap moments.

The Activity Feed should increase app engagement, support trash talk, create social narrative, and make the Pin Economy feel alive throughout the week.

---

## 2. Feed vs. Ledger

The Activity Feed is **not** the economic ledger.

The Pin Economy already uses ledger-first accounting. Player balances, House balances, loans, repayments, bet settlements, and other economic state should continue to be derived from their authoritative source tables and append-only ledger records.

The Activity Feed is a separate public narrative layer.

| System | Purpose |
|---|---|
| `pin_ledger` | Authoritative record of pin movement |
| `loan_ledger` | Authoritative record of debt balance changes |
| Feature tables | Authoritative records for bets, loans, contracts, items, etc. |
| Activity Feed | Public, curated, story-oriented activity stream |
| Notifications | User-specific prompts requiring attention |

### Core rule

> The ledger answers “what happened financially?”  
> The Activity Feed answers “what is worth showing publicly?”

Not every economic event should create a public feed entry.

---

## 3. Design Principles

### 3.1 Public, but Curated

The feed should show socially meaningful economic activity, not every transaction.

Good feed events are:

- visible;
- legible;
- fun;
- notable;
- strategic;
- tied to a public story;
- safe to show to the whole league.

The feed should not become a noisy transaction dump.

### 3.2 Relationally Anchored

Each feed event should maintain explicit nullable foreign keys to concrete source activity tables.

The feed should not rely on a generic polymorphic source ID such as:

```text
source_action_id
source_type
```

Instead, each new source activity type should add its own nullable foreign key column to `activity_feed_events`.

For v1:

```text
sportsbook_bet_id
loan_id
```

Future examples:

```text
merchant_drop_id
merchant_purchase_inventory_item_id
pvp_challenge_contract_id
bounty_id
auction_id
side_pot_id
weekly_recap_id
admin_announcement_id
```

This preserves referential integrity and allows destructive admin cancellation to cleanly delete feed events through `ON DELETE CASCADE`.

### 3.3 Source Invalidation Deletes Feed Rows

If the source economic action is destructively cancelled, all associated feed rows should be physically deleted by database cascade.

This is consistent with the existing admin cancellation philosophy:

> Destructive cancellation should make the action behave as if it never happened.

### 3.4 Suppression Is for Moderation Only

Suppression is different from source cancellation.

| Situation | Feed behavior |
|---|---|
| Source action is destructively cancelled | Feed row is deleted by FK cascade |
| Source action remains valid but feed post should be hidden | Feed row status becomes `suppressed` |
| Feed copy is inappropriate or noisy | Feed row status becomes `suppressed` |
| Admin wants to restore a hidden valid event | Feed row status becomes `published` |

Do not use statuses such as:

```text
cancelled
rolled_back
deleted
voided
```

Cancelled source actions should not leave public feed traces behind.

### 3.5 Privacy-Aware

The feed must be especially careful with Loan Shark activity.

Loan activity may appear publicly, but detailed debt information should not.

The feed may show:

- vague Loan Shark visits;
- vague loan payoff moments;
- special offer announcements.

The feed should not show:

- loan product name;
- borrow amount;
- interest rate;
- garnishment rate;
- current outstanding debt;
- weekly garnishment;
- weekly interest;
- missed-week loan consequences.

### 3.6 Feature-Neutral

The feed should not contain Sportsbook-specific or Loan-specific business logic.

Each feature should publish structured feed events through a common service, but the source feature remains authoritative for its own rules, settlement, balances, ledgers, and cancellation.

### 3.7 Template-Driven Copy

Feed rows should not store final rendered text as the canonical representation.

Instead, feed events should store:

```text
template_key
public_payload
admin_payload
```

The app renders public copy from controlled templates.

This allows copy, tone, and display formatting to evolve without rewriting historical event rows.

---

## 4. Conceptual Architecture

The Activity Feed is a shared publication layer.

Recommended flow:

```text
Feature action happens
→ feature writes its own source records
→ feature writes ledger records if pins move
→ feature publishes an activity feed event
→ feed renders the public story
```

Example Sportsbook flow:

```text
Player places bet
→ bet row is created
→ stake ledger rows are created
→ ActivityFeedService publishes a feed event, if event is feed-worthy
```

Example Loan Shark flow:

```text
Player takes loan
→ loan row is created
→ loan_ledger row is created
→ pin_ledger loan issuance rows are created
→ ActivityFeedService publishes vague Loan Shark feed event
```

---

## 5. Data Model

## 5.1 `activity_feed_events`

Recommended v1 schema:

```sql
CREATE TABLE activity_feed_events (
  id uuid PRIMARY KEY,

  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week_id uuid REFERENCES weeks(id) ON DELETE SET NULL,

  source_feature text NOT NULL,
  event_type text NOT NULL,

  actor_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  subject_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  secondary_player_id uuid REFERENCES players(id) ON DELETE SET NULL,

  sportsbook_bet_id uuid REFERENCES bets(id) ON DELETE CASCADE,
  loan_id uuid REFERENCES loans(id) ON DELETE CASCADE,

  visibility text NOT NULL DEFAULT 'public',
  importance text NOT NULL DEFAULT 'normal',

  template_key text NOT NULL,
  public_payload jsonb NOT NULL DEFAULT '{}',
  admin_payload jsonb NOT NULL DEFAULT '{}',

  occurred_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'published',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT activity_feed_one_source_check CHECK (
    (sportsbook_bet_id IS NOT NULL)::int +
    (loan_id IS NOT NULL)::int
    <= 1
  )
);
```

### 5.2 Future FK Columns

As future economic activity types are added, add concrete nullable FK columns to `activity_feed_events`.

Examples:

```sql
ALTER TABLE activity_feed_events
ADD COLUMN merchant_drop_id uuid REFERENCES merchant_drops(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events
ADD COLUMN merchant_purchase_inventory_item_id uuid REFERENCES player_inventory_items(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events
ADD COLUMN pvp_challenge_contract_id uuid REFERENCES challenge_contracts(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events
ADD COLUMN bounty_id uuid REFERENCES bounties(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events
ADD COLUMN auction_id uuid REFERENCES auctions(id) ON DELETE CASCADE;

ALTER TABLE activity_feed_events
ADD COLUMN side_pot_id uuid REFERENCES side_pots(id) ON DELETE CASCADE;
```

When new FK columns are added, update the source-count check constraint accordingly.

### 5.3 Source Count Constraint

A feed event should generally reference at most one concrete source activity row.

For v1:

```sql
CONSTRAINT activity_feed_one_source_check CHECK (
  (sportsbook_bet_id IS NOT NULL)::int +
  (loan_id IS NOT NULL)::int
  <= 1
)
```

This permits zero or one source FK.

Zero source FKs are allowed for v1 because some system/admin events may not yet have dedicated source tables, such as:

```text
The Sportsbook is open for Week 4.
The Loan Shark has new offers available.
The House cleaned up this week.
```

However, recurring aggregate concepts should eventually receive their own source tables.

Potential future source tables:

```text
sportsbook_weekly_reports
loan_shark_offer_events
weekly_economy_reports
admin_announcements
```

### 5.4 Source Feature Consistency

Application-layer validation should ensure that `source_feature` matches the source FK.

Examples:

```text
source_feature = 'sportsbook' → sportsbook_bet_id is present for bet-specific events
source_feature = 'loan_shark' → loan_id is present for loan-specific events
source_feature = 'admin' → no source FK required in v1
source_feature = 'system' → no source FK required in v1
```

If stronger database enforcement is desired later, this can be implemented with check constraints or trigger-based validation.

---

## 6. Controlled Fields

### 6.1 `source_feature`

Controlled values for v1:

```text
sportsbook
loan_shark
system
admin
```

Future values may include:

```text
merchant
pvp_challenge
bounty_board
auction
side_pot
weekly_recap
```

### 6.2 `event_type`

`event_type` identifies the specific event within a source feature.

V1 Sportsbook examples:

```text
sportsbook_bet_placed
sportsbook_parlay_placed
sportsbook_big_ticket_placed
sportsbook_big_win
sportsbook_parlay_hit
sportsbook_bad_beat
sportsbook_weekly_house_result
```

V1 Loan Shark examples:

```text
loan_shark_loan_taken
loan_shark_loan_repaid
loan_shark_special_offer
```

### 6.3 `visibility`

V1 values:

```text
public
admin_only
```

For v1, most feed events should be `public`.

`admin_only` may be useful for debugging, review queues, or future moderation workflows.

Do not use `visibility = 'suppressed'`. Suppression is a status, not a visibility mode.

### 6.4 `status`

V1 values:

```text
published
suppressed
```

Definitions:

| Status | Meaning |
|---|---|
| `published` | Visible in the public feed if visibility allows |
| `suppressed` | Source action remains valid, but feed item is hidden |

### 6.5 `importance`

V1 values:

```text
low
normal
highlight
major
```

Suggested use:

| Importance | Use |
|---|---|
| `low` | Minor but visible feed activity |
| `normal` | Standard public activity |
| `highlight` | Big win, parlay hit, loan repaid, notable event |
| `major` | Huge swing, weekly House result, major league-wide event |

Importance supports filters such as:

```text
All
Sportsbook
Loan Shark
Highlights
```

---

## 7. Event Catalog

Do not let arbitrary event strings proliferate.

Each event type should be defined in a controlled event catalog, either in application code or in a database table.

Each catalog entry should define:

```text
source_feature
event_type
template_key
default_importance
default_visibility
requires_actor
allowed_source_fk
public_payload_schema
admin_payload_schema
feed_worthiness_rules
```

This gives future features a predictable integration path.

### 7.1 Example Catalog Entry — Sportsbook Parlay Hit

```yaml
source_feature: sportsbook
event_type: sportsbook_parlay_hit
template_key: sportsbook.parlay_hit
default_importance: highlight
default_visibility: public
requires_actor: true
allowed_source_fk: sportsbook_bet_id
public_payload_schema:
  stake: integer
  payout: integer
  profit: integer
  legs: integer
admin_payload_schema:
  bet_id: uuid
  settlement_id: uuid
```

### 7.2 Example Catalog Entry — Loan Taken

```yaml
source_feature: loan_shark
event_type: loan_shark_loan_taken
template_key: loan_shark.loan_taken
default_importance: normal
default_visibility: public
requires_actor: true
allowed_source_fk: loan_id
public_payload_schema: {}
admin_payload_schema:
  loan_id: uuid
  loan_product_id: uuid
```

The public payload is intentionally empty because public copy should not expose loan details.

---

## 8. Payload Policy

### 8.1 `public_payload`

`public_payload` contains values safe to show to all league members.

Acceptable examples:

```text
stake
payout
profit
parlay leg count
weekly House result
rank movement
public item name
public challenge stake
```

### 8.2 `admin_payload`

`admin_payload` may contain operational details useful for debugging or admin review.

Examples:

```text
source object IDs
settlement IDs
internal calculation details
loan product ID
suppression reason
admin note
```

Do not render `admin_payload` in public UI.

### 8.3 Snapshot Values

Some values should be snapshotted into `public_payload` at publication time.

Recommended snapshot candidates:

```text
stake
payout
profit
parlay leg count
line value if displayed publicly
House weekly result
rank movement
item display name
challenge stake
```

The FK remains the relational link to the source action, but snapshots prevent feed copy from changing unexpectedly if source display calculations evolve.

### 8.4 Player Names

Recommended behavior:

- store player IDs on feed rows;
- render current player display names from the `players` table;
- do not snapshot player names unless name changes become a real product concern.

---

## 9. Template Rendering

Feed copy should be generated from `template_key` and payload values.

Example row:

```json
{
  "template_key": "sportsbook.parlay_hit",
  "public_payload": {
    "stake": 100,
    "payout": 850,
    "legs": 3
  }
}
```

Rendered copy:

> Garrett hit a 3-leg parlay and won 850 pins.

### 9.1 Template Guidelines

Feed copy should be:

- short;
- playful;
- clear;
- public-safe;
- non-shaming;
- tappable into details when appropriate.

### 9.2 Avoid User-Generated Free Text in V1

V1 should not allow arbitrary user-authored feed text.

Future systems such as PvP challenges may include user messages, but those should be treated separately and may require moderation or templating.

---

## 10. Sportsbook Feed Policy

The Sportsbook is naturally public and social, but the feed should still avoid making every player feel like a prop.

### 10.1 General Rule

Post Sportsbook activity when it is notable, social, or strategically interesting.

Do not post every minor bet, every small win, every normal loss, or every push.

### 10.2 Sportsbook Subject Visibility

Sportsbook bets may involve one player betting on another player's line.

The feed should be careful about public copy that feels like judgment of the subject player.

Prefer:

> Garrett placed a Sportsbook ticket.

> Mike built a 3-leg parlay.

> Sarah put 300 pins on the board.

> Chris cashed a Sportsbook ticket for 450 pins.

Use more detailed subject/player-market references sparingly and mostly on tap-through detail pages.

Avoid public feed copy like:

> Garrett bet the under on Dave.

This can become socially awkward and may make players feel targeted.

### 10.3 V1 Sportsbook Event Types

#### `sportsbook_bet_placed`

A normal single bet was placed.

Feed-worthy only if configured to show normal bets or if the bet is above a threshold.

Example copy:

> Garrett placed a Sportsbook ticket.

#### `sportsbook_parlay_placed`

A parlay was placed.

Parlays are more socially interesting than single bets and should generally be feed-worthy.

Example copy:

> Mike built a 3-leg parlay.

#### `sportsbook_big_ticket_placed`

A large stake was placed.

Example copy:

> Sarah just put 500 pins on the board.

Recommended trigger:

```text
stake >= max(250, 10% of player available balance)
```

Thresholds should be configurable.

#### `sportsbook_big_win`

A notable Sportsbook payout occurred.

Example copy:

> Garrett hit big at the Sportsbook and took home 850 pins.

Recommended trigger:

```text
payout >= 500 pins
OR profit >= 20% of player pre-settlement balance
```

Thresholds should be configurable.

#### `sportsbook_parlay_hit`

A parlay settled as a win.

This should generally be feed-worthy.

Example copy:

> Mike hit a 4-leg parlay and walked away with 1,200 pins.

#### `sportsbook_bad_beat`

A dramatic near miss occurred.

Example copy:

> Sarah missed a 3-leg parlay by one pin.

This should only trigger when the miss is meaningfully dramatic.

#### `sportsbook_weekly_house_result`

The House's weekly Sportsbook result is posted.

Examples:

> The House cleaned up this week: +740 pins.

> The players beat the House this week: -520 pins for the Sportsbook.

This event may not naturally link to a single `sportsbook_bet_id`. In v1, it may have no source FK. In the future, consider creating a `sportsbook_weekly_reports` table.

### 10.4 Sportsbook Events Not Posted by Default

Do not post by default:

```text
small single-bet wins
normal losses
ordinary pushes
bet cancellations
admin settlement internals
```

---

## 11. Loan Shark Feed Policy

Loan Shark activity should be public only in a vague, playful way.

Debt is part of net worth and may appear in scoreboard contexts, but the feed should not become a debt-shaming surface.

### 11.1 V1 Loan Shark Event Types

#### `loan_shark_loan_taken`

A player took a loan.

Example copy:

> Garrett visited the Loan Shark.

Alternative copy:

> Mike made a deal with the Loan Shark.

Do not include:

```text
loan product
borrow amount
interest rate
garnishment rate
current debt
```

#### `loan_shark_loan_repaid`

A player fully paid off an active loan.

Example copy:

> Sarah cleared things up with the Loan Shark.

Alternative copy:

> Chris is back in the Shark's good graces.

Only full payoff should create a public feed event.

Partial repayments should not be posted.

#### `loan_shark_special_offer`

A system or admin event announcing loan product availability.

Example copy:

> The Loan Shark is offering dangerous terms this week.

This event may not naturally link to a `loan_id`. In v1, it may have no source FK. In the future, consider creating a `loan_shark_offer_events` source table.

### 11.2 Loan Shark Events Not Posted

Do not publish feed events for:

```text
weekly garnishment
weekly interest
missed-week interest exposure
partial manual repayment
season-close debt settlement
exact outstanding debt changes
loan product-specific borrowing
```

These details may appear in borrower-only views, admin views, loan ledgers, or net-worth calculations, but not in the public feed.

---

## 12. Noise Control

The feed should have clear thresholds so it remains entertaining.

Recommended v1 policy:

| Event | Public feed? |
|---|---|
| Normal single bet placed | Only if enabled or large |
| Large single bet placed | Yes |
| Parlay placed | Yes |
| Tiny bet won | No |
| Big win | Yes |
| Parlay hit | Yes |
| Normal bet loss | No |
| Bad beat | Yes |
| Push | Usually no |
| Loan taken | Yes, vague |
| Partial loan repayment | No |
| Loan fully repaid | Yes, vague |
| Weekly House result | Yes |

Thresholds should be configurable so the league can tune feed volume.

Potential configuration values:

```text
large_bet_absolute_threshold
large_bet_balance_percent_threshold
big_win_payout_threshold
big_win_balance_percent_threshold
bad_beat_enabled
normal_bet_placement_enabled
```

---

## 13. Publishing Semantics

### 13.1 Common Publishing Service

All features should publish through a shared service:

```text
ActivityFeedService.publish(event)
```

The service should:

1. Validate `source_feature`.
2. Validate `event_type` against the event catalog.
3. Validate source FK consistency.
4. Validate actor/subject requirements.
5. Validate public/admin payload shape.
6. Apply default visibility and importance if not provided.
7. Insert the feed row.
8. Avoid duplicate publication.

Feature code should not insert arbitrary feed rows directly unless it goes through the same validation path.

### 13.2 Transaction Timing

When possible, feed publication should happen in the same database transaction as the source action.

Example bet placement:

```text
create bet
create stake ledger events
create activity feed event
commit
```

Example loan issuance:

```text
create loan
create loan_ledger issuance event
create pin_ledger issuance events
create activity feed event
commit
```

Example Sportsbook settlement:

```text
settle bet
create payout/refund ledger events
create result feed event if notable
commit
```

This avoids orphaned feed rows and ensures that public activity appears only for committed source actions.

### 13.3 Duplicate Prevention

Because concrete source FKs are used, duplicate prevention should be handled with partial unique indexes rather than a generic idempotency key.

For v1:

```sql
CREATE UNIQUE INDEX activity_feed_unique_bet_event
ON activity_feed_events (sportsbook_bet_id, event_type)
WHERE sportsbook_bet_id IS NOT NULL;

CREATE UNIQUE INDEX activity_feed_unique_loan_event
ON activity_feed_events (loan_id, event_type)
WHERE loan_id IS NOT NULL;
```

This prevents retry jobs from double-posting the same event for the same source action.

If a future event type legitimately needs multiple feed rows for the same source action and event type, add a more specific uniqueness model for that feature.

---

## 14. Deletion, Cancellation, and Suppression

### 14.1 Source Cancellation

If a source economic action is destructively cancelled, associated feed rows should be deleted automatically through FK cascade.

Example Sportsbook cancellation:

```text
Admin cancels bet
→ bet-related source records are deleted or rolled back
→ activity_feed_events.sportsbook_bet_id cascades
→ associated feed rows are deleted
```

Example Loan Shark cancellation:

```text
Admin cancels loan
→ loans row is deleted
→ loan_ledger rows are deleted
→ related pin_ledger rows are deleted
→ activity_feed_events.loan_id cascades
→ associated feed rows are deleted
```

The result should be as if the economic action never existed.

### 14.2 Feed Suppression

Suppression is for valid source actions where the public feed item should be hidden.

Examples:

```text
feed copy is inappropriate
feed event is too noisy
admin wants to hide a valid post
future user-authored message is offensive
```

Suppression should update:

```sql
status = 'suppressed'
```

It should not delete the source action.

### 14.3 Restoring Suppressed Events

Admins may restore suppressed feed events by setting:

```sql
status = 'published'
```

This is only possible if the source row still exists.

---

## 15. Querying, Indexing, and Pagination

### 15.1 Main Feed Query

Default feed query:

```sql
SELECT *
FROM activity_feed_events
WHERE season_id = :season_id
  AND visibility = 'public'
  AND status = 'published'
ORDER BY published_at DESC, id DESC
LIMIT 50;
```

### 15.2 Feature Filter

Sportsbook filter:

```sql
SELECT *
FROM activity_feed_events
WHERE season_id = :season_id
  AND visibility = 'public'
  AND status = 'published'
  AND source_feature = 'sportsbook'
ORDER BY published_at DESC, id DESC
LIMIT 50;
```

Loan Shark filter:

```sql
SELECT *
FROM activity_feed_events
WHERE season_id = :season_id
  AND visibility = 'public'
  AND status = 'published'
  AND source_feature = 'loan_shark'
ORDER BY published_at DESC, id DESC
LIMIT 50;
```

Highlights filter:

```sql
SELECT *
FROM activity_feed_events
WHERE season_id = :season_id
  AND visibility = 'public'
  AND status = 'published'
  AND importance IN ('highlight', 'major')
ORDER BY published_at DESC, id DESC
LIMIT 50;
```

### 15.3 Recommended Indexes

```sql
CREATE INDEX activity_feed_events_feed_idx
ON activity_feed_events (season_id, status, visibility, published_at DESC, id DESC);

CREATE INDEX activity_feed_events_feature_idx
ON activity_feed_events (season_id, source_feature, status, visibility, published_at DESC, id DESC);

CREATE INDEX activity_feed_events_importance_idx
ON activity_feed_events (season_id, importance, status, visibility, published_at DESC, id DESC);

CREATE INDEX activity_feed_events_sportsbook_bet_idx
ON activity_feed_events (sportsbook_bet_id)
WHERE sportsbook_bet_id IS NOT NULL;

CREATE INDEX activity_feed_events_loan_idx
ON activity_feed_events (loan_id)
WHERE loan_id IS NOT NULL;
```

### 15.4 Pagination

Use cursor pagination, not offset pagination.

Cursor should be based on:

```text
published_at
id
```

Example next-page condition:

```sql
AND (
  published_at < :cursor_published_at
  OR (
    published_at = :cursor_published_at
    AND id < :cursor_id
  )
)
```

---

## 16. UI Product Surface

### 16.1 Main Feed Card

Each feed item should display:

- feature icon;
- rendered message;
- timestamp;
- source feature label;
- actor avatar when applicable;
- optional amount badge;
- optional tap target.

Example Sportsbook card:

```text
[Sportsbook icon]
Garrett hit a 3-leg parlay and won 850 pins.
Monday 10:42 PM · Sportsbook
```

Example Loan Shark card:

```text
[Loan Shark icon]
Mike made a deal with the Loan Shark.
Thursday 2:14 PM · Loan Shark
```

### 16.2 Filters

V1 filters:

```text
All
Sportsbook
Loan Shark
Highlights
```

Future filters:

```text
Challenges
Merchant
Bounties
Auctions
House
My Activity
```

### 16.3 Tap Targets

Feed events should optionally deep-link to source screens.

Examples:

| Event | Tap target |
|---|---|
| Sportsbook bet placed | Bet detail or Sportsbook ticket detail |
| Sportsbook parlay hit | Bet detail or settlement breakdown |
| Loan taken | Borrower's own Loan Shark page if actor is current user; otherwise no detail or player profile |
| Loan repaid | Player profile or no detail |
| Weekly House result | Weekly report page |

Loan Shark tap-through should respect privacy.

A different player should not be able to tap into someone else's loan details.

---

## 17. Notifications Are Separate

The Activity Feed is not the notification system.

A feed event is public content.

A notification is a user-specific prompt.

Example future PvP behavior:

```text
Feed: Garrett challenged Mike to a Line Duel.
Notification to Mike: Garrett challenged you. Accept or counter?
```

Do not add per-user read state, push delivery state, or notification preferences to `activity_feed_events` in v1.

A future notification system may consume feed events, but it should remain separate.

---

## 18. Admin Tools

Admins should be able to:

- view all feed events;
- filter by source feature;
- filter by status;
- filter by importance;
- suppress a feed event;
- restore a suppressed feed event;
- inspect source object links;
- inspect public payload;
- inspect admin payload;
- create admin/system feed events if supported;
- verify feed rows were deleted after source cancellation.

### 18.1 Admin Suppression

Admin suppression should record:

```text
suppressed_by
suppressed_at
suppression_reason
```

These fields can be added directly to `activity_feed_events` or stored in an admin audit log.

Recommended direct columns if simple moderation is desired:

```sql
suppressed_by_admin_id uuid NULL
suppressed_at timestamptz NULL
suppression_reason text NULL
```

These are optional for v1 but useful.

### 18.2 Admin Audit Log

If broader admin audit logging exists or is planned, suppression/restoration actions should be recorded there.

Do not use the public Activity Feed itself as the audit trail for moderation or destructive cancellation.

---

## 19. Aggregate and System Events

Some valuable feed events are aggregate events rather than single source-action events.

Examples:

```text
The House cleaned up this week: +740 pins.
The players beat the House this week.
The Sportsbook is open for Week 4.
The Loan Shark has new offers available.
```

### 19.1 V1 Approach

For v1, these may be inserted with:

```text
source_feature = 'system'
```

or:

```text
source_feature = 'admin'
```

and no concrete source FK.

### 19.2 Future Approach

If an aggregate event becomes recurring and important, create a source table for it.

Recommended future source tables:

```text
sportsbook_weekly_reports
loan_shark_offer_events
weekly_economy_reports
admin_announcements
```

Then add explicit nullable FK columns to `activity_feed_events` for those source tables.

This keeps the feed relationally anchored over time.

---

## 20. MVP Scope

V1 should establish the durable architecture and avoid overbuilding social features.

### 20.1 Database

- [ ] Create `activity_feed_events` table.
- [ ] Add `sportsbook_bet_id` nullable FK with `ON DELETE CASCADE`.
- [ ] Add `loan_id` nullable FK with `ON DELETE CASCADE`.
- [ ] Add source-count check constraint.
- [ ] Add controlled `source_feature` values.
- [ ] Add controlled `event_type` values.
- [ ] Add `visibility`, `status`, and `importance` fields.
- [ ] Add `template_key`, `public_payload`, and `admin_payload`.
- [ ] Add feed query indexes.
- [ ] Add partial unique indexes for duplicate prevention.

### 20.2 Application Logic

- [ ] Implement `ActivityFeedService.publish`.
- [ ] Implement event catalog validation.
- [ ] Implement source FK consistency validation.
- [ ] Implement payload schema validation.
- [ ] Publish feed events from Sportsbook bet placement when feed-worthy.
- [ ] Publish feed events from Sportsbook settlement when feed-worthy.
- [ ] Publish vague feed events from Loan Shark issuance.
- [ ] Publish vague feed events from full Loan Shark payoff.
- [ ] Avoid publishing private Loan Shark events.
- [ ] Ensure source cancellation cascades feed rows.

### 20.3 UI

- [ ] Add main public Activity Feed view.
- [ ] Render template-driven feed copy.
- [ ] Show feature icons.
- [ ] Show actor avatars when applicable.
- [ ] Show timestamps.
- [ ] Show source feature labels.
- [ ] Add filters: All, Sportsbook, Loan Shark, Highlights.
- [ ] Add cursor pagination.
- [ ] Add tap targets where privacy-safe.

### 20.4 Admin

- [ ] View feed events.
- [ ] Filter by source feature/status/importance.
- [ ] Suppress valid feed events.
- [ ] Restore suppressed feed events.
- [ ] Inspect source links and payloads.

---

## 21. Explicitly Out of Scope for V1

Do not include these in v1:

- comments on feed items;
- reactions or likes;
- user-authored trash talk;
- arbitrary user-generated feed copy;
- per-user feed personalization;
- per-user read state;
- push notification delivery tracking;
- algorithmic ranking;
- complex moderation workflows;
- private/friends-only visibility;
- weekly recap cards;
- feed-driven balance calculations;
- using the feed as an audit log.

These may be valuable later, but v1 should focus on the foundational event pipeline and public feed surface.

---

## 22. Future Expansion

The Activity Feed should become the integration point for future economic systems.

Potential future publishers:

### Traveling Merchant

Examples:

```text
The Merchant has arrived.
Garrett bought the last Big Juicer.
The Merchant sold out of Parlay Rockets.
```

Potential FK columns:

```text
merchant_drop_id
merchant_purchase_inventory_item_id
```

### PvP Challenge Contracts

Examples:

```text
Garrett challenged Mike to a Line Duel for 100 pins.
Mike countered Garrett's challenge.
Sarah won a 500-pin challenge pot.
Chris wants to run it back double-or-nothing.
```

Potential FK column:

```text
pvp_challenge_contract_id
```

### Bounty Board

Examples:

```text
Garrett posted a 200-pin bounty.
Sarah claimed the Line Crusher bounty.
The weekly bounty board is live.
```

Potential FK column:

```text
bounty_id
```

### Auctions

Examples:

```text
The Golden Parlay Pass is up for auction.
Mike won the auction for 475 pins.
Sarah got sniped at the buzzer.
```

Potential FK column:

```text
auction_id
```

### Weekly Recaps

Examples:

```text
Week 4 Fallout is live.
The House won the week.
Garrett made the biggest leaderboard jump.
```

Potential FK column:

```text
weekly_recap_id
```

---

## 23. Open Design Questions

The major v1 design decisions are settled, but these operational questions may still need implementation-time answers:

1. What exact thresholds define a large Sportsbook ticket?
2. What exact thresholds define a big Sportsbook win?
3. What exact conditions define a Sportsbook bad beat?
4. Should normal single-bet placement appear in the feed at all, or only large tickets?
5. Should aggregate events initially use no source FK, or should `sportsbook_weekly_reports` / `admin_announcements` be created immediately?
6. Should suppression metadata live directly on `activity_feed_events` or in a broader admin audit log?
7. Should `source_feature`, `event_type`, `visibility`, `status`, and `importance` be enforced with database enums, lookup tables, or application-level controlled strings?
8. Should feed event templates live in application code or a database-managed template catalog?

These do not block the architecture, but they should be resolved before or during implementation.

---

## 24. Summary

The Activity Feed is the Pin Economy's public narrative layer.

It should consolidate notable activity from the Sportsbook, Loan Shark, and future economic systems into a single curated feed. The feed must remain separate from the ledger, must not become the source of truth for balances or settlements, and must avoid exposing private or shame-adjacent details.

The core implementation decisions are:

- feed events are relationally anchored to concrete source tables through nullable foreign keys;
- source cancellation deletes feed events through `ON DELETE CASCADE`;
- suppression is reserved for moderation/display control when the source action remains valid;
- feed copy is template-driven;
- public and admin payloads are separated;
- Loan Shark feed events are vague and privacy-aware;
- Sportsbook feed events are curated to avoid noise and awkward targeting;
- future features add new nullable FK columns as they publish into the feed;
- the feed is a public economic newswire, not an audit log.

In short:

> The Activity Feed should make the Pin Economy feel alive without compromising accounting integrity, player privacy, or the social safety of the league.
