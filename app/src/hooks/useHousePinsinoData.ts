import { useState, useCallback, useEffect } from 'react'
import { seasons, weeks, bets, pinLedger } from '../utils/supabase/db'
import { normalizeBet, type BetView } from './usePinsinoData'
import { LedgerEntry } from './usePlayerPinsinoData'

// The house side of the pin economy — the literal other side of
// usePlayerPinsinoData. House rows are `is_house = true` / `player_id NULL`.
export interface HouseSummary {
  stakesTaken: number  // Σ bet_stake  (+, stakes the house accepts)
  payouts: number      // Σ bet_payout (−, paid out on player wins)
  bonuses: number      // Σ bonus      (−, house-funded bonuses paid out)
}

export interface WeekPnl {
  weekNumber: number
  net: number
}

// Season-level house performance, derived from settled + pending bets.
export interface HouseStats {
  settledCount: number   // bets the house has resolved this season
  houseWins: number      // player lost → house kept the stake
  houseLosses: number    // player won → house paid out
  pushes: number         // refunded, no edge either way
  bettors: number        // distinct players who have bet this season
  biggestPayout: number  // largest single payout the house has made (a player win)
  biggestTake: number    // largest single stake the house kept (a player loss)
  holdPct: number | null // house betting net ÷ stakes taken (null when no stakes)
}

const EMPTY_SUMMARY: HouseSummary = { stakesTaken: 0, payouts: 0, bonuses: 0 }
const EMPTY_STATS: HouseStats = {
  settledCount: 0, houseWins: 0, houseLosses: 0, pushes: 0, bettors: 0, biggestPayout: 0, biggestTake: 0, holdPct: null,
}

export function useHousePinsinoData() {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [summary, setSummary] = useState<HouseSummary>(EMPTY_SUMMARY)
  const [weekPnl, setWeekPnl] = useState<WeekPnl[]>([])
  const [exposure, setExposure] = useState(0)
  const [stats, setStats] = useState<HouseStats>(EMPTY_STATS)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  // True when no season is live and we're showing the most-recently-ended
  // season's frozen final outcome.
  const [seasonConcluded, setSeasonConcluded] = useState(false)
  // Current season/week ids, exposed for admin surfaces that scope writes
  // (e.g. the Specials manager's week pickers).
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null)
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  // All of this week's bets + this season's settled bets, so the admin screen can
  // reuse the same Active/Settled surfaces the public Pinsino tab renders.
  const [weekBets, setWeekBets] = useState<BetView[]>([])
  const [settledBets, setSettledBets] = useState<BetView[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Falls back to the most-recently-ended season between seasons so the
      // House's final accounting stays visible until the next season starts.
      const seasonRes = await seasons.getCurrentOrLastEnded()
      const seasonId = seasonRes.data?.id ?? null
      setSeasonNumber(seasonRes.data?.number ?? null)
      setSeasonConcluded(seasonRes.concluded)
      setCurrentSeasonId(seasonId)

      if (!seasonId) {
        setBalance(0); setLedger([]); setSummary(EMPTY_SUMMARY); setWeekPnl([])
        setExposure(0); setStats(EMPTY_STATS); setWeekBets([]); setSettledBets([])
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
      setCurrentWeekId(weekId)
      if (weekId) {
        fetches.push(
          bets.listByWeek(weekId).then(({ data }) => { weekBetsData = data ?? [] })
        )
      }

      // Settled bets this season — drives the house performance stats.
      let settledData: any[] = []
      fetches.push(
        bets.listSettledBySeason(seasonId).then(({ data }) => { settledData = data ?? [] })
      )

      await Promise.all(fetches)

      const ledgerEntries: LedgerEntry[] = houseData.map((e) => ({
        id: e.id,
        amount: e.amount,
        type: e.type,
        description: e.description,
        created_at: e.created_at,
        weekNumber: (e.weeks as any)?.week_number ?? null,
        bet: e.bets ? normalizeBet(e.bets) : null,
      }))

      const nextSummary: HouseSummary = { ...EMPTY_SUMMARY }
      for (const e of houseData) {
        if (e.type === 'bet_stake') nextSummary.stakesTaken += e.amount
        else if (e.type === 'bet_payout') nextSummary.payouts += e.amount
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

      const weekBetViews = weekBetsData.map(normalizeBet)
      const houseExposure = weekBetViews
        .filter(b => b.status === 'pending')
        .reduce((s, b) => s + (b.potentialPayout ?? 0), 0)

      // House performance from settled bets (player status is the bettor's; the
      // house is the mirror — a player win is a house loss, etc.).
      const settledViews = settledData.map(normalizeBet)
      const nextStats: HouseStats = { ...EMPTY_STATS }
      nextStats.settledCount = settledViews.length
      for (const b of settledViews) {
        if (b.status === 'won') {
          nextStats.houseLosses += 1
          if (b.potentialPayout > nextStats.biggestPayout) nextStats.biggestPayout = b.potentialPayout
        } else if (b.status === 'lost') {
          nextStats.houseWins += 1
          if (b.stake > nextStats.biggestTake) nextStats.biggestTake = b.stake
        } else if (b.status === 'push' || b.status === 'void') {
          nextStats.pushes += 1
        }
      }
      // Distinct bettors across settled + this week's pending bets.
      const bettorIds = new Set<string>()
      for (const b of settledViews) bettorIds.add(b.playerId)
      for (const b of weekBetViews) bettorIds.add(b.playerId)
      nextStats.bettors = bettorIds.size
      // Hold = house betting net (stakes minus payouts) ÷ stakes taken.
      const bettingNet = nextSummary.stakesTaken + nextSummary.payouts
      nextStats.holdPct = nextSummary.stakesTaken > 0
        ? (bettingNet / nextSummary.stakesTaken) * 100
        : null

      setBalance(houseData.reduce((sum, e) => sum + e.amount, 0))
      setLedger(ledgerEntries)
      setSummary(nextSummary)
      setWeekPnl(pnl)
      setExposure(houseExposure)
      setStats(nextStats)
      setWeekBets(weekBetViews)
      setSettledBets(settledViews)
    } catch (e) {
      console.error('useHousePinsinoData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, balance, ledger, summary, weekPnl, exposure, stats, seasonNumber, seasonConcluded, currentSeasonId, currentWeekId, weekBets, settledBets, reload: load }
}
