# Silent Auctions — Grilling Findings & Decisions

Outcome of the 2026-06-11 design-grilling session on `ECONOMIC_DESIGN_SILENT_AUCTIONS.md`, plus the codebase facts that shaped each decision. This is the decision record feeding the implementation plan; the eventual as-built specs are `SILENT_AUCTIONS_DB.md` / `SILENT_AUCTIONS_APP.md`.

## Codebase ground truth (verified)

- Balance is `SUM(pin_ledger.amount)` per player+season; bet stakes are escrowed at placement, so "available balance" = current balance. The pledge model's affordability check is one query.
- The Bounty Board is the structural template: root table + RPCs (create/enter/close/settle/cancel), SECURITY DEFINER identity from `auth.uid()`, double-entry ledger pairs, hard-delete cancel, `publish_activity_event` wiring.
- **No inventory/merchant system exists** — nothing in the live schema could be delivered to a winner.
- **No hidden-row RLS precedent** — every table is fully readable; sealed bids need the codebase's first ownership-filtered policy.
- **No pg_cron / scheduled jobs** — all transitions today are admin-RPC or archive-tick driven.

## Decisions

### 1. Item delivery: build a real item framework (scope expansion)

The winner's prize is not a trophy or a free-text honor-system note. This feature ships:

- **`item_catalog`** — item definitions: stable `key`, `effect_type` (`bet_insurance | cosmetic | access_pass | custom`), `effect_params jsonb`, target `domain`, `activation_mode` (`attach_to_bet | passive | admin_honored`), `charges`.
- **`player_inventory_items`** — instances: player/catalog/season FKs, `remaining_charges`, `granted_at` / `consumed_at`, `source` (`auction | merchant | admin_grant`), nullable `auction_id`.

Designed so the future Traveling Merchant reuses it unchanged. **Framework + one wired hook in v1**; all other catalog effect types stay admin-honored until their domain hook lands.

### 2. First wired effect: Safety Ticket (bet insurance)

Explicit activation with charges: the player attaches a charge at bet placement (`place_house_bet` gains a trailing `p_insurance_item_id`), and if the bet loses, the stake is refunded House-funded inside `finalize_bets_for_market` (one edit covers O/U, moneyline, and LaneTalk props). The refund pair must be **bet-linked AND week-stamped** so it is idempotent on re-archive and reversed for free by `unarchive_week`. The consumed charge does not revert on unarchive. Force-voided insured bets get only `bet_refund` (the hook lives in the lost branch only). `cancel_bet` restores the charge.

### 3. Settlement clock: pg_cron, not admin-pressed and not archive-coupled

Hard requirement: the auction settles **at the configured close time, immediately**, with the item transferred only after payment commits. Therefore:

- Enable `pg_cron` (first scheduled job in the project); a per-minute `sweep_auctions()` opens scheduled auctions at `opens_at` and settles due ones via an idempotent `settle_auction_internal` (no grants — cron has no JWT, so no `auth.jwt()` gate inside; security = revoked EXECUTE).
- An admin-gated `settle_auction` wrapper exists as manual fallback.
- `archive_week` / `unarchive_week` never know auctions exist.
- The bid RPC's time check (`now() < closes_at`) is authoritative independent of cron lag; both bid and settle take `FOR UPDATE` on the auction row to kill the close-boundary race.

### 4. Single-item v1

One item, one winner, first-price. Schema carries `quantity int DEFAULT 1 CHECK (quantity = 1)` so multi-unit is a later unlock, not a redesign.

### 5. Reveal scope: winner + bounces only (tighter than the design doc)

Losing bids stay private **forever** — the doc's full post-settlement bid table is rejected on social-dynamics grounds (consistent with the sportsbook hiding the "under" side). Consequences:

- `auction_bids` SELECT is owner-only **always** (no reveal flip) — the first ownership-filtered RLS policy in the codebase.
- The public story lives on the `auctions` row (`winner_player_id`, `winning_price`, denormalized `bidder_count` maintained by the bid RPC) and in feed events.
- Bounce events name the player and the fee, never their bid amount.

### 6. Feed events: core four

`auction_opened` (published by the sweep), `auction_won`, `auction_check_bounce`, `auction_no_sale`. No final-warning or closed events in v1. Requires `auction_id` FK on `activity_feed_events`, a 17th `p_auction_id` arg on `publish_activity_event`, and **split dedup indexes** — `(auction_id, event_type)` excluding bounces, plus `(auction_id, event_type, actor_player_id)` for bounces, since multiple bouncers per auction are legitimate.

### 7. Notification badge

Count of open auctions where the player has **no active bid** — a true pending-action signal per the notifications framework.

### 8. App surface: one Pinsino tile

"Auction House" tile → one screen with the auction list (open / scheduled / recently settled), a **My Items** section (owned items + remaining charges), and an inline admin create flow. Auction detail screen carries rules, countdown, bidder count, the bid form (ConfirmActionSheet with the pledge + bounce-warning copy), and the post-settlement winner reveal. Items get their own tile later when the Merchant lands. The wager sheet (`WagerSheet`) gains a "use Safety Ticket" toggle.

### 9. Bid mechanics: straight from the design doc

One active bid per player; raises only (prior bid marked `superseded`); `>= minimum_bid` + increment rule; affordability checked at submission (no ledger writes, no feed events at bid time); tie-break = earliest final bid; bounce fee `min(balance, 50)`.

### 10. Ledger & lifecycle plumbing

- `pin_ledger`: new `auction_id` FK; new event types `auction_purchase`, `auction_check_bounce`, `bet_insurance_refund`.
- Auction statuses: `draft → scheduled → open → settled / settled_no_winner` (no `cancelled` status — see below).
- Cancel pre-settlement = hard delete (bids + feed rows cascade; no ledger rows can exist). Post-settlement = `reverse_settled_auction`: delete ledger pairs by `auction_id`, revoke the inventory item (RAISE if already consumed), delete the auction — "as if it never happened," per bounty cancel conventions.

## Implementation shape (summary)

Six migrations: (1) item framework tables + Safety Ticket seed, (2) auctions/auction_bids + pin_ledger/bets extensions + RLS, (3) auction RPCs, (4) pg_cron enable + schedule, (5) Safety Ticket hooks (`place_house_bet`, `finalize_bets_for_market`, `cancel_bet`), (6) activity-feed extension. App layer: `auctions` + `inventoryItems` objects in `db.ts`, two hooks, two screens, four auction components, navigation/tile/badge/feed-template wiring. Full sequencing, verified schema line anchors, risk flags, and the verification script live in the implementation plan (`~/.claude/plans/start-a-new-worktree-smooth-wolf.md`).
