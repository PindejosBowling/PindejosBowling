import { useState, useEffect, useCallback } from 'react'
import { weeks, teamSlots, games, scores, rsvp, seasonChampions, betMarkets } from '../utils/supabase/db'
import { aggregatePlayerAverages, effectiveAverage, type AverageRow } from '../utils/averages'

export interface MatchupsPlayer {
  name: string
  slot: number
  // Saved scores keyed by game number (1, 2, 3, … N) — supports arbitrary added games.
  scores: Record<number, number | ''>
  isFill: boolean
  effectiveAvg: number
  teamSlotId: string
  isOut: boolean
  isChampion: boolean
}

export interface MatchupsTeam {
  name: string
  teamId: string
  teamNumber: number
  players: MatchupsPlayer[]
  opponents: Record<string, string>
  expectedTotal: number
}

export interface MatchupsDerived {
  leagueAvg: number
  teams: Record<string, MatchupsTeam>
  rounds: { num: number; pairings: { a: MatchupsTeam; b: MatchupsTeam | null }[] }[]
}

/** One unscored fill participation row → the score archive_week should stamp. */
export interface FillScoreRow {
  team_slot_id: string
  game_id: string
  score: number
}

/**
 * The archive payload for `archive_week(p_fill_scores)`: every fill slot's
 * unscored participation row, valued at the same league-average estimate the
 * matchup screen displays (MatchupsScreen getTotal's fill branch). Stored
 * scores — admin-typed fill values included — stay untouched and win; rows
 * with a zero estimate are omitted (the live screen contributed 0, and a NULL
 * archived row also contributes 0).
 *
 * Pure and uncached — wrap in `useMemo` at the screen.
 */
export function computeUnscoredFillScores(
  teams: Record<string, MatchupsTeam>,
  gameIdByNumber: Record<number, string>,
): FillScoreRow[] {
  const rows: FillScoreRow[] = []
  for (const team of Object.values(teams)) {
    for (const p of team.players) {
      if (!p.isFill) continue
      for (const [num, value] of Object.entries(p.scores)) {
        // '' = participation row exists, score NULL (unscored).
        if (value !== '') continue
        const gameId = gameIdByNumber[Number(num)]
        const score = Math.round(p.effectiveAvg)
        if (gameId && score > 0) rows.push({ team_slot_id: p.teamSlotId, game_id: gameId, score })
      }
    }
  }
  return rows
}

