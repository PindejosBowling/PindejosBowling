# Page Creation & Agent Rules

## Page Creation

You must ALWAYS reference [page-creation.md](page-creation.md) when working on new pages or editing existing pages.

It contains hook patterns, screen skeleton, navigation wiring, database migration workflow, and type regeneration. Follow it when adding any new screen or making schema changes.

---

## Important Notes for Agents

1. **All data comes from Supabase.**

2. **All database queries MUST be implemented in `db.ts`.** Queries like `scores.listForStandings()` join the right tables in one round-trip. Avoid building ad-hoc joins from raw `supabase` client calls; add a new method to `db.ts` if needed.

3. **Archived = historical.** All stat computation queries filter `is_archived = true`. The current/active week is identified by `is_archived = false` (and `is_confirmed = true` for live scoring).

4. **Compute functions are pure.** Functions like `computeStandingsFromSupabase` scan full data arrays on every call with no caching. Always wrap in `useMemo` at the screen level.

5. **Hook files export both the hook and compute functions.** If you need the derived data type shape, import it from the hook file (e.g. `StandingsRow` from `useStandingsData.ts`).

6. **No memoization inside hooks or compute functions.** Caching is the screen's responsibility via `useMemo`.

7. **All source files are TypeScript.** Screens, hooks, and utilities are fully typed `.ts`/`.tsx`.

8. **App layer has no test suite** — verify manually via the Expo dev server
   (`expo start`). **The DB layer DOES have one:** the rollback-probe suite,
   `./supabase/verify/run-all-probes.sh` — real RPC flows executed against the
   live DB inside always-aborting transactions (zero persistence), with
   assertions on balances, statuses, back-links, and the double-entry
   invariant. Run it before AND after pushing any migration that touches
   economy RPCs (`loan_*`/`pvp_*`/`bet_*`/`bounty_*`/settlement); for pure
   refactors also diff the PROBE_RESULT captures (byte-identical = behavior
   preserved). Full reference: [db-verification.md](db-verification.md).

9. **Auth layer is active.** Phone OTP login is required. User identity is derived from `auth.users` and linked to `players` via `players.user_id`. The `useAuthStore` exposes `userId`, `playerId`, `playerName`, and `role`. See [supabase/AUTH.md](../supabase/AUTH.md) for the full architecture — JWT hook, trigger, RLS patterns, and role management.

10. **`useRefresh` requires a function argument.** Pass the `reload` from the screen's data hook: `useRefresh(reload)`. It is not bound to a global store refresh.

11. **Supabase CLI requires `SUPABASE_ACCESS_TOKEN` — no MCP server is configured.** Always load the token from `app/.env.local` and use `--linked` with `--workdir` pointing to the repo root. Never run `supabase` commands without this setup or they will fail with 401.

  ```bash
  SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2) \
    supabase db query --linked --workdir $(pwd) \
    "SELECT ..."
  ```
  Project ref: `lyihsvxraurjghjqxaau` — URL: `https://lyihsvxraurjghjqxaau.supabase.co`

12. **ALL database changes MUST go through migration files — never write to the database directly.** This is a hard rule with no exceptions. Every schema change (DDL: `CREATE`, `ALTER`, `DROP`, index additions, RLS policy changes, trigger changes, etc.) MUST be written as a `.sql` file in `supabase/migrations/` and applied via `supabase db push`. The Supabase CLI may ONLY be used for two purposes:
    - **Reading** — `supabase db query` to inspect the current database state and confirm schema or data.
    - **Pushing migrations** — `supabase db push` to apply a migration file you have already written to `supabase/migrations/`.

  Never use `supabase db query` (or any other tool) to execute `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, or any other write statement against the live database. If a change needs to be made, write a migration file first.

  **Creating a migration file:** Always use the CLI to generate the file — never create it manually. This ensures the timestamp prefix is correct and consistent:
  ```bash
  SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2) \
    supabase migration new short_description --workdir $(pwd)
  ```
  This creates an empty `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql` file. Write your SQL into that file, then push it. **`--workdir` must be the repo root** (`migration new` writes to `<workdir>/supabase/migrations/`) — pointing it at `supabase/migrations` nests the file at `supabase/migrations/supabase/migrations/`.

  **To apply a migration:**
  ```bash
  SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' app/.env.local | cut -d'=' -f2) \
    supabase db push --linked --workdir $(pwd)
  ```

  **Why:** Migration files are version-controlled and reversible. Direct writes bypass this safety net and make schema drift impossible to track or roll back.

  **Migrations are history, not current state — read `supabase/schema.sql` instead.** The `supabase/migrations/` directory is an append-only log of *changes over time*. After 100+ migrations, a large fraction of them describe schema that was later renamed, dropped, or retyped (e.g. `players.name` → split into `first_name`/`last_name`, integer season ids → `uuid`, dropped `scores.game_number` and legacy team columns). **Reading or grepping individual migration files to answer "what does table X look like now?" is a known source of stale, wrong answers.** For the current schema:
  - **[`supabase/schema.sql`](../supabase/schema.sql)** — a generated, single-file snapshot of the live `public` schema (tables, constraints, indexes, RLS policies, functions, triggers). This is the source of truth for *current* DDL. It is **machine-generated — never hand-edit it.** Regenerate it (no Docker required) as the last step of every `supabase db push`:
    ```bash
    ./supabase/refresh-schema-snapshot.sh
    ```
    (The generator query lives in `supabase/schema-snapshot.gen.sql`; the script reads the live DB via `supabase db query --linked` and writes `supabase/schema.sql`.)
  - **[context/database-schema.md](database-schema.md)** and **[supabase/PIN_ECONOMY_SCHEMA.md](../supabase/PIN_ECONOMY_SCHEMA.md)** — the prose layer (invariants, distinctions, rationale) that the raw DDL doesn't capture.

  Only open a migration file to understand *history* (when/why something changed) or when authoring a new one.

13. **"Current season" ≠ highest `number`.** The current season is `is_active = true` AND `registration_open = false` — query it with `seasons.getCurrent()`. `seasons.getLatest()` (highest `number`) exists only to compute the *next* season number; using it for "current" mis-selects a season that is still in registration. Stats season lists exclude in-registration seasons (`!registration_open`). At most one season can be `is_active` (enforced by the `seasons_single_active` partial unique index).

14. **All ids are `uuid` / TypeScript `string`.** No table uses integer/sequence keys. When adding season-related code, season ids and `season_id` are `string`.
