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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import Toast from '../components/Toast'
import { useBettingData } from '../hooks/useBettingData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { placedBets, pinLedger } from '../utils/supabase/db'

type Nav = NativeStackNavigationProp<MoreStackParamList>

type Pick = 'over' | 'under'

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
  const { showToast } = useUiStore()

  const { loading, balance, openLines, myBets, myBetLineIds, currentSeasonId, reload } = useBettingData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [modal, setModal] = useState<BetModalState | null>(null)
  const [placing, setPlacing] = useState(false)

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
