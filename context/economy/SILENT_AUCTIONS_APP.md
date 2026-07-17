# Silent Auctions + Item Framework — app-layer spec (as built)

> The "Auction House" Pinsino tile. DB counterpart:
> [SILENT_AUCTIONS_DB.md](SILENT_AUCTIONS_DB.md); decisions:
> [AUCTION_FINDINGS.md](AUCTION_FINDINGS.md) §8/§9.

## Surface map

| Layer | Files |
|---|---|
| db.ts objects | `auctions`, `auctionLedger`, `itemCatalog`, `inventoryItems` (`listAllForSeason` + `revoke` for the admin remove-item view); `bets.place` gained the 4th `insuranceItemId` arg |
| View types + pure helpers | `utils/auction.ts` — `AuctionView` / `InventoryItemView` / `InventoryGroupView` / `CatalogItemView`; `auctionSections`, `groupInventory`, `formatTimeRemaining`/`formatCountdown`, `isLargeBid` (≥50% of balance), `itemHowToUse`, `itemUsageTag` (compact where-you-spend-it row tag), `defaultAuctionCloseAt` (= bounties' next-Mon-7PM-ET) |
| Hooks | `useAuctionHouseData` (list + My Items + balance), `useAuctionDetailData` (one auction + decoded own bid); normalizers exported from the house hook |
| Screens | `AuctionHouseScreen` (segmented **THE FLOOR / MY ITEMS** — Floor: OPEN cards with bid-from-card, SCHEDULED + RECENTLY SETTLED as collapsed accordions; My Items: the locker, segment label carries the ready count), `AuctionDetailScreen` (ticking countdown + bidder count + inline facts row, owner tap-to-reveal, place/edit bid CTA — **no cancel; bids are commitments**, settlement reveal; prose rules live behind the `?` explainer), `AuctionHouseAdminScreen` (More stack — all admin: auctions, catalog, grants) |
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

- **Re-pricing without escape**: bid sheet prefills (min bid, or your current
  bid when editing), no increment, **no cancel** — a placed bid is a
  commitment, editable down to `minimum_bid` only; the edit hint warns that
  editing resets the tie-break clock. §18.3 pledge copy always (incl. the
  can't-take-it-back line); stronger warning at ≥50% of balance
  (`isLargeBid` — a warning, never a gate).
- **Bid-from-card** (2026-07 redesign): open-auction cards on the Floor carry a
  Place Sealed Bid / Edit Bid button that opens `AuctionBidSheet` directly on
  the hub (`onBid` prop; hidden in read-only seasons and once past `closes_at`).
  The detail screen remains for the ticking countdown, the tap-to-reveal, and
  settlement results. This supersedes the original fixed section order
  (OPEN → SCHEDULED → MY ITEMS → RECENTLY SETTLED, one scroll).
- **Close time display** (2026-07): cards show the *absolute* close/open time
  ("Monday, July 20, 7:00 PM ET" via `formatCloseDateLong`) as a CLOSES/OPENS
  cell in-line with MIN BID and BIDDERS (a wider small-value `StatCell` — no
  countdown on cards); the detail screen keeps the per-second tick with the
  absolute time promoted to headline weight directly beneath it.
  Past `closes_at` while still open → `🔨 HAMMER FALLING…` (cron lag as
  theater) with the bid CTAs hidden (hub card + detail both).
- **Detail facts**: min bid / quantity render as a compact row inside the
  countdown card; the four prose rules (win rule, secrecy,
  no-takebacks, bounce) live in `EXPLAINERS.auctionHouse` behind the screen's
  `?` — the dynamic bounce-fee and top-N lines still ride the bid sheet's
  `TermsBlock`.
- **My Items**: atomic items grouped ×N by `groupInventory` (active first,
  consumed greyed **EXPIRED** below — history preserved); rows carry an
  `itemUsageTag` (`ATTACH WHEN BETTING` / `HAUNT A BET` / …) bridging to the
  Sportsbook; row tap → `ItemInfoSheet` (WHAT IT DOES / WHERE TO USE IT /
  PROVENANCE + a **Use at the Sportsbook →** navigation button, hidden for
  expired groups and read-only seasons). Activation still lives only at the
  point of use — the button navigates, never consumes.
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
once instances exist, mirroring the DB guard), item grants
(`GrantItemSheet` → `inventoryItems.grant`), and a **PLAYER INVENTORY**
remove-item view (`AdminInventoryList`, grouped by player via
`groupAdminInventory`; every player's season inventory from
`inventoryItems.listAllForSeason`). Only **unconsumed** rows carry a Remove
action → a `ConfirmActionSheet` fires `inventoryItems.revoke` (undo a grant);
used rows show greyed **USED** and are non-removable (the RPC refuses them).
The player-facing
`AuctionHouseScreen` / `AuctionDetailScreen` carry **no admin controls**; data
comes from `useAuctionAdminData` (auctions without bid decoding, catalog with
instance counts, active players).
