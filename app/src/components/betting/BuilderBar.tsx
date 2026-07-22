import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import Button from '../ui/Button'
import { fmtOdds } from '../../utils/bets'
import type { ComboLadderRung } from '../../hooks/useComboLinePreview'

interface BuilderBarProps {
  // Ordered display names of the members picked so far.
  memberNames: string[]
  // 'STRIKES', 'TOTAL PINS', … (STAT_LABELS, uppercased by the caller).
  statLabel: string
  // 'NIGHT' | 'GAME 2' — follows the board's scope filter.
  scopeLabel: string
  // Server-previewed priced ladder; null = loading / fetch failed / not
  // enough members. The screen owns which rung is shown (rungIndex).
  ladder: ComboLadderRung[] | null
  rungIndex: number
  onStepRung: (index: number) => void
  // The preview RPC is in flight (debounce included) — shows the calculating
  // state instead of the fetch-failed one while the ladder is still null.
  ladderLoading?: boolean
  // 2+ members picked (the compose RPC's minimum).
  minMembers: boolean
  // This exact combo is already staged — the CTA flips to remove it instead
  // (stageCombo toggles by canonical key; a blind Add would silently unstage).
  alreadyStaged: boolean
  // The chosen scope is closed for betting — Add disabled (the RPC would reject).
  blocked?: boolean
  onAdd: () => void
  onCancel: () => void
}

// The combine-mode floating bar — same footprint as the bet-slip bar (which
// hides while combining): live member tally + the priced ladder rung on the
// left (‹ › steps alt lines), Cancel/Add on the right. Presentational; the
// screen owns the combo state and the chosen rung index.
export default function BuilderBar({
  memberNames,
  statLabel,
  scopeLabel,
  ladder,
  rungIndex,
  onStepRung,
  ladderLoading,
  minMembers,
  alreadyStaged,
  blocked,
  onAdd,
  onCancel,
}: BuilderBarProps) {
  const rung = ladder && ladder.length > 0 ? ladder[Math.min(rungIndex, ladder.length - 1)] : null
  const ladderFailed = minMembers && rung == null && !ladderLoading && !blocked

  // Every pre-line state keeps the stat/scope the bettor committed to visible —
  // once a member is picked the title becomes names only, so this is the one
  // place that context lives.
  const sub = blocked
    ? 'This scope is closed for betting'
    : !minMembers
      ? `Pick 2+ players · ${statLabel} · ${scopeLabel}`
      : rung != null
        ? `OVER ${rung.line.toFixed(1)} ${statLabel} ${fmtOdds(rung.odds)} · ${scopeLabel}`
        : ladderLoading
          ? `Calculating lines… · ${statLabel} · ${scopeLabel}`
          : `Lines unavailable — tap a player to retry · ${statLabel}`

  const canPrev = rung != null && rungIndex > 0
  const canNext = rung != null && ladder != null && rungIndex < ladder.length - 1
  const showStepper = rung != null && ladder != null && ladder.length > 1 && !blocked

  return (
    <View style={styles.bar}>
      {showStepper && (
        <TouchableOpacity
          onPress={canPrev ? () => onStepRung(rungIndex - 1) : undefined}
          disabled={!canPrev}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
        >
          <Text style={[styles.stepArrow, !canPrev && styles.stepArrowDim]}>‹</Text>
        </TouchableOpacity>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {memberNames.length > 0 ? memberNames.join(' + ') : `COMBO · ${statLabel}`}
        </Text>
        <Text
          style={[styles.sub, (blocked || ladderFailed) && styles.subBlocked]}
          numberOfLines={1}
        >
          {sub}
        </Text>
      </View>
      {showStepper && (
        <TouchableOpacity
          onPress={canNext ? () => onStepRung(rungIndex + 1) : undefined}
          disabled={!canNext}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
        >
          <Text style={[styles.stepArrow, !canNext && styles.stepArrowDim]}>›</Text>
        </TouchableOpacity>
      )}
      <Button variant="ghost" label="Cancel" onPress={onCancel} style={styles.cancel} />
      <Button
        label={alreadyStaged ? 'Remove' : 'Add'}
        onPress={onAdd}
        disabled={!alreadyStaged && (!minMembers || rung == null || !!blocked)}
        style={styles.add}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Mirrors the bet-slip bar footprint exactly (it hides while this shows).
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  info: { flex: 1 },
  title: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  sub: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
    marginTop: 1,
  },
  subBlocked: { color: colors.gold },
  stepArrow: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 22,
    color: colors.accent,
    lineHeight: 24,
  },
  stepArrowDim: { opacity: 0.25 },
  cancel: { paddingHorizontal: 8, paddingVertical: 8 },
  add: { paddingHorizontal: 16, paddingVertical: 10 },
})
