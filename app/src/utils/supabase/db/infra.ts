import { supabase } from '../client'
import type { TablesInsert, Json } from '../database.types'
import { HIGHLIGHT_EVENT_TYPES } from '../../activityFeedTemplates'

export const boardPosts = {
  list: () =>
    supabase
      .from('board_posts')
      .select('*, players(name)')
      .order('created_at', { ascending: false }),
  insert: (data: TablesInsert<'board_posts'>) =>
    supabase.from('board_posts').insert(data),
  remove: (id: string) =>
    supabase.from('board_posts').delete().eq('id', id),
}

// ── Activity Feed ("Market Moves") — activity_feed_events ────────────────────
// The public economic newswire. One narrative row per feed-worthy economic
// action; the feed never moves pins (read-derived only). Copy is rendered in the
// app from template_key + public_payload (see utils/activityFeedTemplates.ts) —
// names are pulled live from the joined players rows, NOT snapshotted. Three FKs
// point at players, so the actor/subject/secondary embeds REQUIRE explicit
// !constraint hints to disambiguate.
// Feed copy uses first names only (e.g. "Garrett placed a ticket"), so the embeds
// pull first_name (+ avatar_path for the actor's avatar) rather than full name.
const FEED_GRAPH =
  '*, actor:players!activity_feed_events_actor_player_id_fkey(first_name, avatar_path), ' +
  'subject:players!activity_feed_events_subject_player_id_fkey(first_name), ' +
  'secondary:players!activity_feed_events_secondary_player_id_fkey(first_name)'

// Keyset cursor = the last row's { publishedAt, id }. published_at DESC, id DESC
// is the stable ordering key; the .or(...) keeps the boundary row from repeating.
type FeedCursor = { publishedAt: string; id: string }
const feedCursorFilter = (c: FeedCursor) =>
  `published_at.lt.${c.publishedAt},and(published_at.eq.${c.publishedAt},id.lt.${c.id})`

export const activityFeed = {
  // Public feed (design §15.1) — published + public rows, newest first.
  listPublic: (seasonId: string, cursor?: FeedCursor, limit = 50) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
    if (cursor) q = q.or(feedCursorFilter(cursor))
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  },

  // Feature filter (design §15.2): sourceFeature in ('sportsbook','loan_shark').
  listByFeature: (seasonId: string, sourceFeature: string, cursor?: FeedCursor) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
      .eq('source_feature', sourceFeature)
    if (cursor) q = q.or(feedCursorFilter(cursor))
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Highlights filter (design §15.2). Importance is app-owned (not a DB column),
  // so we filter by the event types the Market Moves feature deems highlight/major
  // (HIGHLIGHT_EVENT_TYPES, derived from importanceForEvent).
  listHighlights: (seasonId: string, cursor?: FeedCursor) => {
    let q = supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId).eq('status', 'published').eq('visibility', 'public')
      .in('event_type', HIGHLIGHT_EVENT_TYPES)
    if (cursor) q = q.or(feedCursorFilter(cursor))
    return q.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(50)
  },

  // Admin: every row (any status/visibility) for the season, filtered client-side.
  listAllForAdmin: (seasonId: string) =>
    supabase.from('activity_feed_events').select(FEED_GRAPH)
      .eq('season_id', seasonId)
      .order('published_at', { ascending: false }).order('id', { ascending: false }).limit(200),

  suppress: (eventId: string, reason: string) =>
    supabase.rpc('suppress_activity_event', { p_event_id: eventId, p_reason: reason }),
  restore: (eventId: string) =>
    supabase.rpc('restore_activity_event', { p_event_id: eventId }),
  createSystemEvent: (args: {
    sourceFeature: 'system' | 'admin'; eventType: string; templateKey: string
    publicPayload: Json
  }) =>
    supabase.rpc('create_system_activity_event', {
      p_source_feature: args.sourceFeature,
      p_event_type: args.eventType,
      p_template_key: args.templateKey,
      p_public_payload: args.publicPayload,
    }),
}

// ── Lanetalk imports ────────────────────────────────────────────────────────
// One row per parsed game from a Lanetalk "shared session" link. Writes happen
// server-side in the `lanetalk-import` Edge Function (fetch → parse → fuzzy-match
// the bowler to a slotted player → classify Official/Recreational by score);
// the app only invokes it and reads the results (admin-gated via RLS).

/** Per-game line in the Edge Function's response summary. */
export interface LanetalkImportGameSummary {
  gameNumber: number
  score: number | null
  classification: 'official' | 'recreational'
}

