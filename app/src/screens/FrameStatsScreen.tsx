import { useMemo } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { StandingsStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import { useRefresh } from '../hooks/useRefresh'
import {
  useFrameStatsData,
  computeSessionStats,
  computeScorecard,
  computePinLeaves,
  Scorecard,
  ScorecardFrame,
  PinLeave,
} from '../hooks/useFrameStatsData'

type Nav = NativeStackNavigationProp<StandingsStackParamList>
type FrameStatsRoute = RouteProp<StandingsStackParamList, 'FrameStats'>

// Pin rows for a mini deck, back row first (matches the parsed diagram).
const PIN_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]]

export default function FrameStatsScreen() {
  const route = useRoute<FrameStatsRoute>()
  const navigation = useNavigation<Nav>()
  const name = route.params.name

  const { loading, session, reload } = useFrameStatsData(name)
  const { refreshing, onRefresh } = useRefresh(reload)

  const stats = useMemo(() => computeSessionStats(session), [session])
  const scorecards = useMemo<Scorecard[]>(
    () => session ? session.games.map(computeScorecard) : [],
    [session],
  )
  const leaves = useMemo(() => computePinLeaves(session), [session])

  if (loading) return <LoadingView label="Loading games" />

  const subtitle = session
    ? `${session.bowling_center.name} · ${session.datetime_text}`
    : undefined

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <ScreenHeader title={`${name} · Game Details`} subtitle={subtitle} onBack={() => navigation.goBack()} />

        {!session || !stats ? (
          <Text style={styles.empty}>No frame-level game data for this player yet.</Text>
        ) : (
          <>
            {/* Session summary */}
            <View style={styles.statGrid}>
              <StatTile label="Series" value={stats.total} />
              <StatTile label="Average" value={stats.average} />
              <StatTile label="High Game" value={stats.highGame} />
              <StatTile label="1st-Ball Avg" value={stats.firstBallAvg.toFixed(1)} />
              <StatTile label="Strikes" value={`${stats.strikes} · ${pct(stats.strikePct)}`} />
              <StatTile label="Spare Conv." value={pct(stats.sparePct)} />
              <StatTile label="Clean Frames" value={pct(stats.cleanPct)} />
              <StatTile
                label="Splits"
                value={stats.splits ? `${stats.splitsConverted}/${stats.splits}` : '0'}
              />
            </View>

            {/* Per-game scorecards */}
            <Text style={styles.sectionHeader}>Scorecards</Text>
            {scorecards.map((card) => (
              <ScorecardView key={card.gameNumber} card={card} />
            ))}

            {/* Pin-leave summary */}
            {leaves.length ? (
              <>
                <Text style={styles.sectionHeader}>Top Pin Leaves (after 1st ball)</Text>
                <View style={styles.leaveCard}>
                  {leaves.map((leave) => (
                    <LeaveRow key={leave.pins.join(',')} leave={leave} />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={statStyles.tile}>
      <Text style={statStyles.label}>{label}</Text>
      <Text style={statStyles.value}>{String(value)}</Text>
    </View>
  )
}

function ScorecardView({ card }: { card: Scorecard }) {
  return (
    <View style={cardStyles.wrap}>
      <View style={cardStyles.titleRow}>
        <Text style={cardStyles.gameLabel}>Game {card.gameNumber}</Text>
        <Text style={cardStyles.gameScore}>{card.score}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.strip}>
        {card.frames.map((f) => (
          <FrameCell key={f.frame} frame={f} tenth={f.frame === 10} />
        ))}
      </ScrollView>
    </View>
  )
}

function FrameCell({ frame, tenth }: { frame: ScorecardFrame; tenth: boolean }) {
  return (
    <View style={[cardStyles.frame, tenth && cardStyles.frameTenth]}>
      <View style={cardStyles.throwsRow}>
        {frame.throws.map((t, i) => (
          <View key={i} style={[cardStyles.throwBox, t.split && cardStyles.throwSplit]}>
            <Text style={[cardStyles.throwText, isMark(t.display) && cardStyles.throwMark]}>
              {t.display}
            </Text>
          </View>
        ))}
      </View>
      <View style={cardStyles.scoreRow}>
        <Text style={cardStyles.cumulative}>{frame.cumulative}</Text>
      </View>
      <Text style={cardStyles.frameNum}>{frame.frame}</Text>
    </View>
  )
}

function isMark(display: string): boolean {
  return display === 'X' || display === '/'
}

function LeaveRow({ leave }: { leave: PinLeave }) {
  return (
    <View style={leaveStyles.row}>
      <PinDeck standing={leave.pins} />
      <View style={leaveStyles.meta}>
        <Text style={leaveStyles.label}>{leave.label}</Text>
        <Text style={leaveStyles.sub}>
          {leave.count}×{leave.converted ? ` · made ${leave.converted}` : ' · missed all'}
        </Text>
      </View>
      <Text style={leaveStyles.count}>{leave.count}</Text>
    </View>
  )
}

function PinDeck({ standing }: { standing: number[] }) {
  const set = new Set(standing)
  return (
    <View style={deckStyles.deck}>
      {PIN_ROWS.map((row, ri) => (
        <View key={ri} style={deckStyles.row}>
          {row.map((pin) => (
            <View key={pin} style={[deckStyles.pin, set.has(pin) ? deckStyles.standing : deckStyles.down]} />
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  leaveCard: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    overflow: 'hidden',
  },
  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
  },
})

const statStyles = StyleSheet.create({
  tile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  value: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 24,
    color: colors.text,
  },
})

const cardStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.accent,
    letterSpacing: 1,
  },
  gameScore: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.text,
  },
  strip: { flexDirection: 'row' },
  frame: {
    width: 44,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: radius.cardSm,
    marginRight: 6,
    overflow: 'hidden',
  },
  frameTenth: { width: 64 },
  throwsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 26,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  throwBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  throwSplit: {
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: 10,
    margin: 2,
  },
  throwText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  throwMark: { color: colors.accent },
  scoreRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    backgroundColor: colors.surface2,
  },
  cumulative: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  frameNum: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 9,
    color: colors.muted2,
    textAlign: 'center',
    paddingVertical: 2,
  },
})

const leaveStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  meta: { flex: 1 },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.5,
  },
  sub: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  count: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.accent,
  },
})

const deckStyles = StyleSheet.create({
  deck: { width: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', marginBottom: 2 },
  pin: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginHorizontal: 1.5,
  },
  standing: { backgroundColor: colors.accent },
  down: { backgroundColor: colors.surface3 },
})
