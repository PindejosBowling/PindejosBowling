import { seasons, scores, games, seasonChampions } from '../utils/supabase/db'
import { useAsyncData } from './useAsyncData'

interface HistoryPayload {
  seasonList: { id: string; number: number }[]
  rawScores: any[]
  rawSchedule: any[]
  champsBySeason: Map<string, string[]>
}

const EMPTY: HistoryPayload = { seasonList: [], rawScores: [], rawSchedule: [], champsBySeason: new Map() }

export function useHistoryData() {
  const { loading, data, reload } = useAsyncData<HistoryPayload>(async () => {
    const [seasonsRes, champsRes, scoresRes, scheduleRes] = await Promise.all([
      seasons.list(),
      seasonChampions.list(),
      scores.listForHistory(),
      games.listForArchivedWeeks(),
    ])

    const champsMap = new Map<string, string[]>()
    for (const c of (champsRes.data ?? []) as any[]) {
      if (!champsMap.has(c.season_id)) champsMap.set(c.season_id, [])
      if (c.players?.name) champsMap.get(c.season_id)!.push(c.players.name)
    }

    return {
      seasonList: (seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number })),
      rawScores: scoresRes.data ?? [],
      rawSchedule: scheduleRes.data ?? [],
      champsBySeason: champsMap,
    }
  }, [], 'useHistoryData')

  return { loading, ...(data ?? EMPTY), reload }
}
