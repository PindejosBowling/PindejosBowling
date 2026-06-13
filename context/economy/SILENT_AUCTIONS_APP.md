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
| Screens | `AuctionHouseScreen` (OPEN → SCHEDULED → MY ITEMS → RECENTLY SETTLED), `AuctionDetailScreen` (ticking countdown, owner tap-to-reveal, bid/cancel CTAs, settlement reveal), `AuctionHouseAdminScreen` (More stack — all admin: auctions, catalog, grants) |
| Components | `components/auction/` — see [COMPONENTS_INDEX.md](../COMPONENTS_INDEX.md) |
| Cross-cutting | `GoldenTicketToggle` in all three Sportsbook wager flows; `auction` notification source; `auction_house` feed templates + filter pill + tap-through |
| Flags | `SHOW_AUCTION_HOUSE` gates the Pinsino tile independently of `SHOW_PINSINO` |

## The sealed-bid display contract

- Cards show a **BID PLACED tag only — never an amount**. Your amount exists
  on the detail screen behind an owner-only **tap-to-reveal** (fed by the
  `my_bid_amount` RPC — the column is ciphertext; RLS means other players'
  rows never arrive at all).
- The public signals are `bidder_count` while live, and the winners after:
  the denorms hold the FIRST (highest) winner as the hammer-price headline,
  while the full pay-as-bid winners list (`AuctionView.winners`) derives from
  `auctionLedger` `auction_purchase` rows via `purchasesByAuction` — the same
  fetch that powers bounces (name + fee; pledged amounts were destroyed at
  settlement). Multi-unit (`quantity > 1`): card title `×N`, "k of N sold"
  result line, detail lists every winner, bid sheet adds top-N pledge copy.
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

Create/edit modal (live catalog chips with the item's copy shown read-only and
submitted as the description, close defaults next Monday 7 PM ET, bounce fee
read-only); action modal by status (Edit / Open Now → Settle Now → Reverse) —
**no bid inspection surface exists, deliberately**.

**All admin functionality lives on `AuctionHouseAdminScreen`** (`More` stack,
Pinsino Admin 🔨 tile): auction create/manage (the modals above mount there),
item-catalog curation (`CatalogItemModal` — functional columns shown frozen
once instances exist, mirroring the DB guard), and item grants
(`GrantItemSheet` → `inventoryItems.grant`). The player-facing
`AuctionHouseScreen` / `AuctionDetailScreen` carry **no admin controls**; data
comes from `useAuctionAdminData` (auctions without bid decoding, catalog with
instance counts, active players).
