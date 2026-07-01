import { useState, useCallback, useEffect, useRef } from 'react'
import { seasons, activityFeed, weeks } from '../utils/supabase/db'
import { importanceForEvent, type FeedEventView } from '../utils/activityFeedTemplates'

export type FeedFilter = 'all' | 'sportsbook' | 'loan_shark' | 'pvp' | 'bounty_board' | 'auction_house' | 'highlights'

// Week label/lookup metadata for the screen's collapsible week grouping.
export type WeekInfoById = Record<string, { weekNumber: number }>

const PAGE_SIZE = 50

// Flatten a joined activity_feed_events row into the FeedEventView the screen +
// template renderer consume. Names come from the live joined players rows (never
// snapshotted); no copy is rendered here (that's renderFeedEvent's job, §2).
export function normalizeFeedRow(r: any): FeedEventView {
  return {
    id: r.id,
    seasonId: r.season_id,
    weekId: r.week_id ?? null,
    sourceFeature: r.source_feature,
    eventType: r.event_type,
    templateKey: r.template_key,
    // Importance is app-owned (derived from event_type), not a stored column.
    importance: importanceForEvent(r.event_type),
    status: r.status,
    visibility: r.visibility,
    publicPayload: (r.public_payload ?? {}) as Record<string, any>,
    adminPayload: (r.admin_payload ?? {}) as Record<string, any>,
    publishedAt: r.published_at,
    occurredAt: r.occurred_at,
    actorPlayerId: r.actor_player_id ?? null,
    actorName: r.actor?.first_name ?? null,
    actorAvatarPath: r.actor?.avatar_path ?? null,
    subjectPlayerId: r.subject_player_id ?? null,
    subjectName: r.subject?.first_name ?? null,
    secondaryPlayerId: r.secondary_player_id ?? null,
    secondaryName: r.secondary?.first_name ?? null,
    sportsbookBetId: r.sportsbook_bet_id ?? null,
    loanId: r.loan_id ?? null,
    pvpChallengeId: r.pvp_challenge_id ?? null,
    bountySourceId: r.bounty_post_id ?? null,
    auctionSourceId: r.auction_id ?? null,
    suppressionReason: r.suppression_reason ?? null,
  }
}

// Fetch one filter-matched page (page 1 when no cursor) from db.ts.
function fetchPage(
  filter: FeedFilter,
  seasonId: string,
  cursor?: { publishedAt: string; id: string },
) {
  switch (filter) {
    case 'sportsbook':
      return activityFeed.listByFeature(seasonId, 'sportsbook', cursor)
    case 'loan_shark':
      return activityFeed.listByFeature(seasonId, 'loan_shark', cursor)
    case 'pvp':
      return activityFeed.listByFeature(seasonId, 'pvp', cursor)
    case 'bounty_board':
      return activityFeed.listByFeature(seasonId, 'bounty_board', cursor)
    case 'auction_house':
      return activityFeed.listByFeature(seasonId, 'auction_house', cursor)
    case 'highlights':
      return activityFeed.listHighlights(seasonId, cursor)
    default:
      return activityFeed.listPublic(seasonId, cursor)
  }
}

// The public "Market Moves" feed: paginated, filterable, read-derived. No
// memoization in the hook (project rule) — the screen renders display copy via
// renderFeedEvent + useMemo.
export function useMarketMovesData(viewSeasonId?: string | null) {
  const [loading, setLoading] = useState(true)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [events, setEvents] = useState<FeedEventView[]>([])
  const [filter, setFilterState] = useState<FeedFilter>('all')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Week metadata for the screen's collapsible week grouping. Loaded once per
  // season alongside the season lookup (it doesn't change across filter switches
  // or pagination).
  const [weekInfoById, setWeekInfoById] = useState<WeekInfoById>({})
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)

  // Only the first load shows the full-screen LoadingView; later reloads (focus,
  // pull-to-refresh, filter switch) refresh in place so the list never flashes.
  const loadedOnce = useRef(false)

  // Load page 1 for a given filter. Resolves the current season on first call.
  const loadFirst = useCallback(async (f: FeedFilter) => {
    if (!loadedOnce.current) setLoading(true)
    try {
      // Past-season mode points at the requested prior season; otherwise (and
      // between seasons) fall back to the most-recently-ended season so the
      // newswire keeps showing its final-week activity rather than going blank.
      const sid = viewSeasonId
        ? (await seasons.getById(viewSeasonId)).data?.id ?? null
        : (await seasons.getCurrentOrLastEnded()).data?.id ?? null
      setSeasonId(sid)
      if (!sid) { setEvents([]); setHasMore(false); return }

      // Resolve the season's weeks once: label map + the default-open week for
      // grouping. While a season runs that's the current active week (highest
      // non-archived week_number); once it has concluded (no live weeks) we fall
      // back to the last week overall so the feed opens on the final week.
      const weeksRes = await weeks.listBySeason(sid)
      const weekRows = weeksRes.data ?? []
      const infoMap: WeekInfoById = {}
      for (const w of weekRows) infoMap[w.id] = { weekNumber: w.week_number }
      setWeekInfoById(infoMap)
      const live = weekRows.filter(w => !w.is_archived)
      const pickFrom = live.length ? live : weekRows
      const current = pickFrom.length
        ? pickFrom.reduce((a, b) => (b.week_number > a.week_number ? b : a))
        : null
      setCurrentWeekId(current?.id ?? null)

      const { data } = await fetchPage(f, sid)
      const rows = (data ?? []).map(normalizeFeedRow)
      setEvents(rows)
      setHasMore(rows.length === PAGE_SIZE)
    } catch (e) {
      console.error('useMarketMovesData error:', e)
      setEvents([]); setHasMore(false)
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [viewSeasonId])

  useEffect(() => { loadFirst('all') }, [loadFirst])

  const reload = useCallback(() => loadFirst(filter), [loadFirst, filter])

  const setFilter = useCallback((f: FeedFilter) => {
    if (f === filter) return
    setFilterState(f)
    loadFirst(f)
  }, [filter, loadFirst])

  // Cursor pagination — append the next page after the last loaded row.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !seasonId || events.length === 0) return
    setLoadingMore(true)
    try {
      const last = events[events.length - 1]
      const { data } = await fetchPage(filter, seasonId, {
        publishedAt: last.publishedAt,
        id: last.id,
      })
      const rows = (data ?? []).map(normalizeFeedRow)
      setEvents(prev => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
    } catch (e) {
      console.error('useMarketMovesData loadMore error:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, seasonId, events, filter])

  return { loading, events, filter, setFilter, hasMore, loadMore, reload, weekInfoById, currentWeekId }
}
