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
import LineRow from '../components/LineRow'
import LineRowContainer from '../components/LineRowContainer'
import {
  usePinsinoData,
  selectionBetsAgainstSubject,
  lineGroup,
  lineCategory,
  closedBettingNote,
  type BetView,
  type LineView,
  type LineGroup,
  type LineCategory,
  type SelectionView,
} from '../hooks/usePinsinoData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { bets } from '../utils/supabase/db'
import { PinsinoStackParamList } from '../navigation/types'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

type View2 = 'leaderboard' | 'action' | 'place' | 'settled'
type PlaceMode = 'single' | 'parlay'

// One leg staged in the parlay bet slip. Generic over market_type — a leg is a
// chosen selection on a market, not an over/under-specific pick.
interface ParlayLeg {
  selectionId: string
  selectionKey: string
  selectionLabel: string
  marketId: string
  subjectName: string
  subjectPlayerId: string | null
  marketType: string
  gameNumber: number | null
  line: number | null
}

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'place', label: 'Place Bets' },
  { key: 'action', label: 'Active Bets' },
  { key: 'settled', label: 'Settled Bets' },
]

interface BetModalState {
  line: LineView
  selectedId: string | null
  wager: string
}

export default function PinsinoScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const playerName = useAuthStore(s => s.playerName)
  const { showToast } = useUiStore()
  const navigation = useNavigation<PinsinoNav>()

  const { loading, balance, openLines, myBets, weekBets, settledBets, leaderboard, reload } = usePinsinoData(playerId)
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

  // Two-level grouping for the board: game group (GAME 1, …, SEASON) → line
  // category (Player Over/Unders, …). Each category renders one collapsible
  // LineRowContainer, so a single game can carry several independently-collapsed
  // line types. Both levels are market-type-aware, so the screen stays agnostic.
  const lineGroups = useMemo(() => {
    const games = new Map<string, {
      group: LineGroup
      categories: Map<string, { category: LineCategory; lines: LineView[] }>
    }>()
    for (const line of openLines) {
      const group = lineGroup(line)
      let g = games.get(group.key)
      if (!g) { g = { group, categories: new Map() }; games.set(group.key, g) }
      const category = lineCategory(line)
      let c = g.categories.get(category.key)
      if (!c) { c = { category, lines: [] }; g.categories.set(category.key, c) }
      c.lines.push(line)
    }
    return Array.from(games.values())
      .sort((a, b) => a.group.sortOrder - b.group.sortOrder)
      .map(g => ({
        group: g.group,
        categories: Array.from(g.categories.values()).sort((a, b) => a.category.sortOrder - b.category.sortOrder),
      }))
  }, [openLines])

  // Anti-tanking, market-type-aware: backing the side that bets against your own
  // performance (the `under` on your own line) is blocked.
  function isSelfTank(line: LineView, sel: SelectionView): boolean {
    return line.subjectPlayerId === playerId && selectionBetsAgainstSubject(line.marketType, sel.key)
  }

  // Single mode: tapping a selection opens the wager sheet (pre-picked to that
  // side). Own-against side always toasts; below-min balance is a silent no-op.
  function onSingleSelect(line: LineView, sel: SelectionView) {
    if (isSelfTank(line, sel)) { showToast("Believe in yourself man", 'error'); return }
    if (balance < 10) return
    setModal({ line, selectedId: sel.selectionId, wager: '' })
  }

  async function placeBet() {
    if (!modal || !playerId) return
    const sel = modal.line.selections.find(s => s.selectionId === modal.selectedId)
    if (!sel) { showToast('Choose a selection', 'error'); return }
    // Hard constraint: no backing the side against your own performance (anti-tanking).
    if (isSelfTank(modal.line, sel)) { showToast("Believe in yourself man", 'error'); return }
    const wagerNum = parseInt(modal.wager, 10)
    if (isNaN(wagerNum) || wagerNum < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (wagerNum > balance) { showToast('Wager exceeds your balance', 'error'); return }

    setPlacing(true)
    try {
      // Atomic + balance-checked, server-side (place_house_bet RPC). The bettor is
      // resolved from the JWT and the double-entry stake ledger pair is written in
      // the same transaction — the client no longer writes any betting rows.
      const { error: betErr } = await bets.place([sel.selectionId], wagerNum)
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

  // Toggle a selection in/out of the slip. One selection per market.
  function toggleParlayLeg(line: LineView, sel: SelectionView) {
    if (isSelfTank(line, sel)) { showToast('Believe in yourself man', 'error'); return }

    setParlayLegs(prev => {
      const existing = prev.find(l => l.marketId === line.marketId)
      // Tapping the already-selected side removes the leg.
      if (existing && existing.selectionId === sel.selectionId) return prev.filter(l => l.marketId !== line.marketId)
      const without = prev.filter(l => l.marketId !== line.marketId)
      return [...without, {
        selectionId: sel.selectionId,
        selectionKey: sel.key,
        selectionLabel: sel.label,
        marketId: line.marketId,
        subjectName: line.subjectName,
        subjectPlayerId: line.subjectPlayerId,
        marketType: line.marketType,
        gameNumber: line.gameNumber,
        line: sel.line ?? line.line,
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
        {/* Balance card — tap to view your own betting record */}
        <TouchableOpacity
          style={styles.balanceCard}
          onPress={() => {
            if (playerId) navigation.navigate('PlayerPinsino', { playerId, name: playerName ?? 'Me' })
          }}
          activeOpacity={0.7}
          disabled={!playerId}
        >
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={styles.balanceValue}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceUnit}>PINS</Text>
        </TouchableOpacity>

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
                    onPress={() => navigation.navigate('PlayerPinsino', { playerId: p.playerId, name: p.name })}
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
        {lineGroups.length > 0 ? (
          <>
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>THIS WEEK'S LINES</Text>
            {lineGroups.map(({ group, categories }) => (
              <View key={group.key}>
                <Text style={styles.gameLabel}>{group.label}</Text>
                {categories.map(({ category, lines }) => {
                  // Closing is all-or-nothing per game, so a category is in
                  // progress once any of its lines is closed.
                  const groupInProgress = lines.some(l => l.inProgress)
                  return (
                    <LineRowContainer
                      key={category.key}
                      title={category.label}
                      count={lines.length}
                      note={groupInProgress ? closedBettingNote(lines[0]) : undefined}
                      defaultCollapsed
                      rows={lines.map(line => {
                        const slipLeg = parlayLegs.find(l => l.marketId === line.marketId)
                        return {
                          key: line.marketId,
                          // Keep a line visible while collapsed if it's in the
                          // parlay slip — lets players build across sections.
                          pinned: placeMode === 'parlay' && !!slipLeg,
                          render: (isLast: boolean) => (
                            <LineRow
                              line={line}
                              isLast={isLast}
                              inProgress={groupInProgress}
                              onSelect={sel =>
                                placeMode === 'parlay' ? toggleParlayLeg(line, sel) : onSingleSelect(line, sel)
                              }
                              selectionState={sel =>
                                placeMode === 'parlay'
                                  ? { selected: slipLeg?.selectionId === sel.selectionId, disabled: isSelfTank(line, sel) }
                                  : { disabled: balance < 10 || isSelfTank(line, sel) }
                              }
                            />
                          ),
                        }
                      })}
                    />
                  )
                })}
              </View>
            ))}
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
              {parlayLegs.map(l => `${l.subjectName} ${l.selectionLabel.toUpperCase()}`).join(' · ')}
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
                {modal.line.subjectName}
                {modal.line.gameNumber != null ? ` — Game ${modal.line.gameNumber}` : ''}
              </Text>
              {modal.line.line != null && (
                <Text style={styles.modalLine}>LINE: {modal.line.line.toFixed(1)}</Text>
              )}

              <View style={styles.pickToggle}>
                {modal.line.selections.map(sel => {
                  // Anti-tanking: can't back the side against your own performance.
                  const blocked = isSelfTank(modal.line, sel)
                  const active = modal.selectedId === sel.selectionId
                  return (
                    <TouchableOpacity
                      key={sel.selectionId}
                      style={[
                        styles.pickToggleBtn,
                        active && styles.pickToggleBtnActive,
                        blocked && styles.pickToggleBtnDisabled,
                      ]}
                      onPress={() => {
                        if (blocked) { showToast("Believe in yourself man", 'error'); return }
                        setModal(m => m ? { ...m, selectedId: sel.selectionId } : m)
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickToggleBtnText, active && styles.pickToggleBtnTextActive]}>
                        {(sel.label || sel.key).toUpperCase()}
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
                      {leg.subjectName} · {leg.selectionLabel.toUpperCase()}
                      {leg.line != null ? ` ${leg.line.toFixed(1)}` : ''}
                      {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
    marginTop: 8,
    marginBottom: 8,
  },

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
