# Silent Auctions — Grilling Findings & Decisions

Outcome of the 2026-06-11 design-grilling session on `ECONOMIC_DESIGN_SILENT_AUCTIONS.md`, plus the codebase facts that shaped each decision. This is the decision record feeding the implementation plan; the eventual as-built specs are `SILENT_AUCTIONS_DB.md` / `SILENT_AUCTIONS_APP.md`.

> **Revised 2026-06-12** after merging the DB tech-debt work (`CURRENT_STATE.md`), in two waves. Wave 1 (main): shared helpers (`assert_admin`/`is_admin`/`current_player_id`/`current_season_id`/`pin_balance`), `pin_ledger_double_entry()` as the only sanctioned pin movement, deny-by-default function grants (anon lockdown), and the `(SELECT public.is_admin())` RLS pattern. Wave 2 (`db-changes`): `bets.week_id` (single-week parlays; all "bets in week" predicates rewritten onto it) and the **rollback-probe suite formalized as the DB layer's test suite** (`context/db-verification.md`; AGENTS.md rule 8 now scopes "no test suite" to the app layer only). Wave 3 (PR #42): **`activity_event_catalog`** (new feed events = catalog `INSERT`s + Recipe B; no CASE/CHECK edits), universal `assert_admin()` adoption, normalized `search_path`, hardened global default ACL — the tech-debt backlog is closed. The build-on-new-primitives details live in the implementation plan.

## Codebase ground truth (verified)

- Balance is `SUM(pin_ledger.amount)` per player+season — now wrapped by the shared `pin_balance(player, season)` helper, which all affordability checks must use; bet stakes are escrowed at placement, so "available balance" = current balance. The pledge model's affordability check is one helper call.
- The Bounty Board is the structural template: root table + RPCs (create/enter/close/settle/cancel), SECURITY DEFINER identity via `current_player_id()`, ledger pairs via `pin_ledger_double_entry()`, hard-delete cancel, `publish_activity_event` wiring.
- **No inventory/merchant system exists** — nothing in the live schema could be delivered to a winner.
- **No hidden-row RLS precedent** — every table is fully readable; sealed bids need the codebase's first ownership-filtered policy.
- **No pg_cron / scheduled jobs** — all transitions today are admin-RPC or archive-tick driven.
- **The DB layer has a test suite** — the rollback-probe framework (`supabase/verify/`, `context/db-verification.md`): self-contained probes that synthesize fixtures in an always-aborting transaction, impersonate player/admin JWT claims, drive real RPC lifecycles, and assert exact deltas + the double-entry net-zero invariant. Economy-RPC migrations must run `run-all-probes.sh` before and after; a new economy feature ships its own probe.
- **Bets are single-week** — `bets.week_id` is stamped at placement (`place_house_bet` enforces same-week legs); archive/settle/unarchive scope bet money by `pl.bet_id IN (SELECT id FROM bets WHERE week_id = …)`, so `bet_id` is the authoritative link for bet-domain ledger rows.

## Decisions

### 1. Item delivery: build a real item framework (scope expansion)

The winner's prize is not a trophy or a free-text honor-system note. This feature ships:

- **`item_catalog`** — item definitions: stable `key`, `effect_type` (`bet_insurance | cosmetic | access_pass | custom`), `effect_params jsonb`, target `domain`, `activation_mode` (`attach_to_bet | passive | admin_honored`), `charges`.
- **`player_inventory_items`** — instances: player/catalog/season FKs, `remaining_charges`, `granted_at` / `consumed_at`, `source` (`auction | merchant | admin_grant`), nullable `auction_id`.

Designed so the future Traveling Merchant reuses it unchanged. **Framework + one wired hook in v1**; all other catalog effect types stay admin-honored until their domain hook lands.

### 2. First wired effect: Safety Ticket (bet insurance)

