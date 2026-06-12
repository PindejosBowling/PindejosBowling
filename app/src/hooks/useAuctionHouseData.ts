import { useState, useCallback, useEffect, useRef } from 'react'
import { auctions, auctionLedger, inventoryItems, pinLedger, seasons } from '../utils/supabase/db'
import {
  AuctionBounceView, AuctionView, InventoryItemView, itemHowToUse,
} from '../utils/auction'

// A flattened auctions row + catalog embed. The DB stores one terminal status
// ('settled'); the view synthesizes 'settled_no_winner' from the null-winner
// denorm for display. myBidAmount is filled only where the viewer holds the
// active bid (owner-only RLS + the my_bid_amount decode RPC).
export function normalizeAuction(
  row: any,
  myBidAmount: number | null,
  bounces: AuctionBounceView[],
): AuctionView {
  const cat = row.item_catalog ?? {}
  const settledNoWinner = row.status === 'settled' && row.winner_player_id == null
  return {
    id: row.id,
    status: settledNoWinner ? 'settled_no_winner' : row.status,
    itemKey: cat.key ?? '',
    itemIcon: cat.icon ?? '🎁',
    itemName: cat.name ?? 'Mystery Item',
    itemEffectLine: cat.description ?? '',
    description: row.description,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    minimumBid: row.minimum_bid,
    bounceFee: row.bounce_fee,
    bidderCount: row.bidder_count,
    winnerName: row.winner?.name ?? null,
    winningPrice: row.winning_price ?? null,
    bounces,
    myBidAmount,
  }
}

export function normalizeInventoryItem(row: any): InventoryItemView {
  const cat = row.item_catalog ?? {}
  return {
    id: row.id,
    itemKey: cat.key ?? '',
    icon: cat.icon ?? '🎁',
    name: cat.name ?? 'Mystery Item',
    effectLine: cat.description ?? '',
    howToUse: itemHowToUse(cat.activation_mode ?? ''),
    source: row.source,
    grantedAt: row.granted_at,
    consumedAt: row.consumed_at ?? null,
  }
}

// Player-side bounce rows (auction_check_bounce) grouped per auction — the
// public bounce story is name + fee; pledged amounts no longer exist anywhere.
export function bouncesByAuction(ledgerRows: any[]): Map<string, AuctionBounceView[]> {
  const map = new Map<string, AuctionBounceView[]>()
  for (const r of ledgerRows) {
    if (r.type !== 'auction_check_bounce' || !r.auction_id) continue
    const list = map.get(r.auction_id) ?? []
    list.push({ playerName: r.players?.name ?? '—', feePaid: Math.abs(r.amount) })
    map.set(r.auction_id, list)
  }
  return map
}

export interface AuctionHouseData {
  loading: boolean
  balance: number
  auctions: AuctionView[]
  myItems: InventoryItemView[]
  reload: () => Promise<void>
}

// List data for AuctionHouseScreen. Sectioning/sorting/grouping is pure
// compute (auctionSections / groupInventory) — wrap in useMemo at the screen.
export function useAuctionHouseData(playerId: string | null): AuctionHouseData {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [auctionList, setAuctionList] = useState<AuctionView[]>([])
  const [myItems, setMyItems] = useState<InventoryItemView[]>([])
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true)
    try {
      const reset = () => { setBalance(0); setAuctionList([]); setMyItems([]) }
      if (!playerId) { reset(); return }

      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) { reset(); return }

      let ledgerData: any[] = []
      let auctionData: any[] = []
      let itemData: any[] = []
      let myBidRows: any[] = []
      let auctionLedgerData: any[] = []
      await Promise.all([
        pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerData = data ?? [] }),
        auctions.listBySeason(seasonId).then(({ data }) => { auctionData = data ?? [] }),
        inventoryItems.listByPlayerSeason(playerId, seasonId).then(({ data }) => { itemData = data ?? [] }),
        auctions.listMyBids().then(({ data }) => { myBidRows = data ?? [] }),
        auctionLedger.listBySeason(seasonId).then(({ data }) => { auctionLedgerData = data ?? [] }),
      ])

      // Decode the viewer's own amounts only where a bid exists (a handful of
      // open auctions at most — the per-auction RPC is fine at league scale).
      const myBidAuctionIds = myBidRows.map(b => b.auction_id)
      const amounts = await Promise.all(
        myBidAuctionIds.map(id => auctions.myBidAmount(id).then(({ data }) => [id, data as number | null] as const)),
      )
      const myAmounts = new Map(amounts)
      const bounceMap = bouncesByAuction(auctionLedgerData)

      setBalance(ledgerData.reduce((sum, e) => sum + e.amount, 0))
      setAuctionList(auctionData.map(row =>
        normalizeAuction(row, myAmounts.get(row.id) ?? null, bounceMap.get(row.id) ?? [])))
      setMyItems(itemData.map(normalizeInventoryItem))
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, auctions: auctionList, myItems, reload: load }
}
