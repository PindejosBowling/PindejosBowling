import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
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
  // The viewer's relationship to the subject ('with' = teammate this week,
  // 'against' = matchup opponent) — a subtle background tint, nothing more.
  relation?: 'with' | 'against' | null
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
export default function LineRow({ lines, isLast, relation, inProgress, selectionState, onSelect }: LineRowProps) {
  const pressable = !inProgress && !!onSelect
  const first = lines[0]
  // Multi-button rows (player overs + stat props, team rows spanning WIN + the
  // team stat lines) stack: name centered on its own row, the button set
  // wrapping evenly beneath. Only a lone-button row (a bare moneyline WIN)
  // keeps the horizontal name-left / button-right presentation — a row of one
  // never needs to wrap.
  const buttonCount = lines.reduce((n, l) => n + l.selections.length, 0)
  const stacked = first.marketType !== 'moneyline' || buttonCount > 1

  return (
    <View
      style={[
        stacked ? styles.lineRowStacked : styles.lineRow,
        relation === 'with' && styles.lineRowWith,
        relation === 'against' && styles.lineRowAgainst,
        !isLast && styles.lineRowBorder,
        inProgress && styles.lineRowInProgress,
      ]}
    >
      <View style={stacked ? styles.lineInfoStacked : styles.lineInfo}>
        {/* Just the subject's name — the bet condition itself lives in each pick
            button ("142.5+ PINS") — selectionButtonLabel. */}
        <Text style={styles.lineName}>{first.subjectName}</Text>
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
  // Subtle with/against tints — teammates green-cast, matchup opponents
  // red-cast, everyone else on the plain surface (minimal clutter).
  lineRowWith: { backgroundColor: 'rgba(74,222,128,0.05)' },
  lineRowAgainst: { backgroundColor: 'rgba(239,68,68,0.05)' },
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
  pickBtns: { flexDirection: 'row', gap: 8 },
  // A subject's full button set; wraps when the conditions outgrow the row.
  pickBtnsStacked: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  // Fuller "odds cell": a filled surface tile — a clearer, larger tap target
  // than the old thin pill. Quietly neutral at rest (soft white-alpha border +
  // faint fill, so it reads as tappable without glare); staged picks flip to a
  // solid accent fill so the slip contents read at a glance.
  pickBtn: {
    minWidth: 78,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  pickBtnDisabled: { borderColor: colors.border2, backgroundColor: 'transparent', opacity: 0.4 },
  pickBtnSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pickBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: 'rgba(240,240,240,0.85)',
    letterSpacing: 0.5,
  },
  pickBtnTextSelected: { color: colors.bg },
})
