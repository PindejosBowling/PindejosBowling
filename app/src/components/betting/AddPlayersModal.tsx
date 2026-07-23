import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import CenterModal from '../ui/CenterModal'
import Button from '../ui/Button'

// One candidate row, fully resolved by the screen (this modal stays
// presentational): display name, the scope-scaled four-stat season-average
// line, and whether they're already on the board.
export interface AddPlayerRow {
  id: string
  name: string
  // 'PINS 412.5 · CLEAN 6.0* · STRIKES 8.5 · SPARES 4.0' (a `*` marks a
  // lifetime/league fallback), 'NO STAT HISTORY', or null to hide the line
  // entirely (pool stats not loaded yet).
  contextLabel: string | null
  selected: boolean
}

interface AddPlayersModalProps {
  rows: AddPlayerRow[]
  onToggle: (id: string) => void
  onClose: () => void
}

// The combo builder — raised from the board heading's ＋ chip, as a centered
// popup (CenterModal, not a bottom sheet). Every RSVP'd-in player, each with
// their four scope-scaled season averages for context; toggling adds them to
// (or removes them from) the board's subject group live — the board
// underneath re-prices as the group changes, and Done just dismisses.
export default function AddPlayersModal({ rows, onToggle, onClose }: AddPlayersModalProps) {
  const fallback = rows.some(r => r.contextLabel?.includes('*'))
  return (
    <CenterModal
      title="Combo Bet"
      subtitle="Combine players into a single over/under bet"
      onClose={onClose}
      footer={<Button label="Done" onPress={onClose} />}
    >
      {rows.map(r => (
        <View key={r.id} style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name}>{r.name}</Text>
            {r.contextLabel != null && (
              <Text style={styles.context}>
                {/* Split so the numeric values pop in white against the
                    accent-tinted stat labels. */}
                {r.contextLabel.split(/(\d+(?:\.\d+)?)/).map((part, i) =>
                  /^\d/.test(part)
                    ? <Text key={i} style={styles.contextValue}>{part}</Text>
                    : part
                )}
              </Text>
            )}
          </View>
          {/* Compact square toggle — a minimal +/✓ so the stat line under each
              name gets the horizontal room (the shared PickChip's 78px min
              width crowded it out). */}
          <TouchableOpacity
            style={[styles.toggle, r.selected && styles.toggleSelected]}
            onPress={() => onToggle(r.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.toggleText, r.selected && styles.toggleTextSelected]}>
              {r.selected ? '✓' : '+'}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
      {fallback && (
        <Text style={styles.footnote}>* no season games yet — lifetime/league average shown</Text>
      )}
    </CenterModal>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border2,
  },
  info: { flex: 1 },
  name: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  // Accent for legibility against the dark card (the muted grey read too
  // faint for a four-stat line; gold stays reserved for specials). Given the
  // horizontal room freed by the compact toggle, the stat line reads a touch
  // larger for prominence under each name.
  context: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12.5,
    letterSpacing: 0.5,
    color: colors.text,
    marginTop: 2,
  },
  // The numeric values within the stat line — accent/yellow, to pop against
  // the white stat names around them.
  contextValue: { color: colors.accent },
  // The compact add/remove toggle — a small square, neutral at rest, accent
  // fill when the player is on the board.
  toggle: {
    width: 30,
    height: 30,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    lineHeight: 20,
    color: colors.accent,
  },
  toggleTextSelected: { color: colors.bg },
  footnote: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    fontStyle: 'italic',
    color: colors.muted2,
    marginTop: 8,
  },
})
