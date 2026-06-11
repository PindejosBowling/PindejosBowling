import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import type { CustomLineView } from '../../hooks/usePinsinoData'

interface CustomLineRowProps {
  line: CustomLineView
  isLast: boolean
  // Whole line closed for betting (any leg's game in progress): dim + inert.
  inProgress?: boolean
  // Dimmed but still pressable, so the screen's handler can toast (anti-tank /
  // low balance) — mirrors LineRow's SelectionUiState.disabled semantics.
  disabled?: boolean
  // Tapping the TAKE button. Omit (or set `inProgress`) to render an inert pill.
  onTake?: () => void
}

// Presentational row for one admin custom line ("special"): title, description
// and the bundled legs on the left, a single TAKE button (the whole bundle) on
// the right. category drives the visual treatment — 'special' lines get the
// gold chip + border; 'default' lines match the standard accent language.
export default function CustomLineRow({ line, isLast, inProgress, disabled, onTake }: CustomLineRowProps) {
  const pressable = !inProgress && !!onTake
  const special = line.category === 'special'

  return (
    <View style={[styles.row, special && styles.rowSpecial, !isLast && styles.rowBorder, inProgress && styles.rowInProgress]}>
      <View style={styles.info}>
        <Text style={[styles.title, special && styles.titleSpecial]}>{line.title}</Text>
        {line.description !== '' && (
          <Text style={styles.description} numberOfLines={2}>{line.description}</Text>
        )}
        {line.legs.map(leg => (
          <Text key={leg.selectionId} style={styles.leg}>
            {leg.subjectName} · {leg.pick.toUpperCase()}
            {leg.marketType === 'over_under' && leg.line != null ? ` ${leg.line.toFixed(1)}` : ''}
            {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
          </Text>
        ))}
      </View>
      <TouchableOpacity
        style={[
          styles.takeBtn,
          special && styles.takeBtnSpecial,
          (inProgress || disabled) && styles.takeBtnDisabled,
        ]}
        onPress={pressable ? onTake : undefined}
        disabled={!pressable}
        activeOpacity={0.7}
      >
        <Text style={[styles.takeBtnOdds, special && styles.takeBtnOddsSpecial]}>
          ×{line.combinedOdds.toFixed(line.combinedOdds % 1 === 0 ? 0 : 2)}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowInProgress: { opacity: 0.5 },
  // Specials get the gold wash (same weight as the board's with/against tints).
  rowSpecial: { backgroundColor: colors.goldTint },
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
  takeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  takeBtnSpecial: {
    borderColor: colors.gold,
    backgroundColor: colors.goldDim,
  },
  takeBtnDisabled: { borderColor: colors.border2, backgroundColor: 'transparent', opacity: 0.4 },
  // The multiplier IS the button — oversized for scanability.
  takeBtnOdds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 18,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  takeBtnOddsSpecial: { color: colors.gold },
})
