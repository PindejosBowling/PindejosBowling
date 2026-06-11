import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import BetRow from './BetRow'
import { resultBadge, betReturnText } from '../../utils/bets'
import type { BetView } from '../../hooks/usePinsinoData'

interface SettledBetsViewProps {
  // All settled (won/lost/push) bets this season.
  bets: BetView[]
  // Whose side the returns are shown from. 'house' (Pinsino Admin) negates each
  // signed return so a player loss reads positive for the house, aligning with
  // the Pincome statement. Defaults to 'player' (the public Pinsino tab).
  perspective?: 'player' | 'house'
  // Row tap — opens the shared bet details overlay.
  onBetPress?: (bet: BetView) => void
  // When provided, each row gets an inline cancel (✕) affordance (admin only).
  onCancelBet?: (bet: BetView) => void
}

// Shared "Settled Bets" surface: this season's settled bets grouped by week
// (newest first). Read-only on the Pinsino tab; cancellable on Pinsino Admin.
export default function SettledBetsView({ bets, perspective = 'player', onBetPress, onCancelBet }: SettledBetsViewProps) {
  const byWeek = useMemo(() => {
    const map: Record<number, BetView[]> = {}
    for (const bet of bets) {
      if (bet.weekNumber == null) continue
      if (!map[bet.weekNumber]) map[bet.weekNumber] = []
      map[bet.weekNumber].push(bet)
    }
    return map
  }, [bets])

  const weekNumbers = useMemo(
    () => Object.keys(byWeek).map(Number).sort((a, b) => b - a),
    [byWeek],
  )

  if (weekNumbers.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>No settled bets yet</Text>
      </View>
    )
  }

  return (
    <>
      {weekNumbers.map(wk => (
        <View key={wk}>
          <Text style={styles.gameLabel}>WEEK {wk}</Text>
          <View style={styles.card}>
            {byWeek[wk].map((bet, idx) => (
              <BetRow
                key={bet.id}
                bet={bet}
                isLast={idx === byWeek[wk].length - 1}
                badge={resultBadge(bet.status)}
                betReturnText={betReturnText(bet, perspective)}
                onPress={onBetPress ? () => onBetPress(bet) : undefined}
                onCancelPress={onCancelBet ? () => onCancelBet(bet) : undefined}
              />
            ))}
          </View>
        </View>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
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
