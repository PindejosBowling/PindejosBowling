import { useMemo, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import { getLeagueRecords, getSeasons } from '../utils/data.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function LeagueRecordsScreen() {
  const { stats, loading, loadAll } = useDataStore()
  const { recordsSeason, set } = useUiStore()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }
  const navigation = useNavigation<Nav>()

  const seasons = useMemo(() => (stats ? getSeasons(stats) : []), [stats])
  const records = useMemo(
    () => (stats ? getLeagueRecords(stats, recordsSeason) : null),
    [stats, recordsSeason],
  )

  if (loading || !stats) return <LoadingView label="Loading records" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('MoreHome')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>League Records</Text>
      </View>

      {/* Season pill filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {(['all', ...seasons] as string[]).map((s) => {
          const active = s === recordsSeason
          return (
            <TouchableOpacity
              key={s}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => set({ recordsSeason: s })}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {s === 'all' ? 'All-time' : `Season ${s}`}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}>
        {records ? (
          <>
            <RecordCard
              icon="🎳"
              label="High Single Game"
              by={records.highGame?.by}
              when={records.highGame?.when}
              value={records.highGame?.val}
            />
            <RecordCard
              icon="📈"
              label="High Series (G1+G2)"
              by={records.highSeries?.by}
              when={records.highSeries?.when}
              value={records.highSeries?.val}
            />
            <RecordCard
              icon="💪"
              label="High Team Game"
              by={records.highTeamGame?.team}
              when={records.highTeamGame?.when}
              value={records.highTeamGame?.val}
              roster={records.highTeamGame?.roster}
            />
            <RecordCard
              icon="🌙"
              label="High Team Night"
              by={records.highTeamNight?.team}
              when={records.highTeamNight?.when}
              value={records.highTeamNight?.val}
              g1Roster={records.highTeamNight?.g1Roster}
              g2Roster={records.highTeamNight?.g2Roster}
              g1Total={records.highTeamNight?.g1Total}
              g2Total={records.highTeamNight?.g2Total}
            />
            <RecordCard
              icon="🏆"
              label="Best Season Avg"
              by={records.bestSeasonAvg?.by}
              when={records.bestSeasonAvg?.when}
              value={records.bestSeasonAvg?.val != null ? records.bestSeasonAvg.val.toFixed(1) : undefined}
            />
          </>
        ) : null}
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
  const hasValue = value != null && value !== ''
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
    paddingBottom: 10,
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
  pillActive: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  pillText: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.muted, letterSpacing: 0.5 },
  pillTextActive: { color: colors.accent },
  content: { padding: 16, paddingBottom: 40 },
})

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
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
