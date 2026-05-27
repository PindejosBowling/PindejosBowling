import { useMemo } from 'react'
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import {
  aggregateStandings, getSeasons, getWeeksForSeason, championsForSeason,
} from '../utils/data.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function SeasonHistoryScreen() {
  const { stats, champions, history, loading, loadAll } = useDataStore()
  const navigation = useNavigation<Nav>()

  const notesMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (!history || history.length < 2) return map
    const headers = history[0].map((h: any) => String(h).toLowerCase())
    const seasonCol = headers.indexOf('season') !== -1 ? headers.indexOf('season') : 0
    const notesCol = headers.indexOf('notes')
    if (notesCol === -1) return map
    for (let i = 1; i < history.length; i++) {
      const cell = String(history[i][seasonCol] || '').trim()
      const key = cell.replace(/season\s*/i, '').trim()
      if (key && history[i][notesCol]) map[key] = history[i][notesCol]
    }
    return map
  }, [history])

  const seasonData = useMemo(() => {
    if (!stats) return []
    return getSeasons(stats)
      .slice()
      .sort((a: any, b: any) => parseInt(b) - parseInt(a))
      .map((s: any) => {
        const standings = aggregateStandings(stats, s)
        const top = standings[0] ?? null
        const champs = championsForSeason(champions, s)
        const weeks = getWeeksForSeason(stats, s).length
        const totalPins = standings.reduce((sum: number, p: any) => sum + p.pins, 0)
        const totalGames = standings.reduce((sum: number, p: any) => sum + p.games, 0)
        const leagueAvg = totalGames ? totalPins / totalGames : 0
        const notes = notesMap[String(s)] || ''
        return { season: s, top, champs, playerCount: standings.length, weeks, leagueAvg, notes }
      })
  }, [stats, champions, notesMap])

  if (loading || !stats) return <LoadingView label="Loading seasons" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('MoreHome')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Past Seasons</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}>
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

              {item.notes ? (
                <Text style={styles.notes}>{item.notes}</Text>
              ) : null}

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { marginRight: 12, padding: 4 },
  backText: { fontSize: 20, color: colors.text },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 1,
  },
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
  notes: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    marginBottom: 10,
    lineHeight: 18,
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
