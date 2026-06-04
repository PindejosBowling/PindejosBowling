import { useState, useCallback, useEffect } from 'react'
import { weeks, seasons, betLines, placedBets, pinLedger } from '../utils/supabase/db'

export function useBettingData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [openLines, setOpenLines] = useState<any[]>([])
  const [myBets, setMyBets] = useState<any[]>([])
  // All bets placed by every player this week (for the "Active Bets" view)
  const [weekBets, setWeekBets] = useState<any[]>([])
  // All settled (won/lost/push) bets this season (for the "Settled Bets" view)
  const [settledBets, setSettledBets] = useState<any[]>([])
  // Season pin-balance scoreboard: active players sorted high → low
  const [leaderboard, setLeaderboard] = useState<{ playerId: string; name: string; balance: number; potential: number }[]>([])
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null)
  // Set of bet_line ids the current player has already placed a bet on
  const [myBetLineIds, setMyBetLineIds] = useState<Set<string>>(new Set())

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

      // Open bet lines + all placed bets for this week
      let linesData: any[] = []
      let weekBetsData: any[] = []
      if (weekId) {
        fetches.push(
          betLines.listOpenByWeek(weekId).then(({ data }) => {
            linesData = data ?? []
          }),
          placedBets.listByWeek(weekId).then(({ data }) => {
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
          placedBets.listSettledBySeason(seasonId).then(({ data }) => {
            settledBetsData = data ?? []
          })
        )
      }

      // Player's placed bets and ledger balance
      let betsData: any[] = []
      let ledgerData: any[] = []
      if (playerId && seasonId) {
        fetches.push(
          placedBets.listByPlayer(playerId).then(({ data }) => {
            betsData = data ?? []
          }),
          pinLedger.listByPlayerSeason(playerId, seasonId).then(({ data }) => {
            ledgerData = data ?? []
          })
        )
      }

      await Promise.all(fetches)

      // Sum the season ledger per player, keep active players, sort high → low
      const byPlayer: Record<string, { playerId: string; name: string; balance: number; isActive: boolean }> = {}
      for (const e of seasonLedger) {
        const pid = e.player_id
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
      // Potential winnings: for each still-pending bet (not yet settled),
      // a win adds wager×2 to the ledger (the wager was already debited at
      // placement), so projected balance = current balance + Σ(wager×2).
      const pendingByPlayer: Record<string, number> = {}
      for (const b of weekBetsData) {
        if (b.settled_at == null) {
          pendingByPlayer[b.player_id] = (pendingByPlayer[b.player_id] ?? 0) + b.wager * 2
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

      setOpenLines(linesData)
      setWeekBets(weekBetsData)
      setSettledBets(settledBetsData)
      setLeaderboard(board)
      setMyBets(betsData)
      setBalance(ledgerData.reduce((sum, e) => sum + e.amount, 0))
      setMyBetLineIds(new Set(betsData.map((b: any) => b.bet_line_id)))
    } catch (e) {
      console.error('useBettingData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, balance, openLines, myBets, weekBets, settledBets, leaderboard, myBetLineIds, currentWeekId, currentSeasonId, reload: load }
}
