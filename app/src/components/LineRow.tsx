import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import type { LineView, SelectionView } from '../hooks/usePinsinoData'

// Per-selection visual state the caller computes (it owns the betting context —
// balance, slip contents, anti-tank rules). Purely cosmetic: `disabled` dims a
// button but leaves it pressable so the screen's handler can still toast (e.g.
// "believe in yourself"). Pressability is governed by `inProgress` / `onSelect`.
export interface SelectionUiState {
  selected?: boolean   // shown as picked (e.g. in the parlay slip)
  disabled?: boolean   // dimmed (low balance, anti-tank) — still pressable
}

interface LineRowProps {
  line: LineView
  isLast: boolean
  // Whole market closed for betting: dim the row and make every side inert.
  inProgress?: boolean
  // Per-selection cosmetic state; defaults to all-enabled when omitted.
  selectionState?: (sel: SelectionView) => SelectionUiState
  // Tapping a selection. Omit (or set `inProgress`) to render inert pills.
  onSelect?: (sel: SelectionView) => void
}

// Presentational, data-driven row for one bettable market: the subject/line on
// the left and one pick button per `bet_selections` side on the right. Generic
// over market_type — new line kinds render through this same component; only the
// caller's `selectionState` / `onSelect` change (mirrors BetRow's design).
export default function LineRow({ line, isLast, inProgress, selectionState, onSelect }: LineRowProps) {
  const pressable = !inProgress && !!onSelect

  return (
    <View
      style={[styles.lineRow, !isLast && styles.lineRowBorder, inProgress && styles.lineRowInProgress]}
    >
      <View style={styles.lineInfo}>
        <Text style={styles.lineName}>{line.subjectName}</Text>
        {line.line != null && (
          <Text style={styles.lineValue}>LINE  {line.line.toFixed(1)}</Text>
        )}
      </View>
      <View style={styles.pickBtns}>
        {line.selections.map(sel => {
          const st = selectionState?.(sel) ?? {}
          const dim = inProgress || st.disabled
          return (
            <TouchableOpacity
              key={sel.selectionId}
              style={[styles.pickBtn, st.selected && styles.pickBtnSelected, dim && styles.pickBtnDisabled]}
              onPress={pressable ? () => onSelect!(sel) : undefined}
              disabled={!pressable}
              activeOpacity={0.7}
            >
              <Text style={[styles.pickBtnText, st.selected && styles.pickBtnTextSelected]}>
                {(sel.label || sel.key).toUpperCase()}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  lineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineRowInProgress: { opacity: 0.5 },
  lineInfo: { flex: 1 },
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
