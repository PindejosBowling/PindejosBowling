import { useState, useCallback, useEffect } from 'react'
import { weeks, seasons, betLines, placedBets, pinLedger } from '../utils/supabase/db'

export function useBettingData(playerId: string | null) {
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [openLines, setOpenLines] = useState<any[]>([])
  const [myBets, setMyBets] = useState<any[]>([])
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

      // Open bet lines for this week
      let linesData: any[] = []
      if (weekId) {
        fetches.push(
          betLines.listOpenByWeek(weekId).then(({ data }) => {
            linesData = data ?? []
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

      setOpenLines(linesData)
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

  return { loading, balance, openLines, myBets, myBetLineIds, currentWeekId, currentSeasonId, reload: load }
}
