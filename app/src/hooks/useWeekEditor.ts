import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  teams as teamsDb,
  teamSlots,
  games as gamesDb,
  scores as scoresDb,
  players as playersDb,
} from '../utils/supabase/db'

// ---------------------------------------------------------------------------
// Shared admin editor for a single week, organized PER GAME. Loads everything
// by weekId (works for live AND archived weeks — none of these queries filter
// on is_archived).
//
// Why per-game (not per-team-for-the-week): a slot is week+team scoped, but a
// player's participation in a game is encoded by whether a (team_slot, game)
// score row exists — and `scores.score` is nullable, so a null-score row means
// "present in this game, not yet scored". Rosters can therefore differ between
// games, and a player can appear on two different teams the same night (two
// slots, each scored only in the relevant game). The editor's unit is thus the
// per-game *participation*; on save it reconciles participations down to the
// minimal set of team_slots / scores mutations (one slot per (team, player);
// fill slots kept by origin).
//
// Used by both MatchupsScreen and HistoryScreen via <EditableWeek>.
// ---------------------------------------------------------------------------

export interface RosterPlayer {
  id: string
  name: string
}

export interface EditableGameMeta {
  gameId: string           // a game ROW (matchup) — a game_number can have several
  gameNumber: number
  teamAId: string
  teamBId: string
  teamANumber: number
  teamBNumber: number
}

export interface Participant {
  partId: string
  playerId: string | null // null ⇒ league fill
  playerName: string       // '' for a fill (rendered as "League Avg Fill")
  isFill: boolean
  score: string            // '' ⇒ present, no score yet
}

// Internal per-game participation row.
interface PartRow {
  partId: string
  gameNumber: number
  teamId: string
  playerId: string | null
  playerName: string
  score: string
  slotId: string | null    // originating team_slot id; null for a brand-new one
}

interface SlotMeta { teamId: string; playerId: string | null; isFill: boolean }

export interface WeekEditor {
  loading: boolean
  enabled: boolean
  leagueAvg: number
  saving: boolean
  pendingCount: number
  games: EditableGameMeta[]
  roster: RosterPlayer[]
  participants: (gameNumber: number, teamId: string) => Participant[]
  teamTotal: (gameNumber: number, teamId: string) => number
  playerIdsInGame: (gameNumber: number) => Set<string>
  // mutators (draft only — all reversible via discard)
  setScore: (partId: string, value: string) => void
  swapPlayer: (partId: string, player: RosterPlayer) => void
  makeFill: (partId: string) => void
  moveToOtherTeam: (partId: string) => void
  addPlayer: (gameNumber: number, teamId: string, player: RosterPlayer) => void
  addFill: (gameNumber: number, teamId: string) => void
  removeParticipant: (partId: string) => void
  // lifecycle
  discard: () => void
  save: () => Promise<void>
}

const clone = (rows: PartRow[]): PartRow[] => rows.map(r => ({ ...r }))
const cleanScore = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 3)

