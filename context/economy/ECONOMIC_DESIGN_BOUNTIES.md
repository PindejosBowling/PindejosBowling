# Economic Design — Bounty Board

This document specifies the **Bounty Board** feature for the Pindejos Bowling League Pin Economy.

The Bounty Board is a public economic challenge board where the **Pinsino** or a player sponsor posts a bounty, and other players enter as hunters by staking pins against the sponsor side.

The core capability is **player-sponsored bounties**: a player can publicly back a freeform claim, put personal pins at risk, attract hunters to take the other side, and potentially win the hunters' stakes plus Pinsino-funded seed value if the sponsor side wins.

For v1, all bounties are manually settled by an admin. The app does not need to understand the underlying bounty condition. The bounty title and description define the social contract, and the admin resolves the bounty as either a sponsor win or a hunter win.

This document is self-contained and written to support database and application-layer implementation.

> **⚠️ Mechanic revision (supersedes the original early-hunter anti-dilution model).**
> The hunter payout mechanic has been redesigned to the **"All Comers"** model (see
> §13–§14). The original model treated the sponsor bounty as a fixed pie split by
> entry order (`floor(S / entry_number)`), which rewarded early hunters by making
> every *later* hunter's offer worse — a land-grab that discouraged group play.
> **The new model:** the sponsor sets a flat **reward per hunter** `R`, a **hunter
> stake** `H`, and a **max hunters** `m`, and escrows `R × m` up front. Every hunter
> who wins receives `H + R` — identical regardless of join order or count. Combined
> with the **collective win rule** (if *any* hunter satisfies the bounty, the whole
> pack wins), more hunters raise everyone's odds, so recruiting teammates is the
> dominant strategy. The House seed is gone for sponsor bounties; the House only
> subsidizes a *House-sponsored* bounty that loses to the hunters. The as-built
> schema/RPCs are in `supabase/migrations/20260607220000_bounty_all_comers.sql`;
> §15+ below predate the revision and should be read through this lens.
>
> **v1 is House-only (see §3.1).** Only the Pinsino sponsors bounties; players join as
> hunters. Player-sponsored bounties are deferred for integrity reasons and the create
> path is gated off (UI button hidden; `create_sponsor_bounty` revoked from
> `authenticated` in `20260607221500_bounty_house_only_v1.sql`). The code path is kept
> for a future player-sponsor phase.

---

## 1. Purpose

The Bounty Board gives players a way to create public, social, pooled economic action.

The feature should feel different from the existing Sportsbook and from direct PvP Challenge Contracts.

The Sportsbook is primarily player-vs-House betting on structured markets.

PvP Challenges are direct opt-in contracts between specific players.

The Bounty Board is a public board of player- or House-backed bounties where many players can pile into the hunter side of the same shared outcome.

The feature should create:

- player-created economic action;
- social bravado and trash talk;
- sponsor-side strategy;
- early hunter incentives;
- public stories for the Activity Feed;
- a new weekly app engagement loop;
- flexible manual-settlement bounties for conditions the app does not track;
- House-funded seeding that makes the board more attractive without turning bounties into sportsbook lines.

The best-in-class capability is:

> A player can post a bounty, risk their own pins, attract hunters, and have the Pinsino juice the action through an anti-dilution House seed mechanic.

---

## 2. Core Concept

A bounty is a two-sided pooled challenge.

Every bounty has:

```text
Sponsor side
Hunter side
```

The sponsor posts the bounty.

Hunters enter by staking pins against the sponsor side.

The bounty later settles as one of two outcomes:

```text
sponsor_win
hunter_win
```

If the sponsor wins, the sponsor receives the pot.

If the hunters win, hunters are paid according to their protected hunter-profit terms.

For v1, there is no automatic condition evaluation. An admin manually decides whether the sponsor side or hunter side won and must provide settlement reasoning.

---

## 3. Bounty Types

V1 supports two bounty types.

```text
house_bounty
sponsor_bounty
```

### 3.1 `house_bounty`

A `house_bounty` is posted by the Pinsino.

The House is the sponsor side.

```text
bounty_type = house_bounty
sponsor_player_id = null
```

Example:

> **Turkey Hunter**  
> If any player in the league bowls a turkey this week, hunters win. If nobody bowls a turkey, the Pinsino wins.

A `house_bounty` enables the House to create weekly action, promotions, special events, and thematic challenges.

House bounties are useful, but they are not the main differentiator of this feature. The House already has an infinite operational balance and can create action whenever needed.

### 3.2 `sponsor_bounty`

A `sponsor_bounty` is posted by a player.

The player sponsor backs the sponsor side with personal pins.

```text
bounty_type = sponsor_bounty
sponsor_player_id = sponsoring player
```

Examples:

> **Garrett 200 Watch**  
> I am backing myself to bowl at least one 200+ game this week. If I do, sponsor wins. If I do not, hunters win.

> **No Turkey Tonight**  
> I am betting nobody in the league bowls a turkey this week. If nobody does, sponsor wins. If anyone does, hunters win.

A “Back Yourself” bounty is not a separate schema type. It is simply a `sponsor_bounty` where the player-sponsor writes the bounty about their own performance.

### 3.3 v1 sponsorship policy — House-only (integrity decision)

**For v1, only `house_bounty` is enabled. Players join as hunters only.** The
`sponsor_bounty` type, schema, and RPC are retained but the create path is gated off
(the app hides the "Post a Bounty" entry point and `create_sponsor_bounty` is revoked
from `authenticated` in `20260607221500_bounty_house_only_v1.sql`).

The governing rule:

> A bounty is integrity-safe only if **no participant can influence the real-world
> outcome in the direction that pays them.**

A player sponsor fails this rule three ways, because the counterparty is a competitor
who bowls:

1. **Tanking.** A condition the sponsor influences lets them steer the outcome toward
   their winning side — most dangerously a *negative* or *team* condition they can
   deliberately miss to keep the hunter stakes (the pin economy paying a player to bowl
   badly — a violation of "bounties never affect gameplay", §28.1).
2. **Collusion / wash transfers.** Manual freeform settlement lets two friends stage a
   bounty whose only purpose is to move pins between them, polluting the leaderboard.
3. **Targeting.** Freeform text can describe a third party who never opted in
   ("hunters win if Bob chokes"), even though `subject_player_id` was removed (§19.1).

