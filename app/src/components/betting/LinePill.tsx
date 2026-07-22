import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import LineStepper from './LineStepper'
import { STAT_LABELS, type LineView } from '../../hooks/usePinsinoData'

interface LinePillProps {
  // One market. The bettor chooses the VALUE they want to beat; the odds
  // follow from the value (posted rung or live preview).
  line: LineView
  // The displayed line value (screen-owned: staged pick's value, the user's
  // edit, else the seed rung).
  value: number
  // The price for `value`: posted odds, a live quote, or null (still pricing /
  // out of the priceable band).
  odds: number | null
  // A preview fetch is in flight for this pill's value.
  loading?: boolean
  // The priceable half-point band once known (clamps the stepper).
  band?: { min: number; max: number } | null
  // Value edits (committed type-in).
  onValueChange?: (v: number) => void
  // The value input just opened — the screen starts pricing this market so
  // the min–max band shows while typing.
  onEditStart?: () => void
  // Pill-body tap: stage/unstage at the displayed value.
  onStage?: () => void
  staged?: boolean
  // Cosmetic dim (low balance) — still pressable so the handler can toast.
  dimmed?: boolean
  // Market/scope closed — fully inert.
  inert?: boolean
  // Armed combine mode repurposes taps to seed a combo — no value editing.
  editable?: boolean
}

// What's being counted, sans the number (the stepper carries the number):
// "PINS" / "TOTAL PINS" on score lines, the stat label on props/combos.
function conditionLabel(line: LineView): string {
  if (line.marketType === 'over_under') {
    return line.gameNumber != null ? 'PINS' : 'TOTAL PINS'
  }
  if (line.statKey) return (STAT_LABELS[line.statKey] ?? line.statKey).toUpperCase()
  return line.title.toUpperCase()
}

// A full-width board pill — one market per row, value-first: a tap-to-type
// value on the left (the number the bettor intends to beat), the
// condition label beside it, the price on the right updating live as the
// value moves. Tapping the pill body stages/unstages the displayed value —
// the odds derive from the chosen value, never the other way around.
export default function LinePill({
  line,
  value,
  odds,
  loading,
  band,
  onValueChange,
  onEditStart,
  onStage,
  staged,
  dimmed,
  inert,
  editable = true,
}: LinePillProps) {
  const pressable = !inert && !!onStage
  const canEdit = pressable && editable && !!onValueChange

  return (
    <View
      style={[
        styles.pill,
        staged && styles.pillSelected,
        (inert || dimmed) && styles.pillDisabled,
      ]}
    >
      <View style={styles.mainRow}>
        {canEdit ? (
          <LineStepper
            value={value}
            onChange={onValueChange!}
            onEditStart={onEditStart}
            min={band?.min}
            max={band?.max}
            onFill={staged}
          />
        ) : (
          <Text style={[styles.staticValue, staged && styles.textSelected]}>
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
            {loading ? '…' : odds != null ? fmtOdds(odds) : '—'}
          </Text>
        </TouchableOpacity>
      </View>
      {!loading && odds == null && (
        <Text style={styles.unavailable}>line unavailable — try a closer number</Text>
      )}
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
  staticValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.text,
  },
  condition: { flex: 1, ...type.chip, color: 'rgba(240,240,240,0.85)' },
  odds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
  },
  textSelected: { color: colors.bg },
  unavailable: { ...type.label, color: colors.gold, marginTop: 6 },
})
