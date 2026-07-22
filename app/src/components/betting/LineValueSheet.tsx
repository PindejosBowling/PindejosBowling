import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '../../theme'
import BottomSheet from '../ui/BottomSheet'
import { fmtOdds } from '../../utils/bets'

// One selectable rung of a market's priced ladder.
export interface ValueSheetRung {
  line: number
  odds: number
  // The house's centerline (the seed rung) — subtly marked.
  isSeed?: boolean
  // Dimmed but STILL pressable so the caller's handler can toast (anti-tank,
  // low balance) — mirrors the board chips' disabled semantics.
  disabled?: boolean
  // Currently staged (board) / currently chosen (combo builder).
  selected?: boolean
}

interface LineValueSheetProps {
  // e.g. the subject's full name, or the combo's member list.
  title: string
  // e.g. 'STRIKES · NIGHT'.
  subtitle?: string
  rungs: ValueSheetRung[]
  // Renders the rung's condition text ("4.5+ STRIKES") — the caller owns the
  // wording so board rows and combos read exactly like their chips.
  formatLine: (line: number) => string
  // Tapping any row picks it (the caller stages/chooses AND closes; tapping
  // the selected row again un-picks where the caller supports toggling).
  onPick: (index: number) => void
  onClose: () => void
}

// The value picker behind every laddered line: "bet on the outcome you want —
// the odds derive from your selection." Lists each offered value with its
// payout; the seed rung is the house's read, everything else is the bettor
// choosing a safer number (pays less) or a longshot (pays more).
// Conditional-mount contract: render only while open ({sheet && <LineValueSheet/>}).
export default function LineValueSheet({
  title,
  subtitle,
  rungs,
  formatLine,
  onPick,
  onClose,
}: LineValueSheetProps) {
  return (
    <BottomSheet title={title} subtitle={subtitle} onClose={onClose}>
      <View style={styles.list}>
        {rungs.map((r, i) => (
          <TouchableOpacity
            key={`${r.line}`}
            style={[styles.row, r.selected && styles.rowSelected, r.disabled && styles.rowDisabled]}
            onPress={() => onPick(i)}
            activeOpacity={0.7}
          >
            <Text style={[styles.condition, r.selected && styles.textSelected]}>
              {formatLine(r.line)}
            </Text>
            {r.isSeed && (
              <Text style={[styles.seedTag, r.selected && styles.textSelected]}>HOUSE LINE</Text>
            )}
            <Text style={[styles.odds, r.selected && styles.textSelected]}>{fmtOdds(r.odds)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
  },
  rowSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowDisabled: { opacity: 0.4 },
  condition: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.5,
  },
  seedTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  odds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 16,
    color: colors.accent,
  },
  textSelected: { color: colors.bg },
})
