import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import { LeaderboardEntry } from '../../hooks/usePinsinoData'

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

export default function PinsinoLeaderboardTable({
  leaderboard,
  playerId,
  onRowPress,
  limit,
  mode = 'detail',
}: Props) {
  if (leaderboard.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>No pin balances yet</Text>
      </View>
    )
  }

  const rows = limit ? leaderboard.slice(0, limit) : leaderboard
  const isSummary = mode === 'summary'

  return (
    <View style={styles.sbCard}>
      <View style={styles.sbHeaderRow}>
        <Text style={[styles.sbHeaderCell, styles.sbRankCell]}>#</Text>
        <Text style={[styles.sbHeaderCell, styles.sbNameCell]}>Titan</Text>
        {!isSummary && (
          <>
            <Text style={[styles.sbHeaderCell, styles.sbBalCell]}>Pins</Text>
            <Text style={[styles.sbHeaderCell, styles.sbWagerCell]}>Open</Text>
            <Text style={[styles.sbHeaderCell, styles.sbDebtCell]}>Debt</Text>
          </>
        )}
        <Text style={[styles.sbHeaderCell, isSummary ? styles.sbNetSummaryCell : styles.sbNetCell]}>
          {isSummary ? 'Current Net Worth' : 'Net'}
        </Text>
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
            <Text style={[styles.sbName, isMe && styles.sbNameMe]} numberOfLines={1}>
              {p.name}
              {p.movement === 'up' && <Text style={styles.moveUp}> ▲</Text>}
              {p.movement === 'down' && <Text style={styles.moveDown}> ▼</Text>}
            </Text>
            {!isSummary && (
              <>
                <Text style={styles.sbBalance}>{p.balance.toLocaleString()}</Text>
                <Text style={styles.sbWager}>{p.openAction > 0 ? p.openAction.toLocaleString() : ''}</Text>
                <Text style={styles.sbDebt}>{p.debt > 0 ? `−${p.debt.toLocaleString()}` : ''}</Text>
              </>
            )}
            <Text
              style={[
                styles.sbNet,
                isSummary && styles.sbNetSummaryCell,
                p.netWorth < 0 && styles.sbNetNegative,
              ]}
            >
              {p.netWorth.toLocaleString()}
            </Text>
          </TouchableOpacity>
        )
      })}
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
  sbNameCell: { flex: 1 },
  sbBalCell: { width: 56, textAlign: 'right' },
  sbWagerCell: { width: 56, textAlign: 'right' },
  sbDebtCell: { width: 56, textAlign: 'right' },
  sbNetCell: { width: 56, textAlign: 'right' },
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
  sbName: { flex: 1, fontFamily: fonts.barlow, fontSize: 15, color: colors.text },
  sbNameMe: { color: colors.accent },
  sbBalance: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  sbDebt: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.danger,
  },
  sbNet: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  sbNetNegative: { color: colors.danger },
  sbWager: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  moveUp: { fontSize: 11, color: colors.success },
  moveDown: { fontSize: 11, color: colors.danger },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },
})
