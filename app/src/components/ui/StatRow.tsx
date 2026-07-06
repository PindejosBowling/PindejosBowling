import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'

interface Props {
  label: string
  value: string
  // 'normal' = quiet fact row · 'accent' = the number that matters (pot,
  // payout) · 'big' = the headline figure with a small-caps label (one per
  // sheet, e.g. the borrow amount).
  variant?: 'normal' | 'accent' | 'big'
}

// The two-column "Label … Value" row used in confirm sheets and detail views —
// one implementation of the label/value pair previously re-declared per modal.
export default function StatRow({ label, value, variant = 'normal' }: Props) {
  return (
    <View style={styles.row}>
      <Text style={variant === 'big' ? styles.labelBig : styles.label}>{label}</Text>
      <Text style={variant === 'normal' ? styles.value : variant === 'accent' ? styles.valueAccent : styles.valueBig}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  label: { flex: 1, marginRight: 8, fontFamily: fonts.barlow, fontSize: 14, color: colors.muted },
  labelBig: { flex: 1, marginRight: 8, fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.muted },
  value: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
  valueAccent: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 18, color: colors.accent },
  valueBig: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 26, color: colors.accent },
})
