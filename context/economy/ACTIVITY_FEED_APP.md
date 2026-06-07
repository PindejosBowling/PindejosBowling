# Activity Feed — App Implementation Spec

Handoff spec for the **app layer** (`app/src`) of the Activity Feed feature, surfaced as
a new Pinsino tile **"Market Moves"**.

**Prerequisite:** the database spec (`economy/ACTIVITY_FEED_DB.md`) is fully applied
(`supabase db push`) **and** `app/src/utils/supabase/database.types.ts` has been
regenerated — follow the type-regeneration step in `PAGE_CREATION.md`. These must exist
in the generated types before starting:
- Table `activity_feed_events`.
- RPCs `suppress_activity_event`, `restore_activity_event`,
  `create_system_activity_event`.
- (The publish helper + the edits to `place_house_bet` / `settle_market_internal` /
  `take_loan` / `repay_loan` / `settle_betting_for_week` are server-side only — the app
  never calls the writer directly. Feed rows simply appear as those existing flows run.)

**Read first:** `economy/ECONOMIC_DESIGN_ACTIVITY_FEED.md` (§ refs below point to it) and
the "Pinsino" / "Betting display components" / "notification framework" sections of
`AGENTS.md`. The Loan Shark + PvP app specs (`economy/LOAN_SHARK_APP.md`,
`economy/PvP_APP.md`) are the closest analogs — read them for the worked
hook/screen/wiring/admin patterns. Mirror existing patterns: hook (no memo) → `useMemo`
in the screen, `useRefresh(reload)`, a `<Toast/>` inside every `<Modal>`,
RPC-then-`reload`, admin gate via `useAuthStore(s => s.role) === 'admin'`.

## Scope (v1 — design §20.3/§20.4)
A public, paginated, template-rendered feed screen with **All / Sportsbook / Loan Shark /
Highlights** filters, privacy-aware tap-through, and an admin moderation screen
(suppress / restore / inspect / post-system-event). **No** comments, reactions,
user-authored text, per-user read state, push delivery, algorithmic ranking, weekly
recap cards, notification badge, or `sportsbook_bad_beat` (design §17, §21).

**Pattern templates to copy from:**
- Data hook (fetch → flatten; no memo in hook): `app/src/hooks/usePinsinoData.ts`,
  `usePlayerPinsinoData.ts`.
- List + pull-to-refresh + grouping: `app/src/screens/PlayerPinsinoScreen.tsx`,
  `PastGamesScreen.tsx`.
- Hub screen + tiles: `app/src/screens/PinsinoScreen.tsx`, `PinsinoAdminScreen.tsx`.
- Admin list + action modal (`<Toast/>` inside): `app/src/screens/PinsinoSportsbookScreen.tsx`,
  `app/src/components/SettleBetModal.tsx`.
- Reusable display: `app/src/components/PlayerAvatar.tsx`, `LedgerRow.tsx`,
  `ScreenHeader.tsx`; relative time via `timeAgo` in `app/src/utils/helpers.ts`.
- db.ts query objects + RPC wrappers: `app/src/utils/supabase/db.ts`.

---

## 1. `db.ts` — query objects + RPC wrappers

In `app/src/utils/supabase/db.ts`, add an `activityFeed` query object following the
existing shape (each method returns the supabase query/`rpc` builder; RPC params use the
`p_` prefix). Player display names are joined via explicit `!fkey` hints (three FKs to
`players`, so the hints are **required**), rendered from the live `players` table — names
are **not** snapshotted (§8.4).

```ts
// Feed copy uses first names only ("Garrett placed a ticket"), so the embeds pull
// first_name (+ avatar_path for the actor) rather than full name.
const FEED_GRAPH =
  '*, actor:players!activity_feed_events_actor_player_id_fkey(first_name, avatar_path), ' +
  'subject:players!activity_feed_events_subject_player_id_fkey(first_name), ' +
  'secondary:players!activity_feed_events_secondary_player_id_fkey(first_name)'

export const activityFeed = {
  // Public feed (design §15.1). `cursor` = the last row's { published_at, id }.
  listPublic: (seasonId: string, cursor?: { publishedAt: string; id: string }) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
    if (cursor) q = q.or(
      `published_at.lt.${cursor.publishedAt},` +
      `and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`)
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Feature filter (design §15.2): sourceFeature in ('sportsbook','loan_shark').
  listByFeature: (seasonId: string, sourceFeature: string, cursor?: { publishedAt: string; id: string }) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
      .eq('source_feature', sourceFeature)
    if (cursor) q = q.or(
      `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`)
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Highlights filter (design §15.2): importance in ('highlight','major').
  listHighlights: (seasonId: string, cursor?: { publishedAt: string; id: string }) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
      .in('importance', ['highlight', 'major'])
    if (cursor) q = q.or(
      `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`)
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Admin: every row (any status/visibility) for the season, filterable client-side.
  listAllForAdmin: (seasonId: string) =>
    supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId)
      .order('published_at', { ascending: false }).order('id', { ascending: false }).limit(200),

  suppress: (eventId: string, reason: string) =>
    supabase.rpc('suppress_activity_event', { p_event_id: eventId, p_reason: reason }),
  restore: (eventId: string) =>
    supabase.rpc('restore_activity_event', { p_event_id: eventId }),
  createSystemEvent: (args: {
    sourceFeature: 'system' | 'admin'; eventType: string; templateKey: string;
    publicPayload: Record<string, unknown>; importance: string }) =>
    supabase.rpc('create_system_activity_event', {
      p_source_feature: args.sourceFeature, p_event_type: args.eventType,
      p_template_key: args.templateKey, p_public_payload: args.publicPayload,
      p_importance: args.importance }),
}
```

