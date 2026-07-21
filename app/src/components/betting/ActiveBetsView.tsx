import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BetRow from './BetRow'
import { resultBadge, betReturnText } from '../../utils/bets'
import { marketGroup, type BetView, type LineGroup } from '../../hooks/usePinsinoData'
import EmptyCard from '../ui/EmptyCard'
import { formatPins } from '../../utils/formatting'

interface ActiveBetsViewProps {
  // This week's still-pending bets (settled ones belong in SettledBetsView).
  bets: BetView[]
  // The viewer's own pending bets — rendered as a MY BETS section above the
  // community board. Omitted on the admin/house view (no personal section).
  myBets?: BetView[]
  // Whose side the returns are shown from. 'house' (Pinsino Admin) negates each
  // signed return, so a pending bet reads as the house's exposure rather than the
  // bettor's potential winnings. Defaults to 'player' (the public Pinsino tab).
  perspective?: 'player' | 'house'
  // Optional helper line under the summary card (e.g. an admin hint).
  hint?: string
  // Single-bet tap (read-only → details; admin → settle the line).
  onBetPress?: (bet: BetView) => void
  // Parlay tap — parlays span markets, so they only ever open details.
  onParlayPress?: (bet: BetView) => void
  // When provided, each row gets an inline cancel (✕) affordance (admin only).
  onCancelBet?: (bet: BetView) => void
  // Bets the viewer is secretly haunting (Ghost in the Slip) — outlined in gold.
  hauntedBetIds?: Set<string>
}

// Shared "Active Bets" surface: a wager summary plus this week's pending bets
// grouped by market section — GAME N / WEEKLY (night-scoped props) / SEASON via
// the same `marketGroup` the Place Bets board uses, so no single bet falls
// through (parlays bucketed on their own). Rendered identically on the public
// Pinsino tab (read-only) and the Pinsino Admin screen (with actions).
export default function ActiveBetsView({
  bets,
  myBets,
  perspective = 'player',
  hint,
  onBetPress,
  onParlayPress,
  onCancelBet,
  hauntedBetIds,
}: ActiveBetsViewProps) {
  const parlays = useMemo(() => bets.filter(b => b.legCount > 1), [bets])

  // Single bets bucketed by their market section (GAME N / WEEKLY / SEASON),
  // sorted in board order. Using `marketGroup` means game-less singles — e.g.
  // night-scoped LaneTalk props — get a home instead of being dropped.
  const singleGroups = useMemo(() => {
    const map = new Map<string, { group: LineGroup; bets: BetView[] }>()
    for (const bet of bets) {
      if (bet.legCount > 1) continue
      const group = marketGroup(bet.gameNumber, bet.marketType)
      const entry = map.get(group.key)
      if (entry) entry.bets.push(bet)
      else map.set(group.key, { group, bets: [bet] })
    }
    return Array.from(map.values()).sort((a, b) => a.group.sortOrder - b.group.sortOrder)
  }, [bets])

  const totalWagered = useMemo(() => bets.reduce((s, b) => s + (b.stake ?? 0), 0), [bets])
  const uniqueBettors = useMemo(() => new Set(bets.map(b => b.playerId)).size, [bets])

  if (singleGroups.length === 0 && parlays.length === 0) {
    return (
      <EmptyCard text="No bets placed yet this week" />
    )
  }

  return (
    <>
      {myBets && myBets.length > 0 && (
        <View>
          <Text style={styles.gameLabel}>MY BETS</Text>
          <View>
            {myBets.map((bet, idx) => (
              <BetRow
                key={bet.id}
                bet={bet}
                isLast={idx === myBets.length - 1}
                badge={resultBadge(bet.status)}
                betReturnText={betReturnText(bet, perspective)}
                onPress={onBetPress ? () => onBetPress(bet) : undefined}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{bets.length}</Text>
          <Text style={styles.summaryLabel}>BETS</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{formatPins(totalWagered)}</Text>
          <Text style={styles.summaryLabel}>PINS WAGERED</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{uniqueBettors}</Text>
          <Text style={styles.summaryLabel}>BETTORS</Text>
        </View>
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {singleGroups.map(({ group, bets: groupBets }) => (
        <View key={group.key}>
          <Text style={styles.gameLabel}>{group.label}</Text>
          <View>
            {groupBets.map((bet, idx) => (
              <BetRow
                key={bet.id}
                bet={bet}
                isLast={idx === groupBets.length - 1}
                badge={resultBadge(bet.status)}
                betReturnText={betReturnText(bet, perspective)}
                onPress={onBetPress ? () => onBetPress(bet) : undefined}
                onCancelPress={onCancelBet ? () => onCancelBet(bet) : undefined}
                haunted={hauntedBetIds?.has(bet.id)}
              />
            ))}
          </View>
        </View>
      ))}

      {parlays.length > 0 && (
        <View>
          <Text style={styles.gameLabel}>PARLAYS</Text>
          <View>
            {parlays.map((bet, idx) => (
              <BetRow
                key={bet.id}
                bet={bet}
                isLast={idx === parlays.length - 1}
                badge={resultBadge(bet.status)}
                betReturnText={betReturnText(bet, perspective)}
                onPress={onParlayPress ? () => onParlayPress(bet) : undefined}
                onCancelPress={onCancelBet ? () => onCancelBet(bet) : undefined}
                haunted={hauntedBetIds?.has(bet.id)}
              />
            ))}
          </View>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    marginBottom: 16,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 26,
    color: colors.accent,
    lineHeight: 28,
  },
  summaryLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
    marginTop: 2,
  },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },

  hint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: 10,
  },

  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
    marginBottom: 6,
    marginTop: 4,
  },
})
