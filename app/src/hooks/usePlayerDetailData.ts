import {
  players as playersDb,
  seasons as seasonsDb,
  scores as scoresDb,
  games,
  seasonChampions as seasonChampionsDb,
  teamSlots as teamSlotsDb,
} from '../utils/supabase/db'
import { countsTowardAverage } from '../utils/averages'
import { useAsyncData } from './useAsyncData'

// ---- Raw query result shapes ----

type WeekMeta = {
  id: string
  season_id: string
  week_number: number
  is_archived: boolean
  seasons: { id: string; number: number }
}

export type DetailScore = {
  game_id: string
  score: number | null
  team_slots: {
    id: string
    player_id: string | null
    team_id: string
    slot: number
    is_fill: boolean
    players: { id: string; name: string } | null
    teams: { team_number: number; week_id: string; weeks: WeekMeta }
  }
}

export type PlayerSlot = {
  id: string
  team_id: string
  slot: number
  is_fill: boolean
  teams: { team_number: number; week_id: string; weeks: WeekMeta }
}

type RawSchedule = {
  id: string
  game_number: number
  team_a_id: string
  team_b_id: string
  teams: { week_id: string }
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
  /** Game ids this slot actually scored in, in game-number order. */
  gameIds: string[]
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

function buildScheduleMap(allSchedule: RawSchedule[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of allSchedule) {
    map.set(`${row.id}|${row.team_a_id}`, row.team_b_id)
    map.set(`${row.id}|${row.team_b_id}`, row.team_a_id)
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
    const key = `${row.game_id}|${slot.team_id}`
    map.set(key, (map.get(key) ?? 0) + (row.score ?? 0))
  }
  return map
}

// ---- Exported computation functions ----

export function computePlayerSeasons(
  playerId: string,
  allScores: DetailScore[],
  seasonList: { id: string; number: number }[],
): { id: string; number: number }[] {
  const seen = new Set<string>()
  for (const row of allScores) {
    const slot = row.team_slots
    if (!slot || slot.is_fill || slot.player_id !== playerId) continue
    seen.add(slot.teams.weeks.season_id)
  }
  return seasonList.filter(s => seen.has(s.id))
}

export function computePlayerProfile(
  playerId: string,
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
  seasonId: string | null,
  currentSeasonId: string | null,
): PlayerProfileData {
  const scheduleMap = buildScheduleMap(allSchedule)
  const teamTotals = buildTeamTotalsMap(allScores)

  const playerRows = allScores.filter(r => {
    const slot = r.team_slots
    if (!slot || slot.is_fill || slot.player_id !== playerId) return false
    if (seasonId !== null && slot.teams.weeks.season_id !== seasonId) return false
    return true
  })

  // Canonical policy: only bowled games (score > 0) count toward the average.
  const scoreVals = playerRows.map(r => r.score).filter(countsTowardAverage)
  const avg = scoreVals.length ? scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length : 0
  const highGame = scoreVals.length ? Math.max(...scoreVals) : 0
  const totalGames = scoreVals.length

  const gameNumberById = buildGameNumberById(allSchedule)
  const sorted = [...playerRows]
    .filter(r => (r.score ?? 0) > 0)
    .sort((a, b) => {
      const aw = a.team_slots.teams.weeks, bw = b.team_slots.teams.weeks
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
        return slot && !slot.is_fill && slot.player_id === playerId && slot.teams.weeks.season_id === currentSeasonId
      })
      .map(r => r.score)
      .filter(countsTowardAverage)
    seasonAvg = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0
  }

  let totalWins = 0, totalLosses = 0
  for (const row of playerRows) {
    if ((row.score ?? 0) === 0) continue
    const slot = row.team_slots
    const myTeam = slot.team_id
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
      const ak = a.teams.weeks.seasons.number * 1000 + a.teams.weeks.week_number
      const bk = b.teams.weeks.seasons.number * 1000 + b.teams.weeks.week_number
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
      const myTeam = slot.team_id
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
      const ak = a.teams.weeks.seasons.number * 1000 + a.teams.weeks.week_number
      const bk = b.teams.weeks.seasons.number * 1000 + b.teams.weeks.week_number
      return bk - ak
    })
  const latest = sorted[0]
  return latest ? `Team ${latest.teams?.team_number ?? '?'}` : null
}

