import { create } from 'zustand'
import { seasons } from '../utils/supabase/db'
import { NOTIFICATION_SOURCES } from '../utils/notifications'
import { useAuthStore } from './authStore'

interface NotificationStore {
  // Pending-action counts keyed by notification source key (e.g. { pvp: 3 }).
  counts: Record<string, number>
  // Re-fetch every source's count for the signed-in player. Call after a
  // mutation (PvP accept/decline) or on screen focus to keep badges fresh.
  refresh: () => Promise<void>
  // Reset to empty (on sign-out).
  clear: () => void
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  counts: {},

  refresh: async () => {
    const playerId = useAuthStore.getState().playerId
    if (!playerId) {
      set({ counts: {} })
      return
    }
    const seasonId = (await seasons.getCurrent()).data?.id ?? null
    if (!seasonId) {
      set({ counts: {} })
      return
    }
    try {
      const entries = await Promise.all(
        NOTIFICATION_SOURCES.map(async (s) => [s.key, await s.fetchCount(playerId, seasonId)] as const),
      )
      set({ counts: Object.fromEntries(entries) })
    } catch (e) {
      console.error('notificationStore.refresh error:', e)
    }
  },

  clear: () => set({ counts: {} }),
}))
