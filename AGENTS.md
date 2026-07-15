# PindejosBowling Native — Agent Reference

## ⛔ HARD CONSTRAINTS — read first, no exceptions

Every agent working in this codebase MUST follow these rules. They override any default behavior. Full text + commands in [context/agent-rules.md](context/agent-rules.md).

1. **Migrations only.** ALL database changes go through `.sql` files in `supabase/migrations/` applied via `supabase db push`. NEVER execute `INSERT`/`UPDATE`/`DELETE`/DDL directly against the live database. The Supabase CLI is for exactly two things: reading (`db query`) and pushing migrations (`db push`).
2. **Never read migrations to learn the current schema.** Migration files are append-only *history* full of since-superseded DDL. Current-state DDL lives in [supabase/schema.sql](supabase/schema.sql) (generated snapshot — never hand-edit; regenerate with `./supabase/refresh-schema-snapshot.sh` as the last step of every push). Schema prose/invariants: [context/database-schema.md](context/database-schema.md) and [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md). Only open a migration to understand history or to author a new one.
3. **Supabase CLI setup.** Every `supabase` command needs `SUPABASE_ACCESS_TOKEN` loaded from `app/.env.local` plus `--linked --workdir $(pwd)` — otherwise it fails with 401. No MCP server is configured.
4. **All data comes from Supabase; all queries live in the `db/` module.** Never build ad-hoc joins from raw `supabase` client calls — add a method to the right domain file under `src/utils/supabase/db/` (`league`/`economy`/`infra`/`playoffs`), re-exported through the `db/index.ts` barrel that every consumer imports from as `'…/utils/supabase/db'`.
5. **"Current season" ≠ highest number.** It is `is_active = true` AND `registration_open = false` — always `seasons.getCurrent()`, never `getLatest()`.
6. **Compute functions are pure and uncached.** Always wrap them in `useMemo` at the screen level; no memoization inside hooks or compute functions.
7. **All ids are `uuid` / TypeScript `string`.** No integer keys anywhere.
8. **App layer has no test suite** — verify via the Expo dev server (`expo start`). **The DB layer DOES have one:** the rollback-probe suite (`./supabase/verify/run-all-probes.sh`, zero persistence). Run it before AND after pushing any migration that touches economy RPCs (`loan_*`/`pvp_*`/`bet_*`/`bounty_*`/settlement). See [context/db-verification.md](context/db-verification.md).
9. **This `AGENTS.md` is an INDEX, never a content file.** Reference material lives in self-contained markdown files under [context/](context/), one file per domain — `AGENTS.md` holds only a one-line table row per file plus these rules. When documenting a finding, pattern, or system: prefer updating the existing `context/*.md` file; otherwise create a new `context/<domain>.md` and add a row linking to it in the matching table below. Never paste reference content into `AGENTS.md`, and never reintroduce a `references/` directory.

## Project overview

React Native / Expo app for a recreational bowling league called "Pindejos." Players track weekly matchups, scores, standings, RSVPs, and historical stats. The sole backend is a Supabase Postgres database accessed via typed query objects in `src/utils/supabase/db/` (per-domain modules behind a barrel).

This file is an **index**. The detailed reference is split across [context/](context/) — read the file relevant to your task rather than loading everything. Each file is self-contained.

## Context map

