import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
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
import BalancePill from '../components/ui/BalancePill'
import ActiveBetsView from '../components/betting/ActiveBetsView'
import SettledBetsView from '../components/betting/SettledBetsView'
import BetDetailModal from '../components/betting/BetDetailModal'
import WagerSheet from '../components/betting/WagerSheet'
import BetSlip, { type SlipPick, type SinglesSubmit, type ParlaySubmit } from '../components/betting/BetSlip'
import GoldenTicketToggle from '../components/auction/GoldenTicketToggle'
import WinnersCrutchToggle from '../components/auction/WinnersCrutchToggle'
import EnergyDrinkToggle from '../components/auction/EnergyDrinkToggle'
import LineRow from '../components/betting/LineRow'
import LineRowContainer from '../components/betting/LineRowContainer'
import CustomLineRow from '../components/betting/CustomLineRow'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import {
  usePinsinoData,
  selectionBetsAgainstSubject,
  customLineSelfTank,
  lineGroup,
  lineCategory,
  closedBettingNote,
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
import { bets, haunts, inventoryItems, seasons } from '../utils/supabase/db'
import { PinsinoStackParamList } from '../navigation/types'
import EmptyCard from '../components/ui/EmptyCard'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

type View2 = 'action' | 'place' | 'settled'

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'place', label: 'Place' },
  { key: 'action', label: 'Active' },
  { key: 'settled', label: 'Settled' },
]

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
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const navigation = useNavigation<PinsinoNav>()

  const { loading, balance, openLines, weekTeams, customLines, weekBets, settledBets, seasonNumber, readOnly, reload } = usePinsinoData(playerId, pinsinoViewSeasonId)
  const { refreshing, onRefresh } = useRefresh(reload)
  const insets = useSafeAreaInsets()

  const [view, setView] = useState<View2>('place')
  // Past-season review is read-only: only the season's settled bets are shown
  // (no Place/Active board, no bet slip reachable).
  const effectiveView: View2 = readOnly ? 'settled' : view
  // Unified bet slip: tapping any line stages a pick here; the slip places them
  // as singles (per-pick stake) or one parlay (combined odds).
  const [slipPicks, setSlipPicks] = useState<SlipPick[]>([])
  const [slipOpen, setSlipOpen] = useState(false)
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

  // Ghosts in the Slip (auction-won adversarial item): unconsumed
  // attach_to_foreign_bet items, oldest first — a haunt spends ghosts[0]. Unlike
  // the others these attach to ANOTHER player's pending bet, from Bet Details.
  const [ghosts, setGhosts] = useState<string[]>([])
  // Bets the viewer has already haunted (RLS returns only their own rows) — the
  // CTA disables on these. Plus the screen-level confirm sheet for a new haunt.
  const [hauntedBetIds, setHauntedBetIds] = useState<Set<string>>(new Set())
  const [hauntModal, setHauntModal] = useState<BetView | null>(null)

  const reloadTickets = useCallback(async () => {
    // Inventory items are live-season only — skip entirely in past-season review.
    if (!playerId || readOnly) { setTickets([]); setCrutches([]); setBoosts([]); setGhosts([]); return }
    const { data: season } = await seasons.getCurrent()
    if (!season) { setTickets([]); setCrutches([]); setBoosts([]); setGhosts([]); return }
    const { data } = await inventoryItems.listByPlayerSeason(playerId, season.id)
    const unconsumed = (data ?? [])
      .filter((i: any) => i.consumed_at == null)
      .sort((a: any, b: any) => a.granted_at.localeCompare(b.granted_at))
    const attachable = unconsumed.filter((i: any) => i.item_catalog?.activation_mode === 'attach_to_bet')
    setTickets(attachable.filter((i: any) => i.item_catalog?.effect_type === 'bet_insurance').map((i: any) => i.id))
    setCrutches(attachable.filter((i: any) => i.item_catalog?.effect_type === 'parlay_crutch').map((i: any) => i.id))
    const boostRows = attachable.filter((i: any) => i.item_catalog?.effect_type === 'odds_boost')
    setBoosts(boostRows.map((i: any) => i.id))
    setBoostPct(boostRows.length ? Number((boostRows[0].item_catalog?.effect_params as any)?.boost_pct ?? 1) : 1)
    setGhosts(unconsumed.filter((i: any) => i.item_catalog?.effect_type === 'haunt').map((i: any) => i.id))
  }, [playerId, readOnly])

  useEffect(() => { reloadTickets() }, [reloadTickets])

  const reloadHaunts = useCallback(async () => {
    if (!playerId || readOnly) { setHauntedBetIds(new Set()); return }
    const { data } = await haunts.listMine(playerId)
    setHauntedBetIds(new Set((data ?? []).map((r: any) => r.bet_id)))
  }, [playerId, readOnly])

  useEffect(() => { reloadHaunts() }, [reloadHaunts])

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

  // First non-in-progress group opens by default, so the board lands with live
  // action visible instead of a wall of collapsed bars; the rest start collapsed.
  const firstOpenGroupKey = useMemo(() => {
    const g = lineGroups.find(grp =>
      !(grp.group.key !== 'season' &&
        grp.categories.some(({ rows }) => rows.some(r => r.lines.some(l => l.inProgress)))))
    return g?.group.key
  }, [lineGroups])

  // Anti-tanking, market-type-aware: backing the side that bets against your own
  // performance (the `under` on your own line) is blocked.
  function isSelfTank(line: LineView, sel: SelectionView): boolean {
    return line.subjectPlayerId === playerId && selectionBetsAgainstSubject(line.marketType, sel.key)
  }

  // Tapping any selection toggles it in/out of the unified slip. One selection
  // per market; own-against side always toasts (anti-tank). Balance is validated
  // at placement, so a low balance still stages (the cell is cosmetically dimmed).
  function stagePick(line: LineView, sel: SelectionView) {
    if (readOnly) return
    if (isSelfTank(line, sel)) { showToast('Believe in yourself man', 'error'); return }
    setSlipPicks(prev => {
      const existing = prev.find(p => p.marketId === line.marketId)
      // Tapping the already-staged side removes it.
      if (existing && existing.selectionId === sel.selectionId) {
        return prev.filter(p => p.marketId !== line.marketId)
      }
      const without = prev.filter(p => p.marketId !== line.marketId)
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
        odds: sel.odds ?? 2,
      }]
    })
  }

  function removeSlipPick(marketId: string) {
    setSlipPicks(prev => prev.filter(p => p.marketId !== marketId))
  }

  // Singles: each staged pick placed as its own bet, sequentially. Item
  // attachment is offered only for a lone single (BetSlip enforces this), so at
  // most one bet carries a ticket/boost. Reports partial placement on failure.
  async function placeSingles({ entries, insure, boost }: SinglesSubmit) {
    if (readOnly || !playerId || entries.length === 0) return
    const total = entries.reduce((s, e) => s + e.stake, 0)
    if (entries.some(e => e.stake < 10)) { showToast('Minimum stake is 10 pins', 'error'); return }
    if (total > balance) { showToast('Total stake exceeds your balance', 'error'); return }

    setPlacing(true)
    let placed = 0
    try {
      for (const { pick, stake } of entries) {
        const { error } = await bets.place(
          [pick.selectionId], stake, undefined,
          insure ? tickets[0] : undefined, undefined, boost ? boosts[0] : undefined)
        if (error) {
          showToast(placed > 0 ? `Placed ${placed} — then: ${error.message}` : error.message, 'error')
          return
        }
        placed += 1
      }
      showToast(entries.length > 1 ? `${placed} bets placed!` : (insure ? 'Bet placed — Golden Ticket attached!' : 'Bet placed!'), 'success')
      setSlipPicks([])
      setSlipOpen(false)
    } catch {
      showToast('Failed to place bets', 'error')
    } finally {
      setPlacing(false)
      await Promise.all([reload(), reloadTickets()])
    }
  }

  // ── Custom lines ("specials") ───────────────────────────────────────────
  // Taking a special wagers on the whole bundle at once — it never enters the
  // parlay slip (it already *is* a parlay when multi-leg), so the TAKE button
  // behaves identically in Single and Parlay modes.
  function onTakeCustom(line: CustomLineView) {
    if (readOnly) return
    if (customLineSelfTank(line, playerId)) { showToast("Believe in yourself man", 'error'); return }
    if (balance < 10) return
    setInsureBet(false)
    setUseCrutch(false)
    setUseBoost(false)
    setTakeModal({ line, wager: '' })
  }

  async function placeCustom() {
    if (readOnly) return
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

  // ── Parlay (from the unified slip) ──────────────────────────────────────
  // All selections sit at even money (2.000), so the fair combined odds of an
  // N-leg parlay = 2^N and payout = floor(stake × 2^N). Push/void legs drop out
  // at settlement (handled server-side), recomputing over the surviving legs.
  async function placeParlay({ stake, insure, crutch, boost }: ParlaySubmit) {
    if (readOnly || !playerId) return
    if (slipPicks.length < 2) { showToast('A parlay needs at least 2 legs', 'error'); return }
    if (stake < 10) { showToast('Minimum wager is 10 pins', 'error'); return }
    if (stake > balance) { showToast('Wager exceeds your balance', 'error'); return }

    setPlacing(true)
    try {
      const { error } = await bets.place(
        slipPicks.map(p => p.selectionId), stake, undefined,
        insure ? tickets[0] : undefined, crutch ? crutches[0] : undefined,
        boost ? boosts[0] : undefined)
      if (error) { showToast(error.message, 'error'); return }
      showToast(insure ? 'Parlay placed — Golden Ticket attached!' : 'Parlay placed!', 'success')
      setSlipPicks([])
      setSlipOpen(false)
      await Promise.all([reload(), reloadTickets()])
    } catch {
      showToast('Failed to place parlay', 'error')
    } finally {
      setPlacing(false)
    }
  }

  // One subject row (≥1 markets → one button set), shared by the collapsible
  // (O/U) and headerless (moneyline) section layouts. Tapping a cell stages it
  // in the unified slip (staged = filled); an in-progress game makes every side
  // inert. Each button binds its own (line, selection).
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
        onSelect={stagePick}
        selectionState={(line, sel) => ({
          selected: slipPicks.some(p => p.selectionId === sel.selectionId),
          disabled: balance < 10 || isSelfTank(line, sel),
        })}
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
          effectiveView === 'place' && slipPicks.length > 0 && { paddingBottom: 96 },
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
        {readOnly && <ReadOnlySeasonBanner seasonNumber={seasonNumber} />}

        {/* Always-visible balance (as on every other Pinsino screen) — hidden in
            past-season review, where there's nothing to wager. */}
        {!readOnly && <BalancePill balance={balance} />}

        {/* View switcher — one full-width segmented control (Place/Active/Settled);
            hidden in past-season review (settled bets only). */}
        {!readOnly && (
          <View style={styles.viewToggle}>
            <ToggleGroup variant="bar" options={VIEW_OPTIONS} value={view} onChange={setView} />
          </View>
        )}

        {/* ── Active Bets (read-only; tap a row for details) ──── */}
        {effectiveView === 'action' && (
          <ActiveBetsView
            bets={activeBets}
            myBets={myActiveBets}
            onBetPress={setDetailModal}
            onParlayPress={setDetailModal}
            hauntedBetIds={hauntedBetIds}
          />
        )}

        {/* ── Place Bets ──────────────────────────────────────── */}
        {effectiveView === 'place' && <>
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
                    // Keep a subject's row visible while collapsed if any of its
                    // lines is staged in the slip — lets players build across
                    // collapsed games.
                    pinned: row.lines.some(l => slipPicks.some(p => p.marketId === l.marketId)),
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
                    // The first live group opens; the rest start collapsed as
                    // summary bars over the poker table.
                    defaultCollapsed={group.key !== firstOpenGroupKey}
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
        {effectiveView === 'settled' && (
          <SettledBetsView bets={settledBets} onBetPress={setDetailModal} />
        )}
        </View>
        </ScreenBackdrop>
      </ScrollView>

      {/* Unified bet slip — persistent bar → placement sheet (singles/parlay). */}
      {effectiveView === 'place' && !readOnly && slipPicks.length > 0 && (
        <BetSlip
          picks={slipPicks}
          open={slipOpen}
          onOpenChange={setSlipOpen}
          onRemovePick={removeSlipPick}
          onClear={() => { setSlipPicks([]); setSlipOpen(false) }}
          balance={balance}
          placing={placing}
          ticketCount={tickets.length}
          crutchCount={crutches.length}
          boostCount={boosts.length}
          boostPct={boostPct}
          onPlaceSingles={placeSingles}
          onPlaceParlay={placeParlay}
        />
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
      <BetDetailModal
        bet={detailModal}
        onClose={() => setDetailModal(null)}
        canHaunt={
          !!detailModal &&
          detailModal.status === 'pending' &&
          detailModal.playerId !== playerId &&
          ghosts.length > 0 &&
          !hauntedBetIds.has(detailModal.id)
        }
        alreadyHaunted={!!detailModal && hauntedBetIds.has(detailModal.id)}
        onRequestHaunt={() => { const b = detailModal; setDetailModal(null); setHauntModal(b) }}
      />

      {/* Ghost in the Slip — screen-level confirm (kept out of the detail modal to
          avoid nesting BottomSheet inside an RN Modal). */}
      {hauntModal && (
        <ConfirmActionSheet
          title="Ghost in the Slip 👻"
          subtitle={`Secretly haunt ${hauntModal.bettorName}'s bet`}
          confirmLabel="Haunt this bet"
          confirmVariant="gold"
          action={() => haunts.create(hauntModal.id, ghosts[0])}
          successMessage="👻 The slip is haunted — you'll cash if it wins"
          failureMessage="Couldn't haunt this bet"
          onClose={() => setHauntModal(null)}
          onDone={() => { reloadTickets(); reloadHaunts() }}
        >
          <Text style={styles.hauntSheetCopy}>
            Spend 1 Ghost in the Slip to secretly attach it to this pending bet. If the bet
            wins, you take the profit — the bettor keeps only their stake. If other ghosts are
            on it too, the profit splits evenly. Spent the moment you attach it, win or lose.
          </Text>
        </ConfirmActionSheet>
      )}
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

  // Special ("take") sheet leg list — read-only leg rows.
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
  hauntSheetCopy: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
})
