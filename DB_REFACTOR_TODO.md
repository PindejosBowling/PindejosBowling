# DB_REFACTOR_TODO — `db.ts` Split & Query-Layer Cleanup

> **For the executing agent.** This is a phased, self-contained work order for breaking the
> 1,755-line `app/src/utils/supabase/db.ts` god-file into per-domain modules **without changing any
> behavior or any consumer import path**. Phase 1 is a pure, mechanical code-move and is the whole
> point of this project. Phases 2–3 are optional, behavior-sensitive cleanups — do them only in
> separate PRs, after Phase 1 lands, with the extra guardrails noted.

## Objective

`db.ts` is disciplined and internally consistent (37 per-table objects, 276 methods, uniform
`{ data, error }` thenable contract) — it is not *messy*, it is just *large*. The objects already
cluster into four domains with **essentially zero cross-references** between clusters (the only glue
is 6 module-private select-graph string constants, each used within a single domain). That makes a
clean split low-risk and high-value for navigability.

**Scope discipline:** this is a **presentation-of-code** refactor, not a data-model change.
- ❌ Do NOT touch `supabase/migrations/`, `supabase/schema.sql`, or any DB DDL/RPC.
- ❌ Do NOT change method signatures, method bodies, or the `{ data, error }` return contract in
  Phase 1.
- ❌ Do NOT change any consumer import path. **84 files** import named exports from
  `'…/utils/supabase/db'` (e.g. `import { seasons, weeks } from '../utils/supabase/db'`). The barrel
  makes every one of those keep resolving unchanged.

## Hard rules

1. **App layer has NO test suite.** The mechanical gate for every phase is
   `cd app && npx tsc --noEmit` (must stay green — it proves all 84 consumers still resolve every
   named export). The runtime gate is the Expo dev server (`cd app && npx expo start`).
2. **Phase 1 is a pure move.** Every moved method body must be byte-identical to before. Verify with
   `git diff --color-moved=zebra` — the diff should show moves, not edits. If `tsc` is green and the
   diff is pure motion, Phase 1 is correct by construction.
3. **Behavior-sensitive phases (2–3) are OPT-IN and settlement-adjacent.** The market-status methods
   run during Start-Game / reopen flows. Verify those flows in Expo, not just `tsc`.
4. **One phase = one PR.** Do not fold Phase 2/3 cleanups into the Phase 1 move PR — it would hide
   behavior changes inside a giant move diff.

## Ground truth — current layout of `db.ts`

Header imports (lines 1–3): `supabase` from `./client`; `TablesInsert, TablesUpdate, Json` from
`./database.types`; `HIGHLIGHT_EVENT_TYPES` from `../activityFeedTemplates`.

37 export objects + 6 module-private constants, by line:

| Line | Symbol | Target module |
|---|---|---|
| 5 | `boardPosts` | infra |
| 17 | `games` | league |
| 46 | `players` | league |
| 74 | `avatars` | league |
| 85 | `registrations` | league |
| 98 | `rsvp` | league |
| 128 | `rsvpBonusConfig` | league |
| 136 | `scores` | league |
| 260 | `seasonChampions` | league |
| 276 | `seasons` | league |
| 335 | `teams` | league |
| 348 | `teamSlots` | league |
| 395 | `const MARKET_GRAPH` | economy (private) |
| 398 | `const LEG_GRAPH` | economy (private) |
| 401 | `betMarkets` | economy |
| 631 | `bets` | economy |
| 692 | `haunts` | economy |
| 716 | `customLines` | economy |
| 738 | `loanProducts` | economy |
| 747 | `loans` | economy |
| 788 | `loanLedger` | economy |
| 816 | `pinLedger` | economy |
| 858 | `bonuses` | economy |
| 902 | `const CHALLENGE_PARTIES` | economy (private) |
| 906 | `pvpChallenges` | economy |
| 1009 | `pvpLedger` | economy |
| 1024 | `const BOUNTY_SPONSOR` | economy (private) |
| 1036 | `bountyPosts` | economy |
| 1102 | `bountyLedger` | economy |
| 1115 | `const AUCTION_GRAPH` | economy (private) |
| 1130 | `auctions` | economy |
| 1183 | `auctionHouseState` | economy |
| 1201 | `auctionLedger` | economy |
| 1218 | `itemCatalog` | economy |
| 1250 | `inventoryItems` | economy |
| 1286 | `const FEED_GRAPH` | infra (private) |
| 1297 | `activityFeed` | infra |
| 1348 | `weeks` | league |
| 1415 | `archives` | league |
| 1465 | `playoffDrafts` | playoffs |
| 1585 | `lanetalkImports` (+ `invokeLanetalk` helper, ~1570) | infra |
| 1655 | `push` | infra |
| 1699 | `broadcasts` | infra |
| 1740 | `broadcastEventRules` | infra |

