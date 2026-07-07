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
import { useStandingsData, computeStandingsFromSupabase, computeRankMovement } from '../hooks/useStandingsData'
import { StandingsStackParamList } from '../navigation/types'
import AppHeader from '../components/league/AppHeader'
import LoadingView from '../components/ui/LoadingView'
import SeasonDropdown from '../components/ui/SeasonDropdown'
import PlayerBadges from '../components/ui/PlayerBadges'
import { badgesForPlayer } from '../utils/badges'

type Nav = NativeStackNavigationProp<StandingsStackParamList>

export default function StandingsScreen() {
  const { loading, seasonList, currentSeasonNumber, championPlayerIds, topPinBalancePlayerId, rawScores, rawSchedule, rawRegistrations, reload } = useStandingsData()
  const { standingsSeason, set } = useUiStore()
  const navigation = useNavigation<Nav>()
  const { refreshing, onRefresh } = useRefresh(reload)

  const seasonNumbers = useMemo(
    () => seasonList.map(s => String(s.number)),
    [seasonList],
  )

  // Default to the current active season, else the newest listed, else all-time.
  const activeSeason = useMemo(
    () => standingsSeason
      ?? (currentSeasonNumber != null ? String(currentSeasonNumber) : null)
      ?? (seasonList.length ? String(seasonList[seasonList.length - 1].number) : 'all'),
    [standingsSeason, currentSeasonNumber, seasonList],
  )

  const activeSeasonId = useMemo(
    () => activeSeason === 'all'
      ? null
      : (seasonList.find(s => String(s.number) === activeSeason)?.id ?? null),
    [activeSeason, seasonList],
  )

  const standings = useMemo(
    () => computeStandingsFromSupabase(rawScores, rawSchedule, activeSeasonId, undefined, rawRegistrations),
    [rawScores, rawSchedule, activeSeasonId, rawRegistrations],
  )

  const movementByPlayer = useMemo(
    () => computeRankMovement(rawScores, rawSchedule, activeSeasonId),
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

  function goToPlayer(name: string) {
    navigation.navigate('PlayerDetail', { name })
  }

  if (loading && rawScores.length === 0) return <LoadingView label="Loading standings" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
      {/* Season selector + league avg in one compact row to leave room for the board */}
      <View style={styles.filterRow}>
        <SeasonDropdown
          seasons={seasonNumbers}
          value={activeSeason}
          onChange={(s) => set({ standingsSeason: s })}
          style={styles.seasonDropdown}
        />
        <View style={styles.avgChip}>
          <Text style={styles.avgChipLabel}>League Avg</Text>
          <Text style={styles.avgChipVal}>{leagueAvg > 0 ? leagueAvg.toFixed(1) : '—'}</Text>
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
                {movementByPlayer.get(item.playerId) === 'up' && <Text style={[styles.moveText, styles.moveUp]}> ▲</Text>}
                {movementByPlayer.get(item.playerId) === 'down' && <Text style={[styles.moveText, styles.moveDown]}> ▼</Text>}
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

  filterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
  },
  // Cancel the dropdown's own margins — the row carries the spacing.
  seasonDropdown: {
    flex: 1,
    marginHorizontal: 0,
    marginVertical: 0,
  },
  avgChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.surface2,
  },
  avgChipLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  avgChipVal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
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
  moveText: {
    fontSize: 11,
  },
  moveUp: {
    color: colors.success,
  },
  moveDown: {
    color: colors.danger,
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
