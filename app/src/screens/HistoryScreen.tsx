import { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { useHistoryData } from '../hooks/useHistoryData'
import { computePastGamesFromSupabase } from '../hooks/usePastGamesData'
import { computeStandingsFromSupabase } from '../hooks/useStandingsData'
import { useWeekEditor } from '../hooks/useWeekEditor'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/ui/LoadingView'
import ScreenContainer from '../components/ui/ScreenContainer'
import PillFilter from '../components/ui/PillFilter'
import HistoricalTeamBlock from '../components/league/HistoricalTeamBlock'
import EditableWeek from '../components/league/EditableWeek'
import ConfirmBar from '../components/ui/ConfirmBar'

type Nav = NativeStackNavigationProp<MoreStackParamList>

function formatDate(bowledAt: string | null): string {
  if (!bowledAt) return ''
  const [year, month, day] = bowledAt.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HistoryScreen() {
  const navigation = useNavigation<Nav>()
  const { loading, seasonList, rawScores, rawSchedule, champsBySeason, reload } = useHistoryData()
  const { historySeason, set } = useUiStore()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  // One archived week editable at a time (a single screen-level ConfirmBar).
  const [editingWeekId, setEditingWeekId] = useState<string | null>(null)

  const seasonNumbers = useMemo(
    () => seasonList.slice().sort((a, b) => b.number - a.number).map(s => String(s.number)),
    [seasonList],
  )

  const activeSeason = useMemo(
    () => historySeason ?? (seasonNumbers.length ? seasonNumbers[0] : ''),
    [historySeason, seasonNumbers],
  )

  const activeSeasonId = useMemo(
    () => seasonList.find(s => String(s.number) === activeSeason)?.id ?? null,
    [activeSeason, seasonList],
  )

  const summary = useMemo(() => {
    if (!activeSeasonId) return null
    const standings = computeStandingsFromSupabase(rawScores, rawSchedule, activeSeasonId)
    const top = standings[0] ?? null
    const champs = champsBySeason.get(activeSeasonId) ?? []

    const weekIds = new Set<string>()
    for (const row of rawScores) {
      const slot = row.team_slots
      if (slot?.teams?.weeks?.season_id === activeSeasonId && slot?.teams?.weeks?.is_archived) {
        weekIds.add(slot.teams.week_id)
      }
    }

    const totalPins = standings.reduce((s, p) => s + p.pins, 0)
    const totalGames = standings.reduce((s, p) => s + p.games, 0)
    const leagueAvg = totalGames > 0 ? totalPins / totalGames : 0

    return { top, champs, playerCount: standings.length, weeks: weekIds.size, leagueAvg }
  }, [rawScores, rawSchedule, activeSeasonId, champsBySeason])

  // Admin inline editor for the week currently being edited (scores, roster,
  // swaps, fills). Reloads History data on save so summaries recompute.
  const editor = useWeekEditor(editingWeekId, !!editingWeekId, summary?.leagueAvg ?? 0, reload)

  const weekGames = useMemo(
    () => computePastGamesFromSupabase(rawScores, rawSchedule, activeSeasonId),
    [rawScores, rawSchedule, activeSeasonId],
  )

  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set())

  const toggleWeek = useCallback((weekId: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      next.has(weekId) ? next.delete(weekId) : next.add(weekId)
      return next
    })
  }, [])

  if (loading && seasonList.length === 0) return <LoadingView label="Loading history" />

  return (
    <ScreenContainer
      title="History"
      onBack={() => navigation.navigate('MoreHome')}
      onRefresh={reload}
      contentStyle={[styles.content, editor.pendingCount > 0 && styles.contentEditing]}
      overlay={
        isAdmin && editingWeekId && editor.pendingCount > 0 ? (
          <ConfirmBar
            icon="✏️"
            title={editor.saving ? `Saving ${editor.pendingCount} change${editor.pendingCount !== 1 ? 's' : ''}...` : `${editor.pendingCount} unsaved change${editor.pendingCount !== 1 ? 's' : ''}`}
            subtext={editor.saving ? undefined : 'Save or discard your changes'}
            saving={editor.saving}
            onDiscard={editor.discard}
            onSave={async () => { await editor.save(); setEditingWeekId(null) }}
          />
        ) : null
      }
    >
        {seasonNumbers.length === 0 ? (
          <Text style={styles.empty}>No completed seasons yet.</Text>
        ) : (
          <>
            <PillFilter
              items={seasonNumbers}
              value={activeSeason}
              onChange={(s) => { setEditingWeekId(null); set({ historySeason: s }) }}
              renderLabel={(s) => `Season ${s}`}
            />

            {summary && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.seasonName}>Season {activeSeason} Summary</Text>
                  {summary.champs.length > 0 ? (
                    <Text style={styles.champion}>👑 {summary.champs.join(', ')}</Text>
                  ) : null}
                </View>

                <StatRow label="Top Bowler" value={summary.top ? `${summary.top.name} (${summary.top.avg.toFixed(1)})` : '—'} />
                <StatRow label="League Avg" value={summary.leagueAvg.toFixed(1)} />
                <StatRow label="Bowlers" value={String(summary.playerCount)} />
                <StatRow label="Weeks" value={String(summary.weeks)} />
              </View>
            )}

            {weekGames.length === 0 ? (
              <Text style={styles.empty}>No games recorded for this season.</Text>
            ) : (
              weekGames.map((week) => {
                const expanded = expandedWeeks.has(week.weekId)
                const isEditing = editingWeekId === week.weekId
                return (
                  <View key={week.weekId} style={styles.weekCard}>
                    <TouchableOpacity
                      style={[styles.weekHeader, (expanded || isEditing) && styles.weekHeaderExpanded]}
                      onPress={() => toggleWeek(week.weekId)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.weekTitle}>
                        Week {week.weekNumber}{week.bowledAt ? ` - ${formatDate(week.bowledAt)}` : ''}
                      </Text>
                      {isAdmin && (expanded || isEditing) && (
                        <TouchableOpacity
                          style={[styles.editBtn, isEditing && styles.editBtnActive]}
                          onPress={() => setEditingWeekId(isEditing ? null : week.weekId)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.editBtnText, isEditing && styles.editBtnActiveText]}>
                            {isEditing ? 'Done' : 'Edit'}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <Text style={[styles.chevron, expanded && styles.chevronUp]}>›</Text>
                    </TouchableOpacity>

                    {isEditing ? (
                      <View style={styles.editorWrap}>
                        {editor.loading ? (
                          <LoadingView label="Loading editor" />
                        ) : (
                          <EditableWeek editor={editor} />
                        )}
                      </View>
                    ) : expanded && week.games.map((game, i) => (
                      <View key={game.gameNumber} style={[styles.gameSection, i > 0 && styles.gameSectionBorder]}>
                        <Text style={styles.gameLabel}>GAME {game.gameNumber}</Text>
                        <HistoricalTeamBlock
                          team={`Team ${game.teamA.teamNumber}`}
                          players={game.teamA.players
                            .map(p => ({ name: p.name, score: p.score, present: true, isFill: p.isFill }))}
                          total={game.teamA.total}
                          winner={game.winner === 'A'}
                        />
                        <View style={styles.vsDivider}>
                          <View style={styles.vsLine} />
                          <Text style={styles.vsText}>VS</Text>
                          <View style={styles.vsLine} />
                        </View>
                        <HistoricalTeamBlock
                          team={`Team ${game.teamB.teamNumber}`}
                          players={game.teamB.players
                            .map(p => ({ name: p.name, score: p.score, present: true, isFill: p.isFill }))}
                          total={game.teamB.total}
                          winner={game.winner === 'B'}
                        />
                      </View>
                    ))}
                  </View>
                )
              })
            )}
          </>
        )}
    </ScreenContainer>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={statRowStyles.row}>
      <Text style={statRowStyles.label}>{label}</Text>
      <Text style={statRowStyles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // Cards carry their own 16px horizontal margins — cancel the container default.
  // (Default paddingBottom: 40 matches the pre-migration value.)
  content: { paddingHorizontal: 0 },
  // Extra room above the sticky ConfirmBar while edits are pending.
  contentEditing: { paddingBottom: 40 + 57 },
  editorWrap: { padding: 12 },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginRight: 8,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  editBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  editBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  editBtnActiveText: {
    color: colors.accent,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 4,
  },
  seasonName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
    letterSpacing: 1,
  },
  champion: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.gold,
    letterSpacing: 0.5,
  },

  weekCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  weekTitle: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.3,
    marginRight: 8,
  },
  weekHeaderExpanded: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted,
    transform: [{ rotate: '90deg' }],
  },
  chevronUp: {
    transform: [{ rotate: '-90deg' }],
  },

  gameSection: { padding: 12 },
  gameSectionBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  vsDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    gap: 8,
  },
  vsLine: { flex: 1, height: 1, backgroundColor: colors.border },
  vsText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted2,
    letterSpacing: 1,
  },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 48,
    paddingHorizontal: 16,
  },
})

const statRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  label: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  value: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.text },
})
