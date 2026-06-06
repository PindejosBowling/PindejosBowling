import { useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import ToggleGroup from '../components/ToggleGroup'
import ActiveBetsView from '../components/ActiveBetsView'
import SettledBetsView from '../components/SettledBetsView'
import BetDetailModal from '../components/BetDetailModal'
import SettleBetModal from '../components/SettleBetModal'
import { useRefresh } from '../hooks/useRefresh'
import { useHousePinsinoData } from '../hooks/useHousePinsinoData'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { type BetView } from '../hooks/usePinsinoData'
import { bets } from '../utils/supabase/db'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type HouseView = 'active' | 'settled'

const VIEW_OPTIONS: { key: HouseView; label: string }[] = [
  { key: 'active', label: 'Active Bets' },
  { key: 'settled', label: 'Settled Bets' },
]

export default function PinsinoSportsbookScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const { loading, weekBets, settledBets, reload } = useHousePinsinoData()
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<HouseView>('active')
  const [detailBet, setDetailBet] = useState<BetView | null>(null)
  const [settleBet, setSettleBet] = useState<BetView | null>(null)

  // Active = this week's still-pending bets (settled ones live in Settled Bets).
  const activeBets = useMemo(() => weekBets.filter(b => b.status === 'pending'), [weekBets])

  // Total undo, server-side (cancel_bet RPC): removes the bet's ledger pair(s) and
  // the bet, and re-opens the market if it was the last bet on a settled one.
  async function cancelBet(bet: BetView) {
    const { error } = await bets.cancel(bet.id)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Bet canceled', 'success')
    await reload()
  }

  function confirmCancelBet(bet: BetView) {
    Alert.alert(
      'Cancel this bet?',
      `Remove ${bet.bettorName}'s ${bet.legCount > 1 ? `${bet.legCount}-leg parlay` : `${bet.pick?.toUpperCase()} ${bet.line.toFixed(1)} bet on ${bet.subjectName} (Game ${bet.gameNumber})`}. This fully reverses the bet's pin effect — restoring the balance to before it was placed — and cannot be undone.`,
      [
        { text: 'Keep Bet', style: 'cancel' },
        { text: 'Cancel Bet', style: 'destructive', onPress: () => cancelBet(bet) },
      ],
    )
  }

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Sportsbook" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Admins only</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title="Sportsbook" onBack={() => navigation.goBack()} />

        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

        {/* ── Active Bets (admin: tap to settle a line, ✕ to cancel) ── */}
        {view === 'active' && (
          <ActiveBetsView
            bets={activeBets}
            perspective="house"
            hint="Tap a bet to settle its line(s) · ✕ to cancel a bet"
            onBetPress={setSettleBet}
            onParlayPress={setSettleBet}
            onCancelBet={confirmCancelBet}
          />
        )}

        {/* ── Settled Bets (admin: ✕ to cancel) ─────────────── */}
        {view === 'settled' && (
          <SettledBetsView
            bets={settledBets}
            perspective="house"
            onBetPress={setDetailBet}
            onCancelBet={confirmCancelBet}
          />
        )}
      </ScrollView>

      {/* Bet details overlay (parlays + settled-bet taps) */}
      <BetDetailModal bet={detailBet} onClose={() => setDetailBet(null)} />

      {/* Admin: settle a line from one of its active bets */}
      {settleBet && (
        <SettleBetModal
          bet={settleBet}
          onClose={() => setSettleBet(null)}
          onSettled={reload}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  viewToggle: { marginBottom: 20 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },
})
