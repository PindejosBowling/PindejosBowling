import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { InventoryItemView, isItemExpired } from '../../utils/auction'

interface Props {
  item: InventoryItemView
  onPress: () => void
}

// One inventory row in the My Items section. Consumed/spent items stay
// visible in a greyed-out EXPIRED state (history preserved; FINDINGS §8).
export default function MyItemRow({ item, onPress }: Props) {
  const expired = isItemExpired(item)

  return (
    <TouchableOpacity
      style={[styles.row, expired && styles.rowExpired]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.icon, expired && styles.textExpired]}>{item.icon}</Text>
      <View style={styles.body}>
        <Text style={[styles.name, expired && styles.textExpired]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.effect, expired && styles.textExpired]} numberOfLines={1}>{item.effectLine}</Text>
      </View>
      {expired ? (
        <Text style={styles.expiredTag}>EXPIRED</Text>
      ) : (
        <Text style={styles.charges}>
          {item.remainingCharges} {item.remainingCharges === 1 ? 'CHARGE' : 'CHARGES'}
        </Text>
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
  charges: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1, color: colors.accent },
  expiredTag: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1, color: colors.muted },
  textExpired: { color: colors.muted },
})
