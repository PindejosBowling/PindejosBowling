# Economic Design Decisions — Pin Economy Expansion

This document captures the design decisions made before brainstorming new economic mechanics for the Pindejos Bowling app. It is intended to sit alongside `PIN_ECONOMY.md` as a product/design reference.

`PIN_ECONOMY.md` describes the existing macroeconomic model: pins, pincome, the House/Pinsino, betting, money supply, bonuses, and core accounting rules. This file records the desired design direction for expanding the economy into a richer game-within-a-game.

---

## 1. Core framing

The pin economy is a **game within a game**.

The base-layer game is the actual bowling league. Players bowl, scores are recorded, teams win or lose, standings are determined, and the league continues to function as a normal bowling league.

The pin economy is the metagame layered on top of that bowling league. Bowling performance generates **pincome**, but all downstream economic activity exists inside the app as a separate strategic/social game.

### Important distinction

- **Bowling league:** the real sport and league competition.
- **Pin economy:** the app-based economic/social/strategic game built around the bowling league.

The pin economy can reference bowling outcomes, player scores, RSVPs, archived weeks, and betting results, but it must not compromise the integrity of the bowling league itself.

---

## 2. Existing economic foundation

The current economy already has a strong base model:

- Pins are a closed, play-money currency.
- Pins are season-scoped.
- Balances are derived from append-only pin events rather than manually stored wallet values.
- Bowling scores are the only true faucet that mints new pins.
- The House, also known as the Pinsino, acts as reserve, counterparty, and economic infrastructure.
- The Pinsino already supports player-vs-house betting through individual player over/under markets.
- Bets settle when league weeks are archived.
- Players' pin balances determine their standings in the economy.
- At the end of each season, balances reset and the economic game starts over.

The current Pinsino is effectively the foundation for a sportsbook. At present, it supports over/unders on individual player game outcomes, but many additional market types could be added later.

---

## 3. Primary goals for expansion

The expanded economy should serve several goals at once, but the most important are:

1. **Drive weekly engagement with the app.**
   Players should have reasons to open the app before league night, after league night, and during the days between.

2. **Create chaos and fun within the economy.**
   The economy should produce stories, grudges, big swings, questionable decisions, dramatic comebacks, and memorable league moments.

3. **Increase social interaction between league members.**
   Mechanics should encourage conversation, negotiation, rivalries, challenges, commentary, and trash talk.

4. **Reward strategic risk-taking.**
   The target audience includes working-class professionals who enjoy games of skill. Mechanics should reward judgment, timing, risk management, prediction, and social reads.

5. **Create a meaningful season-long metagame.**
   The goal of the pin economy is to finish the season with the highest pin balance. The season reset makes each season a self-contained economic contest.

---

## 4. Desired game feel

The economy should not feel like a pure slot machine or random casino.

The desired feel is closer to:

- a poker table,
- a fantasy sports league,
- a sportsbook,
- a chaotic social party game,
- and a light strategic metagame.

The Pinsino already covers the sportsbook foundation: player-vs-house betting on uncertain bowling outcomes. Future expansion should place greater emphasis on **player-vs-player** and **player-with-player** interactions.

### Preferred feel

The economy should feel like:

> A poker table plus fantasy league plus controlled party-game chaos, layered around the existing sportsbook.

### Avoid

Avoid mechanics that are primarily:

- pure chance,
- passive,
- isolated from other players,
- mechanically shallow,
- or disconnected from league social dynamics.

Randomness can exist, but it should be attached to meaningful decisions, risk, timing, negotiation, bluffing, pricing, or social interaction.

---

## 5. Player-vs-player emphasis

The current Pinsino is mostly **player vs. House**. Players place bets against the imaginary House, and the House pays or collects based on outcomes.

That mechanic is valuable, but it does not fully satisfy the social goals of the economy.

Future expansion should explore mechanisms that create:

- player-vs-player tension,
- direct challenges,
- rivalry structures,
- voluntary duels,
- negotiated wagers,
- auctions,
- social contracts,
- public declarations,
- bluffing,
- counter-positioning,
- and visible consequences.

The best new mechanics will make players care not just about their own score, but about what other players are doing, risking, buying, declaring, accepting, or refusing.

