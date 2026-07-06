import { seasons } from '../utils/supabase/db'
import { useUiStore } from '../stores/uiStore'
import type { Tables } from '../utils/supabase/database.types'
import { useAsyncData } from './useAsyncData'

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

type SeasonContextPayload = Pick<PinsinoSeasonContext, 'seasons' | 'liveSeasonId'>

const EMPTY: SeasonContextPayload = { seasons: [], liveSeasonId: null }

export function usePinsinoSeasonContext(): PinsinoSeasonContext {
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)

  const { loading, data } = useAsyncData<SeasonContextPayload>(async () => {
    const [listRes, currentRes] = await Promise.all([
      seasons.list(),
      seasons.getCurrent(),
    ])
    return {
      seasons: (listRes.data ?? []).slice().sort((a, b) => b.number - a.number),
      liveSeasonId: currentRes.data?.id ?? null,
    }
  }, [], 'usePinsinoSeasonContext')

  const { seasons: allSeasons, liveSeasonId } = data ?? EMPTY

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
