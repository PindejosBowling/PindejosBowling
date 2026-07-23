import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
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
import { useBetSlip, useBetSlipReload } from '../components/betting/BetSlipProvider'
import SubjectLinesCard, { conditionLabel, type StatPillSpec } from '../components/betting/SubjectLinesCard'
import LineEntrySheet from '../components/betting/LineEntrySheet'
import CustomLineRow from '../components/betting/CustomLineRow'
import AddPlayersModal from '../components/betting/AddPlayersModal'
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
import { useLinePreview, oddsForLine, type LineQuote, type LinePreviewSource } from '../hooks/useLinePreview'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { betMarkets, haunts } from '../utils/supabase/db'
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
// Compressed stat labels for the Add Players rows' four-average line (the
// BookProjectionCard column vocabulary — four stats share one row width).
const AVG_STAT_LABELS: Record<string, string> = {
  total_pins: 'PINS',
  clean_frames: 'CLEAN',
  strikes: 'STRIKES',
  spares: 'SPARES',
}

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

  // The board's subject GROUP — combos are NOT a mode (⚰️ the COMBO chip +
  // comboMode flag, 2026-07-23): the subject is simply 1..N players. Empty =
  // the ordinary single-player board about the picked player; 2+ ids = the
  // same board about the group (the projection card sums it, the line card
  // offers one value-first pill per combinable stat, each with its own live
  // quote). NEVER length 1 — collapsing a group to one member promotes them
  // to the picked player and clears this. Members are added via the heading's
  // ＋ chip (the Add Players sheet) and removed via their heading chip's ✕.
  // Scope follows the board's scope filter: Weekly → a night combo, Game N →
  // that game.
  const [groupMembers, setGroupMembers] = useState<string[]>([])
  const [addPlayersOpen, setAddPlayersOpen] = useState(false)
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

  // Scope options: Weekly (night-scoped markets) + one per scheduled game. The
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

  // ── Group (combo) derivations ─────────────────────────────────────────
  const groupMode = groupMembers.length >= 2
  const comboMemberIds = useMemo(() => [...groupMembers].sort(), [groupMembers])
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
  // stats across the whole RSVP pool, PREFETCHED with the live board (8
  // parallel STABLE reads) — not on the combo toggle, so entering combo mode
  // has every number already in hand: the group card sums, the picker rows'
  // context, and the client-side seed anchors all render synchronously (no
  // switch buffering). Member toggles and stat switches are pure client-side
  // re-sums. Display-only (server RPCs stay authoritative for money).
  const [poolStats, setPoolStats] = useState<
    Record<string, Record<string, { avg: number | null; source: string | null; proj: number | null }>>
  >({})
  useEffect(() => {
    if (readOnly || currentSeasonId == null || rsvpInPlayers.length === 0) {
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
  }, [readOnly, currentSeasonId, rsvpInPlayers])

  // The client-side seed anchor for one stat — the SAME formula the server
  // seeds combo lines with (Σ per-member floor(projected mean × games), + the
  // single half point; engine off → the per-member floored average). Lets a
  // combo pill show its value the instant the member set changes, with the
  // authoritative quote (same number) replacing it when it lands ~250ms later
  // — the value slot never blanks, only the odds digit shows '…'.
  const clientSeedFor = (stat: string): number | null => {
    const entry = poolStats[stat]
    if (entry == null || comboMemberIds.length === 0) return null
    let sum = 0
    for (const id of comboMemberIds) {
      const per = entry[id]?.proj ?? entry[id]?.avg
      if (per == null) return null
      sum += Math.floor(per * comboNGames)
    }
    return sum + 0.5
  }

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

  // Leaving the Place view (or flipping read-only) abandons any in-flight group.
  useEffect(() => {
    if (effectiveView !== 'place' || readOnly) {
      setGroupMembers([])
      setComboValues({})
      setAddPlayersOpen(false)
    }
  }, [effectiveView, readOnly])

  // Add a player to the subject. From the solo board this CREATES the group:
  // the current subject + the newcomer (a single-player bet is a combo of
  // one; adding a second makes it a combo in fact).
  function addGroupMember(id: string) {
    if (groupMembers.includes(id)) return
    if (groupMembers.length === 0) {
      if (board.selectedPlayerId == null || id === board.selectedPlayerId) return
      setGroupMembers([board.selectedPlayerId, id])
    } else {
      setGroupMembers([...groupMembers, id])
    }
  }

  // Remove a member (heading chip ✕ / sheet toggle). Dropping to one member
  // dissolves the group back into the ordinary board about that player.
  function removeGroupMember(id: string) {
    const next = groupMembers.filter(m => m !== id)
    if (next.length === 1) {
      setPickedPlayerId(next[0])
      setGroupMembers([])
    } else {
      setGroupMembers(next)
    }
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

  // The Add Players sheet's candidate pool: every RSVP'd-in player (the
  // compose RPC's only eligibility rule — a player without an individual line
  // still combines), viewer first, then the roster's name order.
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

  // One live quote per combinable stat — four STATIC useLinePreview calls
  // (fixed order keeps hooks legal) so the quotes belong to the screen and
  // the card stays purely presentational. Sources go null while combo mode is
  // off — no idle fetching; useLinePreview additionally withholds quotes
  // below 2 members.
  const comboQuotes: Record<string, { quote: LineQuote | null; loading: boolean }> = {
    total_pins: useLinePreview(groupMode ? comboSourceFor('total_pins') : null, comboValues['total_pins'] ?? null),
    clean_frames: useLinePreview(groupMode ? comboSourceFor('clean_frames') : null, comboValues['clean_frames'] ?? null),
    strikes: useLinePreview(groupMode ? comboSourceFor('strikes') : null, comboValues['strikes'] ?? null),
    spares: useLinePreview(groupMode ? comboSourceFor('spares') : null, comboValues['spares'] ?? null),
  }

  // One combo stat → one pill spec: value = slip truth → accepted edit → the
  // live quote's seed → the client-computed seed (instant), price = staged
  // snapshot or the quote for that exact value.
  function comboSpecFor(stat: string): StatPillSpec {
    const staged = stagedComboFor(stat)
    const { quote, loading } = comboQuotes[stat]
    const value = staged?.line
      ?? comboValues[stat]
      ?? quote?.seedLine
      ?? clientSeedFor(stat)
    const odds = staged != null && staged.line === value
      ? staged.odds
      : oddsForLine(quote, value)
    const priceable = comboMemberIds.length >= 2
    return {
      key: stat,
      label: comboStatLabel(stat),
      value,
      odds,
      quoteLoading: loading,
      staged: staged != null,
      inert: !priceable || readOnly,
      onEditValue: value != null && priceable
        ? () => setValueSheet({ kind: 'combo', stat, value })
        : undefined,
      onStage: value != null && priceable
        ? () => stageComboAt(stat, value, odds)
        : undefined,
    }
  }

  // One posted market → one pill spec (single-player mode + posted combo
  // rows). Same slot keys as combo mode ('total_pins' for the score line, the
  // statKey for props) so each pill survives the mode toggle in place.
  function lineToSpec(line: LineView, groupInProgress: boolean): StatPillSpec {
    const staged = slipPicks.find(p => p.marketId === line.marketId)
    const value = valueOf(line)
    const posted = postedAt(line, value)
    const cached = quoteCache[line.marketId]
    // Price resolution: posted rung → staged snapshot → the quote accepted in
    // the value sheet.
    const odds = posted?.odds
      ?? (staged != null && staged.line === value ? staged.odds : null)
      ?? (cached != null && cached.line === value ? cached.odds : null)
    return {
      key: line.marketType === 'over_under' ? 'total_pins' : line.statKey ?? line.marketId,
      label: conditionLabel(line),
      value,
      odds,
      staged: staged != null,
      inert: groupInProgress || line.inProgress || readOnly,
      onEditValue: () => setValueSheet({ kind: 'market', line }),
      onStage: () => stagePickAtValue(line, value, odds),
    }
  }

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

  // The main card's pill set — the board's one line surface, rebuilt as plain
  // specs each render: the selected player's posted markets, or the picked
  // group's four combo lines. Same slot keys either way, so the mounted card
  // updates each pill in place across a mode toggle.
  const mainPills: StatPillSpec[] = groupMode
    ? COMBO_STATS.map(comboSpecFor)
    : board.playerLines.map(l =>
        lineToSpec(l, board.scopeInProgress || board.playerLines.some(x => x.inProgress))
      )

  // The heading's ＋ chip — opens the Add Players sheet (the combo builder).
  // Dim-but-pressable below 2 RSVP'd players (house convention: still
  // toasts); absent entirely when there's no current week/season to bet into.
  function renderAddChip() {
    if (readOnly || currentWeekId == null || currentSeasonId == null) return null
    const short = rsvpInPlayers.length < 2
    return (
      <TouchableOpacity
        style={[styles.addChip, short && styles.addChipDim]}
        onPress={() => {
          if (short) {
            showToast("Not enough players RSVP'd in yet", 'error')
            return
          }
          setAddPlayersOpen(true)
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.addChipText}>＋</Text>
      </TouchableOpacity>
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
        {/* The flat board: the stats-strip header leads (with the scope
            picker inline), then the subject selector, then the subject's
            available lines for that scope. The filters ARE the navigation —
            no collapsible sections. Staged picks live in the global slip
            bar, so building a parlay across players/scopes is just
            switching the filters. */}
        {visibleLines.length > 0 || customLines.length > 0 ? (
          <View style={styles.board}>
            {/* The board header — the board's MAIN HEADING, with the scope
                Dropdown as the title's live word (⚰️ the standalone filter
                row beneath the subject heading; ⚰️ the "SEASON N AVG vs
                FORECAST" title, demoted to the subtitle beneath). */}
            <View style={styles.boardHeaderRow}>
              <Text style={styles.boardHeaderText}>TONIGHT'S LINES ·</Text>
              <Dropdown
                options={scopeOptions}
                value={scope}
                onChange={setScope}
                style={styles.scopeSelect}
                triggerTextStyle={styles.scopeSelectText}
                caretStyle={styles.selectCaret}
              />
            </View>
            {/* What the stats strip beneath actually shows, in one breath —
                the AVERAGES span picks up the accent (matching the average
                values), "vs" reads white, and "the Book's Forecast" keeps the
                grey of the FORECAST subtext beneath each column. */}
            <Text style={styles.boardSubtitle}>
              <Text style={styles.boardSubtitleAvg}>Season {seasonNumber ?? '—'} Averages</Text>
              <Text style={styles.boardSubtitleVs}> vs </Text>
              <Text style={styles.boardSubtitleForecast}>the Book's Forecast</Text>
            </Text>
            {/* The subject selection, demoted to a sub-row beneath the
                header. Solo: the anchored player-name selector (the ONE name
                on the board) with a ＋ chip that opens the Add Players sheet
                — adding a second player turns the subject into a group in
                place (⚰️ the COMBO mode chip). Group: one removable chip per
                member (✕) plus the same ＋. */}
            {groupMode ? (
              <View style={styles.headingRow}>
                {comboMemberIds.map((id, i) => (
                  <TouchableOpacity
                    key={id}
                    style={styles.memberChip}
                    onPress={() => removeGroupMember(id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.memberChipText}>{comboMemberShortNames[i]}</Text>
                    <Text style={styles.memberChipX}>✕</Text>
                  </TouchableOpacity>
                ))}
                {renderAddChip()}
              </View>
            ) : board.selectedPlayerId != null ? (
              <View style={styles.headingRow}>
                <Dropdown
                  options={board.players.map(p => ({
                    key: p.id,
                    label: `${p.name}${p.id === playerId ? ' (You)' : ''}`,
                  }))}
                  value={board.selectedPlayerId}
                  onChange={setPickedPlayerId}
                  style={styles.playerNameSelect}
                  triggerTextStyle={styles.playerNameSelectText}
                  caretStyle={styles.selectCaret}
                />
                {renderAddChip()}
              </View>
            ) : null}
            {/* ── One board, one component tree, one subject of 1..N ──────
                The projection card and the main line card render ONCE at
                stable positions (never inside a subject-count ternary), so
                growing/shrinking the group is a props update on already-
                mounted components — no remount, no visual load. Only two
                things vary: whose data the surfaces describe (player vs
                group), and whether the heading is the selector or chips. */}
            {/* What the book expects from the subject this week against what
                it actually averages — scope-scaled like the lines beneath it
                (Weekly = × the night's games). Headerless — the board header
                above is its title. Self-hides when the engine has no
                opinion. */}
            {(groupMode || (board.selectedPlayerId != null && projCache[board.selectedPlayerId] != null)) && (
              <BookProjectionCard
                rows={groupMode ? groupRows : projCache[board.selectedPlayerId!]}
                nGames={comboNGames}
              />
            )}
            {board.scopeInProgress && board.firstInProgress && (
              <Text style={styles.inProgressNote}>
                {closedBettingNote(board.firstInProgress)}
              </Text>
            )}
            {!groupMode && board.selectedPlayerId == null ? (
              // Nobody has lines in this scope (they may in another — the
              // scope dropdown stays live above).
              <EmptyCard
                text={`No ${scopeOptions.find(o => o.key === scope)?.label ?? ''} lines are open yet`}
              />
            ) : (
              <>
                {/* Specials lead (their styling is the distinguishing mark);
                    single-player subjects only — a special is a curated
                    bundle about one player, not a group. */}
                {!groupMode && board.specials.length > 0 && renderSpecialsCard(board.specials, board.scopeInProgress)}
                {/* THE line card — the same mounted SubjectLinesCard for any
                    subject size, its pills keyed by stat so each slot updates
                    in place: the player's posted markets, or the group's four
                    combo lines (values anchored instantly by the client-side
                    seed; the live quote replaces the odds as it lands).
                    Staging several combo stats parlays them in the slip — one
                    group, one parlay across different bet types. */}
                {mainPills.length > 0 && (
                  <SubjectLinesCard
                    relation={
                      groupMode || board.playerLines.length === 0
                        ? null
                        : subjectRelation(weekTeams, board.playerLines[0].subjectPlayerId, board.playerLines[0].gameNumber)
                    }
                    inProgress={
                      board.scopeInProgress ||
                      (!groupMode && board.playerLines.some(l => l.inProgress))
                    }
                    dimmed={balance < 10}
                    pills={mainPills}
                  />
                )}
                {/* Posted combo markets the player belongs to — the same card
                    component, one pill each (single-player subjects only; a
                    group's own lines render on the main card above). */}
                {!groupMode &&
                  board.comboLines.map(cl => (
                    <SubjectLinesCard
                      key={cl.marketId}
                      header={cl.subjectFullName}
                      inProgress={board.scopeInProgress || cl.inProgress}
                      dimmed={balance < 10}
                      pills={[lineToSpec(cl, board.scopeInProgress || cl.inProgress)]}
                    />
                  ))}
              </>
            )}
            {/* ELI5 foot section — why the strip up top shows BOTH numbers.
                Voice rule: the gap between average and forecast is always
                framed as the BOOK taking a position (an opportunity for the
                bettor), never as the player trending well or badly — no
                praising ▲ or shaming ▼. */}
            <Text style={styles.boardFootText}>
              The Sportsbook makes a forecast each week for all players based on their 
              lifetime Official games.All betting lines are priced based on the forecast. 
            </Text>
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

      {/* Add Players — the combo builder popup, raised from the heading's ＋
          chip. Toggles edit the board's subject group LIVE (the board under
          the popup re-prices as members change); rows carry the player's four
          scope-scaled season averages, one per combinable stat (`*` = the
          lifetime/league fallback, footnoted in the modal).
          Conditional-mount contract, like every sheet/modal. */}
      {addPlayersOpen && (
        <AddPlayersModal
          rows={comboMemberPool.map(m => {
            const parts = COMBO_STATS.flatMap(stat => {
              const entry = poolStats[stat]?.[m.playerId]
              if (entry?.avg == null) return []
              const shown = (entry.avg * comboNGames).toFixed(1)
              return [`${AVG_STAT_LABELS[stat]} ${shown}${entry.source !== 'season' ? '*' : ''}`]
            })
            const loaded = poolStats['total_pins']?.[m.playerId] != null
            const isSoloSubject = !groupMode && m.playerId === board.selectedPlayerId
            return {
              id: m.playerId,
              name: `${m.name}${m.playerId === playerId ? ' (You)' : ''}`,
              contextLabel: parts.length > 0 ? parts.join('  ·  ') : loaded ? 'NO STAT HISTORY' : null,
              selected: groupMode ? groupMembers.includes(m.playerId) : isSoloSubject,
            }
          })}
          onToggle={id => {
            if (groupMode && groupMembers.includes(id)) removeGroupMember(id)
            else if (!groupMode && id === board.selectedPlayerId)
              // The solo subject's ✓ is live like every other chip, but the
              // board always needs a subject — they leave only by the group
              // shrinking around them.
              showToast('Add another player to combine with them', 'error')
            else addGroupMember(id)
          }}
          onClose={() => setAddPlayersOpen(false)}
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
  content: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },

  viewToggle: { marginBottom: 12 },

  // The toggle's own bottom margin is the whole separation — the board adds
  // none of its own (the two used to stack into ~36px of dead space above the
  // "TONIGHT'S LINES" header).
  board: { marginTop: 0 },
  // The board header — the projection strip's title as the board's main
  // heading, with the scope Dropdown inline as the qualifier (one row doing
  // the work of the old card title + filter row).
  boardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  boardHeaderText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 22,
    letterSpacing: 1,
    color: colors.text,
  },
  // The scope picker as the header's live word — white text with a prominent
  // accent caret as the sole tappable cue (no border/fill needed).
  scopeSelect: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 5,
    paddingVertical: 4,
    gap: 4,
  },
  scopeSelectText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 22,
    letterSpacing: 1,
    color: colors.text,
    textTransform: 'uppercase',
  },
  // The tappable caret — accent + larger than the default so the affordance
  // pops next to the white label. Shared by BOTH header selectors (scope and
  // player) so the one yellow ▾ reads as "this word is pickable".
  selectCaret: {
    fontSize: 16,
    color: colors.accent,
    marginTop: 2,
  },
  // The demoted explainer line under the title — what the stats strip shows.
  boardSubtitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    letterSpacing: 0.5,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 8,
  },
  // "Season N Averages" — accent, matching the average values in the strip.
  boardSubtitleAvg: { color: colors.accent },
  // "vs" — white pivot between the two sides.
  boardSubtitleVs: { color: colors.text },
  // "the Book's Forecast" — the same grey as each column's FORECAST subtext.
  boardSubtitleForecast: { color: colors.muted },
  // The subject sub-row — the selector (or member chips) + the ＋ chip,
  // centered beneath the board header; wraps when a big group outgrows the
  // line.
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 6,
  },
  // The player-name selector — the Dropdown trigger undressed to read as the
  // board's main heading (centered name + ▾, no box), so the name atop the
  // board IS the picker.
  playerNameSelect: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingVertical: 4,
  },
  // Player-name type — one size shared by the selector, member chips, and
  // the ＋ chip (keep all three in lockstep when resizing).
  playerNameSelectText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.4,
  },
  // A group member's heading chip — name + ✕, tap to remove. Same name
  // typography as the selector, boxed so the removal affordance reads.
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surfaceTint,
  },
  memberChipText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.4,
  },
  memberChipX: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
  },
  // The ＋ chip — opens the Add Players sheet (dim when under 2 RSVP'd). A
  // compact square button rather than a full-width chip so it yields
  // horizontal room to the member chips / stats it sits beside.
  addChip: {
    width: 28,
    height: 28,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addChipDim: { opacity: 0.4 },
  // The lone ＋ glyph, sized to fill the compact square (its own affordance —
  // no longer in lockstep with the player-name type).
  addChipText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    lineHeight: 20,
    color: colors.accent,
  },
  // The board's ELI5 foot section — beneath the last line card, explaining
  // the AVG-vs-FORECAST strip up top.
  boardFootText: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
  },
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