export function useWeekEditor(
  weekId: string | null,
  enabled: boolean,
  leagueAvg = 0,
  onSaved?: () => void | Promise<void>,
): WeekEditor {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [games, setGames] = useState<EditableGameMeta[]>([])
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [parts, setParts] = useState<PartRow[]>([])

  const originalPartsRef = useRef<PartRow[]>([])
  const originalSlotsRef = useRef<Map<string, SlotMeta>>(new Map())
  const originalScoreRef = useRef<Map<string, string>>(new Map()) // `${slotId}:${gameNumber}` → score string
  // `${gameNumber}|${teamId}` → game ROW id. A team plays at most one matchup per
  // game_number, so this resolves a participation back to its specific game row.
  const gameIdByNumberTeamRef = useRef<Map<string, string>>(new Map())
  const slotSeqRef = useRef(0)
  const tmpSeqRef = useRef(0)

  const load = useCallback(async () => {
    if (!weekId) {
      setGames([]); setRoster([]); setParts([])
      originalPartsRef.current = []
      originalSlotsRef.current = new Map()
      originalScoreRef.current = new Map()
      return
    }
    setLoading(true)
    try {
      const [teamsRes, slotsRes, gamesRes, scoresRes, rosterRes] = await Promise.all([
        teamsDb.listByWeek(weekId),
        teamSlots.listByWeek(weekId),
        gamesDb.listByWeek(weekId),
        scoresDb.listByWeek(weekId),
        playersDb.list(),
      ])

      const teamNumberById = new Map<string, number>(
        ((teamsRes.data ?? []) as any[]).map(t => [t.id, t.team_number]),
      )

      const gameNumberById: Record<string, number> = {}
      const gameMetas: EditableGameMeta[] = ((gamesRes.data ?? []) as any[]).map(g => {
        gameNumberById[g.id] = g.game_number
        return {
          gameId: g.id,
          gameNumber: g.game_number,
          teamAId: g.team_a_id,
          teamBId: g.team_b_id,
          teamANumber: teamNumberById.get(g.team_a_id) ?? 0,
          teamBNumber: teamNumberById.get(g.team_b_id) ?? 0,
        }
      })
      gameMetas.sort((a, b) => (a.gameNumber - b.gameNumber) || (a.teamANumber - b.teamANumber))

      const gameIdByNumberTeam = new Map<string, string>()
      for (const g of gameMetas) {
        gameIdByNumberTeam.set(`${g.gameNumber}|${g.teamAId}`, g.gameId)
        gameIdByNumberTeam.set(`${g.gameNumber}|${g.teamBId}`, g.gameId)
      }
      gameIdByNumberTeamRef.current = gameIdByNumberTeam

      // Which game numbers each team is scheduled for (default roster fallback).
      const teamScheduledGames = new Map<string, Set<number>>()
      for (const g of gameMetas) {
        if (!teamScheduledGames.has(g.teamAId)) teamScheduledGames.set(g.teamAId, new Set())
        if (!teamScheduledGames.has(g.teamBId)) teamScheduledGames.set(g.teamBId, new Set())
        teamScheduledGames.get(g.teamAId)!.add(g.gameNumber)
        teamScheduledGames.get(g.teamBId)!.add(g.gameNumber)
      }

      // Actual score rows: (slotId, gameNumber) → score string ('' for null).
      const scoreByKey = new Map<string, string>()
      const scoredGamesBySlot = new Map<string, Set<number>>()
      for (const row of (scoresRes.data ?? []) as any[]) {
        const gn = gameNumberById[row.game_id]
        if (gn == null) continue
        const sid = row.team_slot_id
        scoreByKey.set(`${sid}:${gn}`, row.score == null ? '' : String(row.score))
        if (!scoredGamesBySlot.has(sid)) scoredGamesBySlot.set(sid, new Set())
        scoredGamesBySlot.get(sid)!.add(gn)
      }

      const slotMeta = new Map<string, SlotMeta>()
      let maxSlot = 0
      const partRows: PartRow[] = []
      for (const s of (slotsRes.data ?? []) as any[]) {
        if (s.slot > maxSlot) maxSlot = s.slot
        const meta: SlotMeta = { teamId: s.team_id, playerId: s.player_id ?? null, isFill: !s.player_id }
        slotMeta.set(s.id, meta)
        const name = s.player_id ? (s.players?.name ?? '') : ''
        // Participation = games this slot has score rows for. Rows are seeded at
        // matchup creation (DB trigger), so the schedule fallback below only
        // applies to pre-seeding history (archived weeks edited via History).
        const scored = scoredGamesBySlot.get(s.id)
        const gameNums = scored && scored.size > 0
          ? Array.from(scored)
          : Array.from(teamScheduledGames.get(s.team_id) ?? [])
        for (const gn of gameNums) {
          partRows.push({
            partId: `${s.id}:${gn}`,
            gameNumber: gn,
            teamId: s.team_id,
            playerId: meta.playerId,
            playerName: name,
            score: scoreByKey.get(`${s.id}:${gn}`) ?? '',
            slotId: s.id,
          })
        }
      }

      slotSeqRef.current = maxSlot + 1
      tmpSeqRef.current = 0
      originalSlotsRef.current = slotMeta
      originalScoreRef.current = scoreByKey
      originalPartsRef.current = clone(partRows)

      setGames(gameMetas)
      setRoster(((rosterRes.data ?? []) as any[]).map(p => ({ id: p.id, name: p.name })))
      setParts(partRows)
    } finally {
      setLoading(false)
    }
  }, [weekId])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  // ----- selectors ----------------------------------------------------------

  const participants = useCallback((gameNumber: number, teamId: string): Participant[] =>
    parts
      .filter(p => p.gameNumber === gameNumber && p.teamId === teamId)
      .sort((a, b) => {
        if (a.playerId == null && b.playerId != null) return 1
        if (a.playerId != null && b.playerId == null) return -1
        return a.playerName.localeCompare(b.playerName)
      })
      .map(p => ({
        partId: p.partId,
        playerId: p.playerId,
        playerName: p.playerName,
        isFill: p.playerId == null,
        score: p.score,
      })),
    [parts])

  const teamTotal = useCallback((gameNumber: number, teamId: string): number =>
    parts
      .filter(p => p.gameNumber === gameNumber && p.teamId === teamId)
      .reduce((sum, p) => {
        if (p.score !== '') return sum + (parseInt(p.score) || 0)
        if (p.playerId == null) return sum + (leagueAvg > 0 ? Math.round(leagueAvg) : 0)
        return sum
      }, 0),
    [parts, leagueAvg])

  const playerIdsInGame = useCallback((gameNumber: number): Set<string> =>
    new Set(parts.filter(p => p.gameNumber === gameNumber && p.playerId != null).map(p => p.playerId as string)),
    [parts])

  // ----- mutators -----------------------------------------------------------

  const setScore = useCallback((partId: string, value: string) => {
    const clean = cleanScore(value)
    setParts(prev => prev.map(p => p.partId === partId ? { ...p, score: clean } : p))
  }, [])

  const swapPlayer = useCallback((partId: string, player: RosterPlayer) => {
    setParts(prev => prev.map(p => p.partId === partId ? { ...p, playerId: player.id, playerName: player.name } : p))
  }, [])

  const makeFill = useCallback((partId: string) => {
    setParts(prev => prev.map(p => p.partId === partId ? { ...p, playerId: null, playerName: '' } : p))
  }, [])

  const moveToOtherTeam = useCallback((partId: string) => {
    setParts(prev => {
      const part = prev.find(p => p.partId === partId)
      if (!part) return prev
      const g = games.find(gm => gm.gameNumber === part.gameNumber)
      if (!g) return prev
      const otherTeam = part.teamId === g.teamAId ? g.teamBId : g.teamAId
      return prev.map(p => p.partId === partId ? { ...p, teamId: otherTeam } : p)
    })
  }, [games])

  const addPlayer = useCallback((gameNumber: number, teamId: string, player: RosterPlayer) => {
    setParts(prev => [...prev, {
      partId: `tmp-${tmpSeqRef.current++}`,
      gameNumber, teamId,
      playerId: player.id, playerName: player.name,
      score: '', slotId: null,
    }])
  }, [])

  const addFill = useCallback((gameNumber: number, teamId: string) => {
    setParts(prev => [...prev, {
      partId: `tmp-${tmpSeqRef.current++}`,
      gameNumber, teamId,
      playerId: null, playerName: '',
      score: '', slotId: null,
    }])
  }, [])

  const removeParticipant = useCallback((partId: string) => {
    setParts(prev => prev.filter(p => p.partId !== partId))
  }, [])

  const discard = useCallback(() => {
    setParts(clone(originalPartsRef.current))
  }, [])

  // ----- pending count ------------------------------------------------------

  const pendingCount = useMemo(() => {
    const origById = new Map(originalPartsRef.current.map(p => [p.partId, p]))
    const draftIds = new Set(parts.map(p => p.partId))
    let count = 0
    for (const p of parts) {
      const o = origById.get(p.partId)
      if (!o) { count++; continue }
      if (o.score !== p.score || o.playerId !== p.playerId || o.teamId !== p.teamId) count++
    }
    for (const o of originalPartsRef.current) {
      if (!draftIds.has(o.partId)) count++
    }
    return count
  }, [parts])

  // ----- save / reconcile ---------------------------------------------------

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const originalSlots = originalSlotsRef.current
      const originalScore = originalScoreRef.current
      const gameIdByNumberTeam = gameIdByNumberTeamRef.current

      // existing real slot lookup: `${teamId}|${playerId}` → slotId
      const realSlotByKey = new Map<string, string>()
      const fillSlotIds = new Set<string>()
      for (const [sid, m] of originalSlots) {
        if (m.playerId != null) realSlotByKey.set(`${m.teamId}|${m.playerId}`, sid)
        else fillSlotIds.add(sid)
      }

      // Group draft participations by the slot they resolve to.
      interface SlotGroup {
        teamId: string
        playerId: string | null
        existingSlotId?: string
        slotNum?: number
        resolvedId?: string
        games: Map<number, number | null>
      }
      const bySlot = new Map<string, SlotGroup>()
      for (const p of parts) {
        let key: string
        let existingSlotId: string | undefined
        if (p.playerId != null) {
          existingSlotId = realSlotByKey.get(`${p.teamId}|${p.playerId}`)
          key = existingSlotId ?? `newreal|${p.teamId}|${p.playerId}`
        } else if (p.slotId && fillSlotIds.has(p.slotId) && originalSlots.get(p.slotId)?.teamId === p.teamId) {
          existingSlotId = p.slotId
          key = p.slotId
        } else {
          key = `newfill|${p.partId}`
        }
        let group = bySlot.get(key)
        if (!group) {
          group = { teamId: p.teamId, playerId: p.playerId, existingSlotId, games: new Map() }
          bySlot.set(key, group)
        }
        group.games.set(p.gameNumber, p.score === '' ? null : parseInt(p.score))
      }

      // Create slots that don't exist yet.
      const newGroups: SlotGroup[] = []
      for (const group of bySlot.values()) {
        if (!group.existingSlotId) {
          group.slotNum = slotSeqRef.current++
          newGroups.push(group)
        } else {
          group.resolvedId = group.existingSlotId
        }
      }
      if (newGroups.length) {
        const rows = newGroups.map(g => ({ team_id: g.teamId, slot: g.slotNum!, player_id: g.playerId }))
        const { data, error } = await teamSlots.insert(rows)
        if (error) throw error
        const realByKey = new Map<string, string>()
        for (const r of (data ?? []) as any[]) realByKey.set(`${r.team_id}|${r.slot}`, r.id)
        for (const g of newGroups) g.resolvedId = realByKey.get(`${g.teamId}|${g.slotNum}`)
      }

      // Desired score rows + which existing slots are still used.
      const desiredKeys = new Set<string>()
      const usedSlotIds = new Set<string>()
      const upserts: { team_slot_id: string; game_id: string; score: number | null }[] = []
      for (const group of bySlot.values()) {
        const sid = group.resolvedId
        if (!sid) continue
        usedSlotIds.add(sid)
        for (const [gn, score] of group.games) {
          const gid = gameIdByNumberTeam.get(`${gn}|${group.teamId}`)
          if (!gid) continue
          const key = `${sid}:${gn}`
          desiredKeys.add(key)
          // skip writes that match what's already stored on an existing slot
          if (group.existingSlotId && originalScore.has(key)) {
            const desiredVal = score == null ? '' : String(score)
            if (originalScore.get(key) === desiredVal) continue
          }
          upserts.push({ team_slot_id: sid, game_id: gid, score })
        }
      }

      // Slots no longer used at all → delete (cascades any remaining scores).
      const slotDeletes: string[] = []
      for (const sid of originalSlots.keys()) {
        if (!usedSlotIds.has(sid)) slotDeletes.push(sid)
      }
      const deletedSlots = new Set(slotDeletes)

      // Score rows present originally but no longer desired (skip ones whose slot
      // is being deleted — the cascade handles those).
      const scoreDeletes: { slotId: string; gameId: string }[] = []
      for (const key of originalScore.keys()) {
        if (desiredKeys.has(key)) continue
        const [sid, gnStr] = key.split(':')
        if (deletedSlots.has(sid)) continue
        const teamId = originalSlots.get(sid)?.teamId
        const gid = teamId ? gameIdByNumberTeam.get(`${gnStr}|${teamId}`) : undefined
        if (!gid) continue
        scoreDeletes.push({ slotId: sid, gameId: gid })
      }

      if (upserts.length) {
        const { error } = await scoresDb.upsert(upserts)
        if (error) throw error
      }
      for (const d of scoreDeletes) {
        const { error } = await scoresDb.remove(d.slotId, d.gameId)
        if (error) throw error
      }
      for (const sid of slotDeletes) {
        const { error } = await teamSlots.remove(sid)
        if (error) throw error
      }

      await load()
      await onSaved?.()
    } finally {
      setSaving(false)
    }
  }, [parts, load, onSaved])

  return {
    loading,
    enabled,
    leagueAvg,
    saving,
    pendingCount,
    games,
    roster,
    participants,
    teamTotal,
    playerIdsInGame,
    setScore,
    swapPlayer,
    makeFill,
    moveToOtherTeam,
    addPlayer,
    addFill,
    removeParticipant,
    discard,
    save,
  }
}
