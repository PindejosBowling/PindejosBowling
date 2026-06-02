import { useMemo, useState, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { usePastGamesData, computePastGamesFromSupabase } from '../hooks/usePastGamesData'
import { useRefresh } from '../hooks/useRefresh'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import ScreenHeader from '../components/ScreenHeader'
import PillFilter from '../components/PillFilter'
import HistoricalTeamBlock from '../components/HistoricalTeamBlock'

type Nav = NativeStackNavigationProp<MoreStackParamList>

function formatDate(bowledAt: string | null): string {
  if (!bowledAt) return ''
  const [year, month, day] = bowledAt.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PastGamesScreen() {
  const navigation = useNavigation<Nav>()
  const { loading, seasonList, rawScores, rawSchedule, reload } = usePastGamesData()
  const { pastGamesSeason, set } = useUiStore()
  const { refreshing, onRefresh } = useRefresh(reload)

  const seasonNumbers = useMemo(
    () => seasonList.map(s => String(s.number)),
    [seasonList],
  )

  const activeSeason = useMemo(
    () => pastGamesSeason ?? (seasonList.length ? String(seasonList[seasonList.length - 1].number) : ''),
    [pastGamesSeason, seasonList],
  )

  const activeSeasonId = useMemo(
    () => seasonList.find(s => String(s.number) === activeSeason)?.id ?? null,
    [activeSeason, seasonList],
  )

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

  if (loading && rawScores.length === 0) return <LoadingView label="Loading games" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Past Games" onBack={() => navigation.navigate('MoreHome')} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
        }
      >
        <PillFilter
          items={seasonNumbers}
          value={activeSeason}
          onChange={(s) => set({ pastGamesSeason: s })}
          renderLabel={(s) => `Season ${s}`}
        />

        {weekGames.length === 0 ? (
          <Text style={styles.empty}>No games recorded for this season.</Text>
        ) : (
          weekGames.map((week) => {
            const expanded = expandedWeeks.has(week.weekId)
            return (
              <View key={week.weekId} style={styles.weekCard}>
                <TouchableOpacity
                  style={[styles.weekHeader, expanded && styles.weekHeaderExpanded]}
                  onPress={() => toggleWeek(week.weekId)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.weekTitle}>
                    Week {week.weekNumber}{week.bowledAt ? ` - ${formatDate(week.bowledAt)}` : ''}
                  </Text>
                  <Text style={[styles.chevron, expanded && styles.chevronUp]}>›</Text>
                </TouchableOpacity>

                {expanded && week.games.map((game, i) => (
                  <View key={game.gameNumber} style={[styles.gameSection, i > 0 && styles.gameSectionBorder]}>
                    <Text style={styles.gameLabel}>GAME {game.gameNumber}</Text>
                    <HistoricalTeamBlock
                      team={`Team ${game.teamA.teamNumber}`}
                      players={game.teamA.players
                        .filter(p => !p.isFill)
                        .map(p => ({ name: p.name, score: p.score, present: true }))}
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
                        .filter(p => !p.isFill)
                        .map(p => ({ name: p.name, score: p.score, present: true }))}
                      total={game.teamB.total}
                      winner={game.winner === 'B'}
                    />
                  </View>
                ))}
              </View>
            )
          })
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },

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