| File | Read it when you need… |
|---|---|
| [context/tech-stack.md](context/tech-stack.md) | Project overview, tech stack / versions, how to run, the Supabase client + data-layer file locations |
| [context/database-schema.md](context/database-schema.md) | The 35-table schema, column lists, and the key invariants/distinctions (teams/weeks ownership, season lifecycle, cascades, betting + loan tables) |
| [context/db-queries.md](context/db-queries.md) | The `db/` typed query objects (four domain modules — `league`/`economy`/`infra`/`playoffs` — behind a barrel) — every method per table (always query through these, never raw client joins) |
| [context/data-architecture.md](context/data-architecture.md) | The hook + compute-function pattern, archived-vs-live data, standings computation, the full hooks table, and pure utilities (`helpers.ts`) |
| [context/ui-system.md](context/ui-system.md) | Player badges, the four Zustand stores, navigation architecture (tabs + stacks + routes), and the component inventory (incl. betting display components) |
| [context/COMPONENTS_INDEX.md](context/COMPONENTS_INDEX.md) | The full index of `src/components/` — props, purpose, mount pattern, and shared conventions for every reusable component, grouped by domain. **Check before building any new UI for a screen** |
| [context/betting-line-board.md](context/betting-line-board.md) | The Place Bets line board — the market-type-agnostic stack, data shapes, seam helpers, the recipe for adding a new market type to the UI, and the **UI policy hiding the "under" side** (social-dynamics reason; mechanic preserved in the DB/RPC layer) |
| [context/playoff-draft.md](context/playoff-draft.md) | The **Playoff Draft** — captains drafting playoff teams live (4 `playoff_draft*` tables, derived snake/straight turn engine, `playoff_*` RPCs, realtime draft room, materialization into `teams`/`team_slots`). Read before touching any `playoff_*` code |
| [context/patterns.md](context/patterns.md) | Key patterns (useMemo, pull-to-refresh, toasts-in-modals, optimistic edits, admin flows) and the theme system (colors / fonts / radius) |
| [context/file-map.md](context/file-map.md) | The full `app/` source tree with a one-line note per file |
| [context/agent-rules.md](context/agent-rules.md) | The full text of the hard constraints above (incl. CLI commands, migration workflow) + additional agent notes (auth layer, `useRefresh`, hook exports) |
| [context/page-creation.md](context/page-creation.md) | The page-creation blueprint — the four-layer stack (migration → `db/` → hook → screen → navigation), type/schema-snapshot regeneration commands, screen skeleton + theme tokens, and the end-to-end checklist. Always reference when adding/editing a screen or making schema changes. |

## Cross-cutting systems ([context/](context/))

