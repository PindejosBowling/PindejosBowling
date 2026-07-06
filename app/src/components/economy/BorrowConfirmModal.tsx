import { View, Text, StyleSheet } from 'react-native'
import { colors, fonts, radius } from '../../theme'
import ConfirmActionSheet from '../ui/ConfirmActionSheet'
import StatRow from '../ui/StatRow'
import { loans } from '../../utils/supabase/db'
import type { LoanProductView } from '../../hooks/useLoanSharkData'
import { formatPins } from '../../utils/formatting'

interface BorrowConfirmModalProps {
  // The product being borrowed. Mount conditionally (`{product && <… />}`) so the
  // modal resets between opens. Confirm → take_loan RPC → toast + reload + close.
  product: LoanProductView
  onClose: () => void
  onBorrowed: () => void
}

const GENERAL_WARNING =
  'Borrowed pins increase your available balance immediately. In exchange, the shark will take his cut of your weekly pincome before charging interest on the remaining balance. ' +
  'If you miss a week in the PBL, there will be no pincome to garnish, but weekly interest ' +
  'is still accumulated.'

export default function BorrowConfirmModal({ product, onClose, onBorrowed }: BorrowConfirmModalProps) {
  const interestPct = Math.round(product.weekly_interest_rate * 100)
  const garnishPct = Math.round(product.garnishment_rate * 100)

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
          <Text style={styles.statLabel}>WEEKLY PINCOME CUT</Text>
          <Text style={styles.statValue}>{garnishPct}%</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>WEEKLY PINTEREST</Text>
          <Text style={styles.statValue}>{interestPct}%</Text>
        </View>
      </View>

      {/* Special product warning (Feeding Frenzy / Blood in the Water). */}
      {product.special_warning_text ? (
        <View style={styles.specialWarn}>
          <Text style={styles.specialWarnText}>⚠ {product.special_warning_text}</Text>
        </View>
      ) : null}

      <Text style={styles.warnText}>{GENERAL_WARNING}</Text>
      <Text style={styles.warnText}>
        You have the option to pay off this loan, in part or in full, at any time. The loan is closed when the outstanding balance reaches zero.
      </Text>
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
  warnText: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 10,
  },
})
