import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import Button from '../ui/Button'
import { fmtOdds } from '../../utils/bets'

interface BuilderBarProps {
  // Ordered display names of the members picked so far.
  memberNames: string[]
  // 'STRIKES', 'TOTAL PINS', … (STAT_LABELS, uppercased by the caller).
  statLabel: string
  // 'NIGHT' | 'GAME 2' — follows the board's scope filter.
  scopeLabel: string
  // The RESOLVED display value + its price, both owned by the screen (the one
  // place the quote is interpreted — the bar never re-derives them). The value
  // EDITOR itself lives above the member list (the screen's combo value card);
  // the bar only needs the pair to gate Add on a live price.
  value: number | null
  odds: number | null
  // No quote is held at all (fetch failed / not yet fetched) — distinguishes
  // the retry state from a quote that simply doesn't price this value.
  noQuote?: boolean
  // The preview RPC is in flight (debounce included) — shows the calculating
  // state instead of the fetch-failed one while the quote is still null.
  quoteLoading?: boolean
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
// hides while combining): live member tally on top; below it the combo's
// value (tap to retype it in the LineEntrySheet, same as a board pill) with
// the live price beside it. Presentational; the screen owns the combo state,
// the edited value, and the debounced quote.
export default function BuilderBar({
  memberNames,
  statLabel,
  scopeLabel,
  value,
  odds,
  noQuote,
  quoteLoading,
  minMembers,
  alreadyStaged,
  blocked,
  onAdd,
  onCancel,
}: BuilderBarProps) {
  const quoteFailed = minMembers && !!noQuote && !quoteLoading && !blocked

  const sub = blocked
    ? 'This scope is closed for betting'
    : !minMembers
      ? `Pick 2+ players · ${statLabel} · ${scopeLabel}`
      : quoteFailed
        ? `Lines unavailable — tap a player to retry · ${statLabel}`
        : `${statLabel} · ${scopeLabel}`

  return (
    <View style={styles.bar}>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {memberNames.length > 0 ? memberNames.join(' + ') : `COMBO · ${statLabel}`}
        </Text>
        <Text
          style={[styles.sub, (blocked || quoteFailed) && styles.subBlocked]}
          numberOfLines={1}
        >
          {sub}
        </Text>
        {/* The value display moved above the member list (the screen's combo
            value card) — the bar shows the staged price beside the tally so
            the Add CTA reads against a number. */}
        {!blocked && minMembers && value != null && (
          <Text style={styles.priceLine}>
            {value.toFixed(1)}+ · {quoteLoading ? '…' : odds != null ? fmtOdds(odds) : '—'}
          </Text>
        )}
      </View>
      <Button variant="ghost" label="Cancel" onPress={onCancel} style={styles.cancel} />
      <Button
        label={alreadyStaged ? 'Remove' : 'Add'}
        onPress={onAdd}
        disabled={!alreadyStaged && (!minMembers || odds == null || !!blocked || !!quoteLoading)}
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
  priceLine: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
  },
  cancel: { paddingHorizontal: 8, paddingVertical: 8 },
  add: { paddingHorizontal: 16, paddingVertical: 10 },
})
