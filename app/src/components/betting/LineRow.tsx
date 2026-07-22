import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '../../theme'
import PickChip from './PickChip'
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
  // left, one pick chip per (line, selection) on the right — e.g. a player's
  // "142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES" set. Single-market rows
  // (moneyline) are just the one-element case.
  lines: LineView[]
  // Vestigial since the spaced-row restyle (rows carry their own margins, no
  // dividers) — kept so callers don't churn.
  isLast: boolean
  // The viewer's relationship to the subject ('with' = teammate this week,
  // 'against' = matchup opponent) — a subtle background tint, nothing more.
  relation?: 'with' | 'against' | null
  // Whole row closed for betting: dim it and make every side inert.
  inProgress?: boolean
  // Per-selection cosmetic state; defaults to all-enabled when omitted.
  selectionState?: (line: LineView, sel: SelectionView) => SelectionUiState
  // Tapping a selection. Omit (or set `inProgress`) to render inert chips.
  onSelect?: (line: LineView, sel: SelectionView) => void
  // Tapping a LADDERED market's chip (many priced rungs): opens the caller's
  // value sheet instead of staging directly. Omitted → ladder chips fall back
  // to staging their displayed rung (armed-combine mode passes onSelect only).
  onOpenLadder?: (line: LineView) => void
}

// Presentational, data-driven row for one betting subject. Generic over
// market_type — new line kinds render through this same component; only the
// caller's `selectionState` / `onSelect` change (mirrors BetRow's design).
// Each chip carries its own (line, selection), so a row can span markets.
export default function LineRow({ lines, relation, inProgress, selectionState, onSelect, onOpenLadder }: LineRowProps) {
  const pressable = !inProgress && !!onSelect
  const first = lines[0]
  // A laddered market (many priced over rungs after under-hiding) renders as
  // ONE chip — the staged rung when one is in the slip, else the seed rung —
  // and tapping it opens the value sheet (onOpenLadder) so the bettor picks
  // the outcome they want; the odds derive from that pick.
  const isLadder = (l: LineView) =>
    l.selections.length > 1 && l.selections.every(s => s.side === 'over')

  // Multi-chip rows (player overs + stat props) stack: name centered on its
  // own row, the chip set wrapping evenly beneath. Only a lone-chip row (a
  // bare moneyline WIN) keeps the horizontal name-left / chip-right
  // presentation — a row of one never needs to wrap. Ladders count as one
  // chip (the value sheet browses rungs).
  const chipCount = lines.reduce((n, l) => n + (isLadder(l) ? 1 : l.selections.length), 0)
  const stacked = first.marketType !== 'moneyline' || chipCount > 1

  return (
    <View
      style={[
        stacked ? styles.lineRowStacked : styles.lineRow,
        relation === 'with' && styles.lineRowWith,
        relation === 'against' && styles.lineRowAgainst,
        inProgress && styles.lineRowInProgress,
      ]}
    >
      <View style={stacked ? styles.lineInfoStacked : styles.lineInfo}>
        {/* Just the subject's name (full form — the row header is one of the two
            full-name surfaces) — the bet condition itself lives in each pick
            chip ("142.5+ PINS") — selectionButtonLabel. */}
        <Text style={styles.lineName}>{first.subjectFullName}</Text>
        {first.subtitle != null && (
          <Text style={[styles.lineValue, stacked && styles.centered]}>{first.subtitle}</Text>
        )}
      </View>
      <View style={stacked ? styles.pickBtnsStacked : styles.pickBtns}>
        {lines.flatMap(line => {
          if (!isLadder(line)) {
            return line.selections.map(sel => {
              const st = selectionState?.(line, sel) ?? {}
              return (
                <PickChip
                  key={sel.selectionId}
                  label={selectionButtonLabel(line, sel)}
                  grid={stacked}
                  selected={st.selected}
                  disabled={line.inProgress || st.disabled}
                  inert={!pressable}
                  onPress={pressable ? () => onSelect!(line, sel) : undefined}
                />
              )
            })
          }
          // Ladder: one chip showing the staged rung (else the seed rung);
          // tapping opens the value sheet. The ▾ marks the chip as a range.
          const sels = line.selections // sorted by sort_order = line ascending
          const seedIdx = Math.max(0, sels.findIndex(s => s.key === 'over'))
          const stagedIdx = sels.findIndex(s => (selectionState?.(line, s) ?? {}).selected)
          const sel = sels[stagedIdx >= 0 ? stagedIdx : seedIdx]
          const st = selectionState?.(line, sel) ?? {}
          const openSheet = onOpenLadder != null && !line.inProgress
          return [
            <PickChip
              key={line.marketId}
              label={`${selectionButtonLabel(line, sel)} ▾`}
              grid={stacked}
              selected={st.selected}
              disabled={line.inProgress || st.disabled}
              inert={!pressable}
              onPress={
                !pressable ? undefined
                  : openSheet ? () => onOpenLadder(line)
                    : () => onSelect!(line, sel)
              }
            />,
          ]
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Horizontal layout (moneylines): name left, chip(s) right. Rows are spaced
  // tinted cards (own rounding + margin) rather than hairline-divided slices.
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surfaceTint,
    marginBottom: spacing.sm,
  },
  // Stacked layout (player overs + props): name centered on its own row, the
  // full chip set evenly spaced beneath it.
  lineRowStacked: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surfaceTint,
    marginBottom: spacing.sm,
  },
  lineRowInProgress: { opacity: 0.5 },
  // Subtle with/against tints — teammates green-cast, matchup opponents
  // red-cast, everyone else on the plain tinted row (minimal clutter).
  lineRowWith: { backgroundColor: colors.successTint },
  lineRowAgainst: { backgroundColor: colors.dangerTint },
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
  // A subject's full chip set; wraps when the conditions outgrow the row.
  pickBtnsStacked: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
})
