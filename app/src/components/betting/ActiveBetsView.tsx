import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BetRow from './BetRow'
import { resultBadge, betReturnText } from './BetDetailModal'
import type { BetView } from '../../hooks/usePinsinoData'

interface ActiveBetsViewProps {
  // This week's still-pending bets (settled ones belong in SettledBetsView).
  bets: BetView[]
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
}

// Shared "Active Bets" surface: a wager summary plus this week's pending bets
// grouped by game (parlays bucketed on their own). Rendered identically on the
// public Pinsino tab (read-only) and the Pinsino Admin screen (with actions).
export default function ActiveBetsView({
  bets,
  perspective = 'player',
  hint,
  onBetPress,
  onParlayPress,
  onCancelBet,
}: ActiveBetsViewProps) {
  const parlays = useMemo(() => bets.filter(b => b.legCount > 1), [bets])

  const byGame = useMemo(() => {
    const map: Record<number, BetView[]> = {}
    for (const bet of bets) {
      if (bet.legCount > 1 || bet.gameNumber == null) continue
      if (!map[bet.gameNumber]) map[bet.gameNumber] = []
      map[bet.gameNumber].push(bet)
    }
    return map
  }, [bets])

  const gameNumbers = useMemo(
    () => Object.keys(byGame).map(Number).sort((a, b) => a - b),
    [byGame],
  )

  const totalWagered = useMemo(() => bets.reduce((s, b) => s + (b.stake ?? 0), 0), [bets])
  const uniqueBettors = useMemo(() => new Set(bets.map(b => b.playerId)).size, [bets])

  if (gameNumbers.length === 0 && parlays.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>No bets placed yet this week</Text>
      </View>
    )
  }

  return (
    <>
      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{bets.length}</Text>
          <Text style={styles.summaryLabel}>BETS</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalWagered.toLocaleString()}</Text>
          <Text style={styles.summaryLabel}>PINS WAGERED</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{uniqueBettors}</Text>
          <Text style={styles.summaryLabel}>BETTORS</Text>
        </View>
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {gameNumbers.map(gameNum => (
        <View key={gameNum}>
          <Text style={styles.gameLabel}>GAME {gameNum}</Text>
          <View style={styles.card}>
            {byGame[gameNum].map((bet, idx) => (
              <BetRow
                key={bet.id}
                bet={bet}
                isLast={idx === byGame[gameNum].length - 1}
                badge={resultBadge(bet.status)}
                betReturnText={betReturnText(bet, perspective)}
                onPress={onBetPress ? () => onBetPress(bet) : undefined}
                onCancelPress={onCancelBet ? () => onCancelBet(bet) : undefined}
              />
            ))}
          </View>
        </View>
      ))}

      {parlays.length > 0 && (
        <View>
          <Text style={styles.gameLabel}>PARLAYS</Text>
          <View style={styles.card}>
            {parlays.map((bet, idx) => (
              <BetRow
                key={bet.id}
                bet={bet}
                isLast={idx === parlays.length - 1}
                badge={resultBadge(bet.status)}
                betReturnText={betReturnText(bet, perspective)}
                onPress={onParlayPress ? () => onParlayPress(bet) : undefined}
                onCancelPress={onCancelBet ? () => onCancelBet(bet) : undefined}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },
})
