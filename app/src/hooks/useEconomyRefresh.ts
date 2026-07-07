import { useCallback } from 'react'
import { useNotificationStore } from '../stores/notificationStore'

// Reload a screen's data AND the Pinsino notification badges together. The
// pending-action counts (tile + tab-bar badges) are derived from the same
// lists the economy screens show, so any mutation or refresh that changes
// those lists must re-fetch the badge counts too — otherwise the badge stays
// stale until PinsinoScreen re-focuses. See context/notifications.md.
export function useEconomyRefresh(reload: () => Promise<unknown>): () => Promise<void> {
  return useCallback(
    () => Promise.all([reload(), useNotificationStore.getState().refresh()]).then(() => {}),
    [reload],
  )
}