---

## 6. Inequality and competitiveness

The economy should be allowed to produce large gaps between players.

Strong bowlers, sharp bettors, clever strategists, and active economic participants should be able to build massive leads. If a player dominates a season economically, that is an acceptable and desirable outcome.

Because each season resets, there is no permanent inequality problem. A player who becomes rich in one season wins that season's economic game, then starts over with everyone else in the next season.

### Design principle

> The economy should be meritocratic but volatile.

This means:

- strong players should be able to run away with the lead;
- clever players should be rewarded;
- active participants should have more opportunities than passive ones;
- trailing players should still have high-risk tools that let them stay dangerous;
- comebacks should be possible, but not guaranteed or artificially forced.

---

## 7. Catch-up mechanics and leverage

Catch-up mechanics are acceptable when they create strategic risk rather than automatic charity.

A desirable catch-up mechanic should require the player to make a decision, accept downside, and expose themselves to consequences.

### Example: Loan Shark mechanic

One proposed mechanic is a **Loan Shark** feature.

Players could take out high-interest pin loans to gain immediate spending power in the economy. The catch is that a percentage of their future pincome is automatically garnished until the debt is repaid.

Possible features:

- fixed principal amount;
- explicit interest rate;
- automatic garnishment from future weekly pincome;
- optional early repayment;
- visible debt status;
- escalating consequences for repeated borrowing;
- limited borrowing windows;
- debt leaderboard or shame-neutral debt indicator;
- admin-controlled loan terms;
- special promotional loan offers from the House.

This kind of mechanic is desirable because it creates:

- leverage,
- desperation plays,
- comeback attempts,
- future income drag,
- strategic timing decisions,
- and narrative consequences.

It is preferable to a simple catch-up bonus because the player chooses the risk and pays for it later.

---

## 8. Bowling league integrity constraint

The pin economy must **never** influence actual bowling league gameplay.

This is a hard rule.

Some players may only care about bowling and may have no interest in the pin economy. Those players must be able to participate in the league without feeling disadvantaged, pressured, punished, or manipulated by the economy game.

### The pin economy must not affect:

- bowling scores;
- handicaps;
- team standings;
- lane assignments;
- team assignments;
- playoff qualification;
- actual match outcomes;
- who bowls when;
- official league rules;
- or any material competitive aspect of the bowling league.

The integrity of the base bowling league is untouchable.

---

## 9. Allowed reward categories

Rewards and purchases are acceptable if they are either:

1. **Cosmetic inside the app**, or
2. **Contained entirely within the pin economy.**

### Acceptable examples

- profile badges;
- titles;
- cosmetic profile frames;
- leaderboard flair;
- temporary visual effects;
- collectible items;
- bet boosters;
- wager modifiers;
- access to special markets;
- entry into side tournaments;
- economy-only powerups;
- public challenge tokens;
- cosmetic trophies;
- weekly merchant items;
- limited-time app effects.

### Unacceptable examples

- anything that changes actual bowling performance;
- anything that alters official league competition;
- anything that creates a real-world bowling advantage;
- anything that pressures non-participating players;
- anything that lets economy participants impose consequences on bowling-only participants.

---

## 10. House / Pinsino reserve policy

For now, the House can be treated as having infinite reserves for the purpose of trialing new mechanics.

This allows the app to experiment with bonuses, payouts, promotions, and new economic sectors without first requiring a perfectly balanced reserve model.

However, it is still useful for the House reserve to be economically meaningful.

The House can accumulate pins through:

- lost bets;
- vig;
- fees;
- merchant sales;
- transaction taxes;
- loan interest;
- tournament rake;
- entry fees;
- auction fees;
- failed challenges;
- and other player-to-House transfers.

### Working assumption

Both of the following can be true:

1. The House has an effectively infinite operational balance sheet.
2. The economy still uses House inflows as a balancing, scoring, and design tool.

This means the House does not need to be solvent in a strict sense, but fees and sinks can still be used to shape player behavior and control player-held supply.

---

## 11. Sink model

Pins paid into sinks should go to the House reserve rather than being permanently destroyed.

This is consistent with existing behavior: when players lose bets, the House keeps the stake. New sink-like mechanics should generally follow the same model.

