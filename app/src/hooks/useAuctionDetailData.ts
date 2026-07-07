import { auctions, auctionLedger, pinLedger, seasons } from '../utils/supabase/db'
import { AuctionView } from '../utils/auction'
import { computeBalance } from '../utils/ledger'
import { bouncesByAuction, normalizeAuction, purchasesByAuction } from './useAuctionHouseData'
import { useAsyncData } from './useAsyncData'

export interface AuctionDetailData {
  loading: boolean
  balance: number
  auction: AuctionView | null
  reload: () => Promise<void>
}

type AuctionDetailPayload = Pick<AuctionDetailData, 'balance' | 'auction'>

const EMPTY: AuctionDetailPayload = { balance: 0, auction: null }

// One auction with the viewer's decoded bid (owner-only) and the public
// bounce story. Countdown ticking lives in the screen, not here.
export function useAuctionDetailData(auctionId: string, playerId: string | null): AuctionDetailData {
  const { loading, data, reload } = useAsyncData<AuctionDetailPayload>(async () => {
    if (!playerId) return EMPTY

    const seasonRes = await seasons.getCurrent()
    const seasonId = seasonRes.data?.id ?? null
    if (!seasonId) return EMPTY

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

    const balance = computeBalance(ledgerData)
    if (!row) return { balance, auction: null }
    const bounceMap = bouncesByAuction(auctionLedgerData)
    const winnerMap = purchasesByAuction(auctionLedgerData)
    return {
      balance,
      auction: normalizeAuction(row, myAmount, bounceMap.get(row.id) ?? [], winnerMap.get(row.id) ?? []),
    }
  }, [auctionId, playerId], 'useAuctionDetailData')

  return { loading, ...(data ?? EMPTY), reload }
}
