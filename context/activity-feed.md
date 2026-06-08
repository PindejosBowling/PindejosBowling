# Activity Feed ("Market Moves") — how it works + how to add events

The **Activity Feed** is the league's public economic newswire, surfaced as the
**"Market Moves"** Pinsino tile. Every feed-worthy economic action (a big bet, a parlay
hitting, a loan, the House's weekly P&L) writes one narrative row, and the app renders it
into playful, public-safe copy. **This doc is the operational reference for the live
system and — most importantly — the step-by-step recipe for adding new event types as
future features ship.** Read it before touching anything named `activity_feed_*`,
`publish_activity_event`, or `activityFeedTemplates`.

Source-of-truth specs (read for full rationale): the design is
[economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md](economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md); the
DB handoff is [economy/ACTIVITY_FEED_DB.md](economy/ACTIVITY_FEED_DB.md); the app handoff
is [economy/ACTIVITY_FEED_APP.md](economy/ACTIVITY_FEED_APP.md). This file is the durable
"how it fits together + how to extend" overview those specs don't provide.

---

## Core principles (do not break these)

1. **The feed is NOT the ledger.** It never moves pins, never touches `pin_ledger`, and
   never participates in the conservation invariant. It is read-derived narrative only.
2. **No rendered text is ever stored.** A row carries a `template_key` + a league-safe
   `public_payload` (snapshot values). Copy is rendered at read time in
   [app/src/utils/activityFeedTemplates.ts](../app/src/utils/activityFeedTemplates.ts)
   from the *current* joined player names + the payload. This means tone/wording can
   change without rewriting historical rows.
3. **One validated write path.** Every row is written by the internal
   `publish_activity_event(...)` SECURITY DEFINER helper, `PERFORM`ed from inside the
   source action's own RPC **in the same transaction**. No feature inserts feed rows
   directly; the helper has EXECUTE revoked from everyone.
4. **Relational, not polymorphic.** Each row links to its source via a concrete nullable
   FK column (`sportsbook_bet_id`, `loan_id`, …) — never a `source_type`/`source_id`
   pair. `ON DELETE CASCADE` means cancelling the source action auto-deletes its feed row.
5. **Privacy + safety baked in.** Loan copy exposes **no amounts**; feed lines avoid
   subject/market targeting ("{actor} placed a ticket", never "{actor} bet the under on
   {subject}"). Suppressed and `admin_only` rows never reach non-admin clients (RLS).
6. **Forward-compatible by construction.** A newer server publisher can post an
   `event_type`/`template_key` an older client has never seen; `renderFeedEvent`'s
   `default` branch renders a safe generic line instead of crashing.

---

## Data flow (end to end)

```
source RPC (place_house_bet / settle_market_internal / take_loan / repay_loan /
            settle_betting_for_week / accept_pvp_challenge / settle_pvp_challenge)
   │  PERFORM public.publish_activity_event(...)   ← same transaction
   ▼
activity_feed_events  (one row; template_key + public_payload + concrete source FK)
   │  db.ts activityFeed.listPublic / listByFeature / listHighlights  (RLS: published+public)
   ▼
useMarketMovesData  → normalizeFeedRow(row)  → FeedEventView   (joins live player names)
   ▼
MarketMovesScreen   → renderFeedEvent(view)  → FeedRenderParts → card UI
```

**Server side** ([supabase/migrations/](../supabase/migrations/), the `20260607170*`
foundation + the `20260607180*` extensions that added placement payout, loan risk tier,
and PvP):
- `activity_feed_events` table — controlled-string CHECK columns (`source_feature`,
  `event_type`, `visibility`, `status`), nullable source FKs
  (`sportsbook_bet_id`, `loan_id`, `pvp_challenge_id`), the `activity_feed_one_source_check`
  (at most one source FK), partial-unique dedup indexes per `(<source_fk>, event_type)`,
  and **tightened RLS** (anon/authenticated read only `published`+`public`; a separate
  admin-read-all policy; admin-only direct writes).
- `publish_activity_event(...)` — validates feature, event_type (against the in-function
  **catalog** `CASE` block), source-FK↔feature consistency, actor requirement, and
  `template_key`; applies the catalog default for **visibility** (importance is **not** a
  DB concept — see the note under the catalog table); inserts with
  `ON CONFLICT DO NOTHING` (idempotent — a re-run RPC never double-posts). The PvP
  migration extended its signature with a trailing `p_pvp_challenge_id uuid DEFAULT NULL`
  (see Recipe B).
- The seven economic RPCs each `PERFORM` the helper after their pin writes:
  `place_house_bet`, `settle_market_internal`, `take_loan`, `repay_loan`,
  `settle_betting_for_week`, `accept_pvp_challenge`, `settle_pvp_challenge`.

**App side**:
- [db.ts](../app/src/utils/supabase/db.ts) `activityFeed` object — keyset-paginated
  (`published_at DESC, id DESC`) public/feature/highlights lists, an admin list, and the
  three admin RPC wrappers (`suppress`, `restore`, `createSystemEvent`). The
  `FEED_GRAPH` select uses **explicit `!fkey` hints** for the three `players` FKs (actor
  / subject / secondary) and pulls `first_name` (+ actor `avatar_path`) live.
- [useMarketMovesData.ts](../app/src/hooks/useMarketMovesData.ts) — fetch + paginate +
  `normalizeFeedRow` → `FeedEventView`. No memo in the hook (project rule).
- [activityFeedTemplates.ts](../app/src/utils/activityFeedTemplates.ts) — `renderFeedEvent`
  switches on `template_key` → `FeedRenderParts` (icon, source label, line, optional pin
  badge, optional winner banner). `FEATURE_META` maps `source_feature` → icon + label.
- [MarketMovesScreen.tsx](../app/src/screens/MarketMovesScreen.tsx) (public, All /
  Sportsbook / Loan Shark / PvP / Highlights filters, privacy-aware tap-through) and
  [MarketMovesAdminScreen.tsx](../app/src/screens/MarketMovesAdminScreen.tsx) (suppress /
  restore / inspect / post system event).

---

## The event catalog (currently live events)

The catalog is the contract between the publisher and the renderer. It is encoded **twice
on purpose** and the two must agree: the authoritative copy is the `CASE` block in
`publish_activity_event` (server validation: defaults, required actor, allowed source FK),
mirrored by the `switch (row.templateKey)` in `renderFeedEvent` (client copy).

| `event_type` | `template_key` | importance | source FK | publisher | `public_payload` |
|---|---|---|---|---|---|
| `sportsbook_bet_placed` | `sportsbook.bet_placed` | low | bet | `place_house_bet` (off in v1) | `{stake, payout, legs}` |
| `sportsbook_parlay_placed` | `sportsbook.parlay_placed` | normal | bet | `place_house_bet` | `{stake, payout, legs}` |
| `sportsbook_big_ticket_placed` | `sportsbook.big_ticket_placed` | highlight | bet | `place_house_bet` | `{stake, payout, legs}` |
| `sportsbook_big_win` | `sportsbook.big_win` | highlight | bet | `settle_market_internal` | `{stake, payout, profit, legs}` |
| `sportsbook_parlay_hit` | `sportsbook.parlay_hit` | highlight | bet | `settle_market_internal` | `{stake, payout, profit, legs}` |
| `sportsbook_weekly_house_result` | `sportsbook.weekly_house_result` | major | none | `settle_betting_for_week` | `{house_net}` |
| `loan_shark_loan_taken` | `loan_shark.loan_taken` | normal | loan | `take_loan` | `{risk_level}` |
| `loan_shark_loan_repaid` | `loan_shark.loan_repaid` | highlight | loan | `repay_loan` (full payoff only) | `{risk_level}` |
| `loan_shark_special_offer` | `loan_shark.special_offer` | normal | none | `create_system_activity_event` | `{}` |
| `pvp_challenge_accepted` | `pvp.challenge_accepted` | normal | pvp | `accept_pvp_challenge` | `{pot, …}` |
| `pvp_challenge_settled` | `pvp.challenge_settled` | highlight | pvp | `settle_pvp_challenge` | `{outcome, pot, …}` |

> **`importance` is app-owned, not a DB column** (as of
> `20260607230000_feed_importance_to_app.sql`). The table no longer has an `importance`
> column and `publish_activity_event` no longer sets one. The `importance` column above is
> the **app** mapping defined by the Market Moves feature in
> [activityFeedTemplates.ts](../app/src/utils/activityFeedTemplates.ts) (`EVENT_IMPORTANCE`
> / `importanceForEvent`), keyed by `event_type`; events not listed there default to
> `normal`. The "Highlights" filter queries by the derived `HIGHLIGHT_EVENT_TYPES`
> (event types mapping to `highlight`/`major`), not by a stored column. Change what counts
> as a highlight by editing that map — no migration needed.
>
> **`public_payload` is always league-safe.** Loan events carry **only** `risk_level` (the
> product's tier: `low`/`medium`/`high`/`extreme`) — never an amount, rate, garnishment,
> product name, or debt (a tier is a vague category, not a number; §11). The renderer
> still falls back to a generic vague line if `risk_level` is absent (older rows).
> Sportsbook placement cards surface `payout` (the "to win" figure), not the stake.
>
> **PvP** was added by `20260607180200_activity_feed_pvp.sql`: a `pvp_challenge_id` source
> FK column, the `pvp` `source_feature`, the two events above, and publish calls in
> `accept_pvp_challenge` / `settle_pvp_challenge`. A settled challenge sets the **actor to
> the winner** so the card can show the gold WINNER banner; `outcome: 'push'` renders a
> neutral draw line. This is the worked example of Recipe B below.

---

## ⭐ Recipe A — add a new event to an EXISTING feature

Use this when the source feature already has a source-FK column on `activity_feed_events`
(e.g. another sportsbook or loan event). **No table change is required.**

1. **DB — register it in the catalog.** Add a `WHEN '<event_type>'` branch to the `CASE`
   block in `publish_activity_event` (new migration that `CREATE OR REPLACE`s the helper),
   setting `default_visibility`, `requires_actor`, `allowed_source_fk`, and the canonical
   `template_key`. Also add the new `event_type` (and `template_key` if you constrain it) to
   the table's `CHECK` constraint via the same or a prior migration. **Importance is set in
   the app, not here** — if the event should surface under Highlights, add it to
   `EVENT_IMPORTANCE` in [activityFeedTemplates.ts](../app/src/utils/activityFeedTemplates.ts).
2. **DB — publish it.** In the source RPC, after the pin/ledger writes and inside the same
   transaction, `PERFORM public.publish_activity_event('<feature>', '<event_type>', …)`.
   Pass the concrete source FK; build a **league-safe** `public_payload` (snapshot the
   numbers you'll render — `jsonb_build_object('stake', …)`) and put operational detail in
   `admin_payload`. The partial-unique index on `(<source_fk>, event_type)` makes a
   re-run idempotent automatically; for a sourceless aggregate, guard with an
   `IF NOT EXISTS (… event_type …)` presence check instead (see `settle_betting_for_week`).
3. **App — render it.** Add a `case '<template_key>':` to `renderFeedEvent` returning a
   `FeedRenderParts` (line + optional `amount` badge). Keep copy short, playful,
   public-safe, non-shaming, and free of the privacy violations in core principle #5.
4. **App (only if you add a filter):** the existing All/feature/Highlights filters already
   pick it up. A new pin badge label or winner banner is just `FeedRenderParts`.
5. **Verify** on a throwaway season per [economy/ACTIVITY_FEED_DB.md](economy/ACTIVITY_FEED_DB.md) §7:
   trigger the source action, confirm exactly one row with the right FK/payload, confirm
   re-running the RPC does not double-post, and confirm the card renders.

## ⭐ Recipe B — add a new PUBLISHER (a brand-new feature: Merchant, PvP, Bounty, …)

Use this when a new feature needs its own source table linked into the feed. **This is
still additive — no schema redesign.** Migration order matters (table change first). The
PvP migration (`20260607180200_activity_feed_pvp.sql`) is the worked, copyable example.

1. **DB — add the source FK column** in a new migration:
   ```sql
   ALTER TABLE public.activity_feed_events
     ADD COLUMN <feature>_<source>_id uuid REFERENCES public.<source_table>(id) ON DELETE CASCADE;
   CREATE INDEX activity_feed_events_<feature>_idx
     ON public.activity_feed_events (<feature>_<source>_id) WHERE <feature>_<source>_id IS NOT NULL;
   CREATE UNIQUE INDEX activity_feed_unique_<feature>_event
     ON public.activity_feed_events (<feature>_<source>_id, event_type) WHERE <feature>_<source>_id IS NOT NULL;
   ```
   Extend `activity_feed_one_source_check` by one `+ (<feature>_<source>_id IS NOT NULL)::int`
   term (drop + re-add the constraint). Add the new `source_feature` value to that column's
   `CHECK`, and the new `event_type` value(s) to the `event_type` `CHECK`.
2. **DB — extend the catalog + helper.** Add the new `event_type` `WHEN` branches to the
   `publish_activity_event` `CASE` block, and add a branch for the new `allowed_source_fk`
   value in the source-FK↔feature consistency block (a hardcoded `IF/ELSIF` over the known
   FKs). **The helper signature must gain the new FK parameter.** Postgres can't
   `CREATE OR REPLACE` with a changed argument list, so follow the PvP pattern exactly:
   `DROP FUNCTION public.publish_activity_event(<old full arg-type list>);` then
   `CREATE FUNCTION …` with the new FK **appended as a trailing parameter with a default**
   (`p_<feature>_<source>_id uuid DEFAULT NULL`) — the `DEFAULT NULL` keeps every existing
   caller (sportsbook/loan/system, which pass the prior arg count) working unchanged. Add
   the new column to the `INSERT`, and **re-issue the `REVOKE EXECUTE … FROM PUBLIC, anon,
   authenticated`** for the new signature (it's a brand-new function object).
3. **DB — publish** from the new feature's RPC (Recipe A step 2).
4. **App — types.** Regenerate `app/src/utils/supabase/database.types.ts` (the
   type-regeneration step in [PAGE_CREATION.md](../PAGE_CREATION.md)) so the new column +
   any RPC signature change are typed.
5. **App — plumb the FK + render:**
   - `db.ts` `FEED_GRAPH` needs no change unless the new feature adds another `players` FK
     (then add a `!fkey`-hinted embed). Add a `listByFeature(seasonId, '<feature>')` call
     site if you want a dedicated filter.
   - `FeedEventView` + `normalizeFeedRow` — add the new `<feature>SourceId` field.
   - `FEATURE_META` — add the feature's `{ icon, sourceLabel }`.
   - `FeedFilter` (in `useMarketMovesData`) + `fetchPage` — add the new filter value if you
     want a tab; wire the filter chip in `MarketMovesScreen`.
   - `renderFeedEvent` — add the `case` for each new `template_key`. Privacy-aware
     tap-through keys off the source FK on the row.
6. **Verify** as in Recipe A, plus confirm the one-source CHECK still rejects two FKs and
   cancelling the new source row cascade-deletes its feed row.

> **Golden rule:** the catalog (`CASE` in `publish_activity_event`) and the renderer
> (`switch` in `activityFeedTemplates.ts`) are two halves of one contract — change them
> together, and keep the `event_type` → `template_key` mapping identical on both sides.

---

## Admin moderation

- `suppress_activity_event(p_event_id, p_reason)` — flips `status='suppressed'` (drops the
  row from the public read policy) and stamps `suppressed_by_admin_id/at/reason`. Does
  **not** touch the source action.
- `restore_activity_event(p_event_id)` — reverses it (only meaningful while the source row
  still exists; a cancelled source already cascade-deleted the feed row).
- `create_system_activity_event(feature, event_type, template_key, public_payload)`
  — admin wrapper over the writer for sourceless announcements (v1: `loan_shark_special_offer`).
  Resolves the current season + latest live week; the writer rejects any `event_type` that
  requires a source FK. (No `importance` arg — a system post's importance is derived from its
  `event_type` in the app like any other event.)

All three are admin-gated, `SECURITY DEFINER`, `SET search_path = ''`, and exposed in
`db.ts` as `activityFeed.suppress / restore / createSystemEvent`.
