import { type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius, spacing } from '../../theme'
import type { LineView } from '../../hooks/usePinsinoData'

interface LineRowProps {
  // One subject's markets (≥1) presented as a single card: the subject's name
  // as a header, then ONE full-width LinePill per market — each pill gets its
  // own horizontal row so the value editor has the whole width.
  lines: LineView[]
  // The viewer's relationship to the subject ('with' = teammate this week,
  // 'against' = matchup opponent) — a subtle background tint, nothing more.
  relation?: 'with' | 'against' | null
  // Whole row closed for betting: dim it (pills are made inert by the caller's
  // renderPill).
  inProgress?: boolean
  // The screen renders each pill: value-first pills need screen-owned state
  // (the edited value, the live quote, staged status), so the card is just the
  // subject shell around them.
  renderPill: (line: LineView) => ReactNode
}

// Presentational card for one betting subject. Generic over market_type — new
// line kinds render through this same component; only the caller's renderPill
// changes (mirrors BetRow's design).
export default function LineRow({ lines, relation, inProgress, renderPill }: LineRowProps) {
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
      <View style={styles.pills}>
        {lines.map(line => (
          <View key={line.marketId}>{renderPill(line)}</View>
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
  pills: { marginTop: 8, gap: 8 },
})
