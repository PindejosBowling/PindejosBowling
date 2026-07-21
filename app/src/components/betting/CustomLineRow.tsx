import { Text, View, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import TicketCard from './TicketCard'
import PickChip from './PickChip'
import { customLegLabel, type CustomLineView } from '../../hooks/usePinsinoData'

interface CustomLineRowProps {
  line: CustomLineView
  // Vestigial since the ticket restyle (cards carry their own margins) — kept
  // so callers don't churn.
  isLast: boolean
  // Whole line closed for betting (any leg's game in progress): dim + inert.
  inProgress?: boolean
  // Dimmed but still pressable, so the screen's handler can toast (anti-tank /
  // low balance) — mirrors LineRow's SelectionUiState.disabled semantics.
  disabled?: boolean
  // Staged in the bet slip — the multiplier chip flips to a solid fill (mirrors
  // LineRow's picked odds cell).
  selected?: boolean
  // Tapping the multiplier. Omit (or set `inProgress`) to render an inert chip.
  onTake?: () => void
}

// One admin custom line ("special") as a ticket card: title, description and
// the bundled legs on the left, a single oversized ×odds multiplier chip (the
// whole bundle) on the right. category drives the treatment — 'special' lines
// get the gold ticket trim; 'default' lines keep the standard accent language.
export default function CustomLineRow({ line, inProgress, disabled, selected, onTake }: CustomLineRowProps) {
  const pressable = !inProgress && !!onTake
  const special = line.category === 'special'

  return (
    <TicketCard gold={special} style={inProgress ? styles.cardInProgress : undefined}>
      <View style={styles.row}>
        <View style={styles.info}>
          <Text style={[styles.title, special && styles.titleSpecial]}>{line.title}</Text>
          {line.description !== '' && (
            <Text style={styles.description} numberOfLines={2}>{line.description}</Text>
          )}
          {line.legs.map(leg => (
            <Text key={leg.selectionId} style={styles.leg}>{customLegLabel(leg)}</Text>
          ))}
        </View>
        {/* The multiplier IS the button — oversized for scanability. */}
        <PickChip
          label={`×${line.combinedOdds.toFixed(line.combinedOdds % 1 === 0 ? 0 : 2)}`}
          size="lg"
          gold={special}
          selected={selected}
          disabled={disabled}
          inert={!pressable}
          onPress={pressable ? onTake : undefined}
        />
      </View>
    </TicketCard>
  )
}

const styles = StyleSheet.create({
  cardInProgress: { opacity: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  info: { flex: 1 },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  titleSpecial: { color: colors.gold },
  description: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  leg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.4,
  },
})
