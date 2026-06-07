# PindejosBowling Native — Agent Reference

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
| [context/betting-line-board.md](context/betting-line-board.md) | The Place Bets line board — the market-type-agnostic stack, data shapes, seam helpers, and the recipe for adding a new market type to the UI |
| [context/patterns.md](context/patterns.md) | Key patterns (useMemo, pull-to-refresh, toasts-in-modals, optimistic edits, admin flows) and the theme system (colors / fonts / radius) |
| [context/file-map.md](context/file-map.md) | The full `app/` source tree with a one-line note per file |
| [context/agent-rules.md](context/agent-rules.md) | Page-creation workflow + the numbered hard rules for agents (migrations-only DB changes, Supabase CLI usage, "current season", uuid ids, etc.) |

## Cross-cutting systems ([references/](references/))

| File | Read it when you need… |
|---|---|
| [references/notifications.md](references/notifications.md) | The Pinsino **notification framework** — per-tile pending-action badges + the aggregate Pinsino tab-bar badge. Read before adding a notification count to any Pinsino tile. |

## Economy design & feature specs ([context/economy/](context/economy/))

Product/design references and per-feature implementation specs for the pin economy. Read the relevant one before working on that feature; the authoritative *schema* for live betting is `supabase/PIN_ECONOMY_SCHEMA.md` (below), while these are the design rationale + feature handoffs.

| File | Contents |
|---|---|
| [context/economy/PIN_ECONOMY.md](context/economy/PIN_ECONOMY.md) | High-level economic model — how value is created, held, moved, and destroyed |
| [context/economy/ECONOMIC_DESIGN.md](context/economy/ECONOMIC_DESIGN.md) | Design decisions framing the pin-economy expansion (sits alongside `PIN_ECONOMY.md`) |
| [context/economy/ECONOMIC_DESIGN_DEBT.md](context/economy/ECONOMIC_DESIGN_DEBT.md) | Debt & Leverage / Loan Shark feature design |
| [context/economy/ECONOMIC_DESIGN_MERCHANT.md](context/economy/ECONOMIC_DESIGN_MERCHANT.md) | Traveling Merchant / Item Shop feature design |
| [context/economy/ECONOMIC_DESIGN_PvP.md](context/economy/ECONOMIC_DESIGN_PvP.md) | PvP Challenge Contracts feature design |
| [context/economy/LOAN_SHARK_DB.md](context/economy/LOAN_SHARK_DB.md) | Loan Shark **database** implementation spec (schema + RPCs) — read before touching any `loan_*` DB code |
| [context/economy/LOAN_SHARK_APP.md](context/economy/LOAN_SHARK_APP.md) | Loan Shark **app-layer** implementation spec (`app/src`) |
| [context/economy/PvP_DB.md](context/economy/PvP_DB.md) | PvP Challenge Contracts **database** implementation spec (schema + RPCs) — read before touching any `pvp_*` DB code |
| [context/economy/PvP_APP.md](context/economy/PvP_APP.md) | PvP Challenge Contracts **app-layer** implementation spec (`app/src`) |

## External source-of-truth docs

- **Betting / pin economy schema:** [supabase/PIN_ECONOMY_SCHEMA.md](supabase/PIN_ECONOMY_SCHEMA.md) — authoritative for `pin_ledger`, the canonical betting tables, accounting/lifecycle, every RPC, RLS, and how to add a bet type. Read before touching any `bet_*` / `pin_ledger` code.
- **Auth:** [supabase/AUTH.md](supabase/AUTH.md) — JWT hook, trigger, RLS patterns, role management.
- **Page creation:** [PAGE_CREATION.md](PAGE_CREATION.md) — always reference when adding/editing a screen or making schema changes.

## Hard rules (full text in [context/agent-rules.md](context/agent-rules.md))

1. All data comes from Supabase; all queries live in `db.ts`.
2. **ALL database changes go through migration files** applied via `supabase db push` — never write to the DB directly. The Supabase CLI is for reading (`db query`) and pushing migrations only.
3. The Supabase CLI needs `SUPABASE_ACCESS_TOKEN` from `app/.env.local` + `--linked --workdir $(pwd)`.
4. "Current season" = `is_active = true` AND `registration_open = false` (`seasons.getCurrent()`), **not** highest number.
5. Compute functions are pure and uncached — always wrap them in `useMemo` at the screen level.
6. All ids are `uuid` / TypeScript `string`. No test suite — verify via `expo start`.
