import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { AdminInventoryItemView, AdminInventoryPlayerGroup, SOURCE_LABEL } from '../../utils/auction'
import { formatCloseTime } from '../../utils/formatting'

interface AdminInventoryListProps {
  groups: AdminInventoryPlayerGroup[]
  // Fired for a removable (unconsumed) row only; the screen opens the confirm sheet.
  onRemove: (item: AdminInventoryItemView) => void
}

// The admin remove-item view: every player's season inventory, grouped by
// player. Unconsumed rows carry a Remove action (revoke_inventory_item);
// already-used rows show greyed as USED — history, not removable here.
export default function AdminInventoryList({ groups, onRemove }: AdminInventoryListProps) {
  if (groups.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>No items in any player’s inventory this season.</Text>
      </View>
    )
  }

  return (
    <>
      {groups.map(group => (
        <View key={group.playerId} style={styles.group}>
          <Text style={styles.playerName}>
            {group.playerName}
            {group.removableCount > 0 && <Text style={styles.pending}>  {group.removableCount} REMOVABLE</Text>}
          </Text>
          {group.items.map(item => (
            <View key={item.id} style={[styles.row, !item.removable && styles.rowUsed]}>
              <View style={styles.rowText}>
                <Text style={[styles.itemName, !item.removable && styles.usedText]}>
                  {item.icon} {item.name}
                  {!item.removable && <Text style={styles.usedTag}>  USED</Text>}
                </Text>
                <Text style={styles.itemMeta}>
                  {SOURCE_LABEL[item.source]} · {formatCloseTime(item.grantedAt)}
                </Text>
              </View>
              {item.removable ? (
                <TouchableOpacity onPress={() => onRemove(item)} activeOpacity={0.8} style={styles.removeBtn}>
                  <Text style={styles.removeText}>REMOVE</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  group: { marginBottom: 14 },
  playerName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    letterSpacing: 0.5,
    color: colors.text,
    marginBottom: 8,
  },
  pending: { fontFamily: fonts.barlowCondensed, fontSize: 11, letterSpacing: 1.5, color: colors.accent },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  rowUsed: { opacity: 0.55 },
  rowText: { flex: 1, marginRight: 12 },
  itemName: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text, letterSpacing: 0.3 },
  usedText: { color: colors.muted },
  usedTag: { fontFamily: fonts.barlowCondensed, fontSize: 10, letterSpacing: 1.5, color: colors.muted },
  itemMeta: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 3 },

  removeBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeText: { fontFamily: fonts.barlowCondensed, fontSize: 12, letterSpacing: 1.5, color: colors.danger },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
})
