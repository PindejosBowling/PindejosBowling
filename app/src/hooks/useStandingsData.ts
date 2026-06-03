import { useState, useCallback, useEffect } from 'react'
import { seasons, scores, games, seasonChampions } from '../utils/supabase/db'

export interface StandingsRow {
  playerId: string
  name: string
  wins: number
  losses: number
  pins: number
  games: number
  weekCount: number
  avg: number
}

// Raw query result shapes (opaque at runtime, typed for clarity)
type RawScore = {
  score: number | null
  game_id: string
  team_slots: {
    id: string
    player_id: string | null
    team_number: number
    is_fill: boolean
    week_id: string
    players: { id: string; name: string } | null
    weeks: { season_id: number; is_archived: boolean }
  }
}

type RawSchedule = {
  id: string
  week_id: string
  game_number: number
  team_a: number
  team_b: number
}

/**
 * Derive standings from archived Supabase scores + game_schedule.
 * Equivalent to aggregateStandings() in data.js but computed from relational data.
 *
 * seasonId = null → aggregate across all seasons (same as passing 'all' to aggregateStandings)
 */
export function computeStandingsFromSupabase(
  rawScores: any[],
  rawSchedule: any[],
  seasonId: number | null,
): StandingsRow[] {
  // Schedule lookup: "weekId|gameNum|teamNum" → opponentTeamNum
  // Keyed per-team so multiple matchups in the same game round don't overwrite each other.
  const scheduleMap = new Map<string, number>()
  for (const row of rawSchedule as RawSchedule[]) {
    scheduleMap.set(`${row.id}|${row.team_a}`, row.team_b)
    scheduleMap.set(`${row.id}|${row.team_b}`, row.team_a)
  }

  // Team totals (all players including fill): "gameId|teamNum" → total pins
  const teamTotals = new Map<string, number>()
  for (const row of rawScores as RawScore[]) {
    const slot = row.team_slots
    if (!slot?.weeks?.is_archived) continue
    if (seasonId !== null && slot.weeks.season_id !== seasonId) continue
    const key = `${row.game_id}|${slot.team_number}`
    teamTotals.set(key, (teamTotals.get(key) ?? 0) + (row.score ?? 0))
  }

  // Per-player aggregation — non-fill players only
  const byPlayer = new Map<string, {
    name: string
    wins: number
    losses: number
    pins: number
    games: number
    weeks: Set<string>
  }>()

  for (const row of rawScores as RawScore[]) {
    const slot = row.team_slots
    if (!slot || slot.is_fill) continue
    const player = slot.players
    if (!player?.id || !player?.name) continue
    if (!slot.weeks?.is_archived) continue
    if (seasonId !== null && slot.weeks.season_id !== seasonId) continue

    const myTeam = slot.team_number
    const oppTeam = scheduleMap.get(`${row.game_id}|${myTeam}`)
    if (oppTeam === undefined) continue

    const myTotal = teamTotals.get(`${row.game_id}|${myTeam}`) ?? 0
    const oppTotal = teamTotals.get(`${row.game_id}|${oppTeam}`) ?? 0

    if (!byPlayer.has(player.id)) {
      byPlayer.set(player.id, { name: player.name, wins: 0, losses: 0, pins: 0, games: 0, weeks: new Set() })
    }
    const p = byPlayer.get(player.id)!
    p.wins   += myTotal > oppTotal ? 1 : 0
    p.losses += myTotal <= oppTotal ? 1 : 0
    p.pins   += row.score ?? 0
    p.games  += 1
    p.weeks.add(slot.week_id)
  }

  return Array.from(byPlayer.entries())
    .map(([id, p]) => ({
      playerId: id,
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      pins: p.pins,
      games: p.games,
      weekCount: p.weeks.size,
      avg: p.games > 0 ? p.pins / p.games : 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.pins - a.pins)
}

export function useStandingsData() {
  const [loading, setLoading] = useState(true)
  const [seasonList, setSeasonList] = useState<{ id: number; number: number }[]>([])
  const [championPlayerIds, setChampionPlayerIds] = useState<Set<string>>(new Set())
  const [rawScores, setRawScores] = useState<any[]>([])
  const [rawSchedule, setRawSchedule] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonsRes, champRes, scoresRes, scheduleRes] = await Promise.all([
        seasons.list(),
        seasonChampions.list(),
        scores.listForStandings(),
        games.listForArchivedWeeks(),
      ])
      setSeasonList((seasonsRes.data ?? []).map(s => ({ id: s.id, number: s.number })))
      setChampionPlayerIds(new Set((champRes.data ?? []).map((c: any) => c.player_id)))
      setRawScores(scoresRes.data ?? [])
      setRawSchedule(scheduleRes.data ?? [])
    } catch (e) {
      console.error('useStandingsData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, seasonList, championPlayerIds, rawScores, rawSchedule, reload: load }
}
