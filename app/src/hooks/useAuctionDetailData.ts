import { useCallback, useEffect, useState } from 'react'
import { AuctionView } from '../utils/auction'
// MOCK: fixture-backed until the auction DB layer lands — swap these imports
// for db.ts query objects and delete utils/auctionMockStore.ts.
import { MOCK_BALANCE, readAuctions } from '../utils/auctionMockStore'

export interface AuctionDetailData {
  loading: boolean
  balance: number
  auction: AuctionView | null
  reload: () => Promise<void>
}

export function useAuctionDetailData(auctionId: string, playerId: string | null): AuctionDetailData {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [auction, setAuction] = useState<AuctionView | null>(null)

  const reload = useCallback(async () => {
    // MOCK: synchronous fixture read stands in for the db.ts fetch.
    setBalance(MOCK_BALANCE)
    setAuction(readAuctions().find(a => a.id === auctionId) ?? null)
    setLoading(false)
  }, [auctionId, playerId])

  useEffect(() => { reload() }, [reload])

  return { loading, balance, auction, reload }
}
