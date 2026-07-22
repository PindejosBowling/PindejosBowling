import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import Button from '../ui/Button'

interface BuilderBarProps {
  // Ordered display names of the members picked so far.
  memberNames: string[]
  // 'STRIKES', 'TOTAL PINS', … (STAT_LABELS, uppercased by the caller).
  statLabel: string
  // 'NIGHT' | 'GAME 2' — follows the board's scope filter.
  scopeLabel: string
  // Server-previewed line; null = loading / fetch failed / not enough members.
  line: number | null
  // The preview RPC is in flight (debounce included) — shows the calculating
  // state instead of the fetch-failed one while line is still null.
  lineLoading?: boolean
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
// hides while combining): live member tally + previewed line on the left,
// Cancel/Add on the right. Presentational; the screen owns the combo state.
export default function BuilderBar({
  memberNames,
  statLabel,
  scopeLabel,
  line,
  lineLoading,
  minMembers,
  alreadyStaged,
  blocked,
  onAdd,
  onCancel,
}: BuilderBarProps) {
  // Every pre-line state keeps the stat/scope the bettor committed to visible —
  // once a member is picked the title becomes names only, so this is the one
  // place that context lives.
  const lineFailed = minMembers && line == null && !lineLoading && !blocked
  const sub = blocked
    ? 'This scope is closed for betting'
    : !minMembers
      ? `Pick 2+ players · ${statLabel} · ${scopeLabel}`
      : line != null
        ? `OVER ${line.toFixed(1)} ${statLabel} · ${scopeLabel}`
        : lineLoading
          ? `Calculating line… · ${statLabel} · ${scopeLabel}`
          : `Line unavailable — tap a player to retry · ${statLabel}`
  return (
    <View style={styles.bar}>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {memberNames.length > 0 ? memberNames.join(' + ') : `COMBO · ${statLabel}`}
        </Text>
        <Text style={[styles.sub, (blocked || lineFailed) && styles.subBlocked]} numberOfLines={1}>{sub}</Text>
      </View>
      <Button variant="ghost" label="Cancel" onPress={onCancel} style={styles.cancel} />
      <Button
        label={alreadyStaged ? 'Remove' : 'Add'}
        onPress={onAdd}
        disabled={!alreadyStaged && (!minMembers || line == null || !!blocked)}
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
  cancel: { paddingHorizontal: 8, paddingVertical: 8 },
  add: { paddingHorizontal: 16, paddingVertical: 10 },
})
