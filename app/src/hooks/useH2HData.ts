import { useState, useCallback, useEffect } from 'react'
import { players as playersDb, scores as scoresDb, games } from '../utils/supabase/db'

export interface H2HGame {
  season: number
  week: number
  gameNum: number
  t1Total: number
  t2Total: number
  p1Score: number
  p2Score: number
}

export interface H2HResult {
  teamP1Wins: number
  teamP2Wins: number
  teamTies: number
  pinP1Wins: number
  pinP2Wins: number
  pinTies: number
  games: H2HGame[]
}

export function computeH2HFromSupabase(
  p1Name: string,
  p2Name: string,
  allScores: any[],
  allSchedule: any[],
): H2HResult {
  const result: H2HResult = {
    teamP1Wins: 0, teamP2Wins: 0, teamTies: 0,
    pinP1Wins: 0, pinP2Wins: 0, pinTies: 0,
    games: [],
  }

  const scheduleMap = new Map<string, number>()
  const gameNumberById = new Map<string, number>()
  for (const s of allSchedule) {
    scheduleMap.set(`${s.id}|${s.team_a}`, s.team_b)
    scheduleMap.set(`${s.id}|${s.team_b}`, s.team_a)
    gameNumberById.set(s.id, s.game_number)
  }

  const teamTotals = new Map<string, number>()
  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot) continue
    const key = `${row.game_id}|${slot.team_number}`
    teamTotals.set(key, (teamTotals.get(key) ?? 0) + (row.score ?? 0))
  }

  type WeekEntry = { team: number; scores: Map<string, number>; seasonNum: number; weekNum: number }
  const playerWeekMap = new Map<string, Map<string, WeekEntry>>()

  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot || slot.is_fill) continue
    const name = slot.players?.name
    if (!name) continue

    if (!playerWeekMap.has(name)) playerWeekMap.set(name, new Map())
    const weekMap = playerWeekMap.get(name)!

    if (!weekMap.has(slot.week_id)) {
      weekMap.set(slot.week_id, {
        team: slot.team_number,
        scores: new Map(),
        seasonNum: slot.weeks?.seasons?.number ?? 0,
        weekNum: slot.weeks?.week_number ?? 0,
      })
    }
    weekMap.get(slot.week_id)!.scores.set(row.game_id, row.score ?? 0)
  }

  const p1Weeks = playerWeekMap.get(p1Name)
  const p2Weeks = playerWeekMap.get(p2Name)
  if (!p1Weeks || !p2Weeks) return result

  for (const [weekId, p1Week] of p1Weeks) {
    const p2Week = p2Weeks.get(weekId)
    if (!p2Week) continue

    for (const [gameId, p1Score] of p1Week.scores) {
      const p1Opponent = scheduleMap.get(`${gameId}|${p1Week.team}`)
      if (p1Opponent !== p2Week.team) continue

      const p2Score = p2Week.scores.get(gameId) ?? 0
      const t1Total = teamTotals.get(`${gameId}|${p1Week.team}`) ?? 0
      const t2Total = teamTotals.get(`${gameId}|${p2Week.team}`) ?? 0

      if (t1Total > t2Total) result.teamP1Wins++
      else if (t2Total > t1Total) result.teamP2Wins++
      else result.teamTies++

      if (p1Score > p2Score) result.pinP1Wins++
      else if (p2Score > p1Score) result.pinP2Wins++
      else if (p1Score && p2Score) result.pinTies++

      result.games.push({ season: p1Week.seasonNum, week: p1Week.weekNum, gameNum: gameNumberById.get(gameId) ?? 0, t1Total, t2Total, p1Score, p2Score })
    }
  }

  result.games.sort((a, b) =>
    a.season !== b.season ? a.season - b.season :
    a.week !== b.week ? a.week - b.week :
    a.gameNum - b.gameNum
  )

  return result
}

export function useH2HData() {
  const [loading, setLoading] = useState(true)
  const [playerNames, setPlayerNames] = useState<string[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])
  const [rawSchedule, setRawSchedule] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [playersRes, scoresRes, scheduleRes] = await Promise.all([
        playersDb.list(),
        scoresDb.listForH2H(),
        games.listForArchivedWeeks(),
      ])
      setPlayerNames((playersRes.data ?? []).map((p: any) => p.name))
      setRawScores(scoresRes.data ?? [])
      setRawSchedule(scheduleRes.data ?? [])
    } catch (e) {
      console.error('useH2HData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, playerNames, rawScores, rawSchedule, reload: load }
}
