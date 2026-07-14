import { useEffect } from 'react'
import { AppState } from 'react-native'
import { supabase } from '../utils/supabase/client'
import { weeks, seasons } from '../utils/supabase/db'
import { useUiStore } from '../stores/uiStore'

// Keeps the current season/week numbers fresh for the whole app. The DB is the
// source of truth, so the signal is the DB change itself: a Realtime
// postgres_changes subscription on `weeks` (archive inserts week N+1, unarchive
// updates/deletes — any event means "refetch"). Realtime delivers nothing while
// backgrounded/disconnected, so a foreground transition also refetches as the
// catch-up path.
//
// Mount ONCE at app root (signed-in only). This is the single place that
// fetches week/season for the header — the numbers land in the ui store and
// every AppHeader just reads them, so the header's query load is O(1) instead
// of one fetch per mounted screen.
export function useWeekClock(enabled: boolean) {
  const setWeekMeta = useUiStore(s => s.setWeekMeta)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const refresh = async () => {
      const [weekRes, seasonRes] = await Promise.all([
        weeks.getLatestOfCurrentSeason(),
        seasons.getCurrent(),
      ])
      if (cancelled) return
      setWeekMeta(weekRes.data?.week_number ?? null, seasonRes.data?.number ?? null)
    }

    refresh()

    const channel = supabase
      .channel('week-clock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weeks' }, () => {
        refresh()
      })
      .subscribe()

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      sub.remove()
    }
  }, [enabled, setWeekMeta])
}
