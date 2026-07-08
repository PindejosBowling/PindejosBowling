import { useState, useCallback, useEffect } from 'react'
import { push } from '../utils/supabase/db'
import { useAuthStore } from '../stores/authStore'
import { getPushPermissionStatus } from '../utils/pushTokens'

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable'

export interface BroadcastCategoryRow {
  id: string
  key: string
  label: string
  description: string
  sort_order: number
}

// Notification Settings data: the category catalog, the caller's prefs, and
// the OS-level permission. Absent pref rows mean ON (the DB contract), so the
// raw shapes here keep that absence — the screen derives effective booleans.
export function useNotificationSettingsData() {
  const playerId = useAuthStore(s => s.playerId)
  const [loading, setLoading] = useState(true)
  const [rawCategories, setRawCategories] = useState<BroadcastCategoryRow[]>([])
  const [rawMasterEnabled, setRawMasterEnabled] = useState<boolean | null>(null)
  const [rawCategoryEnabled, setRawCategoryEnabled] = useState<Record<string, boolean>>({})
  const [permission, setPermission] = useState<PushPermission>('unavailable')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catsRes, prefsRes, catPrefsRes, perm] = await Promise.all([
        push.listCategories(),
        playerId ? push.getPrefs(playerId) : Promise.resolve({ data: null }),
        playerId ? push.listCategoryPrefs(playerId) : Promise.resolve({ data: [] }),
        getPushPermissionStatus(),
      ])
      setRawCategories((catsRes.data ?? []) as BroadcastCategoryRow[])
      setRawMasterEnabled(prefsRes.data?.master_enabled ?? null)
      const byCategory: Record<string, boolean> = {}
      for (const row of catPrefsRes.data ?? []) byCategory[row.category_id] = row.enabled
      setRawCategoryEnabled(byCategory)
      setPermission(perm)
    } catch (e) {
      console.error('useNotificationSettingsData error:', e)
    } finally {
      setLoading(false)
    }
  }, [playerId])

  useEffect(() => { load() }, [load])

  return { loading, rawCategories, rawMasterEnabled, rawCategoryEnabled, permission, reload: load }
}
