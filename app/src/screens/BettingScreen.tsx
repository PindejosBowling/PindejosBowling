import { useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import ToggleGroup from '../components/ToggleGroup'
import Toast from '../components/Toast'
import { useBettingData } from '../hooks/useBettingData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { placedBets, pinLedger } from '../utils/supabase/db'

type Nav = NativeStackNavigationProp<MoreStackParamList>

type Pick = 'over' | 'under'
type View2 = 'leaderboard' | 'action' | 'place'

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'action', label: 'Bets Placed This Week' },
  { key: 'place', label: 'Place Bets' },
]

interface BetModalState {
  lineId: string
  playerName: string
  gameNumber: number
  line: number
  pick: Pick | null
  wager: string
}

function resultBadge(result: string | null, pick: string) {
  if (!result) return null
  const won = pick === result
  const push = result === 'push'
  if (push) return { label: 'PUSH', color: colors.muted }
  if (won) return { label: 'WON', color: colors.success }
  return { label: 'LOST', color: colors.danger }
}

export default function BettingScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const { showToast } = useUiStore()

  const { loading, balance, openLines, myBets, weekBets, leaderboard, myBetLineIds, currentSeasonId, reload } = useBettingData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<View2>('leaderboard')
  const [modal, setModal] = useState<BetModalState | null>(null)
  const [placing, setPlacing] = useState(false)

  // Group all of this week's placed bets by game number (for the action view)
  const weekBetsByGame = useMemo(() => {
    const map: Record<number, any[]> = {}
    for (const bet of weekBets) {
      const gameNum = bet.bet_lines?.game_number
      if (gameNum == null) continue
      if (!map[gameNum]) map[gameNum] = []
      map[gameNum].push(bet)
    }
    return map
  }, [weekBets])

  const actionGameNumbers = useMemo(
    () => Object.keys(weekBetsByGame).map(Number).sort((a, b) => a - b),
    [weekBetsByGame],
  )

  const totalWagered = useMemo(() => weekBets.reduce((s, b) => s + (b.wager ?? 0), 0), [weekBets])
  const uniqueBettors = useMemo(() => new Set(weekBets.map(b => b.player_id)).size, [weekBets])

  // Group open lines by game_number
  const linesByGame = useMemo(() => {
    const map: Record<number, any[]> = {}
    for (const line of openLines) {
      if (!map[line.game_number]) map[line.game_number] = []
      map[line.game_number].push(line)
    }
    return map
  }, [openLines])

  const sortedGameNumbers = useMemo(() => Object.keys(linesByGame).map(Number).sort(), [linesByGame])

  function openBetModal(line: any, pick: Pick) {
    setModal({
      lineId: line.id,
      playerName: line.players?.name ?? 'Player',
      gameNumber: line.game_number,
      line: Number(line.line),
      pick,
      wager: '',
    })
  }

  async function placeBet() {
    if (!modal || !playerId || !currentSeasonId) return
    const wagerNum = parseInt(modal.wager, 10)
    if (!modal.pick) { showToast('Choose over or under', 'error'); return }
    if (isNaN(wagerNum) || wagerNum < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (wagerNum > balance) { showToast('Wager exceeds your balance', 'error'); return }

    setPlacing(true)
    try {
      const { data: bet, error: betErr } = await placedBets.insert({
        player_id: playerId,
        bet_line_id: modal.lineId,
        pick: modal.pick,
        wager: wagerNum,
      })
      if (betErr) { showToast(betErr.message, 'error'); return }

      await pinLedger.insert({
        player_id: playerId,
        season_id: currentSeasonId,
        amount: -wagerNum,
        type: 'bet_placed',
        description: `Bet: ${modal.playerName} ${modal.pick} ${modal.line} — Game ${modal.gameNumber}`,
        placed_bet_id: bet?.id ?? null,
      })

      showToast('Bet placed!', 'success')
      setModal(null)
      await reload()
    } catch {
      showToast('Failed to place bet', 'error')
    } finally {
      setPlacing(false)
    }
  }

  async function cancelBet(betId: string) {
    // Delete ledger entries first: pin_ledger.placed_bet_id is ON DELETE SET NULL,
    // so removing the placed bet first would orphan (not delete) its ledger rows.
    const { error: ledgerErr } = await pinLedger.removeByPlacedBet(betId)
    if (ledgerErr) { showToast(ledgerErr.message, 'error'); return }

    const { error: betErr } = await placedBets.remove(betId)
    if (betErr) { showToast(betErr.message, 'error'); return }

    showToast('Bet canceled', 'success')
    await reload()
  }

  function confirmCancelBet(bet: any) {
    const bl = bet.bet_lines
    const bettor = bet.players?.name ?? 'this player'
    const subject = bl?.players?.name ?? '—'
    Alert.alert(
      'Cancel this bet?',
      `Remove ${bettor}'s ${bet.pick?.toUpperCase()} ${Number(bl?.line ?? 0).toFixed(1)} bet on ${subject} (Game ${bl?.game_number}). This refunds their ${bet.wager} pin wager and cannot be undone.`,
      [
        { text: 'Keep Bet', style: 'cancel' },
        { text: 'Cancel Bet', style: 'destructive', onPress: () => cancelBet(bet.id) },
      ],
    )
  }

  const maxWager = balance

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Betting" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={styles.balanceValue}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceUnit}>PINS</Text>
        </View>

        {/* View toggle */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.viewToggle}
        >
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </ScrollView>

        {/* ── Leaderboard ─────────────────────────────────────── */}
        {view === 'leaderboard' && (
          leaderboard.length > 0 ? (
            <View style={styles.sbCard}>
              <View style={styles.sbHeaderRow}>
                <Text style={[styles.sbHeaderCell, styles.sbRankCell]}>#</Text>
                <Text style={[styles.sbHeaderCell, styles.sbNameCell]}>Bowler</Text>
                <Text style={[styles.sbHeaderCell, styles.sbBalCell]}>Pins</Text>
                <Text style={[styles.sbHeaderCell, styles.sbProjCell]}>If Win</Text>
              </View>
              {leaderboard.map((p, index) => {
                const isMe = p.playerId === playerId
                return (
                  <View
                    key={p.playerId}
                    style={[styles.sbRow, index < leaderboard.length - 1 && styles.sbRowBorder]}
                  >
                    <View style={[styles.sbIconBox, index < 3 && styles.sbIconBoxTop]}>
                      <Text style={[styles.sbRankText, index < 3 && styles.sbRankTextTop]}>{index + 1}</Text>
                    </View>
                    <Text style={[styles.sbName, isMe && styles.sbNameMe]} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.sbBalance}>{p.balance.toLocaleString()}</Text>
                    <Text style={[styles.sbProjection, p.potential > p.balance && styles.sbProjectionLive]}>
                      {p.potential.toLocaleString()}
                    </Text>
                  </View>
                )
              })}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No pin balances yet</Text>
            </View>
          )
        )}

        {/* ── Bets Placed This Week ───────────────────────────── */}
        {view === 'action' && (
          actionGameNumbers.length > 0 ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{weekBets.length}</Text>
                  <Text style={styles.summaryLabel}>BETS</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{totalWagered.toLocaleString()}</Text>
                  <Text style={styles.summaryLabel}>PINS WAGERED</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{uniqueBettors}</Text>
                  <Text style={styles.summaryLabel}>BETTORS</Text>
                </View>
              </View>

              {actionGameNumbers.map(gameNum => (
                <View key={gameNum}>
                  <Text style={styles.gameLabel}>GAME {gameNum}</Text>
                  <View style={styles.card}>
                    {weekBetsByGame[gameNum].map((bet: any, idx: number) => {
                      const bl = bet.bet_lines
                      const badge = resultBadge(bl?.result ?? null, bet.pick)
                      const isLast = idx === weekBetsByGame[gameNum].length - 1
                      return (
                        <View key={bet.id} style={[styles.betRow, !isLast && styles.lineRowBorder]}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.betSubject}>{bet.players?.name ?? '—'}</Text>
                            <Text style={styles.betDetails}>
                              {bet.pick?.toUpperCase()} {Number(bl?.line ?? 0).toFixed(1)} · {bl?.players?.name ?? '—'}
                              {bl?.actual_score != null ? `  ·  actual ${bl.actual_score}` : ''}
                            </Text>
                          </View>
                          <View style={styles.betRight}>
                            {badge
                              ? <Text style={[styles.betBadge, { color: badge.color }]}>{badge.label}</Text>
                              : <Text style={styles.betPending}>PENDING</Text>}
                            <Text style={styles.betWager}>{bet.wager} pins</Text>
                          </View>
                          {isAdmin && (
                            <TouchableOpacity
                              style={styles.cancelBtn}
                              onPress={() => confirmCancelBet(bet)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.cancelBtnText}>✕</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )
                    })}
                  </View>
                </View>
              ))}
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No bets placed yet this week</Text>
            </View>
          )
        )}

        {/* ── Place Bets ──────────────────────────────────────── */}
        {view === 'place' && <>
        {/* Open lines */}
        {sortedGameNumbers.length > 0 ? (
          <>
            <Text style={styles.sectionHeader}>THIS WEEK'S LINES</Text>
            {sortedGameNumbers.map(gameNum => (
              <View key={gameNum}>
                <Text style={styles.gameLabel}>GAME {gameNum}</Text>
                <View style={styles.card}>
                  {linesByGame[gameNum].map((line, idx) => {
                    const alreadyBet = myBetLineIds.has(line.id)
                    const myBetForLine = myBets.find((b: any) => b.bet_line_id === line.id)
                    const isLast = idx === linesByGame[gameNum].length - 1
                    return (
                      <View key={line.id} style={[styles.lineRow, !isLast && styles.lineRowBorder]}>
                        <View style={styles.lineInfo}>
                          <Text style={styles.lineName}>{line.players?.name ?? '—'}</Text>
                          <Text style={styles.lineValue}>LINE  {Number(line.line).toFixed(1)}</Text>
                        </View>
                        {alreadyBet ? (
                          <View style={styles.myBetChip}>
                            <Text style={styles.myBetChipText}>
                              {myBetForLine?.pick?.toUpperCase()} · {myBetForLine?.wager}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.pickBtns}>
                            <TouchableOpacity
                              style={[styles.pickBtn, balance < 10 && styles.pickBtnDisabled]}
                              onPress={() => balance >= 10 && openBetModal(line, 'over')}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.pickBtnText}>OVER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.pickBtn, balance < 10 && styles.pickBtnDisabled]}
                              onPress={() => balance >= 10 && openBetModal(line, 'under')}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.pickBtnText}>UNDER</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )
                  })}
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No open lines this week</Text>
          </View>
        )}

        {/* My bets */}
        {myBets.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>MY BETS</Text>
            <View style={styles.card}>
              {myBets.map((bet: any, idx: number) => {
                const bl = bet.bet_lines
                const badge = resultBadge(bl?.result ?? null, bet.pick)
                const isLast = idx === myBets.length - 1
                return (
                  <View key={bet.id} style={[styles.betRow, !isLast && styles.lineRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.betSubject}>
                        {bl?.players?.name ?? '—'}  ·  Game {bl?.game_number}
                      </Text>
                      <Text style={styles.betDetails}>
                        {bet.pick?.toUpperCase()}  {Number(bl?.line ?? 0).toFixed(1)}
                        {bl?.actual_score != null ? `  ·  actual ${bl.actual_score}` : ''}
                      </Text>
                    </View>
                    <View style={styles.betRight}>
                      {badge ? (
                        <Text style={[styles.betBadge, { color: badge.color }]}>{badge.label}</Text>
                      ) : (
                        <Text style={styles.betPending}>PENDING</Text>
                      )}
                      <Text style={styles.betWager}>
                        {bet.payout != null
                          ? bet.payout > 0
                            ? `+${bet.payout - bet.wager}`
                            : `-${bet.wager}`
                          : `${bet.wager} pins`}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          </>
        )}
        </>}
      </ScrollView>

      {/* Bet placement modal */}
      {modal && (
        <Modal visible transparent animationType="slide" onRequestClose={() => !placing && setModal(null)}>
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => !placing && setModal(null)}
            />
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>
                {modal.playerName} — Game {modal.gameNumber}
              </Text>
              <Text style={styles.modalLine}>LINE: {modal.line.toFixed(1)}</Text>

              <View style={styles.pickToggle}>
                {(['over', 'under'] as Pick[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.pickToggleBtn, modal.pick === p && styles.pickToggleBtnActive]}
                    onPress={() => setModal(m => m ? { ...m, pick: p } : m)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pickToggleBtnText, modal.pick === p && styles.pickToggleBtnTextActive]}>
                      {p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.wagerLabel}>WAGER (pins)</Text>
              <TextInput
                style={styles.wagerInput}
                value={modal.wager}
                onChangeText={v => setModal(m => m ? { ...m, wager: v.replace(/[^0-9]/g, '') } : m)}
                keyboardType="number-pad"
                placeholder={`10 – ${maxWager}`}
                placeholderTextColor={colors.muted2}
                maxLength={6}
              />
              <Text style={styles.wagerHint}>Balance: {balance} pins  ·  Min: 10</Text>

              <TouchableOpacity
                style={[styles.placeBtn, placing && styles.placeBtnDisabled]}
                onPress={placeBet}
                disabled={placing}
                activeOpacity={0.7}
              >
                {placing
                  ? <ActivityIndicator size="small" color={colors.bg} />
                  : <Text style={styles.placeBtnText}>Place Bet</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
          <Toast />
        </Modal>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: 24,
    marginTop: 8,
    marginBottom: 24,
  },
  balanceLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 4,
  },
  balanceValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 56,
    color: colors.accent,
    lineHeight: 60,
  },
  balanceUnit: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginTop: 2,
  },

  // Pin-balance scoreboard (mirrors StandingsScreen)
  sbCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  sbHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sbHeaderCell: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  sbRankCell: { width: 32 },
  sbNameCell: { flex: 1 },
  sbBalCell: { width: 56, textAlign: 'right' },
  sbProjCell: { width: 56, textAlign: 'right' },
  sbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sbRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  sbIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  sbIconBoxTop: { backgroundColor: colors.accentDim },
  sbRankText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted },
  sbRankTextTop: { color: colors.accent },
  sbName: { flex: 1, fontFamily: fonts.barlow, fontSize: 15, color: colors.text },
  sbNameMe: { color: colors.accent },
  sbBalance: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  sbProjection: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
  },
  sbProjectionLive: { color: colors.success },

  viewToggle: { marginBottom: 20 },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    marginBottom: 16,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 26,
    color: colors.accent,
    lineHeight: 28,
  },
  summaryLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
    marginTop: 2,
  },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 8,
  },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
    marginBottom: 6,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  lineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineInfo: { flex: 1 },
  lineName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  lineValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
    letterSpacing: 0.5,
  },
  pickBtns: { flexDirection: 'row', gap: 6 },
  pickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  pickBtnDisabled: { borderColor: colors.border2, backgroundColor: 'transparent', opacity: 0.4 },
  pickBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  myBetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  myBetChipText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
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
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },

  betRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  betSubject: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  betDetails: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  betRight: { alignItems: 'flex-end' },
  cancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.danger,
    lineHeight: 16,
  },
  betBadge: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  betPending: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1,
  },
  betWager: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },

  // Bet modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
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
    fontSize: 20,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalLine: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 20,
  },
  pickToggle: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  pickToggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  pickToggleBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  pickToggleBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.muted,
    letterSpacing: 1,
  },
  pickToggleBtnTextActive: { color: colors.accent },
  wagerLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
  },
  wagerInput: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    letterSpacing: 1,
  },
  wagerHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
    marginBottom: 20,
  },
  placeBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 14,
    alignItems: 'center',
  },
  placeBtnDisabled: { opacity: 0.4 },
  placeBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
})
