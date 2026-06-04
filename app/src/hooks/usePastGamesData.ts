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
  seasonId: string | null,
): WeekGames[] {
  const filtered = rawScores.filter(r => {
    const slot = r.team_slots
    return slot?.teams?.weeks?.is_archived && (seasonId == null || slot.teams.weeks.season_id === seasonId)
  })

  // week metadata: weekId → { weekNumber, bowledAt }
  const weekMeta = new Map<string, { weekNumber: number; bowledAt: string | null }>()
  for (const r of filtered) {
    const slot = r.team_slots
    const weekId: string = slot?.teams?.week_id
    if (weekId && !weekMeta.has(weekId)) {
      weekMeta.set(weekId, {
        weekNumber: slot.teams.weeks.week_number,
        bowledAt: slot.teams.weeks.bowled_at ?? null,
      })
    }
  }

  // schedule lookup: weekId → gameId → { teamA, teamB (team ids), gameNumber }
  const schedMap = new Map<string, Map<string, { teamA: string; teamB: string; gameNumber: number }>>()
  for (const s of rawSchedule) {
    const weekId: string = s.teams?.week_id
    if (!weekMeta.has(weekId)) continue
    if (!schedMap.has(weekId)) schedMap.set(weekId, new Map())
    schedMap.get(weekId)!.set(s.id, { teamA: s.team_a_id, teamB: s.team_b_id, gameNumber: s.game_number })
  }

  // team id → display number (every archived team has scores, so this covers all teams that played)
  const teamNumberById = new Map<string, number>()

  // scores lookup: weekId → teamId → gameId → PlayerScore[]
  const scoresMap = new Map<string, Map<string, Map<string, PlayerScore[]>>>()
  for (const r of filtered) {
    const slot = r.team_slots
    const weekId: string = slot?.teams?.week_id
    const teamId: string = slot?.team_id
    const gameId: string = r.game_id
    const score: number = r.score
    const name: string = slot?.players?.name ?? 'Unknown'
    const isFill: boolean = slot?.is_fill ?? false

    if (!weekId || teamId == null || gameId == null || score == null) continue
    teamNumberById.set(teamId, slot?.teams?.team_number ?? 0)
    if (!scoresMap.has(weekId)) scoresMap.set(weekId, new Map())
    const byTeam = scoresMap.get(weekId)!
    if (!byTeam.has(teamId)) byTeam.set(teamId, new Map())
    const byGame = byTeam.get(teamId)!
    if (!byGame.has(gameId)) byGame.set(gameId, [])
    byGame.get(gameId)!.push({ name, score, isFill })
  }

  const result: WeekGames[] = []
  for (const [weekId, meta] of weekMeta) {
    const gameSched = schedMap.get(weekId)
    if (!gameSched) continue

    const games: GameResult[] = []
    for (const [gameId, { teamA: teamAId, teamB: teamBId, gameNumber }] of gameSched) {
      const teamAAll = scoresMap.get(weekId)?.get(teamAId)?.get(gameId) ?? []
      const teamBAll = scoresMap.get(weekId)?.get(teamBId)?.get(gameId) ?? []
      const teamATotal = teamAAll.reduce((s, p) => s + p.score, 0)
      const teamBTotal = teamBAll.reduce((s, p) => s + p.score, 0)
      games.push({
        gameNumber,
        teamA: { teamNumber: teamNumberById.get(teamAId) ?? 0, players: teamAAll, total: teamATotal },
        teamB: { teamNumber: teamNumberById.get(teamBId) ?? 0, players: teamBAll, total: teamBTotal },
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
  const [seasonList, setSeasonList] = useState<{ id: string; number: number }[]>([])
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
      setSeasonList((seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number })))
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
