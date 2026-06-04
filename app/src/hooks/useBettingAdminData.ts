import { useState, useCallback, useEffect } from 'react'
import { weeks, betLines, placedBets } from '../utils/supabase/db'

export function useBettingAdminData() {
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<any[]>([])
  const [betCountByLine, setBetCountByLine] = useState<Record<string, number>>({})
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: week } = await weeks.getCurrent()
      const weekId = week?.id ?? null
      setCurrentWeekId(weekId)

      if (!weekId) {
        setLines([])
        setBetCountByLine({})
        return
      }

      const [linesRes, betsRes] = await Promise.all([
        betLines.listByWeek(weekId),
        placedBets.listByWeek(weekId),
      ])

      const allLines = linesRes.data ?? []
      const allBets = betsRes.data ?? []

      setLines(allLines)

      const counts: Record<string, number> = {}
      for (const bet of allBets) {
        counts[bet.bet_line_id] = (counts[bet.bet_line_id] ?? 0) + 1
      }
      setBetCountByLine(counts)
    } catch (e) {
      console.error('useBettingAdminData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, lines, betCountByLine, currentWeekId, reload: load }
}
