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
import { colors, fonts } from '../theme'
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
import LinePill, { conditionLabel } from '../components/betting/LinePill'
import LineEntrySheet from '../components/betting/LineEntrySheet'
import CustomLineRow from '../components/betting/CustomLineRow'
import PickChip from '../components/betting/PickChip'
import ComboLineRow, { type ComboStatSpec } from '../components/betting/ComboLineRow'
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
import { type LineQuote, type LinePreviewSource } from '../hooks/useLinePreview'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { betMarkets, haunts } from '../utils/supabase/db'
import { deltaDir } from '../utils/bets'
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

// The four combinable stats, in board column order — combo mode renders one
// value-first pill (and one group-projection column) per entry.
const COMBO_STATS = ['total_pins', 'clean_frames', 'strikes', 'spares']
const comboStatLabel = (stat: string) => (STAT_LABELS[stat] ?? stat).toUpperCase()

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

  // Combo mode — an inline board toggle, not a separate surface. On, the
  // board keeps its exact shape and only the SUBJECT changes: the player
  // dropdown becomes a multi-select member chip row, the projection card sums
  // the picked group, and the line card offers one value-first pill per
  // combinable stat (each with its own live quote). Scope follows the board's
  // scope filter: Weekly → a night combo, Game N → that game.
  const [comboMode, setComboMode] = useState(false)
  const [comboMembers, setComboMembers] = useState<Set<string>>(new Set())
  // Per-stat values accepted in the LineEntrySheet (absent = the seed anchor).
  // Reset whenever the combo identity (members/scope) changes.
  const [comboValues, setComboValues] = useState<Record<string, number>>({})

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
    removeSlipCombo,
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
      // A closed market anywhere in scope locks the whole scope (a started
      // game closes all its markets together), mirroring the old group lock.
      firstInProgress,
      scopeInProgress: firstInProgress != null,
    }
  }, [visibleLines, customLines, scope, pickedPlayerId, playerId, rsvpInPlayers])

  // ── Combo mode derivations ────────────────────────────────────────────
  const comboMemberIds = useMemo(() => [...comboMembers].sort(), [comboMembers])
  const comboScopeGame = scope === 'weekly' ? null : Number(scope.slice('game-'.length))
  const comboNGames = scope === 'weekly' ? Math.max(weekGameNumbers.length, 1) : 1
  const comboScopeLabel = scope === 'weekly' ? 'NIGHT' : `GAME ${comboScopeGame}`
  const comboMemberShortNames = useMemo(() => {
    const nameById = new Map(rsvpInPlayers.map(m => [m.playerId, m.name]))
    return comboMemberIds.map(id => shortName(nameById.get(id)))
  }, [comboMemberIds, rsvpInPlayers])

  // Canonical staging key per stat — the same format the composer always used,
  // so toggle-off dedup works against anything previously staged.
  const comboMembersKey = comboMemberIds.join(',')
  const comboKeyFor = (stat: string) =>
    `${stat}|${scope === 'weekly' ? 'night' : comboScopeGame}|${comboMembersKey}`
  const stagedComboFor = (stat: string) => slipCombos.find(c => c.key === comboKeyFor(stat))

  // A combo-identity change (members or scope) re-anchors every stat's value
  // to its fresh seed.
  useEffect(() => { setComboValues({}) }, [comboMembersKey, scope])

  // The pricing source for one stat's pill/sheet — each ComboStatPill owns its
  // own useLinePreview over this, so the four stats quote independently.
  const comboSourceFor = (stat: string): LinePreviewSource =>
    currentSeasonId != null
      ? {
          kind: 'combo',
          memberIds: comboMemberIds,
          stat,
          seasonId: currentSeasonId,
          nGames: comboNGames,
          weekId: currentWeekId,
          gameNumber: comboScopeGame,
        }
      : null

  // Per-member per-game averages + book projections for ALL four combinable
  // stats across the whole RSVP pool, fetched once when combo mode opens (8
  // parallel STABLE reads). Member toggles and stat switches are then pure
  // client-side re-sums — no refetch. The averages make combo pricing legible:
  // the seed line anchors on the group's BOOK projection, so they show where
  // actual production sits against that default. Display-only (server RPCs
  // stay authoritative for money).
  const [poolStats, setPoolStats] = useState<
    Record<string, Record<string, { avg: number | null; source: string | null; proj: number | null }>>
  >({})
  useEffect(() => {
    if (!comboMode || currentSeasonId == null || rsvpInPlayers.length === 0) {
      setPoolStats({})
      return
    }
    let cancelled = false
    const ids = rsvpInPlayers.map(m => m.playerId)
    for (const stat of COMBO_STATS) {
      Promise.all([
        betMarkets.comboMemberAverages(ids, stat, currentSeasonId),
        betMarkets.memberProjections(ids, stat, currentSeasonId),
      ]).then(([avgRes, projRes]) => {
        if (cancelled) return
        const entry: Record<string, { avg: number | null; source: string | null; proj: number | null }> = {}
        for (const r of (avgRes.data ?? []) as { player_id: string; avg_per_game: number | null; source: string | null }[]) {
          entry[r.player_id] = { avg: r.avg_per_game, source: r.source, proj: null }
        }
        for (const r of (projRes.data ?? []) as { player_id: string; projected: number | null }[]) {
          entry[r.player_id] = { ...(entry[r.player_id] ?? { avg: null, source: null }), proj: r.projected }
        }
        setPoolStats(prev => ({ ...prev, [stat]: entry }))
      })
    }
    return () => { cancelled = true }
  }, [comboMode, currentSeasonId, rsvpInPlayers])

  // The picked group's per-game sums, one ProjectionRow per combinable stat —
  // the SINGLE source both the group BookProjectionCard and the LineEntrySheet
  // contextNote read, so the two surfaces can never disagree. Average: a
  // no-history member contributes 0 (nothing to average); the pricing math
  // instead uses their prior-informed projection — the FORECAST beside it.
  // Projection: engine on → every member has one (the prior covers cold
  // starts), so a null means the engine is off (the card then self-hides).
  const groupRows = useMemo<ProjectionRow[]>(
    () =>
      COMBO_STATS.map(stat => {
        const entry = poolStats[stat] ?? {}
        const avgs = comboMemberIds.map(id => entry[id]?.avg ?? null)
        const projs = comboMemberIds.map(id => entry[id]?.proj ?? null)
        return {
          stat,
          seasonAvg:
            comboMemberIds.length > 0 && avgs.some(a => a != null)
              ? avgs.reduce((s: number, a) => s + (a ?? 0), 0)
              : null,
          projected:
            comboMemberIds.length > 0 && projs.every(p => p != null)
              ? projs.reduce((s: number, p) => s + p!, 0)
              : null,
          avgSource: comboMemberIds.some(
            id => entry[id]?.avg != null && entry[id]?.source !== 'season'
          )
            ? 'fallback'
            : 'season',
        }
      }),
    [poolStats, comboMemberIds]
  )
  const groupRowFor = (stat: string) => groupRows.find(r => r.stat === stat)

  // Leaving the Place view (or flipping read-only) abandons any in-flight combo.
  useEffect(() => {
    if (effectiveView !== 'place' || readOnly) {
      setComboMode(false)
      setComboMembers(new Set())
      setComboValues({})
    }
  }, [effectiveView, readOnly])

  function toggleComboMember(id: string) {
    setComboMembers(prev => {
      const members = new Set(prev)
      if (members.has(id)) members.delete(id)
      else members.add(id)
      return members
    })
  }

  // Pill-body tap on a combo stat: stage/unstage via the slip's canonical
  // toggle — the combo lands in the ordinary slip bar like any staged pick
  // (no auto-raise, no mode exit; parlays form there by default).
  function stageComboAt(stat: string, value: number, odds: number | null) {
    if (readOnly || currentWeekId == null) return
    const staged = stagedComboFor(stat)
    if (staged == null && odds == null) {
      showToast('That line is unavailable', 'error')
      return
    }
    stageCombo({
      key: comboKeyFor(stat),
      weekId: currentWeekId,
      memberIds: comboMemberIds,
      memberNames: comboMemberShortNames,
      stat,
      scope: scope === 'weekly' ? 'night' : 'game',
      gameNumber: comboScopeGame,
      // The chosen VALUE + its quoted price — compose_combo_bet re-prices the
      // line authoritatively (quote_tolerance) and mints the rung if the
      // market doesn't carry it yet.
      line: value,
      odds,
    })
  }

  // An accepted sheet value for a combo stat: record it and, when that exact
  // combo is already staged at a different value, re-stage it live (the slip
  // chip/ticket re-render) — same invariant as acceptLineValue on a pick.
  function acceptComboValue(stat: string, v: number, quote: LineQuote) {
    setComboValues(prev => ({ ...prev, [stat]: v }))
    const staged = stagedComboFor(stat)
    if (staged && staged.line !== v) {
      removeSlipCombo(staged.key)
      stageCombo({ ...staged, line: v, odds: quote.odds ?? staged.odds })
    }
  }

  // Combo-mode member pool: every RSVP'd-in player (the compose RPC's only
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

  // The stat pill specs the combo line card renders — staging state from the
  // slip (canonical key), the accepted edit, and each pill's own quote source.
  const comboStatSpecs = useMemo<ComboStatSpec[]>(
    () =>
      COMBO_STATS.map(stat => {
        const staged = stagedComboFor(stat)
        return {
          stat,
          label: comboStatLabel(stat),
          source: comboSourceFor(stat),
          editedValue: comboValues[stat] ?? null,
          stagedLine: staged?.line ?? null,
          stagedOdds: staged?.odds ?? null,
          staged: staged != null,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slipCombos, comboValues, comboMembersKey, scope, currentSeasonId, currentWeekId, comboNGames]
  )

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
  // The open value editor: a board market's pill, or one combo stat's pill
  // (carrying the value it showed, as the sheet's starting draft).
  const [valueSheet, setValueSheet] = useState<
    { kind: 'market'; line: LineView } | { kind: 'combo'; stat: string; value: number } | null
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
  function renderLineSet(lines: LineView[], groupInProgress: boolean, hideName = false) {
    return (
      <LineRow
        lines={lines}
        relation={subjectRelation(weekTeams, lines[0].subjectPlayerId, lines[0].gameNumber)}
        inProgress={groupInProgress}
        hideName={hideName}
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
            (slipPicks.length > 0 || slipSpecials.length > 0 || slipCombos.length > 0) &&
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
              {/* Combo — the inline mode toggle. Dim-but-pressable below 2
                  RSVP'd players (house convention: still toasts). Entering
                  seeds the member set with the player being viewed — a
                  single-player bet IS a combo of one; you then add more.
                  Exiting restores that player's board (pickedPlayerId is
                  untouched). */}
              {currentWeekId != null && currentSeasonId != null && (
                <PickChip
                  label="COMBO"
                  selected={comboMode}
                  disabled={rsvpInPlayers.length < 2}
                  onPress={() => {
                    if (rsvpInPlayers.length < 2) {
                      showToast("Not enough players RSVP'd in yet", 'error')
                      return
                    }
                    setComboMode(prev => {
                      if (prev) {
                        setComboMembers(new Set())
                        setComboValues({})
                        return false
                      }
                      setComboMembers(
                        new Set(board.selectedPlayerId != null ? [board.selectedPlayerId] : [])
                      )
                      return true
                    })
                  }}
                />
              )}
            </View>
            {/* ── One board, two subjects ─────────────────────────────────
                The layout is identical in both modes — subject selector,
                projection card, line card(s) — only the SUBJECT changes:
                combo mode swaps the single-player dropdown for a multi-select
                member chip row (pool = every RSVP'd-in player; combos need
                only RSVP) and prices the picked group instead of one player. */}
            {/* What the book expects from the subject this week against what
                it actually averages — scope-scaled like the lines beneath it
                (Weekly = × the night's games). The same card serves both
                modes: combo mode feeds it the picked group's summed rows.
                Self-hides when the engine has no opinion. */}
            {comboMode ? (
              <BookProjectionCard
                rows={groupRows}
                nGames={comboNGames}
                scopeLabel={scope === 'weekly' ? 'WEEKLY' : `GAME ${comboScopeGame}`}
                header="GROUP AVG vs FORECAST"
                caption={
                  comboMemberShortNames.length > 0 ? comboMemberShortNames.join(' + ') : undefined
                }
              />
            ) : (
              board.selectedPlayerId != null && projCache[board.selectedPlayerId] != null && (
                <BookProjectionCard
                  rows={projCache[board.selectedPlayerId]}
                  nGames={comboNGames}
                  scopeLabel={scope === 'weekly' ? 'WEEKLY' : `GAME ${comboScopeGame}`}
                />
              )
            )}
            {board.scopeInProgress && board.firstInProgress && (
              <Text style={styles.inProgressNote}>
                {closedBettingNote(board.firstInProgress)}
              </Text>
            )}
            {comboMode ? (
              <>
                {/* The group's line card — the board's ONE visual constant
                    across modes: the same four lines, in place, adjusted to
                    the picked group (each stat pill carries its own live combo
                    quote; the group name is the card's header, playing the
                    role the name selector plays in single-player mode). Tap a
                    value to retype it; tap a body to stage into the ordinary
                    slip bar — staging several stats parlays them, so one group
                    can carry a combo parlay across different bet types. */}
                <ComboLineRow
                  memberNames={comboMemberShortNames}
                  stats={comboStatSpecs}
                  minMembers={comboMemberIds.length >= 2}
                  inert={board.scopeInProgress || readOnly}
                  dimmed={balance < 10}
                  onEditValue={(stat, value) => setValueSheet({ kind: 'combo', stat, value })}
                  onStage={(spec, value, odds) => stageComboAt(spec.stat, value, odds)}
                />
                {/* The player pickers — the ONLY thing combo mode adds to the
                    screen, at the bottom: one row per RSVP'd-in player (their
                    scope-scaled Total Pins average with the book's forecast
                    beside it — a member the book rates above their average (▲)
                    makes the combo line richer than the averages suggest;
                    below (▼), softer) with the +/✓ chip that adds them to the
                    group. Everything above simply re-prices as they toggle. */}
                <Text style={styles.combineHint}>TAP PLAYERS TO COMBINE</Text>
                <View>
                  {comboMemberPool.map(m => {
                    const on = comboMembers.has(m.playerId)
                    const entry = poolStats['total_pins']?.[m.playerId]
                    const avgShown = entry?.avg != null ? entry.avg * comboNGames : null
                    const projShown = entry?.proj != null ? entry.proj * comboNGames : null
                    // The arrow rides the BOOK: ▲ = the book rates the member
                    // above their average (same shared dead band).
                    const projDir = deltaDir(projShown, avgShown)
                    return (
                      <View key={m.playerId} style={styles.memberRow}>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>
                            {m.name}{m.playerId === playerId ? ' (you)' : ''}
                          </Text>
                          {entry != null && (
                            <Text style={styles.memberAvg}>
                              {avgShown == null
                                ? 'NO STAT HISTORY'
                                : entry.source === 'season'
                                  ? `SEASON AVG ${avgShown.toFixed(1)}`
                                  : entry.source === 'lifetime'
                                    ? `LIFETIME AVG ${avgShown.toFixed(1)}`
                                    : `LEAGUE AVG ${avgShown.toFixed(1)}`}
                              {projShown != null && (
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
            ) : board.selectedPlayerId == null ? (
              // Nobody has lines in this scope (they may in another — the
              // pills stay tappable above).
              <EmptyCard
                text={`No ${scopeOptions.find(o => o.key === scope)?.label ?? ''} lines are open yet`}
              />
            ) : (
              <>
                {/* The player-name selector — the ONE name on the board,
                    heading the player's stack (specials → their consolidated
                    row → their combos). The old full-width dropdown menu is
                    consolidated into it: same anchored Dropdown, restyled as
                    the line card's name header (+ ▾), so switching players
                    happens right where the name already read. The player's
                    own LineRow hides its duplicate header; combo rows keep
                    theirs (their subject is the member set, not the player). */}
                <Dropdown
                  options={board.players.map(p => ({
                    key: p.id,
                    label: `${p.name}${p.id === playerId ? ' (you)' : ''}`,
                  }))}
                  value={board.selectedPlayerId}
                  onChange={setPickedPlayerId}
                  style={styles.playerNameSelect}
                  triggerTextStyle={styles.playerNameSelectText}
                />
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
                        {renderLineSet(
                          lines,
                          board.scopeInProgress || lines.some(l => l.inProgress),
                          lines === board.playerLines
                        )}
                      </View>
                    ))}
                  </View>
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

      {/* Value-entry sheet — one instance serves both board pills and the
          combo stat pills (conditional-mount so state resets between opens). */}
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
      {valueSheet?.kind === 'combo' && currentSeasonId != null && (() => {
        // The same groupRows the projection card renders — the two surfaces
        // can never disagree (per-game sums, scope-scaled here).
        const row = groupRowFor(valueSheet.stat)
        const avg = row?.seasonAvg != null ? row.seasonAvg * comboNGames : null
        const proj = row?.projected != null ? row.projected * comboNGames : null
        return (
          <LineEntrySheet
            title={comboMemberShortNames.join(' + ')}
            conditionLabel={comboStatLabel(valueSheet.stat)}
            scopeLabel={comboScopeLabel}
            contextNote={
              avg != null
                ? proj != null
                  ? `Group Average ${avg.toFixed(1)} · Forecast ${proj.toFixed(1)}`
                  : `Group Average: ${avg.toFixed(1)} — lines above it pay longer odds`
                : undefined
            }
            source={comboSourceFor(valueSheet.stat)!}
            initialValue={valueSheet.value}
            onAccept={(v, quote) => {
              acceptComboValue(valueSheet.stat, v, quote)
              setValueSheet(null)
            }}
            onClose={() => setValueSheet(null)}
          />
        )
      })()}

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
  // The player-name selector — the Dropdown trigger undressed to read as the
  // line card's name header (centered name + ▾, no box), so the name above
  // the lines IS the picker.
  playerNameSelect: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingVertical: 4,
    marginBottom: 4,
  },
  playerNameSelectText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  // Combo-mode helper line above the bottom player-picker rows.
  combineHint: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.accent,
    marginTop: 2,
    marginBottom: 10,
    textAlign: 'center',
  },
  // Combo-mode player-picker rows — same tinted-row language as LineRow.
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
  // The member's scope-scaled average (the number their share of a combo
  // line is really priced against) — context under the name.
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