/** Shape returned by the `lanetalk-import` Edge Function. */
export interface LanetalkImportSummary {
  ok: boolean
  weekResolved?: boolean
  weekId?: string
  matchedPlayer?: string | null
  games?: LanetalkImportGameSummary[]
  officialCount?: number
  recreationalCount?: number
  message?: string
  /** Reprocess mode: true when this summary came from re-deriving a stored week. */
  reprocessed?: boolean
  /** Reprocess mode: matched players / rows recomputed. */
  players?: number
  rowCount?: number
  /** Failure stage tag from the Edge Function (e.g. 'fetch_status', 'auth_not_admin'). */
  stage?: string
  /** Per-request id — present on every response; grep the function logs by it. */
  reqId?: string
  /** Stage-specific diagnostics (status, bodySnippet, parsed player/date, etc.). */
  debug?: Record<string, unknown>
}

// Invoke the lanetalk-import Edge Function and normalize its response. The
// function returns recoverable failures as 200 { ok:false, … } but auth (403)
// and server (500) failures as non-2xx — for those, supabase-js puts a generic
// FunctionsHttpError in `error` and the real JSON body (with stage / message /
// debug) on error.context. Normalize both so the caller always sees the
// function's actual message and diagnostics.
async function invokeLanetalk(body: Record<string, unknown>): Promise<LanetalkImportSummary> {
  const { data, error } = await supabase.functions.invoke<LanetalkImportSummary>('lanetalk-import', { body })
  if (error) {
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      try {
        const parsed = await ctx.json()
        if (parsed && typeof parsed === 'object') return parsed as LanetalkImportSummary
      } catch { /* body wasn't JSON — fall through to the generic message */ }
    }
    return { ok: false, stage: 'invoke', message: error.message ?? 'Request failed' }
  }
  return data ?? { ok: false, stage: 'invoke', message: 'Empty response' }
}

