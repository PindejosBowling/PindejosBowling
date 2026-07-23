import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import CenterModal from '../ui/CenterModal'
import Button from '../ui/Button'
import PickChip from './PickChip'

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
            {r.contextLabel != null && <Text style={styles.context}>{r.contextLabel}</Text>}
          </View>
          <PickChip
            label={r.selected ? '✓' : '+'}
            selected={r.selected}
            onPress={() => onToggle(r.id)}
          />
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
  // faint for a four-stat line; gold stays reserved for specials).
  context: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.accent,
    marginTop: 1,
  },
  footnote: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    fontStyle: 'italic',
    color: colors.muted2,
    marginTop: 8,
  },
})
