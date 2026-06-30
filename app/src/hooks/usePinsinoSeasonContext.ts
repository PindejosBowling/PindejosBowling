import { useState, useCallback, useEffect } from 'react'
import { seasons } from '../utils/supabase/db'
import { useUiStore } from '../stores/uiStore'
import type { Tables } from '../utils/supabase/database.types'

type SeasonRow = Tables<'seasons'>

// Shared "viewed season" context for the entire Pinsino tab. Reads the global
// selection (`pinsinoViewSeasonId`) and resolves it against the live season so
// every screen gets a cheap `readOnly` flag and the prior-season list without
// re-querying. `readOnly` is true only when an explicit PRIOR season is picked
// (different from live) — the between-seasons "last-ended" default is NOT
// read-only (the user took no action), so screens don't double-banner.
export interface PinsinoSeasonContext {
  // All seasons, newest first (the selector builds its prior-season pills from
  // the concluded ones).
  seasons: SeasonRow[]
  // The current playing season's id (null between seasons).
  liveSeasonId: string | null
  // The season actually being shown: the explicit prior pick, else live.
  viewSeasonId: string | null
  // The viewed prior season's number (for read-only banners); null when live.
  viewSeasonNumber: number | null
  // Drives all read-only gating across the tab.
  readOnly: boolean
  loading: boolean
}

export function usePinsinoSeasonContext(): PinsinoSeasonContext {
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const [allSeasons, setAllSeasons] = useState<SeasonRow[]>([])
  const [liveSeasonId, setLiveSeasonId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, currentRes] = await Promise.all([
        seasons.list(),
        seasons.getCurrent(),
      ])
      const list = (listRes.data ?? []).slice().sort((a, b) => b.number - a.number)
      setAllSeasons(list)
      setLiveSeasonId(currentRes.data?.id ?? null)
    } catch (e) {
      console.error('usePinsinoSeasonContext error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const readOnly = pinsinoViewSeasonId != null && pinsinoViewSeasonId !== liveSeasonId
  const viewSeasonNumber = readOnly
    ? allSeasons.find(s => s.id === pinsinoViewSeasonId)?.number ?? null
    : null

  return {
    seasons: allSeasons,
    liveSeasonId,
    viewSeasonId: pinsinoViewSeasonId ?? liveSeasonId,
    viewSeasonNumber,
    readOnly,
    loading,
  }
}