export function computeWeekRows(
  playerId: string,
  playerSlots: PlayerSlot[],
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
  seasonId: string | null,
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
    if (seasonId !== null && slot.teams.weeks.season_id !== seasonId) continue

    const slotScores = scoresBySlotId.get(slot.id)
    const present = !!slotScores?.size
    const sortedEntries = slotScores
      ? Array.from(slotScores.entries()).sort(([a], [b]) => (gameNumberById.get(a) ?? 0) - (gameNumberById.get(b) ?? 0))
      : []
    const scores = sortedEntries.map(([, s]) => s)
    const gameIds = sortedEntries.map(([g]) => g)

    let wins = 0, losses = 0
    if (slotScores) {
      for (const [gameId, score] of slotScores) {
        if (score === 0) continue
        const myTeam = slot.team_id
        const oppTeam = scheduleMap.get(`${gameId}|${myTeam}`)
        if (oppTeam === undefined) continue
        const myTotal = teamTotals.get(`${gameId}|${myTeam}`) ?? 0
        const oppTotal = teamTotals.get(`${gameId}|${oppTeam}`) ?? 0
        if (myTotal > oppTotal) wins++
        else losses++
      }
    }

    rows.push({
      weekId: slot.teams.week_id,
      seasonNumber: slot.teams.weeks.seasons.number,
      weekNumber: slot.teams.weeks.week_number,
      teamNumber: slot.teams?.team_number ?? 0,
      scores, gameIds, wins, losses, present,
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
  seasonId: string | null,
): { value: number; label: string }[] {
  const gameNumberById = buildGameNumberById(allSchedule)
  return allScores
    .filter(r => {
      const slot = r.team_slots
      if (!slot || slot.is_fill || slot.player_id !== playerId) return false
      if (seasonId !== null && slot.teams.weeks.season_id !== seasonId) return false
      return (r.score ?? 0) > 0
    })
    .sort((a, b) => {
      const aw = a.team_slots.teams.weeks, bw = b.team_slots.teams.weeks
      const ak = aw.seasons.number * 1000 + aw.week_number
      const bk = bw.seasons.number * 1000 + bw.week_number
      return ak !== bk ? ak - bk : (gameNumberById.get(a.game_id) ?? 0) - (gameNumberById.get(b.game_id) ?? 0)
    })
    .map(r => ({
      value: r.score ?? 0,
      label: `S${r.team_slots.teams.weeks.seasons.number}W${r.team_slots.teams.weeks.week_number}`,
    }))
}

export function computeExpandedMatchups(
  weekId: string,
  allScores: DetailScore[],
  allSchedule: RawSchedule[],
  // When a player holds slots on two teams in one week, each log row passes its
  // slot's gameIds so the expansion shows only the games bowled for that team.
  onlyGameIds?: string[],
): ExpandedMatchup[] {
  const weekScores = allScores.filter(r => r.team_slots.teams.week_id === weekId)
  const gameNumberById = buildGameNumberById(allSchedule)
  const gameIds = [...new Set(weekScores.map(r => r.game_id))]
    .filter(id => !onlyGameIds || onlyGameIds.includes(id))
    .sort((a, b) => (gameNumberById.get(a) ?? 0) - (gameNumberById.get(b) ?? 0))

  const pairingsByGame = new Map<string, { teamA: string; teamB: string }>()
  for (const s of allSchedule) {
    if (s.teams.week_id === weekId) pairingsByGame.set(s.id, { teamA: s.team_a_id, teamB: s.team_b_id })
  }

  // team id → display number for this week's roster
  const teamNumberById = new Map<string, number>()
  for (const r of weekScores) {
    const slot = r.team_slots
    if (slot.team_id) teamNumberById.set(slot.team_id, slot.teams?.team_number ?? 0)
  }
  const teamLabel = (teamId: string) => `Team ${teamNumberById.get(teamId) ?? '?'}`

  const result: ExpandedMatchup[] = []

  for (const gameId of gameIds) {
    const gameNum = gameNumberById.get(gameId) ?? 0
    const gameScores = weekScores
      .filter(r => r.game_id === gameId)
      .sort((a, b) => a.team_slots.slot - b.team_slots.slot)

    const teamMap = new Map<string, { players: { name: string; score: number; present: boolean }[]; total: number }>()
    for (const row of gameScores) {
      const slot = row.team_slots
      if (!teamMap.has(slot.team_id)) teamMap.set(slot.team_id, { players: [], total: 0 })
      const team = teamMap.get(slot.team_id)!
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
          a: { team: teamLabel(pairing.teamA), ...teamA },
          b: teamB ? { team: teamLabel(pairing.teamB), ...teamB } : null,
        })
      }
    } else {
      const teams = [...teamMap.entries()].sort(
        ([a], [b]) => (teamNumberById.get(a) ?? 0) - (teamNumberById.get(b) ?? 0)
      )
      if (teams.length >= 2) {
        result.push({
          gameNum,
          a: { team: teamLabel(teams[0][0]), ...teams[0][1] },
          b: { team: teamLabel(teams[1][0]), ...teams[1][1] },
        })
      } else if (teams.length === 1) {
        result.push({ gameNum, a: { team: teamLabel(teams[0][0]), ...teams[0][1] }, b: null })
      }
    }
  }

  return result
}

// ---- Hook ----

interface PlayerDetailPayload {
  playerId: string | null
  isChampion: boolean
  seasonList: { id: string; number: number }[]
  allScores: DetailScore[]
  allSchedule: RawSchedule[]
  playerSlots: PlayerSlot[]
}

const EMPTY: PlayerDetailPayload = {
  playerId: null,
  isChampion: false,
  seasonList: [],
  allScores: [],
  allSchedule: [],
  playerSlots: [],
}

export function usePlayerDetailData(name: string) {
  const { loading, data, reload } = useAsyncData<PlayerDetailPayload>(async () => {
    const [playerRes, seasonsRes, champRes, scoresRes, scheduleRes] = await Promise.all([
      playersDb.getByName(name),
      seasonsDb.list(),
      seasonChampionsDb.list(),
      scoresDb.listForPlayerDetail(),
      games.listForArchivedWeeks(),
    ])

    const player = playerRes.data
    const rawSeasons = (seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number }))
    const champIds = new Set((champRes.data ?? []).map((c: any) => c.player_id))

    const seasonList = rawSeasons
    const allScores = (scoresRes.data ?? []) as unknown as DetailScore[]
    const allSchedule = (scheduleRes.data ?? []) as unknown as RawSchedule[]

    if (!player) {
      return { ...EMPTY, seasonList, allScores, allSchedule }
    }

    const slotsRes = await teamSlotsDb.listByPlayer(player.id)

    return {
      playerId: player.id,
      isChampion: champIds.has(player.id),
      seasonList,
      allScores,
      allSchedule,
      playerSlots: (slotsRes.data ?? []) as unknown as PlayerSlot[],
    }
  }, [name], 'usePlayerDetailData')

  return { loading, ...(data ?? EMPTY), reload }
}
