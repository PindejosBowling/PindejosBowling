import { useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, StyleSheet,
} from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useStandingsData, computeStandingsFromSupabase } from '../hooks/useStandingsData'
import { StandingsStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import PlayerBadges from '../components/PlayerBadges'
import { badgesForPlayer } from '../utils/badges'

type Nav = NativeStackNavigationProp<StandingsStackParamList>

export default function StandingsScreen() {
  const { loading, seasonList, championPlayerIds, topPinBalancePlayerId, rawScores, rawSchedule, reload } = useStandingsData()
  const { standingsSeason, set } = useUiStore()
  const navigation = useNavigation<Nav>()
  const { refreshing, onRefresh } = useRefresh(reload)

  const seasonNumbers = useMemo(
    () => ['all', ...seasonList.map(s => String(s.number))],
    [seasonList],
  )

  const activeSeason = useMemo(
    () => standingsSeason ?? (seasonList.length ? String(seasonList[seasonList.length - 1].number) : 'all'),
    [standingsSeason, seasonList],
  )

  const activeSeasonId = useMemo(
    () => activeSeason === 'all'
      ? null
      : (seasonList.find(s => String(s.number) === activeSeason)?.id ?? null),
    [activeSeason, seasonList],
  )

  const standings = useMemo(
    () => computeStandingsFromSupabase(rawScores, rawSchedule, activeSeasonId),
    [rawScores, rawSchedule, activeSeasonId],
  )

  const badgesByPlayer = useMemo(() => {
    const ctx = { lastSeasonChampionIds: championPlayerIds, topPinBalancePlayerId, standings }
    const map = new Map<string, ReturnType<typeof badgesForPlayer>>()
    for (const row of standings) map.set(row.playerId, badgesForPlayer(row.playerId, ctx))
    return map
  }, [championPlayerIds, topPinBalancePlayerId, standings])

  const leagueAvg = useMemo(() => {
    const totalPins = standings.reduce((s, p) => s + p.pins, 0)
    const totalGames = standings.reduce((s, p) => s + p.games, 0)
    return totalGames > 0 ? totalPins / totalGames : 0
  }, [standings])

  const sourceLabel = activeSeason === 'all' ? 'All-time Avg' : `Season ${activeSeason} Avg`

  function goToPlayer(name: string) {
    navigation.navigate('PlayerDetail', { name })
  }

  if (loading && rawScores.length === 0) return <LoadingView label="Loading standings" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
      <PillFilter
        items={seasonNumbers}
        value={activeSeason}
        onChange={(s) => set({ standingsSeason: s })}
        renderLabel={(s) => s === 'all' ? 'All-time' : `Season ${s}`}
      />

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
          keyExtractor={(item) => item.playerId}
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
                <PlayerBadges badges={badgesByPlayer.get(item.playerId) ?? []} />
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
