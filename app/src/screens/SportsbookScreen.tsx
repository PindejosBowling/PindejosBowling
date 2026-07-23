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
import { colors, fonts, type } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import ArtworkToggle from '../components/ui/ArtworkToggle'
import SportsbookPokerTableBackdrop from '../components/pixelart/SportsbookPokerTableBackdrop'
import ScreenBackdrop from '../components/pixelart/ScreenBackdrop'
import ToggleGroup from '../components/ui/ToggleGroup'
import BalancePill from '../components/ui/BalancePill'
import ActiveBetsView from '../components/betting/ActiveBetsView'
import SettledBetsView from '../components/betting/SettledBetsView'
import BetDetailModal from '../components/betting/BetDetailModal'
import { useBetSlip, useBetSlipReload } from '../components/betting/BetSlipProvider'
import LineRow from '../components/betting/LineRow'
import LinePill, { conditionLabel, ValueField } from '../components/betting/LinePill'
import LineEntrySheet from '../components/betting/LineEntrySheet'
import CustomLineRow from '../components/betting/CustomLineRow'
import PickChip from '../components/betting/PickChip'
import BuilderBar from '../components/betting/BuilderBar'
import BookProjectionCard, { type ProjectionRow } from '../components/betting/BookProjectionCard'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import Dropdown from '../components/ui/Dropdown'
import FeatureExplainerSheet from '../components/pinsino/FeatureExplainerSheet'
import TermsBlock from '../components/ui/TermsBlock'
import { EXPLAINERS, TERMS } from '../data/pinsinoExplainers'
import {
  usePinsinoData,
  customLineSelfTank,
  customLegLabel,
  lineGroup,
  closedBettingNote,
  subjectRelation,
  withVisibleSelections,
  STAT_LABELS,
  type BetView,
  type LineView,
  type CustomLineView,
} from '../hooks/usePinsinoData'
import { useLinePreview, oddsForLine, type LineQuote } from '../hooks/useLinePreview'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { betMarkets, haunts } from '../utils/supabase/db'
import { fmtOdds, deltaDir } from '../utils/bets'
import { shortName } from '../utils/helpers'
import { PinsinoStackParamList } from '../navigation/types'
import EmptyCard from '../components/ui/EmptyCard'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

type View2 = 'action' | 'place' | 'settled'

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'place', label: 'Place' },
  { key: 'action', label: 'Active' },
  { key: 'settled', label: 'Settled' },
]

// The combo pane's line-type selector — the four combinable stats (the same
// vocabulary comboStatOf seeds from a tapped board line).
const COMBO_STAT_OPTIONS = [
  { key: 'total_pins', label: 'Pins' },
  { key: 'clean_frames', label: 'Clean' },
  { key: 'strikes', label: 'Strikes' },
  { key: 'spares', label: 'Spares' },
]

