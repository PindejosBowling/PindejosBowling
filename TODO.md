# TODO

Follow-ups for the Lanetalk frame-level game stats feature. The current
implementation renders from a **bundled static JSON** ([app/src/data/lanetalk/](app/src/data/lanetalk/))
keyed to a hard-coded player alias. These tasks move it toward production.

## 1. Build player mapping procedure

Map a Lanetalk handle (e.g. `JORDAN-PBL`) to a real league player.

- [ ] Decide the source of truth for the mapping (DB table vs. config).
- [ ] Replace the hard-coded alias registry in [app/src/data/lanetalk/index.ts](app/src/data/lanetalk/index.ts)
      (`['jordan reticker', 'jordan']`) with the real mapping.
- [ ] Define how a Lanetalk session links to a `players` row (handle → player id).
- [ ] Handle unmatched/ambiguous handles (multiple players, no match).
- [ ] Confirm the in-app display name used on `PlayerDetail` so the entry button
      gates correctly (`hasLanetalkSession`).

## 2. Supabase data structure

Persist frame-level game data in Supabase instead of the bundled JSON.

- [ ] Design tables (e.g. `lanetalk_sessions` / `lanetalk_games` / `lanetalk_frames`)
      to hold the parsed shape: session metadata, per-game scores, per-frame
      throws + cumulative score + flags + pin diagrams.
- [ ] Write the migration via `supabase migration new` (never hand-name files);
      regenerate TS types per [context/page-creation.md](context/page-creation.md).
- [ ] Add query methods to `app/src/utils/supabase/db.ts` (no raw client calls).
- [ ] Point `useFrameStatsData` at the DB source (it already returns the
      standard `{ loading, session, reload }` shape for a drop-in swap).
- [ ] Define an ingestion path: run `app/src/scripts/parse_lanetalk.py` →
      insert rows (which fields are stored vs. recomputed on read).
- [ ] Set RLS / access rules for the new tables.