The House is structurally immune: it does not bowl (cannot tank), it sets and curates
the condition (can frame "hunter win" as a *positive achievement* so it aligns with
good bowling), and it is not a competitor. The valuable, safe essence of a bounty is
the **crowd-vs-House** dynamic; **player-vs-player action already lives on the PvP
Challenge board**, so House-only loses little.

**Re-enabling player bounties later** (a possible "back yourself, positive-framed"
phase) should go behind an **admin-approval gate**: a player posts a *proposal*
(`pending_approval`), escrow locks only on admin approval, and conditions that are
self-negative, team-tankable, or subject-targeted are rejected. To restore: re-add the
UI CTA and re-`GRANT EXECUTE` on `create_sponsor_bounty` (ideally with the approval
status flow).

---

## 4. Design Goals

The Bounty Board should:

1. **Give players a reason to create action.**  
   The sponsor is not donating pins. The sponsor is taking a side against the field.

2. **Reward joining the pack — never punish it.**  
   No hunter is penalized for joining late, and no hunter's payout shrinks when more
   hunters pile in. With the collective win rule, more hunters help everyone, so the
   board rewards building a posse rather than racing for an early slot.

3. **Preserve the pooled bounty feel.**  
   The feature should not devolve into sponsors setting custom sportsbook odds.

4. **Support freeform social challenge language.**  
   Players should be able to write their own bounty titles and descriptions.

5. **Allow manual settlement for untracked conditions.**  
   The feature should support bounties such as Turkey Hunter even if the app does not track frame-level bowling data.

6. **Keep all effects inside the Pin Economy.**  
   Bounties must never affect actual bowling rules, scoring, handicaps, lineups, playoff qualification, or league standings.

7. **Plug cleanly into the Activity Feed.**  
   Bounty creation, hunter entry, closure, and settlement should create public story moments.

8. **Use destructive admin cancellation.**  
   Invalid, abusive, mistaken, or unresolvable bounties should be erased economically rather than settled as voids.

---

## 5. Non-Negotiable Integrity Constraint

Bounties must never affect actual bowling league gameplay.

They must not affect:

- bowling scores;
- handicaps;
- lane assignments;
- team assignments;
- bowling order;
- official team wins or losses;
- playoff qualification;
- official league standings;
- any real-world competitive aspect of bowling.

Bounties may affect only:

- pin balances;
- Bounty Board history;
- Activity Feed events;
- app-visible reputation, badges, or cosmetics if added later;
- future economy-only mechanics.

The bowling league remains the base-layer game. Bounties are only part of the app-based Pin Economy metagame.

---

## 6. V1 Scope

V1 supports:

- House-posted bounties;
- player-posted sponsor bounties;
- freeform bounty title and description;
- fixed sponsor bounty amount;
- fixed hunter stake amount;
- one hunter entry per player per bounty;
- entry-order-based protected hunter profit;
- Pinsino anti-dilution House seed;
- manual admin settlement only;
- sponsor-win and hunter-win outcomes only;
- destructive admin cancellation;
- Activity Feed integration;
- ledger-first accounting.

V1 does not support:

- automatic settlement;
- machine-readable bounty conditions;
- arbitrary payout formulas;
- player-selected House seed settings;
- hunter comments or bounty discussion threads;
- hunter-side counteroffers;
- multiple hunter entries by the same player;
- sponsor cancellation after hunters enter;
- rake or House fees;
- partial refunds as normal settlement outcomes;
- “void” as a settlement outcome.

---

## 7. Freeform Bounty Terms

For v1, bounty conditions are freeform.

Players and admins may enter any public-facing:

```text
Bounty Title
Bounty Description
```

The app does not parse or adjudicate the condition.

Example:

```text
Title: Turkey Hunter
Description: If anyone in the league bowls a turkey this week, hunters win. If nobody bowls a turkey, the sponsor wins.
```

Example:

```text
Title: Garrett 200 Watch
Description: I am backing myself to bowl at least one 200+ game this week. If I do, sponsor wins. If I do not, hunters win.
```

The title and description are the public social contract.

The admin settlement reasoning later explains how the admin interpreted and resolved that social contract.

---

## 8. Manual Admin Settlement

All v1 bounties are settled manually by an admin.

The admin can choose only:

```text
sponsor_win
hunter_win
```

There is no `void` outcome.

If a bounty cannot be fairly settled, the admin should cancel it destructively.

### 8.1 Admin Settlement Reasoning

Every settlement requires:

```text
admin_settlement_reasoning
```

This is a text value that justifies the decision.

Examples:

```text
Hunters win. Chris bowled a turkey in Game 2, which satisfies the Turkey Hunter bounty description.
```

```text
Sponsor wins. No player bowled a turkey during the week.
```

```text
Sponsor wins. Garrett bowled a 204 in Game 1, satisfying the 200+ condition stated in the bounty description.
```

The admin does not enter payout amounts. The admin only selects the winning side and supplies reasoning. The system computes payouts deterministically.

---

## 9. No Void Outcome

Do not implement `void` as a settlement outcome.

A bounty has only two economic results:

```text
sponsor_win
hunter_win
```

If the bounty should not stand, use:

```text
Admin Cancel Bounty
```

Admin cancellation is destructive rollback. It deletes the bounty and all related economic traces so the bounty behaves as if it never existed.

Examples where admin cancellation is appropriate:

- bounty description is ambiguous beyond fair interpretation;
- bounty was created by mistake;
- bounty is abusive or inappropriate;
- no hunter entered;
- the required event cannot be verified;
- league night was cancelled;
- admin settled incorrectly and wants to fully erase the bounty lifecycle;
- the bounty violates anti-tanking or social safety rules.

---

## 10. Lifecycle

Bounties use a deliberately simple lifecycle.

```text
open → closed → settled
```

### 10.1 `open`

The bounty is visible on the Bounty Board and can accept hunter entries.

A bounty starts as `open` immediately when created.

There is no `draft` state in v1.

### 10.2 `closed`

The bounty no longer accepts hunter entries.

`closed` replaces the concepts of `locked` and `settlement_pending`.

A closed bounty means:

- hunter entry is over;
- stakes are fixed;
- no player-side edits are allowed;
- the bounty is ready for admin settlement.

### 10.3 `settled`

The bounty has been manually resolved as either:

```text
sponsor_win
hunter_win
```

Settlement creates the payout ledger entries and records the admin settlement reasoning.

### 10.4 Admin Cancellation Is Not a Status

Do not use a normal `cancelled` status.

Admin cancellation is destructive. The `bounty_post` row should be deleted, and child rows should cascade.

