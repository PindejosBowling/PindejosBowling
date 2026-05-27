import { useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, StyleSheet, useWindowDimensions,
} from 'react-native'
import { LineChart } from 'react-native-gifted-charts'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import {
  getPlayerProfile, getPersonalRecords, isChampion,
  getSeasons, getMatchupsForWeek,
} from '../utils/data.js'
import { initials, isPresent } from '../utils/helpers.js'
import { SC } from '../utils/constants.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function PlayerDetailScreen() {
  const route = useRoute<RouteProp<MoreStackParamList, 'PlayerDetail'>>()
  const navigation = useNavigation<Nav>()
  const { stats, settings, champions, loading, loadAll } = useDataStore()
  const { playerSeason, playerLogMode, expandedWeek, set } = useUiStore()

  const name = route.params.name
  const { width: screenWidth } = useWindowDimensions()
const seasons = useMemo(() => (stats ? getSeasons(stats) : []), [stats])
  const activeSeason = playerSeason ?? 'all'

  const profile = useMemo(
    () => (stats ? getPlayerProfile(stats, settings, name, activeSeason) : null),
    [stats, settings, name, activeSeason],
  )

  const records = useMemo(
    () => (stats ? getPersonalRecords(stats, name) : null),
    [stats, name],
  )

  const currentTeam = useMemo(() => {
    const rows = profile?.rows
    if (!rows?.length) return null
    return rows[rows.length - 1][SC.TEAM] || null
  }, [profile])

  const weekRows = useMemo(() => {
    const rows = profile?.rows
    if (!rows) return []
    const result: any[] = []
    rows.forEach((r: any) => {
      const present = isPresent(r[SC.PRESENT])
      if (playerLogMode === 'bowled' && !present) return
      result.push({
        season: r[SC.SEASON],
        week: r[SC.WEEK],
        team: r[SC.TEAM],
        g1: parseInt(r[SC.G1]) || 0,
        g2: parseInt(r[SC.G2]) || 0,
        w: parseInt(r[SC.WINS]) || 0,
        l: parseInt(r[SC.LOSSES]) || 0,
        present,
      })
    })
    return result.sort((a, b) => {
      const sa = parseInt(a.season) || 0, sb = parseInt(b.season) || 0
      if (sa !== sb) return sb - sa
      return (parseInt(b.week) || 0) - (parseInt(a.week) || 0)
    })
  }, [profile, playerLogMode])

  const chartData = useMemo(() => {
    if (!profile?.games?.length) return null
    const games = profile.games
    const avg = profile.avg
    const chartWidth = screenWidth - 32 - 4 - 12 - 35 // card margins(32) + paddingLeft(4) + paddingRight(12) + y-axis(35)
    return {
      points: games.map((g: any) => ({
        value: g.score,
        label: `S${g.season}W${g.week}`,
        dataPointColor: colors.accent,
        dataPointRadius: 3,
      })),
      avg,
      chartWidth,
    }
  }, [profile, screenWidth])

  function weekKey(row: any) {
    return `${row.season}|${row.week}`
  }

  function weekLabel(row: any) {
    return isNaN(parseInt(row.week)) ? row.week : `S${row.season}W${row.week}`
  }

  function toggleWeek(key: string) {
    set({ expandedWeek: expandedWeek === key ? null : key })
  }

  function expandedMatchups(row: any) {
    if (!stats) return []
    const all = getMatchupsForWeek(stats, row.season, row.week)
    const team = row.team
    if (!team) return all
    const mine = all.filter((m: any) => m.a?.team === team || m.b?.team === team)
    return mine.length ? mine : all
  }

  if (loading || !stats) return <LoadingView label="Loading player" />

  const champ = isChampion(champions, name)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('PlayerList')} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.playerName}>
              {name}{champ ? ' 👑' : ''}
            </Text>
            {currentTeam ? <Text style={styles.subtext}>{currentTeam}</Text> : null}
          </View>
        </View>

        {/* Season pill filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
        >
          {(['all', ...seasons] as string[]).map((s) => {
            const active = s === activeSeason
            return (
              <TouchableOpacity
                key={s}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => set({ playerSeason: s })}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {s === 'all' ? 'All-time' : `Season ${s}`}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        {/* Stat tiles */}
        {profile ? (
          <View style={styles.statGrid}>
            <StatTile label="Avg" value={profile.avg > 0 ? profile.avg.toFixed(1) : '—'} />
            <StatTile label="High Game" value={profile.highGame || '—'} />
            <StatTile label="W—L" value={`${profile.totalWins}–${profile.totalLosses}`} />
            <StatTile label="Last 5 Avg" value={profile.last5Avg > 0 ? profile.last5Avg.toFixed(1) : '—'} />
            <StatTile label="Season Avg" value={profile.seasonAvg > 0 ? profile.seasonAvg.toFixed(1) : '—'} />
            <StatTile label="Games" value={String(profile.totalGames)} />
          </View>
        ) : null}

        {/* Personal records */}
        {records ? (
          <>
            <Text style={styles.sectionHeader}>Personal Records</Text>
            <RecordCard icon="🎳" label="High Game" value={records.highGame || '—'} />
            <RecordCard icon="📈" label="High Series (G1+G2)" value={records.highSeries || '—'} />
            <RecordCard
              icon="🔥"
              label="Best Streak"
              value={`${records.bestStreak} ${records.bestStreak === 1 ? 'night' : 'nights'}`}
              sub={records.currentStreak > 0
                ? `Current: ${records.currentStreak} ${records.currentStreakType === 'W' ? 'win' : 'loss'}${records.currentStreak > 1 ? (records.currentStreakType === 'W' ? 's' : 'es') : ''}`
                : undefined}
            />
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
                referenceLine1Config={{ color: colors.accent2, dashWidth: 4, dashGap: 4, thickness: 1.5 }}
                rulesColor="rgba(255,255,255,0.05)"
                rulesType="solid"
                yAxisColor="transparent"
                xAxisColor="transparent"
                yAxisTextStyle={{ color: colors.muted, fontSize: 10, fontFamily: fonts.barlowCondensed }}
                xAxisLabelTextStyle={{ color: colors.muted, fontSize: 9, fontFamily: fonts.barlowCondensed }}
                hideDataPoints={false}
                showXAxisIndices={false}
                hideYAxisText={false}
                noOfSections={4}
                adjustToWidth
                initialSpacing={8}
                endSpacing={0}
                backgroundColor={colors.surface}
                xAxisLabelsVerticalShift={4}
                rotateLabel
              />
            </View>
          </View>
        ) : null}

        {/* Game log */}
        <View style={styles.logHeader}>
          <Text style={styles.sectionHeader}>Game Log</Text>
          <View style={styles.toggleGroup}>
            {(['bowled', 'all'] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.toggleBtn, playerLogMode === mode && styles.toggleBtnActive]}
                onPress={() => set({ playerLogMode: mode })}
              >
                <Text style={[styles.toggleBtnText, playerLogMode === mode && styles.toggleBtnTextActive]}>
                  {mode === 'bowled' ? 'Bowled' : 'All Weeks'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {weekRows.length ? (
          <View style={styles.logCard}>
            {/* Log header row */}
            <View style={styles.logRow}>
              <Text style={[styles.logCell, styles.logWeekCell, styles.logHeaderText]}>Week</Text>
              <Text style={[styles.logCell, styles.logTeamCell, styles.logHeaderText]}>Team</Text>
              <Text style={[styles.logCell, styles.logScoreCell, styles.logHeaderText]}>G1</Text>
              <Text style={[styles.logCell, styles.logScoreCell, styles.logHeaderText]}>G2</Text>
              <Text style={[styles.logCell, styles.logWlCell, styles.logHeaderText]}>W—L</Text>
              <View style={styles.logExpandCell} />
            </View>

            {weekRows.map((row) => {
              const key = weekKey(row)
              const expanded = expandedWeek === key
              return (
                <View key={key}>
                  <TouchableOpacity
                    style={[styles.logRow, styles.logRowBorder]}
                    onPress={() => toggleWeek(key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.logCell, styles.logWeekCell, styles.logText]}>
                      {weekLabel(row)}
                    </Text>
                    <Text style={[styles.logCell, styles.logTeamCell, styles.logMuted]} numberOfLines={1}>
                      {row.team || ''}
                    </Text>
                    {!row.present ? (
                      <Text style={[styles.logCell, styles.logAbsent]}>absent</Text>
                    ) : (
                      <>
                        <Text style={[styles.logCell, styles.logScoreCell, { color: row.g1 ? colors.accent : colors.muted }]}>
                          {row.g1 || '—'}
                        </Text>
                        <Text style={[styles.logCell, styles.logScoreCell, { color: row.g2 ? colors.accent : colors.muted }]}>
                          {row.g2 || '—'}
                        </Text>
                        <Text style={[
                          styles.logCell, styles.logWlCell,
                          row.w > row.l ? styles.logWin : row.l > row.w ? styles.logLoss : styles.logMuted,
                        ]}>
                          {(row.w || row.l) ? `${row.w}—${row.l}` : '—'}
                        </Text>
                      </>
                    )}
                    <Text style={styles.logExpandCell}>{expanded ? '▾' : '▸'}</Text>
                  </TouchableOpacity>

                  {expanded ? (
                    <View style={styles.expandedBlock}>
                      {expandedMatchups(row).length ? (
                        expandedMatchups(row).map((m: any) => (
                          <View key={`${m.gameNum}-${m.a?.team}`} style={styles.expandedMatchup}>
                            <Text style={styles.expandedGameLabel}>Game {m.gameNum}</Text>
                            <ExpandedTeam team={m.a} />
                            {m.b ? (
                              <>
                                <View style={styles.vsRow}>
                                  <Text style={styles.vsText}>VS</Text>
                                </View>
                                <ExpandedTeam team={m.b} />
                              </>
                            ) : null}
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
          </View>
        ) : profile ? (
          <Text style={styles.empty}>No games yet.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={statStyles.tile}>
      <Text style={statStyles.label}>{label}</Text>
      <Text style={statStyles.value}>{value}</Text>
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

function ExpandedTeam({ team }: { team: any }) {
  if (!team) return null
  return (
    <View style={expandStyles.teamBlock}>
      <Text style={expandStyles.teamName}>{team.team}</Text>
      {team.players?.map((p: any) => (
        <View key={p.name} style={expandStyles.playerRow}>
          <View style={expandStyles.avatar}>
            <Text style={expandStyles.avatarText}>{initials(p.name)}</Text>
          </View>
          <Text style={[expandStyles.playerName, !p.present && expandStyles.absent]} numberOfLines={1}>
            {p.name}{!p.present ? ' OUT' : ''}
          </Text>
          <Text style={expandStyles.score}>{p.score || '—'}</Text>
        </View>
      ))}
      <View style={expandStyles.totalRow}>
        <Text style={expandStyles.totalLabel}>Total</Text>
        <Text style={expandStyles.totalVal}>{team.total}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { marginRight: 12, padding: 4, marginTop: 2 },
  backText: { fontSize: 20, color: colors.text },
  playerName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 24,
    color: colors.text,
    letterSpacing: 0.5,
  },
  subtext: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
    marginTop: 2,
  },

  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  pillText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  pillTextActive: { color: colors.accent },

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
  toggleGroup: { flexDirection: 'row', gap: 4 },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleBtnActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  toggleBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 11, color: colors.muted },
  toggleBtnTextActive: { color: colors.accent },

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
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  expandedMatchup: { marginBottom: 12 },
  expandedGameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
    letterSpacing: 1,
    marginBottom: 6,
  },
  vsRow: { alignItems: 'center', paddingVertical: 4 },
  vsText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted },
  emptyExpand: { fontFamily: fonts.barlow, fontSize: 13, color: colors.muted, padding: 8 },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
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
  teamBlock: {
    backgroundColor: colors.surface3,
    borderRadius: radius.cardSm,
    padding: 10,
    marginBottom: 4,
  },
  teamName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  avatarText: { fontFamily: fonts.barlowCondensed, fontSize: 11, color: colors.muted },
  playerName: { flex: 1, fontFamily: fonts.barlow, fontSize: 13, color: colors.text },
  absent: { color: colors.muted2 },
  score: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.accent },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
    paddingTop: 6,
  },
  totalLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted },
  totalVal: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.text },
})