### Examples of player-to-House sinks

- buying cosmetics;
- paying loan interest;
- paying a tournament entry fee;
- paying a market access fee;
- paying a merchant purchase price;
- paying a transaction tax;
- paying a challenge creation fee;
- paying an auction listing fee;
- paying for a bet booster;
- paying a penalty voluntarily accepted as part of a challenge.

### Design language

Even though these are often called “sinks,” they are technically not burns. They remove pins from player circulation by moving them to the House reserve.

This preserves the broader economic model where pins are not destroyed after being minted.

---

## 12. Admin complexity

Manual and admin-driven mechanics are acceptable.

The app already includes a **Pinsino Admin** page that supports back-of-house actions such as manually settling bets and canceling bets after they have been placed or settled.

New mechanics can be folded into this administrative framework.

This is important because the available bowling data is limited. The app currently has:

- team win/loss data;
- individual scores;
- the relationship between team results and individual score components;
- archived week transitions;
- existing bet and settlement data.

Because the bowling data is limited, the economy should not be constrained only to mechanics that can be automatically derived from scores.

### Acceptable mechanic types

#### Fully automated

Mechanics that settle directly from existing data:

- scores;
- team wins/losses;
- archived weeks;
- RSVPs;
- bet outcomes;
- leaderboard positions;
- pin balances;
- debt balances;
- transaction histories.

#### Admin-triggered

Mechanics started, configured, or opened by an admin:

- traveling merchant;
- weekly events;
- special markets;
- loan offers;
- auctions;
- bounty boards;
- tournaments;
- limited-time promotions;
- bonuses;
- seasonal events.

#### Admin-adjudicated

Mechanics that require judgment or manual resolution:

- social challenges;
- custom wagers;
- player-created contests;
- disputes;
- subjective weekly awards;
- commissioner-created chaos events;
- special one-off economy events.

---

## 13. Weekly engagement rhythm

League night occurs on Mondays.

After games are played, those games are archived. Archiving is the transition point between one active week and the next. When a week is archived:

- scores become final;
- pincome is minted;
- relevant bets are settled;
- pincome statements are updated;
- balances and leaderboards change;
- the next week can begin economically.

The economy should use this weekly transition as its core rhythm.

### Suggested weekly cycle

#### Monday: League night

- Bowling happens.
- Final pre-game bets close.
- Player performance determines scores.
- Social energy is highest.

#### Post-game / archive window

- Scores are archived.
- Pincome is minted.
- Bets settle.
- Balances update.
- Debt garnishments process.
- Weekly recaps become available.

#### Tuesday: Fallout and recap

- Players see pincome statements.
- Leaderboard movement is highlighted.
- Big wins/losses are surfaced.
- New debts, bankruptcies, or major swings become social content.
- Achievements and awards can be granted.

#### Midweek: Strategic activity

- Auctions open.
- Merchant appears.
- Loan offers become available.
- Player-vs-player challenges are issued.
- Bounties are posted.
- Side tournaments open for entry.
- Players reposition before the next week.

#### Pre-game window

- New betting lines are posted.
- Players make picks.
- Parlays are constructed.
- Challenges are accepted or declined.
- Last-minute wagers and social trash talk occur.

This rhythm should create reasons to open the app multiple times per week rather than only on league night.

---

## 14. Mobile-app optimization

The economy should be designed as an app-native engagement system.

Because players can log into an iOS app as themselves, mechanics can use mobile-native behavior patterns.

### Available engagement tools

- push notifications;
- limited-time windows;
- claim buttons;
- accept/decline flows;
- public activity feeds;
- player profiles;
- badges and cosmetics;
- leaderboard projections;
- pending outcome previews;
- debt status cards;
- challenge cards;
- weekly recap cards;
- merchant drops;
- auction countdowns;
- market open/close alerts;
- rivalry callouts;
- personalized pincome statements;
- public ledgers and transaction history.

### Product implication

Mechanics should not only be economically interesting. They should also produce visible, tappable, shareable, and discussable moments inside the app.

A good mechanic should answer:

- Why would someone open the app today?
- What decision do they need to make?
- Who else will notice?
- What is at risk?
- What story will this create by Monday night?

---

