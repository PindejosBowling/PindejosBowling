import { useState, useCallback, useEffect } from 'react'
import {
  players as playersDb,
  seasons as seasonsDb,
  scores as scoresDb,
  games,
  seasonChampions as seasonChampionsDb,
  teamSlots as teamSlotsDb,
} from '../utils/supabase/db'

// ---- Raw query result shapes ----

export type DetailScore = {
  game_id: string
  score: number | null
  team_slots: {
    id: string
    player_id: string | null
    team_number: number
    slot: number
    is_fill: boolean
    week_id: string
    players: { id: string; name: string } | null
    weeks: {
      id: string
      season_id: number
      week_number: number
      is_archived: boolean
      seasons: { id: number; number: number }
    }
  }
}

export type PlayerSlot = {
  id: string
  team_number: number
  slot: number
  is_fill: boolean
  week_id: string
  weeks: {
    id: string
    season_id: number
    week_number: number
    is_archived: boolean
    seasons: { id: number; number: number }
  }
}

type RawSchedule = {
  id: string
  week_id: string
  game_number: number
  team_a: number
  team_b: number
}

// ---- Exported derived data types ----

export interface PlayerProfileData {
  avg: number
  highGame: number
  totalWins: number
  totalLosses: number
  last5Avg: number
  seasonAvg: number
  totalGames: number
}

export interface PersonalRecords {
  highGame: number
  highSeries: number
  bestStreak: number
  currentStreak: number
  currentStreakType: string
}

export interface WeekRow {
  weekId: string
  seasonNumber: number
  weekNumber: number
  teamNumber: number
  scores: number[]
  wins: number
  losses: number
  present: boolean
}

export interface ExpandedMatchupSide {
  team: string
  players: { name: string; score: number; present: boolean }[]
  total: number
}

export interface ExpandedMatchup {
  gameNum: number
  a: ExpandedMatchupSide
  b: ExpandedMatchupSide | null
}

// ---- Internal helpers ----

function buildScheduleMap(allSchedule: RawSchedule[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of allSchedule) {
    map.set(`${row.id}|${row.team_a}`, row.team_b)
    map.set(`${row.id}|${row.team_b}`, row.team_a)
  }
  return map
}

function buildGameNumberById(allSchedule: RawSchedule[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of allSchedule) map.set(row.id, row.game_number)
  return map
}

function buildTeamTotalsMap(allScores: DetailScore[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot) continue
    const key = `${row.game_id}|${slot.team_number}`
    map.set(key, (map.get(key) ?? 0) + (row.score ?? 0))
  }
  return map
}

// ---- Exported computation functions ----

export function computePlayerSeasons(
  playerId: string,
  allScores: DetailScore[],
  seasonList: { id: number; number: number }[],
): { id: number; number: number }[] {
  const seen = new Set<number>()
  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot || slot.is_fill || slot.player_id !== playerId) continue
    seen.add(slot.weeks.season_id)
  }
  return seasonList.filter(s => seen.has(s.id))
}

