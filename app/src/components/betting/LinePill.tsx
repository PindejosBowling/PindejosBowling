import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { colors, fonts, radius, type } from '../../theme'
import { fmtOdds } from '../../utils/bets'
import {
  selectionButtonLabel,
  type LineView,
  type SelectionView,
} from '../../hooks/usePinsinoData'
import type { SelectionUiState } from './LineRow'

interface LinePillProps {
  // One market. Laddered markets (multiple priced over rungs) get the inline
  // value selector; single-selection markets render a plain pill.
  line: LineView
  // Per-selection cosmetic state (staged/disabled) — same contract as LineRow.
  selectionState?: (line: LineView, sel: SelectionView) => SelectionUiState
  // Tapping the pill body (or a value option) stages/toggles that selection.
  onSelect?: (line: LineView, sel: SelectionView) => void
  // Market/scope closed — fully inert.
  inert?: boolean
  // Hide the value expander (armed combine mode repurposes taps to seed).
  expandable?: boolean
}

// A full-width board pill — one market per row. Left: the offered condition
// ("4.5+ STRIKES"); right: its payout and, on laddered markets, a ▾ toggle
// that expands the pill's own value selector: every posted value with its
// payout, horizontally scrollable. Picking a value stages that outcome —
// the odds simply follow the selection. Tapping the pill body stages/unstages
// the displayed value.
export default function LinePill({ line, selectionState, onSelect, inert, expandable = true }: LinePillProps) {
  const [expanded, setExpanded] = useState(false)
  // Which value the pill shows when nothing is staged (last browsed, else seed).
  const [localIdx, setLocalIdx] = useState<number | null>(null)

  const sels = line.selections // sorted by line ascending (mint order)
  const isLadder = sels.length > 1 && sels.every(s => s.side === 'over')
  const seedIdx = Math.max(0, isLadder ? sels.findIndex(s => s.key === 'over') : 0)
  const stagedIdx = sels.findIndex(s => (selectionState?.(line, s) ?? {}).selected)
  const idx = stagedIdx >= 0 ? stagedIdx : Math.min(localIdx ?? seedIdx, sels.length - 1)
  const sel = sels[idx]
  const st = selectionState?.(line, sel) ?? {}
  const pressable = !inert && !!onSelect
  const canExpand = pressable && isLadder && expandable

  // Split label: condition on the left, payout on the right.
  const condition = selectionButtonLabel(line, sel).replace(` ${fmtOdds(sel.odds)}`, '')

  return (
    <View
      style={[
        styles.pill,
        st.selected && styles.pillSelected,
        (inert || st.disabled) && styles.pillDisabled,
      ]}
    >
      <View style={styles.mainRow}>
        <TouchableOpacity
          style={styles.body}
          onPress={pressable ? () => onSelect!(line, sel) : undefined}
          disabled={!pressable}
          activeOpacity={0.7}
        >
          <Text style={[styles.condition, st.selected && styles.textSelected]}>{condition}</Text>
          <Text style={[styles.odds, st.selected && styles.textSelected]}>{fmtOdds(sel.odds)}</Text>
        </TouchableOpacity>
        {canExpand && (
          <TouchableOpacity
            onPress={() => setExpanded(e => !e)}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            style={styles.expander}
            activeOpacity={0.6}
          >
            <Text style={[styles.expanderText, st.selected && styles.textSelected]}>
              {expanded ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {canExpand && expanded && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.valueRow}
        >
          {sels.map((s, i) => {
            const vst = selectionState?.(line, s) ?? {}
            const shown = i === idx
            return (
              <TouchableOpacity
                key={s.selectionId}
                style={[
                  styles.valueChip,
                  shown && (st.selected ? styles.valueChipShownOnFill : styles.valueChipShown),
                  vst.disabled && styles.valueChipDisabled,
                ]}
                onPress={() => {
                  setLocalIdx(i)
                  onSelect!(line, s)
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.valueLine,
                    shown && (st.selected ? styles.valueTextShownOnFill : styles.valueTextShown),
                  ]}
                >
                  {(s.line ?? 0).toFixed(1)}+
                </Text>
                <Text
                  style={[
                    styles.valueOdds,
                    shown && (st.selected ? styles.valueTextShownOnFill : styles.valueTextShown),
                  ]}
                >
                  {fmtOdds(s.odds)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
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
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  condition: { flex: 1, ...type.chip, color: 'rgba(240,240,240,0.85)' },
  odds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
  },
  expander: { paddingHorizontal: 2 },
  expanderText: { fontSize: 13, color: colors.accent },
  textSelected: { color: colors.bg },
  // The inline value selector: small line+payout cells in a horizontal strip.
  valueRow: { gap: 6, paddingTop: 10 },
  valueChip: {
    minWidth: 58,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceTint,
  },
  valueChipShown: { backgroundColor: colors.accent, borderColor: colors.accent },
  // Contrast flip when the whole pill is staged (accent fill).
  valueChipShownOnFill: { backgroundColor: colors.bg, borderColor: colors.bg },
  valueChipDisabled: { opacity: 0.4 },
  valueLine: { ...type.chip, color: colors.text },
  valueOdds: { ...type.label, color: colors.muted, marginTop: 1 },
  valueTextShown: { color: colors.bg },
  valueTextShownOnFill: { color: colors.accent },
})
