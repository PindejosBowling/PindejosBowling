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
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import ToggleGroup from '../components/ToggleGroup'
import Toast from '../components/Toast'
import BetRow from '../components/BetRow'
import ActiveBetsView from '../components/ActiveBetsView'
import SettledBetsView from '../components/SettledBetsView'
import BetDetailModal, { resultBadge, betReturnText } from '../components/BetDetailModal'
import { useBettingData, type BetView, type LineView } from '../hooks/useBettingData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { bets } from '../utils/supabase/db'
import { BettingStackParamList } from '../navigation/types'

type BettingNav = NativeStackNavigationProp<BettingStackParamList>

type Pick = 'over' | 'under'
type View2 = 'leaderboard' | 'action' | 'place' | 'settled'
type PlaceMode = 'single' | 'parlay'

// One leg staged in the parlay bet slip.
interface ParlayLeg {
  selectionId: string
  marketId: string
  subjectName: string
  subjectPlayerId: string
  gameNumber: number
  line: number
  pick: Pick
}

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'place', label: 'Place Bets' },
  { key: 'action', label: 'Active Bets' },
  { key: 'settled', label: 'Settled Bets' },
]

interface BetModalState {
  marketId: string
  subjectName: string
  subjectPlayerId: string
  gameNumber: number
  line: number
  overSelectionId?: string
  underSelectionId?: string
  pick: Pick | null
  wager: string
}

