import { type ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import { STAT_LABELS, type LineView } from '../../hooks/usePinsinoData'

// The shared "type your own number" chip — tinted fill + border + ✎ glyph, the
// one recognizable editable-value affordance across value-first surfaces.
// `selected` flips to the dark-on-accent inset used on staged pills.
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
      <Text style={[styles.editGlyph, size === 'lg' && styles.editGlyphLg, selected && styles.textSelected]}>✎</Text>
      <Text style={[styles.value, size === 'lg' && styles.valueLg, selected && styles.textSelected]}>
        {text}
      </Text>
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

// One value-first pill slot on a subject card, as PLAIN DATA — the same shape
// whether the price comes from a posted market (single-player mode) or a live
// combo quote (combo mode). The screen builds these; the card just renders
// them, so the two modes CANNOT drift visually and a mode switch is a props
// update on the one mounted card (key by stat so each pill survives the
// toggle in place — no remount, no flash).
export interface StatPillSpec {
  // Stable slot identity across modes: 'total_pins' (the score line) /
  // 'clean_frames' / 'strikes' / 'spares' (marketId for anything else).
  key: string
  // 'TOTAL PINS' / 'CLEAN FRAMES' / … (conditionLabel / STAT_LABELS).
  label: string
  // The displayed value (null = no anchor known yet → '—').
  value: number | null
  // The price for `value` (posted rung / staged snapshot / accepted or live
  // quote); null = unpriced.
  odds: number | null
  // A live quote is in flight for this pill — the odds slot shows '…'
  // instead of '—' (the value never blanks; it holds its last anchor).
  quoteLoading?: boolean
  staged?: boolean
  // This pill alone is closed (its market in progress) — the card-level
  // `inert` handles scope/read-only.
  inert?: boolean
  // Tapping the value opens the LineEntrySheet at the shown value.
  onEditValue?: () => void
  // Pill-body tap: stage/unstage at the displayed value + price.
  onStage?: () => void
}

interface SubjectLinesCardProps {
  // The subject's name header — a string (centered, LineRow's name idiom) or
  // a custom node; omit when the name lives just above (the player-name
  // selector heads the single-player stack).
  header?: ReactNode
  // The viewer's relationship to the subject ('with' = teammate this week,
  // 'against' = matchup opponent) — a subtle background tint, nothing more.
  relation?: 'with' | 'against' | null
  // Whole card closed for betting: dim it + every pill inert.
  inProgress?: boolean
  pills: StatPillSpec[]
  // Cosmetic dim (low balance) — still pressable so handlers can toast.
  dimmed?: boolean
}

// THE board line card — one component for every betting subject on the Place
// board: the selected player's consolidated lines, each posted combo market,
// and combo mode's group draft all render through this same card + pill
// stack. Presentational; the screen owns values, quotes, and staging.
export default function SubjectLinesCard({
  header,
  relation,
  inProgress,
  pills,
  dimmed,
}: SubjectLinesCardProps) {
  return (
    <View
      style={[
        styles.card,
        relation === 'with' && styles.cardWith,
        relation === 'against' && styles.cardAgainst,
        inProgress && styles.cardInProgress,
      ]}
    >
      {typeof header === 'string' ? <Text style={styles.lineName}>{header}</Text> : header}
      <View style={[styles.pills, header == null && styles.pillsHeaderless]}>
        {pills.map(spec => {
          const inert = !!inProgress || !!spec.inert
          const pressable = !inert && spec.onStage != null && spec.value != null
          const canEdit = pressable && spec.onEditValue != null
          return (
            <View
              key={spec.key}
              style={[
                styles.pill,
                spec.staged && styles.pillSelected,
                (inert || dimmed) && styles.pillDisabled,
              ]}
            >
              <View style={styles.mainRow}>
                {/* The value renders as a small FIELD (bordered chip + edit
                    glyph) when tappable, so it reads as "type your own number
                    here" — plain text when inert. */}
                {canEdit ? (
                  <ValueField
                    text={`${spec.value!.toFixed(1)}+`}
                    onPress={spec.onEditValue}
                    selected={spec.staged}
                  />
                ) : (
                  <Text style={[styles.value, styles.valueStatic, spec.staged && styles.textSelected]}>
                    {spec.value != null ? `${spec.value.toFixed(1)}+` : '—'}
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.body}
                  onPress={pressable ? spec.onStage : undefined}
                  disabled={!pressable}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.condition, spec.staged && styles.textSelected]}>
                    {spec.label}
                  </Text>
                  <Text style={[styles.odds, spec.staged && styles.textSelected]}>
                    {spec.odds != null ? fmtOdds(spec.odds) : spec.quoteLoading ? '…' : '—'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // One subject = one spaced tinted card: centered name header, then a column
  // of full-width pills (one condition per row).
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surfaceTint,
    marginBottom: spacing.sm,
  },
  cardInProgress: { opacity: 0.5 },
  // Subtle with/against tints — teammates green-cast, matchup opponents
  // red-cast, everyone else on the plain tinted card (minimal clutter).
  cardWith: { backgroundColor: colors.successTint },
  cardAgainst: { backgroundColor: colors.dangerTint },
  lineName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  pills: { marginTop: 8, gap: 8 },
  pillsHeaderless: { marginTop: 0 },

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