Resulting module sizes (approx): **economy ~900 lines**, **league ~450**, **infra ~250**,
**playoffs ~120**.

Each of the 6 `const …_GRAPH`/`…_PARTIES`/`…_SPONSOR` constants is module-private (not exported) and
referenced only by objects in its own domain — move each into the same file as its consumer.

---

## Phase 1 — The split (pure code-move) — REQUIRED

**Goal:** convert `utils/supabase/db.ts` into a directory of per-domain modules behind a barrel, so
consumer imports never change.

**Target structure:**
```
app/src/utils/supabase/
  db/
    index.ts        # barrel: re-exports everything (see below)
    league.ts       # games, players, avatars, registrations, rsvp, rsvpBonusConfig,
                    #   scores, seasonChampions, seasons, teams, teamSlots, weeks, archives
    economy.ts      # betMarkets(+MARKET_GRAPH,LEG_GRAPH), bets, haunts, customLines,
                    #   loanProducts, loans, loanLedger, pinLedger, bonuses,
                    #   pvpChallenges(+CHALLENGE_PARTIES), pvpLedger,
                    #   bountyPosts(+BOUNTY_SPONSOR), bountyLedger,
                    #   auctions(+AUCTION_GRAPH), auctionHouseState, auctionLedger,
                    #   itemCatalog, inventoryItems
    infra.ts        # boardPosts, activityFeed(+FEED_GRAPH), lanetalkImports(+invokeLanetalk),
                    #   push, broadcasts, broadcastEventRules
    playoffs.ts     # playoffDrafts
  # db.ts is DELETED (its path now resolves to db/index.ts)
```
> Metro/TS resolve `'…/supabase/db'` to `db/index.ts` once `db.ts` is gone — so keep `db.ts` and the
> `db/` directory from coexisting (that is an ambiguous-resolution trap). Delete `db.ts` in the same
> commit that adds `db/`.

**`db/index.ts` barrel:**
```ts
export * from './league'
export * from './economy'
export * from './infra'
export * from './playoffs'
```
This preserves every existing named import AND any `import * as db` namespace usage. Also **move the
public type exports** that currently live in `db.ts` (e.g. `LanetalkImportSummary`, exported
alongside `lanetalkImports`) into their domain module so `import { …, type LanetalkImportSummary }
from '…/supabase/db'` still resolves.

**Import-path adjustment inside the moved files:** files now sit one directory deeper, so update the
three header imports in each domain file to what it actually uses:
- `import { supabase } from '../client'`  (was `./client`)
- `import type { TablesInsert, TablesUpdate, Json } from '../database.types'`  (was `./database.types`)
- `infra.ts` only: `import { HIGHLIGHT_EVENT_TYPES } from '../../activityFeedTemplates'`  (was `../activityFeedTemplates`)

Import into each domain file **only the type symbols it uses** (not all three everywhere) to keep
`tsc`'s no-unused checks quiet.

**Recipe:**
1. Create `db/` with the four domain files; cut each object (and its private graph constant) verbatim
   from `db.ts` into its target file per the table above.
2. Fix the three relative import paths in each file (above).
3. Add `db/index.ts` barrel.
4. Delete `db.ts`.
5. `cd app && npx tsc --noEmit` → green (this is the real proof the barrel surface is complete).
6. `git diff --color-moved=zebra` → confirm method bodies are pure moves, not edits.

**Guardrails / self-checks:**
```bash
cd app/src
# No consumer import path should have changed:
grep -rln "supabase/db'" screens components hooks utils stores | wc -l    # expect ~84, same as before
# No domain module should import another domain module (clusters are independent):
grep -nE "from './(league|economy|infra|playoffs)'" utils/supabase/db/*.ts   # expect: only index.ts
# The 6 private graph consts live with their consumers, exported nowhere:
grep -rn "MARKET_GRAPH\|LEG_GRAPH\|CHALLENGE_PARTIES\|BOUNTY_SPONSOR\|AUCTION_GRAPH\|FEED_GRAPH" utils/supabase/db/
```

**DoD:** `db.ts` gone; four domain files + barrel in place; `tsc` green; move-diff is pure motion;
Expo smoke of one screen per domain (a league screen e.g. Standings, an economy screen e.g.
Sportsbook, an admin/infra screen e.g. Broadcast Admin, and Playoffs) confirms data still loads.

**Docs to update in this PR** (they name the old single-file path):
- `AGENTS.md` — rules #2 and #4 and the context-map row reference `src/utils/supabase/db.ts`; update
  to `src/utils/supabase/db/` (barrel).
- `context/db-queries.md` — note the four-module layout behind the barrel.
- Any other `context/*.md` referencing `db.ts` (grep: `grep -rl "supabase/db.ts" context AGENTS.md`).

---

