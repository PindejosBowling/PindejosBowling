import { useCallback, useEffect, useState } from 'react'
import { AuctionView, InventoryItemView } from '../utils/auction'
// MOCK: fixture-backed until the auction DB layer lands — swap these imports
// for db.ts query objects and delete utils/auctionMockStore.ts. The return
// shape is final; only the data source changes.
import { MOCK_BALANCE, readAuctions, readItems } from '../utils/auctionMockStore'

export interface AuctionHouseData {
  loading: boolean
  balance: number
  auctions: AuctionView[]
  myItems: InventoryItemView[]
  reload: () => Promise<void>
}

// List data for AuctionHouseScreen. Sectioning/sorting is pure compute
// (auctionSections / sortInventory) — wrap in useMemo at the screen.
export function useAuctionHouseData(playerId: string | null): AuctionHouseData {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [auctions, setAuctions] = useState<AuctionView[]>([])
  const [myItems, setMyItems] = useState<InventoryItemView[]>([])

  const reload = useCallback(async () => {
    if (!playerId) { setLoading(false); return }
    // MOCK: synchronous fixture reads stand in for the db.ts fetches.
    setBalance(MOCK_BALANCE)
    setAuctions(readAuctions())
    setMyItems(readItems())
    setLoading(false)
  }, [playerId])

  useEffect(() => { reload() }, [reload])

  return { loading, balance, auctions, myItems, reload }
}
