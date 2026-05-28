import { useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import { aggregateStandings, getSeasons, getDefaultViewSeason, isChampion } from '../utils/data.js'
import { MoreStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function StandingsScreen() {
  const { stats, settings, champions, loading, loadAll } = useDataStore()
  const { standingsSeason, set } = useUiStore()
  const navigation = useNavigation<Nav>()

  const seasons = useMemo(() => (stats ? ['all', ...getSeasons(stats)] : ['all']), [stats])

  const activeSeason = useMemo(
    () => standingsSeason ?? getDefaultViewSeason(stats, settings),
    [standingsSeason, stats, settings],
  )

  const standings = useMemo(
    () => (stats ? aggregateStandings(stats, activeSeason) : []),
    [stats, activeSeason],
  )

  const leagueAvg = useMemo(() => {
    const totalPins = standings.reduce((s, p) => s + p.pins, 0)
    const totalGames = standings.reduce((s, p) => s + p.games, 0)
    return totalGames > 0 ? totalPins / totalGames : 0
  }, [standings])

  const sourceLabel = activeSeason === 'all' ? 'All-time Avg' : `Season ${activeSeason} Avg`

  function goToPlayer(name: string) {
    // Cross-tab navigation: switch to More tab then navigate to PlayerDetail
    ;(navigation as any).navigate('More', { screen: 'PlayerDetail', params: { name } })
  }

  if (!stats) return <LoadingView label="Loading standings" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />

      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}>
      {/* Season pill filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {seasons.map((s) => {
          const active = s === activeSeason || (s === 'all' && activeSeason === 'all')
          return (
            <TouchableOpacity
              key={s}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => set({ standingsSeason: s })}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {s === 'all' ? 'All-time' : `Season ${s}`}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* League avg banner */}
      <View style={styles.leagueBanner}>
        <View>
          <Text style={styles.bannerLabel}>League {sourceLabel}</Text>
          <Text style={styles.bannerVal}>{leagueAvg > 0 ? leagueAvg.toFixed(1) : '—'}</Text>
        </View>
      </View>

      {/* Standings header */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, styles.rankCell]}>#</Text>
          <Text style={[styles.headerCell, styles.nameCell]}>Bowler</Text>
          <Text style={[styles.headerCell, styles.wlCell]}>W—L</Text>
          <Text style={[styles.headerCell, styles.pinsCell]}>Pins</Text>
          <Text style={[styles.headerCell, styles.avgCell]}>Avg</Text>
        </View>

        <FlatList
          data={standings}
          keyExtractor={(item) => item.name}
          scrollEnabled={false}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[styles.row, index < standings.length - 1 && styles.rowBorder]}
              onPress={() => goToPlayer(item.name)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconBox, index < 3 && styles.iconBoxTop]}>
                <Text style={[styles.rankText, index < 3 && styles.rankTextTop]}>
                  {index + 1}
                </Text>
              </View>
              <Text style={styles.playerName} numberOfLines={1}>
                {item.name}
                {isChampion(champions, item.name) ? ' 👑' : ''}
              </Text>
              <Text style={styles.wlText}>{item.wins}–{item.losses}</Text>
              <Text style={styles.pinsText}>{item.pins}</Text>
              <Text style={styles.avgText}>{item.avg.toFixed(1)}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  leagueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginHorizontal: 16,
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
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  pillActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  pillText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  pillTextActive: {
    color: colors.accent,
  },

  card: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCell: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  rankCell: { width: 32 },
  nameCell: { flex: 1 },
  wlCell: { width: 52, textAlign: 'right' },
  pinsCell: { width: 52, textAlign: 'right' },
  avgCell: { width: 44, textAlign: 'right' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  iconBoxTop: {
    backgroundColor: colors.accentDim,
  },
  rankText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
  },
  rankTextTop: {
    color: colors.accent,
  },
  playerName: {
    flex: 1,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
  },
  wlText: {
    width: 52,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
  },
  pinsText: {
    width: 52,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
  },
  avgText: {
    width: 44,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.accent,
  },
})
