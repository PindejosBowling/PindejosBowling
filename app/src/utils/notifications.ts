import { pvpChallenges } from './supabase/db'
import { normalizeChallenge, isReceivedForPlayer } from '../hooks/usePvpData'
import { PinsinoStackParamList } from '../navigation/types'

// A pending-action notification source for the Pinsino. Each source is
// self-contained: it knows its stable `key`, which hub tile (`route`) its badge
// belongs to, and how to fetch its own pending-action count for a player.
//
// To add a notification to a new tile: append one entry below with a `fetchCount`.
// The store fans out over every source, the hub badges by `route`, and the tab
// bar sums them all — nothing else changes. See references/notifications.md.
export interface NotificationSource {
  key: string                          // stable id, e.g. 'pvp'
  route: keyof PinsinoStackParamList   // the hub tile this badge sits on
  fetchCount: (playerId: string, seasonId: string) => Promise<number>
}

export const NOTIFICATION_SOURCES: NotificationSource[] = [
  {
    key: 'pvp',
    route: 'PvP',
    // Contracts awaiting this player's response (the "Received" inbox).
    fetchCount: async (playerId, seasonId) => {
      const { data } = await pvpChallenges.listByPlayerSeason(playerId, seasonId)
      return (data ?? [])
        .map(normalizeChallenge)
        .filter(c => isReceivedForPlayer(c, playerId)).length
    },
  },
]

// Sum of every source's pending count — drives the aggregate tab-bar badge.
export const totalCount = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((a, b) => a + b, 0)

// Pending count for a single hub tile — sums every source mapped to that route.
export const countForRoute = (counts: Record<string, number>, route: string): number =>
  NOTIFICATION_SOURCES.filter(s => s.route === route).reduce(
    (sum, s) => sum + (counts[s.key] ?? 0),
    0,
  )
