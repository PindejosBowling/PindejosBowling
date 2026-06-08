import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import type { BetView } from '../hooks/usePinsinoData'

interface BetRowProps {
  bet: BetView
  isLast: boolean
  badge: { label: string; color: string } | null
  betReturnText: string
  onPress?: () => void
  onCancelPress?: () => void
}

// Presentational: the row is tappable when given an `onPress`, and shows a cancel
// (✕) affordance when given an `onCancelPress`. Callers gate those callbacks
// (read-only surfaces omit them; admin surfaces pass them).
export default function BetRow({
  bet,
  isLast,
  badge,
  betReturnText,
  onPress,
  onCancelPress,
}: BetRowProps) {
  const isPressable = !!onPress
  const showCancelBtn = !!onCancelPress

  const isParlay = bet.legCount > 1

  const content = (
    <>
      <View style={{ flex: 1 }}>
        {isParlay ? (
          <>
            {bet.legs.map((leg, i) => (
              <Text key={i} style={styles.betSubject}>
                {leg.subjectName} · {leg.pick?.toUpperCase()}
                {leg.marketType === 'over_under' ? ` ${leg.line.toFixed(1)}` : ''}
                {leg.gameNumber != null ? ` (G${leg.gameNumber})` : ''}
                {leg.result ? ` — ${leg.result.toUpperCase()}` : ''}
              </Text>
            ))}
            <Text style={styles.betDetails}>
              {bet.bettorName} · PARLAY ({bet.legCount} legs)
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.betSubject}>
              {bet.subjectName} · {bet.pick?.toUpperCase()}
              {bet.marketType === 'over_under' ? ` ${bet.line.toFixed(1)}` : ''}
              {bet.gameNumber != null ? ` · G${bet.gameNumber}` : ''}
            </Text>
            <Text style={styles.betDetails}>
              {bet.bettorName}
            </Text>
          </>
        )}
      </View>
      <View style={styles.betRight}>
        {badge ? (
          <Text style={[styles.betBadge, { color: badge.color }]}>{badge.label}</Text>
        ) : (
          <Text style={styles.betPending}>PENDING</Text>
        )}
        <Text style={styles.betWager}>{betReturnText} pins</Text>
      </View>
    </>
  )

  return (
    <View style={[styles.betRow, !isLast && styles.lineRowBorder]}>
      {isPressable ? (
        <TouchableOpacity
          style={styles.betPressable}
          onPress={onPress}
          activeOpacity={0.7}
        >
          {content}
        </TouchableOpacity>
      ) : (
        content
      )}
      {showCancelBtn && (
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={onCancelPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelBtnText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  betRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  lineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  betSubject: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  betDetails: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  betRight: { alignItems: 'flex-end' },
  betPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.danger,
    lineHeight: 16,
  },
  betBadge: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  betPending: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1,
  },
  betWager: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
})
