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
import LineRowContainer from '../components/betting/LineRowContainer'
import CustomLineRow from '../components/betting/CustomLineRow'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import ConfirmActionSheet from '../components/ui/ConfirmActionSheet'
import ComboComposerSheet from '../components/betting/ComboComposerSheet'
import Button from '../components/ui/Button'
import FeatureExplainerSheet from '../components/pinsino/FeatureExplainerSheet'
import TermsBlock from '../components/ui/TermsBlock'
import { EXPLAINERS, TERMS } from '../data/pinsinoExplainers'
import {
  usePinsinoData,
  selectionBetsAgainstSubject,
  customLineSelfTank,
  customLegLabel,
  lineGroup,
  lineCategory,
  closedBettingNote,
  subjectRelation,
  withVisibleSelections,
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

  const { loading, balance, openLines, weekTeams, customLines, weekBets, settledBets, seasonNumber, readOnly, reload, currentWeekId, currentSeasonId, rsvpInPlayers } = usePinsinoData(playerId, pinsinoViewSeasonId)
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
    clearSlip,
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

  // Schedule game numbers for the combo composer's scope picker, derived from
  // the board; [1, 2] before any per-game lines exist (the compose RPC's
  // pre-teams default, so the picker never offers a game the RPC rejects).
  const comboGameNumbers = useMemo(() => {
    const nums = [...new Set(openLines.map(l => l.gameNumber).filter((n): n is number => n != null))]
      .sort((a, b) => a - b)
    return nums.length > 0 ? nums : [1, 2]
  }, [openLines])

  // Two-level grouping for the board: game group (GAME 1, …, SEASON) → line
  // category (Player Over/Unders, …). Each category renders one collapsible
  // LineRowContainer, so a single game can carry several independently-collapsed
  // line types. Both levels are market-type-aware, so the screen stays agnostic.
  //
  // Within a category, a subject's markets consolidate into ONE row: lines
  // sharing a subjectPlayerId render as a unified button set on that player
  // ("142.5+ PINS · 4.5+ STRIKES · 2.5+ SPARES"), ordered score line first
  // then stat props. Team-anchored lines (the viewer's moneyline WIN + every
  // team's team_prop stat lines) consolidate the same way per teamId — one
  // team row ("Your Team" / "Team N": WIN · 612.5+ TOTAL PINS · …). Rows then
  // group by week team — the viewer's team first, the remaining teams in
  // first-appearance order — with each team's row leading its players.
  const lineGroups = useMemo(() => {
    const kindOrder = (l: LineView) =>
      // The moneyline WIN leads its team row; the team stat buttons follow.
      l.marketType === 'moneyline' ? -1
        : l.marketType === 'over_under' ? 0
          : l.marketType === 'prop'
            // One stat order everywhere — player and team rows alike read
            // PINS · CLEAN FRAMES · STRIKES · SPARES (the score line is the
            // player row's "total pins"). (first_ball_avg is retired for new
            // markets — legacy lines sink to the row's end.)
            ? 1 + ['clean_frames', 'strikes', 'spares'].indexOf(l.statKey ?? '')
            : l.marketType === 'team_prop'
              ? 1 + ['total_pins', 'clean_frames', 'strikes', 'spares'].indexOf(l.statKey ?? '')
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
      // Team-prop lines consolidate per team (one row of stat buttons per
      // team), mirroring how a player's markets consolidate per subject.
      const rowKey = line.teamId ?? line.subjectPlayerId ?? line.marketId
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
            // Group rows by week team: viewer's team rank 0, the rest by first
            // appearance. Within a team block the TEAM row (moneyline WIN +
            // team stat lines, rowKey = teamId) leads its players.
            const teamRank = new Map<string, number>()
            const rankOf = (row: { key: string; lines: LineView[] }) => {
              // Team rows carry their team directly; player rows map through
              // the week roster.
              const team = row.lines[0]?.teamId ?? weekTeams.teamByPlayer[row.key]
              if (!team) return Number.MAX_SAFE_INTEGER
              if (team === weekTeams.myTeamId) return 0
              if (!teamRank.has(team)) teamRank.set(team, 1 + teamRank.size)
              return teamRank.get(team)!
            }
            const isTeamRow = (row: { lines: LineView[] }) => (row.lines[0]?.teamId != null ? 0 : 1)
            const ranked = rows.map((row, idx) => ({ row, rank: rankOf(row), idx }))
            ranked.sort((a, b) => a.rank - b.rank || isTeamRow(a.row) - isTeamRow(b.row) || a.idx - b.idx)
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

  // One subject row (≥1 markets → one button set) — a player's lines or a
  // team's (WIN + team stats). Tapping a cell stages it in the unified slip
  // (staged = filled); an in-progress game makes every side inert. Each button
  // binds its own (line, selection).
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
            : lines[0].teamId != null
              // Team-prop rows relate by their anchored team directly; a night
              // team row (no game) reads "against" if that team opposes the
              // viewer in ANY of the night's games.
              ? lines[0].teamId === weekTeams.myTeamId
                ? 'with'
                : (lines[0].gameNumber != null
                    ? weekTeams.opponentTeamByGame[lines[0].gameNumber] === lines[0].teamId
                    : Object.values(weekTeams.opponentTeamByGame).includes(lines[0].teamId))
                  ? 'against'
                  : null
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
                  // Keep a staged special visible under a collapsed header.
                  pinned: slipSpecials.some(s => s.key === cl.id),
                  render: (isLast: boolean) => (
                    <CustomLineRow
                      line={cl}
                      isLast={isLast}
                      inProgress={gameInProgress || cl.inProgress}
                      disabled={balance < 10 || customLineSelfTank(cl, playerId)}
                      selected={slipSpecials.some(s => s.key === cl.id)}
                      onTake={() => stageSpecial(cl)}
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
                    // Every group starts collapsed — the board lands as summary
                    // bars over the poker table; players expand what they want.
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

      {/* Combo composer — compose = bet in one action; optionally parlays the
          staged slip picks into the same ticket (which then clears the slip). */}
      {composerOpen && currentWeekId != null && currentSeasonId != null && (
        <ComboComposerSheet
          weekId={currentWeekId}
          seasonId={currentSeasonId}
          balance={balance}
          gameNumbers={comboGameNumbers}
          members={rsvpInPlayers}
          slipSelectionIds={slipPicks.map(p => p.selectionId)}
          onClose={() => setComposerOpen(false)}
          onDone={parlayed => { if (parlayed) clearSlip(); reload() }}
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

  hauntSheetCopy: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
})
