import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
import PickChip from './PickChip'

// One candidate row, fully resolved by the screen (this sheet stays
// presentational): display name, the scope-scaled avg/forecast context line,
// and whether they're already on the board.
export interface AddPlayerRow {
  id: string
  name: string
  // 'SEASON AVG 412.5' / 'LIFETIME AVG …' / 'LEAGUE AVG …' / 'NO STAT HISTORY';
  // null hides the context line entirely (pool stats not loaded yet).
  contextLabel: string | null
  forecastLabel: string | null // 'FORECAST 418.0'
  // The arrow rides the BOOK: ▲ = the book rates the member above their
  // average (adding them makes the combo richer than the averages suggest).
  dir: 'up' | 'down' | null
  selected: boolean
  // The solo board's subject — shown ✓ but not removable from here (remove
  // via their heading chip once a group exists).
  locked?: boolean
}

interface AddPlayersSheetProps {
  rows: AddPlayerRow[]
  onToggle: (id: string) => void
  onClose: () => void
}

// The combo builder — raised from the board heading's ＋ chip. Every RSVP'd-in
// player, each with their Total Pins average/forecast context; toggling adds
// them to (or removes them from) the board's subject group live — the board
// underneath re-prices as the group changes, and Done just dismisses.
export default function AddPlayersSheet({ rows, onToggle, onClose }: AddPlayersSheetProps) {
  return (
    <BottomSheet
      title="Add Players"
      subtitle="Combine players into one over/under — everyone's total, one line"
      onClose={onClose}
      footer={<Button label="Done" onPress={onClose} />}
    >
      {rows.map(r => (
        <View key={r.id} style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name}>{r.name}</Text>
            {r.contextLabel != null && (
              <Text style={styles.context}>
                {r.contextLabel}
                {r.forecastLabel != null && (
                  <>
                    {'  ·  '}
                    <Text style={styles.forecast}>{r.forecastLabel}</Text>
                    {r.dir != null && (
                      <Text style={r.dir === 'up' ? styles.dirUp : styles.dirDown}>
                        {r.dir === 'up' ? ' ▲' : ' ▼'}
                      </Text>
                    )}
                  </>
                )}
              </Text>
            )}
          </View>
          <PickChip
            label={r.selected ? '✓' : '+'}
            selected={r.selected}
            inert={r.locked}
            onPress={() => onToggle(r.id)}
          />
        </View>
      ))}
    </BottomSheet>
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
  context: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted2,
    marginTop: 1,
  },
  forecast: { color: colors.text },
  dirUp: { color: colors.success, fontSize: 9 },
  dirDown: { color: colors.danger, fontSize: 9 },
})
