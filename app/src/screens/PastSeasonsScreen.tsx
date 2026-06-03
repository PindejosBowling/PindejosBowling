import { useMemo } from 'react'
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { usePastSeasonsData } from '../hooks/usePastSeasonsData'
import { computeStandingsFromSupabase } from '../hooks/useStandingsData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import ScreenHeader from '../components/ScreenHeader'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function PastSeasonsScreen() {
  const { loading, seasonList, rawScores, rawSchedule, champsBySeason, reload } = usePastSeasonsData()
  const navigation = useNavigation<Nav>()
  const { refreshing, onRefresh } = useRefresh(reload)

  const seasonData = useMemo(() => {
    return seasonList
      .slice()
      .sort((a, b) => b.number - a.number)
      .map(season => {
        const standings = computeStandingsFromSupabase(rawScores, rawSchedule, season.id)
        const top = standings[0] ?? null
        const champs = champsBySeason.get(season.id) ?? []

        const weekIds = new Set<string>()
        for (const row of rawScores) {
          const slot = row.team_slots
          if (slot?.teams?.weeks?.season_id === season.id && slot?.teams?.weeks?.is_archived) {
            weekIds.add(slot.teams.week_id)
          }
        }

        const totalPins = standings.reduce((s, p) => s + p.pins, 0)
        const totalGames = standings.reduce((s, p) => s + p.games, 0)
        const leagueAvg = totalGames > 0 ? totalPins / totalGames : 0

        return { season: season.number, top, champs, playerCount: standings.length, weeks: weekIds.size, leagueAvg }
      })
  }, [seasonList, rawScores, rawSchedule, champsBySeason])

  if (loading && seasonList.length === 0) return <LoadingView label="Loading seasons" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Past Seasons" onBack={() => navigation.navigate('MoreHome')} />

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {seasonData.length === 0 ? (
          <Text style={styles.empty}>No completed seasons yet.</Text>
        ) : (
          seasonData.map((item: any) => (
            <View key={item.season} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.seasonName}>Season {item.season}</Text>
                {item.champs.length > 0 ? (
                  <Text style={styles.champion}>👑 {item.champs.join(', ')}</Text>
                ) : null}
              </View>

              <StatRow label="Top Bowler" value={item.top ? `${item.top.name} (${item.top.avg.toFixed(1)})` : '—'} />
              <StatRow label="League Avg" value={item.leagueAvg.toFixed(1)} />
              <StatRow label="Bowlers" value={String(item.playerCount)} />
              <StatRow label="Weeks" value={String(item.weeks)} />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
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
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 12,
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
  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 48,
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
