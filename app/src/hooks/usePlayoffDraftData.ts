import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../utils/supabase/client'
import { playoffDrafts, seasons, weeks, scores, games } from '../utils/supabase/db'

export type DraftStatus = 'setup' | 'drafting' | 'completed' | 'materialized'
export type DraftType = 'snake' | 'straight'

export interface DraftCaptain {
  id: string
  playerId: string
  name: string
  seed: number
}

export interface DraftPick {
  id: string
  pickNumber: number
  captainPlayerId: string
  pickedPlayerId: string
  pickedName: string
}

export interface DraftPoolEntry {
  id: string
  playerId: string
  name: string
}

/**
 * Whose turn is it for pick k = picks.length + 1? Mirrors the SQL function
 * playoff_current_turn exactly: straight repeats seeds 1..N every round;
 * snake reverses every other round. Returns the seed on the clock, or null
 * when the draft is over (no remaining players).
 */
export function computeDraftTurnSeed(
  draftType: DraftType,
  captainCount: number,
  pickCount: number,
  remainingCount: number,
): number | null {
  if (captainCount === 0 || remainingCount === 0) return null
  const k = pickCount + 1
  const round = Math.floor((k - 1) / captainCount)
  const idx = (k - 1) % captainCount
  if (draftType === 'snake' && round % 2 === 1) return captainCount - idx
  return idx + 1
}

/**
 * Is this player a captain of the current season's playoff draft? Drives the
 * MoreHome Playoffs tile for non-admins (admins always see it).
 */
export function useIsPlayoffCaptain(playerId: string | null) {
  const [isCaptain, setIsCaptain] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      if (!playerId) {
        setIsCaptain(false)
        return
      }
      try {
        const seasonRes = await seasons.getCurrent()
        const sid = seasonRes.data?.id
        if (!sid) {
          if (!cancelled) setIsCaptain(false)
          return
        }
        const { data } = await playoffDrafts.listCaptainIdsForSeason(sid)
        if (!cancelled) setIsCaptain((data ?? []).some((r: any) => r.player_id === playerId))
      } catch (e) {
        console.error('useIsPlayoffCaptain error:', e)
      }
    }
    check()
    return () => { cancelled = true }
  }, [playerId])

  return isCaptain
}

export function usePlayoffDraftData() {
  const [loading, setLoading] = useState(true)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [rawDraft, setRawDraft] = useState<any | null>(null)
  const [rawWeeks, setRawWeeks] = useState<any[]>([])
  const [rawDraftablePlayers, setRawDraftablePlayers] = useState<any[]>([])
  const [rawScores, setRawScores] = useState<any[]>([])
  const [rawSchedule, setRawSchedule] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const seasonRes = await seasons.getCurrent()
      const sid = seasonRes.data?.id ?? null
      setSeasonId(sid)
      if (!sid) {
        setRawDraft(null)
        setRawWeeks([])
        setRawDraftablePlayers([])
        return
      }
      // Standings raw data feeds the seed ordering of chosen captains at setup.
      const [draftRes, weeksRes, playersRes, scoresRes, scheduleRes] = await Promise.all([
        playoffDrafts.getBySeasonWithGraph(sid),
        weeks.listBySeason(sid),
        playoffDrafts.listDraftablePlayers(sid),
        scores.listForStandings(),
        games.listForArchivedWeeks(),
      ])
      setRawDraft(draftRes.data ?? null)
      setRawWeeks(weeksRes.data ?? [])
      setRawDraftablePlayers(playersRes.data ?? [])
      setRawScores(scoresRes.data ?? [])
      setRawSchedule(scheduleRes.data ?? [])
    } catch (e) {
      console.error('usePlayoffDraftData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live draft room: any change to the draft or its pick log on another device
  // means "refetch" (the useWeekClock pattern — DB is the source of truth).
  useEffect(() => {
    const channel = supabase
      .channel('playoff-draft')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playoff_draft_picks' }, () => {
        load()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playoff_drafts' }, () => {
        load()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return {
    loading,
    seasonId,
    rawDraft,
    rawWeeks,
    rawDraftablePlayers,
    rawScores,
    rawSchedule,
    reload: load,
  }
}