> Confirm the exact FK-constraint names for the `actor:`/`subject:`/`secondary:` embeds
> against the regenerated types (Supabase names them `<table>_<column>_fkey`); the
> three-FK-to-`players` disambiguation **requires** the explicit `!fkey` hints. Confirm
> the cursor `.or(... and(...) ...)` form renders correctly against PostgREST; if the
> nested-`and` filter is awkward, fall back to filtering `published_at.lt` only and
> de-duping the boundary row client-side. Reuse `seasons.getCurrent()` for the season.

---

## 2. Template renderer (design §7, §9) — `app/src/utils/activityFeedTemplates.ts` (new)

The **single place** feed copy lives, so tone/format can evolve without touching
historical rows (§3.7). A map keyed by `template_key` turns a feed row into display
parts. Each renderer pulls **current** player names from the joined row and values from
`public_payload` (never `admin_payload`, §8.2). Copy is short, playful, public-safe,
non-shaming (§9.1); loan copy exposes **no** amounts (§11).

```ts
export interface FeedRenderParts {
  icon: string                 // feature emoji
  sourceLabel: string          // "Sportsbook" | "Loan Shark" | "The House"
  line: string                 // rendered sentence
  amount?: { value: number; tone: 'positive' | 'neutral' }  // optional badge
}

// row carries: event_type, template_key, public_payload, and joined actor/subject names.
export function renderFeedEvent(row: FeedEventView): FeedRenderParts { /* switch on template_key */ }
```

