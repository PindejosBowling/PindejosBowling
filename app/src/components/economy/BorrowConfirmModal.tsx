import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import ConfirmActionSheet from '../ui/ConfirmActionSheet'
import StatRow from '../ui/StatRow'
import TermsBlock from '../ui/TermsBlock'
import LoanPayoffSchedule from './LoanPayoffSchedule'
import { TERMS } from '../../data/pinsinoExplainers'
import { loans } from '../../utils/supabase/db'
import { simulateLoanPayoff } from '../../utils/loanSchedule'
import { GAMES_PER_WEEK } from '../../utils/helpers'
import type { LoanProductView } from '../../hooks/useLoanSharkData'
import { formatPins } from '../../utils/formatting'

interface BorrowConfirmModalProps {
  // The product being borrowed. Mount conditionally (`{product && <… />}`) so the
  // modal resets between opens. Confirm → take_loan RPC → toast + reload + close.
  product: LoanProductView
  // Season average per game for the payoff projection (screen computes it via
  // aggregatePlayerAverages / effectiveAverage in useMemo).
  avgPerGame: number
  usingLeagueAvg: boolean
  onClose: () => void
  onBorrowed: () => void
}

export default function BorrowConfirmModal({ product, avgPerGame, usingLeagueAvg, onClose, onBorrowed }: BorrowConfirmModalProps) {
  const interestPct = Math.round(product.weekly_interest_rate * 100)
  const garnishPct = Math.round(product.garnishment_rate * 100)

  const schedule = useMemo(
    () =>
      simulateLoanPayoff({
        startingDebt: product.borrow_amount,
        garnishRate: product.garnishment_rate,
        interestRate: product.weekly_interest_rate,
        weeklyPincome: Math.round(avgPerGame) * GAMES_PER_WEEK,
      }),
    [product, avgPerGame],
  )

  return (
    <ConfirmActionSheet
      title={product.display_name}
      subtitle="CONFIRM YOUR DEAL WITH THE SHARK"
      confirmLabel={`Borrow ${formatPins(product.borrow_amount)} Pins`}
      action={() => loans.take(product.id)}
      successMessage={`Borrowed ${formatPins(product.borrow_amount)} pins`}
      failureMessage="Failed to take loan"
      onClose={onClose}
      onDone={onBorrowed}
    >
      <StatRow label="BORROW" value={`${formatPins(product.borrow_amount)} pins`} variant="big" />
      <View style={styles.statGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>SHARK'S WEEKLY CUT</Text>
          <Text style={styles.statValue}>{garnishPct}%</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>WEEKLY INTEREST</Text>
          <Text style={styles.statValue}>{interestPct}%</Text>
        </View>
      </View>

      {/* Special product warning (Feeding Frenzy / Blood in the Water). */}
      {product.special_warning_text ? (
        <View style={styles.specialWarn}>
          <Text style={styles.specialWarnText}>⚠ {product.special_warning_text}</Text>
        </View>
      ) : null}

      <LoanPayoffSchedule
        schedule={schedule}
        startingDebt={product.borrow_amount}
        avgPerGame={avgPerGame}
        usingLeagueAvg={usingLeagueAvg}
      />

      <TermsBlock terms={TERMS.loanBorrow} />
    </ConfirmActionSheet>
  )
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  statCell: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    padding: 12,
  },
  statLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
  },
  statValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 24,
    color: colors.text,
    marginTop: 2,
  },
  specialWarn: {
    backgroundColor: colors.dangerDim,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 12,
    marginBottom: 14,
  },
  specialWarnText: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
})
