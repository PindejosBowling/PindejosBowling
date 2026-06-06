import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../theme'
import type { LedgerEntry } from '../hooks/usePlayerBettingDetailData'
import BetDetailModal from './BetDetailModal'

interface LedgerRowProps {
  entry: LedgerEntry
  perspective: 'player' | 'house'
  isLast: boolean
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Short, plain-language label for what moved the balance, from the viewer's side.
function actionLabel(type: string, perspective: 'player' | 'house'): string {
  switch (type) {
    case 'bet_stake':
      return perspective === 'house' ? 'BET TAKEN' : 'BET PLACED'
    case 'bet_payout':
      return perspective === 'house' ? 'WINNING PAYOUT' : 'WINNING PAYOUT'
    case 'bet_refund':
      return 'PUSH · REFUND'
    case 'score_credit':
      return 'GAME SCORE'
    case 'bonus':
      return 'BONUS'
    default:
      return type.replace(/_/g, ' ').toUpperCase()
  }
}

export default function LedgerRow({ entry, perspective, isLast }: LedgerRowProps) {
  const { bet } = entry
  const [detailOpen, setDetailOpen] = useState(false)
  const isPositive = entry.amount > 0
  const amountColor =
    entry.type === 'bonus' ? colors.gold : isPositive ? colors.success : colors.danger

  // Meta line: the action, plus the bettor on the house side (whose bet moved us).
  const metaParts = [actionLabel(entry.type, perspective)]
  if (perspective === 'house' && bet) metaParts.push(bet.bettorName)
  const meta = metaParts.join(' · ')

  const content = (
    <>
      <View style={styles.info}>
        {bet ? (
          bet.legCount > 1 ? (
            bet.legs.map((leg, i) => (
              <Text key={i} style={styles.primary}>
                {leg.subjectName} · {leg.pick?.toUpperCase()} {leg.line.toFixed(1)}
                {leg.gameNumber != null ? ` (G${leg.gameNumber})` : ''}
              </Text>
            ))
          ) : (
            <Text style={styles.primary}>
              {bet.subjectName} · {bet.pick?.toUpperCase()} {bet.line.toFixed(1)}
              {bet.gameNumber != null ? ` · G${bet.gameNumber}` : ''}
            </Text>
          )
        ) : (
          <Text style={styles.primary}>{entry.description}</Text>
        )}
        <Text style={styles.meta}>
          {meta} · {formatDate(entry.created_at)}
        </Text>
      </View>
      <Text style={[styles.amount, { color: amountColor }]}>
        {isPositive ? '+' : ''}{entry.amount}
      </Text>
    </>
  )

  // Bet-backed rows open the shared Bet Details overlay; mints (score/bonus) don't.
  return bet ? (
    <>
      <TouchableOpacity
        style={[styles.row, !isLast && styles.rowBorder]}
        activeOpacity={0.7}
        onPress={() => setDetailOpen(true)}
      >
        {content}
      </TouchableOpacity>
      <BetDetailModal bet={detailOpen ? bet : null} onClose={() => setDetailOpen(false)} />
    </>
  ) : (
    <View style={[styles.row, !isLast && styles.rowBorder]}>{content}</View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  info: { flex: 1 },
  primary: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  meta: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  amount: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    letterSpacing: 0.5,
    marginLeft: 10,
  },
})
