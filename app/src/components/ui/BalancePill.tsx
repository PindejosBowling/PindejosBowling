import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { formatPins } from '../../utils/formatting'

// The "BALANCE — 1,234 pins" pill that sits atop every economy screen
// (Bounties / Auction House / PvP / Loan Shark / Bounty Create). Previously
// re-implemented inline with identical `balancePill*` styles in all five.
// `label` defaults to "BALANCE" (Bounty Create uses "YOUR BALANCE"); `style`
// lets callers tune the outer margins to their layout.
interface BalancePillProps {
  balance: number
  label?: string
  style?: StyleProp<ViewStyle>
}

export default function BalancePill({ balance, label = 'BALANCE', style }: BalancePillProps) {
  return (
    <View style={[styles.pill, style]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{formatPins(balance)} pins</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted },
  value: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 20, color: colors.accent },
})
