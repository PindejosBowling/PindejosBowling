import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { InventoryGroupView } from '../../utils/auction'

interface Props {
  group: InventoryGroupView
  onPress: () => void
}

// One inventory row in the My Items section. Items are atomic and single-use;
// identical ones display grouped as ×N. Consumed items stay visible in a
// greyed-out EXPIRED group (history preserved; FINDINGS §8).
export default function MyItemRow({ group: g, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.row, g.expired && styles.rowExpired]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.icon, g.expired && styles.textExpired]}>{g.icon}</Text>
      <View style={styles.body}>
        <Text style={[styles.name, g.expired && styles.textExpired]} numberOfLines={1}>
          {g.name}{g.count > 1 ? ` ×${g.count}` : ''}
        </Text>
        <Text style={[styles.effect, g.expired && styles.textExpired]} numberOfLines={1}>{g.effectLine}</Text>
      </View>
      {g.expired ? (
        <Text style={styles.expiredTag}>EXPIRED</Text>
      ) : (
        <Text style={styles.countTag}>{g.count === 1 ? 'SINGLE USE' : `${g.count} READY`}</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowExpired: { opacity: 0.55 },
  icon: { fontSize: 22, marginRight: 12 },
  body: { flex: 1, marginRight: 10 },
  name: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text, letterSpacing: 0.3 },
  effect: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 1 },
  countTag: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1, color: colors.accent },
  expiredTag: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1, color: colors.muted },
  textExpired: { color: colors.muted },
})
