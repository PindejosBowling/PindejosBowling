import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, fonts } from '../../theme'
import type { LedgerEntry } from '../../hooks/usePlayerPinsinoData'
import { betLineSuffix } from '../../hooks/usePinsinoData'
import BetDetailModal from './BetDetailModal'
import { formatDateShort } from '../../utils/helpers'

interface LedgerRowProps {
  entry: LedgerEntry
  perspective: 'player' | 'house'
  isLast: boolean
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
    case 'bet_odds_boost':
      return perspective === 'house' ? 'ENERGY DRINK BONUS' : 'ENERGY DRINK ⚡️'
    case 'bet_insurance_refund':
      return perspective === 'house' ? 'GOLDEN TICKET REFUND' : 'GOLDEN TICKET 🎫'
    case 'bet_haunt_steal':
      return perspective === 'house' ? 'GHOST PAYOUT' : 'GHOST IN THE SLIP 👻'
    case 'score_credit':
      return 'PINCOME'
    case 'bonus':
      return 'BONUS'
    case 'loan_issued':
      return perspective === 'house' ? 'LOAN ISSUED' : 'LOAN ADVANCE'
    case 'loan_manual_repayment':
      return perspective === 'house' ? 'REPAYMENT RECEIVED' : 'REPAYMENT'
    case 'loan_weekly_garnishment':
      return perspective === 'house' ? 'GARNISHMENT' : 'GARNISHED'
    case 'loan_season_close_settlement':
      return perspective === 'house' ? 'SEASON-CLOSE COLLECTION' : 'SEASON-CLOSE PAYMENT'
    case 'pvp_stake':
      return perspective === 'house' ? 'CHALLENGE ESCROW' : 'CHALLENGE STAKE'
    case 'pvp_payout':
      return perspective === 'house' ? 'CHALLENGE PAYOUT' : 'CHALLENGE WIN'
    case 'pvp_refund':
      return perspective === 'house' ? 'REFUND ISSUED' : 'CHALLENGE REFUND'
    case 'bounty_sponsor_stake':
      return perspective === 'house' ? 'BOUNTY ESCROW' : 'BOUNTY POSTED'
    case 'bounty_hunter_stake':
      return perspective === 'house' ? 'BOUNTY ESCROW' : 'JOINED A HUNT'
    case 'bounty_payout':
      return perspective === 'house' ? 'BOUNTY PAYOUT' : 'BOUNTY WIN'
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
  // A 🩼 marker flags a payout/refund that only happened because a Winner's Crutch
  // cancelled a missed leg (a leg result of 'crutched').
  const metaParts = [actionLabel(entry.type, perspective)]
  if (bet?.legs?.some(leg => leg.result === 'crutched')) metaParts.push('🩼 CRUTCH')
  if (perspective === 'house' && bet) metaParts.push(bet.bettorName)
  const meta = metaParts.join(' · ')

  const content = (
    <>
      <View style={styles.info}>
        {bet ? (
          // A special's bet shows ONLY its title here — the legs live in the
          // detail overlay, in the same format every other bet uses.
          bet.customLineTitle != null ? (
            <Text style={[styles.customTitle, bet.customLineCategory === 'special' && styles.customTitleSpecial]}>
              {bet.customLineTitle}
            </Text>
          ) : bet.legCount > 1 ? (
            bet.legs.map((leg, i) => (
              <Text key={i} style={styles.primary}>
                {leg.subjectName} · {leg.pick?.toUpperCase()}
                {betLineSuffix(leg.marketType, leg.line, leg.statKey)}
                {leg.gameNumber != null ? ` (G${leg.gameNumber})` : ''}
              </Text>
            ))
          ) : (
            <Text style={styles.primary}>
              {bet.subjectName} · {bet.pick?.toUpperCase()}
              {betLineSuffix(bet.marketType, bet.line, bet.statKey)}
              {bet.gameNumber != null ? ` · G${bet.gameNumber}` : ''}
            </Text>
          )
        ) : (
          <Text style={styles.primary}>{entry.description}</Text>
        )}
        <Text style={styles.meta}>
          {meta} · {formatDateShort(entry.created_at)}
        </Text>
      </View>
      <Text style={[styles.amount, { color: amountColor }]}>
        {isPositive ? '+' : ''}{entry.amount}
      </Text>
    </>
  )

  // Special-branded bets carry the gold wash through the ledger too.
  const rowStyle = [
    styles.row,
    bet?.customLineCategory === 'special' && styles.rowSpecial,
    !isLast && styles.rowBorder,
  ]

  // Bet-backed rows open the shared Bet Details overlay; mints (score/bonus) don't.
  return bet ? (
    <>
      <TouchableOpacity style={rowStyle} activeOpacity={0.7} onPress={() => setDetailOpen(true)}>
        {content}
      </TouchableOpacity>
      <BetDetailModal bet={detailOpen ? bet : null} onClose={() => setDetailOpen(false)} />
    </>
  ) : (
    <View style={rowStyle}>{content}</View>
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
  rowSpecial: { backgroundColor: colors.goldTint },
  info: { flex: 1 },
  customTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
    letterSpacing: 0.4,
  },
  customTitleSpecial: { color: colors.gold },
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
