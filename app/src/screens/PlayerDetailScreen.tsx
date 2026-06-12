import { useMemo, useEffect } from 'react'
import {
  View, Text, TouchableOpacity,
  ScrollView, RefreshControl, StyleSheet, useWindowDimensions,
} from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { LineChart } from 'react-native-gifted-charts'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import {
  usePlayerDetailData,
  computePlayerSeasons,
  computePlayerProfile,
  computePersonalRecords,
  computeCurrentTeam,
  computeWeekRows,
  computeChartPoints,
  computeExpandedMatchups,
} from '../hooks/usePlayerDetailData'
import { useFrameStatsData, computeFrameRecords } from '../hooks/useFrameStatsData'
import LoadingView from '../components/ui/LoadingView'
import PillFilter from '../components/ui/PillFilter'
import ScreenHeader from '../components/ui/ScreenHeader'
import PlayerAvatar from '../components/ui/PlayerAvatar'

type PlayerDetailRoute = RouteProp<{ PlayerDetail: { name: string } }, 'PlayerDetail'>

export default function PlayerDetailScreen() {
  const route = useRoute<PlayerDetailRoute>()
  const navigation = useNavigation()
  const name = route.params.name

  useEffect(() => { navigation.setOptions({ title: name }) }, [name, navigation])

  const {
    loading, playerId, isChampion, seasonList,
    allScores, allSchedule, playerSlots, reload,
  } = usePlayerDetailData(name)

  const { playerSeason, expandedWeek, set } = useUiStore()
  const { session: frameSession, reload: reloadFrames } = useFrameStatsData(playerId)
  const { refreshing, onRefresh } = useRefresh(async () => { await Promise.all([reload(), reloadFrames()]) })
  const { width: screenWidth } = useWindowDimensions()

  const playerSeasons = useMemo(
    () => playerId ? computePlayerSeasons(playerId, allScores, seasonList) : [],
    [playerId, allScores, seasonList],
  )

  const activeSeason = playerSeason ?? 'all'
  const activeSeasonId = useMemo(
    () => activeSeason === 'all'
      ? null
      : (playerSeasons.find(s => String(s.number) === activeSeason)?.id ?? null),
    [activeSeason, playerSeasons],
  )
  const currentSeasonId = useMemo(
    () => seasonList.length ? seasonList[seasonList.length - 1].id : null,
    [seasonList],
  )

  const profile = useMemo(
    () => playerId
      ? computePlayerProfile(playerId, allScores, allSchedule, activeSeasonId, currentSeasonId)
      : null,
    [playerId, allScores, allSchedule, activeSeasonId, currentSeasonId],
  )

  const records = useMemo(
    () => playerId
      ? computePersonalRecords(playerId, playerSlots, allScores, allSchedule)
      : null,
    [playerId, playerSlots, allScores, allSchedule],
  )

  const currentTeam = useMemo(
    () => computeCurrentTeam(playerSlots),
    [playerSlots],
  )

  const weekRows = useMemo(() => {
    if (!playerId) return []
    return computeWeekRows(playerId, playerSlots, allScores, allSchedule, activeSeasonId).filter(r => r.present)
  }, [playerId, playerSlots, allScores, allSchedule, activeSeasonId])

  const chartData = useMemo(() => {
    if (!playerId) return null
    const rawPoints = computeChartPoints(playerId, allScores, allSchedule, activeSeasonId)
    if (!rawPoints.length) return null
    // Every game carries its week label, so weeks repeat 2–3× and all-time
    // becomes an unreadable wall — keep at most ~6 labels at evenly spaced
    // points (week boundaries give uneven gaps since weeks have 2–3 games).
    const weekCount = new Set(rawPoints.map(p => p.label)).size
    const labelCount = Math.min(6, weekCount)
    const labeledIdx = new Set(
      labelCount > 1
        ? Array.from({ length: labelCount }, (_, j) => Math.round(j * (rawPoints.length - 1) / (labelCount - 1)))
        : [0],
    )
    const points = rawPoints.map((p, i) => (labeledIdx.has(i) ? p : { ...p, label: '' }))
    const avg = profile?.avg ?? 0
    const chartWidth = screenWidth - 32 - 4 - 12 - 35
    return { points, avg, chartWidth }
  }, [playerId, allScores, allSchedule, activeSeasonId, profile, screenWidth])

  const hasFrameStats = !!frameSession
  const frameRecords = useMemo(() => computeFrameRecords(frameSession), [frameSession])

  function toggleWeek(key: string) {
    set({ expandedWeek: expandedWeek === key ? null : key })
  }

  if (loading || !playerId) return <LoadingView label="Loading player" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenHeader
          title={`${name}${isChampion ? ' 👑' : ''}`}
          subtitle={currentTeam ?? undefined}
          onBack={() => navigation.goBack()}
        />

        <View style={styles.avatarWrap}>
          <PlayerAvatar name={name} size={96} />
        </View>

        <PillFilter
          items={['all', ...playerSeasons.map(s => String(s.number))]}
          value={activeSeason}
          onChange={(s) => set({ playerSeason: s })}
          renderLabel={(s) => s === 'all' ? 'All-time' : `Season ${s}`}
        />

        {/* Stat tiles */}
        {profile ? (
          <View style={styles.statGrid}>
            <StatTile label="Avg" value={profile.avg > 0 ? profile.avg.toFixed(1) : '—'} />
            <StatTile label="High Game" value={profile.highGame || '—'} />
            <StatTile label="Season Avg" value={profile.seasonAvg > 0 ? profile.seasonAvg.toFixed(1) : '—'} />
            <StatTile label="Last 5 Avg" value={profile.last5Avg > 0 ? profile.last5Avg.toFixed(1) : '—'} />
            <StatTile label="Games" value={String(profile.totalGames)} />
            <StatTile label="W—L" value={`${profile.totalWins}–${profile.totalLosses}`} />
          </View>
        ) : null}

        {/* Frame-level game details (when we have Lanetalk data) */}
        {hasFrameStats ? (
          <TouchableOpacity
            style={styles.frameStatsBtn}
            activeOpacity={0.7}
            onPress={() => (navigation as any).navigate('FrameStats', { name, playerId })}
          >
            <View style={styles.frameStatsIcon}>
              <Text style={{ fontSize: 18 }}>🎳</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.frameStatsLabel}>Game Details</Text>
              <Text style={styles.frameStatsSub}>Frame-by-frame scorecards & pin stats</Text>
            </View>
            <Text style={styles.frameStatsChevron}>›</Text>
          </TouchableOpacity>
        ) : null}

        {/* Personal records */}
        {records ? (
          <>
            <Text style={styles.sectionHeader}>Personal Records</Text>
            <RecordCard icon="📈" label="High Series" value={records.highSeries || '—'} />
            {frameRecords ? (
              <>
                <RecordCard
                  icon="💥"
                  label="High Strikes"
                  value={`${frameRecords.strikesGame} / ${frameRecords.strikesNight}`}
                  sub="Game / Week"
                />
                <RecordCard
                  icon="🎯"
                  label="High Spares"
                  value={`${frameRecords.sparesGame} / ${frameRecords.sparesNight}`}
                  sub="Game / Week"
                />
                <RecordCard
                  icon="✅"
                  label="High Closed Frames"
                  value={`${frameRecords.closedGame} / ${frameRecords.closedNight}`}
                  sub="Game / Week"
                />
              </>
            ) : null}
          </>
        ) : null}

        {/* Score Trend chart */}
        {chartData ? (
          <View style={styles.chartCard}>
            <Text style={styles.sectionHeader}>Score Trend</Text>
            <View style={{ overflow: 'hidden' }}>
              <LineChart
                data={chartData.points}
                width={chartData.chartWidth}
                height={140}
                color={colors.accent}
                thickness={2}
                curved
                areaChart
                startFillColor={colors.accentDim}
                endFillColor="transparent"
                startOpacity={0.4}
                endOpacity={0}
                dataPointsColor={colors.accent}
                dataPointsRadius={3}
                showReferenceLine1
                referenceLine1Position={chartData.avg}
                referenceLine1Config={{ color: colors.danger, dashWidth: 4, dashGap: 4, thickness: 1.5 }}
                rulesColor="rgba(255,255,255,0.05)"
                rulesType="solid"
                yAxisColor="transparent"
                xAxisColor="transparent"
                yAxisTextStyle={{ color: colors.muted, fontSize: 10, fontFamily: fonts.barlowCondensed }}
                xAxisLabelTextStyle={{ color: colors.muted, fontSize: 11, fontFamily: fonts.barlowCondensed, width: 40, textAlign: 'center' }}
                hideDataPoints={false}
                showXAxisIndices={false}
                hideYAxisText={false}
                noOfSections={4}
                adjustToWidth
                initialSpacing={8}
                endSpacing={0}
                backgroundColor={colors.surface}
                xAxisLabelsVerticalShift={4}
              />
            </View>
          </View>
        ) : null}

        {/* Game log */}
        <Text style={styles.sectionHeader}>Game Log</Text>

        {weekRows.length ? (
          <View style={styles.logCard}>
            {(() => {
              const maxGames = weekRows.reduce((max, r) => Math.max(max, r.scores.length), 2)
              const weekRowCounts = new Map<string, number>()
              for (const r of weekRows) weekRowCounts.set(r.weekId, (weekRowCounts.get(r.weekId) ?? 0) + 1)
              return (
                <>
                  <View style={styles.logRow}>
                    <Text style={[styles.logCell, styles.logWeekCell, styles.logHeaderText]}>Week</Text>
                    <Text style={[styles.logCell, styles.logTeamCell, styles.logHeaderText]}>Team</Text>
                    {Array.from({ length: maxGames }, (_, i) => (
                      <Text key={i} style={[styles.logCell, styles.logScoreCell, styles.logHeaderText]}>G{i + 1}</Text>
                    ))}
                    <Text style={[styles.logCell, styles.logWlCell, styles.logHeaderText]}>W—L</Text>
                    <View style={styles.logExpandCell} />
                  </View>

                  {weekRows.map((row) => {
                    // A player can hold slots on two teams in one week (e.g. mid-week
                    // team move), so the row key must include the team.
                    const rowKey = `${row.weekId}:${row.teamNumber}`
                    const expanded = expandedWeek === rowKey
                    // Multi-team week: limit each row's expansion to the games
                    // this slot bowled. Single-team weeks keep the full week.
                    const multiTeamWeek = (weekRowCounts.get(row.weekId) ?? 0) > 1
                    const matchups = expanded
                      ? computeExpandedMatchups(row.weekId, allScores, allSchedule, multiTeamWeek ? row.gameIds : undefined)
                      : []

                    return (
                      <View key={rowKey}>
                        <TouchableOpacity
                          style={[styles.logRow, styles.logRowBorder]}
                          onPress={() => toggleWeek(rowKey)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.logCell, styles.logWeekCell, styles.logText]}>
                            {`S${row.seasonNumber}W${row.weekNumber}`}
                          </Text>
                          <Text style={[styles.logCell, styles.logTeamCell, styles.logMuted]} numberOfLines={1}>
                            {`Team ${row.teamNumber}`}
                          </Text>
                          {!row.present ? (
                            <Text style={[styles.logCell, styles.logAbsent]}>absent</Text>
                          ) : (
                            <>
                              {Array.from({ length: maxGames }, (_, i) => (
                                <Text key={i} style={[styles.logCell, styles.logScoreCell, { color: row.scores[i] ? colors.accent : colors.muted }]}>
                                  {row.scores[i] || '—'}
                                </Text>
                              ))}
                              <Text style={[
                                styles.logCell, styles.logWlCell,
                                row.wins > row.losses ? styles.logWin : row.losses > row.wins ? styles.logLoss : styles.logMuted,
                              ]}>
                                {(row.wins || row.losses) ? `${row.wins}—${row.losses}` : '—'}
                              </Text>
                            </>
                          )}
                          <Text style={styles.logExpandCell}>{expanded ? '▾' : '▸'}</Text>
                        </TouchableOpacity>

                        {expanded ? (
                          <View style={styles.expandedBlock}>
                            {matchups.length ? (
                              matchups.map((m) => (
                                <View key={`${m.gameNum}-${m.a.team}`} style={styles.expandedMatchup}>
                                  <Text style={styles.expandedGameLabel}>Game {m.gameNum}</Text>
                                  <View style={styles.matchupRow}>
                                    <MatchupTeamCol
                                      team={m.a}
                                      highlightName={name}
                                      winner={m.b ? m.a.total > m.b.total : false}
                                    />
                                    {m.b ? (
                                      <>
                                        <View style={styles.matchupDivider} />
                                        <MatchupTeamCol
                                          team={m.b}
                                          highlightName={name}
                                          winner={m.b.total > m.a.total}
                                        />
                                      </>
                                    ) : null}
                                  </View>
                                </View>
                              ))
                            ) : (
                              <Text style={styles.emptyExpand}>No matchup data for this week.</Text>
                            )}
                          </View>
                        ) : null}
                      </View>
                    )
                  })}
                </>
              )
            })()}
          </View>
        ) : profile ? (
          <Text style={styles.empty}>No games yet.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={statStyles.tile}>
      <Text style={statStyles.label}>{label}</Text>
      <Text style={statStyles.value}>{String(value)}</Text>
    </View>
  )
}

