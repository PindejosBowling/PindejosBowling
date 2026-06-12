import { useState, useMemo } from 'react'
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { LineChart } from 'react-native-gifted-charts'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useH2HData, computeH2HFromSupabase, H2HGame } from '../hooks/useH2HData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/ui/LoadingView'
import PlayerPickerModal from '../components/ui/PlayerPickerModal'
import ScreenHeader from '../components/ui/ScreenHeader'

type Nav = NativeStackNavigationProp<MoreStackParamList>

interface WeekGroup {
  key: string
  season: number
  week: number
  games: H2HGame[]
}

export default function HeadToHeadScreen() {
  const { loading, playerNames, rawScores, rawSchedule, reload } = useH2HData()
  const { h2hP1, h2hP2, set } = useUiStore()
  const { refreshing, onRefresh } = useRefresh(reload)
  const navigation = useNavigation<Nav>()
  const [pickerOpen, setPickerOpen] = useState<'p1' | 'p2' | null>(null)
  const { width: screenWidth } = useWindowDimensions()

  const h2hData = useMemo(
    () => (h2hP1 && h2hP2 && rawScores.length > 0
      ? computeH2HFromSupabase(h2hP1, h2hP2, rawScores, rawSchedule)
      : null),
    [h2hP1, h2hP2, rawScores, rawSchedule],
  )

  const [seasonFilter, setSeasonFilter] = useState<number | 'all'>('all')

  const seasons = useMemo(() => {
    if (!h2hData) return []
    return [...new Set(h2hData.games.map((g) => g.season))].sort((a, b) => a - b)
  }, [h2hData])

  const effectiveFilter =
    seasonFilter !== 'all' && !seasons.includes(seasonFilter) ? 'all' : seasonFilter

  const filtered = useMemo(() => {
    if (!h2hData) return null
    const games = effectiveFilter === 'all'
      ? h2hData.games
      : h2hData.games.filter((g) => g.season === effectiveFilter)
    const r = {
      teamP1Wins: 0, teamP2Wins: 0, teamTies: 0,
      pinP1Wins: 0, pinP2Wins: 0, pinTies: 0,
      totalP1Pins: 0, totalP2Pins: 0,
      games,
    }
    for (const g of games) {
      if (g.t1Total > g.t2Total) r.teamP1Wins++
      else if (g.t2Total > g.t1Total) r.teamP2Wins++
      else r.teamTies++

      if (g.p1Score > g.p2Score) r.pinP1Wins++
      else if (g.p2Score > g.p1Score) r.pinP2Wins++
      else if (g.p1Score && g.p2Score) r.pinTies++

      r.totalP1Pins += g.p1Score
      r.totalP2Pins += g.p2Score
    }
    return r
  }, [h2hData, effectiveFilter])

  const teamLead = useMemo(() => {
    if (!filtered) return null
    const { teamP1Wins, teamP2Wins } = filtered
    return teamP1Wins > teamP2Wins ? 'p1' : teamP2Wins > teamP1Wins ? 'p2' : 'tie'
  }, [filtered])

  const pinLead = useMemo(() => {
    if (!filtered) return null
    const { pinP1Wins, pinP2Wins } = filtered
    return pinP1Wins > pinP2Wins ? 'p1' : pinP2Wins > pinP1Wins ? 'p2' : 'tie'
  }, [filtered])

  const pinTotalLead = useMemo(() => {
    if (!filtered) return null
    const { totalP1Pins, totalP2Pins } = filtered
    return totalP1Pins > totalP2Pins ? 'p1' : totalP2Pins > totalP1Pins ? 'p2' : 'tie'
  }, [filtered])

  const combinedLead = useMemo(() => {
    if (!filtered) return null
    const p1 = filtered.teamP1Wins + filtered.pinP1Wins
    const p2 = filtered.teamP2Wins + filtered.pinP2Wins
    return p1 > p2 ? 'p1' : p2 > p1 ? 'p2' : 'tie'
  }, [filtered])

  const weekGroups: WeekGroup[] = useMemo(() => {
    if (!filtered) return []
    const map = new Map<string, WeekGroup>()
    for (const g of filtered.games) {
      const key = `S${g.season}W${g.week}`
      if (!map.has(key)) map.set(key, { key, season: g.season, week: g.week, games: [] })
      map.get(key)!.games.push(g)
    }
    return [...map.values()].reverse()
  }, [filtered])

  const chartData = useMemo(() => {
    if (!filtered || filtered.games.length < 2) return null
    const games = filtered.games
    // Same label thinning as PlayerDetailScreen: weeks repeat 2–3× per game,
    // so cap at ~6 evenly spaced labels to keep the x-axis readable.
    const weekCount = new Set(games.map((g) => `S${g.season}W${g.week}`)).size
    const labelCount = Math.min(6, weekCount)
    const labeledIdx = new Set(
      labelCount > 1
        ? Array.from({ length: labelCount }, (_, j) => Math.round(j * (games.length - 1) / (labelCount - 1)))
        : [0],
    )
    const p1Points = games.map((g, i) => ({
      value: g.p1Score,
      label: labeledIdx.has(i) ? `S${g.season}W${g.week}` : '',
    }))
    const p2Points = games.map((g) => ({ value: g.p2Score }))
    const chartWidth = screenWidth - 32 - 4 - 12 - 35
    return { p1Points, p2Points, chartWidth }
  }, [filtered, screenWidth])

  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set())
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set())

  function toggleWeek(key: string) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleGame(gameId: string) {
    setExpandedGames((prev) => {
      const next = new Set(prev)
      if (next.has(gameId)) next.delete(gameId)
      else next.add(gameId)
      return next
    })
  }

  const gameRosters = useMemo(() => {
    const map = new Map<string, { name: string; score: number; isFill: boolean }[]>()
    for (const row of rawScores) {
      const slot = row.team_slots
      if (!slot) continue
      const key = `${row.game_id}|${slot.team_id}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ name: slot.players?.name ?? 'Fill', score: row.score ?? 0, isFill: !!slot.is_fill })
    }
    for (const roster of map.values()) roster.sort((a, b) => b.score - a.score)
    return map
  }, [rawScores])

  function weekRecord(wk: WeekGroup) {
    let p1 = 0
    let p2 = 0
    for (const g of wk.games) {
      if (g.p1Score > g.p2Score) p1++
      else if (g.p2Score > g.p1Score) p2++
    }
    return { p1, p2 }
  }

  function teamDiff(g: any) {
    return g.t1Total - g.t2Total
  }

  function gameWinner(g: any) {
    const diff = teamDiff(g)
    if (diff === 0) return '—'
    return diff > 0 ? 'P1' : 'P2'
  }

  if (loading && rawScores.length === 0) return <LoadingView label="Loading head-to-head" />

  const noSelection = !h2hP1 || !h2hP2 || h2hP1 === h2hP2
  const p1Short = (h2hP1 || '').split(' ')[0]
  const p2Short = (h2hP2 || '').split(' ')[0]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Head to Head" onBack={() => navigation.navigate('MoreHome')} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {/* Player selectors */}
        <View style={styles.pickerRow}>
          <TouchableOpacity
            style={[styles.pickerBtn, h2hP1 ? styles.pickerBtnActive : null]}
            onPress={() => setPickerOpen('p1')}
            activeOpacity={0.7}
          >
            <Text style={[styles.pickerBtnText, h2hP1 ? styles.pickerBtnTextActive : null]} numberOfLines={1}>
              {h2hP1 || '— Bowler 1 —'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.vsText}>VS</Text>

          <TouchableOpacity
            style={[styles.pickerBtn, h2hP2 ? styles.pickerBtnActive : null]}
            onPress={() => setPickerOpen('p2')}
            activeOpacity={0.7}
          >
            <Text style={[styles.pickerBtnText, h2hP2 ? styles.pickerBtnTextActive : null]} numberOfLines={1}>
              {h2hP2 || '— Bowler 2 —'}
            </Text>
          </TouchableOpacity>
        </View>

        {noSelection ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⚔️</Text>
            <Text style={styles.emptyText}>Pick two different bowlers to compare.</Text>
          </View>
        ) : h2hData && h2hData.games.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>These two have never played head-to-head.</Text>
          </View>
        ) : h2hData && filtered ? (
          <>
            {/* Season filter */}
            {seasons.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipRow}
              >
                <TouchableOpacity
                  style={[styles.chip, effectiveFilter === 'all' && styles.chipActive]}
                  onPress={() => setSeasonFilter('all')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, effectiveFilter === 'all' && styles.chipTextActive]}>
                    ALL TIME
                  </Text>
                </TouchableOpacity>
                {seasons.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, effectiveFilter === s && styles.chipActive]}
                    onPress={() => setSeasonFilter(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, effectiveFilter === s && styles.chipTextActive]}>
                      SEASON {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Summary card */}
            <View style={styles.card}>
              <View style={styles.h2hHead}>
                <View style={styles.h2hNameCol}>
                  <View style={styles.h2hNameWrap}>
                    <Text style={styles.h2hCrown}>{combinedLead === 'p1' ? '👑' : ' '}</Text>
                    <Text style={[styles.h2hName, teamLead === 'p1' && styles.h2hNameLead]}>
                      {h2hP1}
                    </Text>
                  </View>
                </View>
                <Text style={styles.h2hDivider}>vs</Text>
                <View style={[styles.h2hNameCol, styles.h2hNameColRight]}>
                  <View style={styles.h2hNameWrap}>
                    <Text style={styles.h2hCrown}>{combinedLead === 'p2' ? '👑' : ' '}</Text>
                    <Text style={[styles.h2hName, styles.h2hNameRight, teamLead === 'p2' && styles.h2hNameLead]}>
                      {h2hP2}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>TEAM WINS</Text>
                <View style={styles.statLine}>
                  <Text style={[styles.statNum, teamLead === 'p1' && styles.statNumLead]}>
                    {filtered.teamP1Wins}
                  </Text>
                  <Text style={styles.statDash}>—</Text>
                  <Text style={[styles.statNum, teamLead === 'p2' && styles.statNumLead]}>
                    {filtered.teamP2Wins}
                  </Text>
                </View>
                {filtered.teamTies > 0 && (
                  <Text style={styles.statSub}>
                    {filtered.teamTies} tie{filtered.teamTies > 1 ? 's' : ''}
                  </Text>
                )}
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>PIN TOTAL WINS</Text>
                <View style={styles.statLine}>
                  <Text style={[styles.statNum, pinLead === 'p1' && styles.statNumLead]}>
                    {filtered.pinP1Wins}
                  </Text>
                  <Text style={styles.statDash}>—</Text>
                  <Text style={[styles.statNum, pinLead === 'p2' && styles.statNumLead]}>
                    {filtered.pinP2Wins}
                  </Text>
                </View>
                {filtered.pinTies > 0 && (
                  <Text style={styles.statSub}>
                    {filtered.pinTies} tie{filtered.pinTies > 1 ? 's' : ''}
                  </Text>
                )}
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>TOTAL PINS</Text>
                <View style={styles.statLine}>
                  <Text style={[styles.statNum, pinTotalLead === 'p1' && styles.statNumLead]}>
                    {filtered.totalP1Pins}
                  </Text>
                  <Text style={styles.statDash}>—</Text>
                  <Text style={[styles.statNum, pinTotalLead === 'p2' && styles.statNumLead]}>
                    {filtered.totalP2Pins}
                  </Text>
                </View>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>AVG / GAME</Text>
                <View style={styles.statLine}>
                  <Text style={[styles.statNum, pinTotalLead === 'p1' && styles.statNumLead]}>
                    {filtered.games.length ? (filtered.totalP1Pins / filtered.games.length).toFixed(1) : '0'}
                  </Text>
                  <Text style={styles.statDash}>—</Text>
                  <Text style={[styles.statNum, pinTotalLead === 'p2' && styles.statNumLead]}>
                    {filtered.games.length ? (filtered.totalP2Pins / filtered.games.length).toFixed(1) : '0'}
                  </Text>
                </View>
                <Text style={styles.statSub}>
                  {filtered.games.length} game{filtered.games.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>

            {/* Score trend chart */}
            {chartData && (
              <>
                <Text style={styles.sectionHeader}>SCORE TREND</Text>
                <View style={styles.chartCard}>
                  <View style={styles.chartLegend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
                      <Text style={styles.legendText}>{p1Short}</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
                      <Text style={styles.legendText}>{p2Short}</Text>
                    </View>
                  </View>
                  <View style={{ overflow: 'hidden' }}>
                    <LineChart
                      data={chartData.p1Points}
                      data2={chartData.p2Points}
                      width={chartData.chartWidth}
                      height={140}
                      color1={colors.accent}
                      color2={colors.danger}
                      thickness={2}
                      curved
                      dataPointsColor1={colors.accent}
                      dataPointsColor2={colors.danger}
                      dataPointsRadius={3}
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
              </>
            )}

            {/* Game log */}
            <Text style={styles.sectionHeader}>EVERY MATCHUP</Text>
            <View style={styles.logCard}>
              {weekGroups.map((wk, wi) => {
                const expanded = expandedWeeks.has(wk.key)
                const rec = weekRecord(wk)
                return (
                  <View key={wk.key}>
                    <TouchableOpacity
                      style={[styles.weekRow, wi > 0 && styles.logRowData]}
                      onPress={() => toggleWeek(wk.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.weekLabel}>
                        SEASON {wk.season} · WEEK {wk.week}
                      </Text>
                      <Text style={styles.weekRecordText}>
                        <Text style={rec.p1 > rec.p2 ? styles.weekRecordLead : null}>{rec.p1}</Text>
                        {' – '}
                        <Text style={rec.p2 > rec.p1 ? styles.weekRecordLead : null}>{rec.p2}</Text>
                      </Text>
                      <Text style={styles.weekChevron}>{expanded ? '▾' : '▸'}</Text>
                    </TouchableOpacity>

                    {expanded && (
                      <>
                        <View style={[styles.logRow, styles.logRowData]}>
                          <Text style={[styles.logCellWhen, styles.logHeaderText]}>GAME</Text>
                          <Text style={[styles.logCellScore, styles.logHeaderText]}>{p1Short} PINS</Text>
                          <Text style={[styles.logCellScore, styles.logHeaderText]}>{p2Short} PINS</Text>
                          <Text style={[styles.logCellSm, styles.logHeaderText]}>Δ</Text>
                          <Text style={[styles.logCellSm, styles.logHeaderText]}>WIN</Text>
                        </View>
                        {wk.games.map((g) => {
                          const spread = g.p1Score - g.p2Score
                          const gameOpen = expandedGames.has(g.gameId)
                          const roster1 = gameRosters.get(`${g.gameId}|${g.p1TeamId}`) ?? []
                          const roster2 = gameRosters.get(`${g.gameId}|${g.p2TeamId}`) ?? []
                          return (
                            <View key={g.gameId}>
                              <TouchableOpacity
                                style={[styles.logRow, styles.logRowData]}
                                onPress={() => toggleGame(g.gameId)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.logCellWhen, styles.logWeekText]}>
                                  G{g.gameNum} {gameOpen ? '▾' : '▸'}
                                </Text>
                                <Text style={[styles.logCellScore, styles.logValueText, { color: g.p1Score > g.p2Score ? colors.accent : colors.text }]}>
                                  {g.p1Score}
                                </Text>
                                <Text style={[styles.logCellScore, styles.logValueText, { color: g.p2Score > g.p1Score ? colors.accent : colors.text }]}>
                                  {g.p2Score}
                                </Text>
                                <Text style={[styles.logCellSm, styles.logValueText, { color: spread >= 0 ? colors.success : colors.danger }]}>
                                  {spread > 0 ? '+' : ''}{spread}
                                </Text>
                                <Text style={[styles.logCellSm, styles.logWinnerText]}>
                                  {gameWinner(g)}
                                </Text>
                              </TouchableOpacity>

                              {gameOpen && (
                                <View style={styles.matchupPanel}>
                                  <View style={styles.matchupCol}>
                                    <Text style={styles.matchupColHeader}>{p1Short.toUpperCase()}'S TEAM</Text>
                                    {roster1.map((r, ri) => (
                                      <View key={ri} style={styles.rosterRow}>
                                        <Text style={[styles.rosterName, r.name === h2hP1 && styles.rosterNameLead]} numberOfLines={1}>
                                          {r.name}{r.isFill ? ' (fill)' : ''}
                                        </Text>
                                        <Text style={styles.rosterScore}>{r.score}</Text>
                                      </View>
                                    ))}
                                    <View style={styles.rosterTotalRow}>
                                      <Text style={styles.rosterTotalLabel}>TOTAL</Text>
                                      <Text style={[styles.rosterTotal, g.t1Total > g.t2Total && styles.rosterTotalLead]}>
                                        {g.t1Total}
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={styles.matchupDivider} />
                                  <View style={styles.matchupCol}>
                                    <Text style={styles.matchupColHeader}>{p2Short.toUpperCase()}'S TEAM</Text>
                                    {roster2.map((r, ri) => (
                                      <View key={ri} style={styles.rosterRow}>
                                        <Text style={[styles.rosterName, r.name === h2hP2 && styles.rosterNameLead]} numberOfLines={1}>
                                          {r.name}{r.isFill ? ' (fill)' : ''}
                                        </Text>
                                        <Text style={styles.rosterScore}>{r.score}</Text>
                                      </View>
                                    ))}
                                    <View style={styles.rosterTotalRow}>
                                      <Text style={styles.rosterTotalLabel}>TOTAL</Text>
                                      <Text style={[styles.rosterTotal, g.t2Total > g.t1Total && styles.rosterTotalLead]}>
                                        {g.t2Total}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              )}
                            </View>
                          )
                        })}
                      </>
                    )}
                  </View>
                )
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      <PlayerPickerModal
        visible={pickerOpen === 'p1'}
        players={playerNames.filter((n) => n !== h2hP2)}
        title="Select Bowler 1"
        onSelect={(name) => { set({ h2hP1: name }); setPickerOpen(null) }}
        onClose={() => setPickerOpen(null)}
      />
      <PlayerPickerModal
        visible={pickerOpen === 'p2'}
        players={playerNames.filter((n) => n !== h2hP1)}
        title="Select Bowler 2"
        onSelect={(name) => { set({ h2hP2: name }); setPickerOpen(null) }}
        onClose={() => setPickerOpen(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },

  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  pickerBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  pickerBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  pickerBtnTextActive: { color: colors.accent },
  vsText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 1,
  },

  chipScroll: { marginBottom: 16, flexGrow: 0 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  chipText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 1,
  },
  chipTextActive: { color: colors.accent },

  emptyState: { alignItems: 'center', marginTop: 48, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 20,
  },
  h2hHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  h2hNameCol: { flex: 1, alignItems: 'flex-start' },
  h2hNameColRight: { alignItems: 'flex-end' },
  h2hNameWrap: { alignItems: 'center' },
  h2hCrown: {
    fontSize: 22,
    lineHeight: 26,
    marginBottom: 2,
  },
  h2hName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 17,
    color: colors.muted,
  },
  h2hNameRight: { textAlign: 'right' },
  h2hNameLead: { color: colors.accent },
  h2hDivider: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted2,
    marginHorizontal: 10,
  },

  statRow: { marginBottom: 14, alignItems: 'center' },
  statLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  statLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  statNum: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 30,
    color: colors.text,
    minWidth: 28,
    textAlign: 'center',
  },
  statNumLead: { color: colors.accent },
  statDash: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted2,
  },
  statSub: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 3,
  },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    paddingVertical: 14,
    paddingLeft: 4,
    paddingRight: 12,
    marginBottom: 20,
    overflow: 'hidden',
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
    paddingLeft: 12,
    marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  logCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    overflow: 'hidden',
  },
  logRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  logRowData: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  weekLabel: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 1,
  },
  weekRecordText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    marginRight: 10,
  },
  weekRecordLead: { color: colors.accent },
  weekChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    width: 14,
    textAlign: 'right',
  },
  logCellWhen: { width: 72 },
  logCellScore: { flex: 1 },
  logCellSm: { width: 36, textAlign: 'right' },
  logHeaderText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
  },
  logValueText: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
  },
  logWeekText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
  },
  logWinnerText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'right',
  },

  matchupPanel: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  matchupCol: { flex: 1 },
  matchupColHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  matchupDivider: { width: 1, backgroundColor: colors.border },
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
  rosterScore: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.text,
  },
  rosterTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rosterTotalLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
  },
  rosterTotal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
  },
  rosterTotalLead: { color: colors.accent },
})
