import { useState, useEffect, useCallback } from 'react'
import { weeks, teamSlots, games, scores, rsvp, seasons, seasonChampions } from '../utils/supabase/db'

export interface MatchupsPlayer {
  name: string
  slot: number
  g1: number | ''
  g2: number | ''
  g3: number | ''
  isFill: boolean
  effectiveAvg: number
  teamSlotId: string
  isOut: boolean
  isChampion: boolean
}

export interface MatchupsTeam {
  name: string
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

      const prevSeason = allSeasons.length >= 2
        ? allSeasons[allSeasons.length - 2]
        : allSeasons[allSeasons.length - 1]

      const [slotsRes, scheduleRes, weekScoresRes, rsvpRes, prevScoresRes] = await Promise.all([
        teamSlots.listByWeek(week.id),
        games.listByWeek(week.id),
        scores.listByWeek(week.id),
        rsvp.listByWeek(week.id),
        prevSeason ? scores.listBySeason(prevSeason.id) : Promise.resolve({ data: [] as any[] }),
      ])

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
        const teamName = `Team ${slot.team_number}`
        if (!teams[teamName]) teams[teamName] = { name: teamName, players: [], opponents: {}, expectedTotal: 0 }

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
          g1: slotScores[1] !== undefined ? slotScores[1] : '',
          g2: slotScores[2] !== undefined ? slotScores[2] : '',
          g3: slotScores[3] !== undefined ? slotScores[3] : '',
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

      for (const game of schedule as any[]) {
        const teamA = `Team ${game.team_a}`
        const teamB = `Team ${game.team_b}`
        if (teams[teamA]) teams[teamA].opponents[String(game.game_number)] = teamB
        if (teams[teamB]) teams[teamB].opponents[String(game.game_number)] = teamA
      }

      const rounds: MatchupsDerived['rounds'] = []
      for (let g = 1; g <= 3; g++) {
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

  return { loading, weekId, derived, gameIdByNumber, reload: load }
}