function RecordCard({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub?: string }) {
  return (
    <View style={recordStyles.card}>
      <View style={recordStyles.iconBox}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={recordStyles.label}>{label}</Text>
        <Text style={recordStyles.value}>{String(value)}</Text>
        {sub ? <Text style={recordStyles.sub}>{sub}</Text> : null}
      </View>
    </View>
  )
}

function MatchupTeamCol({ team, highlightName, winner }: {
  team: { team: string; players: { name: string; score: number; present: boolean }[]; total: number }
  highlightName: string
  winner: boolean
}) {
  const players = [...team.players].sort((a, b) => b.score - a.score)
  return (
    <View style={expandStyles.col}>
      <Text style={expandStyles.colHeader} numberOfLines={1}>{team.team}</Text>
      {players.map((p, i) => (
        <View key={`${p.name}-${i}`} style={expandStyles.rosterRow}>
          <Text
            style={[
              expandStyles.rosterName,
              p.name === highlightName && expandStyles.rosterNameLead,
              !p.present && expandStyles.absent,
            ]}
            numberOfLines={1}
          >
            {p.name}{!p.present ? ' OUT' : ''}
          </Text>
          <Text style={expandStyles.rosterScore}>{p.score || '—'}</Text>
        </View>
      ))}
      <View style={expandStyles.totalRow}>
        <Text style={expandStyles.totalLabel}>TOTAL</Text>
        <Text style={[expandStyles.totalVal, winner && expandStyles.totalLead]}>{team.total}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  avatarWrap: { alignItems: 'center', marginTop: 4, marginBottom: 12 },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },

  chartCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    paddingVertical: 14,
    paddingLeft: 4,
    paddingRight: 12,
    overflow: 'hidden',
  },

  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
    marginTop: 4,
    marginBottom: 8,
  },

  logCard: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    overflow: 'hidden',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  logRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  logCell: { fontFamily: fonts.barlowCondensed, fontSize: 13 },
  logHeaderText: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  logWeekCell: { width: 70, color: colors.muted },
  logTeamCell: { flex: 1, color: colors.muted },
  logScoreCell: { width: 32, textAlign: 'right' },
  logWlCell: { width: 42, textAlign: 'right' },
  logExpandCell: { width: 20, textAlign: 'center', color: colors.muted, fontSize: 11 },
  logText: { color: colors.text },
  logMuted: { color: colors.muted },
  logAbsent: { flex: 1, color: colors.muted2, fontFamily: fonts.barlowCondensed, fontSize: 12, fontStyle: 'italic' },
  logWin: { color: colors.success },
  logLoss: { color: colors.danger },

  expandedBlock: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  expandedMatchup: { marginBottom: 12 },
  expandedGameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
    letterSpacing: 1,
    marginBottom: 6,
  },
  matchupRow: { flexDirection: 'row', gap: 12 },
  matchupDivider: { width: 1, backgroundColor: colors.border },
  emptyExpand: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, padding: 8 },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
  },

  frameStatsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 12,
  },
  frameStatsIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.icon,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameStatsLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.5,
  },
  frameStatsSub: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  frameStatsChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 24,
    color: colors.muted,
  },
})

const statStyles = StyleSheet.create({
  tile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 26,
    color: colors.text,
  },
})

const recordStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.icon,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
  },
  sub: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
})

const expandStyles = StyleSheet.create({
  col: { flex: 1 },
  colHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  rosterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
    gap: 8,
  },
  rosterName: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    flexShrink: 1,
  },
  rosterNameLead: { color: colors.accent },
  absent: { color: colors.muted2 },
  rosterScore: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
  },
  totalVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
  },
  totalLead: { color: colors.accent },
})
