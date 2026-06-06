import { useState, useCallback, useEffect } from 'react'
import { weeks, seasons, betMarkets, bets, pinLedger } from '../utils/supabase/db'

// One bettable side of a market (a single `bet_selections` row, flattened).
// Generic over market_type — over/under is the first consumer, but the shape
// carries any side (over/under, yes/no, a moneyline pick, …) so new market
// types reuse it without bespoke fields.
export interface SelectionView {
  selectionId: string
  key: string            // stable side key: 'over' | 'under' | 'yes' | a player id, …
  label: string          // display label ('Over', 'Under', …)
  line: number | null    // this side's total/handicap (the O/U number); null if n/a
  odds: number           // decimal odds (2.000 = even money)
}

// A flattened bettable market (one market + its selections). Generic over
// market_type so a single row component renders every line kind.
export interface LineView {
  marketId: string
  marketType: string         // 'over_under' | 'moneyline' | 'prop'
  title: string
  subjectPlayerId: string | null
  subjectName: string
  gameNumber: number | null
  line: number | null        // shared line when every selection shares one (O/U); else null
  selections: SelectionView[]
  // Game in progress: market closed for betting, still shown but not bettable.
  inProgress: boolean
}

// Anti-tanking: a player may never back the side that bets *against* their own
// performance (the `under` on their own O/U line). Encodes the market-type
// semantics in one place — new market types declare their "against the subject"
// side here.
export function selectionBetsAgainstSubject(marketType: string, selectionKey: string): boolean {
  if (marketType === 'over_under') return selectionKey === 'under'
  return false
}

// The section a line is bucketed under on the Place Bets board. Per-game markets
// group by game number; markets with no game (season-long / futures) share one
// group. New market kinds slot in here without the screen knowing their shape.
export interface LineGroup {
  key: string        // stable grouping key (also the React key)
  label: string      // section header — "GAME 1", "SEASON", …
  sortOrder: number  // ascending display order (game order, season-long last)
}

export function lineGroup(line: LineView): LineGroup {
  if (line.gameNumber != null) {
    return { key: `game-${line.gameNumber}`, label: `GAME ${line.gameNumber}`, sortOrder: line.gameNumber }
  }
  // Season-long / futures markets (no game scope) collect at the end.
  return { key: 'season', label: 'SEASON', sortOrder: Number.MAX_SAFE_INTEGER }
}

// The line *category* within a group — one collapsible LineRowContainer. A single
// game can surface several categories (player over/unders, team totals, …), each
// independently collapsible; the label summarizes what's inside on the collapsed
// bar. Market-type aware so new line kinds name their own section.
export interface LineCategory {
  key: string
  label: string
  sortOrder: number
}

export function lineCategory(line: LineView): LineCategory {
  switch (line.marketType) {
    case 'over_under':
      return { key: 'player_ou', label: 'Player Over/Unders', sortOrder: 0 }
    case 'moneyline':
      return { key: 'moneyline', label: 'Moneylines', sortOrder: 1 }
    default:
      return { key: line.marketType, label: line.title || line.marketType, sortOrder: 99 }
  }
}

// Copy shown when a group's betting is closed (the market is in progress).
// Market-type aware so non-game markets read sensibly.
export function closedBettingNote(line: LineView): string {
  if (line.gameNumber != null) return 'The Pinsino does not take action on games in progress'
  return 'The Pinsino does not take action while this market is in progress'
}

// One resolved leg of a bet (a single backed over/under selection).
export interface LegView {
  marketId: string          // the leg's market — settled independently (admin settle)
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
      marketId: mkt?.id ?? '',
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
  const selections: SelectionView[] = (m.bet_selections ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s: any) => ({
      selectionId: s.id,
      key: s.key,
      label: s.label ?? s.key ?? '—',
      line: s.line != null ? Number(s.line) : null,
      odds: Number(s.odds ?? 2),
    }))

  // A "shared line" exists when every selection carries the same line (the O/U
  // case) — surfaced once on the row. Markets whose sides differ (or have no
  // line) leave it null.
  const lineVals = selections.map(s => s.line).filter((v): v is number => v != null)
  const sharedLine =
    lineVals.length > 0 && lineVals.every(v => v === lineVals[0]) ? lineVals[0] : null

  return {
    marketId: m.id,
    marketType: m.market_type,
    title: m.title ?? '',
    subjectPlayerId: m.subject_player_id ?? null,
    subjectName: m.subject?.name ?? '—',
    gameNumber: m.game_number ?? null,
    line: sharedLine,
    selections,
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

      // Cutoff for "last week's results": the most recent settlement (score_credit)
      // timestamp in the season ledger. priorBalance sums only rows strictly before
      // it — i.e. each player's standing *before* last week's scores posted. Derived
      // from the ledger itself (not weeks.created_at) so it survives inconsistent
      // backfill timestamps. null = no settled week yet → no baseline to diff.
      let settleCutoff: string | null = null
      for (const e of seasonLedger) {
        if (e.type === 'score_credit' && e.created_at && (!settleCutoff || e.created_at > settleCutoff)) {
          settleCutoff = e.created_at
        }
      }

      // Sum the season ledger per player (house rows already excluded), keep
      // active players, sort high → low.
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
        if (settleCutoff && e.created_at && e.created_at < settleCutoff) {
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

      // Prior-week ranking (by balance before last week's results posted). Skip it
      // entirely when the baseline is degenerate — no settled week, or every prior
      // balance is identical (the all-backfilled-at-once state) — so we don't draw
      // arrows off an arbitrary tie-break order.
      const priorRank = new Map<string, number>()
      const distinctPrior = new Set(activePlayers.map(p => p.priorBalance))
      if (settleCutoff && distinctPrior.size > 1) {
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