export default function SportsbookScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const { showToast } = useUiStore()
  const artworkReveal = useUiStore(s => s.artworkReveal)
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const navigation = useNavigation<PinsinoNav>()

  const { loading, balance, openLines, weekTeams, customLines, weekBets, settledBets, seasonNumber, readOnly, reload, currentWeekId, currentSeasonId, rsvpInPlayers, weekGameNumbers } = usePinsinoData(playerId, pinsinoViewSeasonId)
  const { refreshing, onRefresh } = useRefresh(reload)
  const insets = useSafeAreaInsets()

  const [view, setView] = useState<View2>('place')
  // Past-season review is read-only: only the season's settled bets are shown
  // (no Place/Active board, no bet slip reachable).
  const effectiveView: View2 = readOnly ? 'settled' : view
  // Unified bet slip: tapping any line stages an individual pick; tapping a
  // special stages its bundle. The slip places picks as singles/parlay and each
  // special as its own tagged bet; BetSlip owns the stake + item-toggle inputs.
  const [detailModal, setDetailModal] = useState<BetView | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  // Place-board filters: a scope (Weekly or one game) + a player. The board is
  // flat — it shows only the chosen player's lines for the chosen scope. The
  // player pick is the user's EXPLICIT choice; the effective selection is
  // derived in the board memo (pick while still available → viewer → first
  // available), so scope switches and reloads never need a reconciling effect.
  const [scope, setScope] = useState<string>('weekly')
  const [pickedPlayerId, setPickedPlayerId] = useState<string | null>(null)

  // Combine mode — board-native combo building. null = off; set = the pivot
  // is active (member picking + the combo pane, whose selector switches the
  // stat mid-build — there is no armed intermediate step anymore: the COMBO
  // chip lands directly in the pivot). Scope follows the board's scope
  // filter: Weekly → a night combo, Game N → that game.
  const [combo, setCombo] = useState<{ stat: string; members: Set<string> } | null>(null)
  const combining = combo != null

  // The bet slip (staged picks/specials, placement, item inventory, balance) is
  // owned by the app-level BetSlipProvider so it can also be raised from Bet
  // Details on other screens. The board feeds it staged picks and reads its
  // contents to highlight selected cells; a placement refreshes the board via
  // useBetSlipReload. `ghosts` (haunt inventory) also lives there.
  const {
    slipPicks,
    slipSpecials,
    slipCombos,
    stagePick: stageSlipPick,
    updateSlipPick,
    stageSpecial: stageSlipSpecial,
    stageCombo,
    setSlipBarHidden,
    ghosts,
    reloadInventory,
  } = useBetSlip()
  useBetSlipReload(reload)

  // Bets the viewer has already haunted (RLS returns only their own rows) — the
  // CTA disables on these. Plus the screen-level confirm sheet for a new haunt.
  const [hauntedBetIds, setHauntedBetIds] = useState<Set<string>>(new Set())
  const [hauntModal, setHauntModal] = useState<BetView | null>(null)

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

  // Under-hide applied once: strip UI-hidden selections (the "under" side)
  // before a line ever reaches the board, so it can't be picked, parlayed, or
  // shown in the sheet. Fully-hidden lines drop out.
  const visibleLines = useMemo(
    () => openLines.map(withVisibleSelections).filter(l => l.selections.length > 0),
    [openLines]
  )

  // Scope pills: Weekly (night-scoped markets) + one per scheduled game. The
  // keys are lineGroup keys, so matching a line to the scope reuses the
  // existing market-type seam (`lineGroup(line).key === scope`).
  const scopeOptions = useMemo(
    () => [
      { key: 'weekly', label: 'Weekly' },
      ...weekGameNumbers.map(n => ({ key: `game-${n}`, label: `Game ${n}` })),
    ],
    [weekGameNumbers]
  )

  // The flat board for the current filters: scope-filter the lines + specials,
  // derive the players who have anything to show in this scope (the picker's
  // option pool), resolve the effective selection, and collect the selected
  // player's rows. Membership rules: a combo shows when the player is one of
  // its members; a special when any leg is about them (self-referential
  // specials resolve their legs to the viewer's id, so they surface only under
  // the viewer's own entry). The player's own markets consolidate into ONE
  // row — a unified button set ("142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES"),
  // score line first then stat props — each combo renders as its own row.
  const board = useMemo(() => {
    const kindOrder = (l: LineView) =>
      // The score line leads the player's row; stat props follow in the shared
      // stat order (first_ball_avg is retired — legacy lines sink to the end).
      l.marketType === 'over_under' ? 0
        : l.marketType === 'prop'
          ? 1 + ['clean_frames', 'strikes', 'spares'].indexOf(l.statKey ?? '')
          : 9
    const specialScopeKey = (cl: CustomLineView) =>
      cl.gameNumber == null ? 'weekly' : `game-${cl.gameNumber}`
    const scopeLines = visibleLines.filter(l => lineGroup(l).key === scope)
    const scopeSpecials = customLines.filter(cl => specialScopeKey(cl) === scope)

    // Players with in-scope availability (own lines ∪ combo membership ∪
    // special involvement). Seeded from the RSVP roster first so real names
    // win over any resolved-leg display names ("You").
    const nameById = new Map<string, string>()
    for (const p of rsvpInPlayers) nameById.set(p.playerId, p.name)
    const available = new Set<string>()
    const add = (id: string | null | undefined, name?: string) => {
      if (!id) return
      if (!nameById.has(id) && name) nameById.set(id, name)
      if (nameById.has(id)) available.add(id)
    }
    for (const l of scopeLines) {
      // Full-name forms — the player dropdown is a full-name surface.
      add(l.subjectPlayerId, l.subjectFullName)
      l.comboMemberIds?.forEach((id, i) => add(id, l.comboMemberFullNames?.[i]))
    }
    for (const cl of scopeSpecials) for (const leg of cl.legs) add(leg.subjectPlayerId)
    const players = [...available]
      .map(id => ({ id, name: nameById.get(id)! }))
      .sort((a, b) => a.name.localeCompare(b.name))

    // Effective selection: an explicit pick survives while it's still
    // available; otherwise the viewer when they have lines in scope, else the
    // first available player, else none (→ the empty-scope card).
    const has = (id: string | null) => id != null && available.has(id)
    const selectedPlayerId = has(pickedPlayerId)
      ? pickedPlayerId
      : has(playerId) ? playerId : (players[0]?.id ?? null)

    const playerLines = scopeLines
      .filter(l => l.subjectPlayerId != null && l.subjectPlayerId === selectedPlayerId)
      .sort((a, b) => kindOrder(a) - kindOrder(b))
    const comboLines = scopeLines.filter(
      l => l.marketType === 'combo' &&
        selectedPlayerId != null &&
        (l.comboMemberIds ?? []).includes(selectedPlayerId)
    )
    const specials = scopeSpecials.filter(cl =>
      selectedPlayerId != null && cl.legs.some(leg => leg.subjectPlayerId === selectedPlayerId)
    )
    const firstInProgress = scopeLines.find(l => l.inProgress) ?? null
    return {
      players,
      selectedPlayerId,
      playerLines,
      comboLines,
      specials,
      // All in-scope lines — combine mode's solo-line lookups read these.
      scopeLines,
      // A closed market anywhere in scope locks the whole scope (a started
      // game closes all its markets together), mirroring the old group lock.
      firstInProgress,
      scopeInProgress: firstInProgress != null,
    }
  }, [visibleLines, customLines, scope, pickedPlayerId, playerId, rsvpInPlayers])

  // ── Combine mode derivations ──────────────────────────────────────────
  // The combo stat a board line seeds: the score O/U builds a total-pins
  // combo; a stat prop builds its own stat. Combos/specials can't seed.
  const comboStatOf = (l: LineView): string | null =>
    l.marketType === 'over_under' ? 'total_pins' : l.marketType === 'prop' ? l.statKey : null

  const comboMemberIds = useMemo(
    () => (combo != null ? [...combo.members].sort() : []),
    [combo]
  )
  const comboScopeGame = scope === 'weekly' ? null : Number(scope.slice('game-'.length))
  const comboNGames = scope === 'weekly' ? Math.max(weekGameNumbers.length, 1) : 1
  // Shared display derivations for the combine surfaces (bar + value sheet).
  const comboScopeLabel = scope === 'weekly' ? 'NIGHT' : `GAME ${comboScopeGame}`
  const comboStatLabel =
    combo != null ? (STAT_LABELS[combo.stat] ?? combo.stat).toUpperCase() : ''
  const comboMemberShortNames = useMemo(() => {
    const nameById = new Map(rsvpInPlayers.map(m => [m.playerId, m.name]))
    return comboMemberIds.map(id => shortName(nameById.get(id)))
  }, [comboMemberIds, rsvpInPlayers])
  // Canonical staging key — the same format ComboComposerSheet used, so
  // toggle-off dedup works against anything previously staged.
  const comboKey =
    combo != null
      ? `${combo.stat}|${scope === 'weekly' ? 'night' : comboScopeGame}|${comboMemberIds.join(',')}`
      : ''
  const comboAlreadyStaged = combining && slipCombos.some(c => c.key === comboKey)

  // The combo's edited value (null = the seed anchor) — resets whenever the
  // combo identity changes. Priced live by combo_price_line; the BuilderBar
  // shows it, the LineEntrySheet edits it.
  const [comboLineValue, setComboLineValue] = useState<number | null>(null)
  useEffect(() => { setComboLineValue(null) }, [comboKey])
  // Shared with the value sheet, which prices its draft off the same source.
  const comboSource = useMemo(
    () =>
      combo != null && currentSeasonId != null
        ? {
            kind: 'combo' as const,
            memberIds: comboMemberIds,
            stat: combo.stat,
            seasonId: currentSeasonId,
            nGames: comboNGames,
            weekId: currentWeekId,
            gameNumber: comboScopeGame,
          }
        : null,
    [combo?.stat, currentSeasonId, comboMemberIds, comboNGames, currentWeekId, comboScopeGame]
  )
  const { quote: comboQuote, loading: comboQuoteLoading } = useLinePreview(comboSource, comboLineValue)
  const shownComboValue = comboLineValue ?? comboQuote?.seedLine ?? null

  // Per-member per-game averages for the combine stat — the context that makes
  // combo pricing legible: the seed line anchors on the group's BOOK projection
  // (Σ floor(projected × games) + 0.5), so the averages show where the group's
  // actual production sits against that default. Display-only (server RPC).
  // `games` 0 = the avg shown is a fallback, not the player's own history.
  const [memberAvgs, setMemberAvgs] = useState<
    Record<string, { avg: number | null; source: string | null }>
  >({})
  // The book's per-game projection for the same members + stat — the second
  // number a combiner shops on: a member the book rates ABOVE their average
  // makes the combo line richer than the averages suggest. NULL when the
  // engine is off (the display just omits BOOK). Display-only.
  const [memberProjs, setMemberProjs] = useState<Record<string, number | null>>({})
  useEffect(() => {
    if (combo == null || currentSeasonId == null || rsvpInPlayers.length === 0) {
      setMemberAvgs({})
      setMemberProjs({})
      return
    }
    let cancelled = false
    const ids = rsvpInPlayers.map(m => m.playerId)
    betMarkets
      .comboMemberAverages(ids, combo.stat, currentSeasonId)
      .then(({ data }) => {
        if (cancelled || !data) return
        const next: Record<string, { avg: number | null; source: string | null }> = {}
        for (const r of data as { player_id: string; avg_per_game: number | null; source: string | null }[]) {
          next[r.player_id] = { avg: r.avg_per_game, source: r.source }
        }
        setMemberAvgs(next)
      })
    betMarkets
      .memberProjections(ids, combo.stat, currentSeasonId)
      .then(({ data }) => {
        if (cancelled || !data) return
        const next: Record<string, number | null> = {}
        for (const r of data as { player_id: string; projected: number | null }[]) {
          next[r.player_id] = r.projected
        }
        setMemberProjs(next)
      })
    return () => { cancelled = true }
  }, [combo?.stat, currentSeasonId, rsvpInPlayers]) // eslint-disable-line react-hooks/exhaustive-deps

  // A member's average scaled to the combo's scope (night → × games bowled).
  const scopedAvg = (playerId2: string): number | null => {
    const a = memberAvgs[playerId2]?.avg
    return a == null ? null : a * comboNGames
  }
  // The book's projection for a member, scaled the same way.
  const scopedProj = (playerId2: string): number | null => {
    const p = memberProjs[playerId2]
    return p == null ? null : p * comboNGames
  }
  // The picked group's combined scope-scaled average. A no-history member
  // contributes 0 here (nothing to average); the seed/pricing math instead
  // uses their prior-informed projection — the BOOK number beside it.
  const comboGroupAvg =
    comboMemberIds.length > 0 && Object.keys(memberAvgs).length > 0
      ? comboMemberIds.reduce((sum, id) => sum + (scopedAvg(id) ?? 0), 0)
      : null
  // The group's combined book projection — what the engine actually expects
  // the member set to produce (the number the quoted odds center on). Engine
  // on → every member has a projection (the prior covers cold starts), so a
  // null here means the engine is off and the display omits it.
  const comboGroupProj =
    comboMemberIds.length > 0 && comboMemberIds.every(id => scopedProj(id) != null)
      ? comboMemberIds.reduce((sum, id) => sum + scopedProj(id)!, 0)
      : null
  const comboOdds = oddsForLine(comboQuote, shownComboValue)

  // The pane's single-stat readout: the CHOSEN stat's group average vs book
  // projection — the SAME scope-scaled numbers the LineEntrySheet's
  // contextNote reads, so the two surfaces can never disagree. Arrow
  // semantics match the board strip — it rides the average and marks its
  // position vs the book (▼ = the group averages below what the book projects).
  const comboPaneStat =
    combining && (comboGroupAvg != null || comboGroupProj != null)
      ? { avg: comboGroupAvg, proj: comboGroupProj, dir: deltaDir(comboGroupAvg, comboGroupProj) }
      : null

  // The BuilderBar takes over the slip bar's footprint while combining.
  useEffect(() => {
    setSlipBarHidden(combining)
    return () => setSlipBarHidden(false)
  }, [combining, setSlipBarHidden])

  // Leaving the Place view (or flipping read-only) abandons any in-flight combo.
  useEffect(() => {
    if (effectiveView !== 'place' || readOnly) {
      setCombo(null)
    }
  }, [effectiveView, readOnly])

  function toggleComboMember(id: string) {
    setCombo(prev => {
      if (prev == null) return prev
      const members = new Set(prev.members)
      if (members.has(id)) members.delete(id)
      else members.add(id)
      return { ...prev, members }
    })
  }

  // Add (or, when this exact combo is already staged, remove) via the slip's
  // canonical toggle. Adding exits combine mode; the combo just lands in the
  // slip bar like any staged pick (no auto-raise of the placement sheet).
  function addComboToSlip() {
    if (combo == null || currentWeekId == null) return
    stageCombo({
      key: comboKey,
      weekId: currentWeekId,
      memberIds: comboMemberIds,
      memberNames: comboMemberShortNames,
      stat: combo.stat,
      scope: scope === 'weekly' ? 'night' : 'game',
      gameNumber: comboScopeGame,
      // The chosen VALUE + its quoted price — compose_combo_bet re-prices the
      // line authoritatively (quote_tolerance) and mints the rung if the
      // market doesn't carry it yet.
      line: shownComboValue,
      odds: comboOdds,
    })
    setCombo(null)
  }

  // Combine-mode member pool: every RSVP'd-in player (the compose RPC's only
  // eligibility rule — a player without an individual line still combines),
  // viewer first, then the roster's name order.
  const comboMemberPool = useMemo(() => {
    const rows = [...rsvpInPlayers]
    if (playerId) {
      const i = rows.findIndex(r => r.playerId === playerId)
      if (i > 0) {
        const [me] = rows.splice(i, 1)
        rows.unshift(me)
      }
    }
    return rows
  }, [rsvpInPlayers, playerId])

  // ── Book projection vs season average ─────────────────────────────────
  // The selected player's per-game engine projection (rounded mean) beside
  // their season average, cached per player. Display-only context — the
  // strip never stages or prices anything. Cache resets with the board
  // reload effect below so new history re-projects.
  const [projCache, setProjCache] = useState<Record<string, ProjectionRow[]>>({})
  const toProjectionRows = (data: unknown): ProjectionRow[] =>
    (data as {
      stat: string; projected: number | null; season_avg: number | null; avg_source: string | null
    }[]).map(r => ({
      stat: r.stat, projected: r.projected, seasonAvg: r.season_avg, avgSource: r.avg_source,
    }))
  const projPlayerId = effectiveView === 'place' && !readOnly ? board.selectedPlayerId : null
  useEffect(() => {
    if (projPlayerId == null || currentSeasonId == null || projCache[projPlayerId] != null) return
    let cancelled = false
    betMarkets.playerProjection(projPlayerId, currentSeasonId).then(({ data }) => {
      if (cancelled || !data) return
      setProjCache(prev => ({ ...prev, [projPlayerId]: toProjectionRows(data) }))
    })
    return () => { cancelled = true }
  }, [projPlayerId, currentSeasonId, projCache])

  // ── Value-first editing (via the LineEntrySheet) ──────────────────────
  // Per-market value overrides (the number the bettor accepted in the sheet)
  // + the accepted quote per market so custom (non-posted) values keep their
  // price on the board. Display-only; placement re-prices authoritatively
  // (quote_tolerance). Both reset on board reload so re-laddered seeds
  // re-anchor.
  const [lineValues, setLineValues] = useState<Record<string, number>>({})
  const [quoteCache, setQuoteCache] = useState<Record<string, LineQuote>>({})
  // The open value editor: a board market's pill, or the combine bar's combo.
  const [valueSheet, setValueSheet] = useState<
    { kind: 'market'; line: LineView } | { kind: 'combo' } | null
  >(null)
  // Keyed on a CONTENT signature, not the array identity — useAsyncData
  // returns a fresh payload object every reload (pull-to-refresh, placement),
  // and wiping the caches on identical board content would refetch the
  // projection strip for nothing.
  const boardSig = useMemo(
    () => openLines.map(l => `${l.marketId}:${l.line}`).join('|'),
    [openLines]
  )
  useEffect(() => {
    setLineValues({})
    setQuoteCache({})
    setValueSheet(null)
    setProjCache({})
  }, [boardSig])

  // The pill's anchor: the market's posted seed rung (canonical 'over' key).
  const seedOf = (line: LineView) =>
    line.selections.find(s => s.key === 'over')?.line ?? line.line ?? 0.5
  const postedAt = (line: LineView, value: number) =>
    line.selections.find(s => s.side === 'over' && s.line === value)
  // The pill's displayed value: staged pick → accepted edit → seed rung.
  const valueOf = (line: LineView) =>
    slipPicks.find(p => p.marketId === line.marketId)?.line
      ?? lineValues[line.marketId]
      ?? seedOf(line)

  // An accepted sheet value: record it + its quote, and re-stage a staged
  // pick at the new value (posted rung odds when it lands on one, else the
  // accepted quote's).
  function acceptLineValue(line: LineView, v: number, quote: LineQuote) {
    setLineValues(prev => ({ ...prev, [line.marketId]: v }))
    setQuoteCache(prev => ({ ...prev, [line.marketId]: quote }))
    const staged = slipPicks.find(p => p.marketId === line.marketId)
    if (staged && staged.line !== v) {
      const posted = postedAt(line, v)
      updateSlipPick(line.marketId, {
        line: v,
        selectionId: posted?.selectionId ?? null,
        selectionKey: posted?.key ?? 'over',
        odds: posted?.odds ?? quote.odds ?? staged.odds,
      })
    }
  }

  // Pill-body tap: stage/unstage at the displayed value with its displayed
  // price. The value drives everything — the odds just follow. Balance is
  // validated at placement, so a low balance still stages.
  function stagePickAtValue(line: LineView, value: number, odds: number | null) {
    if (readOnly) return
    if (odds == null) {
      showToast('That line is unavailable', 'error')
      return
    }
    const posted = postedAt(line, value)
    stageSlipPick({
      selectionId: posted?.selectionId ?? null,
      selectionKey: posted?.key ?? 'over',
      selectionLabel: 'Over',
      marketId: line.marketId,
      subjectName: line.subjectName,
      subjectPlayerId: line.subjectPlayerId,
      marketType: line.marketType,
      gameNumber: line.gameNumber,
      line: value,
      statKey: line.statKey,
      odds,
    })
  }

  // Tapping a special toggles its bundle in/out of the slip. Anti-tank toasts as
  // for a pick; low balance still stages (validated at placement). A special is a
  // pre-built bundle that always places as its OWN tagged bet — never merged as a
  // parlay leg (that would forfeit its custom_line_id branding + curated odds).
  function stageSpecial(line: CustomLineView) {
    if (readOnly) return
    if (customLineSelfTank(line, playerId)) { showToast('Believe in yourself man', 'error'); return }
    stageSlipSpecial({
      key: line.id,
      lineId: line.lineId,
      title: line.title,
      category: line.category,
      summary: line.legs.map(customLegLabel).join('  ·  '),
      selectionIds: line.selectionIds,
      combinedOdds: line.combinedOdds,
      multiLeg: line.legs.length > 1,
    })
  }

  // One subject row (≥1 markets → one card of value-first pills) — a player's
  // consolidated lines or a single combo. Each pill shows a tap-to-type value with its
  // live price; tapping the body stages the displayed value (staged = filled);
  // an in-progress scope makes every pill inert. Combos tint neutral
  // automatically (subjectRelation of a null subject).
  function renderLineSet(lines: LineView[], groupInProgress: boolean) {
    return (
      <LineRow
        lines={lines}
        relation={subjectRelation(weekTeams, lines[0].subjectPlayerId, lines[0].gameNumber)}
        inProgress={groupInProgress}
        renderPill={line => {
          const staged = slipPicks.find(p => p.marketId === line.marketId)
          const value = valueOf(line)
          const posted = postedAt(line, value)
          const cached = quoteCache[line.marketId]
          // Price resolution: posted rung → staged snapshot → the quote
          // accepted in the value sheet.
          const odds = posted?.odds
            ?? (staged != null && staged.line === value ? staged.odds : null)
            ?? (cached != null && cached.line === value ? cached.odds : null)
          return (
            <LinePill
              line={line}
              value={value}
              odds={odds}
              staged={staged != null}
              dimmed={balance < 10}
              inert={groupInProgress || line.inProgress || readOnly}
              onEditValue={() => setValueSheet({ kind: 'market', line })}
              onStage={() => stagePickAtValue(line, value, odds)}
            />
          )
        }}
      />
    )
  }

  // The scope's custom lines as a stack of ticket cards leading the board. No
  // section header — the tickets' styling (gold for 'special') is the
  // distinguishing mark. Disabled (dim, still pressable → toast) mirrors LineRow.
  function renderSpecialsCard(lines: CustomLineView[], gameInProgress: boolean) {
    return (
      <View>
        {lines.map(cl => (
          <CustomLineRow
            key={cl.id}
            line={cl}
            inProgress={gameInProgress || cl.inProgress}
            disabled={balance < 10 || customLineSelfTank(cl, playerId)}
            selected={slipSpecials.some(s => s.key === cl.id)}
            onTake={() => stageSpecial(cl)}
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
        // Value entry lives in the LineEntrySheet (its own modal), so the
        // board itself never raises the keyboard — 'handled' kept so any
        // future inline input doesn't reintroduce dead first-taps.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top },
          effectiveView === 'place' &&
            (slipPicks.length > 0 || slipSpecials.length > 0 || slipCombos.length > 0 || combining) &&
            { paddingBottom: 96 },
        ]}
        refreshControl={
          loading ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
          )
        }
      >
        <ScreenBackdrop backdrop={<SportsbookPokerTableBackdrop />} loading={loading}>
        <ScreenHeader title="Sportsbook" onBack={() => navigation.goBack()} right={<ArtworkToggle />} onHelp={() => setHelpOpen(true)} />

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
        {/* The flat board: scope pills + Combine chip + player select, then
            the chosen player's available lines for that scope. The filters
            ARE the navigation — no collapsible sections. Staged picks live in
            the global slip bar, so building a parlay across players/scopes is
            just switching the filters. */}
        {visibleLines.length > 0 || customLines.length > 0 ? (
          <View style={styles.board}>
            <View style={styles.filterRow}>
              <ToggleGroup
                variant="pill"
                options={scopeOptions}
                value={scope}
                onChange={setScope}
                style={styles.scopePills}
              />
              {/* Combine — board-native combo building. Dim-but-pressable
                  below 2 RSVP'd players (house convention: still toasts).
                  The chip lands DIRECTLY in the pivot (no intermediate
                  step): a stat pick already staged in the slip pre-seeds the
                  stat + first member (most recent staged pick wins when
                  several qualify), else the pane opens on Total Pins with
                  nobody picked — the pane's selector switches stat either
                  way. */}
              {currentWeekId != null && currentSeasonId != null && (
                <PickChip
                  label="COMBO"
                  selected={combo != null}
                  disabled={rsvpInPlayers.length < 2}
                  onPress={() => {
                    if (rsvpInPlayers.length < 2) {
                      showToast("Not enough players RSVP'd in yet", 'error')
                      return
                    }
                    setCombo(prev => {
                      if (prev) return null
                      const seed = [...slipPicks].reverse().find(
                        p => p.marketType === 'over_under' || (p.marketType === 'prop' && p.statKey != null)
                      )
                      if (seed) {
                        return {
                          stat: seed.marketType === 'over_under' ? 'total_pins' : seed.statKey!,
                          members: new Set(seed.subjectPlayerId ? [seed.subjectPlayerId] : []),
                        }
                      }
                      return { stat: 'total_pins', members: new Set() }
                    })
                  }}
                />
              )}
            </View>
            {combo != null ? (
              // ── Stat-view pivot: pick the combo's members ──────────────
              // Pool = every RSVP'd-in player (combos need only RSVP); a
              // member's own line for this stat shows as context when one
              // exists. Scope pills stay live — switching re-previews the line.
              <>
                <Text style={styles.combineHint}>TAP PLAYERS TO COMBINE</Text>
                {board.scopeInProgress && board.firstInProgress && (
                  <Text style={styles.inProgressNote}>
                    {closedBettingNote(board.firstInProgress)}
                  </Text>
                )}
                {/* The consolidated combo pane: pick the line type, see/edit
                    the value with its live price, and read the group's
                    Average vs Book for THAT stat only. Switching stat is a
                    combo-identity change — the value re-anchors to the new
                    seed, the quote/averages refetch, and the member rows'
                    solo lines follow. */}
                <View style={styles.comboPane}>
                  <ToggleGroup
                    variant="pill"
                    options={COMBO_STAT_OPTIONS}
                    value={combo.stat}
                    onChange={k => setCombo(prev => prev && { ...prev, stat: k })}
                  />
                  <View style={styles.comboPaneRow}>
                    {!board.scopeInProgress &&
                      (comboMemberIds.length >= 2 && shownComboValue != null ? (
                        <>
                          <ValueField
                            text={`${shownComboValue.toFixed(1)}+`}
                            size="lg"
                            onPress={() => setValueSheet({ kind: 'combo' })}
                          />
                          <Text style={styles.comboValueOdds}>
                            {comboQuoteLoading ? '…' : comboOdds != null ? fmtOdds(comboOdds) : '—'}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.comboPanePlaceholder}>PICK 2+ PLAYERS</Text>
                      ))}
                    {/* The chosen stat's group Average vs Book (scope-scaled),
                        same reading as the board strip: the arrow rides the
                        average and marks its position vs the book. */}
                    {comboPaneStat != null && (
                      <View style={styles.comboPaneStats}>
                        <View style={styles.comboPaneAvgRow}>
                          <Text style={styles.comboPaneAvg}>
                            AVG {comboPaneStat.avg != null ? comboPaneStat.avg.toFixed(1) : '—'}
                          </Text>
                          {comboPaneStat.dir != null && (
                            <Text
                              style={
                                comboPaneStat.dir === 'up'
                                  ? styles.comboPaneDeltaUp
                                  : styles.comboPaneDeltaDown
                              }
                            >
                              {comboPaneStat.dir === 'up' ? '▲' : '▼'}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.comboPaneBook}>
                          FORECAST {comboPaneStat.proj != null ? comboPaneStat.proj.toFixed(1) : '—'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <View>
                  {comboMemberPool.map(m => {
                    const on = combo.members.has(m.playerId)
                    const solo = board.scopeLines.find(
                      l => l.subjectPlayerId === m.playerId && comboStatOf(l) === combo.stat
                    )
                    // The player's scope-scaled average — the number their
                    // share of a combo line is really priced against — and the
                    // book's projection beside it: a member the book rates
                    // above their average (▲) makes the combo line richer than
                    // the averages suggest; below (▼), softer.
                    const avgEntry = memberAvgs[m.playerId]
                    const avgShown = scopedAvg(m.playerId)
                    const projShown = scopedProj(m.playerId)
                    // Here the arrow rides the BOOK: ▲ = the book rates the
                    // member above their average (same shared dead band).
                    const projDir = deltaDir(projShown, avgShown)
                    return (
                      <View key={m.playerId} style={styles.memberRow}>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>
                            {m.name}{m.playerId === playerId ? ' (you)' : ''}
                          </Text>
                          {avgEntry != null && (
                            <Text style={styles.memberAvg}>
                              {avgShown == null
                                ? 'NO STAT HISTORY'
                                : avgEntry.source === 'season'
                                  ? `SEASON AVG ${avgShown.toFixed(1)}`
                                  : avgEntry.source === 'lifetime'
                                    ? `LIFETIME AVG ${avgShown.toFixed(1)}`
                                    : `LEAGUE AVG ${avgShown.toFixed(1)}`}
                              {/* Sub-line FORECAST only when the big slot holds a
                                  solo line — line-less rows show the forecast big
                                  instead (no duplicate). */}
                              {projShown != null && solo?.line != null && (
                                <>
                                  {'  ·  '}
                                  <Text style={styles.memberProj}>FORECAST {projShown.toFixed(1)}</Text>
                                  {projDir != null && (
                                    <Text
                                      style={
                                        projDir === 'up'
                                          ? styles.memberProjUp
                                          : styles.memberProjDown
                                      }
                                    >
                                      {projDir === 'up' ? ' ▲' : ' ▼'}
                                    </Text>
                                  )}
                                </>
                              )}
                            </Text>
                          )}
                        </View>
                        {/* The big value a combiner shops on: the player's own
                            line for this stat when one exists, else the book's
                            projection — each captioned directly above its
                            number so a BOOK value can't read as a line. */}
                        <View style={styles.memberValueCol}>
                          {(solo?.line != null || projShown != null) && (
                            <Text style={styles.memberValueLabel}>
                              {solo?.line != null ? 'SOLO LINE' : 'FORECAST'}
                            </Text>
                          )}
                          <Text
                            style={[
                              styles.memberSoloValue,
                              solo?.line == null && projShown == null && styles.memberSoloNone,
                            ]}
                          >
                            {solo?.line != null
                              ? `${solo.line.toFixed(1)}+`
                              : projShown != null ? projShown.toFixed(1) : '—'}
                          </Text>
                        </View>
                        <PickChip
                          label={on ? '✓' : '+'}
                          selected={on}
                          onPress={() => toggleComboMember(m.playerId)}
                        />
                      </View>
                    )
                  })}
                </View>
              </>
            ) : (
              // ── The player-filtered board ──────────────────────────────
              <>
                {/* Player filter — a full-width anchored dropdown of the
                    players with in-scope availability. */}
                {board.selectedPlayerId != null && (
                  <Dropdown
                    options={board.players.map(p => ({
                      key: p.id,
                      label: `${p.name}${p.id === playerId ? ' (you)' : ''}`,
                    }))}
                    value={board.selectedPlayerId}
                    onChange={setPickedPlayerId}
                    style={styles.playerSelect}
                  />
                )}
                {/* What the book expects from the selected player this week
                    against what they actually average — scope-scaled like the
                    lines beneath it (Weekly = × the night's games). Self-hides
                    when the engine has no opinion. */}
                {board.selectedPlayerId != null && projCache[board.selectedPlayerId] != null && (
                  <BookProjectionCard
                    rows={projCache[board.selectedPlayerId]}
                    nGames={comboNGames}
                    scopeLabel={scope === 'weekly' ? 'WEEKLY' : `GAME ${comboScopeGame}`}
                  />
                )}
                {board.selectedPlayerId == null ? (
                  // Nobody has lines in this scope (they may in another — the
                  // pills stay tappable above).
                  <EmptyCard
                    text={`No ${scopeOptions.find(o => o.key === scope)?.label ?? ''} lines are open yet`}
                  />
                ) : (
                  <>
                    {board.scopeInProgress && board.firstInProgress && (
                      <Text style={styles.inProgressNote}>
                        {closedBettingNote(board.firstInProgress)}
                      </Text>
                    )}
                    {/* Specials lead (their styling is the distinguishing mark),
                        then the player's consolidated row, then their combos. */}
                    {board.specials.length > 0 && renderSpecialsCard(board.specials, board.scopeInProgress)}
                    {(board.playerLines.length > 0 || board.comboLines.length > 0) && (
                      <View>
                        {[
                          ...(board.playerLines.length > 0 ? [board.playerLines] : []),
                          ...board.comboLines.map(c => [c]),
                        ].map(lines => (
                          <View key={lines[0].subjectPlayerId ?? lines[0].marketId}>
                            {renderLineSet(lines, board.scopeInProgress || lines.some(l => l.inProgress))}
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </>
            )}
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

      {/* The unified bet slip (persistent bar → placement sheet) is rendered by
          the app-level BetSlipProvider, so it can be raised from Bet Details on
          any screen. The board just feeds/reads it. */}

      {/* Combine-mode builder bar — takes the slip bar's footprint while a
          combo is being built (the provider hides the slip bar meanwhile). */}
      {combining && (
        <BuilderBar
          memberNames={comboMemberShortNames}
          statLabel={comboStatLabel}
          scopeLabel={comboScopeLabel}
          value={shownComboValue}
          odds={comboOdds}
          noQuote={comboQuote == null}
          quoteLoading={comboQuoteLoading}
          minMembers={comboMemberIds.length >= 2}
          alreadyStaged={comboAlreadyStaged}
          blocked={board.scopeInProgress}
          onAdd={addComboToSlip}
          onCancel={() => setCombo(null)}
        />
      )}

      {/* Value-entry sheet — one instance serves both board pills and the
          combine bar (conditional-mount so state resets between opens). */}
      {valueSheet?.kind === 'market' && (
        <LineEntrySheet
          title={valueSheet.line.subjectFullName}
          conditionLabel={conditionLabel(valueSheet.line)}
          scopeLabel={valueSheet.line.gameNumber != null ? `GAME ${valueSheet.line.gameNumber}` : 'WEEKLY'}
          source={{ kind: 'market', marketId: valueSheet.line.marketId }}
          initialValue={valueOf(valueSheet.line)}
          onAccept={(v, quote) => {
            acceptLineValue(valueSheet.line, v, quote)
            setValueSheet(null)
          }}
          onClose={() => setValueSheet(null)}
        />
      )}
      {valueSheet?.kind === 'combo' && comboSource != null && shownComboValue != null && (
        <LineEntrySheet
          title={comboMemberShortNames.join(' + ')}
          conditionLabel={comboStatLabel}
          scopeLabel={comboScopeLabel}
          contextNote={
            comboGroupAvg != null
              ? comboGroupProj != null
                ? `Group avg ${comboGroupAvg.toFixed(1)} · forecast ${comboGroupProj.toFixed(1)} — lines above the forecast pay longer odds`
                : `Group average: ${comboGroupAvg.toFixed(1)} — lines above it pay longer odds`
              : undefined
          }
          source={comboSource}
          initialValue={shownComboValue}
          onAccept={v => {
            setComboLineValue(v)
            setValueSheet(null)
          }}
          onClose={() => setValueSheet(null)}
        />
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
          onDone={() => { reloadInventory(); reloadHaunts() }}
        >
          <Text style={styles.hauntSheetCopy}>
            Spend 1 Ghost in the Slip to secretly attach it to this pending bet.
          </Text>
          <TermsBlock terms={TERMS.haunt} />
        </ConfirmActionSheet>
      )}
      {helpOpen && (
        <FeatureExplainerSheet explainer={EXPLAINERS.sportsbook} onClose={() => setHelpOpen(false)} />
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

  // Separates the board from the mode toggle above it — the filters lead
  // directly (no section header of its own).
  board: { marginTop: 16 },
  // The board filters: scope pills + the trailing Combine chip, then the
  // player select field beneath.
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  scopePills: { flex: 1, justifyContent: 'flex-start' },
  // Full-width dropdown trigger (SeasonDropdown's spacing idiom).
  playerSelect: {
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 12,
  },
  // Combine-mode helper line (armed hint / stat-view heading).
  combineHint: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.accent,
    marginBottom: 10,
    textAlign: 'center',
  },
  // The consolidated combo pane — stat selector on top, then value field +
  // odds + the chosen stat's AVG-vs-BOOK readout. Field chip mirrors the
  // board pills' input-field affordance.
  comboPane: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceTint,
    marginBottom: 8,
    gap: 10,
  },
  comboPaneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  comboPanePlaceholder: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.muted2,
  },
  comboPaneStats: { flex: 1, alignItems: 'flex-end' },
  comboPaneAvgRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  comboPaneAvg: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.5,
  },
  comboPaneDeltaUp: { fontSize: 9, color: colors.success },
  comboPaneDeltaDown: { fontSize: 9, color: colors.danger },
  comboPaneBook: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted,
    marginTop: 1,
  },
  comboValueOdds: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 17,
    color: colors.accent,
  },
  // Stat-view member rows — same tinted-row language as the board's LineRow.
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceTint,
    marginBottom: 8,
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  // The member's own line for the combo's stat — the deciding number, so it
  // gets the big accent value treatment; "—" (muted size stays) when the
  // player has no individual market for this stat.
  // The member's scope-scaled average (the number their share of the combo
  // line prices against) — context under the name.
  memberAvg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted,
    marginTop: 1,
  },
  // The book's projection segment of the average line (nested Texts) — the
  // ▲/▼ colors by direction vs the average.
  memberProj: { color: colors.text },
  memberProjUp: { color: colors.success, fontSize: 9 },
  memberProjDown: { color: colors.danger, fontSize: 9 },
  // The right-aligned value column: a tiny caption (SOLO LINE / BOOK PROJ.)
  // directly over the big number it describes.
  memberValueCol: { alignItems: 'flex-end', marginRight: 4 },
  memberValueLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.muted,
  },
  memberSoloValue: {
    ...type.value,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  memberSoloNone: { color: colors.muted2 },
  // Scope-level in-progress warning — shown above the rows when any in-scope
  // market is closed for betting.
  inProgressNote: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.gold,
    marginBottom: 8,
  },

  hauntSheetCopy: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
})
