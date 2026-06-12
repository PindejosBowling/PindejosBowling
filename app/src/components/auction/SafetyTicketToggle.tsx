import { View, Text, Switch, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface Props {
  // The "use Safety Ticket" row for WagerSheet's children slot (all three bet
  // flows). Default OFF — spending a scarce item is a deliberate act. The
  // caller owns the toggle state and consumes the OLDEST charge; this row
  // never renders when the player has no usable ticket (the Auction House is
  // the advertisement, not a greyed-out toggle).
  ticketCount: number
  enabled: boolean
  onToggle: (on: boolean) => void
  disabled?: boolean
}

export default function SafetyTicketToggle({ ticketCount, enabled, onToggle, disabled }: Props) {
  if (ticketCount <= 0) return null

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>
          🎟️ Use Safety Ticket ({ticketCount} left)
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
          If this bet loses, your full stake comes back. The ticket is spent either way.
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
