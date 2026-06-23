import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import ArtworkToggle from '../components/ui/ArtworkToggle'
import SportsbookPokerTableBackdrop from '../components/pixelart/SportsbookPokerTableBackdrop'
import ScreenBackdrop from '../components/pixelart/ScreenBackdrop'
import ToggleGroup from '../components/ui/ToggleGroup'
import ActiveBetsView from '../components/betting/ActiveBetsView'
import SettledBetsView from '../components/betting/SettledBetsView'
import BetDetailModal from '../components/betting/BetDetailModal'
import WagerSheet from '../components/betting/WagerSheet'
import GoldenTicketToggle from '../components/auction/GoldenTicketToggle'
import WinnersCrutchToggle from '../components/auction/WinnersCrutchToggle'
import EnergyDrinkToggle from '../components/auction/EnergyDrinkToggle'
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
import { bets, inventoryItems, seasons } from '../utils/supabase/db'
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
  const artworkReveal = useUiStore(s => s.artworkReveal)
  const navigation = useNavigation<PinsinoNav>()

  const { loading, balance, openLines, weekTeams, customLines, weekBets, settledBets, reload } = usePinsinoData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)
  const insets = useSafeAreaInsets()

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

  // Golden Tickets (auction-won bet insurance): unconsumed attach_to_bet items,
  // oldest first — the toggle consumes tickets[0]. Default OFF per sheet open;
  // spending a scarce item is always a deliberate act.
  const [tickets, setTickets] = useState<string[]>([])
  const [insureBet, setInsureBet] = useState(false)

  // Winner's Crutches (auction-won parlay insurance): unconsumed attach_to_bet
  // items, oldest first — the toggle consumes crutches[0]. Parlay flows only.
  const [crutches, setCrutches] = useState<string[]>([])
  const [useCrutch, setUseCrutch] = useState(false)

  // Energy Drinks (auction-won profit doubler): unconsumed attach_to_bet items,
  // oldest first — the toggle consumes boosts[0]. Works on any bet. boostPct is
  // the oldest drink's profit multiplier (catalog effect_params), driving the
  // boosted to-win preview.
  const [boosts, setBoosts] = useState<string[]>([])
  const [boostPct, setBoostPct] = useState(1)
  const [useBoost, setUseBoost] = useState(false)

  const reloadTickets = useCallback(async () => {
    if (!playerId) { setTickets([]); setCrutches([]); setBoosts([]); return }
    const { data: season } = await seasons.getCurrent()
    if (!season) { setTickets([]); setCrutches([]); setBoosts([]); return }
    const { data } = await inventoryItems.listByPlayerSeason(playerId, season.id)
    const attachable = (data ?? [])
      .filter((i: any) => i.consumed_at == null && i.item_catalog?.activation_mode === 'attach_to_bet')
      .sort((a: any, b: any) => a.granted_at.localeCompare(b.granted_at))
    setTickets(attachable.filter((i: any) => i.item_catalog?.effect_type === 'bet_insurance').map((i: any) => i.id))
    setCrutches(attachable.filter((i: any) => i.item_catalog?.effect_type === 'parlay_crutch').map((i: any) => i.id))
    const boostRows = attachable.filter((i: any) => i.item_catalog?.effect_type === 'odds_boost')
    setBoosts(boostRows.map((i: any) => i.id))
    setBoostPct(boostRows.length ? Number((boostRows[0].item_catalog?.effect_params as any)?.boost_pct ?? 1) : 1)
  }, [playerId])

  useEffect(() => { reloadTickets() }, [reloadTickets])

  // Active = this week's still-pending bets (settled ones move to Settled Bets).
  // The public tab is read-only: Active/Settled rows just open the details overlay
  // (settling/cancelling lives on the Pinsino Admin screen).
  const activeBets = useMemo(() => weekBets.filter(b => b.status === 'pending'), [weekBets])

  // The viewer's slice of the active board — their own current-week pending bets.
  // Surfaced as a MY BETS section atop Active Bets; Place Bets is purely for placing.
  const myActiveBets = useMemo(() => activeBets.filter(b => b.playerId === playerId), [activeBets, playerId])

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
    setInsureBet(false)
    setUseBoost(false)
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
      const { error: betErr } = await bets.place(
        [sel.selectionId], wagerNum, undefined,
        insureBet ? tickets[0] : undefined, undefined, useBoost ? boosts[0] : undefined)
      if (betErr) { showToast(betErr.message, 'error'); return }

      showToast(insureBet ? 'Bet placed — Golden Ticket attached!' : 'Bet placed!', 'success')
      setModal(null)
      await Promise.all([reload(), reloadTickets()])
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
    setInsureBet(false)
    setUseCrutch(false)
    setUseBoost(false)
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
      // A crutch only applies to a multi-leg special (it's already a parlay).
      const crutchId = useCrutch && takeModal.line.legs.length > 1 ? crutches[0] : undefined
      const { error } = await bets.place(
        takeModal.line.selectionIds, wagerNum, takeModal.line.lineId,
        insureBet ? tickets[0] : undefined, crutchId, useBoost ? boosts[0] : undefined)
      if (error) { showToast(error.message, 'error'); return }
      showToast(insureBet ? 'Bet placed — Golden Ticket attached!' : 'Bet placed!', 'success')
      setTakeModal(null)
      await Promise.all([reload(), reloadTickets()])
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
      const { error } = await bets.place(
        parlayLegs.map(l => l.selectionId), wagerNum, undefined,
        insureBet ? tickets[0] : undefined, useCrutch ? crutches[0] : undefined,
        useBoost ? boosts[0] : undefined)
      if (error) { showToast(error.message, 'error'); return }
      showToast(insureBet ? 'Parlay placed — Golden Ticket attached!' : 'Parlay placed!', 'success')
      setParlayModalOpen(false)
      setParlayLegs([])
      setParlayWager('')
      await Promise.all([reload(), reloadTickets()])
    } catch {
      showToast('Failed to place parlay', 'error')
    } finally {
      setPlacing(false)
    }
  }

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

  return (
    <View style={styles.safe}>
      {/* Safe-area inset is content padding rather than a SafeAreaView edge so
          the poker-table field paints under the status bar to the bezel.
          ScreenBackdrop keeps the one poker-table instance mounted across the
          load→ready swap — see pixelart/config.ts. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top },
          view === 'place' && placeMode === 'parlay' && parlayLegs.length > 0 && { paddingBottom: 96 },
        ]}
        refreshControl={
          loading ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
          )
        }
      >
        <ScreenBackdrop backdrop={<SportsbookPokerTableBackdrop />} loading={loading}>
        <ScreenHeader title="Sportsbook" onBack={() => navigation.goBack()} right={<ArtworkToggle />} />

        {/* Kept laid out (not unmounted) while artwork is revealed — only made
            invisible + inert — so the poker table, which measures the scroll
            content height, stays full-length instead of collapsing. */}
        <View
          pointerEvents={artworkReveal ? 'none' : 'auto'}
          style={artworkReveal ? styles.artHidden : undefined}
        >
        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

        {/* ── Active Bets (read-only; tap a row for details) ──── */}
        {view === 'action' && (
          <ActiveBetsView
            bets={activeBets}
            myBets={myActiveBets}
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
              // ONE collapsible per outer group — "Weekly Overs", "Game 1",
              // "Game 2", … — holding everything that used to sit under the
              // group's text header: its specials, the moneyline row, and the
              // team-grouped player rows (in category sort order).
              const gameInProgress =
                group.key !== 'season' &&
                categories.some(({ rows }) => rows.some(r => r.lines.some(l => l.inProgress)))
              const specials = group.key === 'weekly'
                ? topSpecials
                : group.key !== 'season' ? customByGame.get(group.sortOrder) ?? [] : []
              const title = group.key === 'weekly'
                ? 'Weekly Overs'
                : group.key === 'season' ? 'Season' : `Game ${group.sortOrder}`
              const lineCount =
                specials.length + categories.reduce((n, c) => n + c.count, 0)
              const containerRows = [
                ...specials.map(cl => ({
                  key: cl.id,
                  render: (isLast: boolean) => (
                    <CustomLineRow
                      line={cl}
                      isLast={isLast}
                      inProgress={gameInProgress || cl.inProgress}
                      disabled={balance < 10 || customLineSelfTank(cl, playerId)}
                      onTake={() => onTakeCustom(cl)}
                    />
                  ),
                })),
                ...categories.flatMap(({ rows }) =>
                  rows.map(row => ({
                    key: row.key,
                    // Keep a subject's row visible while collapsed if any of
                    // its lines is in the parlay slip — lets players build
                    // across collapsed games.
                    pinned:
                      placeMode === 'parlay' &&
                      row.lines.some(l => parlayLegs.some(leg => leg.marketId === l.marketId)),
                    render: (isLast: boolean) =>
                      renderLineSet(
                        row.lines,
                        isLast,
                        gameInProgress || row.lines.some(l => l.inProgress),
                      ),
                  })),
                ),
              ]
              return (
                <View key={group.key}>
                  {/* Game started: the container locks collapsed, so the
                      in-progress note renders above the bar. */}
                  {gameInProgress && (
                    <Text style={styles.inProgressNote}>
                      {closedBettingNote(categories[0].rows[0].lines[0])}
                    </Text>
                  )}
                  <LineRowContainer
                    title={title}
                    count={lineCount}
                    // Every group starts as a collapsed summary bar — the
                    // board opens as a stack of headers over the poker table.
                    defaultCollapsed
                    disabled={gameInProgress}
                    rows={containerRows}
                  />
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
        </View>
        </ScreenBackdrop>
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
            onPress={() => { if (parlayLegs.length >= 2) { setInsureBet(false); setUseCrutch(false); setUseBoost(false); setParlayModalOpen(true) } }}
            disabled={parlayLegs.length < 2}
            style={styles.slipBuild}
          />
        </View>
      )}

      {/* Bet placement sheet (single) — pick toggle + live payout (WagerSheet). */}
      {modal && (
        <WagerSheet
          title={`${modal.line.subjectName}${modal.line.gameNumber != null ? ` — Game ${modal.line.gameNumber}` : ''}`}
          oddsPrefix={
            modal.line.subtitle != null
              ? `${modal.line.subtitle} · `
              : modal.line.line != null
                ? `LINE: ${modal.line.line.toFixed(1)} · `
                : ''
          }
          odds={modal.line.selections.find(s => s.selectionId === modal.selectedId)?.odds ?? 2}
          wager={modal.wager}
          onChangeWager={wager => setModal(m => m ? { ...m, wager } : m)}
          balance={balance}
          ctaLabel="Place Bet"
          onSubmit={placeBet}
          boostPct={useBoost ? boostPct : undefined}
          busy={placing}
          onClose={() => setModal(null)}
        >
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
          <GoldenTicketToggle ticketCount={tickets.length} enabled={insureBet} onToggle={setInsureBet} disabled={placing} />
          <EnergyDrinkToggle boostCount={boosts.length} enabled={useBoost} onToggle={setUseBoost} disabled={placing} />
        </WagerSheet>
      )}

      {/* Parlay confirm sheet — removable leg list + live payout. */}
      {parlayModalOpen && (
        <WagerSheet
          title={`${parlayLegs.length}-Leg Parlay`}
          oddsPrefix="ALL LEGS MUST WIN · "
          odds={parlayOdds}
          wager={parlayWager}
          onChangeWager={setParlayWager}
          balance={balance}
          ctaLabel="Place Parlay"
          onSubmit={placeParlay}
          boostPct={useBoost ? boostPct : undefined}
          busy={placing}
          onClose={() => setParlayModalOpen(false)}
        >
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
          <GoldenTicketToggle ticketCount={tickets.length} enabled={insureBet} onToggle={setInsureBet} disabled={placing} />
          <WinnersCrutchToggle crutchCount={crutches.length} enabled={useCrutch} onToggle={setUseCrutch} disabled={placing} />
          <EnergyDrinkToggle boostCount={boosts.length} enabled={useBoost} onToggle={setUseBoost} disabled={placing} />
        </WagerSheet>
      )}

      {/* Custom line ("special") take sheet — read-only leg list + live payout. */}
      {takeModal && (
        <WagerSheet
          title={takeModal.line.title}
          titleColor={takeModal.line.category === 'special' ? colors.gold : undefined}
          oddsPrefix={takeModal.line.legs.length > 1 ? 'ALL LEGS MUST WIN · ' : ''}
          odds={takeModal.line.combinedOdds}
          wager={takeModal.wager}
          onChangeWager={wager => setTakeModal(m => m ? { ...m, wager } : m)}
          balance={balance}
          ctaLabel="Take It"
          onSubmit={placeCustom}
          boostPct={useBoost ? boostPct : undefined}
          busy={placing}
          onClose={() => setTakeModal(null)}
        >
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
          <GoldenTicketToggle ticketCount={tickets.length} enabled={insureBet} onToggle={setInsureBet} disabled={placing} />
          {takeModal.line.legs.length > 1 && (
            <WinnersCrutchToggle crutchCount={crutches.length} enabled={useCrutch} onToggle={setUseCrutch} disabled={placing} />
          )}
          <EnergyDrinkToggle boostCount={boosts.length} enabled={useBoost} onToggle={setUseBoost} disabled={placing} />
        </WagerSheet>
      )}

      {/* Bet details modal */}
      <BetDetailModal bet={detailModal} onClose={() => setDetailModal(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Artwork-reveal: hide the foreground but keep it laid out (see render note).
  artHidden: { opacity: 0 },
  // flexGrow keeps the scroll content (and the poker-table border measured
  // from it) at least viewport-height when every group is collapsed.
  content: { paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 },

  viewToggle: { marginBottom: 20 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  // Separates the board from the mode toggle above it — the board has no section
  // header of its own; the WEEKLY/GAME labels lead directly.
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

  // Bet sheet pick toggle (body passed into WagerSheet)
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
})
