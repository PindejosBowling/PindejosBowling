import { scores, games, seasonChampions } from '../utils/supabase/db'
import { combinations } from '../utils/helpers'
import { useAsyncData } from './useAsyncData'

export interface ChemistryRow {
  names: string[]
  wins: number
  losses: number
  games: number
  weeks: number
  winRate: number
}

export function computeChemistryFromSupabase(
  rawScores: any[],
  rawSchedule: any[],
  groupSize: 2 | 3,
): ChemistryRow[] {
  const scheduleMap = new Map<string, string>()
  for (const row of rawSchedule) {
    scheduleMap.set(`${row.id}|${row.team_a_id}`, row.team_b_id)
    scheduleMap.set(`${row.id}|${row.team_b_id}`, row.team_a_id)
  }

  const teamTotals = new Map<string, number>()
  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot?.teams?.weeks?.is_archived) continue
    const key = `${row.game_id}|${slot.team_id}`
    teamTotals.set(key, (teamTotals.get(key) ?? 0) + (row.score ?? 0))
  }

  // Per team-week: wins/losses/games, and the non-fill player roster
  const teamWeekMap = new Map<string, {
    wins: number
    losses: number
    games: number
    gamesProcessed: Set<string>
    playerMap: Map<string, string> // player_id → name
  }>()

  for (const row of rawScores) {
    const slot = row.team_slots
    if (!slot?.teams?.weeks?.is_archived) continue

    const twKey = `${slot.teams.week_id}|${slot.team_id}`
    if (!teamWeekMap.has(twKey)) {
      teamWeekMap.set(twKey, { wins: 0, losses: 0, games: 0, gamesProcessed: new Set(), playerMap: new Map() })
    }
    const tw = teamWeekMap.get(twKey)!

    // Accumulate W/L/games once per game (all players contribute to team total, incl. fill)
    if (!tw.gamesProcessed.has(row.game_id)) {
      tw.gamesProcessed.add(row.game_id)
      const gameKey = `${row.game_id}|${slot.team_id}`
      const oppTeam = scheduleMap.get(gameKey)
      if (oppTeam !== undefined) {
        const myTotal = teamTotals.get(gameKey) ?? 0
        const oppTotal = teamTotals.get(`${row.game_id}|${oppTeam}`) ?? 0
        tw.wins += myTotal > oppTotal ? 1 : 0
        tw.losses += myTotal <= oppTotal ? 1 : 0
      }
      tw.games++
    }

    // Only roster non-fill players for combination generation
    if (!slot.is_fill) {
      const player = slot.players
      if (player?.id && player?.name) {
        tw.playerMap.set(player.id, player.name)
      }
    }
  }

  const groups = new Map<string, { names: string[]; wins: number; losses: number; games: number; weeks: number }>()

  for (const tw of teamWeekMap.values()) {
    const playerNames = Array.from(tw.playerMap.values())
    if (playerNames.length < groupSize) continue

    const combos: string[][] = combinations(playerNames, groupSize)
    for (const combo of combos) {
      const names = [...combo].sort()
      const key = names.join('|')
      if (!groups.has(key)) {
        groups.set(key, { names, wins: 0, losses: 0, games: 0, weeks: 0 })
      }
      const g = groups.get(key)!
      g.wins += tw.wins
      g.losses += tw.losses
      g.games += tw.games
      g.weeks++
    }
  }

  const minWeeks = groupSize === 2 ? 2 : 1
  return Array.from(groups.values())
    .filter(g => g.weeks >= minWeeks)
    .map(g => ({ ...g, winRate: g.games > 0 ? g.wins / g.games : 0 }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
}

interface ChemistryPayload {
  rawScores: any[]
  rawSchedule: any[]
  championNames: Set<string>
}

const EMPTY: ChemistryPayload = { rawScores: [], rawSchedule: [], championNames: new Set() }

export function useChemistryData() {
  const { loading, data, reload } = useAsyncData<ChemistryPayload>(async () => {
    const [scoresRes, scheduleRes, champRes] = await Promise.all([
      scores.listForStandings(),
      games.listForArchivedWeeks(),
      seasonChampions.list(),
    ])
    return {
      rawScores: scoresRes.data ?? [],
      rawSchedule: scheduleRes.data ?? [],
      championNames: new Set<string>(
        (champRes.data ?? []).flatMap((c: any) => c.players?.name ? [c.players.name] : [])
      ),
    }
  }, [], 'useChemistryData')

  return { loading, ...(data ?? EMPTY), reload }
}
