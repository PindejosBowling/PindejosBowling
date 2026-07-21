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
import CustomLineRow from '../components/betting/CustomLineRow'
import PickChip from '../components/betting/PickChip'
import BuilderBar from '../components/betting/BuilderBar'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import Dropdown from '../components/ui/Dropdown'
import FeatureExplainerSheet from '../components/pinsino/FeatureExplainerSheet'
import TermsBlock from '../components/ui/TermsBlock'
import { EXPLAINERS, TERMS } from '../data/pinsinoExplainers'
import {
  usePinsinoData,
  selectionBetsAgainstSubject,
  customLineSelfTank,
  customLegLabel,
  lineGroup,
  closedBettingNote,
  subjectRelation,
  withVisibleSelections,
  STAT_LABELS,
  type BetView,
  type LineView,
  type SelectionView,
  type CustomLineView,
} from '../hooks/usePinsinoData'
import { useComboLinePreview } from '../hooks/useComboLinePreview'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { haunts } from '../utils/supabase/db'
import { PinsinoStackParamList } from '../navigation/types'
import EmptyCard from '../components/ui/EmptyCard'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

type View2 = 'action' | 'place' | 'settled'

const VIEW_OPTIONS: { key: View2; label: string }[] = [
  { key: 'place', label: 'Place' },
  { key: 'action', label: 'Active' },
  { key: 'settled', label: 'Settled' },
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

  // Combine mode — board-native combo building. null = off; { stat: null } =
  // armed (Combine chip on, waiting for a stat tap); stat set = the stat-view
  // pivot is active (member picking). Scope follows the board's scope filter:
  // Weekly → a night combo, Game N → that game.
  const [combo, setCombo] = useState<{ stat: string | null; members: Set<string> } | null>(null)
  const comboArmed = combo != null && combo.stat == null
  const combining = combo != null && combo.stat != null

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
      add(l.subjectPlayerId, l.subjectName)
      l.comboMemberIds?.forEach((id, i) => add(id, l.comboMemberNames?.[i]))
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
      scopeInProgress: scopeLines.some(l => l.inProgress),
      firstInProgress: scopeLines.find(l => l.inProgress) ?? null,
    }
  }, [visibleLines, customLines, scope, pickedPlayerId, playerId, rsvpInPlayers])

  // ── Combine mode derivations ──────────────────────────────────────────
  // The combo stat a board line seeds: the score O/U builds a total-pins
  // combo; a stat prop builds its own stat. Combos/specials can't seed.
  const comboStatOf = (l: LineView): string | null =>
    l.marketType === 'over_under' ? 'total_pins' : l.marketType === 'prop' ? l.statKey : null

  const comboMemberIds = useMemo(
    () => (combo?.stat != null ? [...combo.members].sort() : []),
    [combo]
  )
  const comboScopeGame = scope === 'weekly' ? null : Number(scope.slice('game-'.length))
  const comboNGames = scope === 'weekly' ? Math.max(weekGameNumbers.length, 1) : 1
  const { line: comboPreviewLine } = useComboLinePreview(
    comboMemberIds,
    combo?.stat ?? null,
    currentSeasonId,
    comboNGames
  )
  // Canonical staging key — the same format ComboComposerSheet used, so
  // toggle-off dedup works against anything previously staged.
  const comboKey =
    combo?.stat != null
      ? `${combo.stat}|${scope === 'weekly' ? 'night' : comboScopeGame}|${comboMemberIds.join(',')}`
      : ''
  const comboAlreadyStaged = combining && slipCombos.some(c => c.key === comboKey)

  // The BuilderBar takes over the slip bar's footprint while combining.
  useEffect(() => {
    setSlipBarHidden(combining)
    return () => setSlipBarHidden(false)
  }, [combining, setSlipBarHidden])

  // Leaving the Place view (or flipping read-only) abandons any in-flight combo.
  useEffect(() => {
    if (effectiveView !== 'place' || readOnly) setCombo(null)
  }, [effectiveView, readOnly])

  function toggleComboMember(id: string) {
    setCombo(prev => {
      if (prev?.stat == null) return prev
      const members = new Set(prev.members)
      if (members.has(id)) members.delete(id)
      else members.add(id)
      return { ...prev, members }
    })
  }

  // An armed stat tap pivots the board into member picking, seeded with the
  // tapped subject. Combos/specials chips can't seed a combo.
  function enterStatView(line: LineView) {
    const stat = comboStatOf(line)
    if (!stat) { showToast('Combos build from player stat lines', 'error'); return }
    setCombo({ stat, members: new Set(line.subjectPlayerId ? [line.subjectPlayerId] : []) })
  }

  // Add (or, when this exact combo is already staged, remove) via the slip's
  // canonical toggle. Adding exits combine mode; the combo just lands in the
  // slip bar like any staged pick (no auto-raise of the placement sheet).
  function addComboToSlip() {
    if (combo?.stat == null || currentWeekId == null) return
    const nameById = new Map(rsvpInPlayers.map(m => [m.playerId, m.name]))
    stageCombo({
      key: comboKey,
      weekId: currentWeekId,
      memberIds: comboMemberIds,
      memberNames: comboMemberIds.map(id => nameById.get(id) ?? '—'),
      stat: combo.stat,
      scope: scope === 'weekly' ? 'night' : 'game',
      gameNumber: comboScopeGame,
      line: comboPreviewLine,
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

  // Anti-tanking, market-type-aware: backing the side that bets against your own
  // performance (the `under` on your own line, or on your own team's line) is
  // blocked. Friendly pre-check only — the prevent_self_tank trigger is the
  // authoritative backstop.
  function isSelfTank(line: LineView, sel: SelectionView): boolean {
    if (!selectionBetsAgainstSubject(line.marketType, sel.key)) return false
    if (line.marketType === 'team_prop') {
      return line.teamId != null && line.teamId === weekTeams.myTeamId
    }
    if (line.marketType === 'combo') {
      return !!playerId && (line.comboMemberIds ?? []).includes(playerId)
    }
    return line.subjectPlayerId === playerId
  }

  // Tapping any selection toggles it in/out of the unified slip. One selection
  // per market; own-against side always toasts (anti-tank). The provider owns the
  // slip state + toggle; the screen builds the pick and enforces the anti-tank
  // pre-check. Balance is validated at placement, so a low balance still stages.
  function stagePick(line: LineView, sel: SelectionView) {
    if (readOnly) return
    if (isSelfTank(line, sel)) { showToast('Believe in yourself man', 'error'); return }
    stageSlipPick({
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

  // One subject row (≥1 markets → one button set) — a player's consolidated
  // lines or a single combo. Tapping a cell stages it in the unified slip
  // (staged = filled); an in-progress scope makes every side inert. Each button
  // binds its own (line, selection). Combos tint neutral automatically
  // (subjectRelation of a null subject).
  function renderLineSet(lines: LineView[], isLast: boolean, groupInProgress: boolean) {
    return (
      <LineRow
        lines={lines}
        isLast={isLast}
        relation={subjectRelation(weekTeams, lines[0].subjectPlayerId, lines[0].gameNumber)}
        inProgress={groupInProgress}
        // Armed combine mode repurposes the stat taps: the first tap seeds the
        // combo and pivots to member picking (no anti-tank dim — over-on-self
        // is legal for combos).
        onSelect={comboArmed ? line => enterStatView(line) : stagePick}
        selectionState={
          comboArmed
            ? () => ({})
            : (line, sel) => ({
                selected: slipPicks.some(p => p.selectionId === sel.selectionId),
                disabled: balance < 10 || isSelfTank(line, sel),
              })
        }
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
            isLast={false}
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
                  below 2 RSVP'd players (house convention: still toasts). */}
              {currentWeekId != null && currentSeasonId != null && (
                <PickChip
                  label="COMBINE"
                  selected={combo != null}
                  disabled={rsvpInPlayers.length < 2}
                  onPress={() => {
                    if (rsvpInPlayers.length < 2) {
                      showToast("Not enough players RSVP'd in yet", 'error')
                      return
                    }
                    setCombo(prev => (prev ? null : { stat: null, members: new Set() }))
                  }}
                />
              )}
            </View>
            {combining && combo?.stat != null ? (
              // ── Stat-view pivot: pick the combo's members ──────────────
              // Pool = every RSVP'd-in player (combos need only RSVP); a
              // member's own line for this stat shows as context when one
              // exists. Scope pills stay live — switching re-previews the line.
              <>
                <Text style={styles.combineHint}>
                  TAP PLAYERS TO COMBINE · {(STAT_LABELS[combo.stat] ?? combo.stat).toUpperCase()}
                </Text>
                {board.scopeInProgress && board.firstInProgress && (
                  <Text style={styles.inProgressNote}>
                    {closedBettingNote(board.firstInProgress)}
                  </Text>
                )}
                <View>
                  {comboMemberPool.map(m => {
                    const on = combo.members.has(m.playerId)
                    const solo = board.scopeLines.find(
                      l => l.subjectPlayerId === m.playerId && comboStatOf(l) === combo.stat
                    )
                    return (
                      <View key={m.playerId} style={styles.memberRow}>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>
                            {m.name}{m.playerId === playerId ? ' (you)' : ''}
                          </Text>
                          {solo?.line != null && (
                            <Text style={styles.memberSolo}>solo line {solo.line.toFixed(1)}</Text>
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
                {comboArmed && (
                  <Text style={styles.combineHint}>
                    TAP ANY STAT LINE TO START A COMBO — OR SWITCH PLAYER/SCOPE
                  </Text>
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
                        ].map((lines, idx, sets) => (
                          <View key={lines[0].subjectPlayerId ?? lines[0].marketId}>
                            {renderLineSet(
                              lines,
                              idx === sets.length - 1,
                              board.scopeInProgress || lines.some(l => l.inProgress),
                            )}
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
      {combining && combo?.stat != null && (
        <BuilderBar
          memberNames={comboMemberIds.map(
            id => rsvpInPlayers.find(m => m.playerId === id)?.name ?? '—'
          )}
          statLabel={(STAT_LABELS[combo.stat] ?? combo.stat).toUpperCase()}
          scopeLabel={scope === 'weekly' ? 'NIGHT' : `GAME ${comboScopeGame}`}
          line={comboPreviewLine}
          minMembers={comboMemberIds.length >= 2}
          alreadyStaged={comboAlreadyStaged}
          blocked={board.scopeInProgress}
          onAdd={addComboToSlip}
          onCancel={() => setCombo(null)}
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
  memberSolo: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
    letterSpacing: 0.5,
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
