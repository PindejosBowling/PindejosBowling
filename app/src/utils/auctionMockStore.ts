// MOCK: in-memory fixture store backing the auction hooks until the DB layer
// lands (mock-first UI build, AUCTION_FINDINGS.md §8). Mutations operate on
// module state so every flow is clickable in Expo. When the auction schema +
// RPCs exist, delete this file and re-point useAuctionHouseData /
// useAuctionDetailData at db.ts — the view types in utils/auction.ts are the
// seam, so no component changes.

import {
  AuctionView, CatalogItemView, InventoryItemView, defaultAuctionCloseAt,
} from './auction'

const HOURS = 3600_000
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

export const MOCK_BALANCE = 460
export const MOCK_BOUNCE_FEE = 50

export const mockCatalog: CatalogItemView[] = [
  {
    key: 'safety_ticket',
    icon: '🎟️',
    name: 'Safety Ticket',
    effectLine: 'If an insured bet loses, your full stake comes back.',
    howToUse: 'Toggle it on when placing a bet in the Sportsbook. The ticket is spent at placement, win or lose.',
  },
  {
    key: 'lane_boss_crown',
    icon: '👑',
    name: 'Lane Boss Crown',
    effectLine: 'Cosmetic bragging rights, honored by the House.',
    howToUse: 'See the House — this one is honored manually.',
  },
]

let auctions: AuctionView[] = [
  {
    id: 'mock-auction-open-mybid',
    status: 'open',
    itemIcon: '🎟️',
    itemName: 'Safety Ticket',
    itemEffectLine: 'If an insured bet loses, your full stake comes back.',
    description: 'One Safety Ticket on the block. Sealed bids — nobody sees your number.',
    opensAt: iso(-20 * HOURS),
    closesAt: iso(26 * HOURS),
    minimumBid: 100,
    bounceFee: MOCK_BOUNCE_FEE,
    bidderCount: 4,
    winnerName: null,
    winningPrice: null,
    bounces: [],
    myBidAmount: 140,
  },
  {
    id: 'mock-auction-open-nobid',
    status: 'open',
    itemIcon: '👑',
    itemName: 'Lane Boss Crown',
    itemEffectLine: 'Cosmetic bragging rights, honored by the House.',
    description: 'Wear the crown until someone outbids you next time.',
    opensAt: iso(-2 * HOURS),
    closesAt: iso(49 * HOURS),
    minimumBid: 50,
    bounceFee: MOCK_BOUNCE_FEE,
    bidderCount: 1,
    winnerName: null,
    winningPrice: null,
    bounces: [],
    myBidAmount: null,
  },
  {
    id: 'mock-auction-scheduled',
    status: 'scheduled',
    itemIcon: '🎟️',
    itemName: 'Safety Ticket',
    itemEffectLine: 'If an insured bet loses, your full stake comes back.',
    description: 'Next week’s ticket. Start hoarding pins.',
    opensAt: iso(3 * 24 * HOURS),
    closesAt: iso(6 * 24 * HOURS),
    minimumBid: 100,
    bounceFee: MOCK_BOUNCE_FEE,
    bidderCount: 0,
    winnerName: null,
    winningPrice: null,
    bounces: [],
    myBidAmount: null,
  },
  {
    id: 'mock-auction-settled-won',
    status: 'settled',
    itemIcon: '🎟️',
    itemName: 'Safety Ticket',
    itemEffectLine: 'If an insured bet loses, your full stake comes back.',
    description: 'Last week’s ticket.',
    opensAt: iso(-9 * 24 * HOURS),
    closesAt: iso(-6 * 24 * HOURS),
    minimumBid: 100,
    bounceFee: MOCK_BOUNCE_FEE,
    bidderCount: 5,
    winnerName: 'Jordan',
    winningPrice: 210,
    bounces: [{ playerName: 'Marcus', feePaid: 50 }, { playerName: 'Deron', feePaid: 35 }],
    myBidAmount: 120,
  },
  {
    id: 'mock-auction-no-sale',
    status: 'settled_no_winner',
    itemIcon: '👑',
    itemName: 'Lane Boss Crown',
    itemEffectLine: 'Cosmetic bragging rights, honored by the House.',
    description: 'Nobody wanted the crown. Cowards.',
    opensAt: iso(-16 * 24 * HOURS),
    closesAt: iso(-13 * 24 * HOURS),
    minimumBid: 300,
    bounceFee: MOCK_BOUNCE_FEE,
    bidderCount: 0,
    winnerName: null,
    winningPrice: null,
    bounces: [],
    myBidAmount: null,
  },
]

