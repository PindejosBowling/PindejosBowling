import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { LeaderboardEntry } from '../../hooks/usePinsinoData'
import EmptyCard from '../ui/EmptyCard'
import { formatPins, signed } from '../../utils/formatting'

type Props = {
  leaderboard: LeaderboardEntry[]
  playerId: string | null
  onRowPress: (playerId: string, name: string) => void
  /** Optional cap on the number of rows rendered (e.g. Top 3). Omit for the full list. */
  limit?: number
  /**
   * `summary` shows only name + net (compact landing-page preview).
   * `detail` shows the full pins/open-action/debt/net breakdown. Defaults to `detail`.
   */
  mode?: 'summary' | 'detail'
}

// One label-over-value stat tile in the expanded breakdown. Rendered in a
// wrapping row so 2–4 tiles reflow onto a second line instead of overflowing.
function Metric({ label, value, tone }: { label: string; value: string; tone: 'pos' | 'neg' }) {
  return (
    <View style={styles.sbMetric}>
      <Text style={styles.sbMetricLabel}>{label}</Text>
      <Text style={[styles.sbMetricValue, tone === 'neg' ? styles.sbBreakNeg : styles.sbBreakPos]}>
        {value}
      </Text>
    </View>
  )
}

export default function PinsinoLeaderboardTable({
  leaderboard,
  playerId,
  onRowPress,
  limit,
  mode = 'detail',
}: Props) {
  if (leaderboard.length === 0) {
    return (
      <EmptyCard text="No pin balances yet" />
    )
  }

  const [expanded, setExpanded] = useState(false)

  const rows = limit ? leaderboard.slice(0, limit) : leaderboard
  const isSummary = mode === 'summary'
  const showCols = !isSummary && expanded
  const showTicketKey = rows.some(p => p.openBetCount > 0)

  return (
    <View style={styles.sbCard}>
      <View style={styles.sbHeaderRow}>
        <Text style={[styles.sbHeaderCell, styles.sbRankCell]}>#</Text>
        <View style={styles.sbMoveCell} />
        <Text style={[styles.sbHeaderCell, styles.sbNameCell]}>Player</Text>
        {isSummary ? (
          <Text style={[styles.sbHeaderCell, styles.sbNetSummaryCell]}>Net Worth</Text>
        ) : (
          <TouchableOpacity
            style={styles.sbNetToggle}
            onPress={() => setExpanded(o => !o)}
            activeOpacity={0.7}
          >
            <Text style={styles.sbHeaderCell}>Net Worth</Text>
            <Text style={styles.sbNetChevron}>{expanded ? '▾' : '▸'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {rows.map((p, index) => {
        const isMe = p.playerId === playerId
        return (
          <TouchableOpacity
            key={p.playerId}
            style={[styles.sbRow, index < rows.length - 1 && styles.sbRowBorder]}
            onPress={() => onRowPress(p.playerId, p.name)}
            activeOpacity={0.7}
          >
            <View style={[styles.sbIconBox, index < 3 && styles.sbIconBoxTop]}>
              <Text style={[styles.sbRankText, index < 3 && styles.sbRankTextTop]}>{index + 1}</Text>
            </View>
            <View style={styles.sbMoveBox}>
              {p.movement === 'up' && <Text style={styles.moveUp}>▲</Text>}
              {p.movement === 'down' && <Text style={styles.moveDown}>▼</Text>}
            </View>
            <View style={styles.sbNameCol}>
              <Text style={[styles.sbName, isMe && styles.sbNameMe]} numberOfLines={1}>
                {p.name}
              </Text>
              {p.openBetCount > 0 && (
                <Text style={styles.sbTickets}>{'🎟️'.repeat(p.openBetCount)}</Text>
              )}
              {showCols && (
                <View style={styles.sbBreakRow}>
                  <Metric label="Pincome" value={signed(p.pincome)} tone={p.pincome < 0 ? 'neg' : 'pos'} />
                  <Metric label="Gaming" value={signed(p.gaming)} tone={p.gaming < 0 ? 'neg' : 'pos'} />
                  {p.loanProceeds !== 0 && (
                    <Metric label="Borrowed" value={signed(p.loanProceeds)} tone={p.loanProceeds < 0 ? 'neg' : 'pos'} />
                  )}
                  {p.debt > 0 && (
                    <Metric label="Debt" value={`−${formatPins(p.debt)}`} tone="neg" />
                  )}
                </View>
              )}
            </View>
            <Text
              style={[
                styles.sbNet,
                isSummary && styles.sbNetSummaryCell,
                p.netWorth < 0 && styles.sbNetNegative,
              ]}
            >
              {formatPins(p.netWorth)}<Text style={styles.sbUnit}> pins</Text>
            </Text>
          </TouchableOpacity>
        )
      })}
      {showTicketKey && (
        <View style={styles.sbKeyRow}>
          <Text style={styles.sbKeyText}>🎟️ = bet placed</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // Pin-balance scoreboard (mirrors StandingsScreen)
  sbCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  sbHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sbHeaderCell: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  sbRankCell: { width: 32 },
  sbMoveCell: { width: 16, marginRight: 6 },
  sbNameCell: { flex: 1 },
  sbNetToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  sbNetChevron: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginLeft: 4,
  },
  // Wider net column for the summary view so "Current Networth" fits unclipped.
  sbNetSummaryCell: { width: 130, textAlign: 'right' },
  sbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sbRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  sbIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  sbIconBoxTop: { backgroundColor: colors.accentDim },
  sbRankText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted },
  sbRankTextTop: { color: colors.accent },
  sbMoveBox: { width: 16, marginRight: 6, alignItems: 'center', justifyContent: 'center' },
  sbNameCol: { flex: 1, marginRight: 10, gap: 2 },
  sbName: { fontFamily: fonts.barlow, fontSize: 15, color: colors.text },
  // Open-bet tracker: one 🎟️ per pending sportsbook bet, deliberately uncapped —
  // the strip wraps within the name column so heavy bettors' rows visibly pile up.
  sbTickets: { fontSize: 11, marginTop: 1 },
  // Legend footer for the 🎟️ tracker — only rendered while any visible row
  // actually shows tickets, so the card stays clean when nothing is pending.
  sbKeyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
  sbKeyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.muted,
  },
  sbNameMe: { color: colors.accent },
  // Expanded breakdown — Pincome / Gaming / Loan Proceeds / Debt as label-over-value
  // stat tiles in a wrapping row, so they reflow to a second line rather than
  // overflowing the row. These reconcile to Net Worth (see usePinsinoData).
  sbBreakRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 18,
    rowGap: 6,
    marginTop: 4,
  },
  sbMetric: {},
  sbMetricLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  sbMetricValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    marginTop: 1,
  },
  sbBreakPos: { color: colors.success },
  sbBreakNeg: { color: colors.danger },
  sbNet: {
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  sbNetNegative: { color: colors.danger },
  // Trailing "pins" unit — muted + smaller, mirroring the balance card's PINS unit.
  sbUnit: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  moveUp: { fontSize: 11, color: colors.success },
  moveDown: { fontSize: 11, color: colors.danger },
})
