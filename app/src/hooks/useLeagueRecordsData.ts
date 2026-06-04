import { useState, useCallback, useEffect } from 'react'
import { seasons, scores } from '../utils/supabase/db'

type PlayerEntry = { name: string; score: number }

export interface LeagueRecords {
  highGame: { val: number; by: string; when: string }
  highSeries: { val: number; by: string; when: string }
  highTeamGame: { val: number; team: string; when: string; roster: PlayerEntry[] }
  highTeamNight: { val: number; team: string; when: string; games: { gameNum: number; roster: PlayerEntry[]; total: number }[] }
  bestSeasonAvg: { val: number; by: string; when: string }
}

export function computeLeagueRecordsFromSupabase(
  rawScores: any[],
  filterSeasonId: string | null,
): LeagueRecords {
  const recs: LeagueRecords = {
    highGame:      { val: 0, by: '', when: '' },
    highSeries:    { val: 0, by: '', when: '' },
    highTeamGame:  { val: 0, team: '', when: '', roster: [] },
    highTeamNight: { val: 0, team: '', when: '', games: [] },
    bestSeasonAvg: { val: 0, by: '', when: '' },
  }

  const seriesMap = new Map<string, { name: string; gameScores: Map<number, number>; seasonNum: number; weekNum: number }>()
  const teamGameMap = new Map<string, { team: number; seasonNum: number; weekNum: number; gameNum: number; total: number; roster: PlayerEntry[] }>()
  const teamNightMap = new Map<string, { team: number; seasonNum: number; weekNum: number; total: number; gameRosters: Map<number, { total: number; roster: PlayerEntry[] }> }>()
  const seasonPlayerMap = new Map<string, { name: string; seasonNum: number; pins: number; games: number }>()

  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot?.teams?.weeks?.is_archived) continue
    if (filterSeasonId !== null && slot.teams.weeks.season_id !== filterSeasonId) continue

    const score: number = row.score ?? 0
    const seasonNum: number = slot.teams.weeks.seasons?.number ?? 0
    const weekNum: number = slot.teams.weeks.week_number ?? 0
    const gameNum: number = (row.games as any)?.game_number ?? 0

    if (!slot.is_fill && slot.players?.name) {
      const playerName: string = slot.players.name
      const playerId: string = slot.players.id ?? playerName

      if (score > recs.highGame.val) {
        recs.highGame = { val: score, by: playerName, when: `S${seasonNum} W${weekNum} G${gameNum}` }
      }

      const seriesKey = `${slot.teams.week_id}|${playerId}`
      if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, { name: playerName, gameScores: new Map(), seasonNum, weekNum })
      const se = seriesMap.get(seriesKey)!
      se.gameScores.set(gameNum, score)

      const spKey = `${slot.teams.weeks.season_id}|${playerId}`
      if (!seasonPlayerMap.has(spKey)) seasonPlayerMap.set(spKey, { name: playerName, seasonNum, pins: 0, games: 0 })
      const sp = seasonPlayerMap.get(spKey)!
      sp.pins += score
      sp.games++
    }

    const teamNumber: number = slot.teams?.team_number ?? 0

    const tgKey = `${slot.teams.week_id}|${gameNum}|${slot.team_id}`
    if (!teamGameMap.has(tgKey)) teamGameMap.set(tgKey, { team: teamNumber, seasonNum, weekNum, gameNum, total: 0, roster: [] })
    const tg = teamGameMap.get(tgKey)!
    tg.total += score
    if (!slot.is_fill && slot.players?.name) tg.roster.push({ name: slot.players.name, score })

    const tnKey = `${slot.teams.week_id}|${slot.team_id}`
    if (!teamNightMap.has(tnKey)) teamNightMap.set(tnKey, { team: teamNumber, seasonNum, weekNum, total: 0, gameRosters: new Map() })
    const tn = teamNightMap.get(tnKey)!
    tn.total += score
    if (!tn.gameRosters.has(gameNum)) tn.gameRosters.set(gameNum, { total: 0, roster: [] })
    const gr = tn.gameRosters.get(gameNum)!
    gr.total += score
    if (!slot.is_fill && slot.players?.name) gr.roster.push({ name: slot.players.name, score })
  }

  for (const se of seriesMap.values()) {
    if (se.gameScores.size >= 2) {
      const series = Array.from(se.gameScores.values()).reduce((a, b) => a + b, 0)
      if (series > recs.highSeries.val) {
        recs.highSeries = { val: series, by: se.name, when: `S${se.seasonNum} W${se.weekNum}` }
      }
    }
  }

  for (const tg of teamGameMap.values()) {
    if (tg.total > recs.highTeamGame.val) {
      recs.highTeamGame = {
        val: tg.total,
        team: `Team ${tg.team}`,
        when: `S${tg.seasonNum} W${tg.weekNum} G${tg.gameNum}`,
        roster: [...tg.roster].sort((a, b) => b.score - a.score),
      }
    }
  }

  for (const tn of teamNightMap.values()) {
    if (tn.total > recs.highTeamNight.val) {
      const games = Array.from(tn.gameRosters.entries())
        .sort(([a], [b]) => a - b)
        .map(([gameNum, { total, roster }]) => ({
          gameNum,
          total,
          roster: [...roster].sort((a, b) => b.score - a.score),
        }))
      recs.highTeamNight = {
        val: tn.total,
        team: `Team ${tn.team}`,
        when: `S${tn.seasonNum} W${tn.weekNum}`,
        games,
      }
    }
  }

  for (const sp of seasonPlayerMap.values()) {
    if (sp.games > 0) {
      const avg = sp.pins / sp.games
      if (avg > recs.bestSeasonAvg.val) {
        recs.bestSeasonAvg = { val: avg, by: sp.name, when: `S${sp.seasonNum}` }
      }
    }
  }

  return recs
}

export function useLeagueRecordsData() {
  const [loading, setLoading] = useState(true)
  const [seasonList, setSeasonList] = useState<{ id: string; number: number }[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonsRes, scoresRes] = await Promise.all([
        seasons.list(),
        scores.listForLeagueRecords(),
      ])
      setSeasonList((seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number })))
      setRawScores(scoresRes.data ?? [])
    } catch (e) {
      console.error('useLeagueRecordsData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, seasonList, rawScores, reload: load }
}
