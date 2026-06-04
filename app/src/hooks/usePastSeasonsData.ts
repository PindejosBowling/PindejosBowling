import { useState, useCallback, useEffect } from 'react'
import { seasons, scores, games, seasonChampions } from '../utils/supabase/db'

export function usePastSeasonsData() {
  const [loading, setLoading] = useState(true)
  const [seasonList, setSeasonList] = useState<{ id: string; number: number }[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])
  const [rawSchedule, setRawSchedule] = useState<any[]>([])
  const [champsBySeason, setChampsBySeason] = useState<Map<string, string[]>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonsRes, champsRes, scoresRes, scheduleRes] = await Promise.all([
        seasons.list(),
        seasonChampions.list(),
        scores.listForStandings(),
        games.listForArchivedWeeks(),
      ])

      setSeasonList((seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number })))

      const champsMap = new Map<string, string[]>()
      for (const c of (champsRes.data ?? []) as any[]) {
        if (!champsMap.has(c.season_id)) champsMap.set(c.season_id, [])
        if (c.players?.name) champsMap.get(c.season_id)!.push(c.players.name)
      }
      setChampsBySeason(champsMap)

      setRawScores(scoresRes.data ?? [])
      setRawSchedule(scheduleRes.data ?? [])
    } catch (e) {
      console.error('usePastSeasonsData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, seasonList, rawScores, rawSchedule, champsBySeason, reload: load }
}
