import { useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import ArtworkToggle from '../components/ui/ArtworkToggle'
import LoanSharkDepthBackdrop from '../components/pixelart/LoanSharkDepthBackdrop'
import ScreenBackdrop from '../components/pixelart/ScreenBackdrop'
import Toast from '../components/ui/Toast'
import BorrowConfirmModal from '../components/economy/BorrowConfirmModal'
import Button from '../components/ui/Button'
import BalancePill from '../components/ui/BalancePill'
import PinAmountInput from '../components/ui/PinAmountInput'
import { useLoanSharkData, LoanProductView, DebtLedgerEntry } from '../hooks/useLoanSharkData'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import { useRefresh } from '../hooks/useRefresh'
import { useEconomyRefresh } from '../hooks/useEconomyRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { loans } from '../utils/supabase/db'
import EmptyCard from '../components/ui/EmptyCard'
import { formatPins } from '../utils/formatting'

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
  const artworkReveal = useUiStore(s => s.artworkReveal)

  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const { readOnly, viewSeasonNumber } = usePinsinoSeasonContext()
  const { loading, balance, products, activeLoan, reload } = useLoanSharkData(playerId, pinsinoViewSeasonId)
  const reloadAll = useEconomyRefresh(reload)
  const { refreshing, onRefresh } = useRefresh(reloadAll)
  const insets = useSafeAreaInsets()

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
    if (readOnly) return
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
      showToast(`Repaid ${formatPins(amount)} pins`, 'success')
      setRepayAmount('')
      await reloadAll()
    } catch {
      showToast('Failed to repay', 'error')
    } finally {
      setRepaying(false)
    }
  }

  return (
    <View style={styles.safe}>
      {/* The depth field mounts inside the ScrollView (a scroll-length field —
          see pixelart/config.ts) so it measures the full scroll content, with
          the header inside the scroll too and the safe-area inset as content
          padding so the art paints under the status bar to the bezel.
          ScreenBackdrop keeps that one backdrop instance mounted across the
          load→ready swap. */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        refreshControl={
          loading ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
          )
        }
      >
        <ScreenBackdrop backdrop={<LoanSharkDepthBackdrop />} loading={loading}>
        <ScreenHeader title="Loan Shark" subtitle="Borrow at your own risk" onBack={() => navigation.goBack()} right={<ArtworkToggle />} />
        {/* Kept laid out (not unmounted) while artwork is revealed — only made
            invisible + inert — so the depth field, which measures the scroll
            content height, stays full-length and scrollable instead of
            collapsing to the viewport. */}
        <View
          pointerEvents={artworkReveal ? 'none' : 'auto'}
          style={artworkReveal ? styles.artHidden : undefined}
        >
        {readOnly && <ReadOnlySeasonBanner seasonNumber={viewSeasonNumber} />}

        <BalancePill balance={balance} style={styles.balanceMargin} />

        {activeLoan ? (
          <View style={styles.loanCard}>
            <Text style={styles.loanCardTitle}>{activeLoan.product.display_name}</Text>
            <Text style={styles.outstandingLabel}>OUTSTANDING DEBT</Text>
            <Text style={styles.outstandingValue}>−{formatPins(activeLoan.outstanding)}</Text>

            <View style={styles.rateRow}>
              <Text style={styles.rateText}>
                {Math.round(activeLoan.product.weekly_interest_rate * 100)}% weekly interest
              </Text>
              <Text style={styles.rateDivider}>·</Text>
              <Text style={styles.rateText}>
                {Math.round(activeLoan.product.garnishment_rate * 100)}% cut of your weekly pincome
              </Text>
            </View>

            {/* Manual repayment form */}
            <View style={styles.repayRow}>
              <PinAmountInput
                style={styles.repayInput}
                variant="stake"
                value={repayAmount}
                onChangeText={setRepayAmount}
                placeholder="Amount"
                maxLength={7}
              />
              <Button label="Repay" onPress={repay} disabled={repaying} style={styles.repayBtn} />
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
                        {formatPins(e.amount, { signed: true })}
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
              <EmptyCard text={readOnly ? 'No loan activity to review for this season' : 'The Shark has nothing for you right now'} />
            ) : (
              availableProducts.map(p => (
                <View key={p.id} style={styles.productCard}>
                  <View style={styles.productHeader}>
                    <Text style={styles.productName}>{p.display_name}</Text>
                    <Text style={[styles.riskBadge, { color: RISK_COLOR[p.risk_level] ?? colors.muted }]}>
                      {p.risk_level.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.productAmount}>{formatPins(p.borrow_amount)} pins</Text>
                  <View style={styles.productRates}>
                    <Text style={styles.productRate}>
                      {Math.round(p.weekly_interest_rate * 100)}% pinterest/week
                    </Text>
                    <Text style={styles.rateDivider}>·</Text>
                    <Text style={styles.productRate}>
                      {Math.round(p.garnishment_rate * 100)}% cut of your weekly pincome
                    </Text>
                  </View>
                  <Text style={styles.productDesc}>{p.description}</Text>
                  {p.special_warning_text ? (
                    <Text style={styles.productWarn}>⚠ {p.special_warning_text}</Text>
                  ) : null}
                  <Button label="Borrow" onPress={() => setConfirmProduct(p)} style={styles.borrowBtn} />
                </View>
              ))
            )}
          </>
        )}
        </View>
        </ScreenBackdrop>
      </ScrollView>

      {confirmProduct && (
        <BorrowConfirmModal
          product={confirmProduct}
          onClose={() => setConfirmProduct(null)}
          onBorrowed={reloadAll}
        />
      )}
      <Toast />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Artwork-reveal: hide the foreground but keep it laid out (see render note).
  artHidden: { opacity: 0 },
  // flexGrow keeps the scroll content (and the depth field measured from it)
  // at least viewport-height when the loan list is short.
  content: { paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 },

  balanceMargin: { marginBottom: 20 },

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
  repayInput: { flex: 1 },
  repayBtn: { paddingHorizontal: 20 },

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
  borrowBtn: { marginTop: 14 },
})
