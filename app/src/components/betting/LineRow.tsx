import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import { selectionButtonLabel, type LineView, type SelectionView } from '../../hooks/usePinsinoData'

// Per-selection visual state the caller computes (it owns the betting context —
// balance, slip contents, anti-tank rules). Purely cosmetic: `disabled` dims a
// button but leaves it pressable so the screen's handler can still toast (e.g.
// "believe in yourself"). Pressability is governed by `inProgress` / `onSelect`.
export interface SelectionUiState {
  selected?: boolean   // shown as picked (e.g. in the parlay slip)
  disabled?: boolean   // dimmed (low balance, anti-tank) — still pressable
}

interface LineRowProps {
  // One subject's markets (≥1) presented as a single row: the subject on the
  // left, one pick button per (line, selection) on the right — e.g. a player's
  // "142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES" set. Single-market rows
  // (moneyline) are just the one-element case.
  lines: LineView[]
  isLast: boolean
  // Whole row closed for betting: dim it and make every side inert.
  inProgress?: boolean
  // Per-selection cosmetic state; defaults to all-enabled when omitted.
  selectionState?: (line: LineView, sel: SelectionView) => SelectionUiState
  // Tapping a selection. Omit (or set `inProgress`) to render inert pills.
  onSelect?: (line: LineView, sel: SelectionView) => void
}

// Presentational, data-driven row for one betting subject. Generic over
// market_type — new line kinds render through this same component; only the
// caller's `selectionState` / `onSelect` change (mirrors BetRow's design).
// Each button carries its own (line, selection), so a row can span markets.
export default function LineRow({ lines, isLast, inProgress, selectionState, onSelect }: LineRowProps) {
  const pressable = !inProgress && !!onSelect
  const first = lines[0]
  // Player rows (overs + stat props) stack: name centered on its own row, the
  // button set evenly spaced beneath. Team moneylines keep the original
  // horizontal name-left / button-right presentation.
  const stacked = first.marketType !== 'moneyline'

  return (
    <View
      style={[
        stacked ? styles.lineRowStacked : styles.lineRow,
        !isLast && styles.lineRowBorder,
        inProgress && styles.lineRowInProgress,
      ]}
    >
      <View style={stacked ? styles.lineInfoStacked : styles.lineInfo}>
        <Text style={[styles.lineName, stacked && styles.centered]}>{first.subjectName}</Text>
        {/* Optional metadata (moneyline matchup). The bet condition itself
            lives in each pick button ("142.5+ PINS") — selectionButtonLabel. */}
        {first.subtitle != null && (
          <Text style={[styles.lineValue, stacked && styles.centered]}>{first.subtitle}</Text>
        )}
      </View>
      <View style={stacked ? styles.pickBtnsStacked : styles.pickBtns}>
        {lines.flatMap(line =>
          line.selections.map(sel => {
            const st = selectionState?.(line, sel) ?? {}
            const dim = inProgress || line.inProgress || st.disabled
            return (
              <TouchableOpacity
                key={sel.selectionId}
                style={[styles.pickBtn, st.selected && styles.pickBtnSelected, dim && styles.pickBtnDisabled]}
                onPress={pressable ? () => onSelect!(line, sel) : undefined}
                disabled={!pressable}
                activeOpacity={0.7}
              >
                <Text style={[styles.pickBtnText, st.selected && styles.pickBtnTextSelected]}>
                  {selectionButtonLabel(line, sel)}
                </Text>
              </TouchableOpacity>
            )
          })
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Horizontal layout (moneylines): name left, button(s) right.
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  // Stacked layout (player overs + props): name centered on its own row, the
  // full button set evenly spaced beneath it.
  lineRowStacked: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  lineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineRowInProgress: { opacity: 0.5 },
  lineInfo: { flex: 1 },
  lineInfoStacked: { alignItems: 'center' },
  centered: { textAlign: 'center' },
  lineName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  lineValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
    letterSpacing: 0.5,
  },
  pickBtns: { flexDirection: 'row', gap: 6 },
  // A subject's full button set; wraps when the conditions outgrow the row.
  pickBtnsStacked: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    gap: 6,
  },
  pickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  pickBtnDisabled: { borderColor: colors.border2, backgroundColor: 'transparent', opacity: 0.4 },
  pickBtnSelected: { backgroundColor: colors.accent },
  pickBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  pickBtnTextSelected: { color: colors.bg },
})
