import { seasons, activityFeed } from '../utils/supabase/db'
import type { FeedEventView } from '../utils/activityFeedTemplates'
import { useAsyncData } from './useAsyncData'
import { normalizeFeedRow } from './useMarketMovesData'

// Lightweight "latest Market Moves" fetch for the Pinsino hub's mini-feed.
// Deliberately separate from usePinsinoData (the feed reloads on its own
// cadence) and from useMarketMovesData (no filters/pagination/week grouping —
// just the newest handful of public events for the viewed season).
export function useMarketMovesPreview(viewSeasonId?: string | null, limit = 6) {
  const { loading, data, reload } = useAsyncData<FeedEventView[]>(async () => {
    // Past-season mode shows that season's closing events; live mode (and the
    // between-seasons gap) mirrors the full Market Moves screen's resolution.
    const sid = viewSeasonId
      ? (await seasons.getById(viewSeasonId)).data?.id ?? null
      : (await seasons.getCurrentOrLastEnded()).data?.id ?? null
    if (!sid) return []
    const { data: rows } = await activityFeed.listPublic(sid, undefined, limit)
    return (rows ?? []).map(normalizeFeedRow)
  }, [viewSeasonId], 'useMarketMovesPreview')

  return { loading, events: data ?? [], reload }
}
