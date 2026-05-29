import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
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
import AdminArchiveModal from '../components/AdminArchiveModal'
import ToggleGroup from '../components/ToggleGroup'
import { useMatchupsData } from '../hooks/useMatchupsData'
import { useUiStore } from '../stores/uiStore'
import { usePendingStore } from '../stores/pendingStore'
import { scores } from '../utils/supabase/db'
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
  const { loading, derived, reload } = useMatchupsData()
  const { matchupsView, oddsRevealed, set: setUi } = useUiStore()
  const { pendingScores, set: setPending } = usePendingStore()
  const [saving, setSaving] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const { refreshing, onRefresh } = useRefresh(reload)

  const isActive = !!derived
  const teams = derived?.teams ?? {}
  const rounds = derived?.rounds ?? []
  const leagueAvg = derived?.leagueAvg ?? 0

  const hasSavedScores = isActive && Object.values(teams).some((team: any) =>
    team.players.some((p: any) =>
      !p.isFill && (
        (p.g1 !== '' && p.g1 > 0) ||
        (p.g2 !== '' && p.g2 > 0) ||
        (p.g3 !== '' && p.g3 > 0)
      )
    )
  )

  function getTotal(teamName: string, gameNum: number): number {
    const team = teams[teamName]
    if (!team) return 0
    return team.players.reduce((s: number, p: any) => {
      const key = `${p.teamSlotId}|${gameNum}`
      const pending = pendingScores[key]
      if (pending) return s + (parseInt(pending) || 0)
      if (p.isFill) return s + (p.effectiveAvg > 0 ? Math.round(p.effectiveAvg) : 0)
      const raw = gameNum === 1 ? p.g1 : gameNum === 2 ? p.g2 : p.g3
      return s + (parseInt(raw) || 0)
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
  const pendingCount = Object.keys(pendingScores).length

  function discardScores() {
    setPending({ pendingScores: {} })
  }

  async function saveScores() {
    const keys = Object.keys(pendingScores)
    if (!keys.length) return
    setSaving(true)
    try {
      const toUpsert = keys
        .filter(k => pendingScores[k] !== '')
        .map(k => {
          const [teamSlotId, gameNum] = k.split('|')
          return { team_slot_id: teamSlotId, game_number: parseInt(gameNum), score: parseInt(pendingScores[k]) }
        })
      const toDelete = keys
        .filter(k => pendingScores[k] === '')
        .map(k => { const [teamSlotId, gameNum] = k.split('|'); return { teamSlotId, gameNum: parseInt(gameNum) } })

      if (toUpsert.length) await scores.upsert(toUpsert)
      await Promise.all(toDelete.map(({ teamSlotId, gameNum }) => scores.remove(teamSlotId, gameNum)))
      await reload()
      setPending({ pendingScores: {} })
    } finally {
      setSaving(false)
    }
  }

  const floatingPadding =
    (hasSavedScores ? ARCHIVE_BAR_HEIGHT : 0) +
    (hasPendingScores ? CONFIRM_BAR_HEIGHT : 0)

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
                    <ToggleGroup
                      options={[{ key: 'scores', label: 'Live' }, { key: 'expected', label: 'Expected' }]}
                      value={matchupsView}
                      onChange={(v) => setUi({ matchupsView: v })}
                    />
                  </View>

                  {/* Rounds */}
                  {rounds.map(round => (
                    <View key={round.num}>
                      <View style={styles.matchHeader}>
                        <Text style={styles.matchTitle}>Game {round.num}</Text>
                      </View>
                      {round.pairings.map((pairing, pi) => (
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
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>This week's teams haven't been set up yet.</Text>
                </View>
              )}
            </ScrollView>

            {/* Floating archive bar — shifts up when ConfirmBar is also visible */}
            {hasSavedScores && (
              <View style={[styles.archiveFloatBar, hasPendingScores && { bottom: CONFIRM_BAR_HEIGHT }]}>
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

            {/* Floating save/discard bar */}
            {hasPendingScores && (
              <ConfirmBar
                icon="✏️"
                title={saving ? `Saving ${pendingCount} score${pendingCount !== 1 ? 's' : ''}...` : `${pendingCount} unsaved score${pendingCount !== 1 ? 's' : ''}`}
                subtext={saving ? undefined : 'Save or discard your changes'}
                saving={saving}
                onDiscard={discardScores}
                onSave={saveScores}
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <AdminArchiveModal visible={showArchive} onClose={() => { setShowArchive(false); reload() }} />
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
  matchHeader: {
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  matchTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.muted,
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
    color: colors.accent2,
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
