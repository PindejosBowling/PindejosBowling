import { useState, useCallback, useEffect } from 'react'
import { seasons, scores } from '../utils/supabase/db'

type PlayerEntry = { name: string; score: number }

export interface LeagueRecords {
  highGame: { val: number; by: string; when: string }
  highSeries: { val: number; by: string; when: string }
  highTeamGame: { val: number; team: string; when: string; roster: PlayerEntry[] }
  highTeamNight: { val: number; team: string; when: string; g1Roster: PlayerEntry[]; g2Roster: PlayerEntry[]; g1Total: number; g2Total: number }
  bestSeasonAvg: { val: number; by: string; when: string }
}

export function computeLeagueRecordsFromSupabase(
  rawScores: any[],
  filterSeasonId: number | null,
): LeagueRecords {
  const recs: LeagueRecords = {
    highGame:      { val: 0, by: '', when: '' },
    highSeries:    { val: 0, by: '', when: '' },
    highTeamGame:  { val: 0, team: '', when: '', roster: [] },
    highTeamNight: { val: 0, team: '', when: '', g1Roster: [], g2Roster: [], g1Total: 0, g2Total: 0 },
    bestSeasonAvg: { val: 0, by: '', when: '' },
  }

  const seriesMap = new Map<string, { name: string; g1?: number; g2?: number; seasonNum: number; weekNum: number }>()
  const teamGameMap = new Map<string, { team: number; seasonNum: number; weekNum: number; gameNum: number; total: number; roster: PlayerEntry[] }>()
  const teamNightMap = new Map<string, { team: number; seasonNum: number; weekNum: number; g1Total: number; g2Total: number; g1Roster: PlayerEntry[]; g2Roster: PlayerEntry[] }>()
  const seasonPlayerMap = new Map<string, { name: string; seasonNum: number; pins: number; games: number }>()

  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot?.weeks?.is_archived) continue
    if (filterSeasonId !== null && slot.weeks.season_id !== filterSeasonId) continue

    const score: number = row.score ?? 0
    const seasonNum: number = slot.weeks.seasons?.number ?? 0
    const weekNum: number = slot.weeks.week_number ?? 0
    const gameNum: number = row.game_number

    if (!slot.is_fill && slot.players?.name) {
      const playerName: string = slot.players.name
      const playerId: string = slot.players.id ?? playerName

      if (score > recs.highGame.val) {
        recs.highGame = { val: score, by: playerName, when: `S${seasonNum} W${weekNum} G${gameNum}` }
      }

      const seriesKey = `${slot.week_id}|${playerId}`
      if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, { name: playerName, seasonNum, weekNum })
      const se = seriesMap.get(seriesKey)!
      if (gameNum === 1) se.g1 = score
      else if (gameNum === 2) se.g2 = score

      const spKey = `${slot.weeks.season_id}|${playerId}`
      if (!seasonPlayerMap.has(spKey)) seasonPlayerMap.set(spKey, { name: playerName, seasonNum, pins: 0, games: 0 })
      const sp = seasonPlayerMap.get(spKey)!
      sp.pins += score
      sp.games++
    }

    const tgKey = `${slot.week_id}|${gameNum}|${slot.team_number}`
    if (!teamGameMap.has(tgKey)) teamGameMap.set(tgKey, { team: slot.team_number, seasonNum, weekNum, gameNum, total: 0, roster: [] })
    const tg = teamGameMap.get(tgKey)!
    tg.total += score
    if (!slot.is_fill && slot.players?.name) tg.roster.push({ name: slot.players.name, score })

    const tnKey = `${slot.week_id}|${slot.team_number}`
    if (!teamNightMap.has(tnKey)) teamNightMap.set(tnKey, { team: slot.team_number, seasonNum, weekNum, g1Total: 0, g2Total: 0, g1Roster: [], g2Roster: [] })
    const tn = teamNightMap.get(tnKey)!
    if (gameNum === 1) {
      tn.g1Total += score
      if (!slot.is_fill && slot.players?.name) tn.g1Roster.push({ name: slot.players.name, score })
    } else if (gameNum === 2) {
      tn.g2Total += score
      if (!slot.is_fill && slot.players?.name) tn.g2Roster.push({ name: slot.players.name, score })
    }
  }

  for (const se of seriesMap.values()) {
    if (se.g1 !== undefined && se.g2 !== undefined) {
      const series = se.g1 + se.g2
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
    const night = tn.g1Total + tn.g2Total
    if (night > recs.highTeamNight.val) {
      recs.highTeamNight = {
        val: night,
        team: `Team ${tn.team}`,
        when: `S${tn.seasonNum} W${tn.weekNum}`,
        g1Roster: [...tn.g1Roster].sort((a, b) => b.score - a.score),
        g2Roster: [...tn.g2Roster].sort((a, b) => b.score - a.score),
        g1Total: tn.g1Total,
        g2Total: tn.g2Total,
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
  const [seasonList, setSeasonList] = useState<{ id: number; number: number }[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [seasonsRes, scoresRes] = await Promise.all([
        seasons.list(),
        scores.listForLeagueRecords(),
      ])
      setSeasonList((seasonsRes.data ?? []).map(s => ({ id: s.id, number: s.number })))
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
