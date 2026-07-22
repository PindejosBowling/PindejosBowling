import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '../../theme'
import LinePill from './LinePill'
import type { LineView, SelectionView } from '../../hooks/usePinsinoData'

// Per-selection visual state the caller computes (it owns the betting context —
// balance, slip contents, anti-tank rules). Purely cosmetic: `disabled` dims a
// pill but leaves it pressable so the screen's handler can still toast (e.g.
// "believe in yourself"). Pressability is governed by `inProgress` / `onSelect`.
export interface SelectionUiState {
  selected?: boolean   // shown as picked (e.g. in the parlay slip)
  disabled?: boolean   // dimmed (low balance, anti-tank) — still pressable
}

interface LineRowProps {
  // One subject's markets (≥1) presented as a single card: the subject's name
  // as a header, then ONE full-width LinePill per market — each pill gets its
  // own horizontal row so the inline value selector has the whole width.
  lines: LineView[]
  // Vestigial since the spaced-row restyle (rows carry their own margins, no
  // dividers) — kept so callers don't churn.
  isLast: boolean
  // The viewer's relationship to the subject ('with' = teammate this week,
  // 'against' = matchup opponent) — a subtle background tint, nothing more.
  relation?: 'with' | 'against' | null
  // Whole row closed for betting: dim it and make every pill inert.
  inProgress?: boolean
  // Per-selection cosmetic state; defaults to all-enabled when omitted.
  selectionState?: (line: LineView, sel: SelectionView) => SelectionUiState
  // Tapping a pill body / value option stages that selection. Omit (or set
  // `inProgress`) to render inert pills.
  onSelect?: (line: LineView, sel: SelectionView) => void
  // Armed combine mode repurposes taps to seed a combo — hide the in-pill
  // value expander while it's on.
  expandable?: boolean
}

// Presentational, data-driven card for one betting subject. Generic over
// market_type — new line kinds render through this same component; only the
// caller's `selectionState` / `onSelect` change (mirrors BetRow's design).
// Each LinePill owns its market's inline value selection (bet on the outcome
// you want; the odds derive from the selection).
export default function LineRow({ lines, relation, inProgress, selectionState, onSelect, expandable }: LineRowProps) {
  const pressable = !inProgress && !!onSelect
  const first = lines[0]

  return (
    <View
      style={[
        styles.card,
        relation === 'with' && styles.cardWith,
        relation === 'against' && styles.cardAgainst,
        inProgress && styles.cardInProgress,
      ]}
    >
      {/* The subject's name (full form — the row header is one of the two
          full-name surfaces); each condition lives in its own pill below. */}
      <Text style={styles.lineName}>{first.subjectFullName}</Text>
      {first.subtitle != null && <Text style={styles.lineValue}>{first.subtitle}</Text>}
      <View style={styles.pills}>
        {lines.map(line => (
          <LinePill
            key={line.marketId}
            line={line}
            selectionState={selectionState}
            onSelect={onSelect}
            inert={!pressable || line.inProgress}
            expandable={expandable}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // One subject = one spaced tinted card: centered name header, then a column
  // of full-width pills (one market per row).
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
  lineValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  pills: { marginTop: 8, gap: 8 },
})