## Phase 2 — Collapse the duplicated market-status methods — OPTIONAL, settlement-adjacent

**Goal:** de-duplicate three byte-identical async methods in `betMarkets` (in `economy.ts` after
Phase 1). `setOUStatusByWeekGame` (was L505), `setPropStatusByWeekGame` (L537),
`setTeamPropStatusByWeekGame` (L558) differ **only** by the `market_type` literal
(`'over_under'` / `'prop'` / `'team_prop'`). Each: update rows matching week+game+`from`-status, then
if `gameNumber === 1`, repeat for the night rows (`game_number IS NULL`).

**Proposed private helper (in `economy.ts`):**
```ts
const setMarketStatusByWeekGame = async (
  marketType: 'over_under' | 'prop' | 'team_prop',
  weekId: string, gameNumber: number, status: 'open' | 'closed',
) => {
  const from = status === 'closed' ? 'open' : 'closed'
  const res = await supabase.from('bet_markets').update({ status })
    .eq('week_id', weekId).eq('market_type', marketType)
    .eq('game_number', gameNumber).eq('status', from)
  if (res.error || gameNumber !== 1) return res
  return supabase.from('bet_markets').update({ status })
    .eq('week_id', weekId).eq('market_type', marketType)
    .is('game_number', null).eq('status', from)
}
```
Keep the three public methods as thin wrappers (`setOUStatusByWeekGame: (w,g,s) =>
setMarketStatusByWeekGame('over_under', w, g, s)`) so **call sites do not change**.

**⚠️ CRITICAL guardrail — `setMoneylineStatusByWeekGame` (was L525) is NOT interchangeable.** It is a
*synchronous thenable*, has **no** `game_number IS NULL` night-row branch (moneyline has no
night-scoped markets), and returns the query builder directly. Do **not** fold it into the helper —
adding the night-row branch would be a behavior change. Leave it exactly as-is.

**Verification:** `tsc` green; then in Expo, exercise the Start-Game and reopen flows on Matchups and
confirm the O/U, prop, and team-prop boards close/reopen exactly as before (including that a game-1
start also closes the night-scoped lines). This touches live betting state — do not skip the runtime
check.

**DoD:** three methods reduced to wrappers over one helper (~50 lines removed); moneyline untouched;
runtime flows verified.

---

## Phase 3 — Document (optionally normalize) the throw-based edge-fn wrappers — OPTIONAL, low priority

**Finding:** three methods break the uniform `{ data, error }` contract by **throwing** instead of
returning `{ data, error }`, because they wrap `supabase.functions.invoke` (Edge Functions):
- `lanetalkImports.run` and `lanetalkImports.reprocessWeek` (via the `invokeLanetalk` helper, was
  L1570) — now in `infra.ts`.
- `broadcasts.sendNow` (was L1717) — now in `infra.ts`.

Their call sites already `try/catch` (they expect throws), so this is a *consistency* wart, not a
bug. Two acceptable resolutions — pick one, do not leave it ambiguous:
- **(a) Document, don't change (recommended default):** add a short header comment in `infra.ts`
  stating these three are the deliberate exception — Edge-Function wrappers that throw — so the next
  reader knows the `{ data, error }` rule has exactly three exceptions. Zero call-site risk.
- **(b) Normalize:** convert them to return `{ data, error }` and update every call site to
  destructure instead of `try/catch`. Higher risk — requires auditing all callers of
  `lanetalkImports.run` / `reprocessWeek` / `broadcasts.sendNow` (grep them) and verifying the
  LaneTalk import screen + Broadcast Admin send flow in Expo. Only take this if you also standardize
  the error surface end-to-end.

**DoD:** either the exception is documented in `infra.ts` (a), or all three are normalized with every
call site migrated and both flows verified in Expo (b).

---

## Progress tracker

| Phase | Scope | PR | Status |
|---|---|---|---|
| 1 | Split into `db/{league,economy,infra,playoffs}.ts` + barrel; docs | — | ☐ not started |
| 2 | Collapse 3 market-status methods (moneyline excluded) | — | ☐ optional |
| 3 | Document/normalize 3 throw-based edge-fn wrappers | — | ☐ optional |

## Definition of done (whole project)

- `app/src/utils/supabase/db.ts` replaced by `db/` (four domain modules + barrel); no consumer import
  path changed; `cd app && npx tsc --noEmit` green.
- Phase 1 diff is pure code-motion (verified with `--color-moved`).
- `AGENTS.md` + `context/db-queries.md` (+ any other `context/*.md` naming `db.ts`) updated to the
  barrel layout.
- If Phase 2 taken: market-status methods de-duplicated with moneyline untouched and Start-Game /
  reopen flows verified in Expo.
- If Phase 3 taken: the three edge-fn wrappers are either documented as the contract exception or
  fully normalized with call sites migrated.
