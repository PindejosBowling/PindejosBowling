import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import Button from '../ui/Button'
import { fmtOdds } from '../../utils/bets'
import type { LineQuote } from '../../hooks/useLinePreview'

interface BuilderBarProps {
  // Ordered display names of the members picked so far.
  memberNames: string[]
  // 'STRIKES', 'TOTAL PINS', … (STAT_LABELS, uppercased by the caller).
  statLabel: string
  // 'NIGHT' | 'GAME 2' — follows the board's scope filter.
  scopeLabel: string
  // The displayed line value (screen-owned; seeds from the quote's seed_line).
  value: number | null
  // Tapping the value opens the LineEntrySheet for this combo.
  onEditValue: () => void
  // The live quote for `value` (combo_price_line) — odds, band, seed anchor.
  quote: LineQuote | null
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
  onEditValue,
  quote,
  quoteLoading,
  minMembers,
  alreadyStaged,
  blocked,
  onAdd,
  onCancel,
}: BuilderBarProps) {
  const shownValue = value ?? quote?.seedLine ?? null
  const odds = quote != null && shownValue != null && quote.line === shownValue ? quote.odds : null
  const quoteFailed = minMembers && quote == null && !quoteLoading && !blocked

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
        {/* The value — same interaction as a board pill: tap the number to
            retype it in the sheet; the price follows the value. */}
        {!blocked && minMembers && shownValue != null && (
          <View style={styles.valueRow}>
            {/* Same field affordance as the board pills: bordered chip +
                edit glyph = "tap to type your own number". */}
            <TouchableOpacity onPress={onEditValue} activeOpacity={0.7} style={styles.valueField}>
              <Text style={styles.value}>{shownValue.toFixed(1)}+</Text>
              <Text style={styles.editGlyph}>✎</Text>
            </TouchableOpacity>
            <Text style={styles.odds}>
              {quoteLoading ? '…' : odds != null ? fmtOdds(odds) : '—'}
            </Text>
          </View>
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
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
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
  value: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.text,
  },
  editGlyph: { fontSize: 11, color: colors.accent },
  odds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
  },
  cancel: { paddingHorizontal: 8, paddingVertical: 8 },
  add: { paddingHorizontal: 16, paddingVertical: 10 },
})