export const lanetalkImports = {
  // Fetch, parse, match and write a single link's games. An optional weekId
  // pins the import to an explicit week (skips date-based resolution) — the
  // safety valve for an unparseable date or a lane-split night.
  run: (url: string, weekId?: string): Promise<LanetalkImportSummary> =>
    invokeLanetalk(weekId ? { url, weekId } : { url }),
  // Re-derive an already-imported week from its stored payloads (no link fetch):
  // re-matches games to official scores and renumbers across links. The fix for
  // a lane-split night the admin can't clear and re-import cleanly.
  reprocessWeek: (weekId: string): Promise<LanetalkImportSummary> => invokeLanetalk({ reprocessWeekId: weekId }),
  listRecent: () =>
    supabase
      .from('lanetalk_game_imports')
      .select('*, players(name), weeks(week_number, bowled_at, season_id, seasons(number))')
      .order('created_at', { ascending: false })
      .limit(200),
  listBySourceUrl: (url: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('*, players(name)')
      .eq('source_url', url)
      .order('game_number'),
  // Every imported game for one player, oldest first — frame-level game details.
  listByPlayer: (playerId: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('game_number, score, played_at, source_url, classification, payload')
      .eq('player_id', playerId)
      .order('played_at', { ascending: true, nullsFirst: true })
      .order('game_number', { ascending: true }),
  // Whether a player has any imported games — drives the PlayerDetail entry point.
  countByPlayer: (playerId: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId),
  // One week's official imports — the Confirm modal's data-coverage preview
  // (informational; the settlement RPC recomputes authoritatively server-side).
  listOfficialByWeek: (weekId: string) =>
    supabase
      .from('lanetalk_game_imports')
      .select('player_id, game_number, payload')
      .eq('week_id', weekId)
      .eq('classification', 'official'),
  // Every official import on an archived week, with its frame payload — the
  // frame-data League Records (strikes / spares / frames closed, game + night).
  listForLeagueRecords: () =>
    supabase
      .from('lanetalk_game_imports')
      .select(
        'player_id, week_id, game_number, score, payload,' +
        'players(name),' +
        'weeks!inner(week_number, season_id, is_archived, seasons!inner(number))'
      )
      .eq('classification', 'official')
      .eq('weeks.is_archived', true)
      .not('player_id', 'is', null),
  // Admin re-classification of a single imported game (Official ⇄ Recreational).
  setClassification: (id: string, classification: 'official' | 'recreational') =>
    supabase
      .from('lanetalk_game_imports')
      .update({ classification })
      .eq('id', id),
}

// ── Push Broadcasts ──────────────────────────────────────────────────────────
// "Broadcast" = an admin-composed push notification (see context/push-broadcasts.md).
// Tokens are secrets: they only ever move through the two SECURITY DEFINER RPCs;
// there is no client read path at all.

export const push = {
  registerToken: (token: string, platform: 'ios' | 'android') =>
    supabase.rpc('register_push_token', { p_token: token, p_platform: platform }),
  unregisterToken: (token: string) =>
    supabase.rpc('unregister_push_token', { p_token: token }),
  listCategories: () =>
    supabase
      .from('broadcast_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order'),
  // Both pref reads return only the caller's rows via RLS. An ABSENT row means
  // enabled — the hooks default missing entries to ON.
  getPrefs: (playerId: string) =>
    supabase.from('push_preferences').select('*').eq('player_id', playerId).maybeSingle(),
  listCategoryPrefs: (playerId: string) =>
    supabase.from('push_category_prefs').select('*').eq('player_id', playerId),
  setMaster: (playerId: string, enabled: boolean) =>
    supabase
      .from('push_preferences')
      .upsert({ player_id: playerId, master_enabled: enabled }, { onConflict: 'player_id' }),
  setCategoryPref: (playerId: string, categoryId: string, enabled: boolean) =>
    supabase
      .from('push_category_prefs')
      .upsert(
        { player_id: playerId, category_id: categoryId, enabled },
        { onConflict: 'player_id,category_id' },
      ),
}

/** Shape returned by the send-broadcasts Edge Function. */
export interface BroadcastSendSummary {
  ok: boolean
  broadcastId?: string
  skipped?: boolean
  recipients?: number
  delivered?: number
  failed?: number
  failedWith?: string
  message?: string
  stage?: string
  reqId?: string
}

export const broadcasts = {
  listRecent: () =>
    supabase
      .from('broadcasts')
      .select('*, broadcast_categories(key, label), players!broadcasts_created_by_fkey(name)')
      .order('created_at', { ascending: false })
      .limit(50),
  create: (data: TablesInsert<'broadcasts'>) =>
    supabase.from('broadcasts').insert(data).select('id').single(),
  cancel: (id: string) => supabase.rpc('broadcast_cancel', { p_id: id }),
  // Counts only — tokens never leave the DB (admin-gated in SQL).
  reach: (categoryId: string, targetPlayerIds: string[] | null) =>
    supabase.rpc('broadcast_reach', {
      p_category_id: categoryId,
      p_target_player_ids: targetPlayerIds ?? undefined,
    }),
  // Send-now: fire the Edge Function directly so the admin isn't waiting on
  // the next cron tick. If the invoke fails the sweep still picks the row up.
  sendNow: async (broadcastId: string): Promise<BroadcastSendSummary> => {
    const { data, error } = await supabase.functions.invoke<BroadcastSendSummary>(
      'send-broadcasts',
      { body: { broadcastId } },
    )
    if (error) {
      const ctx = (error as { context?: unknown }).context
      if (ctx instanceof Response) {
        try {
          const parsed = await ctx.json()
          if (parsed && typeof parsed === 'object') return parsed as BroadcastSendSummary
        } catch { /* body wasn't JSON — fall through */ }
      }
      return { ok: false, stage: 'invoke', message: error.message ?? 'Request failed' }
    }
    return data ?? { ok: false, stage: 'invoke', message: 'Empty response' }
  },
}

// Automated Market Moves pushes — one optional rule per activity_event_catalog
// event type (context/push-broadcasts.md). The catalog LEFT JOIN is the
// future-proofing contract: new event types appear here rule-less (= off)
// with zero code changes.
export const broadcastEventRules = {
  // To-one embed: broadcast_event_rules.event_type is both its PK and the FK,
  // so PostgREST returns an object-or-null per catalog row.
  listCatalog: () =>
    supabase
      .from('activity_event_catalog')
      .select(
        'event_type, source_feature, broadcast_event_rules(enabled, category_id, title_template, body_template, route_key)',
      )
      .order('source_feature')
      .order('event_type'),
  upsert: (rule: TablesInsert<'broadcast_event_rules'>) =>
    supabase.from('broadcast_event_rules').upsert(rule, { onConflict: 'event_type' }),
  setEnabled: (eventType: string, enabled: boolean) =>
    supabase.from('broadcast_event_rules').update({ enabled }).eq('event_type', eventType),
}