| File | Read it when you need… |
|---|---|
| [context/archive-and-settlement.md](context/archive-and-settlement.md) | The **Archive & Settlement engine** — the weekly clock tick, now split into `advance_week` (bowl-night: lock + snapshot fills + open N+1, **no money**) and `settle_week` (next-day: all money incl. folded-in LaneTalk props + unified House P/L, snapshot captured at settle), each with its idempotency guard + the narrowed backstop; the two reversal paths (`unsettle_week` = money-only, week stays locked; phase-branched `unarchive_week` = full reversal, `bowled_at` preserved); `preview_settle_week`; `archive_week`/`settle_lanetalk_props_for_week` deprecated shims; the pre-archive integrity layer (per-game participation, line-eligibility ladder, coupling triggers, refund-on-market-death), and the **recipes for adding a new settle-time feature or debugging a discrepancy**. Read before touching `advance_*`/`settle_*`/`unsettle_*`/`unarchive_*`/`sync_*markets*` code or any feature that settles at settle time. |
| [context/db-verification.md](context/db-verification.md) | The **DB rollback-probe suite** — assertion-grade tests of the economy RPCs against the live DB with zero persistence (fixture synthesis, claims impersonation, double-entry/back-link invariants, admin-guard negatives), plus the RLS catalog differ and anon posture assertion. **Read before touching any economy RPC or RLS policy.** |
| [context/notifications.md](context/notifications.md) | The Pinsino **notification framework** — per-tile pending-action badges + the aggregate Pinsino tab-bar badge. Read before adding a notification count to any Pinsino tile. |
| [context/push-broadcasts.md](context/push-broadcasts.md) | **Push Broadcasts** — real iOS push notifications: the admin composer (send-now / scheduled / targeted), user opt-out (master + per-category; **opt-out always wins**, enforced server-side via the single `broadcast_recipients` predicate), the `send-broadcasts` Edge Function, the pg_cron+pg_net tick, Vault secrets, and the **automated event-driven pushes** (Market Moves → push coupling: `broadcast_event_rules` + the feed trigger + admin-editable templates). Read before touching any `broadcast_*` / `push_*` code. NOT the in-app badge framework (that's notifications.md). |
| [context/pinsino-explainers.md](context/pinsino-explainers.md) | The **Pinsino explainer framework** — the single content catalog (`data/pinsinoExplainers.ts`) behind the help screen, per-screen `?` sheets, hub tile hooks, and confirm-sheet `TermsBlock`s, plus the Loan Shark payoff-schedule simulator (`utils/loanSchedule.ts`, `GAMES_PER_WEEK`) and the two-layer voice contract. Read before adding/editing any player-facing mechanic explanation or terms copy. |
| [context/toast.md](context/toast.md) | The global **toast** system — why `<Toast />` is mounted per-screen/per-modal (RN Modal overlay) rather than at the root, and the mount-baseline guard against duplicate toasts during navigation transitions. Read before adding a root Toast or debugging duplicate toasts. |
| [context/activity-feed.md](context/activity-feed.md) | The **Activity Feed ("Market Moves")** framework — how feed rows are published (the `publish_activity_event` transactional helper + catalog), rendered (`activityFeedTemplates.ts`, no stored text), and moderated, plus the **step-by-step recipe for adding a new event type or a new publisher feature**. Read before adding any event to the feed. |
| [context/rsvp-bonus.md](context/rsvp-bonus.md) | The **RSVP self-submit bonus** — a house-funded pin bonus (default 50) paid when a player **personally** RSVPs their own row before a configurable weekly deadline (default 6pm bowl night, ET). The whole design is the **split write path** (own row → `submit_own_rsvp` RPC which pays the bonus; other players → plain `rsvp` upsert, never paid), once-per-(player,week) dedup, submit-time deadline enforcement, and the `rsvp_bonus_config` admin-editable config. Read before touching `submit_own_rsvp` / `rsvp_bonus*` code. |
| [context/lanetalk-stat-bets.md](context/lanetalk-stat-bets.md) | **LaneTalk stat bets** — frame-stat prop markets (strikes/spares per game, clean frames + first-ball avg per night) on `market_type='prop'`: the stat definitions (**SQL `lanetalk_game_stats` is authoritative for money**; client `stats.ts` seeds/displays only), line generation, the **two-clock settlement model** (archive backstop exemption → "Confirm LaneTalk Data" RPC), the RSVP-coupled server-side line sync, and delete-refund void semantics. Read before touching any LaneTalk prop / `settle_lanetalk_props_*` code. |

## Economy design & feature specs ([context/economy/](context/economy/))

Product/design references and per-feature implementation specs for the pin economy. Read the relevant one before working on that feature; the authoritative *schema* for live betting is `supabase/PIN_ECONOMY_SCHEMA.md` (below), while these are the design rationale + feature handoffs.

| File | Contents |
|---|---|
| [context/economy/PIN_ECONOMY.md](context/economy/PIN_ECONOMY.md) | High-level economic model — how value is created, held, moved, and destroyed |
| [context/economy/ECONOMIC_DESIGN.md](context/economy/ECONOMIC_DESIGN.md) | Design decisions framing the pin-economy expansion (sits alongside `PIN_ECONOMY.md`) |
| [context/economy/ECONOMIC_DESIGN_DEBT.md](context/economy/ECONOMIC_DESIGN_DEBT.md) | Debt & Leverage / Loan Shark feature design |
| [context/economy/ECONOMIC_DESIGN_MERCHANT.md](context/economy/ECONOMIC_DESIGN_MERCHANT.md) | Traveling Merchant / Item Shop feature design |
| [context/economy/ECONOMIC_DESIGN_PvP.md](context/economy/ECONOMIC_DESIGN_PvP.md) | PvP Challenge Contracts feature design |
| [context/economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md](context/economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md) | Activity Feed ("Market Moves") feature design — the public economic newswire |
| [context/economy/ECONOMIC_DESIGN_BOUNTIES.md](context/economy/ECONOMIC_DESIGN_BOUNTIES.md) | Bounty Board feature design — public, pooled, manually-settled bounties on the **"All Comers"** model (flat reward-per-hunter, no dilution, collective win); **v1 House-only** (player-sponsor path gated off for integrity, §3.3) |
| [context/economy/LOAN_SHARK_DB.md](context/economy/LOAN_SHARK_DB.md) | Loan Shark **database** implementation spec (schema + RPCs) — read before touching any `loan_*` DB code |
| [context/economy/LOAN_SHARK_APP.md](context/economy/LOAN_SHARK_APP.md) | Loan Shark **app-layer** implementation spec (`app/src`) |
| [context/economy/PvP_DB.md](context/economy/PvP_DB.md) | PvP Challenge Contracts **database** implementation spec (schema + RPCs) — read before touching any `pvp_*` DB code |
| [context/economy/PvP_APP.md](context/economy/PvP_APP.md) | PvP Challenge Contracts **app-layer** implementation spec (`app/src`) |
| [context/economy/ACTIVITY_FEED_DB.md](context/economy/ACTIVITY_FEED_DB.md) | Activity Feed **database** implementation spec (the `activity_feed_events` table + `publish_activity_event` helper + edits to existing economic RPCs) — read before touching any `activity_feed_*` DB code |
| [context/economy/ACTIVITY_FEED_APP.md](context/economy/ACTIVITY_FEED_APP.md) | Activity Feed **app-layer** implementation spec (the "Market Moves" Pinsino tile) |
| [context/economy/BOUNTIES_DB.md](context/economy/BOUNTIES_DB.md) | Bounty Board **database** implementation spec (the four `bounty_*` tables + `pin_ledger` extension + RPCs + Activity Feed wiring) — read before touching any `bounty_*` DB code. **As-built mechanic = All Comers** (migration `…220000_bounty_all_comers`); **v1 House-only** (`create_sponsor_bounty` revoked, migration `…221500_bounty_house_only_v1`) |
| [context/economy/BOUNTIES_APP.md](context/economy/BOUNTIES_APP.md) | Bounty Board **app-layer** implementation spec (the "Bounties" Pinsino tile) — All Comers payouts; **player "Post a Bounty" CTA hidden in v1** (route/screen/`createSponsor` kept for later) |
| [context/economy/ECONOMIC_DESIGN_SILENT_AUCTIONS.md](context/economy/ECONOMIC_DESIGN_SILENT_AUCTIONS.md) | Silent Auctions feature design — sealed pledge bids, check-bounce settlement, the auctionable-asset taxonomy |
| [context/economy/AUCTION_FINDINGS.md](context/economy/AUCTION_FINDINGS.md) | Silent Auctions **decision record** (grilling sessions) — bid mechanics overrides, item-framework doctrine (atomic single-use items), week-stamping + archive exemption, encryption posture, all-RPC writes |
| [context/economy/SILENT_AUCTIONS_DB.md](context/economy/SILENT_AUCTIONS_DB.md) | Silent Auctions + item framework **database** spec (as built) — `auctions`/`auction_bids`/`item_catalog`/`player_inventory_items`, encrypted bids, pg_cron sweep, Golden Ticket hooks. Read before touching any `auction_*` / `item_*` DB code |
| [context/economy/SILENT_AUCTIONS_APP.md](context/economy/SILENT_AUCTIONS_APP.md) | Silent Auctions **app-layer** spec (the "Auction House" Pinsino tile) — sealed-bid display contract, Golden Ticket toggle, badge + feed wiring |
| [context/economy/GHOST_IN_THE_SLIP.md](context/economy/GHOST_IN_THE_SLIP.md) | **Ghost in the Slip** — the first ADVERSARIAL item: secretly haunt another player's pending bet; on a win the ghosts split the profit and the bettor keeps only their stake (House-neutral). The `bet_haunts` link table + RLS reveal-on-win, `haunt_bet` RPC, the `finalize_bets_for_market` diversion + `bet_haunt_steal` ledger type, cancel-refund, and the `BetDetailModal` CTA/reveal. Read before touching any `haunt`/`bet_haunts` code |

## External source-of-truth docs

- **Betting / pin economy schema:** [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) — authoritative for `pin_ledger`, the canonical betting tables, accounting/lifecycle, every RPC, RLS, and how to add a bet type. Read before touching any `bet_*` / `pin_ledger` code.
- **Auth:** [supabase/AUTH.md](supabase/AUTH.md) — JWT hook, trigger, RLS patterns, role management.