Explicit activation with charges: the player attaches a charge at bet placement (`place_house_bet` gains a trailing `p_insurance_item_id`), and if the bet loses, the stake is refunded House-funded inside `finalize_bets_for_market` (one edit covers O/U, moneyline, and LaneTalk props). The refund pair must be **bet-linked** (`bet_id` is what the rewritten archive snapshot / `unarchive_week` predicates key bet money by — `pl.bet_id IN (bets WHERE week_id = …)`) **and week-stamped** (read directly from `bets.week_id`; no join needed) so it is idempotent on re-archive and reversed for free by `unarchive_week`. The consumed charge does not revert on unarchive. Force-voided insured bets get only `bet_refund` (the hook lives in the lost branch only). `cancel_bet` restores the charge.

### 3. Settlement clock: pg_cron, not admin-pressed and not archive-coupled

Hard requirement: the auction settles **at the configured close time, immediately**, with the item transferred only after payment commits. Therefore:

- Enable `pg_cron` (first scheduled job in the project); a per-minute `sweep_auctions()` opens scheduled auctions at `opens_at` and settles due ones via an idempotent `settle_auction_internal` (no grants — cron has no JWT, so no `auth.jwt()` gate inside; security = simply never granting EXECUTE, which the post-lockdown deny-by-default posture makes automatic).
- An admin-gated `settle_auction` wrapper exists as manual fallback.
- `archive_week` / `unarchive_week` never know auctions exist.
- The bid RPC's time check (`now() < closes_at`) is authoritative independent of cron lag; both bid and settle take `FOR UPDATE` on the auction row to kill the close-boundary race.

### 4. Single-item v1

One item, one winner, first-price. Schema carries `quantity int DEFAULT 1 CHECK (quantity = 1)` so multi-unit is a later unlock, not a redesign.

### 5. Reveal scope: winner + bounces only (tighter than the design doc)

Losing bids stay private **forever** — the doc's full post-settlement bid table is rejected on social-dynamics grounds (consistent with the sportsbook hiding the "under" side). Consequences:

- `auction_bids` SELECT is owner-only **always** (no reveal flip) — the first ownership-filtered RLS policy in the codebase. (All reads are `TO authenticated` post-lockdown; "public" read no longer exists anywhere.)
- The public story lives on the `auctions` row (`winner_player_id`, `winning_price`, denormalized `bidder_count` maintained by the bid RPC) and in feed events.
- Bounce events name the player and the fee, never their bid amount.

### 6. Feed events: core four

