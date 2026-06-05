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
  // Game in progress: market closed for betting, still shown but not bettable.
  inProgress: boolean
}

// One resolved leg of a bet (a single backed over/under selection).
export interface LegView {
  subjectName: string
  pick: string              // selection key: 'over' | 'under'
  line: number
  gameNumber: number | null
  actualScore: number | null
  result: string | null     // won | lost | push | void | null (pending)
}

// A flattened O/U bet. Single bets carry one leg; a parlay carries N. The
// top-level pick/line/gameNumber/etc. mirror the first leg for single-bet
// rendering paths; multi-leg consumers read `legs` / `legCount`.
export interface BetView {
  id: string
  playerId: string
  bettorName: string
  stake: number
  status: string            // pending | won | lost | push | void | cancelled
  settledAt: string | null
  potentialPayout: number
  pick: string              // first leg's selection key: 'over' | 'under'
  line: number
  gameNumber: number | null
  subjectName: string
  marketId: string          // first leg's market
  marketStatus: string
  actualScore: number | null
  weekNumber: number | null
  seasonNumber: number | null
  legs: LegView[]
  legCount: number
}

// Collapse bet → legs → selections → markets into a flat row. A single O/U bet
// has one leg; a parlay has many (combined odds = Π of the legs' odds).
export function normalizeBet(b: any): BetView {
  const rawLegs: any[] = b.bet_legs ?? []
  const legs: LegView[] = rawLegs.map((leg: any) => {
    const sel = leg?.bet_selections
    const mkt = sel?.bet_markets
    return {
      subjectName: mkt?.subject?.name ?? '—',
      pick: sel?.key ?? '',
      line: Number(leg?.line_at_placement ?? sel?.line ?? 0),
      gameNumber: mkt?.game_number ?? null,
      actualScore: mkt?.result_value != null ? Number(mkt.result_value) : null,
      result: leg?.result ?? null,
    }
  })

  const firstLeg = rawLegs[0]
  const firstSel = firstLeg?.bet_selections
  const firstMkt = firstSel?.bet_markets
  return {
    id: b.id,
    playerId: b.player_id,
    bettorName: b.players?.name ?? '—',
    stake: b.stake,
    status: b.status,
    settledAt: b.settled_at,
    potentialPayout: b.potential_payout,
    pick: firstSel?.key ?? '',
    line: Number(firstLeg?.line_at_placement ?? firstSel?.line ?? 0),
    gameNumber: firstMkt?.game_number ?? null,
    subjectName: firstMkt?.subject?.name ?? '—',
    marketId: firstMkt?.id ?? '',
    marketStatus: firstMkt?.status ?? '',
    actualScore: firstMkt?.result_value != null ? Number(firstMkt.result_value) : null,
    weekNumber: firstMkt?.weeks?.week_number ?? null,
    seasonNumber: firstMkt?.weeks?.seasons?.number ?? null,
    legs,
    legCount: legs.length,
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
    inProgress: m.status === 'closed',
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
  // Season pin-balance scoreboard: active players sorted high → low.
  // `movement` = rank change vs. the prior week (null = no prior week / new entry).
  const [leaderboard, setLeaderboard] = useState<{ playerId: string; name: string; balance: number; potential: number; movement: 'up' | 'down' | 'same' | null }[]>([])
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
      // The current week row is created the moment the prior week is archived, so
      // its created_at is the cutoff between "last week's" ledger and this week's.
      const weekStart = weekRes.data?.created_at ?? null
      setCurrentWeekId(weekId)
      setCurrentSeasonId(seasonId)

      const fetches: PromiseLike<any>[] = []

      // Open O/U markets + all bets for this week
      let marketsData: any[] = []
      let weekBetsData: any[] = []
      if (weekId) {
        fetches.push(
          betMarkets.listActiveOUByWeek(weekId).then(({ data }) => {
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
      // active players, sort high → low. `priorBalance` sums only rows from before
      // the current week started — the player's standing at the end of last week.
      const byPlayer: Record<string, { playerId: string; name: string; balance: number; priorBalance: number; isActive: boolean }> = {}
      for (const e of seasonLedger) {
        const pid = e.player_id
        if (!pid) continue
        if (!byPlayer[pid]) {
          byPlayer[pid] = {
            playerId: pid,
            name: e.players?.name ?? '—',
            balance: 0,
            priorBalance: 0,
            isActive: e.players?.is_active ?? true,
          }
        }
        byPlayer[pid].balance += e.amount
        if (weekStart && e.created_at && e.created_at < weekStart) {
          byPlayer[pid].priorBalance += e.amount
        }
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

      const activePlayers = Object.values(byPlayer).filter(p => p.isActive)

      // Prior-week ranking (by end-of-last-week balance). Only meaningful once
      // there is a prior week to diff against — `weekStart` gates that.
      const priorRank = new Map<string, number>()
      if (weekStart) {
        activePlayers
          .slice()
          .sort((a, b) => b.priorBalance - a.priorBalance)
          .forEach((p, i) => priorRank.set(p.playerId, i))
      }

      const board = activePlayers
        .map(({ playerId, name, balance }) => ({
          playerId,
          name,
          balance,
          potential: balance + (pendingByPlayer[playerId] ?? 0),
        }))
        .sort((a, b) => b.potential - a.potential)
        .map((p, i) => {
          const prev = priorRank.get(p.playerId)
          const movement: 'up' | 'down' | 'same' | null =
            prev === undefined ? null : i < prev ? 'up' : i > prev ? 'down' : 'same'
          return { ...p, movement }
        })

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