// Atomic single-use items — "two tickets" is two rows (×2 in the UI).
let items: InventoryItemView[] = [
  {
    id: 'mock-item-active-1',
    itemKey: 'safety_ticket',
    icon: '🎟️',
    name: 'Safety Ticket',
    effectLine: 'If an insured bet loses, your full stake comes back.',
    howToUse: 'Toggle it on when placing a bet in the Sportsbook. The ticket is spent at placement, win or lose.',
    source: 'auction',
    grantedAt: iso(-6 * 24 * HOURS),
    consumedAt: null,
  },
  {
    id: 'mock-item-active-2',
    itemKey: 'safety_ticket',
    icon: '🎟️',
    name: 'Safety Ticket',
    effectLine: 'If an insured bet loses, your full stake comes back.',
    howToUse: 'Toggle it on when placing a bet in the Sportsbook. The ticket is spent at placement, win or lose.',
    source: 'admin_grant',
    grantedAt: iso(-9 * 24 * HOURS),
    consumedAt: null,
  },
  {
    id: 'mock-item-expired',
    itemKey: 'safety_ticket',
    icon: '🎟️',
    name: 'Safety Ticket',
    effectLine: 'If an insured bet loses, your full stake comes back.',
    howToUse: 'Toggle it on when placing a bet in the Sportsbook. The ticket is spent at placement, win or lose.',
    source: 'admin_grant',
    grantedAt: iso(-20 * 24 * HOURS),
    consumedAt: iso(-12 * 24 * HOURS),
  },
]

type Result = Promise<{ error: { message: string } | null }>
const ok = (): Result => Promise.resolve({ error: null })
const fail = (message: string): Result => Promise.resolve({ error: { message } })

export function readAuctions(): AuctionView[] {
  return auctions.map(a => ({ ...a, bounces: [...a.bounces] }))
}

export function readItems(): InventoryItemView[] {
  return items.map(i => ({ ...i }))
}

export function placeBid(auctionId: string, amount: number): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a || a.status !== 'open') return fail('Auction is not open for bids')
  if (amount < a.minimumBid) return fail(`Bid must be at least ${a.minimumBid}`)
  if (amount > MOCK_BALANCE) return fail('Bid exceeds your balance')
  if (a.myBidAmount == null) a.bidderCount += 1
  a.myBidAmount = amount
  return ok()
}

export function cancelBid(auctionId: string): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a || a.status !== 'open') return fail('Auction is not open')
  if (a.myBidAmount == null) return fail('No bid to cancel')
  a.myBidAmount = null
  a.bidderCount = Math.max(0, a.bidderCount - 1)
  return ok()
}

export interface AuctionInput {
  itemKey: string
  description: string
  minimumBid: number
  opensAt: string
  closesAt: string
}

export function createAuction(input: AuctionInput): Result {
  const cat = mockCatalog.find(c => c.key === input.itemKey)
  if (!cat) return fail('Unknown catalog item')
  auctions = [
    {
      id: `mock-auction-${Date.now()}`,
      status: new Date(input.opensAt).getTime() <= Date.now() ? 'open' : 'scheduled',
      itemIcon: cat.icon,
      itemName: cat.name,
      itemEffectLine: cat.effectLine,
      description: input.description,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      minimumBid: input.minimumBid,
      bounceFee: MOCK_BOUNCE_FEE,
      bidderCount: 0,
      winnerName: null,
      winningPrice: null,
      bounces: [],
      myBidAmount: null,
    },
    ...auctions,
  ]
  return ok()
}

export function updateAuction(auctionId: string, input: AuctionInput): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a) return fail('Auction not found')
  if (a.status !== 'scheduled') return fail('Metadata is frozen once the auction opens')
  const cat = mockCatalog.find(c => c.key === input.itemKey)
  if (!cat) return fail('Unknown catalog item')
  Object.assign(a, {
    itemIcon: cat.icon, itemName: cat.name, itemEffectLine: cat.effectLine,
    description: input.description, minimumBid: input.minimumBid,
    opensAt: input.opensAt, closesAt: input.closesAt,
  })
  return ok()
}

export function openAuctionNow(auctionId: string): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a || a.status !== 'scheduled') return fail('Only scheduled auctions can be opened')
  a.status = 'open'
  a.opensAt = new Date().toISOString()
  return ok()
}

export function settleAuctionNow(auctionId: string): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a || a.status !== 'open') return fail('Only open auctions can be settled')
  if (a.bidderCount === 0) {
    a.status = 'settled_no_winner'
  } else {
    a.status = 'settled'
    a.winnerName = a.myBidAmount != null ? 'You' : 'Jordan'
    a.winningPrice = a.myBidAmount ?? a.minimumBid
  }
  return ok()
}

export function cancelAuction(auctionId: string): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a) return fail('Auction not found')
  if (a.status === 'settled' || a.status === 'settled_no_winner') {
    return fail('Settled auctions are reversed, not cancelled')
  }
  auctions = auctions.filter(x => x.id !== auctionId)
  return ok()
}

export function reverseAuction(auctionId: string): Result {
  const a = auctions.find(x => x.id === auctionId)
  if (!a || (a.status !== 'settled' && a.status !== 'settled_no_winner')) {
    return fail('Only settled auctions can be reversed')
  }
  auctions = auctions.filter(x => x.id !== auctionId)
  return ok()
}
