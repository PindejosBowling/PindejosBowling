import { useState, useCallback, useEffect } from 'react'
import { seasons, weeks, bets, pinLedger } from '../utils/supabase/db'
import { normalizeBet } from './useBettingData'
import { LedgerEntry } from './usePlayerBettingDetailData'

// The house side of the pin economy — the literal other side of
// usePlayerBettingDetailData. House rows are `is_house = true` / `player_id NULL`.
export interface HouseSummary {
  stakesTaken: number  // Σ bet_stake  (+, stakes the house accepts)
  payouts: number      // Σ bet_payout (−, paid out on player wins)
  refunds: number      // Σ bet_refund (−, refunded on pushes)
  bonuses: number      // Σ bonus      (−, house-funded bonuses paid out)
}

export interface WeekPnl {
  weekNumber: number
  net: number
}

const EMPTY_SUMMARY: HouseSummary = { stakesTaken: 0, payouts: 0, refunds: 0, bonuses: 0 }

export function useHouseBettingData() {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [summary, setSummary] = useState<HouseSummary>(EMPTY_SUMMARY)
  const [weekPnl, setWeekPnl] = useState<WeekPnl[]>([])
  const [exposure, setExposure] = useState(0)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      setSeasonNumber(seasonRes.data?.number ?? null)

      if (!seasonId) {
        setBalance(0); setLedger([]); setSummary(EMPTY_SUMMARY); setWeekPnl([]); setExposure(0)
        return
      }

      const fetches: PromiseLike<any>[] = []

      // House ledger for the season
      let houseData: any[] = []
      fetches.push(
        pinLedger.listHouseBySeason(seasonId).then(({ data }) => { houseData = data ?? [] })
      )

      // Current-week outstanding liability (exposure) — sum of potential payout
      // over all still-pending bets this week.
      let weekBetsData: any[] = []
      const weekRes = await weeks.getCurrent()
      const weekId = weekRes.data?.id ?? null
      if (weekId) {
        fetches.push(
          bets.listByWeek(weekId).then(({ data }) => { weekBetsData = data ?? [] })
        )
      }

      await Promise.all(fetches)

      const ledgerEntries: LedgerEntry[] = houseData.map((e) => ({
        id: e.id,
        amount: e.amount,
        type: e.type,
        description: e.description,
        created_at: e.created_at,
        weekNumber: (e.weeks as any)?.week_number ?? null,
      }))

      const nextSummary: HouseSummary = { ...EMPTY_SUMMARY }
      for (const e of houseData) {
        if (e.type === 'bet_stake') nextSummary.stakesTaken += e.amount
        else if (e.type === 'bet_payout') nextSummary.payouts += e.amount
        else if (e.type === 'bet_refund') nextSummary.refunds += e.amount
        else if (e.type === 'bonus') nextSummary.bonuses += e.amount
      }

      // Per-week house net (skip week-less rows like season-open bonuses)
      const byWeek: Record<number, number> = {}
      for (const e of ledgerEntries) {
        if (e.weekNumber == null) continue
        byWeek[e.weekNumber] = (byWeek[e.weekNumber] ?? 0) + e.amount
      }
      const pnl: WeekPnl[] = Object.keys(byWeek)
        .map(Number)
        .sort((a, b) => b - a)
        .map(weekNumber => ({ weekNumber, net: byWeek[weekNumber] }))

      const houseExposure = weekBetsData
        .map(normalizeBet)
        .filter(b => b.status === 'pending')
        .reduce((s, b) => s + (b.potentialPayout ?? 0), 0)

      setBalance(houseData.reduce((sum, e) => sum + e.amount, 0))
      setLedger(ledgerEntries)
      setSummary(nextSummary)
      setWeekPnl(pnl)
      setExposure(houseExposure)
    } catch (e) {
      console.error('useHouseBettingData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, balance, ledger, summary, weekPnl, exposure, seasonNumber, reload: load }
}
