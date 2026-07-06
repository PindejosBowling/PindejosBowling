import { useState, useCallback } from 'react'
import { seasons, activityFeed, weeks } from '../utils/supabase/db'
import { importanceForEvent, type FeedEventView } from '../utils/activityFeedTemplates'
import { useAsyncData } from './useAsyncData'

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

interface MarketMovesPayload {
  seasonId: string | null
  events: FeedEventView[]
  hasMore: boolean
  // Week metadata for the screen's collapsible week grouping (label map + the
  // default-open week). Refetched with each page-1 load; it doesn't change
  // across pagination.
  weekInfoById: WeekInfoById
  currentWeekId: string | null
}

const EMPTY: MarketMovesPayload = {
  seasonId: null, events: [], hasMore: false, weekInfoById: {}, currentWeekId: null,
}

// The public "Market Moves" feed: paginated, filterable, read-derived. No
// memoization in the hook (project rule) — the screen renders display copy via
// renderFeedEvent + useMemo. The filter is a dependency of the page-1 load
// (switching it refetches silently); loadMore appends pages via mutate.
export function useMarketMovesData(viewSeasonId?: string | null) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [loadingMore, setLoadingMore] = useState(false)

  const { loading, data, reload, mutate } = useAsyncData<MarketMovesPayload>(async () => {
    // Past-season mode points at the requested prior season; otherwise (and
    // between seasons) fall back to the most-recently-ended season so the
    // newswire keeps showing its final-week activity rather than going blank.
    const sid = viewSeasonId
      ? (await seasons.getById(viewSeasonId)).data?.id ?? null
      : (await seasons.getCurrentOrLastEnded()).data?.id ?? null
    if (!sid) return EMPTY

    // Resolve the season's weeks: label map + the default-open week for
    // grouping. While a season runs that's the current active week (highest
    // non-archived week_number); once it has concluded (no live weeks) we fall
    // back to the last week overall so the feed opens on the final week.
    const weeksRes = await weeks.listBySeason(sid)
    const weekRows = weeksRes.data ?? []
    const weekInfoById: WeekInfoById = {}
    for (const w of weekRows) weekInfoById[w.id] = { weekNumber: w.week_number }
    const live = weekRows.filter(w => !w.is_archived)
    const pickFrom = live.length ? live : weekRows
    const current = pickFrom.length
      ? pickFrom.reduce((a, b) => (b.week_number > a.week_number ? b : a))
      : null

    const { data: pageData } = await fetchPage(filter, sid)
    const rows = (pageData ?? []).map(normalizeFeedRow)
    return {
      seasonId: sid,
      events: rows,
      hasMore: rows.length === PAGE_SIZE,
      weekInfoById,
      currentWeekId: current?.id ?? null,
    }
  }, [viewSeasonId, filter], 'useMarketMovesData')

  const { seasonId, events, hasMore, weekInfoById, currentWeekId } = data ?? EMPTY

  // Cursor pagination — append the next page after the last loaded row.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !seasonId || events.length === 0) return
    setLoadingMore(true)
    try {
      const last = events[events.length - 1]
      const { data: pageData } = await fetchPage(filter, seasonId, {
        publishedAt: last.publishedAt,
        id: last.id,
      })
      const rows = (pageData ?? []).map(normalizeFeedRow)
      mutate(prev => prev && {
        ...prev,
        events: [...prev.events, ...rows],
        hasMore: rows.length === PAGE_SIZE,
      })
    } catch (e) {
      console.error('useMarketMovesData loadMore error:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, seasonId, events, filter, mutate])

  return { loading, events, filter, setFilter, hasMore, loadMore, reload, weekInfoById, currentWeekId }
}