Required v1 templates (copy mirrors the design's example strings):

| `template_key` | icon | rendered copy (current names + `public_payload`) |
|---|---|---|
| `sportsbook.bet_placed` | 🏟️ | "{actor} placed a Sportsbook ticket." (only appears if server enables it — off in v1) |
| `sportsbook.parlay_placed` | 🏟️ | "{actor} built a {legs}-leg parlay." |
| `sportsbook.big_ticket_placed` | 🏟️ | "{actor} put {stake} pins on the board." · amount `+stake` |
| `sportsbook.big_win` | 🏟️ | "{actor} hit big at the Sportsbook and took home {payout} pins." · amount `+payout` |
| `sportsbook.parlay_hit` | 🏟️ | "{actor} hit a {legs}-leg parlay and won {payout} pins." · amount `+payout` |
| `sportsbook.weekly_house_result` | 🏛️ | `house_net > 0` → "The House cleaned up this week: +{house_net} pins." ; `< 0` → "The players beat the House this week: {house_net} for the Sportsbook." |
| `loan_shark.loan_taken` | 🦈 | "{actor} visited the Loan Shark." (NO amounts) |
| `loan_shark.loan_repaid` | 🦈 | "{actor} cleared things up with the Loan Shark." (NO amounts) |
| `loan_shark.special_offer` | 🦈 | "The Loan Shark is offering dangerous terms this week." |

Centralize the icon + `sourceLabel` mapping here too. An unknown `template_key` should
render a safe generic line (forward-compatible with future publishers) rather than crash.
Avoid subject/market-targeting copy in the feed line — keep "{actor} placed a ticket",
not "{actor} bet the under on {subject}" (§10.2); detailed subject references belong on
tap-through detail pages only.

---

## 3. Hook `useMarketMovesData.ts` (new)

No memoization in the hook (project rule); the screen derives display via `useMemo` +
the template util.

`useMarketMovesData()` returns:
```ts
type FeedFilter = 'all' | 'sportsbook' | 'loan_shark' | 'highlights'
{
  loading: boolean
  events: FeedEventView[]      // normalized rows (raw fields + joined actor/subject names); NO rendered text
  filter: FeedFilter
  setFilter: (f: FeedFilter) => void
  hasMore: boolean
  loadMore: () => Promise<void>   // cursor pagination — appends the next page
  reload: () => Promise<void>     // resets to page 1 for the current filter
}
```
- Resolve current season (`seasons.getCurrent()`); fetch page 1 via the filter-matched
  `db.ts` method (`all → listPublic`, `sportsbook`/`loan_shark → listByFeature`,
  `highlights → listHighlights`).
- Normalize each row to `FeedEventView` (flatten the joined `actor`/`subject`/`secondary`
  name+avatar; keep `event_type`, `template_key`, `public_payload`, `published_at`, `id`,
  `source_feature`, `importance`, the source FK ids). **Do not** render copy here —
  rendering is the screen's job via `renderFeedEvent` (§2).
- Track the cursor from the last row (`{ publishedAt, id }`); `loadMore` fetches the next
  page and appends; `hasMore = lastPage.length === 50`. Changing `filter` calls `reload`.

---

## 4. Screen `MarketMovesScreen.tsx` (new, Pinsino stack) — design §16

`SafeAreaView` + `ScreenHeader` "Market Moves" (+ back) + a `FlatList` with
`RefreshControl` from `useRefresh(reload)` and `onEndReached → loadMore` for cursor
pagination (design §15.4). Theme via `colors/fonts/radius`.

- **Filter chips** (design §16.2): **All / Sportsbook / Loan Shark / Highlights** driving
  `setFilter` (reuse the existing pill/toggle filter component used by other screens).
- **Feed card** per row (design §16.1) — build a small `MarketMoveCard` component
  (mirrors `BetRow.tsx` styling) or render inline; for each row call
  `renderFeedEvent(row)` (§2) and show:
  - the feature **icon** + a `PlayerAvatar` for the actor (`name`/`avatar_path` from the
    join) when the event has an actor;
  - the rendered **line**;
  - a relative **timestamp** (`timeAgo(row.published_at)`) + the **source label**
    (e.g. "Monday 10:42 PM · Sportsbook");
  - the optional **amount badge** when `renderFeedEvent` returns one.
- **Empty / loading** states: `LoadingView` while `loading`; a friendly empty message when
  the feed has no rows for the current filter.

### Tap targets (design §16.3) — privacy-aware
- **Sportsbook events** (`sportsbook_bet_id` present): tap → the existing bet / Sportsbook
  detail surface (reuse whatever `PinsinoSportsbookScreen` / bet detail already exposes).
- **Loan events**: **no public tap-through.** Only if `actor_player_id === current
  player` (the borrower viewing their own row) may it deep-link to `LoanShark`; for any
  other viewer the card is **non-tappable** (a different player must never reach someone
  else's loan detail — §16.3, §3.5). Guard this explicitly with the signed-in
  `useAuthStore(s => s.playerId)`.
- **Weekly House result** + system events: no detail in v1.

---

## 5. Wiring

### `app/src/screens/PinsinoScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '📊', label: 'Market Moves', route: 'MarketMoves' }`.
  Extend the `MENU_TILES` route union type to include `'MarketMoves'`.
- **No notification badge** (design §17 — the feed is public content, not a per-user
  prompt). Do **not** register a `NOTIFICATION_SOURCES` entry for it.

### Navigation
- `app/src/navigation/types.ts`: add `MarketMoves: undefined` to `PinsinoStackParamList`;
  add `MarketMovesAdmin: undefined` to `MoreStackParamList`.
- `app/src/navigation/PinsinoStackNavigator.tsx`: register `MarketMoves` →
  `MarketMovesScreen` (title "Market Moves").
- `app/src/navigation/MoreStackNavigator.tsx`: register `MarketMovesAdmin` →
  `MarketMovesAdminScreen` (title "Market Moves Admin").

### Ledger rendering
- **No `LedgerRow` change.** The feed never writes `pin_ledger` rows, so there are no new
  pin types to label (contrast Loan Shark / PvP, which added ledger labels).

---

## 6. Admin — `MarketMovesAdminScreen.tsx` (new, More stack) — design §18

- Admin gate (`useAuthStore(s => s.role) === 'admin'`, else an admins-only message,
  matching the other admin screens).
- Load all season events via `activityFeed.listAllForAdmin(seasonId)`; filter
  client-side by **source feature / status / importance** (reuse the pill filter).
- Each row shows the **rendered copy** (`renderFeedEvent`), `status` badge,
  `source_feature`/`event_type`, the source link (bet/loan id when present), and a
  collapsible **public_payload + admin_payload** inspector (design §18 — admin_payload is
  visible only here, never in the public feed, §8.2).
- Per-row actions in a modal (`<Toast/>` inside, mounted conditionally so it resets):
  - **Suppress** (`published` rows) — a reason input → `activityFeed.suppress(id, reason)`
    → toast + reload (§14.2).
  - **Restore** (`suppressed` rows) → `activityFeed.restore(id)` → toast + reload (§14.3).
- A **"Post system event"** form (design §19.1) — pick an event
  (`loan_shark_special_offer` or a generic admin announcement), template key, importance,
  and optional payload values → `activityFeed.createSystemEvent(...)` → toast + reload.
- **Do not** build the public feed as an audit log — moderation history lives on the row's
  suppression fields / a future admin audit log, not in the feed (§18.2).

### `app/src/screens/PinsinoAdminScreen.tsx`
- Add a tile to `MENU_TILES`: `{ icon: '📊', label: 'Market Moves', route: 'MarketMovesAdmin' }`.
  Extend its route union to include `'MarketMovesAdmin'`.

---

## 7. Out of v1 scope (do not build)

- Comments, reactions/likes, user-authored trash talk, any arbitrary user-generated feed
  text (design §21, §9.2).
- Per-user feed personalization / read state, push-notification delivery, algorithmic
  ranking (§21).
- A Market Moves **notification badge** (§17 — feed ≠ notifications).
- `sportsbook_bad_beat`, weekly recap cards, "My Activity" filter, and future-feature
  filters (Challenges / Merchant / Bounties / Auctions / House) — the server emits none of
  these in v1 (§16.2 future list, §21).
- Future publishers (Merchant, PvP, Bounty, Auction, Weekly Recap) — each adds its own
  nullable FK column + publish call + template later (§22); no app change needed until
  then beyond a new template + (optionally) a filter chip.

---

## 8. v1 defaults baked into this spec (resolving design §23)

| # | Question | v1 default |
|---|---|---|
| 1 | Large Sportsbook ticket | **`stake ≥ max(250, 10% of pre-bet balance)`** (SQL constant) |
| 2 | Big Sportsbook win | **`payout ≥ 500` OR `profit ≥ 20% of pre-settlement balance`** |
| 3 | Bad beat | **Not built** in v1 (too fuzzy) |
| 4 | Normal single-bet placement in feed | **No** — large tickets only (`normal_bet_placement_enabled=false`) |
| 5 | Aggregate events' source FK | **No source FK** in v1 (`source_feature='system'/'admin'`); dedicated source tables deferred |
| 6 | Suppression metadata | **Directly on `activity_feed_events`** (`suppressed_by_admin_id`/`suppressed_at`/`suppression_reason`) |
| 7 | Controlled strings | **`CHECK` constraints** (not enums / lookup tables) |
| 8 | Template catalog | **App code** (`activityFeedTemplates.ts`); the SQL writer validates `event_type`/`template_key` against its catalog |

---

## 9. Verification (manual, Expo dev server — no test suite)

Run `expo start` from `app/`. Use a throwaway/non-prod season. Pair with the DB spec's
SQL checks (`ACTIVITY_FEED_DB.md` §7).

1. **Tile + feed** — Market Moves tile appears on the Pinsino hub and opens the feed;
   rows render with the correct icon, actor avatar, copy, relative timestamp, and source
   label.
2. **Sportsbook moves** — from another account, placing a 300-pin ticket and a 3-leg
   parlay surfaces a Big Ticket and a Parlay card; a 10-pin single surfaces **nothing**;
   winning the parlay surfaces a Parlay Hit card with the payout badge.
3. **Loan privacy** — taking a loan surfaces a vague "{name} visited the Loan Shark" card
   with **no** amounts; a partial repayment surfaces nothing; full payoff surfaces a
   "cleared things up" card. From a **non-borrower** account the loan card is **not
   tappable** (no path to debt detail); from the borrower's own account it deep-links to
   Loan Shark.
4. **Weekly House** — archiving a week posts one "The House cleaned up / players beat the
   House" card; re-archiving does not duplicate it.
5. **Filters** — All / Sportsbook / Loan Shark / Highlights each narrow the feed
   correctly; Highlights shows only highlight/major events.
6. **Pagination + refresh** — pull-to-refresh resets the feed; scrolling to the bottom
   loads the next page (no duplicate boundary rows).
7. **Admin** — Market Moves Admin tile (admin only) lists all events incl. suppressed;
   suppress hides a card from the public feed and restore returns it; the payload
   inspector shows public + admin payloads; posting a system "special offer" event makes
   it appear publicly.
8. **Integrity** — confirm nothing in this flow touches balances, ledgers, standings, or
   scores (the feed is read-derived; cancelling a bet/loan removes its card via DB
   cascade with no app change).
