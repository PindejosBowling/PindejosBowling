import { useState, useCallback, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { seasons, loans, loanLedger } from '../utils/supabase/db'

interface AdminLoanRow {
  loanId: string
  playerName: string
  productName: string
  outstanding: number
}

export default function LoanSharkAdminScreen() {
  const navigation = useNavigation()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AdminLoanRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const seasonRes = await seasons.getCurrent()
      const seasonId = seasonRes.data?.id ?? null
      if (!seasonId) { setRows([]); return }

      const [loansRes, debtRes] = await Promise.all([
        loans.listActiveDetailed(seasonId),
        loanLedger.listActiveBySeason(seasonId),
      ])

      // Outstanding debt per loan = SUM(loan_ledger.amount) over its rows.
      const debtByLoan: Record<string, number> = {}
      for (const d of debtRes.data ?? []) {
        debtByLoan[(d as any).loan_id] = (debtByLoan[(d as any).loan_id] ?? 0) + (d as any).amount
      }

      setRows(
        (loansRes.data ?? []).map((l: any) => ({
          loanId: l.id,
          playerName: l.players?.name ?? '—',
          productName: l.loan_products?.display_name ?? '—',
          outstanding: debtByLoan[l.id] ?? 0,
        }))
      )
    } catch (e) {
      console.error('LoanSharkAdmin load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const { refreshing, onRefresh } = useRefresh(load)

  // Destructive rollback (cancel_loan RPC): removes the loan's pin + debt rows.
  async function cancelLoan(row: AdminLoanRow) {
    const { error } = await loans.cancel(row.loanId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Loan canceled', 'success')
    await load()
  }

  function confirmCancel(row: AdminLoanRow) {
    Alert.alert(
      'Cancel Loan',
      `Undo ${row.playerName}'s ${row.productName}? This removes the loan and reverts their balance and debt.`,
      [
        { text: 'Keep Loan', style: 'cancel' },
        { text: 'Cancel Loan', style: 'destructive', onPress: () => cancelLoan(row) },
      ]
    )
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Loan Shark Admin" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Admins only</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Loan Shark Admin" subtitle="Active loans" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No active loans</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {rows.map((r, i) => (
              <View
                key={r.loanId}
                style={[styles.row, i < rows.length - 1 && styles.rowBorder]}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.playerName}>{r.playerName}</Text>
                  <Text style={styles.productName}>{r.productName}</Text>
                </View>
                <Text style={styles.outstanding}>−{r.outstanding.toLocaleString()}</Text>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => confirmCancel(r)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <Toast />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLeft: { flex: 1 },
  playerName: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
  productName: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, marginTop: 1 },
  outstanding: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.danger,
    marginRight: 14,
  },
  cancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  emptyText: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.muted, letterSpacing: 0.3 },
})
