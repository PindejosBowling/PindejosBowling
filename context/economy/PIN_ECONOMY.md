# Pin Economy — Economic Model

A high-level model of how value is created, held, moved, and destroyed in the
Pindejos Bowling app. This is a **self-contained economic description**: it
explains the money supply, who holds it, what generates it, and what activities
move it around — so that the current economy can be reasoned about and new
economic activity can be designed on top of it.

It deliberately stays at the level of *economic structure and behavior*, not
implementation. Think of this as the macroeconomic picture of the league, where
the only "currency" is **pins**.

---

## 1. What pins are

**Pins are a closed, play-money currency.** They have no connection to real
money and cannot be bought, sold, cashed out, or transferred outside the app.
Their entire purpose is in-app: a unit of account for league activities (today,
betting) and a season-long status leaderboard.

Two facts define the whole system:

- **Pins are season-scoped.** Every player has a balance *per season*. There is
  no cross-season carryover and no single lifetime balance. When a new season
  begins, balances effectively start fresh (apart from a small carry-in bonus —
  see §4).
- **Balance is derived, never stored.** A player's balance is the running sum of
  every pin event recorded for them in a season. There is no editable "wallet"
  number; the balance is whatever the history of events adds up to. Every change
  to the economy is an append-only event, which makes the entire money supply
  auditable at any time.

This append-only design means the economy can always answer three questions
exactly: *how many pins exist*, *where did each one come from*, and *who holds
it now*.

---

## 2. The actors

The economy has two kinds of account holders:

- **Players.** Each active player holds a season balance. Players are the
  participants — they earn pins, hold pins, and wager pins. The set of player
  balances is the "money in circulation," and it drives the **leaderboard**
  (players ranked by pin balance, the social/status payoff of the whole system).
- **The House (the "Pinsino").** A single, non-player account that acts as the
  economy's central counterparty and reserve. The house funds bonuses, takes the
  other side of bets, and absorbs or accrues the net result of all betting. The
  house balance can go negative or positive; it is the economy's shock absorber.
  The house is **excluded from the leaderboard** — it is infrastructure, not a
  competitor.

Every pin movement in the economy is one of: a **mint** (new pins enter the
system, player-side only), or a **transfer** (pins move between a player and the
house, netting to zero). There is currently no burn/sink that permanently
removes pins.

---

## 3. The money supply — "pinflation"

The defining macroeconomic feature of this economy is that **the money supply
grows as a direct function of gameplay**. We call this **pinflation**.

**The single faucet: game scores become pins.** When a week of bowling is
finalized (archived), every player is credited pins equal to the bowling scores
they posted that week — each game score becomes that many pins. A 180 game mints
180 pins for that player. This is the *only* source of genuinely new pins in the
economy.

The consequences of this design are worth stating plainly, because they are the
raw material for any new economic activity:

- **The supply is uncapped and ever-growing.** Every week of play injects new
  pins proportional to total pins knocked down league-wide. More players, more
  weeks, and higher scores all increase the money supply.
- **Minting is meritocratic but compressed.** Better bowlers mint more, but
  bowling scores live in a relatively narrow band (most scores fall within a few
  hundred of each other), so the faucet distributes pins fairly evenly across
  active players. It rewards *participation* nearly as much as *skill*.
- **Pinflation is the economy's engine.** Because the only inflow is tied to
  showing up and bowling, all downstream economic activity (betting, and anything
  built later) is ultimately funded by play. Any new economic sector inherits this
  property: the pins it moves around were all minted by someone's bowling.
- **There is no natural sink.** Pins are never destroyed once minted. Bonuses and
  betting only *move* pins between players and the house — they never reduce the
  total. This means the only thing that can shrink the player-held supply is the
  house *accumulating* pins (e.g. via a betting margin), which parks them in the
  reserve rather than burning them. Designing a real sink is an open lever (see
  §7).

**Conservation rule.** Apart from the score faucet, every pin event is
conservative: it pairs a player-side change with an equal-and-opposite
house-side change, so the two net to zero. Therefore, for any season, the total
pins in existence (players + house combined) always equals the total ever minted
from scores. Nothing else creates or destroys pins.

---

## 4. Bonuses — directed redistribution

The economy has one **recurring redistribution** mechanism beyond the score
faucet: **season-open bonuses**.

When a new season begins, the prior season's champion(s) receive a pin bonus as
a carry-in reward — recognition that crosses the otherwise-clean season
boundary. Crucially, this bonus is **funded by the house, not minted**: the
champion is credited and the house is debited the same amount, so the bonus is
conservative (it does not inflate the supply). Economically, a bonus is a
*targeted transfer from the reserve to a player* — a policy lever for rewarding
desired outcomes without printing new money.

This is the template for any future incentive: a bonus can reward any behavior
(attendance streaks, milestones, achievements, referrals) by moving pins from
the house to a player. The house's ability to fund such bonuses is bounded by
its balance, which is itself fed by whatever margin the economy's activities
generate.

---

## 5. The Pinsino — the betting sector

Today, the **only place pins are actively spent and won is the Pinsino** (the
betting subsystem). It is the economy's first and currently sole "sector" of
activity beyond the score faucet. Understanding what it offers as *economic
capabilities* (rather than mechanics) is the foundation for designing more.

### What the Pinsino does, economically

The Pinsino lets players **stake pins on uncertain outcomes against the house**.
Each wager moves the stake from the player to the house up front; if the player
wins, the house pays them back their stake plus winnings; if they lose, the house
keeps the stake. Every bet is a conservative transfer — pins shuttle between the
player and the reserve, never created or destroyed.

