import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { StandingsStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import StatRadarChart from '../components/StatRadarChart'
import StatDonut from '../components/StatDonut'
import { useRefresh } from '../hooks/useRefresh'
import {
  useFrameStatsData,
  computeSessionStats,
  computeScorecard,
  computePinLeaves,
  filterSessionByDate,
  ALL_DATES,
  Scorecard,
  ScorecardFrame,
  PinLeave,
} from '../hooks/useFrameStatsData'
import { PinDiagram, PinState } from '../data/lanetalk'

type Nav = NativeStackNavigationProp<StandingsStackParamList>
type FrameStatsRoute = RouteProp<StandingsStackParamList, 'FrameStats'>

// Pin rows for a mini deck, back row first (matches the parsed diagram).
const PIN_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]]

// Colors for the three pin fates parsed from the diagram.
const PIN_STATE_COLOR: Record<PinState, string> = {
  down_first: colors.muted2,  // knocked down on the first ball
  down_second: colors.gold,   // knocked down on the second ball
  standing: colors.accent,    // left standing at end of frame
}

export default function FrameStatsScreen() {
  const route = useRoute<FrameStatsRoute>()
  const navigation = useNavigation<Nav>()
  const { name, playerId } = route.params

  const { loading, session, reload } = useFrameStatsData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [selectedDate, setSelectedDate] = useState<string>(ALL_DATES)

  const filtered = useMemo(
    () => filterSessionByDate(session, selectedDate),
    [session, selectedDate],
  )
  const stats = useMemo(() => computeSessionStats(filtered), [filtered])
  const scorecards = useMemo<Scorecard[]>(
    () => filtered ? filtered.games.map(computeScorecard) : [],
    [filtered],
  )
  const leaves = useMemo(() => computePinLeaves(filtered), [filtered])

  // Radar axes — only metrics we measure directly from pin fall. Percentages
  // map straight to the 0..1 radius; first-ball average is scaled out of 10.
  const radarAxes = useMemo(() => !stats ? [] : [
    { label: 'Strike', valueText: pctFine(stats.strikePct), radial: stats.strikePct },
    { label: 'Spare Conv.', valueText: pctFine(stats.sparePct), radial: stats.sparePct },
    { label: 'Clean', valueText: pctFine(stats.cleanPct), radial: stats.cleanPct },
    { label: 'First Ball', valueText: stats.firstBallAvg.toFixed(2), radial: stats.firstBallAvg / 10 },
  ], [stats])

  // Show the date on each scorecard only when viewing across multiple nights.
  const showCardDates = selectedDate === ALL_DATES && (session?.dates.length ?? 0) > 1

  if (loading) return <LoadingView label="Loading games" />

  const subtitle = session?.bowling_center?.name

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
            {/* League-night filter */}
            {session.dates.length > 0 ? (
              <PillFilter
                items={[ALL_DATES, ...session.dates.map(d => d.date)]}
                value={selectedDate}
                onChange={setSelectedDate}
                renderLabel={(item) =>
                  item === ALL_DATES
                    ? 'All-time'
                    : session.dates.find(d => d.date === item)?.label ?? item}
              />
            ) : null}

            {/* Session summary — only metrics not already shown on the radar/donuts */}
            <View style={styles.statGrid}>
              <StatTile label="Series" value={stats.total} />
              <StatTile label="Games" value={stats.games} />
              <StatTile label="High Game" value={stats.highGame} />
              <StatTile label="Low Game" value={stats.lowGame} />
              <StatTile label="Strikes / Spares" value={`${stats.strikes} / ${stats.spares}`} />
              <StatTile
                label="Splits Made"
                value={stats.splits ? `${stats.splitsConverted}/${stats.splits}` : '0'}
              />
            </View>

            {/* Radar chart */}
            <Text style={styles.sectionHeader}>Radar</Text>
            <View style={styles.radarCard}>
              <View style={styles.radarHeader}>
                <Text style={styles.radarHeaderLabel}>Average</Text>
                <Text style={styles.radarHeaderValue}>{stats.average}</Text>
              </View>
              <View style={styles.radarBody}>
                <StatRadarChart axes={radarAxes} size={140} />
              </View>
            </View>

            {/* First-ball summary donuts */}
            <Text style={styles.sectionHeader}>First Ball</Text>
            <View style={styles.donutRow}>
              <StatDonut value={stats.strikePct} valueText={pctFine(stats.strikePct)} label="Strikes" color={colors.accent} />
              <StatDonut value={stats.leavePct} valueText={pctFine(stats.leavePct)} label="Leaves" color={colors.gold} />
              <StatDonut value={stats.splitPct} valueText={pctFine(stats.splitPct)} label="Splits" color={colors.danger} />
            </View>

            {/* Per-game scorecards */}
            <Text style={styles.sectionHeader}>Scorecards</Text>
            {scorecards.map((card) => (
              <ScorecardView
                key={`${card.dateLabel}-${card.gameNumber}`}
                card={card}
                showDate={showCardDates}
              />
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

// Percent with up to two decimals (whole numbers shown without decimals),
// matching the Lanetalk style (e.g. "10%", "12.50%", "23.33%").
function pctFine(v: number): string {
  const p = Math.round(v * 10000) / 100
  return p % 1 === 0 ? `${p}%` : `${p.toFixed(2)}%`
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={statStyles.tile}>
      <Text style={statStyles.label}>{label}</Text>
      <Text style={statStyles.value}>{String(value)}</Text>
    </View>
  )
}

function ScorecardView({ card, showDate }: { card: Scorecard; showDate: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const expandedFrame = card.frames.find(f => f.frame === expanded) ?? null

  return (
    <View style={cardStyles.wrap}>
      <View style={cardStyles.titleRow}>
        <Text style={cardStyles.gameLabel}>
          Game {card.gameNumber}
          {showDate ? <Text style={cardStyles.gameDate}>{`  ·  ${card.dateLabel}`}</Text> : null}
        </Text>
        <Text style={cardStyles.gameScore}>{card.score}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cardStyles.strip}>
        {card.frames.map((f) => (
          <FrameCell
            key={f.frame}
            frame={f}
            tenth={f.frame === 10}
            selected={expanded === f.frame}
            onPress={() => setExpanded(expanded === f.frame ? null : f.frame)}
          />
        ))}
      </ScrollView>

      {expandedFrame ? <FrameDetail frame={expandedFrame} /> : (
        <Text style={cardStyles.tapHint}>Tap a frame to see the pins</Text>
      )}
    </View>
  )
}

function FrameCell({ frame, tenth, selected, onPress }: {
  frame: ScorecardFrame; tenth: boolean; selected: boolean; onPress: () => void
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[cardStyles.frame, tenth && cardStyles.frameTenth, selected && cardStyles.frameSelected]}
    >
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
      <Text style={[cardStyles.frameNum, selected && cardStyles.frameNumSelected]}>{frame.frame}</Text>
    </TouchableOpacity>
  )
}

// Expanded panel: the pin diagram(s) for the tapped frame, plus a state key.
function FrameDetail({ frame }: { frame: ScorecardFrame }) {
  return (
    <View style={detailStyles.panel}>
      <View style={detailStyles.decks}>
        {frame.diagrams.map((diagram, i) => (
          <View key={i} style={detailStyles.deckBlock}>
            <FrameDeck diagram={diagram} />
            {frame.diagrams.length > 1 ? (
              <Text style={detailStyles.ballLabel}>Ball {i + 1}</Text>
            ) : null}
          </View>
        ))}
      </View>
      <View style={detailStyles.key}>
        <KeyItem color={PIN_STATE_COLOR.down_first} label="1st ball" />
        <KeyItem color={PIN_STATE_COLOR.down_second} label="2nd ball" />
        <KeyItem color={PIN_STATE_COLOR.standing} label="Standing" />
      </View>
    </View>
  )
}

function FrameDeck({ diagram }: { diagram: PinDiagram }) {
  return (
    <View style={detailStyles.deck}>
      {PIN_ROWS.map((row, ri) => (
        <View key={ri} style={detailStyles.deckRow}>
          {row.map((pin) => {
            const state = diagram[String(pin)]
            const color = state ? PIN_STATE_COLOR[state] : colors.surface3
            return <View key={pin} style={[detailStyles.deckPin, { backgroundColor: color }]} />
          })}
        </View>
      ))}
    </View>
  )
}

function KeyItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={detailStyles.keyItem}>
      <View style={[detailStyles.keyDot, { backgroundColor: color }]} />
      <Text style={detailStyles.keyLabel}>{label}</Text>
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
  radarCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    overflow: 'hidden',
  },
  radarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  radarHeaderLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  radarHeaderValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 30,
    color: colors.text,
  },
  radarBody: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  donutRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    paddingVertical: 18,
    paddingHorizontal: 8,
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
  gameDate: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
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
  frameSelected: { borderColor: colors.accent },
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
  frameNumSelected: { color: colors.accent },
  tapHint: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted2,
    textAlign: 'center',
    marginTop: 10,
  },
})

const detailStyles = StyleSheet.create({
  panel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  decks: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  deckBlock: { alignItems: 'center' },
  ballLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 6,
  },
  deck: { alignItems: 'center', justifyContent: 'center' },
  deckRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 4 },
  deckPin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginHorizontal: 3,
  },
  key: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 14,
  },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 10, height: 10, borderRadius: 5 },
  keyLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
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
