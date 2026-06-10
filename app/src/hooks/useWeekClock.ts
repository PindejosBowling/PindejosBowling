import { useEffect } from 'react'
import { AppState } from 'react-native'
import { supabase } from '../utils/supabase/client'
import { useUiStore } from '../stores/uiStore'

// Keeps week-derived UI fresh across all devices. The DB is the source of
// truth for the current week, so the signal is the DB change itself: a
// Realtime postgres_changes subscription on `weeks` (archive inserts week N+1,
// unarchive updates/deletes — any event means "refetch"). Realtime delivers
// nothing while backgrounded/disconnected, so a foreground transition also
// bumps as the catch-up path. Mount once at app root, signed-in only.
export function useWeekClock(enabled: boolean) {
  const bumpWeekVersion = useUiStore(s => s.bumpWeekVersion)

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('week-clock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weeks' }, () => {
        bumpWeekVersion()
      })
      .subscribe()

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') bumpWeekVersion()
    })

    return () => {
      supabase.removeChannel(channel)
      sub.remove()
    }
  }, [enabled, bumpWeekVersion])
}
