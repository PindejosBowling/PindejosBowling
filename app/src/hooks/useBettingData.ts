import { useState, useCallback, useEffect } from 'react'
import { weeks, seasons, betMarkets, bets, pinLedger } from '../utils/supabase/db'

// A flattened over/under line (one market + its two selections).
export interface LineView {
  marketId: string
  subjectPlayerId: string
  subjectName: string
  gameNumber: number
  line: number
  overSelectionId?: string
  underSelectionId?: string
}

// A flattened single-leg O/U bet (market → selection → leg collapsed).
export interface BetView {
  id: string
  playerId: string
  bettorName: string
  stake: number
  status: string            // pending | won | lost | push | void | cancelled
  settledAt: string | null
  potentialPayout: number
  pick: string              // selection key: 'over' | 'under'
  line: number
  gameNumber: number | null
  subjectName: string
  marketId: string
  marketStatus: string
  actualScore: number | null
  weekNumber: number | null
}

// O/U bets are single-leg: collapse bet → leg → selection → market into a flat row.
function normalizeBet(b: any): BetView {
  const leg = b.bet_legs?.[0]
  const sel = leg?.bet_selections
  const mkt = sel?.bet_markets
  return {
    id: b.id,
    playerId: b.player_id,
    bettorName: b.players?.name ?? '—',
    stake: b.stake,
    status: b.status,
    settledAt: b.settled_at,
    potentialPayout: b.potential_payout,
    pick: sel?.key ?? '',
    line: Number(leg?.line_at_placement ?? sel?.line ?? 0),
    gameNumber: mkt?.game_number ?? null,
    subjectName: mkt?.subject?.name ?? '—',
    marketId: mkt?.id ?? '',
    marketStatus: mkt?.status ?? '',
    actualScore: mkt?.result_value != null ? Number(mkt.result_value) : null,
    weekNumber: mkt?.weeks?.week_number ?? null,
  }
}

function normalizeMarket(m: any): LineView {
  const over = m.bet_selections?.find((s: any) => s.key === 'over')
  const under = m.bet_selections?.find((s: any) => s.key === 'under')
  return {
    marketId: m.id,
    subjectPlayerId: m.subject_player_id,
    subjectName: m.subject?.name ?? '—',
    gameNumber: m.game_number,
    line: Number(over?.line ?? under?.line ?? 0),
    overSelectionId: over?.id,
    underSelectionId: under?.id,
  }
}

export function useBettingData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [openLines, setOpenLines] = useState<LineView[]>([])
  const [myBets, setMyBets] = useState<BetView[]>([])
  // All bets placed by every player this week (for the "Active Bets" view)
  const [weekBets, setWeekBets] = useState<BetView[]>([])
  // All settled (won/lost/push) bets this season (for the "Settled Bets" view)
  const [settledBets, setSettledBets] = useState<BetView[]>([])
  // Season pin-balance scoreboard: active players sorted high → low
  const [leaderboard, setLeaderboard] = useState<{ playerId: string; name: string; balance: number; potential: number }[]>([])
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null)
  // Set of market ids the current player has already placed a bet on
  const [myBetMarketIds, setMyBetMarketIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [weekRes, seasonRes] = await Promise.all([
        weeks.getCurrent(),
        seasons.getCurrent(),
      ])

      const weekId = weekRes.data?.id ?? null
      const seasonId = seasonRes.data?.id ?? null
      setCurrentWeekId(weekId)
      setCurrentSeasonId(seasonId)

      const fetches: PromiseLike<any>[] = []

      // Open O/U markets + all bets for this week
      let marketsData: any[] = []
      let weekBetsData: any[] = []
      if (weekId) {
        fetches.push(
          betMarkets.listOpenOUByWeek(weekId).then(({ data }) => {
            marketsData = data ?? []
          }),
          bets.listByWeek(weekId).then(({ data }) => {
            weekBetsData = data ?? []
          })
        )
      }

      // Season-wide ledger for the pin-balance scoreboard + settled bets history
      let seasonLedger: any[] = []
      let settledBetsData: any[] = []
      if (seasonId) {
        fetches.push(
          pinLedger.listBySeasonForLeaderboard(seasonId).then(({ data }) => {
            seasonLedger = data ?? []
          }),
          bets.listSettledBySeason(seasonId).then(({ data }) => {
            settledBetsData = data ?? []
          })
        )
      }

      // Player's bets and ledger balance
      let myBetsData: any[] = []
      let ledgerData: any[] = []
      if (playerId && seasonId) {
        fetches.push(
          bets.listByPlayer(playerId).then(({ data }) => {
            myBetsData = data ?? []
          }),
          pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => {
            ledgerData = data ?? []
          })
        )
      }

      await Promise.all(fetches)

      const weekBetViews = weekBetsData.map(normalizeBet)
      const myBetViews = myBetsData.map(normalizeBet)

      // Sum the season ledger per player (house rows already excluded), keep
      // active players, sort high → low.
      const byPlayer: Record<string, { playerId: string; name: string; balance: number; isActive: boolean }> = {}
      for (const e of seasonLedger) {
        const pid = e.player_id
        if (!pid) continue
        if (!byPlayer[pid]) {
          byPlayer[pid] = {
            playerId: pid,
            name: e.players?.name ?? '—',
            balance: 0,
            isActive: e.players?.is_active ?? true,
          }
        }
        byPlayer[pid].balance += e.amount
      }
      // Potential winnings: each still-pending bet pays its potential_payout on a
      // win (the stake was already debited at placement), so projected balance =
      // current balance + Σ(potential_payout) over that player's pending bets.
      const pendingByPlayer: Record<string, number> = {}
      for (const b of weekBetViews) {
        if (b.status === 'pending') {
          pendingByPlayer[b.playerId] = (pendingByPlayer[b.playerId] ?? 0) + b.potentialPayout
        }
      }

      const board = Object.values(byPlayer)
        .filter(p => p.isActive)
        .map(({ playerId, name, balance }) => ({
          playerId,
          name,
          balance,
          potential: balance + (pendingByPlayer[playerId] ?? 0),
        }))
        .sort((a, b) => b.potential - a.potential)

      setOpenLines(marketsData.map(normalizeMarket))
      setWeekBets(weekBetViews)
      setSettledBets(settledBetsData.map(normalizeBet))
      setLeaderboard(board)
      setMyBets(myBetViews)
      setBalance(ledgerData.reduce((sum, e) => sum + e.amount, 0))
      setMyBetMarketIds(new Set(myBetViews.map(b => b.marketId)))
    } catch (e) {
      console.error('useBettingData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, openLines, myBets, weekBets, settledBets, leaderboard, myBetMarketIds, currentWeekId, currentSeasonId, reload: load }
}
