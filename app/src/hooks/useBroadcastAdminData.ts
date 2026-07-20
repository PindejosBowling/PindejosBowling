import { useState, useCallback, useEffect } from 'react'
import {
  push,
  broadcasts,
  broadcastEventRules,
  recurringBroadcastSchedules,
  players,
} from '../utils/supabase/db'
import type { BroadcastCategoryRow } from './useNotificationSettingsData'
import type { Tables } from '../utils/supabase/database.types'

export interface BroadcastRow {
  id: string
  category_id: string
  title: string
  body: string
  target_player_ids: string[] | null
  data: { route?: string } | null
  source: 'admin' | 'event' | 'recurring'
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'canceled'
  scheduled_for: string
  sent_at: string | null
  recipient_count: number | null
  delivered_count: number | null
  failed_count: number | null
  error: string | null
  created_at: string
  broadcast_categories: { key: string; label: string } | null
  players: { name: string } | null
}

// One row per activity_event_catalog entry; the embed is null until the admin
// configures a rule (rule-less = automated push off).
export interface EventRuleCatalogRow {
  event_type: string
  source_feature: string
  broadcast_event_rules: {
    enabled: boolean
    category_id: string
    title_template: string
    body_template: string
    route_key: string | null
  } | null
}

export type RecurringScheduleRow = Tables<'recurring_broadcast_schedules'>

// 'sportsbook_big_win' (source 'sportsbook') → 'Big Win'. Pure string
// prettifying — event types are machine keys, so the label is derived, never
// stored, and new catalog rows get a readable label for free.
export function prettifyEventType(eventType: string, sourceFeature: string): string {
  const stripped = eventType.startsWith(`${sourceFeature}_`)
    ? eventType.slice(sourceFeature.length + 1)
    : eventType
  return stripped
    .split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// Broadcast Admin data: the category catalog, the active-player roster (for
// targeting), and the sent/scheduled history.
export function useBroadcastAdminData() {
  const [loading, setLoading] = useState(true)
  const [rawCategories, setRawCategories] = useState<BroadcastCategoryRow[]>([])
  const [rawPlayers, setRawPlayers] = useState<{ id: string; name: string }[]>([])
  const [rawBroadcasts, setRawBroadcasts] = useState<BroadcastRow[]>([])
  const [rawEventRules, setRawEventRules] = useState<EventRuleCatalogRow[]>([])
  const [rawRecurringSchedules, setRawRecurringSchedules] = useState<RecurringScheduleRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catsRes, playersRes, historyRes, rulesRes, schedulesRes] = await Promise.all([
        push.listCategories(),
        players.listActive(),
        broadcasts.listRecent(),
        broadcastEventRules.listCatalog(),
        recurringBroadcastSchedules.list(),
      ])
      setRawCategories((catsRes.data ?? []) as BroadcastCategoryRow[])
      setRawPlayers((playersRes.data ?? []).map(p => ({ id: p.id, name: p.name ?? '' })))
      setRawBroadcasts((historyRes.data ?? []) as unknown as BroadcastRow[])
      setRawEventRules((rulesRes.data ?? []) as unknown as EventRuleCatalogRow[])
      setRawRecurringSchedules(schedulesRes.data ?? [])
    } catch (e) {
      console.error('useBroadcastAdminData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return {
    loading,
    rawCategories,
    rawPlayers,
    rawBroadcasts,
    rawEventRules,
    rawRecurringSchedules,
    reload: load,
  }
}
