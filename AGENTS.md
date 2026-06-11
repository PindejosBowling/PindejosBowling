# PindejosBowling Native — Agent Reference

## ⛔ HARD CONSTRAINTS — read first, no exceptions

Every agent working in this codebase MUST follow these rules. They override any default behavior. Full text + commands in [context/agent-rules.md](context/agent-rules.md).

1. **Migrations only.** ALL database changes go through `.sql` files in `supabase/migrations/` applied via `supabase db push`. NEVER execute `INSERT`/`UPDATE`/`DELETE`/DDL directly against the live database. The Supabase CLI is for exactly two things: reading (`db query`) and pushing migrations (`db push`).
2. **Never read migrations to learn the current schema.** Migration files are append-only *history* full of since-superseded DDL. Current-state DDL lives in [supabase/schema.sql](supabase/schema.sql) (generated snapshot — never hand-edit; regenerate with `./supabase/refresh-schema-snapshot.sh` as the last step of every push). Schema prose/invariants: [context/database-schema.md](context/database-schema.md) and [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md). Only open a migration to understand history or to author a new one.
3. **Supabase CLI setup.** Every `supabase` command needs `SUPABASE_ACCESS_TOKEN` loaded from `app/.env.local` plus `--linked --workdir $(pwd)` — otherwise it fails with 401. No MCP server is configured.
4. **All data comes from Supabase; all queries live in `db.ts`.** Never build ad-hoc joins from raw `supabase` client calls — add a method to `src/utils/supabase/db.ts`.
5. **"Current season" ≠ highest number.** It is `is_active = true` AND `registration_open = false` — always `seasons.getCurrent()`, never `getLatest()`.
6. **Compute functions are pure and uncached.** Always wrap them in `useMemo` at the screen level; no memoization inside hooks or compute functions.
7. **All ids are `uuid` / TypeScript `string`.** No integer keys anywhere.
8. **No test suite.** Verify behavior via the Expo dev server (`expo start`).
9. **This `AGENTS.md` is an INDEX, never a content file.** Reference material lives in self-contained markdown files under [context/](context/), one file per domain — `AGENTS.md` holds only a one-line table row per file plus these rules. When documenting a finding, pattern, or system: prefer updating the existing `context/*.md` file; otherwise create a new `context/<domain>.md` and add a row linking to it in the matching table below. Never paste reference content into `AGENTS.md`, and never reintroduce a `references/` directory.

## Project overview

React Native / Expo app for a recreational bowling league called "Pindejos." Players track weekly matchups, scores, standings, RSVPs, and historical stats. The sole backend is a Supabase Postgres database accessed via typed query objects in `src/utils/supabase/db.ts`.

This file is an **index**. The detailed reference is split across [context/](context/) — read the file relevant to your task rather than loading everything. Each file is self-contained.

## Context map

| File | Read it when you need… |
|---|---|
| [context/tech-stack.md](context/tech-stack.md) | Project overview, tech stack / versions, how to run, the Supabase client + data-layer file locations |
| [context/database-schema.md](context/database-schema.md) | The 21-table schema, column lists, and the key invariants/distinctions (teams/weeks ownership, season lifecycle, cascades, betting + loan tables) |
| [context/db-queries.md](context/db-queries.md) | The `db.ts` typed query objects — every method per table (always query through these, never raw client joins) |
| [context/data-architecture.md](context/data-architecture.md) | The hook + compute-function pattern, archived-vs-live data, standings computation, the full hooks table, and pure utilities (`helpers.ts`) |
| [context/ui-system.md](context/ui-system.md) | Player badges, the four Zustand stores, navigation architecture (tabs + stacks + routes), and the component inventory (incl. betting display components) |
| [context/COMPONENTS_INDEX.md](context/COMPONENTS_INDEX.md) | The full index of `src/components/` — props, purpose, mount pattern, and shared conventions for every reusable component, grouped by domain. **Check before building any new UI for a screen** |
| [context/betting-line-board.md](context/betting-line-board.md) | The Place Bets line board — the market-type-agnostic stack, data shapes, seam helpers, the recipe for adding a new market type to the UI, and the **UI policy hiding the "under" side** (social-dynamics reason; mechanic preserved in the DB/RPC layer) |
| [context/patterns.md](context/patterns.md) | Key patterns (useMemo, pull-to-refresh, toasts-in-modals, optimistic edits, admin flows) and the theme system (colors / fonts / radius) |
| [context/file-map.md](context/file-map.md) | The full `app/` source tree with a one-line note per file |
| [context/agent-rules.md](context/agent-rules.md) | The full text of the hard constraints above (incl. CLI commands, migration workflow) + additional agent notes (auth layer, `useRefresh`, hook exports) |
| [context/page-creation.md](context/page-creation.md) | The page-creation blueprint — the four-layer stack (migration → `db.ts` → hook → screen → navigation), type/schema-snapshot regeneration commands, screen skeleton + theme tokens, and the end-to-end checklist. Always reference when adding/editing a screen or making schema changes. |

## Cross-cutting systems ([context/](context/))

| File | Read it when you need… |
|---|---|
| [context/archive-and-settlement.md](context/archive-and-settlement.md) | The **Archive & Settlement engine** — the weekly economy clock tick: `archive_week` (atomic snapshot → lock → settle → next week), every settlement step + its idempotency guard, the no-pending-bets backstop (force semantics), `unarchive_week` (single-mode reversal: settlement reversed + week reopened), the pre-archive integrity layer (per-game participation, line-eligibility ladder, coupling triggers, refund-on-market-death), and the **recipes for adding a new archive-settled feature or debugging a settlement discrepancy**. Read before touching `archive_*` / `settle_*` / `sync_*markets*` code or any feature that settles at archive time. |
| [context/notifications.md](context/notifications.md) | The Pinsino **notification framework** — per-tile pending-action badges + the aggregate Pinsino tab-bar badge. Read before adding a notification count to any Pinsino tile. |
| [context/toast.md](context/toast.md) | The global **toast** system — why `<Toast />` is mounted per-screen/per-modal (RN Modal overlay) rather than at the root, and the mount-baseline guard against duplicate toasts during navigation transitions. Read before adding a root Toast or debugging duplicate toasts. |
| [context/activity-feed.md](context/activity-feed.md) | The **Activity Feed ("Market Moves")** framework — how feed rows are published (the `publish_activity_event` transactional helper + catalog), rendered (`activityFeedTemplates.ts`, no stored text), and moderated, plus the **step-by-step recipe for adding a new event type or a new publisher feature**. Read before adding any event to the feed. |
| [context/lanetalk-stat-bets.md](context/lanetalk-stat-bets.md) | **LaneTalk stat bets** — frame-stat prop markets (strikes/spares per game, clean% + first-ball avg per night) on `market_type='prop'`: the stat definitions (**SQL `lanetalk_game_stats` is authoritative for money**; client `stats.ts` seeds/displays only), line generation, the **two-clock settlement model** (archive backstop exemption → "Confirm LaneTalk Data" RPC), delete-refund void semantics, and the no-roster-coupling caveat. Read before touching any LaneTalk prop / `settle_lanetalk_props_*` code. |

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

## External source-of-truth docs

- **Betting / pin economy schema:** [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) — authoritative for `pin_ledger`, the canonical betting tables, accounting/lifecycle, every RPC, RLS, and how to add a bet type. Read before touching any `bet_*` / `pin_ledger` code.
- **Auth:** [supabase/AUTH.md](supabase/AUTH.md) — JWT hook, trigger, RLS patterns, role management.
