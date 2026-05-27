import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import PlayerScoreRow from '../components/PlayerScoreRow'
import OddsBlock from '../components/OddsBlock'
import ConfirmBar from '../components/ConfirmBar'
import AdminArchiveModal from '../components/AdminArchiveModal'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import { usePendingStore } from '../stores/pendingStore'
import { usePrefsStore } from '../stores/prefsStore'
import { hasActiveWeek, readActiveWeek, getLeagueAvg, effectiveAvg } from '../utils/data.js'
import { apiPost } from '../api.js'
import { colors, fonts, radius } from '../theme'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ViewToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={sharedStyles.toggleRow}>
      {(['scores', 'expected'] as const).map(v => (
        <TouchableOpacity
          key={v}
          style={[sharedStyles.toggleBtn, value === v && sharedStyles.toggleBtnActive]}
          onPress={() => onChange(v)}
          activeOpacity={0.7}
        >
          <Text style={[sharedStyles.toggleBtnText, value === v && sharedStyles.toggleBtnTextActive]}>
            {v === 'scores' ? 'Live' : 'Expected'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function AvgSourceToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [
    { key: 'last-played', label: 'Last Season' },
    { key: 'current-season', label: 'This Season' },
    { key: 'all-time', label: 'All-time' },
  ]
  return (
    <View style={sharedStyles.toggleRow}>
      {opts.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[sharedStyles.toggleBtn, value === o.key && sharedStyles.toggleBtnActive]}
          onPress={() => onChange(o.key)}
          activeOpacity={0.7}
        >
          <Text style={[sharedStyles.toggleBtnText, value === o.key && sharedStyles.toggleBtnTextActive]}>
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

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
// Active panel
// ---------------------------------------------------------------------------

function ActivePanel() {
  const { active, stats, settings, rsvp, loadAll } = useDataStore()
  const { matchupsView, oddsRevealed, set: setUi } = useUiStore()
  const { pendingScores, set: setPending } = usePendingStore()
  const { avgDisplay, setAvgDisplay } = usePrefsStore()
  const [saving, setSaving] = useState(false)
  const [showArchive, setShowArchive] = useState(false)

  const teams: Record<string, any> = readActiveWeek(active)

  const leagueAvg: number = getLeagueAvg(stats, settings, avgDisplay as any)

  const sourceLabel =
    avgDisplay === 'current-season' ? 'Season Avg' :
    avgDisplay === 'all-time' ? 'All-time Avg' :
    'Last Season Avg'

  const hasSavedScores = Object.values(teams).some((team: any) =>
    team.players.some((p: any) =>
      !p.isFill && (
        (p.g1 !== '' && p.g1 > 0) ||
        (p.g2 !== '' && p.g2 > 0) ||
        (p.g3 !== '' && p.g3 > 0)
      )
    )
  )

  function buildPairings(teamsMap: Record<string, any>, gameNum: number) {
    const names = Object.keys(teamsMap).sort()
    const seen = new Set<string>()
    const pairings: { a: any; b: any }[] = []
    names.forEach(t => {
      if (seen.has(t)) return
      const opp = teamsMap[t]?.opponents?.[gameNum]
      if (opp && teamsMap[opp] && teamsMap[opp].opponents?.[gameNum] === t) {
        seen.add(t); seen.add(opp)
        pairings.push({ a: teamsMap[t], b: teamsMap[opp] })
      }
    })
    return pairings
  }

  const rounds = (() => {
    const result: { num: number; pairings: { a: any; b: any }[] }[] = []
    for (let g = 1; g <= 3; g++) {
      const pairings = buildPairings(teams, g)
      if (pairings.length) result.push({ num: g, pairings })
    }
    return result
  })()

  function getTotal(teamName: string, gameNum: number): number {
    const team = teams[teamName]
    if (!team) return 0
    return team.players.reduce((s: number, p: any) => {
      const key = `${teamName}|${p.slot}|${gameNum}`
      const pending = pendingScores[key]
      if (pending) return s + (parseInt(pending) || 0)
      if (p.isFill) return s + (leagueAvg > 0 ? Math.round(leagueAvg) : 0)
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

  function expectedTotal(team: any): number {
    return team.players.reduce((s: number, p: any) => {
      const avg = effectiveAvg(stats, settings, rsvp, p.name, p.isFill, leagueAvg)
      return s + (avg > 0 ? Math.round(avg) : 0)
    }, 0)
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
    const batchScores = keys.map(k => {
      const score = pendingScores[k]
      const [team, slot, gameNum] = k.split('|')
      return { team, slot: parseInt(slot), gameNum: parseInt(gameNum), score }
    })
    try {
      await apiPost('batchUpdateScores', { scores: batchScores })
      await loadAll()
      setPending({ pendingScores: {} })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Title + view toggle */}
      <View style={styles.titleRow}>
        <Text style={styles.screenTitle}>Matchups</Text>
        <ViewToggle value={matchupsView} onChange={v => setUi({ matchupsView: v })} />
      </View>

      {/* League avg banner */}
      <View style={styles.leagueBanner}>
        <View>
          <Text style={styles.bannerLabel}>League {sourceLabel}</Text>
          <Text style={styles.bannerVal}>{leagueAvg > 0 ? leagueAvg.toFixed(1) : '—'}</Text>
        </View>
        <AvgSourceToggle value={avgDisplay} onChange={setAvgDisplay} />
      </View>

      {/* Archive & Advance prompt */}
      {hasSavedScores && (
        <View style={styles.archivePrompt}>
          <Text style={styles.archiveIcon}>📦</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.archiveTitle}>SCORES SAVED</Text>
            <Text style={styles.archiveSubtext}>Ready to archive this week?</Text>
          </View>
          <TouchableOpacity
            style={styles.archiveBtn}
            onPress={() => setShowArchive(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.archiveBtnText}>Archive &amp; Advance</Text>
          </TouchableOpacity>
        </View>
      )}

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
                        teamName={pairing.a.name}
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
                        teamName={pairing.a.name}
                        gameNum={round.num}
                        mode={matchupsView as 'scores' | 'expected'}
                        leagueAvg={leagueAvg}
                      />
                    ))}
                    {matchupsView === 'expected' ? (
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Expected total</Text>
                        <Text style={[styles.totalVal, styles.totalLosing]}>{expectedTotal(pairing.a)}</Text>
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
                        teamName={pairing.b.name}
                        gameNum={round.num}
                        mode={matchupsView as 'scores' | 'expected'}
                        leagueAvg={leagueAvg}
                      />
                    ))}
                    {matchupsView === 'expected' ? (
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Expected total</Text>
                        <Text style={[styles.totalVal, styles.totalLosing]}>{expectedTotal(pairing.b)}</Text>
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
                      teamB={pairing.b}
                      leagueAvg={leagueAvg}
                      label={`Game ${round.num} · ${pairing.a.name} vs ${pairing.b.name}`}
                    />
                  ))
              )}
              <Text style={styles.oddsDisclaimer}>For entertainment only. Lines are made up.</Text>
            </View>
          )}
        </View>
      )}

      {hasPendingScores && (
        <ConfirmBar
          message={saving ? `Saving ${pendingCount} score${pendingCount !== 1 ? 's' : ''}...` : `${pendingCount} unsaved score${pendingCount !== 1 ? 's' : ''}`}
          saving={saving}
          onDiscard={discardScores}
          onSave={saveScores}
        />
      )}

      <AdminArchiveModal visible={showArchive} onClose={() => setShowArchive(false)} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Root screen