export function useMatchupsData() {
  const [loading, setLoading] = useState(true)
  const [weekId, setWeekId] = useState<string | null>(null)
  const [derived, setDerived] = useState<MatchupsDerived | null>(null)
  const [gameIdByNumber, setGameIdByNumber] = useState<Record<number, string>>({})
  // Game numbers whose O/U betting markets are closed (game "in progress").
  const [inProgressGames, setInProgressGames] = useState<number[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [weekRes, championsRes] = await Promise.all([
        weeks.getActive(),
        seasonChampions.list(),
      ])

      const week = weekRes.data
      const champRows = championsRes.data ?? []

      if (!week) {
        setWeekId(null)
        setDerived(null)
        return
      }

      setWeekId(week.id)

      const championPlayerIds = new Set(champRows.map((c: any) => c.player_id))

      const [slotsRes, scheduleRes, weekScoresRes, rsvpRes, archivedScoresRes, marketStatusRes] = await Promise.all([
        teamSlots.listByWeek(week.id),
        games.listByWeek(week.id),
        scores.listByWeek(week.id),
        rsvp.listByWeek(week.id),
        // All-time official games across every season — a player's average
        // defaults to their total career average, not a single prior season.
        scores.listAllArchived(),
        betMarkets.listOUStatusByWeek(week.id),
      ])

      // A game is "in progress" once its betting markets are closed.
      setInProgressGames(
        Array.from(
          new Set(
            (marketStatusRes.data ?? [])
              .filter((m: any) => m.status === 'closed')
              .map((m: any) => m.game_number as number)
          )
        )
      )

      const slots = slotsRes.data ?? []
      const schedule = scheduleRes.data ?? []
      const idByNumber: Record<number, string> = {}
      const numberById: Record<string, number> = {}
      for (const g of schedule as any[]) {
        idByNumber[g.game_number] = g.id
        numberById[g.id] = g.game_number
      }
      setGameIdByNumber(idByNumber)
      const weekScores = weekScoresRes.data ?? []
      const rsvpRows = rsvpRes.data ?? []
      const archivedScores = archivedScoresRes.data ?? []

      // Per-player + games-weighted league averages across all-time archived
      // scores (canonical policy — see utils/averages). listAllArchived already
      // strips fills/nulls; the util's guards make this idempotent.
      const avgAgg = aggregatePlayerAverages(archivedScores as AverageRow[])
      const leagueAvg = avgAgg.leagueAvg

      const outPlayerIds = new Set(
        rsvpRows.filter((r: any) => r.status === 'Out').map((r: any) => r.player_id)
      )

      const scoresBySlotId: Record<string, Record<number, number | ''>> = {}
      for (const row of weekScores) {
        if (!scoresBySlotId[(row as any).team_slot_id]) scoresBySlotId[(row as any).team_slot_id] = {}
        scoresBySlotId[(row as any).team_slot_id][numberById[(row as any).game_id]] = (row as any).score ?? ''
      }

      const teams: Record<string, MatchupsTeam> = {}
      for (const slot of slots as any[]) {
        const teamNumber: number = slot.teams?.team_number ?? 0
        const teamName = `Team ${teamNumber}`
        if (!teams[teamName]) teams[teamName] = { name: teamName, teamId: slot.team_id, teamNumber, players: [], opponents: {}, expectedTotal: 0 }

        const slotScores = scoresBySlotId[slot.id] ?? {}
        const playerId: string | null = slot.player_id
        const isOut = playerId ? outPlayerIds.has(playerId) : false
        const isChampion = playerId ? championPlayerIds.has(playerId) : false
        const effectiveAvg = effectiveAverage(avgAgg, playerId, { isFill: slot.is_fill, isOut })

        teams[teamName].players.push({
          name: slot.is_fill ? 'League Avg Fill' : (slot.players?.name ?? ''),
          slot: slot.slot,
          scores: slotScores,
          isFill: slot.is_fill ?? false,
          effectiveAvg,
          teamSlotId: slot.id,
          isOut,
          isChampion,
        })
      }

      Object.values(teams).forEach(t => {
        t.players.sort((a, b) => a.slot - b.slot)
        t.expectedTotal = t.players.reduce(
          (s, p) => s + (p.effectiveAvg > 0 ? Math.round(p.effectiveAvg) : 0),
          0
        )
      })

      const nameByTeamId = new Map<string, string>()
      for (const t of Object.values(teams)) nameByTeamId.set(t.teamId, t.name)

      for (const game of schedule as any[]) {
        const teamA = nameByTeamId.get(game.team_a_id)
        const teamB = nameByTeamId.get(game.team_b_id)
        if (teamA && teamB) {
          if (teams[teamA]) teams[teamA].opponents[String(game.game_number)] = teamB
          if (teams[teamB]) teams[teamB].opponents[String(game.game_number)] = teamA
        }
      }

      // Render a round per scheduled game number (not a hardcoded 1–3) so that
      // arbitrary added games (4, 5, …) appear. Games with no resolvable pairing
      // are skipped below.
      const gameNumbers = Array.from(
        new Set((schedule as any[]).map(g => g.game_number as number))
      ).sort((a, b) => a - b)

      const rounds: MatchupsDerived['rounds'] = []
      for (const g of gameNumbers) {
        const names = Object.keys(teams).sort()
        const seen = new Set<string>()
        const pairings: { a: MatchupsTeam; b: MatchupsTeam | null }[] = []
        names.forEach(t => {
          if (seen.has(t)) return
          const opp = teams[t]?.opponents?.[String(g)]
          if (opp && teams[opp] && teams[opp].opponents?.[String(g)] === t) {
            seen.add(t); seen.add(opp)
            pairings.push({ a: teams[t], b: teams[opp] })
          }
        })
        if (pairings.length) rounds.push({ num: g, pairings })
      }

      setDerived({ leagueAvg, teams, rounds })
    } catch (e) {
      console.error('useMatchupsData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { loading, weekId, derived, gameIdByNumber, inProgressGames, reload: load }
}
