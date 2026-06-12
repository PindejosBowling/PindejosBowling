// Pure auction view types + helpers (no data access; AGENTS.md rule 6).
//
// These view types are the seam between the auction UI and the (not yet built)
// DB layer: components bind to AuctionView / InventoryItemView, never raw rows.
// When the auction schema lands, the real hooks map generated rows into these
// shapes and the components don't change.

import { defaultBountyCloseAt } from './bounty'

// No `draft` ("auctions either exist or they don't") and no `cancelled`
// (pre-settlement cancel is a hard delete) — AUCTION_FINDINGS.md §10.
export type AuctionStatus = 'scheduled' | 'open' | 'settled' | 'settled_no_winner'

export interface AuctionBounceView {
  playerName: string
  // The fee actually charged: min(balance at settlement, bounce fee).
  feePaid: number
}

export interface AuctionView {
  id: string
  status: AuctionStatus
  // Catalog-owned copy — the auction never overrides item naming.
  itemIcon: string
  itemName: string
  itemEffectLine: string
  description: string
  opensAt: string
  closesAt: string
  minimumBid: number
  bounceFee: number
  // The only public bid signal while the auction is live (FINDINGS §9).
  bidderCount: number
  // Settled-only denorms.
  winnerName: string | null
  winningPrice: number | null
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

export const SOURCE_LABEL: Record<InventoryItemSource, string> = {
  auction: 'Won at auction',
  merchant: 'Bought from the Merchant',
  admin_grant: 'Granted by the House',
}

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

// Static minute-granularity remaining time for list cards ("3h 12m", "4d 2h").
// Detail-screen ticking uses formatCountdown instead.
export function formatTimeRemaining(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime()
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rem = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rem}m`
  return `${Math.max(rem, 1)}m`
}

// Ticking countdown for the detail screen: "01:23:45" (h:mm:ss), with a day
// prefix when needed. Returns null once past zero (the HAMMER FALLING window).
export function formatCountdown(targetIso: string, now: Date = new Date()): string | null {
  const ms = new Date(targetIso).getTime() - now.getTime()
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days > 0) return `${days}d ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
