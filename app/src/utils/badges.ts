import type { StandingsRow } from '../hooks/useStandingsData'

// Everything a badge rule might need to decide whether a player qualifies.
// All fields are derived from data the screen already loads — no new queries.
export type BadgeContext = {
  // Player ids who won the most recently ended season (last season's champions).
  lastSeasonChampionIds: Set<string>
  // Player with the highest pin balance in the current active season (or null).
  topPinBalancePlayerId: string | null
  standings: StandingsRow[]
}

export type Badge = { key: string; emoji: string; label: string }

// The single source of truth for status -> emoji badges. Add / remove / reorder
// rules here; array order is display order (and acts as priority). A player can
// match multiple rules and show multiple emojis.
const BADGE_RULES: {
  key: string
  emoji: string
  label: string
  applies: (playerId: string, ctx: BadgeContext) => boolean
}[] = [
  {
    key: 'champion',
    emoji: '👑',
    label: 'Reigning champion',
    applies: (id, ctx) => ctx.lastSeasonChampionIds.has(id),
  }
]

export function badgesForPlayer(playerId: string, ctx: BadgeContext): Badge[] {
  return BADGE_RULES.filter(r => r.applies(playerId, ctx)).map(({ key, emoji, label }) => ({
    key,
    emoji,
    label,
  }))
}
