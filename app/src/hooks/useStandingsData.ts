import { seasons, scores, games, seasonChampions, pinLedger, registrations } from '../utils/supabase/db'
import { countsTowardAverage } from '../utils/averages'
import { useAsyncData } from './useAsyncData'

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
    team_id: string
    is_fill: boolean
    players: { id: string; name: string } | null
    teams: { week_id: string; weeks: { season_id: string; week_number: number; is_archived: boolean } }
  }
}

type RawSchedule = {
  id: string
  game_number: number
  team_a_id: string
  team_b_id: string
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
  seasonId: string | null,
  maxWeekNumber?: number,
  roster: any[] = [],
): StandingsRow[] {
  // Schedule lookup: "gameId|teamId" → opponentTeamId
  // Keyed per-team so multiple matchups in the same game round don't overwrite each other.
  const scheduleMap = new Map<string, string>()
  for (const row of rawSchedule as RawSchedule[]) {
    scheduleMap.set(`${row.id}|${row.team_a_id}`, row.team_b_id)
    scheduleMap.set(`${row.id}|${row.team_b_id}`, row.team_a_id)
  }

  // Team totals (all players including fill): "gameId|teamId" → total pins
  const teamTotals = new Map<string, number>()
  for (const row of rawScores as RawScore[]) {
    const slot = row.team_slots
    if (!slot?.teams?.weeks?.is_archived) continue
    if (seasonId !== null && slot.teams.weeks.season_id !== seasonId) continue
    if (maxWeekNumber !== undefined && slot.teams.weeks.week_number > maxWeekNumber) continue
    const key = `${row.game_id}|${slot.team_id}`
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

  // Seed every registered player for this season at 0-0 so the roster shows in
  // full before any games are archived. Per-season only: all-time (seasonId ===
  // null) keeps its score-driven roster.
  if (seasonId !== null) {
    for (const r of roster) {
      if (r.season_id !== seasonId) continue
      const p = r.players
      if (!p?.id || !p?.name) continue
      if (!byPlayer.has(p.id)) {
        byPlayer.set(p.id, { name: p.name, wins: 0, losses: 0, pins: 0, games: 0, weeks: new Set() })
      }
    }
  }

  for (const row of rawScores as RawScore[]) {
    const slot = row.team_slots
    if (!slot || slot.is_fill) continue
    const player = slot.players
    if (!player?.id || !player?.name) continue
    if (!slot.teams?.weeks?.is_archived) continue
    if (seasonId !== null && slot.teams.weeks.season_id !== seasonId) continue

    if (maxWeekNumber !== undefined && slot.teams.weeks.week_number > maxWeekNumber) continue

    const myTeam = slot.team_id
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
    // Average denominator counts only bowled games (canonical policy) — an
    // un-bowled 0/null game never drags the average down. W/L is team-based and
    // stays counted above regardless.
    if (countsTowardAverage(row.score)) {
      p.pins  += row.score
      p.games += 1
    }
    p.weeks.add(slot.teams.week_id)
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

export type RankMovement = 'up' | 'down' | 'same'

/**
 * Per-player rank movement vs. the previous archived week within a single season.
 * Returns an empty map for all-time (seasonId === null) or when the season only
 * has one archived week (e.g. week 1) — there is no prior week to compare against.
 */
export function computeRankMovement(
  rawScores: any[],
  rawSchedule: any[],
  seasonId: string | null,
): Map<string, RankMovement> {
  const result = new Map<string, RankMovement>()
  if (seasonId === null) return result

  // Distinct archived week numbers in this season.
  const weekNums = new Set<number>()
  for (const row of rawScores as RawScore[]) {
    const w = row.team_slots?.teams?.weeks
    if (!w?.is_archived || w.season_id !== seasonId) continue
    weekNums.add(w.week_number)
  }
  const sorted = Array.from(weekNums).sort((a, b) => a - b)
  if (sorted.length < 2) return result // week 1 (or none) → no movement

  const latest = sorted[sorted.length - 1]
  const prior = sorted[sorted.length - 2]

  const currentRank = new Map<string, number>()
  computeStandingsFromSupabase(rawScores, rawSchedule, seasonId, latest)
    .forEach((r, i) => currentRank.set(r.playerId, i))
  const priorRank = new Map<string, number>()
  computeStandingsFromSupabase(rawScores, rawSchedule, seasonId, prior)
    .forEach((r, i) => priorRank.set(r.playerId, i))

  for (const [playerId, cur] of currentRank) {
    const prev = priorRank.get(playerId)
    if (prev === undefined) continue // new this week → no arrow
    result.set(playerId, cur < prev ? 'up' : cur > prev ? 'down' : 'same')
  }
  return result
}

interface StandingsPayload {
  seasonList: { id: string; number: number }[]
  currentSeasonNumber: number | null
  championPlayerIds: Set<string>
  topPinBalancePlayerId: string | null
  rawScores: any[]
  rawSchedule: any[]
  rawRegistrations: any[]
}

const EMPTY: StandingsPayload = {
  seasonList: [],
  currentSeasonNumber: null,
  championPlayerIds: new Set(),
  topPinBalancePlayerId: null,
  rawScores: [],
  rawSchedule: [],
  rawRegistrations: [],
}

export function useStandingsData() {
  const { loading, data, reload } = useAsyncData<StandingsPayload>(async () => {
    const [seasonsRes, lastEndedRes, currentRes, scoresRes, scheduleRes, registrationsRes] = await Promise.all([
      seasons.list(),
      seasons.getLastEnded(),
      seasons.getCurrent(),
      scores.listForStandings(),
      games.listForArchivedWeeks(),
      registrations.list(),
    ])
    // Crown only the reigning champion(s) — winners of the most recently ended
    // season — not everyone who has ever won a championship.
    const lastEndedId = lastEndedRes.data?.id
    const champRes = lastEndedId ? await seasonChampions.listBySeason(lastEndedId) : { data: [] }
    // Moneybag: the player with the highest pin balance (Σ amount) in the
    // current active season. balance = SUM(amount) per player (house rows excluded).
    const currentId = currentRes.data?.id
    const ledgerRes = currentId ? await pinLedger.listBySeasonForLeaderboard(currentId) : { data: [] }
    const balances = new Map<string, number>()
    for (const row of (ledgerRes.data ?? []) as any[]) {
      if (!row.player_id) continue
      balances.set(row.player_id, (balances.get(row.player_id) ?? 0) + (row.amount ?? 0))
    }
    let topId: string | null = null
    let topBal = -Infinity
    for (const [pid, bal] of balances) {
      if (bal > topBal) { topBal = bal; topId = pid }
    }
    return {
      seasonList: (seasonsRes.data ?? []).filter(s => !s.registration_open).map(s => ({ id: s.id, number: s.number })),
      currentSeasonNumber: currentRes.data?.number ?? null,
      championPlayerIds: new Set<string>((champRes.data ?? []).map((c: any) => c.player_id)),
      topPinBalancePlayerId: topId,
      rawScores: scoresRes.data ?? [],
      rawSchedule: scheduleRes.data ?? [],
      rawRegistrations: registrationsRes.data ?? [],
    }
  }, [], 'useStandingsData')

  return { loading, ...(data ?? EMPTY), reload }
}
