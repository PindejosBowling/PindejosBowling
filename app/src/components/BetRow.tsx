import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import type { BetView } from '../hooks/useBettingData'

interface BetRowProps {
  bet: BetView
  isLast: boolean
  badge: { label: string; color: string } | null
  betReturnText: string
  isAdmin: boolean
  onPress?: () => void
  onCancelPress?: () => void
}

export default function BetRow({
  bet,
  isLast,
  badge,
  betReturnText,
  isAdmin,
  onPress,
  onCancelPress,
}: BetRowProps) {
  const isPressable = !!onPress && isAdmin
  const showCancelBtn = !!onCancelPress && isAdmin

  const content = (
    <>
      <View style={{ flex: 1 }}>
        <Text style={styles.betSubject}>
          {bet.subjectName} · {bet.pick?.toUpperCase()} {bet.line.toFixed(1)}
        </Text>
        <Text style={styles.betDetails}>
          {bet.bettorName}
        </Text>
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
