import { useState, useCallback, useEffect } from 'react'
import { push, broadcasts, players } from '../utils/supabase/db'
import type { BroadcastCategoryRow } from './useNotificationSettingsData'

export interface BroadcastRow {
  id: string
  category_id: string
  title: string
  body: string
  target_player_ids: string[] | null
  data: { route?: string } | null
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

// Broadcast Admin data: the category catalog, the active-player roster (for
// targeting), and the sent/scheduled history.
export function useBroadcastAdminData() {
  const [loading, setLoading] = useState(true)
  const [rawCategories, setRawCategories] = useState<BroadcastCategoryRow[]>([])
  const [rawPlayers, setRawPlayers] = useState<{ id: string; name: string }[]>([])
  const [rawBroadcasts, setRawBroadcasts] = useState<BroadcastRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catsRes, playersRes, historyRes] = await Promise.all([
        push.listCategories(),
        players.listActive(),
        broadcasts.listRecent(),
      ])
      setRawCategories((catsRes.data ?? []) as BroadcastCategoryRow[])
      setRawPlayers((playersRes.data ?? []).map(p => ({ id: p.id, name: p.name ?? '' })))
      setRawBroadcasts((historyRes.data ?? []) as unknown as BroadcastRow[])
    } catch (e) {
      console.error('useBroadcastAdminData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, rawCategories, rawPlayers, rawBroadcasts, reload: load }
}
