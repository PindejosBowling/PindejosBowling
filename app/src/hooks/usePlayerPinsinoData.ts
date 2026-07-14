import { useState, useCallback, useEffect } from 'react'
import { seasons, bets, pinLedger, loanLedger } from '../utils/supabase/db'
import { BetView, normalizeBet } from './usePinsinoData'
import { computeBalance, computeDebt } from '../utils/ledger'

export interface LedgerEntry {
  id: string
  amount: number
  type: string
  description: string
  created_at: string
  weekNumber: number | null
  bet: BetView | null   // populated for bet_stake / bet_payout / bet_refund rows
}

export function usePlayerPinsinoData(playerId: string | null, viewSeasonId?: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [debt, setDebt] = useState(0)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [openBets, setOpenBets] = useState<BetView[]>([])
  const [settledBets, setSettledBets] = useState<BetView[]>([])
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  const [seasonConcluded, setSeasonConcluded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!playerId) {
        setBalance(0)
        setDebt(0)
        setLedger([])
        setOpenBets([])
        setSettledBets([])
        return
      }

      // Past-season mode points at the requested prior season; otherwise (and
      // between seasons) falls back to the most-recently-ended season so the
      // player's final ledger/balance stays visible until the next one starts.
      let seasonId: string | null
      let resolvedSeasonNumber: number | null
      if (viewSeasonId) {
        const seasonRes = await seasons.getById(viewSeasonId)
        seasonId = seasonRes.data?.id ?? null
        resolvedSeasonNumber = seasonRes.data?.number ?? null
        setSeasonNumber(resolvedSeasonNumber)
        setSeasonConcluded(true)
      } else {
        const seasonRes = await seasons.getCurrentOrLastEnded()
        seasonId = seasonRes.data?.id ?? null
        resolvedSeasonNumber = seasonRes.data?.number ?? null
        setSeasonNumber(resolvedSeasonNumber)
        setSeasonConcluded(seasonRes.concluded)
      }

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

      // Outstanding loan debt this season. SUM(amount) over the player's
      // loan_ledger rows = net owed across all their loans (paid-off/settled
      // loans net to 0), matching the net-worth leaderboard's Debt column.
      let debtData: any[] = []
      if (seasonId) {
        fetches.push(
          loanLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => {
            debtData = data ?? []
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

      // Normalize bets. `bets.listByPlayer` is all-time, so in past-season mode
      // scope the open (pending) bets to the viewed season — a concluded season
      // has none, and we must not leak the live season's pending bets here.
      const allBetViews = allBetsData.map(normalizeBet)
      const openBetViews = allBetViews
        .filter(b => b.status === 'pending')
        .filter(b => !viewSeasonId || b.seasonNumber === resolvedSeasonNumber)
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

      // Calculate spendable pin balance and outstanding loan debt (≥ 0).
      const playerBalance = computeBalance(ledgerData)
      const playerDebt = computeDebt(debtData)

      setBalance(playerBalance)
      setDebt(playerDebt)
      setLedger(ledgerEntries)
      setOpenBets(openBetViews)
      setSettledBets(settledBetViews)
    } catch (e) {
      console.error('usePlayerPinsinoData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId, viewSeasonId])

  useEffect(() => {
    load()
  }, [load])

  return { loading, balance, debt, netWorth: balance - debt, ledger, openBets, settledBets, seasonNumber, seasonConcluded, reload: load }
}