The house is a **funded counterparty**: it actually holds the pins it wins and
pays out of its balance when it loses. Over time the house balance reflects the
net result of all betting. Because the current odds are *fair* (no built-in house
margin), the house has no structural edge — it neither systematically drains nor
feeds the player economy; it mostly transfers pins *between* players (one
player's loss funds another's win) while acting as the intermediary.

### Operational capabilities that exist today

The betting sector currently supports these activities:

- **Player performance over/unders.** The core market: for each player in an
  upcoming game, the Pinsino posts a line (a projected score derived from past
  performance) and players bet whether that player will go *over* or *under* it.
  Markets are generated automatically from who has RSVP'd to play.
- **Single wagers.** A straight bet on one outcome at fixed (even) odds.
- **Parlays.** Combining multiple picks into one wager that pays out only if
  *all* picks win — higher risk, multiplicatively higher reward.
- **Automatic settlement.** When a week is finalized, every open market is
  settled against actual scores and payouts/refunds are applied automatically.
  Pushes (exact ties on the line) refund the stake.
- **Admin operations.** Markets can be opened/closed for betting, settled
  individually, and bets can be cancelled (a clean undo that restores balances).
- **A leaderboard and ledgers.** Players see a season ranking by balance (with a
  projection of where they'd land if their pending bets win), and every player —
  and the house — has a full activity history of every pin movement.

### Economic guardrails

A few integrity rules shape betting behavior and are worth knowing as economic
constraints:

- **No betting against yourself.** A player can never wager on their *own* poor
  performance (e.g. taking the "under" on their own line). This blocks the
  obvious moral hazard of profiting by tanking.
- **Minimum stake.** Wagers have a floor, keeping markets meaningful.
- **No negative balances.** A player can never stake more than they hold.
- **Fair odds, no vig (today).** Bets are priced at true even money, so the house
  has no automatic margin. This is a deliberate starting point — a house margin
  (a "vig") is the most direct available lever to make the house systematically
  accumulate pins (and thus fund bigger bonuses or act as a supply sink).

---

## 6. The economy in one picture

```
        ┌──────────────────────────────────────────────────────┐
        │                    BOWLING (play)                     │
        │   the ONLY faucet — every game score mints new pins   │
        └───────────────────────┬──────────────────────────────┘
                                 │ mint (player-side only)
                                 ▼
                       ┌───────────────────┐
            bonuses    │      PLAYERS      │     wagers / payouts
        ┌─────────────►│  (season balances,│◄────────────────────┐
        │  (house-     │   leaderboard)    │  (conservative       │
        │   funded,    └───────────────────┘   transfers, fair    │
        │   conservative)         ▲              odds today)      │
        │                         │                               │
        │                         ▼                               │
        │                ┌───────────────────┐                   │
        └────────────────┤   THE HOUSE       ├───────────────────┘
                         │  (reserve / central│
                         │   counterparty)    │
                         └───────────────────┘
            Reserve absorbs/accrues net betting result;
            funds bonuses; the only place pins can pool
            out of player circulation (the de-facto sink).
```

**The cycle:** players bowl → pins are minted into player hands → players move
those pins around through the Pinsino (and to/from the house) → the house
reserve rises or falls as the counterparty → the house redistributes via
bonuses. The total supply only ever grows, and only from bowling.

---

## 7. Levers and gaps for new economic activity

This model exposes a small number of structural levers. Any new economic sector
or Pinsino expansion will be working with (or against) these:

- **The faucet is play-driven and uncapped.** New activity can lean on a steady,
  growing inflow of pins tied to participation. But because supply only grows,
  unchecked new payouts will inflate balances over time.
- **There is no real sink.** Pins are never destroyed. The only way to pull pins
  *out* of player circulation is to have the house accumulate them (e.g. a
  betting margin, entry fees, or purchases that pay the house). A genuine sink —
  something players spend pins *on* that removes the pins — is an open design
  space (cosmetics, privileges, consumables, tournament buy-ins).
- **The house is a flexible reserve.** It can run deficits or surpluses, fund
  incentives, and serve as counterparty. Its balance is the natural place to
  meter the health of any new activity. New sectors can route their margin into
  the house (strengthening it) or be funded by it (drawing it down).
- **Everything is conservative except the faucet.** This invariant is worth
  preserving: as long as new activities pair every player-side change with an
  equal house-side change, the economy stays auditable and the "total = total
  minted" guarantee holds. Minting outside the score faucet should be a rare,
  explicit, visible policy choice.
- **Bonuses are a ready-made incentive primitive.** Any desired behavior can be
  rewarded with a house-funded, conservative transfer — no new minting required,
  bounded only by the reserve.
- **Pricing is the margin lever.** Today's fair odds mean the house breaks even
  in expectation. Adjusting prices (a vig on bets, fees on activities) is the
  cleanest way to give the house a structural edge — which in turn funds bigger
  redistribution or slows player-side inflation.

In short: the economy today is a **single faucet (bowling) feeding a
player-held, season-scoped supply, with one active sector (the Pinsino) that
shuffles pins between players and a central house reserve under fair odds, plus a
house-funded bonus for redistribution.** New economic activity can plug in as
additional sectors that move pins between players and the house, lean on
pinflation for funding, and — most valuably — introduce the sinks and margins
this economy currently lacks.
