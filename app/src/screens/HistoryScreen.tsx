import { useMemo, useEffect } from 'react'
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
} from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import {
  getSeasons, getDefaultViewSeason, getWeeksForSeason, getMatchupsForWeek,
} from '../utils/data.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import HistoricalTeamBlock from '../components/HistoricalTeamBlock'
import PillFilter from '../components/PillFilter'
import ScreenHeader from '../components/ScreenHeader'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function HistoryScreen() {
  const navigation = useNavigation<Nav>()
  const { stats, settings, loading, loadAll } = useDataStore()
  const { histSeason, histWeek, set } = useUiStore()
  const { refreshing, onRefresh } = useRefresh(loadAll)

  const seasons = useMemo(() => (stats ? getSeasons(stats) : []), [stats])

  const weeks = useMemo(
    () => (stats && histSeason ? getWeeksForSeason(stats, histSeason) : []),
    [stats, histSeason],
  )

  // Default to most recent season + week on load
  useEffect(() => {
    if (!stats) return
    if (!histSeason) {
      const defaultSeason = getDefaultViewSeason(stats, settings)
      set({ histSeason: defaultSeason })
    }
  }, [stats])

  useEffect(() => {
    if (!stats || !histSeason) return
    const currentWeeks = getWeeksForSeason(stats, histSeason)
    if (!histWeek || !currentWeeks.includes(histWeek)) {
      set({ histWeek: currentWeeks[currentWeeks.length - 1] ?? null })
    }
  }, [stats, histSeason])

  const pairings = useMemo(() => {
    if (!stats || !histSeason || !histWeek) return []
    return getMatchupsForWeek(stats, histSeason, histWeek)
  }, [stats, histSeason, histWeek])

  const presentGameNums = useMemo(
    () => [...new Set(pairings.map((p: any) => p.gameNum))].sort(),
    [pairings],
  )

  const pairingsByGame = useMemo(
    () => Object.fromEntries(
      presentGameNums.map((n: any) => [n, pairings.filter((p: any) => p.gameNum === n)])
    ),
    [pairings, presentGameNums],
  )

  if (loading || !stats) return <LoadingView label="Loading history" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Matches" onBack={() => navigation.navigate('MoreHome')} />

      <PillFilter
        items={seasons}
        value={histSeason ?? ''}
        onChange={(s) => set({ histSeason: s, histWeek: null })}
        renderLabel={(s) => `Season ${s}`}
      />

      {weeks.length > 0 ? (
        <PillFilter
          items={weeks}
          value={histWeek ?? ''}
          onChange={(w) => set({ histWeek: w })}
          renderLabel={(w) => isNaN(parseInt(w)) ? w : `Week ${w}`}
          style={{ paddingTop: 0 }}
        />
      ) : null}

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {pairings.length > 0 ? (
          presentGameNums.map((gameNum: any) => (
            <View key={gameNum}>
              <Text style={styles.gameHeader}>Game {gameNum}</Text>
              {(pairingsByGame[gameNum] as any[]).map((pairing: any, i: number) => (
                <View key={i} style={styles.matchup}>
                  <HistoricalTeamBlock
                    team={pairing.a.team}
                    players={pairing.a.players}
                    total={pairing.a.total}
                    winner={pairing.b ? pairing.a.total >= pairing.b.total : true}
                  />
                  {pairing.b ? (
                    <>
                      <View style={styles.vsRow}>
                        <View style={styles.vsLine} />
                        <Text style={styles.vsText}>VS</Text>
                        <View style={styles.vsLine} />
                      </View>
                      <HistoricalTeamBlock
                        team={pairing.b.team}
                        players={pairing.b.players}
                        total={pairing.b.total}
                        winner={pairing.b.total > pairing.a.total}
                      />
                    </>
                  ) : null}
                </View>
              ))}
            </View>
          ))
        ) : histSeason && histWeek ? (
          <Text style={styles.empty}>No data for this week.</Text>
        ) : histSeason && !weeks.length ? (
          <Text style={styles.empty}>No data for this season.</Text>
        ) : (
          <Text style={styles.empty}>Select a season and week to view match history.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  content: { padding: 16, paddingBottom: 40 },

  gameHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.accent,
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },

  matchup: { marginBottom: 12 },

  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    gap: 8,
  },
  vsLine: { flex: 1, height: 1, backgroundColor: colors.border },
  vsText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 2,
  },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 48,
  },
})