export function computePlayerProfile(
  playerId: string,
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
  seasonId: number | null,
  currentSeasonId: number | null,
): PlayerProfileData {
  const scheduleMap = buildScheduleMap(allSchedule)
  const teamTotals = buildTeamTotalsMap(allScores)

  const playerRows = allScores.filter(r => {
    const slot = r.team_slots
    if (!slot || slot.is_fill || slot.player_id !== playerId) return false
    if (seasonId !== null && slot.weeks.season_id !== seasonId) return false
    return true
  })

  const scoreVals = playerRows.map(r => r.score ?? 0).filter(s => s > 0)
  const avg = scoreVals.length ? scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length : 0
  const highGame = scoreVals.length ? Math.max(...scoreVals) : 0
  const totalGames = scoreVals.length

  const gameNumberById = buildGameNumberById(allSchedule)
  const sorted = [...playerRows]
    .filter(r => (r.score ?? 0) > 0)
    .sort((a, b) => {
      const aw = a.team_slots.weeks, bw = b.team_slots.weeks
      const ak = aw.seasons.number * 1000 + aw.week_number
      const bk = bw.seasons.number * 1000 + bw.week_number
      return ak !== bk ? ak - bk : (gameNumberById.get(a.game_id) ?? 0) - (gameNumberById.get(b.game_id) ?? 0)
    })
  const last5 = sorted.slice(-5).map(r => r.score ?? 0)
  const last5Avg = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0

  let seasonAvg = 0
  if (currentSeasonId !== null) {
    const cs = allScores
      .filter(r => {
        const slot = r.team_slots
        return slot && !slot.is_fill && slot.player_id === playerId && slot.weeks.season_id === currentSeasonId
      })
      .map(r => r.score ?? 0)
      .filter(s => s > 0)
    seasonAvg = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0
  }

  let totalWins = 0, totalLosses = 0
  for (const row of playerRows) {
    if ((row.score ?? 0) === 0) continue
    const slot = row.team_slots
    const myTeam = slot.team_number
    const oppTeam = scheduleMap.get(`${row.game_id}|${myTeam}`)
    if (oppTeam === undefined) continue
    const myTotal = teamTotals.get(`${row.game_id}|${myTeam}`) ?? 0
    const oppTotal = teamTotals.get(`${row.game_id}|${oppTeam}`) ?? 0
    if (myTotal > oppTotal) totalWins++
    else totalLosses++
  }

  return { avg, highGame, totalWins, totalLosses, last5Avg, seasonAvg, totalGames }
}

export function computePersonalRecords(
  playerId: string,
  playerSlots: PlayerSlot[],
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
): PersonalRecords {
  const scheduleMap = buildScheduleMap(allSchedule)
  const teamTotals = buildTeamTotalsMap(allScores)

  // Build per-slot score map for this player
  const scoresBySlotId = new Map<string, Map<string, number>>()
  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot || slot.player_id !== playerId || slot.is_fill) continue
    if ((row.score ?? 0) === 0) continue
    if (!scoresBySlotId.has(slot.id)) scoresBySlotId.set(slot.id, new Map())
    scoresBySlotId.get(slot.id)!.set(row.game_id, row.score ?? 0)
  }

  let highGame = 0, highSeries = 0
  let curStreak = 0, curType = '', bestStreak = 0

  const sortedSlots = [...playerSlots]
    .filter(s => !s.is_fill)
    .sort((a, b) => {
      const ak = a.weeks.seasons.number * 1000 + a.weeks.week_number
      const bk = b.weeks.seasons.number * 1000 + b.weeks.week_number
      return ak - bk
    })

  for (const slot of sortedSlots) {
    const slotScores = scoresBySlotId.get(slot.id)
    if (!slotScores?.size) continue

    let weekTotal = 0
    for (const [, score] of slotScores) {
      if (score > highGame) highGame = score
      weekTotal += score
    }
    if (weekTotal > highSeries) highSeries = weekTotal

    let weekWins = 0, weekLosses = 0
    for (const [gameId, score] of slotScores) {
      if (score === 0) continue
      const myTeam = slot.team_number
      const oppTeam = scheduleMap.get(`${gameId}|${myTeam}`)
      if (oppTeam === undefined) continue
      const myTotal = teamTotals.get(`${gameId}|${myTeam}`) ?? 0
      const oppTotal = teamTotals.get(`${gameId}|${oppTeam}`) ?? 0
      if (myTotal > oppTotal) weekWins++
      else weekLosses++
    }

    if (weekWins > weekLosses) {
      if (curType === 'W') curStreak++
      else { curStreak = 1; curType = 'W' }
    } else if (weekLosses > weekWins) {
      if (curType === 'L') curStreak++
      else { curStreak = 1; curType = 'L' }
    }
    if (curStreak > bestStreak) bestStreak = curStreak
  }

  return { highGame, highSeries, bestStreak, currentStreak: curStreak, currentStreakType: curType }
}