// ---------------------------------------------------------------------------

export default function MatchupsScreen() {
  const { loading, active, loadActive } = useDataStore()

  useEffect(() => { loadActive() }, [])

  const isActive = hasActiveWeek(active)

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {loading && !active ? (
          <LoadingView label="Loading matchups" />
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={loadActive} tintColor={colors.accent} />
            }
          >
            {isActive ? <ActivePanel /> : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>This week's teams haven't been set up yet.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sharedStyles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  toggleBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  toggleBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  toggleBtnTextActive: {
    color: colors.accent,
  },
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
  leagueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
  },
  bannerLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  bannerVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 24,
    color: colors.text,
  },
  archivePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(251,191,36,0.06)',
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    padding: 12,
    marginBottom: 12,
  },
  archiveIcon: { fontSize: 20 },
  archiveTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  archiveSubtext: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  archiveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
  },
  archiveBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.gold,
    letterSpacing: 0.5,
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
  // Legacy panel player rows
  legacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.icon,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarChamp: {
    borderWidth: 1,
    borderColor: colors.gold,
  },
  avatarText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
    letterSpacing: 0.5,
  },
  playerName: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
  },
  outTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.danger,
    letterSpacing: 1,
  },
  subtext: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  legacyScoreGroup: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  scoreDisplay: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    minWidth: 40,
    textAlign: 'right',
  },
})
