import { useState, useEffect, useCallback } from 'react'
import { weeks, teamSlots, games, scores, rsvp, seasons, seasonChampions, betMarkets } from '../utils/supabase/db'

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
      const [weekRes, seasonsRes, championsRes] = await Promise.all([
        weeks.getActive(),
        seasons.list(),
        seasonChampions.list(),
      ])

      const week = weekRes.data
      const allSeasons = seasonsRes.data ?? []
      const champRows = championsRes.data ?? []

      if (!week) {
        setWeekId(null)
        setDerived(null)
        return
      }

      setWeekId(week.id)

      const championPlayerIds = new Set(champRows.map((c: any) => c.player_id))

      // Only seasons that have started count — a season still in registration
      // (registration_open) has no scores and must not be mistaken for the
      // current season when picking the previous season for average calc.
      const startedSeasons = allSeasons.filter((s: any) => !s.registration_open)
      const prevSeason = startedSeasons.length >= 2
        ? startedSeasons[startedSeasons.length - 2]
        : startedSeasons[startedSeasons.length - 1]

      const [slotsRes, scheduleRes, weekScoresRes, rsvpRes, prevScoresRes, marketStatusRes] = await Promise.all([
        teamSlots.listByWeek(week.id),
        games.listByWeek(week.id),
        scores.listByWeek(week.id),
        rsvp.listByWeek(week.id),
        prevSeason ? scores.listBySeason(prevSeason.id) : Promise.resolve({ data: [] as any[] }),
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
      const prevScores = prevScoresRes.data ?? []

      // League avg and per-player avgs from prev-season archived scores
      const totalPins = prevScores.reduce((s: number, r: any) => s + (r.score ?? 0), 0)
      const leagueAvg = prevScores.length > 0 ? totalPins / prevScores.length : 0

      const byPlayer: Record<string, { pins: number; games: number }> = {}
      for (const row of prevScores) {
        const pid = (row as any).team_slots?.player_id
        if (!pid) continue
        if (!byPlayer[pid]) byPlayer[pid] = { pins: 0, games: 0 }
        byPlayer[pid].pins += row.score ?? 0
        byPlayer[pid].games += 1
      }
      const playerAvgById: Record<string, number> = Object.fromEntries(
        Object.entries(byPlayer).map(([pid, { pins, games }]) => [pid, games > 0 ? pins / games : 0])
      )

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
        const effectiveAvg = slot.is_fill || isOut
          ? leagueAvg
          : (playerId ? (playerAvgById[playerId] ?? leagueAvg) : leagueAvg)

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
