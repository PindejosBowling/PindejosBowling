import { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'
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
  'Borrowed pins increase your available balance, but not your net worth. Debt accrues weekly ' +
  'interest until repaid. If you miss a week, there may be no pincome to garnish, but interest ' +
  'still applies. Outstanding debt counts against final season standings.'

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

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>BORROW</Text>
              <Text style={styles.statValueBig}>{product.borrow_amount.toLocaleString()} pins</Text>
            </View>
            <View style={styles.statGrid}>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>WEEKLY INTEREST</Text>
                <Text style={styles.statValue}>{interestPct}%</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statLabel}>GARNISHMENT</Text>
                <Text style={styles.statValue}>{garnishPct}%</Text>
              </View>
            </View>

            {/* Special product warning (Feeding Frenzy / Blood in the Water). */}
            {product.special_warning_text ? (
              <View style={styles.specialWarn}>
                <Text style={styles.specialWarnText}>⚠ {product.special_warning_text}</Text>
              </View>
            ) : null}

            <Text style={styles.warnText}>{GENERAL_WARNING}</Text>
            <Text style={styles.note}>
              Repayment is manual — garnishment chips away at your debt, but clearing it is on you.
            </Text>
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, borrowing && styles.confirmBtnDisabled]}
            onPress={confirm}
            disabled={borrowing}
            activeOpacity={0.7}
          >
            {borrowing
              ? <ActivityIndicator size="small" color={colors.bg} />
              : <Text style={styles.confirmBtnText}>Borrow {product.borrow_amount.toLocaleString()} Pins</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => !borrowing && onClose()} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
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
  body: { maxHeight: 360 },
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
  confirmBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
  cancelText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 14,
    letterSpacing: 0.5,
  },
})