If operational admin attribution is needed, use a separate admin audit log. The public bounty tables should not retain cancelled bounty rows.

---

## 11. Timing

Every bounty has:

```text
closes_at timestamptz not null
```

Application-created bounties should default to:

```text
Upcoming Monday at 7:00 PM ET
```

Business rule:

- If created before Monday 7:00 PM ET, default to that same upcoming Monday.
- If created at or after Monday 7:00 PM ET, default to the following Monday at 7:00 PM ET.

The timezone is:

```text
America/New_York
```

Do not rely on a database default for this. The default should be calculated in application logic because it is a business rule tied to league-night timing.

Admins may override `closes_at` for special bounties.

---

## 12. Core Economic Model

The bounty has three economic components:

```text
Sponsor bounty amount
Hunter stakes
House seed
```

For every bounty:

```text
S = sponsor_bounty_amount
H = hunter_stake_amount
N = hunter count
```

At entry time, each hunter stakes:

```text
H
```

At settlement, the system calculates:

```text
total_hunter_stakes = N × H
```

The House seed is derived from protected hunter-profit obligations, as described in §13.

There is no rake.

There is no House fee.

The House is intentionally subsidizing bounty action through seed, not extracting value from it.

---

## 13. The "All Comers" Hunter Mechanic

### 13.1 Problem with a fixed pie

If the sponsor bounty `S` is a fixed prize that hunters divide, every distribution
is a bad trade. A naive equal split pays each hunter `S / N`, so every new hunter
dilutes everyone. The original fix snapshotted entry-order terms
(`floor(S / entry_number)`): that protected *existing* hunters but made the offer to
each *next* hunter worse, turning the board into a land-grab for early slots that
then went dead. Either way, a fixed pie means more hunters = less for someone.

### 13.2 Design solution — the sponsor takes on all comers

The sponsor does not post one pie to be divided. The sponsor offers the **same bet
to every hunter**:

```text
R = reward_per_hunter      -- what each hunter wins
H = hunter_stake_amount    -- what each hunter risks to join
m = max_hunters            -- how many hunters the sponsor will take on
```

The sponsor escrows their full, bounded maximum liability up front:

```text
sponsor escrow = R × m
```

Each hunter stakes `H` to join, up to `m` hunters (capacity is hard-capped because
the sponsor only escrowed `R × m`). Every hunter is offered the identical deal: risk
`H`, win `R`.

### 13.3 Collective win rule

A bounty settles `sponsor_win` or `hunter_win` for the **whole pack**. If *any*
hunter satisfies the bounty condition, the hunters win and **every** hunter is paid.
This is what makes recruiting pay off: bringing another hunter raises the chance the
condition is met, so each hunter's expected value *rises* with the size of the pack.

### 13.4 Payouts

```text
hunter_win:   every hunter receives  H + R      (stake back + the flat reward)
sponsor_win:  the sponsor collects every H, and gets their escrow back
```

There is no entry-order advantage, no dilution, and no race. A hunter is strictly
better off when more hunters join (higher win odds, same `R`).

### 13.5 Example

```text
R = 100, H = 50, m = 8     -> sponsor escrows 100 × 8 = 800
3 hunters join.
```

| Outcome | Each hunter | Sponsor (net over lifecycle) |
|---|---|---|
| hunters win | `50 + 100 = 150` | pays `3 × 100 = 300`; unused `5 × 100 = 500` escrow returned → net **−300** |
| sponsor wins | loses their `50` | collects `3 × 50 = 150`; escrow returned → net **+150** |

Join order is irrelevant — Hunter #1 and Hunter #3 receive exactly the same.

---

## 14. House Funding

### 14.1 Sponsor bounties are House-neutral

For a player-sponsored bounty, every event is a balanced player+House pair and the
House nets to **zero** in both outcomes. The sponsor funds the rewards out of their
own escrow; the House merely holds escrow in between. There is **no House seed** for
sponsor bounties (the old anti-dilution subsidy is gone).

### 14.2 House bounties

A `house_bounty` is sponsored by the Pinsino. The House posts no create-time escrow;
it funds the rewards only if the hunters win:

```text
house_bounty, hunter_win:   House pays n × R  (the House subsidy / "seed")
house_bounty, sponsor_win:  House keeps the n × H hunter stakes
```

`total_house_seed` on the settlement row is therefore `n × R` for a House bounty
that loses to the hunters, and `0` for every sponsor bounty. It is a House-funded
subsidy, never a rake — the House takes no cut of player-vs-player bounty action.

### 14.3 Unused escrow

When fewer than `m` hunters join, the sponsor's unmatched escrow `(m − n) × R` is
returned to the sponsor at settlement (a `bounty_payout` ledger pair). The sponsor
only ever loses reward for hunters who actually joined.

---
## 15. Sponsor Incentives

A player sponsor should publish a bounty because they are taking a strategic position against the field.

The sponsor is not donating pins.

The sponsor risks:

```text
sponsor_bounty_amount
```

The sponsor can win:

```text
sponsor_bounty_amount
+ hunter stakes
+ Pinsino House seed
```

This creates several incentives:

1. **Create attractive bounties.**  
   A bounty that attracts hunters creates more upside for the sponsor if the sponsor wins.

2. **Price the hunter stake carefully.**  
   A lower hunter stake may attract more hunters. A higher hunter stake increases the sponsor’s potential hunter-stake winnings but may reduce participation.

3. **Write clear, exciting bounty terms.**  
   The bounty title and description are part of the sponsor’s pitch.

4. **Exploit social reads.**  
   Sponsors can post bounties when they believe the field is overconfident.

5. **Back yourself publicly.**  
   A sponsor can post a bounty about their own positive performance and dare the field to fade them.

This is the central player-side capability of the feature.

---

## 16. Hunter Incentives

Hunters enter because they want to take the other side of a public bounty.

A hunter knows before entry:

```text
hunter_stake_amount
entry_number
protected_hunter_profit
total payout if hunters win
```

The UI should make this explicit:

```text
You would be Hunter #4.
You stake 50 pins.
If hunters win, you receive 125 pins total.
Your protected profit is +75 pins.
Additional hunters will not reduce your payout.
```

This is important because the feature depends on early hunter confidence.

The hunter should understand that:

- entering earlier gives better protected profit;
- entering later gives worse terms but more information;
- their payout is protected once they enter;
- the admin will manually settle the bounty based on the public description.

---

## 17. Payout Rules