export function computeCurrentTeam(playerSlots: PlayerSlot[]): string | null {
  const sorted = [...playerSlots]
    .filter(s => !s.is_fill)
    .sort((a, b) => {
      const ak = a.weeks.seasons.number * 1000 + a.weeks.week_number
      const bk = b.weeks.seasons.number * 1000 + b.weeks.week_number
      return bk - ak
    })
  const latest = sorted[0]
  return latest ? `Team ${latest.team_number}` : null
}

export function computeWeekRows(
  playerId: string,
  playerSlots: PlayerSlot[],
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
  seasonId: number | null,
): WeekRow[] {
  const scheduleMap = buildScheduleMap(allSchedule)
  const teamTotals = buildTeamTotalsMap(allScores)

  const gameNumberById = buildGameNumberById(allSchedule)
  const scoresBySlotId = new Map<string, Map<string, number>>()
  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot || slot.player_id !== playerId) continue
    if ((row.score ?? 0) === 0) continue
    if (!scoresBySlotId.has(slot.id)) scoresBySlotId.set(slot.id, new Map())
    scoresBySlotId.get(slot.id)!.set(row.game_id, row.score ?? 0)
  }

  const rows: WeekRow[] = []
  for (const slot of playerSlots) {
    if (slot.is_fill) continue
    if (seasonId !== null && slot.weeks.season_id !== seasonId) continue

    const slotScores = scoresBySlotId.get(slot.id)
    const present = !!slotScores?.size
    const scores = slotScores
      ? Array.from(slotScores.entries()).sort(([a], [b]) => (gameNumberById.get(a) ?? 0) - (gameNumberById.get(b) ?? 0)).map(([, s]) => s)
      : []

    let wins = 0, losses = 0
    if (slotScores) {
      for (const [gameId, score] of slotScores) {
        if (score === 0) continue
        const myTeam = slot.team_number
        const oppTeam = scheduleMap.get(`${gameId}|${myTeam}`)
        if (oppTeam === undefined) continue
        const myTotal = teamTotals.get(`${gameId}|${myTeam}`) ?? 0
        const oppTotal = teamTotals.get(`${gameId}|${oppTeam}`) ?? 0
        if (myTotal > oppTotal) wins++
        else losses++
      }
    }

    rows.push({
      weekId: slot.week_id,
      seasonNumber: slot.weeks.seasons.number,
      weekNumber: slot.weeks.week_number,
      teamNumber: slot.team_number,
      scores, wins, losses, present,
    })
  }

  return rows.sort((a, b) =>
    a.seasonNumber !== b.seasonNumber
      ? b.seasonNumber - a.seasonNumber
      : b.weekNumber - a.weekNumber
  )
}

export function computeChartPoints(
  playerId: string,
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
  seasonId: number | null,
): { value: number; label: string }[] {
  const gameNumberById = buildGameNumberById(allSchedule)
  return allScores
    .filter(r => {
      const slot = r.team_slots
      if (!slot || slot.is_fill || slot.player_id !== playerId) return false
      if (seasonId !== null && slot.weeks.season_id !== seasonId) return false
      return (r.score ?? 0) > 0
    })
    .sort((a, b) => {
      const aw = a.team_slots.weeks, bw = b.team_slots.weeks
      const ak = aw.seasons.number * 1000 + aw.week_number
      const bk = bw.seasons.number * 1000 + bw.week_number
      return ak !== bk ? ak - bk : (gameNumberById.get(a.game_id) ?? 0) - (gameNumberById.get(b.game_id) ?? 0)
    })
    .map(r => ({
      value: r.score ?? 0,
      label: `S${r.team_slots.weeks.seasons.number}W${r.team_slots.weeks.week_number}`,
    }))
}

