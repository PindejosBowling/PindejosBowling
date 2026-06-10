import { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
import Button from './Button'
import { useUiStore } from '../stores/uiStore'
import { loans } from '../utils/supabase/db'
import type { LoanProductView } from '../hooks/useLoanSharkData'

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
  const { showToast } = useUiStore()
  const [borrowing, setBorrowing] = useState(false)

  const interestPct = Math.round(product.weekly_interest_rate * 100)
  const garnishPct = Math.round(product.garnishment_rate * 100)

  async function confirm() {
    setBorrowing(true)
    try {
      const { error } = await loans.take(product.id)
      if (error) { showToast(error.message, 'error'); return }
      showToast(`Borrowed ${product.borrow_amount.toLocaleString()} pins`, 'success')
      onBorrowed()
      onClose()
    } catch {
      showToast('Failed to take loan', 'error')
    } finally {
      setBorrowing(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !borrowing && onClose()}>
      <View style={styles.modalBackdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => !borrowing && onClose()}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>{product.display_name}</Text>
          <Text style={styles.modalSubtitle}>CONFIRM YOUR DEAL WITH THE SHARK</Text>

          <View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>BORROW</Text>
              <Text style={styles.statValueBig}>{product.borrow_amount.toLocaleString()} pins</Text>
            </View>
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
          </View>

          <Button
            label={`Borrow ${product.borrow_amount.toLocaleString()} Pins`}
            size="lg"
            onPress={confirm}
            loading={borrowing}
            disabled={borrowing}
            style={styles.confirmBtn}
          />
          <Button label="Cancel" variant="ghost" onPress={() => !borrowing && onClose()} />
        </View>
      </View>
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
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
  statValueBig: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 26,
    color: colors.accent,
  },
  specialWarn: {
    backgroundColor: 'rgba(255,79,109,0.12)',
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
  note: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  confirmBtn: { marginTop: 20 },
})
