import { useState, useCallback, useEffect } from 'react'
import { seasons, bets, pinLedger } from '../utils/supabase/db'
import { BetView, normalizeBet } from './useBettingData'

export interface LedgerEntry {
  id: string
  amount: number
  type: string
  description: string
  created_at: string
  weekNumber: number | null
  bet: BetView | null   // populated for bet_stake / bet_payout / bet_refund rows
}

export function usePlayerBettingDetailData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [openBets, setOpenBets] = useState<BetView[]>([])
  const [settledBets, setSettledBets] = useState<BetView[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!playerId) {
        setBalance(0)
        setLedger([])
        setOpenBets([])
        setSettledBets([])
        return
      }

      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null

      const fetches: PromiseLike<any>[] = []

      // Ledger entries + balance
      let ledgerData: any[] = []
      if (seasonId) {
        fetches.push(
          pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => {
            ledgerData = data ?? []
          })
        )
      }

      // Player's bets (all-time, will filter for pending)
      let allBetsData: any[] = []
      fetches.push(
        bets.listByPlayer(playerId).then(({ data }) => {
          allBetsData = data ?? []
        })
      )

      // Settled bets this season
      let settledBetsData: any[] = []
      if (seasonId) {
        fetches.push(
          bets.listSettledBySeason(seasonId).then(({ data }) => {
            settledBetsData = data ?? []
          })
        )
      }

      await Promise.all(fetches)

      // Normalize bets
      const allBetViews = allBetsData.map(normalizeBet)
      const openBetViews = allBetViews.filter(b => b.status === 'pending')
      const settledBetViews = settledBetsData
        .map(normalizeBet)
        .filter(b => b.playerId === playerId)

      // Extract ledger as LedgerEntry type
      const ledgerEntries: LedgerEntry[] = ledgerData.map((e) => ({
        id: e.id,
        amount: e.amount,
        type: e.type,
        description: e.description,
        created_at: e.created_at,
        weekNumber: (e.weeks as any)?.week_number ?? null,
        bet: e.bets ? normalizeBet(e.bets) : null,
      }))

      // Calculate balance
      const playerBalance = ledgerData.reduce((sum, e) => sum + e.amount, 0)

      setBalance(playerBalance)
      setLedger(ledgerEntries)
      setOpenBets(openBetViews)
      setSettledBets(settledBetViews)
    } catch (e) {
      console.error('usePlayerBettingDetailData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => {
    load()
  }, [load])

  return { loading, balance, ledger, openBets, settledBets, reload: load }
}
