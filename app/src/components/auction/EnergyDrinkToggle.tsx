import { View, Text, Switch, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface Props {
  // The "use Energy Drink" row for WagerSheet's children slot — works on any bet
  // (single or parlay), unlike the Crutch. Default OFF; spending a scarce item is
  // a deliberate act. The caller owns the toggle state and consumes the OLDEST
  // drink; this row never renders when the player has none usable.
  boostCount: number
  enabled: boolean
  onToggle: (on: boolean) => void
  disabled?: boolean
}

export default function EnergyDrinkToggle({ boostCount, enabled, onToggle, disabled }: Props) {
  if (boostCount <= 0) return null

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>
          ⚡️ Use Energy Drink ({boostCount} left)
        </Text>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          disabled={disabled}
          trackColor={{ false: colors.surface3, true: colors.accentDim }}
          thumbColor={enabled ? colors.accent : colors.muted}
        />
      </View>
      {enabled && (
        <Text style={styles.copy}>
          Win and your total payout doubles - lose and you get nothing
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { flex: 1, fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text, letterSpacing: 0.3, marginRight: 10 },
  copy: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
})