export function computeExpandedMatchups(
  weekId: string,
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
): ExpandedMatchup[] {
  const weekScores = allScores.filter(r => r.team_slots.week_id === weekId)
  const gameNumberById = buildGameNumberById(allSchedule)
  const gameIds = [...new Set(weekScores.map(r => r.game_id))]
    .sort((a, b) => (gameNumberById.get(a) ?? 0) - (gameNumberById.get(b) ?? 0))

  const pairingsByGame = new Map<string, { teamA: number; teamB: number }>()
  for (const s of allSchedule) {
    if (s.week_id === weekId) pairingsByGame.set(s.id, { teamA: s.team_a, teamB: s.team_b })
  }

  const result: ExpandedMatchup[] = []

  for (const gameId of gameIds) {
    const gameNum = gameNumberById.get(gameId) ?? 0
    const gameScores = weekScores
      .filter(r => r.game_id === gameId)
      .sort((a, b) => a.team_slots.slot - b.team_slots.slot)

    const teamMap = new Map<number, { players: { name: string; score: number; present: boolean }[]; total: number }>()
    for (const row of gameScores) {
      const slot = row.team_slots
      if (!teamMap.has(slot.team_number)) teamMap.set(slot.team_number, { players: [], total: 0 })
      const team = teamMap.get(slot.team_number)!
      const score = row.score ?? 0
      team.players.push({
        name: slot.is_fill ? 'League Avg Fill' : (slot.players?.name ?? ''),
        score,
        present: score > 0,
      })
      team.total += score
    }

    const pairing = pairingsByGame.get(gameId)
    if (pairing) {
      const teamA = teamMap.get(pairing.teamA)
      const teamB = teamMap.get(pairing.teamB)
      if (teamA) {
        result.push({
          gameNum,
          a: { team: `Team ${pairing.teamA}`, ...teamA },
          b: teamB ? { team: `Team ${pairing.teamB}`, ...teamB } : null,
        })
      }
    } else {
      const teams = [...teamMap.entries()].sort(([a], [b]) => a - b)
      if (teams.length >= 2) {
        result.push({
          gameNum,
          a: { team: `Team ${teams[0][0]}`, ...teams[0][1] },
          b: { team: `Team ${teams[1][0]}`, ...teams[1][1] },
        })
      } else if (teams.length === 1) {
        result.push({ gameNum, a: { team: `Team ${teams[0][0]}`, ...teams[0][1] }, b: null })
      }
    }
  }

  return result
}

// ---- Hook ----

export function usePlayerDetailData(name: string) {
  const [loading, setLoading] = useState(true)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [isChampion, setIsChampion] = useState(false)
  const [seasonList, setSeasonList] = useState<{ id: number; number: number }[]>([])
  const [allScores, setAllScores] = useState<DetailScore[]>([])
  const [allSchedule, setAllSchedule] = useState<RawSchedule[]>([])
  const [playerSlots, setPlayerSlots] = useState<PlayerSlot[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [playerRes, seasonsRes, champRes, scoresRes, scheduleRes] = await Promise.all([
        playersDb.getByName(name),
        seasonsDb.list(),
        seasonChampionsDb.list(),
        scoresDb.listForPlayerDetail(),
        games.listForArchivedWeeks(),
      ])

      const player = playerRes.data
      const rawSeasons = (seasonsRes.data ?? []).map(s => ({ id: s.id, number: s.number }))
      const champIds = new Set((champRes.data ?? []).map((c: any) => c.player_id))

      setSeasonList(rawSeasons)
      setAllScores((scoresRes.data ?? []) as unknown as DetailScore[])
      setAllSchedule((scheduleRes.data ?? []) as unknown as RawSchedule[])

      if (!player) {
        setPlayerId(null)
        setIsChampion(false)
        setPlayerSlots([])
        return
      }

      setPlayerId(player.id)
      setIsChampion(champIds.has(player.id))

      const slotsRes = await teamSlotsDb.listByPlayer(player.id)
      setPlayerSlots((slotsRes.data ?? []) as unknown as PlayerSlot[])
    } catch (e) {
      console.error('usePlayerDetailData error:', e)
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => { load() }, [load])

  return { loading, playerId, isChampion, seasonList, allScores, allSchedule, playerSlots, reload: load }
}
