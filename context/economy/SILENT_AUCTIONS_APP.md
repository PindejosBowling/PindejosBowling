# Silent Auctions + Item Framework — app-layer spec (as built)

> The "Auction House" Pinsino tile. DB counterpart:
> [SILENT_AUCTIONS_DB.md](SILENT_AUCTIONS_DB.md); decisions:
> [AUCTION_FINDINGS.md](AUCTION_FINDINGS.md) §8/§9.

## Surface map

| Layer | Files |
|---|---|
| db.ts objects | `auctions`, `auctionLedger`, `itemCatalog`, `inventoryItems`; `bets.place` gained the 4th `insuranceItemId` arg |
| View types + pure helpers | `utils/auction.ts` — `AuctionView` / `InventoryItemView` / `InventoryGroupView` / `CatalogItemView`; `auctionSections`, `groupInventory`, `formatTimeRemaining`/`formatCountdown`, `isLargeBid` (≥50% of balance), `itemHowToUse`, `defaultAuctionCloseAt` (= bounties' next-Mon-7PM-ET) |
| Hooks | `useAuctionHouseData` (list + My Items + balance), `useAuctionDetailData` (one auction + decoded own bid); normalizers exported from the house hook |
| Screens | `AuctionHouseScreen` (OPEN → SCHEDULED → MY ITEMS → RECENTLY SETTLED, admin `+ Create Auction`), `AuctionDetailScreen` (ticking countdown, owner tap-to-reveal, bid/cancel CTAs, settlement reveal, admin Manage) |
| Components | `components/auction/` — see [COMPONENTS_INDEX.md](../COMPONENTS_INDEX.md) |
| Cross-cutting | `GoldenTicketToggle` in all three Sportsbook wager flows; `auction` notification source; `auction_house` feed templates + filter pill + tap-through |
| Flags | `SHOW_AUCTION_HOUSE` gates the Pinsino tile independently of `SHOW_PINSINO` |

## The sealed-bid display contract

- Cards show a **BID PLACED tag only — never an amount**. Your amount exists
  on the detail screen behind an owner-only **tap-to-reveal** (fed by the
  `my_bid_amount` RPC — the column is ciphertext; RLS means other players'
  rows never arrive at all).
- The public signals are `bidder_count` while live, and the winner + price
  denorms after. Bounces render as name + fee (the pledged amounts were
  destroyed at settlement; `auctionLedger` player-side rows are the source).
- `normalizeAuction` synthesizes the display status `settled_no_winner` from
  `status='settled' AND winner == null` (the DB stores one terminal state).

## Mechanics surfaced in the UI

- **Free re-pricing**: bid sheet prefills (min bid, or your current bid when
  editing), no increment, separate destructive CANCEL BID; the edit hint warns
  that editing resets the tie-break clock. §18.3 pledge copy always; stronger
  warning at ≥50% of balance (`isLargeBid` — a warning, never a gate).
- **Countdown**: per-second tick on detail only; static minute-granularity on
  cards; past 0:00 while still open → `🔨 HAMMER FALLING…` (cron lag as
  theater) with the bid CTAs hidden.
- **My Items**: atomic items grouped ×N by `groupInventory` (active first,
  consumed greyed **EXPIRED** below — history preserved); row tap → info-only
  `ItemInfoSheet` with per-item provenance. Activation lives only at the point
  of use.
- **Golden Ticket toggle** (`GoldenTicketToggle`, all three Sportsbook flows):
  default OFF, reset per sheet open, hidden at 0 tickets, consumes the oldest
  unconsumed `bet_insurance`+`attach_to_bet` item (`tickets[0]`), copy states
  the ticket is **spent at placement win or lose**; ticket list reloads after
  placement.
- **Badge**: open auctions where the viewer has no active bid (a true
  pending action) — `auction` source in `utils/notifications.ts`.
- **Feed**: 🔨 `auction_house` templates — opened (MIN BID badge), won (PAID
  badge + winner banner), check_bounce (FEE badge; special copy at fee 0),
  no_sale (ironic all-bounce branch when `bounce_count === bidder_count > 0`).
  Auctions filter pill; `auction_id` tap-through to AuctionDetail. **Auction
  events are week-stamped with the week they occurred** (the ledger's
  open-week stamp), so Market Moves groups them under the right week header;
  the archive engine never deletes them (auction-exempt feed delete).

## Admin

Create/edit modal (all fields, live catalog chips, close defaults next Monday
7 PM ET, bounce fee read-only); action modal by status (Edit / Open Now →
Settle Now → Reverse) — **no bid inspection surface exists, deliberately**.
Item grants go through `inventoryItems.grant` (no UI in v1 — `db query` or a
future admin screen).