### 17.1 If Sponsor Wins

If the bounty settles as:

```text
sponsor_win
```

Then the sponsor side receives:

```text
total_pot
```

For `sponsor_bounty`:

```text
player sponsor receives total_pot
all hunters lose their stakes
```

For `house_bounty`:

```text
House wins
hunters lose their stakes
no player payout is created for the sponsor side
```

For reporting, settlement may still calculate the theoretical `total_house_seed`, but House-to-House movement should not create player-facing ledger entries.

### 17.2 If Hunters Win

If the bounty settles as:

```text
hunter_win
```

Then each hunter receives:

```text
hunter payout = stake_amount + protected_hunter_profit
```

Because each hunter’s payout is individually protected, there is no equal split and no remainder dust.

The total hunter payout equals:

```text
total_hunter_stakes + total_protected_hunter_profit
```

And because:

```text
total_house_seed = total_protected_hunter_profit - sponsor_bounty_amount
```

when needed, this equals:

```text
sponsor_bounty_amount + total_hunter_stakes + total_house_seed
```

### 17.3 No Rake

The Bounty Board has no rake.

Do not include:

```text
rake_rate
rake_amount
payout_pool
```

The House is not extracting value from bounties. The House is seeding them.

---

## 18. Database Model

The Bounty Board uses four main tables:

```text
bounty_post
bounty_hunter_stakes
bounty_settlements
bounty_payouts
```

It also extends:

```text
pin_ledger
activity_feed_events
```

---

## 19. `bounty_post`

`bounty_post` is the root source object for a bounty.

```sql
bounty_post
-----------
id uuid primary key

season_id uuid not null references seasons(id) on delete cascade
week_id uuid references weeks(id) on delete set null

bounty_type text not null
-- house_bounty | sponsor_bounty

sponsor_player_id uuid references players(id) on delete cascade
-- null for house_bounty
-- required for sponsor_bounty

title text not null
description text not null

sponsor_bounty_amount int not null
hunter_stake_amount int not null

house_seed_mode text not null default 'early_hunter_anti_dilution'
-- early_hunter_anti_dilution

closes_at timestamptz not null
-- defaults in application logic to upcoming Monday 7:00 PM ET

status text not null default 'open'
-- open | closed | settled

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

### 19.1 Removed Fields

Do not include:

```text
sponsor_type
subject_player_id
created_by_admin_id
created_by_player_id
condition_key
condition_config
settlement_mode
sponsor_win_label
hunter_win_label
admin_settlement_prompt
rake_rate
min_hunters
max_hunters
```

Reasons:

- `bounty_type` already identifies whether the sponsor is the House or a player.
- The bounty description contains the relevant condition.
- Admins act on behalf of the Pinsino for House bounties.
- V1 settlement is fully manual.
- There is no rake.
- Bounties only require one or more hunters to have action.

### 19.2 Validation

Use application validation and preferably database checks for:

```sql
CHECK (
  (
    bounty_type = 'house_bounty'
    AND sponsor_player_id IS NULL
  )
  OR
  (
    bounty_type = 'sponsor_bounty'
    AND sponsor_player_id IS NOT NULL
  )
)
```

Recommended additional checks:

```sql
CHECK (sponsor_bounty_amount > 0)
CHECK (hunter_stake_amount > 0)
CHECK (closes_at > created_at)
CHECK (status IN ('open', 'closed', 'settled'))
CHECK (bounty_type IN ('house_bounty', 'sponsor_bounty'))
CHECK (house_seed_mode = 'early_hunter_anti_dilution')
```

---

## 20. `bounty_hunter_stakes`

`bounty_hunter_stakes` represents a player taking the hunter side of a bounty.

Each player may enter a bounty at most once in v1.

```sql
bounty_hunter_stakes
--------------------
id uuid primary key

bounty_post_id uuid not null references bounty_post(id) on delete cascade
player_id uuid not null references players(id) on delete cascade

stake_amount int not null
entry_number int not null
protected_hunter_profit int not null

status text not null
-- active | won | lost

entered_at timestamptz not null default now()
resolved_at timestamptz

created_at timestamptz not null default now()
updated_at timestamptz not null default now()

unique (bounty_post_id, player_id)
unique (bounty_post_id, entry_number)
```

### 20.1 Stake Amount Snapshot

`stake_amount` should be copied from:

```text
bounty_post.hunter_stake_amount
```

at entry time.

This protects historical hunter entries if future versions allow bounty terms to be edited before any hunters enter or if display rules change.

### 20.2 Entry Number

`entry_number` is the hunter’s order of entry for that bounty.

It must be assigned transactionally.

### 20.3 Protected Hunter Profit

`protected_hunter_profit` is calculated at entry time:

```text
protected_hunter_profit = floor(bounty_post.sponsor_bounty_amount / entry_number)
```

This is the hunter’s locked profit if hunters win.

It must not change after entry.

### 20.4 Hunter Stake Statuses

Allowed statuses:

```text
active
won
lost
```

Do not include `refunded`, `voided`, or `cancelled` statuses for normal lifecycle handling.

Admin cancellation deletes the records destructively.

---

## 21. `bounty_settlements`

`bounty_settlements` records the final outcome and settlement economics.

```sql
bounty_settlements
------------------
id uuid primary key
bounty_post_id uuid not null references bounty_post(id) on delete cascade

settlement_outcome text not null
-- sponsor_win | hunter_win

settlement_source text not null default 'admin'
-- admin only in v1

total_sponsor_bounty int not null
total_hunter_stakes int not null
total_protected_hunter_profit int not null
total_house_seed int not null
total_pot int not null

winner_count int not null

settled_by_admin_id uuid not null
admin_settlement_reasoning text not null

settled_at timestamptz not null default now()
created_at timestamptz not null default now()
```

### 21.1 Settlement Source

For v1:

```text
settlement_source = admin
```

The field is still useful for future compatibility if automatic settlement is later added.

### 21.2 Settlement Outcome

Allowed values:

```text
sponsor_win
hunter_win
```

Do not support `void`.

### 21.3 Settlement Snapshot Values

Settlement should snapshot:

```text
total_sponsor_bounty
total_hunter_stakes
total_protected_hunter_profit
total_house_seed
total_pot
winner_count
```

This makes historical settlement details stable even if future calculation logic changes.

### 21.4 Admin Settlement Reasoning

`admin_settlement_reasoning` is required.

It should be visible on bounty detail pages after settlement.

It may also be visible to admins and potentially to all players, depending on product preference. The default assumption is that settlement reasoning is public because it explains the result of a public bounty.

---

## 22. `bounty_payouts`

`bounty_payouts` records winner-specific payout rows.

```sql
bounty_payouts
--------------
id uuid primary key

