import { useMemo, useEffect } from 'react'
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import {
  getSeasons, getDefaultViewSeason, getWeeksForSeason, getMatchupsForWeek,
} from '../utils/data.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import HistoricalTeamBlock from '../components/HistoricalTeamBlock'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function HistoryScreen() {
  const navigation = useNavigation<Nav>()
  const { stats, settings, loading, loadAll } = useDataStore()
  const { histSeason, histWeek, set } = useUiStore()

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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('MoreHome')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Matches</Text>
      </View>

      {/* Season pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {seasons.map((s: any) => {
          const active = s === histSeason
          return (
            <TouchableOpacity
              key={s}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => set({ histSeason: s, histWeek: null })}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                Season {s}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Week pills */}
      {weeks.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.pillRow, styles.weekPillRow]}
        >
          {weeks.map((w: any) => {
            const active = w === histWeek
            const label = isNaN(parseInt(w)) ? w : `Week ${w}`
            return (
              <TouchableOpacity
                key={w}
                style={[styles.pill, styles.weekPill, active && styles.pillActive]}
                onPress={() => set({ histWeek: w })}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}>
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

  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 8,
  },
  weekPillRow: { paddingTop: 0 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface,
  },
  weekPill: { paddingHorizontal: 10, paddingVertical: 5 },
  pillActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  pillText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  pillTextActive: { color: colors.accent },

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
