import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import ToggleGroup from '../components/ui/ToggleGroup'
import ActiveBetsView from '../components/betting/ActiveBetsView'
import SettledBetsView from '../components/betting/SettledBetsView'
import BetDetailModal from '../components/betting/BetDetailModal'
import SettleBetModal from '../components/betting/SettleBetModal'
import Button from '../components/ui/Button'
import CustomLineCreateModal from '../components/betting/CustomLineCreateModal'
import CustomLineAdminActionModal from '../components/betting/CustomLineAdminActionModal'
import { useRefresh } from '../hooks/useRefresh'
import { useHousePinsinoData } from '../hooks/useHousePinsinoData'
import { useLanetalkLineAdmin } from '../hooks/useLanetalkLineAdmin'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { betLineSuffix, type BetView } from '../hooks/usePinsinoData'
import { bets, customLines } from '../utils/supabase/db'
import EmptyCard from '../components/ui/EmptyCard'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type HouseView = 'active' | 'settled' | 'specials'

const VIEW_OPTIONS: { key: HouseView; label: string }[] = [
  { key: 'active', label: 'Active Bets' },
  { key: 'settled', label: 'Settled Bets' },
  { key: 'specials', label: 'Specials' },
]

export default function AdminSportsbookScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const { loading, weekBets, settledBets, currentWeekId, currentSeasonId, reload } = useHousePinsinoData()

  // Custom lines ("Specials") — every row incl. disabled ones, admin-managed here.
  const [specials, setSpecials] = useState<any[]>([])
  const loadSpecials = useCallback(async () => {
    const { data } = await customLines.listAll()
    setSpecials(data ?? [])
  }, [])
  useEffect(() => { loadSpecials() }, [loadSpecials])

  const reloadAll = useCallback(async () => { await Promise.all([reload(), loadSpecials()]) }, [reload, loadSpecials])
  const { refreshing, onRefresh } = useRefresh(reloadAll)

  const [view, setView] = useState<HouseView>('active')
  const [detailBet, setDetailBet] = useState<BetView | null>(null)
  const [settleBet, setSettleBet] = useState<BetView | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [actionLine, setActionLine] = useState<any | null>(null)
  const [editLine, setEditLine] = useState<any | null>(null)

  // Active = this week's still-pending bets (settled ones live in Settled Bets).
  const activeBets = useMemo(() => weekBets.filter(b => b.status === 'pending'), [weekBets])

  // LaneTalk stat lines (strikes/spares per game, clean%/first-ball per night) —
  // idempotent client-side generation against the week's eligibility ladder.
  const { generating, generateStatLines } = useLanetalkLineAdmin()
  async function onGenerateStatLines() {
    if (!currentWeekId) { showToast('No current week', 'error'); return }
    const { result, error } = await generateStatLines(currentWeekId)
    if (error) { showToast(error, 'error'); return }
    showToast(
      `Stat lines: ${result!.created} created · ${result!.repriced} repriced · ${result!.skipped} kept · ${result!.pruned} pruned`,
      'success',
    )
    await reload()
  }

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
      `Remove ${bet.bettorName}'s ${bet.legCount > 1 ? `${bet.legCount}-leg parlay` : `${bet.pick?.toUpperCase()}${betLineSuffix(bet.marketType, bet.line, bet.statKey)} bet on ${bet.subjectName}${bet.gameNumber != null ? ` (Game ${bet.gameNumber})` : ''}`}. This fully reverses the bet's pin effect — restoring the balance to before it was placed — and cannot be undone.`,
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
        <EmptyCard text="Admins only" />
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
          <>
            <Button
              label="Generate Stat Lines"
              variant="secondary"
              onPress={onGenerateStatLines}
              loading={generating}
              disabled={generating}
              style={styles.statLinesBtn}
            />
            <Text style={styles.statLinesHint}>
              Creates this week's LaneTalk stat props (strikes/spares per game, clean% +
              first-ball avg per night), priced off each player's official imports — no
              imports, no lines. Re-run after roster changes or new imports: unbet lines
              reprice, strays are pruned with their bets refunded.
            </Text>
            <ActiveBetsView
              bets={activeBets}
              perspective="house"
              hint="Tap a bet to settle its line(s) · ✕ to cancel a bet"
              onBetPress={setSettleBet}
              onParlayPress={setSettleBet}
              onCancelBet={confirmCancelBet}
            />
          </>
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

        {/* ── Specials (custom lines: create / edit / disable / delete) ── */}
        {view === 'specials' && (
          <>
            <Text style={styles.specialsHint}>
              Bundles of existing lines under a custom title. Players take one as a
              single bet at the legs' combined odds — it settles on the normal rails.
            </Text>
            <Button label="New Special" onPress={() => setCreateOpen(true)} style={styles.newSpecialBtn} />
            {specials.length === 0 ? (
              <EmptyCard text="No specials yet" />
            ) : (
              <View style={styles.specialsCard}>
                {specials.map((line, idx) => {
                  const legCount = Array.isArray(line.legs) ? line.legs.length : 0
                  return (
                    <TouchableOpacity
                      key={line.id}
                      style={[styles.specialRow, idx < specials.length - 1 && styles.specialRowBorder]}
                      onPress={() => setActionLine(line)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.specialTitle, line.category === 'special' && { color: colors.gold }]}>
                          {line.title}
                        </Text>
                        <Text style={styles.specialMeta}>
                          {line.week_ids == null ? 'EVERY WEEK' : `${line.week_ids.length} WEEK${line.week_ids.length === 1 ? '' : 'S'}`}
                          {' · '}{legCount} LEG{legCount === 1 ? '' : 'S'}
                        </Text>
                      </View>
                      <Text style={[styles.specialStatus, { color: line.is_active ? colors.success : colors.muted }]}>
                        {line.is_active ? 'ACTIVE' : 'DISABLED'}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}
          </>
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

      {/* Specials: create / edit / per-line actions (mounted conditionally) */}
      {createOpen && (
        <CustomLineCreateModal
          currentWeekId={currentWeekId}
          seasonId={currentSeasonId}
          onClose={() => setCreateOpen(false)}
          onDone={loadSpecials}
        />
      )}
      {editLine && (
        <CustomLineCreateModal
          currentWeekId={currentWeekId}
          seasonId={currentSeasonId}
          initial={editLine}
          onClose={() => setEditLine(null)}
          onDone={loadSpecials}
        />
      )}
      {actionLine && (
        <CustomLineAdminActionModal
          line={actionLine}
          onClose={() => setActionLine(null)}
          onDone={loadSpecials}
          onEdit={() => { setEditLine(actionLine); setActionLine(null) }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  viewToggle: { marginBottom: 20 },

  // LaneTalk stat-line generation
  statLinesBtn: { marginBottom: 8 },
  statLinesHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: 14,
  },

  // Specials manager
  specialsHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  newSpecialBtn: { marginBottom: 14 },
  specialsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  specialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  specialRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  specialTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  specialMeta: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  specialStatus: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1,
  },
})
