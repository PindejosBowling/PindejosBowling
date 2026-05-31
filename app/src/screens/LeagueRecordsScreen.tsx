import { useMemo } from 'react'
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useLeagueRecordsData, computeLeagueRecordsFromSupabase } from '../hooks/useLeagueRecordsData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import ScreenHeader from '../components/ScreenHeader'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function LeagueRecordsScreen() {
  const { loading, seasonList, rawScores, reload } = useLeagueRecordsData()
  const { recordsSeason, set } = useUiStore()
  const { refreshing, onRefresh } = useRefresh(reload)
  const navigation = useNavigation<Nav>()

  const seasonNumbers = useMemo(
    () => ['all', ...seasonList.map(s => String(s.number))],
    [seasonList],
  )

  const activeSeason = useMemo(
    () => recordsSeason ?? (seasonList.length ? String(seasonList[seasonList.length - 1].number) : 'all'),
    [recordsSeason, seasonList],
  )

  const activeSeasonId = useMemo(
    () => activeSeason === 'all'
      ? null
      : (seasonList.find(s => String(s.number) === activeSeason)?.id ?? null),
    [activeSeason, seasonList],
  )

  const records = useMemo(
    () => computeLeagueRecordsFromSupabase(rawScores, activeSeasonId),
    [rawScores, activeSeasonId],
  )

  if (loading && rawScores.length === 0) return <LoadingView label="Loading records" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="League Records" onBack={() => navigation.navigate('MoreHome')} />

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <PillFilter
          items={seasonNumbers}
          value={activeSeason}
          onChange={(s) => set({ recordsSeason: s })}
          renderLabel={(s) => s === 'all' ? 'All-time' : `Season ${s}`}
        />
        <RecordCard
          icon="🎳"
          label="High Single Game"
          by={records.highGame.by}
          when={records.highGame.when}
          value={records.highGame.val}
        />
        <RecordCard
          icon="📈"
          label="High Series (G1+G2)"
          by={records.highSeries.by}
          when={records.highSeries.when}
          value={records.highSeries.val}
        />
        <RecordCard
          icon="💪"
          label="High Team Game"
          by={records.highTeamGame.team}
          when={records.highTeamGame.when}
          value={records.highTeamGame.val}
          roster={records.highTeamGame.roster}
        />
        <RecordCard
          icon="🌙"
          label="High Team Night"
          by={records.highTeamNight.team}
          when={records.highTeamNight.when}
          value={records.highTeamNight.val}
          g1Roster={records.highTeamNight.g1Roster}
          g2Roster={records.highTeamNight.g2Roster}
          g1Total={records.highTeamNight.g1Total}
          g2Total={records.highTeamNight.g2Total}
        />
        <RecordCard
          icon="🏆"
          label="Best Season Avg"
          by={records.bestSeasonAvg.by}
          when={records.bestSeasonAvg.when}
          value={records.bestSeasonAvg.val !== 0 ? records.bestSeasonAvg.val.toFixed(1) : undefined}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

interface RecordCardProps {
  icon: string
  label: string
  by?: string
  when?: string
  value?: string | number
  roster?: { name: string; score: number }[]
  g1Roster?: { name: string; score: number }[]
  g2Roster?: { name: string; score: number }[]
  g1Total?: number
  g2Total?: number
}

function RecordCard({ icon, label, by, when, value, roster, g1Roster, g2Roster, g1Total, g2Total }: RecordCardProps) {
  const hasValue = value != null && value !== '' && value !== 0
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.head}>
        <View style={cardStyles.iconBox}>
          <Text style={{ fontSize: 20 }}>{icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.label}>{label}</Text>
          {hasValue ? (
            <>
              <Text style={cardStyles.by}>{by}</Text>
              {when ? <Text style={cardStyles.when}>{when}</Text> : null}
            </>
          ) : (
            <Text style={cardStyles.noRecord}>No record yet</Text>
          )}
        </View>
        {hasValue ? (
          <Text style={cardStyles.value}>{String(value)}</Text>
        ) : null}
      </View>

      {/* Simple roster */}
      {roster?.length ? (
        <View style={cardStyles.roster}>
          {roster.map((p) => (
            <View key={p.name} style={cardStyles.rosterRow}>
              <Text style={cardStyles.rosterName}>{p.name}</Text>
              <Text style={cardStyles.rosterScore}>{p.score}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Night roster with G1 + G2 breakdown */}
      {(g1Roster?.length || g2Roster?.length) ? (
        <View style={cardStyles.roster}>
          {g1Roster?.length ? (
            <GameBlock label="Game 1" total={g1Total} players={g1Roster} />
          ) : null}
          {g2Roster?.length ? (
            <GameBlock label="Game 2" total={g2Total} players={g2Roster} />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function GameBlock({ label, total, players }: { label: string; total?: number; players: { name: string; score: number }[] }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={cardStyles.gameBlockHead}>
        <Text style={cardStyles.gameBlockLabel}>{label}</Text>
        {total != null ? <Text style={cardStyles.gameBlockTotal}>{total}</Text> : null}
      </View>
      {players.map((p) => (
        <View key={p.name} style={cardStyles.rosterRow}>
          <Text style={cardStyles.rosterName}>{p.name}</Text>
          <Text style={cardStyles.rosterScore}>{p.score}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
})

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.icon,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  by: { fontFamily: fonts.barlowCondensed, fontSize: 18, color: colors.text },
  when: { fontFamily: fonts.barlow, fontSize: 12, color: colors.muted, marginTop: 1 },
  noRecord: { fontFamily: fonts.barlowCondensed, fontSize: 16, color: colors.muted2 },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 26,
    color: colors.accent,
    alignSelf: 'center',
  },
  roster: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 10,
    paddingTop: 8,
  },
  rosterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  rosterName: { fontFamily: fonts.barlow, fontSize: 13, color: colors.text },
  rosterScore: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.accent },
  gameBlockHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  gameBlockLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  gameBlockTotal: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.text },
})
