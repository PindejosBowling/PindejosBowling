import { useState, useCallback, useEffect, useRef } from 'react'
import { auctions, auctionLedger, pinLedger, seasons } from '../utils/supabase/db'
import { AuctionView } from '../utils/auction'
import { computeBalance } from '../utils/ledger'
import { bouncesByAuction, normalizeAuction, purchasesByAuction } from './useAuctionHouseData'

export interface AuctionDetailData {
  loading: boolean
  balance: number
  auction: AuctionView | null
  reload: () => Promise<void>
}

// One auction with the viewer's decoded bid (owner-only) and the public
// bounce story. Countdown ticking lives in the screen, not here.
export function useAuctionDetailData(auctionId: string, playerId: string | null): AuctionDetailData {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [auction, setAuction] = useState<AuctionView | null>(null)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true)
    try {
      const reset = () => { setBalance(0); setAuction(null) }
      if (!playerId) { reset(); return }

      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) { reset(); return }

      let row: any = null
      let myAmount: number | null = null
      let ledgerData: any[] = []
      let auctionLedgerData: any[] = []
      await Promise.all([
        auctions.getById(auctionId).then(({ data }) => { row = data }),
        auctions.myBidAmount(auctionId).then(({ data }) => { myAmount = (data as number | null) ?? null }),
        pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => { ledgerData = data ?? [] }),
        auctionLedger.listBySeason(seasonId).then(({ data }) => { auctionLedgerData = data ?? [] }),
      ])

      setBalance(computeBalance(ledgerData))
      if (!row) { setAuction(null); return }
      const bounceMap = bouncesByAuction(auctionLedgerData)
      const winnerMap = purchasesByAuction(auctionLedgerData)
      setAuction(normalizeAuction(row, myAmount, bounceMap.get(row.id) ?? [], winnerMap.get(row.id) ?? []))
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [auctionId, playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, auction, reload: load }
}