`auction_opened` (published by the sweep), `auction_won`, `auction_check_bounce`, `auction_no_sale`. No final-warning or closed events in v1. Built per `context/activity-feed.md` **Recipe B** (post-`activity_event_catalog`): `auction_id` FK on `activity_feed_events` + one-source/source-feature CHECK extensions, **4 catalog `INSERT`s** (`allowed_fk='auction_id'`, extending the catalog's `allowed_fk` CHECK — no event_type CHECK exists anymore, it's an FK), and a 17th `p_auction_id` arg on `publish_activity_event`. **Split dedup indexes** (deviation from the recipe's single standard index): `(auction_id, event_type)` excluding bounces, plus `(auction_id, event_type, actor_player_id)` for bounces, since multiple bouncers per auction are legitimate.

### 7. Notification badge

Count of open auctions where the player has **no active bid** — a true pending-action signal per the notifications framework.

### 8. App surface: one Pinsino tile (DETAILED 2026-06-12, UI grilling)

"Auction House" tile (gated by `SHOW_AUCTION_HOUSE` in `featureFlags.ts`) → one ScrollView screen, sections in order: **OPEN AUCTIONS → SCHEDULED → MY ITEMS → RECENTLY SETTLED** (settled capped ~10); admin-only `+ Create Auction` header CTA. Cards show a **`BID PLACED` tag only, never the amount**; scheduled cards show `OPENS IN`, settled cards show winner + price (or `NO SALE`) + bounce count. Detail screen: item + effect copy, terms block (min bid, bounce penalty, open/close — no increment), **ticking countdown** (static minute-granularity on cards; `HAMMER FALLING…` between 0:00 and the cron settle), bidder count, owner-only **tap-to-reveal** current-bid row, `PLACE BID`/`EDIT BID` + separate destructive `CANCEL BID`. Bid sheet (ConfirmActionSheet shape): balance, amount input prefilled (min bid, or current bid when editing), §18.3 pledge copy always, stronger warning at **≥ 50% of balance** (warning, never a gate), CTA `PLEDGE X PINS`. Create modal: all fields editable; item picker over active catalog; `opens_at` defaults now, `closes_at` defaults **next Monday 7 PM ET** (`defaultBountyCloseAt` pattern); bounce fee shown read-only (50). Admin action modal by status: Edit / Open Now / Cancel (scheduled), Settle Now / Cancel (open), Reverse (settled) — **no bid-inspection surface in the app, ever** (admins are players; sealed means sealed; debugging = `db query`). **My Items**: active items first, consumed shown greyed-out **EXPIRED** below (history preserved); row tap → info-only BottomSheet (description, how to use, source + date; no actions). Items get their own tile later when the Merchant lands. The wager sheet (`WagerSheet`) gains a "use Safety Ticket" toggle: **default OFF**, all three bet flows, consumes the oldest charge, copy states the ticket is **spent at placement win or lose**; row hidden when no items.

### 9. Bid mechanics: free sealed re-pricing (REVISED 2026-06-12, UI grilling — supersedes the design doc's raises-only model)

One active bid per player; **no bid increment** (the `bid_increment` knob is deleted); the player may **edit their bid to any value or cancel it outright** any time before close. Every submission/edit revalidates `>= minimum_bid` and `<= pin_balance(...)`; cancel is a hard delete of the bid row. No ledger writes, no feed events at bid time. **Tie-break: any edit resets the bid's timestamp** — a tie goes to whoever has held their current amount longest. Public visibility during the auction is **count only**: players see how many bids exist, never who or how much (the `bidder_count` denorm is the sole public signal). Bounce fee `min(balance, 50)` unchanged. Rationale: sealed bids mean withdrawal/lowball theater is invisible, so raises-only bought nothing; one-active-bid still caps spam.

### 10. Ledger & lifecycle plumbing

- `pin_ledger`: new `auction_id` FK — the feature's **exactly-one root ref** per the PIN_ECONOMY_SCHEMA §4 ref-column policy (it is what cancel/reverse deletes by); new event types `auction_purchase`, `auction_check_bounce`, `bet_insurance_refund`. All pairs are written by `pin_ledger_double_entry()`, extended with a trailing defaulted `p_auction_id`; the insurance refund is bet-domain and rides `bet_id` + `week_id`, with no auction ref.
- Auction statuses: `scheduled → open → settled / settled_no_winner` (no `cancelled` status — see below; **no `draft` status** — "auctions either exist or they don't", UI grilling 2026-06-12).
- Cancel pre-settlement = hard delete (bids + feed rows cascade; no ledger rows can exist). Post-settlement = `reverse_settled_auction`: delete ledger pairs by `auction_id`, revoke the inventory item (RAISE if already consumed), delete the auction — "as if it never happened," per bounty cancel conventions.

## Implementation shape (summary)

Six migrations: (1) item framework tables + Safety Ticket seed, (2) auctions/auction_bids + pin_ledger/bets extensions + RLS, (3) auction RPCs, (4) pg_cron enable + schedule, (5) Safety Ticket hooks (`place_house_bet`, `finalize_bets_for_market`, `cancel_bet`), (6) activity-feed extension. App layer: `auctions` + `inventoryItems` objects in `db.ts`, two hooks, two screens, four auction components, navigation/tile/badge/feed-template wiring.

Verification follows `context/db-verification.md`: `run-all-probes.sh` green before the first migration and after every push; a new `probe-auctions.sql` (full create→bid→settle/bounce→reverse lifecycle + Safety Ticket consume/refund, net-zero asserted) wired into the suite; the auction admin RPCs added to `probe-admin-guards.sql`; differential captures for the M5 rewrites of `place_house_bet`/`finalize_bets_for_market` (byte-identical for uninsured bets); the archive round-trip for an insured bet follows `probe-archive-roundtrip.sql`. Full sequencing, schema line anchors, and risk flags live in the implementation plan (`~/.claude/plans/start-a-new-worktree-smooth-wolf.md`).
