import { Fragment, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import ToggleGroup from '../components/ui/ToggleGroup'
import Toast from '../components/ui/Toast'
import BetRow from '../components/betting/BetRow'
import ActiveBetsView from '../components/betting/ActiveBetsView'
import SettledBetsView from '../components/betting/SettledBetsView'
import BetDetailModal from '../components/betting/BetDetailModal'
import { resultBadge, betReturnText } from '../utils/bets'
import LineRow from '../components/betting/LineRow'
import LineRowContainer from '../components/betting/LineRowContainer'
import CustomLineRow from '../components/betting/CustomLineRow'
import Button from '../components/ui/Button'
import {
  usePinsinoData,
  selectionBetsAgainstSubject,
  customLineSelfTank,
  lineGroup,
  lineCategory,
  closedBettingNote,
  betLineSuffix,
  selectionButtonLabel,
  subjectRelation,
  type BetView,
  type LineView,
  type LineGroup,
  type LineCategory,
  type SelectionView,
  type CustomLineView,
} from '../hooks/usePinsinoData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { bets } from '../utils/supabase/db'
import { PinsinoStackParamList } from '../navigation/types'
import EmptyCard from '../components/ui/EmptyCard'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

type View2 = 'action' | 'place' | 'settled'
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
  statKey: string | null
}

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'place', label: 'Place Bets' },
  { key: 'action', label: 'Active Bets' },
  { key: 'settled', label: 'Settled Bets' },
]

interface BetModalState {
  line: LineView
  selectedId: string | null
  wager: string
}

// UI-only policy: the "under" side of player O/U lines is hidden from the
// Sportsbook. Betting on a leaguemate to do *poorly* has negative social
// dynamics in a small rec league, so we don't surface it as a pick. This is a
// pure presentation filter — the selection still exists in the DB and the
// place/settlement RPCs (`place_house_bet`, etc.) handle `under` unchanged, so
// the mechanic can be restored by removing this filter. See AGENTS.md.
function isSelectionHiddenInUI(line: LineView, sel: SelectionView): boolean {
  return (line.marketType === 'over_under' || line.marketType === 'prop') && sel.key === 'under'
}

// Drop UI-hidden selections from a line, returning the same object when nothing
// changes (keeps referential stability for memoization downstream).
function withVisibleSelections(line: LineView): LineView {
  const selections = line.selections.filter(s => !isSelectionHiddenInUI(line, s))
  return selections.length === line.selections.length ? line : { ...line, selections }
}

