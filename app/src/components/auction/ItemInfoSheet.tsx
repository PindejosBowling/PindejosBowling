import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { InventoryItemView, SOURCE_LABEL, isItemExpired } from '../../utils/auction'
import { formatCloseTime } from '../../utils/bounty'

interface Props {
  // Info-only sheet for an inventory item: what it does, how to use it, where
  // it came from. No actions — activation deliberately lives only at the point
  // of use (the wager sheet). Mount conditionally.
  item: InventoryItemView
  onClose: () => void
}

export default function ItemInfoSheet({ item, onClose }: Props) {
  const expired = isItemExpired(item)

  return (
    <BottomSheet
      title={`${item.icon} ${item.name}`}
      subtitle={expired ? 'EXPIRED' : `${item.remainingCharges} ${item.remainingCharges === 1 ? 'charge' : 'charges'} remaining`}
      onClose={onClose}
      footer={<Button variant="ghost" label="Close" onPress={onClose} />}
    >
      <Text style={styles.section}>WHAT IT DOES</Text>
      <Text style={styles.copy}>{item.effectLine}</Text>

      <Text style={styles.section}>HOW TO USE IT</Text>
      <Text style={styles.copy}>{expired ? 'This item has been used up.' : item.howToUse}</Text>

      <Text style={styles.section}>PROVENANCE</Text>
      <Text style={styles.copy}>
        {SOURCE_LABEL[item.source]}, {formatCloseTime(item.grantedAt)}
        {item.consumedAt ? ` · used ${formatCloseTime(item.consumedAt)}` : ''}
      </Text>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted, marginTop: 16, marginBottom: 6 },
  copy: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, lineHeight: 20 },
})