bounty_settlement_id uuid not null references bounty_settlements(id) on delete cascade
bounty_post_id uuid not null references bounty_post(id) on delete cascade

player_id uuid references players(id) on delete cascade
is_house boolean not null default false

payout_amount int not null

created_at timestamptz not null default now()
```

### 22.1 Player Sponsor Win

For a player-sponsored bounty where sponsor wins:

```text
player_id = sponsor_player_id
is_house = false
payout_amount = total_pot
```

### 22.2 Hunter Win

For a hunter-win settlement, create one payout row per hunter:

```text
player_id = hunter player
is_house = false
payout_amount = hunter stake_amount + protected_hunter_profit
```

### 22.3 House Bounty Sponsor Win

For a House bounty where the sponsor side wins:

No player payout is needed.

Optionally, a `bounty_payouts` row can be created with:

```text
player_id = null
is_house = true
payout_amount = total_pot
```

However, this is not required for player balances. If included, keep it clearly separate from player-facing payouts.

---

## 23. `pin_ledger` Integration

The Pin Economy remains ledger-first.

Player balances should continue to be derived from `pin_ledger` events.

### 23.1 Required FK

Add:

```sql
ALTER TABLE pin_ledger
ADD COLUMN bounty_post_id uuid REFERENCES bounty_post(id) ON DELETE CASCADE;
```

This is the most important linkage for destructive admin cancellation.

Optional granular links:

```sql
ALTER TABLE pin_ledger
ADD COLUMN bounty_hunter_stake_id uuid REFERENCES bounty_hunter_stakes(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger
ADD COLUMN bounty_settlement_id uuid REFERENCES bounty_settlements(id) ON DELETE CASCADE;

ALTER TABLE pin_ledger
ADD COLUMN bounty_payout_id uuid REFERENCES bounty_payouts(id) ON DELETE CASCADE;
```

The root `bounty_post_id` should be present on every bounty-related ledger row even if granular links are also used.

### 23.2 Ledger Event Types

Recommended bounty-related `pin_ledger.type` values:

```text
bounty_sponsor_stake
bounty_hunter_stake
bounty_payout
```

Do not use:

```text
bounty_refund
bounty_void
bounty_cancelled
```

Admin cancellation deletes related ledger rows instead of writing refund or reversal events.

### 23.3 Player-Sponsored Bounty Creation

When a player creates a `sponsor_bounty`:

```text
sponsor_bounty_amount moves from sponsor player to House escrow
```

Create paired ledger entries according to the existing transfer convention:

Player-side:

```text
player_id = sponsor_player_id
amount = -sponsor_bounty_amount
type = bounty_sponsor_stake
is_house = false
bounty_post_id = bounty_post.id
```

House-side:

```text
player_id = null
amount = +sponsor_bounty_amount
type = bounty_sponsor_stake
is_house = true
bounty_post_id = bounty_post.id
```

### 23.4 House Bounty Creation

When the Pinsino creates a `house_bounty`, do not create a House-to-House ledger movement.

Store the promised sponsor amount on:

```text
bounty_post.sponsor_bounty_amount
```

The House funds the bounty if hunters win.

### 23.5 Hunter Entry

When a hunter enters:

```text
hunter_stake_amount moves from hunter to House escrow
```

Player-side:

```text
player_id = hunter player
amount = -hunter_stake_amount
type = bounty_hunter_stake
is_house = false
bounty_post_id = bounty_post.id
bounty_hunter_stake_id = bounty_hunter_stakes.id, if using granular FK
```

House-side:

```text
player_id = null
amount = +hunter_stake_amount
type = bounty_hunter_stake
is_house = true
bounty_post_id = bounty_post.id
```

### 23.6 Settlement Payouts

When the bounty settles, create `bounty_payout` ledger entries for player payouts.

Player-side payout:

```text
player_id = winning player
amount = payout_amount
type = bounty_payout
is_house = false
bounty_post_id = bounty_post.id
bounty_payout_id = bounty_payouts.id, if using granular FK
```

House-side payout:

```text
player_id = null
amount = -payout_amount
type = bounty_payout
is_house = true
bounty_post_id = bounty_post.id
```

This naturally includes any House seed because the House pays out more than the player stakes alone when seed is required.

---

## 24. Activity Feed Integration

The Bounty Board should publish to the Activity Feed through the shared feed service.

Add:

```sql
ALTER TABLE activity_feed_events
ADD COLUMN bounty_post_id uuid REFERENCES bounty_post(id) ON DELETE CASCADE;
```

Update the source-count check constraint to include `bounty_post_id`.

### 24.1 Source Feature

Add controlled source feature:

```text
bounty_board
```

### 24.2 Event Types

Recommended v1 event types:

```text
bounty_board_bounty_posted
bounty_board_hunter_joined
bounty_board_bounty_closed
bounty_board_sponsor_won
bounty_board_hunters_won
```

### 24.3 Feed Copy Examples

House bounty posted:

> The Pinsino posted a bounty: “Turkey Hunter.”

Player bounty posted:

> Garrett posted a bounty: “Garrett 200 Watch.”

Hunter joined:

> Mike joined the hunt for “Turkey Hunter.”

Bounty closed:

> “Turkey Hunter” is closed. The hunt is ready for settlement.

Sponsor won:

> Garrett faded the field and won “No Turkey Tonight.”

Hunters won:

> The hunters got paid on “Turkey Hunter.”

### 24.4 Feed Noise Policy

Bounty creation and settlement should generally be feed-worthy.

Hunter joins may become noisy. Recommended behavior:

- publish the first hunter join;
- publish major pot/action milestones if desired;
- make all hunter joins configurable;
- avoid flooding the feed with every small entry if league activity grows.

### 24.5 User Text in Feed

The bounty title is user-authored and may appear in feed templates.

The feed should still use controlled templates rather than storing arbitrary final rendered text.

Example template:

```text
{actor} posted a bounty: “{bounty_title}.”
```

Do not allow arbitrary player-authored feed messages in v1.

---

## 25. Application Workflows

## 25.1 Create Player-Sponsored Bounty

When a player creates a `sponsor_bounty`:

1. Validate active season.
2. Validate title and description.
3. Validate `sponsor_bounty_amount > 0`.
4. Validate `hunter_stake_amount > 0`.
5. Validate `closes_at`.
6. Validate player has enough available pins for `sponsor_bounty_amount`.
7. Create `bounty_post` with `status = open`.
8. Create sponsor stake ledger entries moving sponsor pins to House escrow.
9. Publish Activity Feed event.
10. Commit atomically.

### 25.1.1 Player Creation Form

Player-facing fields:

```text
Title
Description
Sponsor bounty amount
Hunter stake amount
Close time, defaulted to upcoming Monday 7 PM ET
```

Do not expose:

```text
house seed mode
House seed calculation controls
admin settlement fields
```

The UI should preview:

```text
You are risking: X pins
Hunters must stake: Y pins each
First hunter profit if hunters win: +X pins
Second hunter profit if hunters win: +floor(X / 2) pins
More hunters get progressively lower protected profit.
```

## 25.2 Create House Bounty

When the Pinsino creates a `house_bounty` through admin UI:

1. Validate active season.
2. Validate title and description.
3. Validate `sponsor_bounty_amount > 0`.
4. Validate `hunter_stake_amount > 0`.
5. Validate `closes_at`.
6. Create `bounty_post` with `status = open` and `sponsor_player_id = null`.
7. Do not create sponsor stake ledger entries.
8. Publish Activity Feed event as the Pinsino.
9. Commit.

Admins act on behalf of the Pinsino. The product table does not need to track which admin created the House bounty.

## 25.3 Hunter Entry

When a player enters a bounty as hunter:

1. Begin transaction.
2. Lock the relevant `bounty_post` row.
3. Validate `status = open`.
4. Validate `now < closes_at`.
5. Validate player is not the sponsor for a `sponsor_bounty`.
6. Validate player has not already entered this bounty.
7. Validate player has enough available pins for `hunter_stake_amount`.
8. Compute next `entry_number`.
9. Compute `protected_hunter_profit = floor(sponsor_bounty_amount / entry_number)`.
10. Create `bounty_hunter_stakes` row.
11. Create hunter stake ledger entries.
12. Optionally publish Activity Feed event.
13. Commit.

### 25.3.1 Entry Preview

Before confirmation, the UI should show:

```text
You will be Hunter #N.
Your stake: H pins.
If hunters win, your protected profit: P pins.
If hunters win, your total payout: H + P pins.
Additional hunters will not reduce your payout.
```

This preview is essential to explain the mechanic.

## 25.4 Close Bounty

A bounty closes when:

```text
now >= closes_at
```

or when an admin manually closes it.

Closing updates:

```text
status = closed
```

A closed bounty no longer accepts hunter entries.

If a bounty has zero hunters, it has no action and should be admin-cancelled / destructively cleaned up.

## 25.5 Settle Bounty

Admin settlement flow:

1. Admin opens a closed bounty.
2. App displays title, description, sponsor, hunters, stake totals, protected hunter payouts, and payout previews.
3. Admin selects `Sponsor Wins` or `Hunters Win`.
4. Admin enters `admin_settlement_reasoning`.
5. App calculates settlement snapshot values.
6. App creates `bounty_settlements` row.
7. App creates `bounty_payouts` rows.
8. App creates payout ledger entries.
9. App updates hunter stake statuses to `won` or `lost`.
10. App updates `bounty_post.status = settled`.
11. App publishes settlement Activity Feed event.
12. Commit atomically.

The admin should never manually enter payout amounts.

---

## 26. Settlement Calculation

Let:

```text
S = bounty_post.sponsor_bounty_amount
H = bounty_post.hunter_stake_amount
N = count(bounty_hunter_stakes)
```

For each hunter stake:

```text
protected_hunter_profit = already snapshotted on bounty_hunter_stakes
stake_amount = already snapshotted on bounty_hunter_stakes
```

At settlement:

```text
total_sponsor_bounty = S

total_hunter_stakes = SUM(stake_amount)

total_protected_hunter_profit = SUM(protected_hunter_profit)

total_house_seed = max(0, total_protected_hunter_profit - total_sponsor_bounty)

total_pot = total_sponsor_bounty + total_hunter_stakes + total_house_seed
```

### 26.1 Sponsor Win Calculation

If:

```text
settlement_outcome = sponsor_win
```

For `sponsor_bounty`:

```text
winner_count = 1
sponsor payout = total_pot
```

For `house_bounty`:

```text
winner_count = 1, conceptually House
no player payout required
```

### 26.2 Hunter Win Calculation

If:

```text
settlement_outcome = hunter_win
```

For each hunter:

```text
hunter payout = stake_amount + protected_hunter_profit
```

Then:

```text
winner_count = hunter_count
```

### 26.3 No Remainder Dust

Because each hunter payout is individually calculated from a snapshotted protected profit, there is no equal split and no remainder dust.

---

## 27. Admin Cancellation

Admin cancellation is destructive rollback.

When an admin cancels a bounty, delete:

```text
bounty_post
bounty_hunter_stakes
bounty_settlements
bounty_payouts
all bounty-related pin_ledger rows
all bounty-related activity_feed_events rows
```

The result should be as if the bounty never existed economically or publicly.

This should be implemented with explicit deletion plus `ON DELETE CASCADE` where appropriate.

### 27.1 Cancellation Before Settlement

Delete:

- `bounty_post`;
- all hunter stake rows;
- all sponsor stake ledger rows;
- all hunter stake ledger rows;
- all feed events linked to `bounty_post_id`.

### 27.2 Cancellation After Settlement

Delete:

- `bounty_post`;
- all hunter stake rows;
- settlement rows;
- payout rows;
- sponsor stake ledger rows;
- hunter stake ledger rows;
- payout ledger rows;
- feed events linked to `bounty_post_id`.

Do not write compensating refund events for admin cancellation in v1.

The deletion itself is the cancellation mechanism.

### 27.3 Admin Audit

If operational traceability is needed, record admin cancellation in a separate admin audit log.

Do not keep cancelled bounty rows in `bounty_post`.

Do not use the public Activity Feed as the audit log.

---

## 28. Guardrails

### 28.1 Voluntary Risk

Players only lose pins if they voluntarily take an economic action:

- sponsoring a bounty;
- entering as hunter.

No player can lose pins merely because another player posted a bounty about them.

### 28.2 Sponsor Cannot Hunt Own Bounty

For `sponsor_bounty`, the sponsor cannot enter their own bounty as a hunter.

This should be enforced in application logic and ideally with database validation where possible.

### 28.3 One Entry Per Player

V1 allows one hunter stake per player per bounty:

```sql
unique (bounty_post_id, player_id)
```

This keeps payouts clear and avoids whale-like repeated entries.

### 28.4 Positive-Performance Norm

Bounties should generally avoid incentives for poor self-performance.

Especially for “Back Yourself” style bounties, the sponsor-side condition should be positive performance:

- bowl 200+;
- beat projected series;
- hit a high score;
- bowl a turkey;
- beat personal line by a margin.

Avoid:

- “I will bowl under X”;
- “I will miss league night”;
- “I will tank Game 3.”

Because v1 uses freeform descriptions, this is enforced through admin review, admin cancellation, and social norms rather than machine-readable condition logic.

### 28.5 Anti-Griefing

Avoid public bounty patterns that feel like harassment or dogpiling.

A bounty may reference league-wide events or the sponsor’s own performance freely.

Bounties about a specific third player should be monitored more carefully.

Admins should cancel bounties that feel mean-spirited, abusive, or socially unsafe.

### 28.6 House Seed Abuse

The anti-dilution House seed is intentionally generous.

Potential abuse:

- a sponsor posts an easy sponsor-win bounty;
- friendly hunters enter to generate House seed;
- admin settles sponsor win;
- the sponsor farms the Pinsino.

Mitigations:

- bounty title and description are public;
- settlement reasoning is required;
- admins can cancel bad-faith bounties;
- sponsor cannot hunt own bounty;
- one hunter entry per player;
- House seed mode is system-owned, not player-configurable;
- future versions may add limits or automated abuse detection.

### 28.7 No Negative Balances on Entry

Players cannot sponsor or hunt unless they have sufficient available pins.

Borrowed pins from Loan Shark are fungible and may be used if they are part of available balance.

---

## 29. UI Product Surface

## 29.1 Bounty Board List

Each bounty card should show:

- title;
- sponsor identity: Pinsino or player;
- bounty type;
- sponsor bounty amount;
- hunter stake amount;
- hunter count;
- close time;
- current next hunter terms;
- current status;
- whether the current user has entered;
- whether the current user is the sponsor.

Example card:

```text
Turkey Hunter
Posted by the Pinsino
Sponsor bounty: 300 pins
Hunters stake: 50 pins
Hunters: 4
Next hunter profit: +75 pins
Closes Monday 7:00 PM
```

## 29.2 Bounty Detail Page

The detail page should show:

- title;
- description;
- sponsor;
- sponsor bounty amount;
- hunter stake amount;
- close time;
- status;
- hunter list with entry numbers;
- each hunter’s protected profit;
- current total protected hunter profit;
- current estimated House seed;
- payout preview for sponsor win;
- payout preview for hunter win;
- Activity Feed events;
- settlement reasoning after settlement.

## 29.3 Hunter Entry Confirmation

Before entry, show:

```text
You are joining as Hunter #N.
You will stake H pins.
If hunters win, you receive H + P pins total.
Your protected profit is +P pins.
Additional hunters will not reduce your payout.
```

Also show:

```text
An admin will manually settle this bounty based on the posted description.
```

## 29.4 Sponsor Creation Form

Player sponsor form:

```text
Title
Description
Sponsor bounty amount
Hunter stake amount
Close time
```

Preview:

```text
You are risking S pins.
Hunters will stake H pins each.
Hunter #1 profit if hunters win: +S pins.
Hunter #2 profit if hunters win: +floor(S / 2) pins.
Hunter #3 profit if hunters win: +floor(S / 3) pins.
The Pinsino will seed the pot if needed to protect early hunter payouts.
```

## 29.5 Settlement Display

After settlement, show:

- winning side;
- admin settlement reasoning;
- total sponsor bounty;
- total hunter stakes;
- total protected hunter profit;
- total House seed;
- final payouts.

Example:

```text
Hunters Win
Reasoning: Chris bowled a turkey in Game 2, satisfying the bounty description.
Total House Seed: 325 pins
```

---

## 30. Admin Tools

Admins need tools to:

- create House bounties;
- view all bounty posts;
- filter by status, week, season, sponsor, and bounty type;
- close bounties manually;
- settle closed bounties as sponsor win;
- settle closed bounties as hunter win;
- enter required settlement reasoning;
- preview payout calculations before settlement;
- cancel bounties destructively;
- inspect bounty-related ledger rows;
- inspect Activity Feed rows linked to the bounty;
- suppress valid feed events if needed.

Admin settlement should be designed around outcome adjudication, not manual financial editing.

---

## 31. Indexing and Constraints

Recommended indexes:

```sql
CREATE INDEX bounty_post_board_idx
ON bounty_post (season_id, status, closes_at, created_at DESC);

CREATE INDEX bounty_post_week_idx
ON bounty_post (week_id, status, closes_at);

CREATE INDEX bounty_post_sponsor_idx
ON bounty_post (sponsor_player_id, season_id)
WHERE sponsor_player_id IS NOT NULL;

CREATE INDEX bounty_hunter_stakes_post_idx
ON bounty_hunter_stakes (bounty_post_id, entry_number);

CREATE INDEX bounty_hunter_stakes_player_idx
ON bounty_hunter_stakes (player_id, bounty_post_id);

CREATE INDEX bounty_settlements_post_idx
ON bounty_settlements (bounty_post_id);

CREATE INDEX bounty_payouts_post_idx
ON bounty_payouts (bounty_post_id);
```

Recommended uniqueness:

```sql
ALTER TABLE bounty_hunter_stakes
ADD CONSTRAINT bounty_hunter_unique_player
UNIQUE (bounty_post_id, player_id);

ALTER TABLE bounty_hunter_stakes
ADD CONSTRAINT bounty_hunter_unique_entry_number
UNIQUE (bounty_post_id, entry_number);
```

Recommended single-settlement constraint:

```sql
CREATE UNIQUE INDEX bounty_settlements_one_per_post
ON bounty_settlements (bounty_post_id);
```

---

## 32. Transaction Safety

### 32.1 Hunter Entry Race Conditions

Hunter entry must be serialized per bounty so entry numbers are unique and protected profits are deterministic.

Use one of:

- row-level lock on `bounty_post`;
- advisory lock by `bounty_post_id`;
- transaction retry on unique constraint conflict.

Recommended flow:

```text
BEGIN
lock bounty_post row
compute next entry_number
insert hunter stake
insert ledger rows
COMMIT
```

### 32.2 Settlement Race Conditions

Settlement must be atomic.

The settlement transaction should:

- lock the `bounty_post` row;
- verify status is `closed`;
- verify at least one hunter exists;
- compute settlement values;
- create settlement row;
- create payout rows;
- create payout ledger rows;
- update hunter statuses;
- update bounty status to `settled`;
- publish Activity Feed event;
- commit.

### 32.3 Cancellation Race Conditions

Admin cancellation should lock the bounty and delete related records in a transaction.

Do not allow cancellation and settlement to race.

---

## 33. Example End-to-End Flows

## 33.1 Player-Sponsored Back Yourself Bounty

Garrett creates:

```text
Title: Garrett 200 Watch
Description: I will bowl at least one 200+ game this week. If I do, sponsor wins. If I do not, hunters win.
Sponsor bounty: 300
Hunter stake: 50
```

At creation:

```text
Garrett stakes 300 pins into House escrow.
Bounty opens.
```

Hunters enter:

| Hunter | Entry # | Stake | Protected Profit | Payout if Hunters Win |
|---|---:|---:|---:|---:|
| Mike | 1 | 50 | 300 | 350 |
| Sarah | 2 | 50 | 150 | 200 |
| Chris | 3 | 50 | 100 | 150 |

Settlement values:

```text
total_sponsor_bounty = 300
total_hunter_stakes = 150
total_protected_hunter_profit = 550
total_house_seed = 250
total_pot = 700
```

If Garrett bowls 204:

```text
settlement_outcome = sponsor_win
Garrett receives 700
hunters lose their stakes
```

If Garrett fails to bowl 200+:

```text
settlement_outcome = hunter_win
Mike receives 350
Sarah receives 200
Chris receives 150
```

## 33.2 House Bounty

The Pinsino posts:

```text
Title: Turkey Hunter
Description: If anyone in the league bowls a turkey this week, hunters win. If nobody bowls a turkey, the Pinsino wins.
Sponsor bounty: 300
Hunter stake: 50
```

No sponsor stake ledger movement is created at posting because the House is the sponsor.

Hunters enter as usual.

If a turkey happens:

```text
settlement_outcome = hunter_win
House pays hunter payouts, including sponsor bounty and seed if needed.
```

If no turkey happens:

```text
settlement_outcome = sponsor_win
House keeps hunter stakes.
No player sponsor payout is created.
```

## 33.3 Admin Cancellation

A player posts an unclear bounty:

```text
Title: Weird Vibes Bet
Description: You know what this means.
```

Hunters enter, but the admin determines the bounty cannot be fairly settled.

Admin uses:

```text
Admin Cancel Bounty
```

The system deletes:

- the bounty post;
- hunter stake rows;
- sponsor stake ledger rows;
- hunter stake ledger rows;
- feed events.

The bounty is treated as if it never existed.

---

## 34. Open Implementation Decisions

The core feature architecture is settled, but these implementation details should be resolved during build.

### 34.1 Title and Description Length Limits

Recommended starting limits:

```text
title: 80 characters
description: 1,000 characters
```

These can be tuned based on UI.

### 34.2 Feed Volume for Hunter Joins

Decision:

- publish every hunter join;
- publish only first hunter join;
- publish only milestone joins;
- publish no hunter joins by default.

Recommendation:

> Publish bounty creation and settlement by default. Make hunter join feed events configurable.

### 34.3 Public Settlement Reasoning

Decision:

- show admin settlement reasoning publicly;
- show only in admin views;
- show brief public result and detailed admin note privately.

Recommendation:

> Show `admin_settlement_reasoning` publicly on bounty detail. It justifies the result of a public economic contract.

### 34.4 House Seed Reporting

Decision:

- show House seed prominently before settlement as an estimate;
- show only after settlement;
- show both current estimate and final snapshot.

Recommendation:

> Show current estimated House seed on bounty detail, and final seed after settlement.

### 34.5 Sponsor Bounty Limits

Decision needed for:

```text
minimum sponsor_bounty_amount
maximum sponsor_bounty_amount
minimum hunter_stake_amount
maximum hunter_stake_amount
```

Recommendation:

```text
minimum sponsor bounty: 50 pins
minimum hunter stake: 25 pins
maximums: configurable by admin / season settings
```

### 34.6 Admin Audit Log

Decision:

- create a broader admin audit log now;
- defer admin audit logging.

Recommendation:

> If destructive cancellation is used broadly across the economy, create or reuse a general admin audit log rather than feature-specific cancelled statuses.

---

## 35. Future Expansion

Potential future versions may add:

- automatic settlement for structured bounty templates;
- bounty templates for common events;
- recurring House bounties;
- bounty categories;
- player profile bounty stats;
- bounty creation badges;
- bounty leaderboards;
- bounty reactions or comments;
- sponsor reputation;
- hunter streaks;
- bounty-specific cosmetics;
- higher-risk seasonal bounty events;
- variable seed modes;
- bounty moderation queues;
- bounty dispute workflows;
- team-based bounty posts.

Future automatic settlement should be added carefully and should not compromise the flexibility of manual freeform bounties.

---

## 36. Summary

The Bounty Board is a public, pooled, manually settled economic challenge system.

The root object is:

```text
bounty_post
```

The two bounty types are:

```text
house_bounty
sponsor_bounty
```

The core player-side feature is the `sponsor_bounty`, where a player posts a bounty, risks personal pins, and invites hunters to take the other side.

The best-in-class mechanic is **early hunter anti-dilution**:

```text
protected_hunter_profit = floor(sponsor_bounty_amount / entry_number)
```

This rewards early hunters with better terms and protects them from later dilution.

The Pinsino funds the difference through House seed:

```text
total_house_seed = max(0, total_protected_hunter_profit - sponsor_bounty_amount)
```

This keeps bounties pooled and social rather than turning them into custom sportsbook lines.

For v1:

- title and description are freeform;
- all bounties are manually settled by admins;
- settlement outcomes are only `sponsor_win` or `hunter_win`;
- there is no rake;
- there is no void outcome;
- admin cancellation destructively rolls back all related records and ledger entries;
- Activity Feed integration uses `bounty_post_id` with `ON DELETE CASCADE`.

In short:

> The Bounty Board lets players create public, high-social-action economic challenges, rewards early hunters for taking risk, and lets the Pinsino juice the pot in a way that makes the feature strategically rich without becoming another Sportsbook.
