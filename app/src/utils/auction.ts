// Pure auction view types + helpers (no data access; AGENTS.md rule 6).
//
// These view types are the seam between the auction UI and the (not yet built)
// DB layer: components bind to AuctionView / InventoryItemView, never raw rows.
// When the auction schema lands, the real hooks map generated rows into these
// shapes and the components don't change.

import { defaultBountyCloseAt } from './bounty'
import { formatTimeRemaining, formatCountdown } from './formatting'

// `formatTimeRemaining` / `formatCountdown` now live in utils/formatting.ts;
// re-exported here for back-compat.
export { formatTimeRemaining, formatCountdown }

// No `draft` ("auctions either exist or they don't") and no `cancelled`
// (pre-settlement cancel is a hard delete) — AUCTION_FINDINGS.md §10.
export type AuctionStatus = 'scheduled' | 'open' | 'settled' | 'settled_no_winner'

export interface AuctionBounceView {
  playerName: string
  // The fee actually charged: min(balance at settlement, bounce fee).
  feePaid: number
}

// One settled winner (multi-unit: up to `quantity` of these, pay-as-bid).
// Derived from pin_ledger 'auction_purchase' rows — public by design.
export interface AuctionWinnerView {
  playerName: string
  price: number
}

export interface AuctionView {
  id: string
  status: AuctionStatus
  // Catalog-owned copy — the auction never overrides item naming.
  itemKey: string
  itemIcon: string
  itemName: string
  itemEffectLine: string
  description: string
  opensAt: string
  closesAt: string
  minimumBid: number
  bounceFee: number
  // Units on the block: the top N sealed bidders each win one (pay-as-bid,
  // one per player).
  quantity: number
  // The only public bid signal while the auction is live (FINDINGS §9).
  bidderCount: number
  // Settled-only denorms — the hammer-price headline (first/highest winner).
  winnerName: string | null
  winningPrice: number | null
  // Every winner (ledger-derived), highest price first. Empty until settled.
  winners: AuctionWinnerView[]
  bounces: AuctionBounceView[]
  // Owner-only: present iff the viewer holds the active bid (RLS guarantees
  // other players' bids never arrive).
  myBidAmount: number | null
}

export type InventoryItemSource = 'auction' | 'merchant' | 'admin_grant'

// A row of `item_catalog` as the create-modal picker sees it.
export interface CatalogItemView {
  key: string
  icon: string
  name: string
  effectLine: string
  howToUse: string
}

// One atomic, single-use item row (no charge counter — quantity is row count;
// AUCTION_FINDINGS.md item-framework doctrine).
export interface InventoryItemView {
  id: string
  itemKey: string
  icon: string
  name: string
  effectLine: string
  howToUse: string
  source: InventoryItemSource
  grantedAt: string
  consumedAt: string | null
}

// Display grouping: identical items collapse to one row with ×count.
export interface InventoryGroupView {
  itemKey: string
  icon: string
  name: string
  effectLine: string
  howToUse: string
  expired: boolean
  count: number
  items: InventoryItemView[]
}

// A full catalog row as the admin screen sees it. instanceCount > 0 means the
// functional columns (effectType/effectParams/activationMode) are frozen —
// the DB update RPC enforces it; the UI mirrors the guard.
export interface CatalogItemAdminView {
  id: string
  key: string
  icon: string
  name: string
  description: string
  effectType: string
  effectParams: Record<string, unknown>
  activationMode: string
  isActive: boolean
  instanceCount: number
}

// The DB check constraints on item_catalog, mirrored for the admin form chips.
export const CATALOG_EFFECT_TYPES = ['bet_insurance', 'cosmetic', 'access_pass', 'custom'] as const
export const CATALOG_ACTIVATION_MODES = ['attach_to_bet', 'passive', 'admin_honored'] as const

export const SOURCE_LABEL: Record<InventoryItemSource, string> = {
  auction: 'Won at auction',
  merchant: 'Bought from the Merchant',
  admin_grant: 'Granted by the House',
}

// Usage copy derives from the catalog's activation_mode (no stored how-to text).
export function itemHowToUse(activationMode: string): string {
  switch (activationMode) {
    case 'attach_to_bet':
      return 'Toggle it on when placing a bet in the Sportsbook. The item is spent at placement, win or lose.'
    case 'passive':
      return 'Always active while you own it.'
    default:
      return 'See the House — this one is honored manually.'
  }
}

// The House's bounce penalty (DB: auctions.bounce_fee DEFAULT 50 — frozen per
// row at create; no admin knob in v1). Display constant only.
export const DEFAULT_BOUNCE_FEE = 50

// Stronger §18.3 bounce copy kicks in at half the player's balance. A warning,
// never a gate.
export const LARGE_BID_BALANCE_SHARE = 0.5

export function isLargeBid(amount: number, balance: number): boolean {
  return balance > 0 && amount >= balance * LARGE_BID_BALANCE_SHARE
}

// Auctions close when bounties close: next Monday 7pm ET (league night).
export const defaultAuctionCloseAt = defaultBountyCloseAt

export interface AuctionSections {
  open: AuctionView[]
  scheduled: AuctionView[]
  settled: AuctionView[]
}

// Screen section order: open (closing soonest first), scheduled (opening
// soonest first), settled (most recent first, capped — losing bids stay
// private forever, so history is short-form reading).
export const SETTLED_DISPLAY_CAP = 10

export function auctionSections(auctions: AuctionView[]): AuctionSections {
  const open = auctions
    .filter(a => a.status === 'open')
    .sort((a, b) => a.closesAt.localeCompare(b.closesAt))
  const scheduled = auctions
    .filter(a => a.status === 'scheduled')
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
  const settled = auctions
    .filter(a => a.status === 'settled' || a.status === 'settled_no_winner')
    .sort((a, b) => b.closesAt.localeCompare(a.closesAt))
    .slice(0, SETTLED_DISPLAY_CAP)
  return { open, scheduled, settled }
}

export function isItemExpired(item: InventoryItemView): boolean {
  return item.consumedAt != null
}

// Group identical items (same catalog key + consumed state) into ×N display
// rows: active groups first (newest grant first), expired greyed out below.
export function groupInventory(items: InventoryItemView[]): InventoryGroupView[] {
  const groups = new Map<string, InventoryGroupView>()
  const sorted = [...items].sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
  for (const item of sorted) {
    const expired = isItemExpired(item)
    const key = `${item.itemKey}:${expired ? 'expired' : 'active'}`
    const g = groups.get(key)
    if (g) {
      g.count += 1
      g.items.push(item)
    } else {
      groups.set(key, {
        itemKey: item.itemKey,
        icon: item.icon,
        name: item.name,
        effectLine: item.effectLine,
        howToUse: item.howToUse,
        expired,
        count: 1,
        items: [item],
      })
    }
  }
  const all = [...groups.values()]
  return [...all.filter(g => !g.expired), ...all.filter(g => g.expired)]
}

