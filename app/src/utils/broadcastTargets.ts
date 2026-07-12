// Broadcast landing pages — the catalog of screens a push notification can
// deep-link into (context/push-broadcasts.md). The admin composer stores a
// target's `key` in `broadcasts.data.route`; the Edge Function spreads that
// payload into every push, and the tap handler (pushTokens.ts) looks the key
// back up here to navigate. Keys are a wire format: they live in sent pushes
// and DB rows, so NEVER rename one — add a new entry and retire the old label.
//
// Unknown/absent keys are a silent no-op (the app just opens), so old app
// builds tolerate new targets and vice versa.

export interface BroadcastTarget {
  key: string
  /** Composer-facing name. */
  label: string
  /** Root tab to navigate to. */
  tab: 'Standings' | 'RSVP' | 'Matchups' | 'Pinsino' | 'More'
  /** Screen inside that tab's stack (omit for plain-screen tabs / stack home). */
  screen?: string
}

export const BROADCAST_TARGETS: BroadcastTarget[] = [
  { key: 'rsvp', label: 'RSVP', tab: 'RSVP' },
  { key: 'matchups', label: 'Matchups', tab: 'Matchups' },
  { key: 'standings', label: 'Standings', tab: 'Standings', screen: 'StandingsList' },
  { key: 'pinsino', label: 'Pinsino', tab: 'Pinsino', screen: 'PinsinoHome' },
  { key: 'sportsbook', label: 'Place Bets', tab: 'Pinsino', screen: 'Sportsbook' },
  { key: 'auction_house', label: 'Auction House', tab: 'Pinsino', screen: 'AuctionHouse' },
  { key: 'bounty_board', label: 'Bounties', tab: 'Pinsino', screen: 'BountyBoard' },
  { key: 'pvp', label: 'PvP', tab: 'Pinsino', screen: 'PvP' },
  { key: 'loan_shark', label: 'Loan Shark', tab: 'Pinsino', screen: 'LoanShark' },
  { key: 'market_moves', label: 'Market Moves', tab: 'Pinsino', screen: 'MarketMoves' },
  { key: 'leaderboard', label: 'Pinsino Leaderboard', tab: 'Pinsino', screen: 'PinsinoLeaderboard' },
  { key: 'notification_settings', label: 'Notification Settings', tab: 'More', screen: 'NotificationSettings' },
]

export function getBroadcastTarget(key: unknown): BroadcastTarget | undefined {
  if (typeof key !== 'string') return undefined
  return BROADCAST_TARGETS.find(t => t.key === key)
}