## 15. Social and ethical guardrails

The league should remain fun, light-hearted, and socially safe.

The economy can create competition, rivalry, loss, debt, volatility, trash talk, and dramatic consequences, but it should avoid making players feel marginalized, bullied, or embarrassed.

### Core principle

> Losses should be voluntary or self-inflicted, not imposed by other players without consent.

Players should lose pins because they:

- placed a bad bet;
- accepted a risky challenge;
- over-leveraged through a loan;
- bought an item that did not pay off;
- mispriced an auction;
- entered a tournament and lost;
- made a poor strategic decision;
- failed to account for risk.

Players should generally not lose pins because another player unilaterally targeted them.

### Avoid incentivizing

- tanking;
- collusion;
- harassment;
- repeated targeting;
- public humiliation;
- bullying mechanics;
- economic griefing;
- punishing non-participants;
- mechanics that make weaker bowlers feel like props;
- mechanics that make the app feel mean-spirited.

### Acceptable chaos

Chaos is welcome when it is:

- opt-in;
- funny rather than cruel;
- strategically legible;
- bounded in downside;
- reversible or temporary when appropriate;
- contained within the economy;
- socially visible without being humiliating.

---

## 16. Anti-tanking and integrity

The existing Pinsino already includes anti-tanking mechanics, including restrictions that prevent players from profiting by betting against their own performance in obvious ways.

Future mechanics should preserve the same design spirit.

### Design rule

No mechanic should make a player better off by intentionally bowling worse, skipping games, undermining their team, or distorting the real league competition.

Potential risks to monitor:

- betting against one's own performance;
- taking challenges that reward poor bowling;
- colluding with another player to manipulate a market;
- intentionally missing games to affect a bet;
- creating debt or reward rules that make low scores strategically useful;
- allowing economy incentives to override actual league incentives.

---

## 17. Design implications for future brainstorming

Based on these decisions, the strongest expansion categories are likely to be:

### Debt and leverage

Examples:

- Loan Shark;
- margin-style borrowing;
- weekly garnishment;
- debt refinancing;
- emergency liquidity;
- predatory but transparent loan offers;
- limited-time credit events.

Why it fits:

- creates risk;
- supports comebacks;
- produces ongoing narrative;
- encourages strategic timing;
- does not affect bowling gameplay.

### Player-vs-player challenges

Examples:

- voluntary score duels;
- head-to-head prediction challenges;
- rival wagers;
- accepted bounty contests;
- “I beat your score this week” side pots;
- challenge cards with defined stakes.

Why it fits:

- creates social interaction;
- makes outcomes personal;
- supports trash talk;
- requires consent when stakes are direct.

### Auctions and markets

Examples:

- auctioning limited bet boosters;
- player-created markets;
- item resale markets;
- weekly sealed-bid auctions;
- access passes to special events;
- bid-to-own cosmetic drops.

Why it fits:

- rewards pricing skill;
- creates midweek engagement;
- allows player-vs-player competition without direct punishment.

### Traveling merchant / shop drops

Examples:

- limited-time bet boosters;
- cosmetic items;
- market access tickets;
- challenge tokens;
- parlay insurance;
- one-week-only modifiers;
- discounted but risky items.

Why it fits:

- creates app check-ins;
- generates House revenue;
- introduces controlled chaos;
- can be admin-run.

### Bounty boards

Examples:

- voluntary bounties on outcomes;
- “beat this line” challenges;
- public objectives with entry fees;
- admin-posted weekly feats;
- player-funded prize pools.

Why it fits:

- creates shared goals;
- encourages social participation;
- can be designed as opt-in;
- supports strategic targeting without griefing.

### Tournaments and side pots

Examples:

- weekly pin buy-in tournaments;
- parlay contests;
- prediction pools;
- survivor-style economy contests;
- leaderboard sprints;
- high-roller events.

Why it fits:

- creates discrete events;
- supports both skill and risk;
- adds House fees or rake;
- can generate dramatic swings.

### Cosmetics and status

Examples:

- profile titles;
- badge frames;
- leaderboard flair;
- rare collectibles;
- season trophies;
- item collections;
- visible economic achievements.

Why it fits:

- creates non-bowling rewards;
- gives players something to spend on;
- supports identity and social signaling;
- avoids affecting league integrity.

### Weekly chaos events

Examples:

- admin-created one-week modifiers;
- special market weeks;
- limited loan windows;
- double-or-nothing challenges;
- merchant visits;
- special bounty themes;
- auction weeks.

Why it fits:

- creates novelty;
- supports mobile engagement;
- allows manual experimentation;
- keeps the season from feeling static.

---

## 18. Evaluation criteria for new mechanics

Every proposed mechanic should be evaluated against the following questions:

1. **Does it preserve bowling league integrity?**
   If it affects actual bowling competition, reject it.

2. **Is the risk voluntary?**
   Players should opt into meaningful downside.

3. **Does it create app engagement?**
   The mechanic should give players a reason to open the app outside league night.

4. **Does it create social interaction?**
   The best mechanics produce conversation, rivalry, negotiation, or public narrative.

5. **Is there strategic depth?**
   Avoid pure-chance mechanics unless players make meaningful decisions around them.

6. **Does it route value cleanly?**
   Pin movements should be legible: player-to-player, player-to-House, House-to-player, or score-minted pincome.

7. **Does it avoid griefing?**
   No player should be able to repeatedly damage another player without consent.

8. **Can it be administered?**
   If manual action is required, it should fit into Pinsino Admin workflows.

9. **Does it produce a story?**
   Ideally, the mechanic creates a moment people talk about at league night.

10. **Does it fit the season structure?**
    Since balances reset each season, the mechanic should contribute to that season's economic race.

---

## 19. Current working design thesis

The pin economy should evolve from a simple sportsbook-adjacent ledger into a strategic social metagame.

The strongest direction is not to replace the Pinsino, but to build around it:

- keep score-based pincome as the only true faucet;
- keep the House as the central counterparty and reserve;
- keep betting as one major economic sector;
- add player-vs-player and player-with-player mechanics;
- add House-capturing sinks through fees, purchases, interest, and taxes;
- add opt-in chaos through challenges, auctions, debt, merchant drops, and tournaments;
- preserve a season-long race to finish with the highest pin balance;
- protect the integrity and inclusiveness of the real bowling league.

In short:

> The economy should reward cleverness, risk management, social reads, and bold decisions, while making the app more fun to open every week.

---

## 20. Constraints summary

The following constraints are now considered settled design requirements:

1. The pin economy is a game-within-a-game layered on top of bowling.
2. Bowling performance generates pincome, but economic activity must remain separate from official league competition.
3. The economy should drive app engagement, social interaction, controlled chaos, and strategic depth.
4. The desired audience enjoys poker-like skill, not pure slot-machine randomness.
5. The Pinsino already covers player-vs-House sportsbook mechanics.
6. New expansion should emphasize player-vs-player and player-with-player systems.
7. Strong players should be allowed to build large leads.
8. Catch-up mechanics should exist only when they involve voluntary risk.
9. Loans and leverage are promising design spaces.
10. Pins must not buy any advantage in actual bowling.
11. In-app cosmetics and economy-contained rewards are acceptable.
12. The House can be treated as operationally infinite for now.
13. House reserve inflows are still useful as economic balancing tools.
14. Sinks should transfer pins to the House, not burn them.
15. Manual Pinsino Admin mechanics are acceptable.
16. Engagement should happen throughout the week, not only on league night.
17. The weekly economic cycle is anchored around Monday bowling and post-game archiving.
18. The app should use mobile-native loops such as notifications, feeds, claim flows, and limited windows.
19. The economy must avoid sandbagging, collusion, harassment, embarrassment, and griefing.
20. Economic losses should generally result from a player's own decisions.

---

## 21. Open brainstorming categories

The next brainstorming session should likely focus on the following categories:

- Loan Shark / debt / leverage systems;
- voluntary player-vs-player challenges;
- bounty boards;
- auctions;
- traveling merchant mechanics;
- bet boosters and wager modifiers;
- side tournaments and prediction contests;
- cosmetics and status purchases;
- weekly chaos events;
- House fee/vig/tax structures;
- mobile notification and engagement loops;
- player activity feeds and recap moments;
- anti-griefing rules for social mechanics;
- admin workflows for special economic events.

