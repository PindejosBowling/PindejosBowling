import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import { ValueField } from './LinePill'
import { useLinePreview, oddsForLine, type LinePreviewSource } from '../../hooks/useLinePreview'

// One combinable stat's slot on the combo card. The screen owns the identity
// (member set, scope) and staging state; each pill owns its OWN live quote so
// the four stats price independently (hook-per-child keeps hooks legal).
export interface ComboStatSpec {
  stat: string
  // 'TOTAL PINS' / 'CLEAN FRAMES' / … (STAT_LABELS, uppercased by the caller).
  label: string
  // The combo pricing source for this stat (null until a season is known;
  // useLinePreview itself withholds quotes below 2 members).
  source: LinePreviewSource
  // The value accepted in the LineEntrySheet (null = ride the seed anchor).
  editedValue: number | null
  // The staged combo's value/price when this exact combo (canonical key) is
  // already in the slip — the pill mirrors the slip, not the draft.
  stagedLine: number | null
  stagedOdds: number | null
  staged: boolean
}

interface ComboLineRowProps {
  // Ordered display names of the picked members — the card's subject header.
  memberNames: string[]
  stats: ComboStatSpec[]
  // 2+ members picked (the compose RPC's minimum) — below it the pills are
  // inert and the hint leads the card.
  minMembers: boolean
  // Scope closed for betting / read-only view: fully inert.
  inert?: boolean
  // Cosmetic dim (low balance) — still pressable so the handler can toast.
  dimmed?: boolean
  // Tapping the value opens the LineEntrySheet for that stat at the shown value.
  onEditValue: (stat: string, value: number) => void
  // Pill-body tap: stage/unstage the combo at the displayed value + price.
  onStage: (spec: ComboStatSpec, value: number, odds: number | null) => void
}

// One stat's value-first pill — the LinePill idiom (value field → condition
// label → price) rebuilt for a market-less combo draft: the quote comes from
// combo_price_line via the pill's own useLinePreview instead of posted rungs.
function ComboStatPill({
  spec,
  minMembers,
  inert,
  dimmed,
  onEditValue,
  onStage,
}: {
  spec: ComboStatSpec
  minMembers: boolean
  inert: boolean
  dimmed: boolean
  onEditValue: (stat: string, value: number) => void
  onStage: (spec: ComboStatSpec, value: number, odds: number | null) => void
}) {
  const { quote, loading } = useLinePreview(spec.source, spec.editedValue)
  // Displayed value: the staged combo's (slip truth) → the accepted edit → the
  // seed anchor. Staged and edited can't diverge — an accepted edit re-stages.
  const value = spec.staged
    ? spec.stagedLine
    : spec.editedValue ?? quote?.seedLine ?? null
  const odds = spec.staged && spec.stagedLine === value
    ? spec.stagedOdds
    : oddsForLine(quote, value)
  const pressable = !inert && minMembers && value != null
  return (
    <View
      style={[
        styles.pill,
        spec.staged && styles.pillSelected,
        (inert || dimmed || !minMembers) && styles.pillDisabled,
      ]}
    >
      <View style={styles.mainRow}>
        {pressable ? (
          <ValueField
            text={`${value.toFixed(1)}+`}
            onPress={() => onEditValue(spec.stat, value)}
            selected={spec.staged}
          />
        ) : (
          <Text style={[styles.value, styles.valueStatic, spec.staged && styles.textSelected]}>
            {value != null ? `${value.toFixed(1)}+` : '—'}
          </Text>
        )}
        <TouchableOpacity
          style={styles.body}
          onPress={pressable ? () => onStage(spec, value, odds) : undefined}
          disabled={!pressable}
          activeOpacity={0.7}
        >
          <Text style={[styles.condition, spec.staged && styles.textSelected]}>
            {spec.label}
          </Text>
          {/* A staged pill shows the slip's price even while the preview
              re-quotes — the slip is the truth it mirrors. */}
          <Text style={[styles.odds, spec.staged && styles.textSelected]}>
            {odds != null ? fmtOdds(odds) : loading ? '…' : '—'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// The combo group's line card — the same subject-card shape as LineRow (name
// header, one full-width value-first pill per condition), where the subject is
// the PICKED MEMBER SET and each pill is one combinable stat. Presentational
// shell + per-pill quotes; the screen owns members, staging, and edited values.
export default function ComboLineRow({
  memberNames,
  stats,
  minMembers,
  inert = false,
  dimmed = false,
  onEditValue,
  onStage,
}: ComboLineRowProps) {
  return (
    <View style={[styles.card, inert && styles.cardInProgress]}>
      <Text style={styles.lineName}>
        {memberNames.length > 0 ? memberNames.join(' + ') : 'COMBO'}
      </Text>
      {!minMembers && <Text style={styles.hint}>PICK 2+ PLAYERS TO PRICE THESE LINES</Text>}
      <View style={styles.pills}>
        {stats.map(spec => (
          <ComboStatPill
            key={spec.stat}
            spec={spec}
            minMembers={minMembers}
            inert={inert}
            dimmed={dimmed}
            onEditValue={onEditValue}
            onStage={onStage}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // LineRow's subject-card language, verbatim — the combo card must read as
  // just another subject on the board.
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surfaceTint,
    marginBottom: spacing.sm,
  },
  cardInProgress: { opacity: 0.5 },
  lineName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  hint: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted2,
    textAlign: 'center',
    marginTop: 4,
  },
  pills: { marginTop: 8, gap: 8 },

  // LinePill's pill styles, mirrored (the pill body differs only in where its
  // price comes from).
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
  value: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    minWidth: 36,
    textAlign: 'center',
    color: colors.text,
  },
  valueStatic: { minWidth: 44 },
  condition: { flex: 1, ...type.chip, color: 'rgba(240,240,240,0.85)' },
  odds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
  },
  textSelected: { color: colors.bg },
})
