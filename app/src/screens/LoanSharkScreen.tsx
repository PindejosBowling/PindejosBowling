import { useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import BorrowConfirmModal from '../components/BorrowConfirmModal'
import { useLoanSharkData, LoanProductView, DebtLedgerEntry } from '../hooks/useLoanSharkData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { loans } from '../utils/supabase/db'

// loan_ledger type → display label for the payment history.
const DEBT_TYPE_LABEL: Record<string, string> = {
  loan_issued: 'BORROWED',
  manual_repayment: 'REPAYMENT',
  weekly_garnishment: 'GARNISHED',
  weekly_interest: 'INTEREST',
  season_close_settlement: 'SEASON-CLOSE',
}

// Mechanical order of loan_ledger events within a single week. Garnishment is
// applied before interest, but the two rows share a created_at (written in the
// same transaction), so created_at can't disambiguate them — order by this.
const DEBT_TYPE_SEQUENCE: Record<string, number> = {
  loan_issued: 0,
  manual_repayment: 1,
  weekly_garnishment: 2,
  weekly_interest: 3,
  season_close_settlement: 4,
}

const RISK_COLOR: Record<string, string> = {
  low: colors.success,
  medium: colors.gold,
  high: colors.danger,
  extreme: colors.danger,
}

export default function LoanSharkScreen() {
  const navigation = useNavigation()
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()

  const { loading, balance, products, activeLoan, reload } = useLoanSharkData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [confirmProduct, setConfirmProduct] = useState<LoanProductView | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [repaying, setRepaying] = useState(false)

  const availableProducts = useMemo(() => products.filter(p => p.available), [products])

  // Newest-first, but tie-break same-instant rows by mechanical sequence so a
  // week's GARNISHED row always sits below its INTEREST row (garnishment happens
  // first, so in a newest-first list it renders last).
  const paymentHistory = useMemo(() => {
    if (!activeLoan) return []
    return [...activeLoan.paymentHistory].sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
      return (DEBT_TYPE_SEQUENCE[b.type] ?? 0) - (DEBT_TYPE_SEQUENCE[a.type] ?? 0)
    })
  }, [activeLoan])

  async function repay() {
    if (!activeLoan) return
    const amount = parseInt(repayAmount, 10)
    // Client mirror of the RPC validation (server re-checks regardless).
    if (isNaN(amount) || amount <= 0) {
      showToast('Enter a positive amount', 'error'); return
    }
    if (amount > activeLoan.outstanding) {
      showToast('Amount exceeds your outstanding debt', 'error'); return
    }
    if (amount > balance) {
      showToast('Amount exceeds your balance', 'error'); return
    }
    setRepaying(true)
    try {
      const { error } = await loans.repay(activeLoan.loanId, amount)
      if (error) { showToast(error.message, 'error'); return }
      showToast(`Repaid ${amount.toLocaleString()} pins`, 'success')
      setRepayAmount('')
      await reload()
    } catch {
      showToast('Failed to repay', 'error')
    } finally {
      setRepaying(false)
    }
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Loan Shark" subtitle="Borrow at your own risk" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <View style={styles.balancePill}>
          <Text style={styles.balancePillLabel}>BALANCE</Text>
          <Text style={styles.balancePillValue}>{balance.toLocaleString()} pins</Text>
        </View>

        {activeLoan ? (
          <View style={styles.loanCard}>
            <Text style={styles.loanCardTitle}>{activeLoan.product.display_name}</Text>
            <Text style={styles.outstandingLabel}>OUTSTANDING DEBT</Text>
            <Text style={styles.outstandingValue}>−{activeLoan.outstanding.toLocaleString()}</Text>

            <View style={styles.rateRow}>
              <Text style={styles.rateText}>
                {Math.round(activeLoan.product.weekly_interest_rate * 100)}% weekly interest
              </Text>
              <Text style={styles.rateDivider}>·</Text>
              <Text style={styles.rateText}>
                {Math.round(activeLoan.product.garnishment_rate * 100)}% garnishment
              </Text>
            </View>

            {/* Manual repayment form */}
            <View style={styles.repayRow}>
              <TextInput
                style={styles.repayInput}
                value={repayAmount}
                onChangeText={v => setRepayAmount(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="Amount"
                placeholderTextColor={colors.muted2}
                maxLength={7}
              />
              <TouchableOpacity
                style={[styles.repayBtn, repaying && styles.repayBtnDisabled]}
                onPress={repay}
                disabled={repaying}
                activeOpacity={0.7}
              >
                <Text style={styles.repayBtnText}>Repay</Text>
              </TouchableOpacity>
            </View>

            {/* Payment history (collapsible) */}
            <TouchableOpacity
              style={styles.historyToggle}
              onPress={() => setHistoryOpen(o => !o)}
              activeOpacity={0.7}
            >
              <Text style={styles.historyToggleText}>
                PAYMENT HISTORY ({paymentHistory.length})
              </Text>
              <Text style={styles.historyChevron}>{historyOpen ? '▾' : '▸'}</Text>
            </TouchableOpacity>
            {historyOpen && (
              <View style={styles.historyList}>
                {paymentHistory.length === 0 ? (
                  <Text style={styles.historyEmpty}>No activity yet</Text>
                ) : (
                  paymentHistory.map((e: DebtLedgerEntry, i) => (
                    <View
                      key={e.id}
                      style={[styles.historyRow, i < paymentHistory.length - 1 && styles.historyRowBorder]}
                    >
                      <View style={styles.historyLeft}>
                        <Text style={styles.historyType}>{DEBT_TYPE_LABEL[e.type] ?? e.type}</Text>
                        {e.weekNumber != null && (
                          <Text style={styles.historyWeek}>Week {e.weekNumber}</Text>
                        )}
                      </View>
                      <Text style={[styles.historyAmount, e.amount < 0 ? styles.amountNeg : styles.amountPos]}>
                        {e.amount > 0 ? '+' : ''}{e.amount.toLocaleString()}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>AVAILABLE LOANS</Text>
            {availableProducts.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>The Shark has nothing for you right now</Text>
              </View>
            ) : (
              availableProducts.map(p => (
                <View key={p.id} style={styles.productCard}>
                  <View style={styles.productHeader}>
                    <Text style={styles.productName}>{p.display_name}</Text>
                    <Text style={[styles.riskBadge, { color: RISK_COLOR[p.risk_level] ?? colors.muted }]}>
                      {p.risk_level.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.productAmount}>{p.borrow_amount.toLocaleString()} pins</Text>
                  <View style={styles.productRates}>
                    <Text style={styles.productRate}>
                      {Math.round(p.weekly_interest_rate * 100)}% pinterest/week
                    </Text>
                    <Text style={styles.rateDivider}>·</Text>
                    <Text style={styles.productRate}>
                      {Math.round(p.garnishment_rate * 100)}% garnishment
                    </Text>
                  </View>
                  <Text style={styles.productDesc}>{p.description}</Text>
                  {p.special_warning_text ? (
                    <Text style={styles.productWarn}>⚠ {p.special_warning_text}</Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.borrowBtn}
                    onPress={() => setConfirmProduct(p)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.borrowBtnText}>Borrow</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {confirmProduct && (
        <BorrowConfirmModal
          product={confirmProduct}
          onClose={() => setConfirmProduct(null)}
          onBorrowed={reload}
        />
      )}
      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balancePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 20,
  },
  balancePillLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  balancePillValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 20,
    color: colors.accent,
  },

  // Active loan card
  loanCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  loanCardTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 12,
  },
  outstandingLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  outstandingValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 40,
    color: colors.danger,
    lineHeight: 44,
  },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 16 },
  rateText: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted },
  rateDivider: { color: colors.muted2 },

  repayRow: { flexDirection: 'row', gap: 8 },
  repayInput: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.text,
  },
  repayBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  repayBtnDisabled: { opacity: 0.4 },
  repayBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },

  historyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyToggleText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  historyChevron: { color: colors.muted, fontSize: 14 },
  historyList: { marginTop: 8 },
  historyEmpty: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted2, paddingVertical: 8 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  historyRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  historyLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  historyType: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.text,
  },
  historyWeek: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted2 },
  historyAmount: { fontFamily: fonts.barlowCondensed, fontSize: 15 },
  amountNeg: { color: colors.success },  // debt going down reads positive to the borrower
  amountPos: { color: colors.danger },   // debt going up

  // Available products
  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
  },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 12,
  },
  productHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  productName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 19,
    color: colors.text,
    fontWeight: '700',
  },
  riskBadge: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  productAmount: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 28,
    color: colors.accent,
    marginTop: 2,
  },
  productRates: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 10 },
  productRate: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted },
  productDesc: { fontFamily: fonts.barlow, fontSize: 14, color: colors.text, lineHeight: 20 },
  productWarn: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
    marginTop: 8,
  },
  borrowBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  borrowBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.3 },
})
