import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import { STAT_LABELS, type LineView } from '../../hooks/usePinsinoData'

interface LinePillProps {
  // One market. The bettor chooses the VALUE they want to beat; the odds
  // follow from the value (posted rung or an accepted sheet quote).
  line: LineView
  // The displayed line value (screen-owned: staged pick's value, the user's
  // accepted edit, else the seed rung).
  value: number
  // The price for `value`: posted odds, the accepted quote, or null.
  odds: number | null
  // Tapping the value opens the LineEntrySheet for this market.
  onEditValue?: () => void
  // Pill-body tap: stage/unstage at the displayed value.
  onStage?: () => void
  staged?: boolean
  // Cosmetic dim (low balance) — still pressable so the handler can toast.
  dimmed?: boolean
  // Market/scope closed — fully inert.
  inert?: boolean
}

// The shared "type your own number" chip — tinted fill + border + ✎ glyph, the
// one recognizable editable-value affordance across value-first surfaces (the
// board pills here, the combo pane's value field). `lg` is the pane's slightly
// bigger cut; `selected` flips to the dark-on-accent inset used on staged pills.
export function ValueField({
  text,
  onPress,
  selected,
  size = 'md',
}: {
  text: string
  onPress?: () => void
  selected?: boolean
  size?: 'md' | 'lg'
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.valueField, size === 'lg' && styles.valueFieldLg, selected && styles.valueFieldSelected]}
    >
      <Text style={[styles.value, size === 'lg' && styles.valueLg, selected && styles.textSelected]}>
        {text}
      </Text>
      <Text style={[styles.editGlyph, size === 'lg' && styles.editGlyphLg, selected && styles.textSelected]}>✎</Text>
    </TouchableOpacity>
  )
}

// What's being counted, sans the number (the value carries the number):
// "PINS" / "TOTAL PINS" on score lines, the stat label on props/combos.
export function conditionLabel(line: LineView): string {
  if (line.marketType === 'over_under') {
    return line.gameNumber != null ? 'PINS' : 'TOTAL PINS'
  }
  if (line.statKey) return (STAT_LABELS[line.statKey] ?? line.statKey).toUpperCase()
  return line.title.toUpperCase()
}

// A full-width board pill — one market per row, value-first: the value on the
// left (the number the bettor intends to beat; tap it to retype in the
// LineEntrySheet), the condition label beside it, the price on the right.
// Tapping the pill body stages/unstages the displayed value — the odds derive
// from the chosen value, never the other way around.
export default function LinePill({
  line,
  value,
  odds,
  onEditValue,
  onStage,
  staged,
  dimmed,
  inert,
}: LinePillProps) {
  const pressable = !inert && !!onStage
  const canEdit = pressable && !!onEditValue

  return (
    <View
      style={[
        styles.pill,
        staged && styles.pillSelected,
        (inert || dimmed) && styles.pillDisabled,
      ]}
    >
      <View style={styles.mainRow}>
        {/* The value renders as a small FIELD (bordered chip + edit glyph)
            when tappable, so it reads as "type your own number here" —
            plain text when inert. */}
        {canEdit ? (
          <ValueField text={`${value.toFixed(1)}+`} onPress={onEditValue} selected={staged} />
        ) : (
          <Text style={[styles.value, styles.valueStatic, staged && styles.textSelected]}>
            {value.toFixed(1)}+
          </Text>
        )}
        <TouchableOpacity
          style={styles.body}
          onPress={pressable ? onStage : undefined}
          disabled={!pressable}
          activeOpacity={0.7}
        >
          <Text style={[styles.condition, staged && styles.textSelected]}>
            {conditionLabel(line)}
          </Text>
          <Text style={[styles.odds, staged && styles.textSelected]}>
            {odds != null ? fmtOdds(odds) : '—'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pillSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillDisabled: { borderColor: colors.border2, opacity: 0.5 },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The tappable value field — styled like a small input (tinted fill,
  // visible border, edit glyph) so the affordance is unmistakable.
  valueField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint2,
  },
  valueFieldLg: { paddingHorizontal: 10, paddingVertical: 6 },
  // On the staged accent fill, the field flips to a dark-on-accent inset.
  valueFieldSelected: {
    borderColor: 'rgba(10,10,12,0.45)',
    backgroundColor: 'rgba(10,10,12,0.12)',
  },
  value: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    minWidth: 36,
    textAlign: 'center',
    color: colors.text,
  },
  valueLg: { fontSize: 17, minWidth: 0 },
  valueStatic: { minWidth: 44 },
  editGlyph: { fontSize: 11, color: colors.accent },
  editGlyphLg: { fontSize: 12 },
  condition: { flex: 1, ...type.chip, color: 'rgba(240,240,240,0.85)' },
  odds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
  },
  textSelected: { color: colors.bg },
})
