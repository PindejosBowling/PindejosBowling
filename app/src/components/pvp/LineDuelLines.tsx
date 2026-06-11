import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'

interface LineSide {
  name: string    // row label (e.g. "Your line" or a player's name)
  value: string   // preformatted value ("130.5", "Set when taken", "—")
}

interface Props {
  // The two bowlers' lines-to-beat, in display order.
  sides: [LineSide, LineSide]
  // Section header; defaults to "LINES TO BEAT".
  label?: string
  // Optional helper text shown below the card (e.g. the settlement rule).
  note?: string
}

// Shared presentation for a Line Duel's lines-to-beat, used on the create screen,
// the counter modal, and the contract detail. Each side carries its own
// preformatted value so callers keep their context-specific formatting (open-board
// "Set when taken", viewer-relative labels, etc.) while the look stays consistent.
export default function LineDuelLines({ sides, label = 'LINES TO BEAT', note }: Props) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.card}>
        {sides.map((s, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.value}>{s.value}</Text>
          </View>
        ))}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.muted, marginTop: 14, marginBottom: 8 },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  name: { fontFamily: fonts.barlowCondensed, fontSize: 15, color: colors.text },
  value: { fontFamily: fonts.barlowCondensedHeavy, fontSize: 16, color: colors.accent },
  note: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 6 },
})