export default function BettingScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()
  const navigation = useNavigation<BettingNav>()

  const { loading, balance, openLines, myBets, weekBets, settledBets, leaderboard, reload } = useBettingData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<View2>('leaderboard')
  const [placeMode, setPlaceMode] = useState<PlaceMode>('single')
  const [parlayLegs, setParlayLegs] = useState<ParlayLeg[]>([])
  const [parlayModalOpen, setParlayModalOpen] = useState(false)
  const [parlayWager, setParlayWager] = useState('')
  const [modal, setModal] = useState<BetModalState | null>(null)
  const [placing, setPlacing] = useState(false)
  const [detailModal, setDetailModal] = useState<BetView | null>(null)

  // Active = this week's still-pending bets (settled ones move to Settled Bets).
  // The public tab is read-only: Active/Settled rows just open the details overlay
  // (settling/cancelling lives on the Pinsino Admin screen).
  const activeBets = useMemo(() => weekBets.filter(b => b.status === 'pending'), [weekBets])

  // Group open lines by game_number
  const linesByGame = useMemo(() => {
    const map: Record<number, LineView[]> = {}
    for (const line of openLines) {
      if (!map[line.gameNumber]) map[line.gameNumber] = []
      map[line.gameNumber].push(line)
    }
    return map
  }, [openLines])

  const sortedGameNumbers = useMemo(() => Object.keys(linesByGame).map(Number).sort(), [linesByGame])

  function openBetModal(line: LineView, pick: Pick) {
    setModal({
      marketId: line.marketId,
      subjectName: line.subjectName,
      subjectPlayerId: line.subjectPlayerId,
      gameNumber: line.gameNumber,
      line: line.line,
      overSelectionId: line.overSelectionId,
      underSelectionId: line.underSelectionId,
      pick,
      wager: '',
    })
  }

  async function placeBet() {
    if (!modal || !playerId) return
    const wagerNum = parseInt(modal.wager, 10)
    if (!modal.pick) { showToast('Choose over or under', 'error'); return }
    // Hard constraint: no betting the under on your own line (anti-tanking).
    if (modal.pick === 'under' && modal.subjectPlayerId === playerId) {
      showToast("Believe in yourself man", 'error'); return
    }
    if (isNaN(wagerNum) || wagerNum < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (wagerNum > balance) { showToast('Wager exceeds your balance', 'error'); return }

    const selectionId = modal.pick === 'over' ? modal.overSelectionId : modal.underSelectionId
    if (!selectionId) { showToast('Line unavailable', 'error'); return }

    setPlacing(true)
    try {
      // Atomic + balance-checked, server-side (place_house_bet RPC). The bettor is
      // resolved from the JWT and the double-entry stake ledger pair is written in
      // the same transaction — the client no longer writes any betting rows.
      const { error: betErr } = await bets.place([selectionId], wagerNum)
      if (betErr) { showToast(betErr.message, 'error'); return }

      showToast('Bet placed!', 'success')
      setModal(null)
      await reload()
    } catch {
      showToast('Failed to place bet', 'error')
    } finally {
      setPlacing(false)
    }
  }

  // ── Parlay slip ─────────────────────────────────────────────────────────
  // All O/U selections sit at even money (2.000), so the fair combined odds of
  // an N-leg parlay = 2^N and payout = floor(stake × 2^N). Push/void legs drop
  // out at settlement (handled server-side), recomputing over the surviving legs.
  const parlayOdds = useMemo(() => Math.pow(2, parlayLegs.length), [parlayLegs])

  // Toggle a line's over/under in/out of the slip. One selection per market.
  function toggleParlayLeg(line: LineView, pick: Pick) {
    if (pick === 'under' && line.subjectPlayerId === playerId) {
      showToast('Believe in yourself man', 'error'); return
    }
    const selectionId = pick === 'over' ? line.overSelectionId : line.underSelectionId
    if (!selectionId) { showToast('Line unavailable', 'error'); return }

    setParlayLegs(prev => {
      const existing = prev.find(l => l.marketId === line.marketId)
      // Tapping the already-selected side removes the leg.
      if (existing && existing.pick === pick) return prev.filter(l => l.marketId !== line.marketId)
      const without = prev.filter(l => l.marketId !== line.marketId)
      return [...without, {
        selectionId,
        marketId: line.marketId,
        subjectName: line.subjectName,
        subjectPlayerId: line.subjectPlayerId,
        gameNumber: line.gameNumber,
        line: line.line,
        pick,
      }]
    })
  }

  function removeParlayLeg(marketId: string) {
    setParlayLegs(prev => prev.filter(l => l.marketId !== marketId))
  }

  async function placeParlay() {
    if (!playerId) return
    if (parlayLegs.length < 2) { showToast('A parlay needs at least 2 legs', 'error'); return }
    const wagerNum = parseInt(parlayWager, 10)
    if (isNaN(wagerNum) || wagerNum < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (wagerNum > balance) { showToast('Wager exceeds your balance', 'error'); return }

    setPlacing(true)
    try {
      const { error } = await bets.place(parlayLegs.map(l => l.selectionId), wagerNum)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Parlay placed!', 'success')
      setParlayModalOpen(false)
      setParlayLegs([])
      setParlayWager('')
      await reload()
    } catch {
      showToast('Failed to place parlay', 'error')
    } finally {
      setPlacing(false)
    }
  }

  const maxWager = balance

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          view === 'place' && placeMode === 'parlay' && parlayLegs.length > 0 && { paddingBottom: 96 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={styles.balanceValue}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceUnit}>PINS</Text>
        </View>

        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

        {/* ── Leaderboard ─────────────────────────────────────── */}
        {view === 'leaderboard' && (
          leaderboard.length > 0 ? (
            <View style={styles.sbCard}>
              <View style={styles.sbHeaderRow}>
                <Text style={[styles.sbHeaderCell, styles.sbRankCell]}>#</Text>
                <Text style={[styles.sbHeaderCell, styles.sbNameCell]}>Bowler</Text>
                <Text style={[styles.sbHeaderCell, styles.sbBalCell]}>Pins</Text>
                <Text style={[styles.sbHeaderCell, styles.sbProjCell]}>Upside</Text>
              </View>
              {leaderboard.map((p, index) => {
                const isMe = p.playerId === playerId
                return (
                  <TouchableOpacity
                    key={p.playerId}
                    style={[styles.sbRow, index < leaderboard.length - 1 && styles.sbRowBorder]}
                    onPress={() => navigation.navigate('PlayerBettingDetail', { playerId: p.playerId, name: p.name })}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.sbIconBox, index < 3 && styles.sbIconBoxTop]}>
                      <Text style={[styles.sbRankText, index < 3 && styles.sbRankTextTop]}>{index + 1}</Text>
                    </View>
                    <Text style={[styles.sbName, isMe && styles.sbNameMe]} numberOfLines={1}>
                      {p.name}
                      {p.movement === 'up' && <Text style={styles.moveUp}> ▲</Text>}
                      {p.movement === 'down' && <Text style={styles.moveDown}> ▼</Text>}
                    </Text>
                    <Text style={styles.sbBalance}>{p.balance.toLocaleString()}</Text>
                    <Text style={[styles.sbProjection, p.potential > p.balance && styles.sbProjectionLive]}>
                      {p.potential.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No pin balances yet</Text>
            </View>
          )
        )}

        {/* ── Active Bets (read-only; tap a row for details) ──── */}
        {view === 'action' && (
          <ActiveBetsView
            bets={activeBets}
            onBetPress={setDetailModal}
            onParlayPress={setDetailModal}
          />
        )}

        {/* ── Place Bets ──────────────────────────────────────── */}
        {view === 'place' && <>
        {/* Single / Parlay mode */}
        <View style={styles.modeToggle}>
          <ToggleGroup
            options={[{ key: 'single', label: 'Single' }, { key: 'parlay', label: 'Parlay' }]}
            value={placeMode}
            onChange={(m: PlaceMode) => setPlaceMode(m)}
          />
        </View>
        {placeMode === 'parlay' && (
          <Text style={[styles.adminHint, { textAlign: 'center' }]}>
            Tap lines to add legs · all must win · odds double with each leg
          </Text>
        )}

        {/* My bets */}
        {myBets.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>MY BETS</Text>
            <View style={styles.card}>
              {myBets.map((bet, idx) => {
                const badge = resultBadge(bet.status)
                const isLast = idx === myBets.length - 1
                return (
                  <BetRow
                    key={bet.id}
                    bet={bet}
                    isLast={isLast}
                    badge={badge}
                    betReturnText={betReturnText(bet)}
                    onPress={() => setDetailModal(bet)}
                  />
                )
              })}
            </View>
          </>
        )}

        {/* Open lines */}
        {sortedGameNumbers.length > 0 ? (
          <>
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>THIS WEEK'S LINES</Text>
            {sortedGameNumbers.map(gameNum => {
              // Closing is all-or-nothing per game, so the whole game is in progress
              // once any of its lines is closed.
              const gameInProgress = linesByGame[gameNum].some(l => l.inProgress)
              return (
              <View key={gameNum}>
                <Text style={styles.gameLabel}>GAME {gameNum}</Text>
                {gameInProgress && (
                  <Text style={styles.inProgressNote}>
                    The Pinsino does not take action on games in progress
                  </Text>
                )}
                <View style={styles.card}>
                  {linesByGame[gameNum].map((line, idx) => {
                    const isLast = idx === linesByGame[gameNum].length - 1
                    // Anti-tanking: a player may not bet the under on their own line.
                    const isOwnLine = line.subjectPlayerId === playerId
                    const slipLeg = parlayLegs.find(l => l.marketId === line.marketId)
                    return (
                      <View key={line.marketId} style={[styles.lineRow, !isLast && styles.lineRowBorder, gameInProgress && styles.lineRowInProgress]}>
                        <View style={styles.lineInfo}>
                          <Text style={styles.lineName}>{line.subjectName}</Text>
                          <Text style={styles.lineValue}>LINE  {line.line.toFixed(1)}</Text>
                        </View>
                        {gameInProgress ? (
                          <View style={styles.pickBtns}>
                            {(['over', 'under'] as Pick[]).map(p => (
                              <View key={p} style={[styles.pickBtn, styles.pickBtnDisabled]}>
                                <Text style={styles.pickBtnText}>{p.toUpperCase()}</Text>
                              </View>
                            ))}
                          </View>
                        ) : placeMode === 'parlay' ? (
                          <View style={styles.pickBtns}>
                            {(['over', 'under'] as Pick[]).map(p => {
                              const blocked = p === 'under' && isOwnLine
                              const selected = slipLeg?.pick === p
                              return (
                                <TouchableOpacity
                                  key={p}
                                  style={[styles.pickBtn, selected && styles.pickBtnSelected, blocked && styles.pickBtnDisabled]}
                                  onPress={() => toggleParlayLeg(line, p)}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.pickBtnText, selected && styles.pickBtnTextSelected]}>
                                    {p.toUpperCase()}
                                  </Text>
                                </TouchableOpacity>
                              )
                            })}
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
                              style={[styles.pickBtn, (balance < 10 || isOwnLine) && styles.pickBtnDisabled]}
                              onPress={() => {
                                if (isOwnLine) { showToast("Believe in yourself man", 'error'); return }
                                if (balance >= 10) openBetModal(line, 'under')
                              }}
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
              )
            })}
          </>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No open lines this week</Text>
          </View>
        )}
        </>}

        {/* ── Settled Bets (read-only; tap a row for details) ─── */}
        {view === 'settled' && (
          <SettledBetsView bets={settledBets} onBetPress={setDetailModal} />
        )}
      </ScrollView>

      {/* Parlay bet slip (sticky) */}
      {view === 'place' && placeMode === 'parlay' && parlayLegs.length > 0 && (
        <View style={styles.slipBar}>
          <View style={styles.slipInfo}>
            <Text style={styles.slipTitle}>
              {parlayLegs.length}-LEG PARLAY · ×{parlayOdds}
            </Text>
            <Text style={styles.slipSub} numberOfLines={1}>
              {parlayLegs.map(l => `${l.subjectName} ${l.pick.toUpperCase()}`).join(' · ')}
            </Text>
          </View>
          <TouchableOpacity style={styles.slipClear} onPress={() => setParlayLegs([])} activeOpacity={0.7}>
            <Text style={styles.slipClearText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.slipBuild, parlayLegs.length < 2 && styles.placeBtnDisabled]}
            onPress={() => { if (parlayLegs.length >= 2) setParlayModalOpen(true) }}
            activeOpacity={0.7}
          >
            <Text style={styles.slipBuildText}>
              {parlayLegs.length < 2 ? 'Add 2+' : 'Build'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

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
                {modal.subjectName} — Game {modal.gameNumber}
              </Text>
              <Text style={styles.modalLine}>LINE: {modal.line.toFixed(1)}</Text>

              <View style={styles.pickToggle}>
                {(['over', 'under'] as Pick[]).map(p => {
                  // Anti-tanking: can't pick under on your own line.
                  const blocked = p === 'under' && modal.subjectPlayerId === playerId
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.pickToggleBtn,
                        modal.pick === p && styles.pickToggleBtnActive,
                        blocked && styles.pickToggleBtnDisabled,
                      ]}
                      onPress={() => {
                        if (blocked) { showToast("Believe in yourself man", 'error'); return }
                        setModal(m => m ? { ...m, pick: p } : m)
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickToggleBtnText, modal.pick === p && styles.pickToggleBtnTextActive]}>
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
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

              <Text style={styles.modalWarning}>⚠ Bets can't be canceled once placed.</Text>

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

      {/* Parlay confirm modal */}
      {parlayModalOpen && (
        <Modal visible transparent animationType="slide" onRequestClose={() => !placing && setParlayModalOpen(false)}>
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => !placing && setParlayModalOpen(false)}
            />
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>{parlayLegs.length}-Leg Parlay</Text>
              <Text style={styles.modalLine}>ALL LEGS MUST WIN · PAYS ×{parlayOdds}</Text>

              <View style={styles.parlayLegList}>
                {parlayLegs.map(leg => (
                  <View key={leg.marketId} style={styles.parlayLegRow}>
                    <Text style={styles.parlayLegText} numberOfLines={1}>
                      {leg.subjectName} · {leg.pick.toUpperCase()} {leg.line.toFixed(1)} · G{leg.gameNumber}
                    </Text>
                    <TouchableOpacity onPress={() => removeParlayLeg(leg.marketId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.parlayLegRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              <Text style={styles.wagerLabel}>WAGER (pins)</Text>
              <TextInput
                style={styles.wagerInput}
                value={parlayWager}
                onChangeText={v => setParlayWager(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder={`10 – ${maxWager}`}
                placeholderTextColor={colors.muted2}
                maxLength={6}
              />
              <Text style={styles.wagerHint}>
                Balance: {balance} pins  ·  Min: 10
                {parlayWager !== '' && !isNaN(parseInt(parlayWager, 10))
                  ? `  ·  To win: ${(Math.floor(parseInt(parlayWager, 10) * parlayOdds)).toLocaleString()}`
                  : ''}
              </Text>

              <Text style={styles.modalWarning}>⚠ Bets can't be canceled once placed.</Text>

              <TouchableOpacity
                style={[styles.placeBtn, placing && styles.placeBtnDisabled]}
                onPress={placeParlay}
                disabled={placing}
                activeOpacity={0.7}
              >
                {placing
                  ? <ActivityIndicator size="small" color={colors.bg} />
                  : <Text style={styles.placeBtnText}>Place Parlay</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
          <Toast />
        </Modal>
      )}

      {/* Bet details modal */}
      <BetDetailModal bet={detailModal} onClose={() => setDetailModal(null)} />
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
  moveUp: { fontSize: 11, color: colors.success },
  moveDown: { fontSize: 11, color: colors.danger },

  viewToggle: { marginBottom: 20 },

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
  lineRowInProgress: { opacity: 0.5 },
  inProgressNote: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.gold,
    marginBottom: 6,
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
  pickBtnSelected: { backgroundColor: colors.accent },
  pickBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  pickBtnTextSelected: { color: colors.bg },

  modeToggle: { marginBottom: 12 },

  // Parlay sticky slip
  slipBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  slipInfo: { flex: 1 },
  slipTitle: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  slipSub: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  slipClear: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  slipClearText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  slipBuild: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  slipBuildText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },

  // Parlay confirm modal leg list
  parlayLegList: { marginBottom: 16 },
  parlayLegRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  parlayLegText: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  parlayLegRemove: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.danger,
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

  adminHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: 10,
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
  pickToggleBtnDisabled: { borderColor: colors.border2, opacity: 0.4 },
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
  modalWarning: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.danger,
    marginBottom: 16,
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

  // Bet details modal
})
