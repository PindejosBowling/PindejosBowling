import { useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  StyleSheet,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import PlayerScoreRow from '../components/PlayerScoreRow'
import OddsBlock from '../components/OddsBlock'
import ConfirmBar from '../components/ConfirmBar'
import EditableWeek from '../components/EditableWeek'
import AdminArchiveModal from '../components/AdminArchiveModal'
import AdminGenerateTeamsModal from '../components/AdminGenerateTeamsModal'
import ToggleGroup from '../components/ToggleGroup'
import Button from '../components/Button'
import { useMatchupsData } from '../hooks/useMatchupsData'
import { useWeekEditor } from '../hooks/useWeekEditor'
import { usePendingStore } from '../stores/pendingStore'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { scores, teams as teamsDb, games, weeks, betMarkets, pvpChallenges } from '../utils/supabase/db'
import { colors, fonts, radius } from '../theme'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------


function VsBar() {
  return (
    <View style={sharedStyles.vsBar}>
      <View style={sharedStyles.vsLine} />
      <View style={sharedStyles.vsChip}><Text style={sharedStyles.vsText}>VS</Text></View>
      <View style={sharedStyles.vsLine} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Approximate heights for floating bars (used for paddingBottom calculation)
// ---------------------------------------------------------------------------

const CONFIRM_BAR_HEIGHT = 57
const ARCHIVE_BAR_HEIGHT = 57

// ---------------------------------------------------------------------------
// Root screen
// ---------------------------------------------------------------------------

export default function MatchupsScreen() {
  const { loading, weekId, derived, gameIdByNumber, inProgressGames, reload } = useMatchupsData()
  const { matchupsView, oddsRevealed, set: setUi } = useUiStore()
  const { pendingScores, set: setPending } = usePendingStore()
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const [saving, setSaving] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [showGenerateTeams, setShowGenerateTeams] = useState(false)
  const [addingGame, setAddingGame] = useState(false)
  const [removingGame, setRemovingGame] = useState(false)
  const [openGames, setOpenGames] = useState<Record<number, boolean>>({})
  const [startingGame, setStartingGame] = useState<number | null>(null)
  const [editMode, setEditMode] = useState(false)
  const { refreshing, onRefresh } = useRefresh(reload)

  // Admin week editor for this week (scores, roster, swaps, fills), shown in edit
  // mode. In view mode, admins still edit scores inline on the rows below, which
  // auto-save in the background via flushScores.
  const editor = useWeekEditor(weekId, isAdmin && editMode, derived?.leagueAvg ?? 0, reload)

  // All games collapsed by default; tapping a header toggles it open.
  const isGameOpen = (num: number) => !!openGames[num]
  const toggleGame = (num: number) =>
    setOpenGames(prev => ({ ...prev, [num]: !prev[num] }))

  const isActive = !!derived
  const teams = derived?.teams ?? {}
  const rounds = derived?.rounds ?? []
  const leagueAvg = derived?.leagueAvg ?? 0

  const hasSavedScores = isActive && Object.values(teams).some((team: any) =>
    team.players.some((p: any) =>
      !p.isFill && Object.values(p.scores).some((v: any) => v !== '' && v > 0)
    )
  )

  function getTotal(teamName: string, gameNum: number): number {
    const team = teams[teamName]
    if (!team) return 0
    return team.players.reduce((s: number, p: any) => {
      // A stored score (including an admin-entered fill score) always wins; an
      // unscored fill falls back to its league-average estimate.
      const raw = p.scores[gameNum] ?? ''
      if (raw !== '' && raw != null) return s + (parseInt(String(raw)) || 0)
      if (p.isFill) return s + (p.effectiveAvg > 0 ? Math.round(p.effectiveAvg) : 0)
      return s
    }, 0)
  }

  function aWins(pairing: any, gameNum: number) {
    const a = getTotal(pairing.a.name, gameNum)
    const b = getTotal(pairing.b.name, gameNum)
    return a > 0 && a > b
  }
  function bWins(pairing: any, gameNum: number) {
    const a = getTotal(pairing.a.name, gameNum)
    const b = getTotal(pairing.b.name, gameNum)
    return b > 0 && b > a
  }

  const hasPendingScores = Object.keys(pendingScores).length > 0

  function discardScores() {
    setPending({ pendingScores: {} })
  }

  function confirmClearMatchups() {
    const doClear = async () => {
      if (!weekId) return
      // Deleting the week's teams cascades to its slots, games, and scores.
      await teamsDb.removeByWeek(weekId)
      await weeks.update(weekId, { is_confirmed: false })
      await reload()
    }
    if (Platform.OS === 'web') {
      if (window.confirm('Clear Matchups? This will remove all teams, game schedule, and any saved scores for this week. This cannot be undone.')) doClear()
    } else {
      Alert.alert(
        'Clear Matchups?',
        'This will remove all teams, game schedule, and any saved scores for this week. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clear', style: 'destructive', onPress: doClear },
        ]
      )
    }
  }

  async function removeLastGame() {
    if (!weekId || rounds.length <= 2) return
    const maxGameNum = Math.max(...rounds.map(r => r.num))
    setRemovingGame(true)
    try {
      const slotIds = Object.values(teams).flatMap((team: any) =>
        team.players.map((p: any) => p.teamSlotId)
      )
      await Promise.all(slotIds.map(slotId => scores.remove(slotId, gameIdByNumber[maxGameNum])))
      await games.removeByWeekAndGame(weekId, maxGameNum)
      // Inverse of addNextGame's market sync: refund + drop this game's O/U lines
      // (sync never prunes a removed game, so this is the explicit teardown).
      await betMarkets.removeOUForGame(weekId, maxGameNum)
      await reload()
    } finally {
      setRemovingGame(false)
    }
  }

  // Start a game: close its betting markets (no more bets — the Pinsino takes no
  // action on games in progress) and reveal the scores by expanding the game.
  // Starting also closes any still-open PvP challenges for this game (accepted
  // ones are untouched). Unstart reverses the markets for betting, but does NOT
  // reopen closed challenges — once closed they stay cancelled.
  async function setGameStarted(gameNum: number, started: boolean) {
    if (!weekId) return
    setStartingGame(gameNum)
    try {
      await betMarkets.setOUStatusByWeekGame(weekId, gameNum, started ? 'closed' : 'open')
      await betMarkets.setMoneylineStatusByWeekGame(weekId, gameNum, started ? 'closed' : 'open')
      if (started) {
        await pvpChallenges.closeOpenForGame(weekId, gameNum)
        setOpenGames(prev => ({ ...prev, [gameNum]: true }))
      }
      await reload()
    } finally {
      setStartingGame(null)
    }
  }

  async function addNextGame() {
    if (!weekId) return
    const game1Round = rounds.find(r => r.num === 1)
    if (!game1Round) return
    const nextGameNum = rounds.length > 0 ? Math.max(...rounds.map(r => r.num)) + 1 : 2
    setAddingGame(true)
    try {
      const rows = game1Round.pairings
        .filter(p => p.b !== null)
        .map(p => ({
          game_number: nextGameNum,
          team_a_id: p.a.teamId,
          team_b_id: p.b!.teamId,
        }))
      await games.insert(rows)
      // Markets aren't derived from the games table — tell the betting system this
      // schedule game now exists so it creates its RSVP-driven O/U lines (same call
      // team-gen makes for game 3). Idempotent.
      await betMarkets.syncOUForWeek(weekId, [nextGameNum])
      // Moneylines do derive from the new games rows — sync them too. Idempotent.
      await betMarkets.syncMoneylineForWeek(weekId)
      await reload()
    } finally {
      setAddingGame(false)
    }
  }

  // Admin-only background save. Triggered when an admin leaves a score input
  // (PlayerScoreRow's onBlur) — there is no manual Save button. Players never
  // call this; for them the screen is a pure pin-total calculator.
  //
  // The flush reads pending scores straight from the store (not the render
  // closure) so a save kicked off by one blur always sees the latest edits, and
  // it self-guards against overlap: a blur landing mid-flush queues exactly one
  // follow-up rather than racing a second concurrent write.
  const flushingRef = useRef(false)
  const flushQueuedRef = useRef(false)

  async function flushScores() {
    if (flushingRef.current) { flushQueuedRef.current = true; return }
    const pending = usePendingStore.getState().pendingScores
    const keys = Object.keys(pending)
    if (!keys.length) return
    flushingRef.current = true
    setSaving(true)
    try {
      const toUpsert = keys
        .filter(k => pending[k] !== '')
        .map(k => {
          const [teamSlotId, gameNum] = k.split('|')
          const gameNumber = parseInt(gameNum)
          return { team_slot_id: teamSlotId, game_id: gameIdByNumber[gameNumber], score: parseInt(pending[k]) }
        })
      const toDelete = keys
        .filter(k => pending[k] === '')
        .map(k => { const [teamSlotId, gameNum] = k.split('|'); return { teamSlotId, gameId: gameIdByNumber[parseInt(gameNum)] } })

      if (toUpsert.length) await scores.upsert(toUpsert)
      await Promise.all(toDelete.map(({ teamSlotId, gameId }) => scores.remove(teamSlotId, gameId)))
      // Clear only the keys we just persisted, preserving any edits the admin
      // made while the save was in flight (those will flush on their own blur).
      const after = usePendingStore.getState().pendingScores
      const next = { ...after }
      for (const k of keys) if (next[k] === pending[k]) delete next[k]
      setPending({ pendingScores: next })
      await reload()
    } finally {
      flushingRef.current = false
      setSaving(false)
      if (flushQueuedRef.current) { flushQueuedRef.current = false; flushScores() }
    }
  }

  const editing = isAdmin && editMode
  const showArchiveBar = isAdmin && !editMode && hasSavedScores
  // Background-save indicator for inline editing (normal view only).
  const showSaveBar = isAdmin && !editMode && saving
  const showEditBar = editing && editor.pendingCount > 0

  // The save bar and edit bar are mutually exclusive (one needs edit mode off,
  // the other needs it on), so they share a single CONFIRM_BAR_HEIGHT slot.
  const floatingPadding =
    (showArchiveBar ? ARCHIVE_BAR_HEIGHT : 0) +
    (showSaveBar || showEditBar ? CONFIRM_BAR_HEIGHT : 0)

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {loading && !derived ? (
          <LoadingView label="Loading matchups" />
        ) : (
          <View style={{ flex: 1 }}>
            <ScrollView
              contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + floatingPadding, flexGrow: 1 }]}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
              }
            >
              {isActive ? (
                <>
                  {/* Title + view toggle */}
                  <View style={styles.titleRow}>
                    <Text style={styles.screenTitle}>Matchups</Text>
                    <View style={styles.titleActions}>
                      {isAdmin && (
                        <TouchableOpacity
                          onPress={() => setEditMode(e => !e)}
                          style={[styles.resetBtn, editMode && styles.editBtnActive]}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.resetBtnText, editMode && styles.editBtnActiveText]}>
                            {editMode ? 'Done' : 'Edit'}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {isAdmin && !editMode && (
                        <TouchableOpacity onPress={confirmClearMatchups} style={styles.resetBtn} activeOpacity={0.7}>
                          <Text style={styles.resetBtnText}>Reset</Text>
                        </TouchableOpacity>
                      )}
                      {!editMode && (
                        <ToggleGroup
                          options={[{ key: 'scores', label: 'Live' }, { key: 'expected', label: 'Expected' }]}
                          value={matchupsView}
                          onChange={(v) => setUi({ matchupsView: v })}
                        />
                      )}
                    </View>
                  </View>

                  {editing ? (
                    editor.loading ? (
                      <LoadingView label="Loading editor" />
                    ) : (
                      <EditableWeek editor={editor} />
                    )
                  ) : (
                  <>
                  {/* Rounds */}
                  {rounds.map(round => (
                    <View key={round.num}>
                      <TouchableOpacity
                        style={styles.matchHeader}
                        onPress={() => toggleGame(round.num)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.matchTitle}>Game {round.num}</Text>
                        <View style={styles.matchHeaderRight}>
                          {isAdmin && (
                            inProgressGames.includes(round.num) ? (
                              <TouchableOpacity
                                style={styles.unstartGameBtn}
                                onPress={() => setGameStarted(round.num, false)}
                                disabled={startingGame === round.num}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.unstartGameText}>
                                  {startingGame === round.num ? 'Unstarting…' : 'Unstart Game'}
                                </Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={styles.startGameBtn}
                                onPress={() => setGameStarted(round.num, true)}
                                disabled={startingGame === round.num}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.startGameText}>
                                  {startingGame === round.num ? 'Starting…' : 'Start Game'}
                                </Text>
                              </TouchableOpacity>
                            )
                          )}
                          <Text style={styles.matchChevron}>{isGameOpen(round.num) ? '▾' : '▸'}</Text>
                        </View>
                      </TouchableOpacity>
                      {isGameOpen(round.num) && round.pairings.map((pairing, pi) => (
                        <View key={pi} style={styles.matchupCard}>
                          {!pairing.b ? (
                            <View>
                              <View style={[styles.teamBlock]}>
                                <Text style={styles.teamLabel}>{pairing.a.name}</Text>
                                {pairing.a.players.map((player: any) => (
                                  <PlayerScoreRow
                                    key={player.slot}
                                    player={player}
                                    gameNum={round.num}
                                    mode={matchupsView as 'scores' | 'expected'}
                                    leagueAvg={leagueAvg}
                                    onCommit={isAdmin ? flushScores : undefined}
                                  />
                                ))}
                              </View>
                              <Text style={styles.sitsOut}>— sits out —</Text>
                            </View>
                          ) : (
                            <>
                              <View style={[styles.teamBlock, aWins(pairing, round.num) && styles.teamBlockWinner]}>
                                <Text style={[styles.teamLabel, aWins(pairing, round.num) && styles.teamLabelWinner]}>
                                  {pairing.a.name}
                                </Text>
                                {pairing.a.players.map((player: any) => (
                                  <PlayerScoreRow
                                    key={player.slot}
                                    player={player}
                                    gameNum={round.num}
                                    mode={matchupsView as 'scores' | 'expected'}
                                    leagueAvg={leagueAvg}
                                    onCommit={isAdmin ? flushScores : undefined}
                                  />
                                ))}
                                {matchupsView === 'expected' ? (
                                  <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Expected total</Text>
                                    <Text style={[styles.totalVal, styles.totalLosing]}>{pairing.a.expectedTotal}</Text>
                                  </View>
                                ) : getTotal(pairing.a.name, round.num) > 0 ? (
                                  <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Team total</Text>
                                    <Text style={[styles.totalVal, aWins(pairing, round.num) ? styles.totalWinning : styles.totalLosing]}>
                                      {getTotal(pairing.a.name, round.num)}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>

                              <VsBar />

                              <View style={[styles.teamBlock, bWins(pairing, round.num) && styles.teamBlockWinner]}>
                                <Text style={[styles.teamLabel, bWins(pairing, round.num) && styles.teamLabelWinner]}>
                                  {pairing.b.name}
                                </Text>
                                {pairing.b.players.map((player: any) => (
                                  <PlayerScoreRow
                                    key={player.slot}
                                    player={player}
                                    gameNum={round.num}
                                    mode={matchupsView as 'scores' | 'expected'}
                                    leagueAvg={leagueAvg}
                                    onCommit={isAdmin ? flushScores : undefined}
                                  />
                                ))}
                                {matchupsView === 'expected' ? (
                                  <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Expected total</Text>
                                    <Text style={[styles.totalVal, styles.totalLosing]}>{pairing.b.expectedTotal}</Text>
                                  </View>
                                ) : getTotal(pairing.b.name, round.num) > 0 ? (
                                  <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Team total</Text>
                                    <Text style={[styles.totalVal, bWins(pairing, round.num) ? styles.totalWinning : styles.totalLosing]}>
                                      {getTotal(pairing.b.name, round.num)}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            </>
                          )}
                        </View>
                      ))}
                    </View>
                  ))}

                  {/* Add / remove game buttons */}
                  {isAdmin && (
                    <View style={styles.gameCtrlRow}>
                      {rounds.length > 2 && (
                        <TouchableOpacity
                          style={styles.removeGameBtn}
                          onPress={removeLastGame}
                          disabled={removingGame}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.removeGameText}>
                            {removingGame
                              ? 'Removing…'
                              : `✕ Remove Game ${Math.max(...rounds.map(r => r.num))}`}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.addGameBtn}
                        onPress={addNextGame}
                        disabled={addingGame}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.addGameText}>
                          {addingGame
                            ? 'Adding…'
                            : `+ Add Game ${rounds.length > 0 ? Math.max(...rounds.map(r => r.num)) + 1 : 2}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Odds easter egg (expected mode only) */}
                  {matchupsView === 'expected' && (
                    <View>
                      <TouchableOpacity
                        style={styles.oddsToggle}
                        onPress={() => setUi({ oddsRevealed: !oddsRevealed })}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.oddsToggleText}>{oddsRevealed ? '· hide odds ·' : '· · ·'}</Text>
                      </TouchableOpacity>
                      {oddsRevealed && (
                        <View style={styles.oddsPanel}>
                          <Text style={styles.oddsTitle}>Tonight's Lines</Text>
                          {rounds.map(round =>
                            round.pairings
                              .filter(p => !!p.b)
                              .map((pairing, pi) => (
                                <OddsBlock
                                  key={`${round.num}-${pi}`}
                                  teamA={pairing.a}
                                  teamB={pairing.b!}
                                  leagueAvg={leagueAvg}
                                  label={`Game ${round.num} · ${pairing.a.name} vs ${pairing.b!.name}`}
                                />
                              ))
                          )}
                          <Text style={styles.oddsDisclaimer}>For entertainment only. Lines are made up.</Text>
                        </View>
                      )}
                    </View>
                  )}
                  </>
                  )}
                </>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>This week's teams haven't been set up yet.</Text>
                  {isAdmin && (
                    <Button label="🎲 Generate Teams" onPress={() => setShowGenerateTeams(true)} style={styles.generateBtn} />
                  )}
                </View>
              )}
            </ScrollView>

            {/* Floating archive bar (view mode only) */}
            {showArchiveBar && (
              <View style={styles.archiveFloatBar}>
                <Text style={styles.archiveBarIcon}>📦</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.archiveBarTitle}>SCORES SAVED</Text>
                  <Text style={styles.archiveBarSubtext}>Ready to archive this week?</Text>
                </View>
                <TouchableOpacity
                  style={styles.archiveBarBtn}
                  onPress={() => setShowArchive(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.archiveBarBtnText}>Archive &amp; Advance</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Passive background-save indicator — admins auto-save on blur in
                view mode, so there is no Save button, just feedback while the
                flush is running. */}
            {showSaveBar && (
              <ConfirmBar
                icon="✏️"
                title="Saving scores…"
                saving={true}
                onDiscard={discardScores}
                onSave={flushScores}
              />
            )}

            {/* Floating save/discard bar — admin week editor (edit mode) */}
            {showEditBar && (
              <ConfirmBar
                icon="✏️"
                title={editor.saving ? `Saving ${editor.pendingCount} change${editor.pendingCount !== 1 ? 's' : ''}...` : `${editor.pendingCount} unsaved change${editor.pendingCount !== 1 ? 's' : ''}`}
                subtext={editor.saving ? undefined : 'Save or discard your changes'}
                saving={editor.saving}
                onDiscard={editor.discard}
                onSave={async () => { await editor.save(); setEditMode(false) }}
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <AdminArchiveModal visible={showArchive} onClose={() => { setShowArchive(false); reload() }} />
      {isAdmin && (
        <AdminGenerateTeamsModal
          visible={showGenerateTeams}
          onClose={() => { setShowGenerateTeams(false); reload() }}
        />
      )}
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sharedStyles = StyleSheet.create({
  vsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  vsLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  vsChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginHorizontal: 8,
    backgroundColor: colors.surface3,
    borderRadius: 6,
  },
  vsText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 2,
  },
})

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  screenTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(255,79,109,0.4)',
  },
  resetBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.danger,
    letterSpacing: 0.5,
  },
  editBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  editBtnActiveText: {
    color: colors.accent,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  clearBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingRight: 4,
    marginTop: 8,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
  },
  matchHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  matchChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.muted,
  },
  startGameBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  startGameText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  unstartGameBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
  },
  unstartGameText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.gold,
  },
  matchTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.text,
  },
  matchupCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  teamBlock: {
    paddingVertical: 8,
  },
  teamBlockWinner: {
    backgroundColor: 'rgba(232,255,71,0.04)',
  },
  teamLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  teamLabelWinner: {
    color: colors.accent,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  totalVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
  },
  totalWinning: { color: colors.accent },
  totalLosing: { color: colors.muted },
  sitsOut: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 10,
  },
  oddsToggle: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  oddsToggleText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 2,
  },
  oddsPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  oddsTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.danger,
    marginBottom: 10,
  },
  oddsDisclaimer: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    color: colors.muted2,
    fontStyle: 'italic',
    marginTop: 10,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.muted,
  },
  generateBtn: { marginTop: 20, paddingHorizontal: 20 },
  gameCtrlRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  addGameBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: radius.cardSm,
    borderStyle: 'dashed',
  },
  addGameText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 1,
  },
  removeGameBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,79,109,0.3)',
    borderRadius: radius.cardSm,
    borderStyle: 'dashed',
  },
  removeGameText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.danger,
    letterSpacing: 1,
  },
  archiveFloatBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251,191,36,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  archiveBarIcon: { fontSize: 18 },
  archiveBarTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  archiveBarSubtext: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  archiveBarBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
  },
  archiveBarBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.gold,
    letterSpacing: 0.5,
  },
})
