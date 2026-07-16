import { Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import { InventoryGroupView, SOURCE_LABEL } from '../../utils/auction'
import { formatCloseTime } from '../../utils/bounty'

interface Props {
  // Info sheet for a grouped inventory row: what it does, where it gets spent,
  // and the provenance of each atomic item in the group. Activation still lives
  // at the point of use (the wager sheet / haunt CTA) — the Sportsbook button
  // only navigates. Mount conditionally.
  group: InventoryGroupView
  onClose: () => void
  // Navigate to the Sportsbook (the caller owns navigation and closing the
  // sheet). Omit for expired groups and read-only seasons — the button hides.
  onUseAtSportsbook?: () => void
}

export default function ItemInfoSheet({ group: g, onClose, onUseAtSportsbook }: Props) {
  return (
    <BottomSheet
      title={`${g.icon} ${g.name}${g.count > 1 ? ` ×${g.count}` : ''}`}
      subtitle={g.expired ? 'EXPIRED' : `single use · ${g.count} ready`}
      onClose={onClose}
      footer={
        <>
          {onUseAtSportsbook != null && (
            <Button label="Use at the Sportsbook →" onPress={onUseAtSportsbook} />
          )}
          <Button variant="ghost" label="Close" onPress={onClose} />
        </>
      }
    >
      <Text style={styles.section}>WHAT IT DOES</Text>
      <Text style={styles.copy}>{g.effectLine}</Text>

      <Text style={styles.section}>WHERE TO USE IT</Text>
      <Text style={styles.copy}>{g.expired ? 'These have been used up.' : g.howToUse}</Text>

      <Text style={styles.section}>PROVENANCE</Text>
      {g.items.map(item => (
        <Text key={item.id} style={styles.copy}>
          {SOURCE_LABEL[item.source]}, {formatCloseTime(item.grantedAt)}
          {item.consumedAt ? ` · used ${formatCloseTime(item.consumedAt)}` : ''}
        </Text>
      ))}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 2, color: colors.muted, marginTop: 16, marginBottom: 6 },
  copy: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, lineHeight: 20, marginBottom: 2 },
})