export default function SportsbookScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()
  const navigation = useNavigation<PinsinoNav>()

  const { loading, balance, openLines, weekTeams, customLines, myBets, weekBets, settledBets, reload } = usePinsinoData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<View2>('place')
  const [placeMode, setPlaceMode] = useState<PlaceMode>('single')
  const [parlayLegs, setParlayLegs] = useState<ParlayLeg[]>([])
  const [parlayModalOpen, setParlayModalOpen] = useState(false)
  const [parlayWager, setParlayWager] = useState('')
  const [modal, setModal] = useState<BetModalState | null>(null)
  const [placing, setPlacing] = useState(false)
  const [detailModal, setDetailModal] = useState<BetView | null>(null)
  // Wager sheet for taking a custom line ("special") — the whole bundle at once.
  const [takeModal, setTakeModal] = useState<{ line: CustomLineView; wager: string } | null>(null)

  // Active = this week's still-pending bets (settled ones move to Settled Bets).
  // The public tab is read-only: Active/Settled rows just open the details overlay
  // (settling/cancelling lives on the Pinsino Admin screen).
  const activeBets = useMemo(() => weekBets.filter(b => b.status === 'pending'), [weekBets])

  // Two-level grouping for the board: game group (GAME 1, …, SEASON) → line
  // category (Player Over/Unders, …). Each category renders one collapsible
  // LineRowContainer, so a single game can carry several independently-collapsed
  // line types. Both levels are market-type-aware, so the screen stays agnostic.
  //
  // Within a category, a subject's markets consolidate into ONE row: lines
  // sharing a subjectPlayerId render as a unified button set on that player
  // ("142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES"), ordered score line first
  // then stat props. Subject-less lines (moneyline) stay one row per market.
  // Player rows then group by their week team — the viewer's team first, the
  // remaining teams in first-appearance order — so teammates sit together.
  const lineGroups = useMemo(() => {
    const kindOrder = (l: LineView) =>
      l.marketType === 'over_under' ? 0
        : l.marketType === 'prop'
          ? 1 + ['strikes', 'spares', 'clean_pct', 'first_ball_avg'].indexOf(l.statKey ?? '')
          : 9
    const games = new Map<string, {
      group: LineGroup
      categories: Map<string, { category: LineCategory; rowMap: Map<string, LineView[]>; count: number }>
    }>()
    for (const rawLine of openLines) {
      // Strip UI-hidden selections (e.g. the "under" side) before the line ever
      // reaches the board, so it can't be picked, parlayed, or shown in the sheet.
      const line = withVisibleSelections(rawLine)
      if (line.selections.length === 0) continue
      const group = lineGroup(line)
      let g = games.get(group.key)
      if (!g) { g = { group, categories: new Map() }; games.set(group.key, g) }
      const category = lineCategory(line)
      let c = g.categories.get(category.key)
      if (!c) { c = { category, rowMap: new Map(), count: 0 }; g.categories.set(category.key, c) }
      const rowKey = line.subjectPlayerId ?? line.marketId
      const row = c.rowMap.get(rowKey)
      if (row) row.push(line)
      else c.rowMap.set(rowKey, [line])
      c.count += 1
    }
    return Array.from(games.values())
      .sort((a, b) => a.group.sortOrder - b.group.sortOrder)
      .map(g => ({
        group: g.group,
        categories: Array.from(g.categories.values())
          .sort((a, b) => a.category.sortOrder - b.category.sortOrder)
          .map(({ category, rowMap, count }) => {
            const rows = Array.from(rowMap.entries()).map(([key, lines]) => ({
              key,
              lines: lines.slice().sort((a, b) => kindOrder(a) - kindOrder(b)),
            }))
            // Group player rows by week team: viewer's team rank 0, the rest by
            // first appearance; teamless subjects (moneyline rows) keep place.
            const teamRank = new Map<string, number>()
            const rankOf = (row: { key: string }) => {
              const team = weekTeams.teamByPlayer[row.key]
              if (!team) return Number.MAX_SAFE_INTEGER
              if (team === weekTeams.myTeamId) return 0
              if (!teamRank.has(team)) teamRank.set(team, 1 + teamRank.size)
              return teamRank.get(team)!
            }
            const ranked = rows.map((row, idx) => ({ row, rank: rankOf(row), idx }))
            ranked.sort((a, b) => a.rank - b.rank || a.idx - b.idx)
            return { category, count, rows: ranked.map(r => r.row) }
          }),
      }))
  }, [openLines, weekTeams])

  // Custom lines ("specials") bucketed for the board: single-game lines render
  // inside that game's group; mixed-game lines — plus per-game lines whose game
  // group isn't on this viewer's board (e.g. all its legs are other matchups'
  // moneylines) — collect in the top-level SPECIALS section.
  const { customByGame, topSpecials } = useMemo(() => {
    const byGame = new Map<number, CustomLineView[]>()
    const top: CustomLineView[] = []
    const renderedGames = new Set(
      lineGroups.filter(g => g.group.key !== 'season').map(g => g.group.sortOrder)
    )
    for (const cl of customLines) {
      if (cl.gameNumber != null && renderedGames.has(cl.gameNumber)) {
        const arr = byGame.get(cl.gameNumber)
        if (arr) arr.push(cl)
        else byGame.set(cl.gameNumber, [cl])
      } else {
        top.push(cl)
      }
    }
    return { customByGame: byGame, topSpecials: top }
  }, [customLines, lineGroups])

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

  // ── Custom lines ("specials") ───────────────────────────────────────────
  // Taking a special wagers on the whole bundle at once — it never enters the
  // parlay slip (it already *is* a parlay when multi-leg), so the TAKE button
  // behaves identically in Single and Parlay modes.
  function onTakeCustom(line: CustomLineView) {
    if (customLineSelfTank(line, playerId)) { showToast("Believe in yourself man", 'error'); return }
    if (balance < 10) return
    setTakeModal({ line, wager: '' })
  }

  async function placeCustom() {
    if (!takeModal || !playerId) return
    const wagerNum = parseInt(takeModal.wager, 10)
    if (isNaN(wagerNum) || wagerNum < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (wagerNum > balance) { showToast('Wager exceeds your balance', 'error'); return }

    setPlacing(true)
    try {
      // Same atomic RPC as singles/parlays — the special is just its bundle of
      // selections; payout falls out of the legs' combined odds server-side.
      // The lineId tag snapshots the special's title/description onto the bet.
      const { error } = await bets.place(takeModal.line.selectionIds, wagerNum, takeModal.line.lineId)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Bet placed!', 'success')
      setTakeModal(null)
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
        statKey: line.statKey,
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

  // One subject row (≥1 markets → one button set), shared by the collapsible
  // (O/U) and headerless (moneyline) section layouts. Single mode opens the
  // wager sheet; parlay mode toggles the slip; an in-progress game makes every
  // side inert. Each button binds its own (line, selection).
  function renderLineSet(lines: LineView[], isLast: boolean, groupInProgress: boolean) {
    return (
      <LineRow
        lines={lines}
        isLast={isLast}
        relation={
          // Every moneyline on the player board is "Your Team" (toYourTeamMoneyline),
          // so it shares the teammate green — one color story for "your side".
          lines[0].marketType === 'moneyline'
            ? 'with'
            : subjectRelation(weekTeams, lines[0].subjectPlayerId, lines[0].gameNumber)
        }
        inProgress={groupInProgress}
        onSelect={(line, sel) =>
          placeMode === 'parlay' ? toggleParlayLeg(line, sel) : onSingleSelect(line, sel)
        }
        selectionState={(line, sel) =>
          placeMode === 'parlay'
            ? {
                selected: parlayLegs.some(l => l.selectionId === sel.selectionId),
                disabled: isSelfTank(line, sel),
              }
            : { disabled: balance < 10 || isSelfTank(line, sel) }
        }
      />
    )
  }

  // One card of custom-line rows, shared by the week-wide slot (top of the
  // board) and the per-game slot (top of each game group). No section header —
  // the rows' styling (gold for 'special') is the distinguishing mark.
  // Disabled (dim, still pressable → toast) mirrors LineRow.
  function renderSpecialsCard(lines: CustomLineView[], gameInProgress: boolean) {
    return (
      <View style={styles.card}>
        {lines.map((cl, idx) => (
          <CustomLineRow
            key={cl.id}
            line={cl}
            isLast={idx === lines.length - 1}
            inProgress={gameInProgress || cl.inProgress}
            disabled={balance < 10 || customLineSelfTank(cl, playerId)}
            onTake={() => onTakeCustom(cl)}
          />
        ))}
      </View>
    )
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          view === 'place' && placeMode === 'parlay' && parlayLegs.length > 0 && { paddingBottom: 96 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title="Sportsbook" onBack={() => navigation.goBack()} />

        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

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

        {/* Open lines — the board starts straight at its WEEKLY/GAME labels
            (no "this week" section header; that's implicit in the Sportsbook). */}
        {lineGroups.length > 0 || topSpecials.length > 0 ? (
          <View style={styles.board}>
            {/* Week-level specials (legs across games) lead the board under a
                WEEKLY header styled like the game labels. When night props exist
                they form their own WEEKLY group (first, below), so the specials
                render inside it instead of under a duplicate header here. */}
            {topSpecials.length > 0 && !lineGroups.some(g => g.group.key === 'weekly') && (
              <View>
                <Text style={styles.gameLabel}>WEEKLY</Text>
                {renderSpecialsCard(topSpecials, false)}
              </View>
            )}
            {lineGroups.map(({ group, categories }) => {
              // Starting a game closes every one of its markets at once, so the
              // in-progress warning is promoted to the game level: one note under
              // the game label, and every section below it rendered inert. Season
              // (non-game) markets close individually, so they keep the
              // per-section note instead.
              const gameInProgress =
                group.key !== 'season' &&
                categories.some(({ rows }) => rows.some(r => r.lines.some(l => l.inProgress)))
              return (
              <View key={group.key}>
                <Text style={styles.gameLabel}>{group.label}</Text>
                {gameInProgress && (
                  <Text style={styles.inProgressNote}>
                    {closedBettingNote(categories[0].rows[0].lines[0])}
                  </Text>
                )}
                {/* Week-level specials share the night props' WEEKLY group. */}
                {group.key === 'weekly' && topSpecials.length > 0 &&
                  renderSpecialsCard(topSpecials, gameInProgress)}
                {/* This game's custom lines lead its sections. */}
                {group.key !== 'season' && customByGame.has(group.sortOrder) &&
                  renderSpecialsCard(customByGame.get(group.sortOrder)!, gameInProgress)}
                {categories.map(({ category, rows, count }) => {
                  const groupInProgress =
                    gameInProgress || rows.some(r => r.lines.some(l => l.inProgress))
                  // Moneylines: headerless. The "Your Team" row is self-explanatory
                  // (one per game), so it renders inline with no collapsible header.
                  if (category.key === 'moneyline') {
                    return (
                      <View key={category.key}>
                        {groupInProgress && !gameInProgress && (
                          <Text style={styles.adminHint}>{closedBettingNote(rows[0].lines[0])}</Text>
                        )}
                        <View style={styles.card}>
                          {rows.map((row, idx) => (
                            <Fragment key={row.key}>
                              {renderLineSet(row.lines, idx === rows.length - 1, groupInProgress)}
                            </Fragment>
                          ))}
                        </View>
                      </View>
                    )
                  }
                  return (
                    <LineRowContainer
                      key={category.key}
                      title={category.label}
                      count={count}
                      note={groupInProgress && !gameInProgress ? closedBettingNote(rows[0].lines[0]) : undefined}
                      defaultCollapsed
                      disabled={gameInProgress}
                      rows={rows.map(row => ({
                        key: row.key,
                        // Keep a subject's row visible while collapsed if any of
                        // its lines is in the parlay slip — lets players build
                        // across sections.
                        pinned:
                          placeMode === 'parlay' &&
                          row.lines.some(l => parlayLegs.some(leg => leg.marketId === l.marketId)),
                        render: (isLast: boolean) => renderLineSet(row.lines, isLast, groupInProgress),
                      }))}
                    />
                  )
                })}
              </View>
              )
            })}
          </View>
        ) : (
          <EmptyCard text="No open lines this week" />
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
          <Button variant="ghost" label="Clear" onPress={() => setParlayLegs([])} style={styles.slipClear} />
          <Button
            label={parlayLegs.length < 2 ? 'Add 2+' : 'Build'}
            onPress={() => { if (parlayLegs.length >= 2) setParlayModalOpen(true) }}
            disabled={parlayLegs.length < 2}
            style={styles.slipBuild}
          />
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
              {/* Stat props carry the stat name in their subtitle ("STRIKES · LINE 4.5"). */}
              {modal.line.subtitle != null ? (
                <Text style={styles.modalLine}>{modal.line.subtitle}</Text>
              ) : modal.line.line != null ? (
                <Text style={styles.modalLine}>LINE: {modal.line.line.toFixed(1)}</Text>
              ) : null}

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
                        {selectionButtonLabel(modal.line, sel)}
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

              <Button label="Place Bet" size="lg" onPress={placeBet} loading={placing} disabled={placing} />
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
                      {betLineSuffix(leg.marketType, leg.line, leg.statKey)}
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

              <Button label="Place Parlay" size="lg" onPress={placeParlay} loading={placing} disabled={placing} />
            </View>
          </KeyboardAvoidingView>
          <Toast />
        </Modal>
      )}

      {/* Custom line ("special") take modal */}
      {takeModal && (
        <Modal visible transparent animationType="slide" onRequestClose={() => !placing && setTakeModal(null)}>
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => !placing && setTakeModal(null)}
            />
            <View style={styles.modalSheet}>
              <Text style={[styles.modalTitle, takeModal.line.category === 'special' && { color: colors.gold }]}>
                {takeModal.line.title}
              </Text>
              <Text style={styles.modalLine}>
                {takeModal.line.legs.length > 1 ? 'ALL LEGS MUST WIN · ' : ''}
                PAYS ×{takeModal.line.combinedOdds.toFixed(takeModal.line.combinedOdds % 1 === 0 ? 0 : 2)}
              </Text>

              <View style={styles.parlayLegList}>
                {takeModal.line.legs.map(leg => (
                  <View key={leg.selectionId} style={styles.parlayLegRow}>
                    <Text style={styles.parlayLegText} numberOfLines={1}>
                      {leg.subjectName} · {leg.pick.toUpperCase()}
                      {leg.marketType === 'over_under' && leg.line != null ? ` ${leg.line.toFixed(1)}` : ''}
                      {leg.gameNumber != null ? ` · G${leg.gameNumber}` : ''}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={styles.wagerLabel}>WAGER (pins)</Text>
              <TextInput
                style={styles.wagerInput}
                value={takeModal.wager}
                onChangeText={v => setTakeModal(m => m ? { ...m, wager: v.replace(/[^0-9]/g, '') } : m)}
                keyboardType="number-pad"
                placeholder={`10 – ${maxWager}`}
                placeholderTextColor={colors.muted2}
                maxLength={6}
              />
              <Text style={styles.wagerHint}>
                Balance: {balance} pins  ·  Min: 10
                {takeModal.wager !== '' && !isNaN(parseInt(takeModal.wager, 10))
                  ? `  ·  To win: ${(Math.floor(parseInt(takeModal.wager, 10) * takeModal.line.combinedOdds)).toLocaleString()}`
                  : ''}
              </Text>

              <Text style={styles.modalWarning}>⚠ Bets can't be canceled once placed.</Text>

              <Button label="Take It" size="lg" onPress={placeCustom} loading={placing} disabled={placing} />
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
  // Separates the board from MY BETS now that it has no section header of its
  // own — the WEEKLY/GAME labels lead directly.
  board: { marginTop: 16 },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
    marginTop: 8,
    marginBottom: 8,
  },
  // Game-level in-progress warning — same styling as LineRowContainer's note,
  // promoted above the game's sections when the whole game is closed.
  inProgressNote: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.gold,
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
  slipClear: { paddingHorizontal: 10, paddingVertical: 8 },
  slipBuild: { paddingHorizontal: 16, paddingVertical: 10 },

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
})
