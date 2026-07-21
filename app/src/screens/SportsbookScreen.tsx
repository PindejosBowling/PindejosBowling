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
import { useBetSlip, useBetSlipReload } from '../components/betting/BetSlipProvider'
import LineRow from '../components/betting/LineRow'
import CustomLineRow from '../components/betting/CustomLineRow'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import ComboComposerSheet from '../components/betting/ComboComposerSheet'
import Button from '../components/ui/Button'
import PlayerPickerModal from '../components/ui/PlayerPickerModal'
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
  type BetView,
  type LineView,
  type SelectionView,
  type CustomLineView,
} from '../hooks/usePinsinoData'
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
  const [composerOpen, setComposerOpen] = useState(false)

  // Place-board filters: a scope (Weekly or one game) + a player. The board is
  // flat — it shows only the chosen player's lines for the chosen scope. The
  // player pick is the user's EXPLICIT choice; the effective selection is
  // derived in the board memo (pick while still available → viewer → first
  // available), so scope switches and reloads never need a reconciling effect.
  const [scope, setScope] = useState<string>('weekly')
  const [pickedPlayerId, setPickedPlayerId] = useState<string | null>(null)
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false)

  // The bet slip (staged picks/specials, placement, item inventory, balance) is
  // owned by the app-level BetSlipProvider so it can also be raised from Bet
  // Details on other screens. The board feeds it staged picks and reads its
  // contents to highlight selected cells; a placement refreshes the board via
  // useBetSlipReload. `ghosts` (haunt inventory) also lives there.
  const {
    slipPicks,
    slipSpecials,
    stagePick: stageSlipPick,
    stageSpecial: stageSlipSpecial,
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

  // Schedule game numbers for the combo composer's scope picker; [1, 2] before
  // any games/lines exist (the compose RPC's pre-teams default, so the picker
  // never offers a game the RPC rejects).
  const comboGameNumbers = weekGameNumbers.length > 0 ? weekGameNumbers : [1, 2]

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
      // A closed market anywhere in scope locks the whole scope (a started
      // game closes all its markets together), mirroring the old group lock.
      scopeInProgress: scopeLines.some(l => l.inProgress),
      firstInProgress: scopeLines.find(l => l.inProgress) ?? null,
    }
  }, [visibleLines, customLines, scope, pickedPlayerId, playerId, rsvpInPlayers])

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
          effectiveView === 'place' && (slipPicks.length > 0 || slipSpecials.length > 0) && { paddingBottom: 96 },
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
        {/* Build a Combo — the one global entry to the composer (scope, stat,
            members, stake all live inside the sheet). */}
        {currentWeekId != null && currentSeasonId != null && (
          <Button
            label="+ Build a Combo"
            variant="secondary"
            onPress={() => setComposerOpen(true)}
            style={styles.comboCta}
          />
        )}
        {/* The flat board: scope pills + player select, then the chosen
            player's available lines for that scope. The two filters ARE the
            navigation — no collapsible sections. Staged picks live in the
            global slip bar, so building a parlay across players/scopes is just
            switching the filters. */}
        {visibleLines.length > 0 || customLines.length > 0 ? (
          <View style={styles.board}>
            <ToggleGroup
              variant="pill"
              options={scopeOptions}
              value={scope}
              onChange={setScope}
              style={styles.scopeRow}
            />
            <Button
              selectable
              value={
                board.selectedPlayerId != null
                  ? `${board.players.find(p => p.id === board.selectedPlayerId)?.name ?? '—'}${board.selectedPlayerId === playerId ? ' (you)' : ''}`
                  : null
              }
              placeholder="Select player"
              onPress={() => setPlayerPickerOpen(true)}
              disabled={board.players.length === 0}
              style={styles.playerSelect}
            />
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
                  <View style={styles.card}>
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

      {/* Player filter picker — only players with in-scope availability. */}
      <PlayerPickerModal
        visible={playerPickerOpen}
        title="Show lines for"
        items={board.players}
        onSelectItem={it => { setPickedPlayerId(it.id); setPlayerPickerOpen(false) }}
        onClose={() => setPlayerPickerOpen(false)}
      />

      {/* Combo composer — stages a combo SPEC into the standard bet slip (no
          market/bet yet; the slip's placement creates the market atomically
          with the bet), so combos parlay with picks and other combos. */}
      {composerOpen && currentWeekId != null && currentSeasonId != null && (
        <ComboComposerSheet
          weekId={currentWeekId}
          seasonId={currentSeasonId}
          gameNumbers={comboGameNumbers}
          members={rsvpInPlayers}
          onClose={() => setComposerOpen(false)}
        />
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

  // The composer entry — sits between the view toggle and the board.
  comboCta: { marginBottom: 4 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  // Separates the board from the mode toggle above it — the filters lead
  // directly (no section header of its own).
  board: { marginTop: 16 },
  // The two board filters: scope pills over the player select field.
  scopeRow: { marginBottom: 10 },
  playerSelect: { marginBottom: 12 },
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
