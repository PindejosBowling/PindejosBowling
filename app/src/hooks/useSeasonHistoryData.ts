import { useState, useCallback, useEffect } from 'react'
import { seasons, scores, gameSchedule, seasonChampions } from '../utils/supabase/db'

export function useSeasonHistoryData() {
  const [loading, setLoading] = useState(true)
  const [seasonList, setSeasonList] = useState<{ id: number; number: number }[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])
  const [rawSchedule, setRawSchedule] = useState<any[]>([])
  const [champsBySeason, setChampsBySeason] = useState<Map<number, string[]>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonsRes, champsRes, scoresRes, scheduleRes] = await Promise.all([
        seasons.list(),
        seasonChampions.list(),
        scores.listForStandings(),
        gameSchedule.listForArchivedWeeks(),
      ])

      setSeasonList((seasonsRes.data ?? []).map(s => ({ id: s.id, number: s.number })))

      const champsMap = new Map<number, string[]>()
      for (const c of (champsRes.data ?? []) as any[]) {
        if (!champsMap.has(c.season_id)) champsMap.set(c.season_id, [])
        if (c.players?.name) champsMap.get(c.season_id)!.push(c.players.name)
      }
      setChampsBySeason(champsMap)

      setRawScores(scoresRes.data ?? [])
      setRawSchedule(scheduleRes.data ?? [])
    } catch (e) {
      console.error('useSeasonHistoryData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, seasonList, rawScores, rawSchedule, champsBySeason, reload: load }
}
