import { useState, useCallback, useEffect } from 'react'
import { seasons, scores, games } from '../utils/supabase/db'

interface PlayerScore {
  name: string
  score: number
  isFill: boolean
}

interface GameResult {
  gameNumber: number
  teamA: { teamNumber: number; players: PlayerScore[]; total: number }
  teamB: { teamNumber: number; players: PlayerScore[]; total: number }
  winner: 'A' | 'B' | 'tie'
}

export interface WeekGames {
  weekId: string
  weekNumber: number
  bowledAt: string | null
  games: GameResult[]
}

export function computePastGamesFromSupabase(
  rawScores: any[],
  rawSchedule: any[],
  seasonId: number | null,
): WeekGames[] {
  const filtered = rawScores.filter(r => {
    const slot = r.team_slots
    return slot?.weeks?.is_archived && (seasonId == null || slot.weeks.season_id === seasonId)
  })

  // week metadata: weekId → { weekNumber, bowledAt }
  const weekMeta = new Map<string, { weekNumber: number; bowledAt: string | null }>()
  for (const r of filtered) {
    const slot = r.team_slots
    const weekId: string = slot?.week_id
    if (weekId && !weekMeta.has(weekId)) {
      weekMeta.set(weekId, {
        weekNumber: slot.weeks.week_number,
        bowledAt: slot.weeks.bowled_at ?? null,
      })
    }
  }

  // schedule lookup: weekId → gameId → { teamA, teamB, gameNumber }
  const schedMap = new Map<string, Map<string, { teamA: number; teamB: number; gameNumber: number }>>()
  for (const s of rawSchedule) {
    if (!weekMeta.has(s.week_id)) continue
    if (!schedMap.has(s.week_id)) schedMap.set(s.week_id, new Map())
    schedMap.get(s.week_id)!.set(s.id, { teamA: s.team_a, teamB: s.team_b, gameNumber: s.game_number })
  }

  // scores lookup: weekId → teamNumber → gameId → PlayerScore[]
  const scoresMap = new Map<string, Map<number, Map<string, PlayerScore[]>>>()
  for (const r of filtered) {
    const slot = r.team_slots
    const weekId: string = slot?.week_id
    const teamNumber: number = slot?.team_number
    const gameId: string = r.game_id
    const score: number = r.score
    const name: string = slot?.players?.name ?? 'Unknown'
    const isFill: boolean = slot?.is_fill ?? false

    if (!weekId || teamNumber == null || gameId == null || score == null) continue
    if (!scoresMap.has(weekId)) scoresMap.set(weekId, new Map())
    const byTeam = scoresMap.get(weekId)!
    if (!byTeam.has(teamNumber)) byTeam.set(teamNumber, new Map())
    const byGame = byTeam.get(teamNumber)!
    if (!byGame.has(gameId)) byGame.set(gameId, [])
    byGame.get(gameId)!.push({ name, score, isFill })
  }

  const result: WeekGames[] = []
  for (const [weekId, meta] of weekMeta) {
    const gameSched = schedMap.get(weekId)
    if (!gameSched) continue

    const games: GameResult[] = []
    for (const [gameId, { teamA: teamANum, teamB: teamBNum, gameNumber }] of gameSched) {
      const teamAAll = scoresMap.get(weekId)?.get(teamANum)?.get(gameId) ?? []
      const teamBAll = scoresMap.get(weekId)?.get(teamBNum)?.get(gameId) ?? []
      const teamATotal = teamAAll.reduce((s, p) => s + p.score, 0)
      const teamBTotal = teamBAll.reduce((s, p) => s + p.score, 0)
      games.push({
        gameNumber,
        teamA: { teamNumber: teamANum, players: teamAAll, total: teamATotal },
        teamB: { teamNumber: teamBNum, players: teamBAll, total: teamBTotal },
        winner: teamATotal > teamBTotal ? 'A' : teamBTotal > teamATotal ? 'B' : 'tie',
      })
    }

    games.sort((a, b) => a.gameNumber - b.gameNumber)
    result.push({ weekId, weekNumber: meta.weekNumber, bowledAt: meta.bowledAt, games })
  }

  result.sort((a, b) => b.weekNumber - a.weekNumber)
  return result
}

export function usePastGamesData() {
  const [loading, setLoading] = useState(true)
  const [seasonList, setSeasonList] = useState<{ id: number; number: number }[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])
  const [rawSchedule, setRawSchedule] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonsRes, scoresRes, scheduleRes] = await Promise.all([
        seasons.list(),
        scores.listForPastGames(),
        games.listForArchivedWeeks(),
      ])
      setSeasonList((seasonsRes.data ?? []).map(s => ({ id: s.id, number: s.number })))
      setRawScores(scoresRes.data ?? [])
      setRawSchedule(scheduleRes.data ?? [])
    } catch (e) {
      console.error('usePastGamesData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, seasonList, rawScores, rawSchedule, reload: load }
}
