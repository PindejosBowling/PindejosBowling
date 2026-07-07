import { useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import {
  useLeagueRecordsData,
  computeLeagueRecordsFromSupabase,
  MarginTeam,
  RecordFrame,
  RecordFrameGame,
  SeasonWeek,
} from '../hooks/useLeagueRecordsData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/ui/LoadingView'
import PillFilter from '../components/ui/PillFilter'
import SeasonDropdown from '../components/ui/SeasonDropdown'
import ScreenContainer from '../components/ui/ScreenContainer'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const SCOPES = ['game', 'night', 'season']
const SCOPE_LABELS: Record<string, string> = { game: 'Game', night: 'Night', season: 'Season' }

export default function LeagueRecordsScreen() {
  const { loading, seasonList, rawScores, rawFrames, reload } = useLeagueRecordsData()
  const { recordsSeason, recordsScope, set } = useUiStore()
  const navigation = useNavigation<Nav>()

  const seasonNumbers = useMemo(
    () => seasonList.map(s => String(s.number)),
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
    () => computeLeagueRecordsFromSupabase(rawScores, rawFrames, activeSeasonId),
    [rawScores, rawFrames, activeSeasonId],
  )

  if (loading && rawScores.length === 0) return <LoadingView label="Loading records" />

  return (
    <ScreenContainer
      title="League Records"
      onBack={() => navigation.navigate('MoreHome')}
      onRefresh={reload}
      contentStyle={{ paddingHorizontal: 0 }}
    >
        <SeasonDropdown
          seasons={seasonNumbers}
          value={activeSeason}
          onChange={(s) => set({ recordsSeason: s })}
        />
        <PillFilter
          items={SCOPES}
          value={recordsScope}
          onChange={(s) => set({ recordsScope: s })}
          renderLabel={(s) => SCOPE_LABELS[s]}
          style={{ paddingTop: 0 }}
        />
        {recordsScope === 'game' ? (
          <>
            <RecordCard
              icon="🎳"
              label="High Single Game"
              by={records.highGame.by}
              when={records.highGame.when}
              value={records.highGame.val}
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
              icon="🥊"
              label="Largest Winning Margin"
              by={records.largestMargin.by}
              when={records.largestMargin.when}
              value={records.largestMargin.val}
              teams={records.largestMargin.teams}
            />
            <RecordCard
              icon="🔥"
              label="Most Strikes in a Game"
              by={records.mostStrikesGame.by}
              when={records.mostStrikesGame.when}
              value={records.mostStrikesGame.val}
              frameGames={records.mostStrikesGame.games}
              frameStat="strikes"
            />
            <RecordCard
              icon="🎯"
              label="Most Spares in a Game"
              by={records.mostSparesGame.by}
              when={records.mostSparesGame.when}
              value={records.mostSparesGame.val}
              frameGames={records.mostSparesGame.games}
              frameStat="spares"
            />
            <RecordCard
              icon="🧹"
              label="Most Frames Closed in a Game"
              by={records.mostClosedGame.by}
              when={records.mostClosedGame.when}
              value={records.mostClosedGame.val}
              frameGames={records.mostClosedGame.games}
              frameStat="closed"
            />
          </>
        ) : null}
        {recordsScope === 'night' ? (
          <>
            <RecordCard
              icon="📈"
              label="High Series"
              by={records.highSeries.by}
              when={records.highSeries.when}
              value={records.highSeries.val}
            />
            <RecordCard
              icon="🌙"
              label="High Team Night"
              by={records.highTeamNight.team}
              when={records.highTeamNight.when}
              value={records.highTeamNight.val}
              games={records.highTeamNight.games}
            />
            <RecordCard
              icon="🔥"
              label="Most Strikes in a Night"
              by={records.mostStrikesNight.by}
              when={records.mostStrikesNight.when}
              value={records.mostStrikesNight.val}
              frameGames={records.mostStrikesNight.games}
              frameStat="strikes"
            />
            <RecordCard
              icon="🎯"
              label="Most Spares in a Night"
              by={records.mostSparesNight.by}
              when={records.mostSparesNight.when}
              value={records.mostSparesNight.val}
              frameGames={records.mostSparesNight.games}
              frameStat="spares"
            />
            <RecordCard
              icon="🧹"
              label="Most Frames Closed in a Night"
              by={records.mostClosedNight.by}
              when={records.mostClosedNight.when}
              value={records.mostClosedNight.val}
              frameGames={records.mostClosedNight.games}
              frameStat="closed"
            />
          </>
        ) : null}
        {recordsScope === 'season' ? (
          <RecordCard
            icon="🏆"
            label="Best Season Avg"
            by={records.bestSeasonAvg.by}
            when={records.bestSeasonAvg.when}
            value={records.bestSeasonAvg.val !== 0 ? records.bestSeasonAvg.val.toFixed(1) : undefined}
            weeks={records.bestSeasonAvg.weeks}
          />
        ) : null}
    </ScreenContainer>
  )
}

type FrameStat = 'strikes' | 'spares' | 'closed'

interface RecordCardProps {
  icon: string
  label: string
  by?: string
  when?: string
  value?: string | number
  roster?: { name: string; score: number }[]
  games?: { gameNum: number; roster: { name: string; score: number }[]; total: number }[]
  /** Both sides of the winning-margin record game, winner first. */
  teams?: MarginTeam[]
  /** Every week of the best-season-avg holder's season, with that week's games. */
  weeks?: SeasonWeek[]
  /** Frame-data breakdown: the record game (game scope) or night's games (night scope). */
  frameGames?: RecordFrameGame[]
  /** Which stat the frame record counts — drives per-frame highlighting. */
  frameStat?: FrameStat
}

function RecordCard({ icon, label, by, when, value, roster, games, teams, weeks, frameGames, frameStat }: RecordCardProps) {
  const [expanded, setExpanded] = useState(false)
  const hasValue = value != null && value !== '' && value !== 0
  const hasDetail = hasValue && !!(roster?.length || games?.length || teams?.length || weeks?.length || frameGames?.length)
  return (
    <View style={cardStyles.card}>
      <TouchableOpacity
        style={cardStyles.head}
        activeOpacity={0.7}
        disabled={!hasDetail}
        onPress={() => setExpanded(e => !e)}
      >
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
        {hasDetail ? (
          <Text style={cardStyles.chevron}>{expanded ? '▾' : '▸'}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Simple roster */}
      {expanded && roster?.length ? (
        <View style={cardStyles.roster}>
          {roster.map((p) => (
            <View key={p.name} style={cardStyles.rosterRow}>
              <Text style={cardStyles.rosterName}>{p.name}</Text>
              <Text style={cardStyles.rosterScore}>{p.score}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Winning-margin breakdown — both teams of the record game */}
      {expanded && teams?.length ? (
        <View style={cardStyles.roster}>
          {teams.map(t => (
            <GameBlock key={t.label} label={t.label} total={t.total} players={t.roster} />
          ))}
        </View>
      ) : null}

      {/* Night roster breakdown per game */}
      {expanded && games?.length ? (
        <View style={cardStyles.roster}>
          {games.map(g => (
            <GameBlock key={g.gameNum} label={`Game ${g.gameNum}`} total={g.total} players={g.roster} />
          ))}
        </View>
      ) : null}

      {/* Season breakdown — every week bowled, with that week's games and avg */}
      {expanded && weeks?.length ? (
        <View style={cardStyles.roster}>
          {weeks.map(w => (
            <View key={w.weekNum} style={cardStyles.rosterRow}>
              <Text style={cardStyles.rosterName}>{`Week ${w.weekNum}`}</Text>
              <View style={cardStyles.weekRight}>
                <Text style={cardStyles.weekScores}>{w.scores.join(' · ')}</Text>
                <Text style={cardStyles.weekAvg}>{w.avg.toFixed(1)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Frame-data breakdown — compact scorecard strip per game */}
      {expanded && frameGames?.length ? (
        <View style={cardStyles.roster}>
          {frameGames.map(g => (
            <FrameGameBlock key={g.gameNum} game={g} stat={frameStat ?? 'closed'} />
          ))}
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

/** Whether a frame counts toward the record's stat. */
function frameCounts(f: RecordFrame, stat: FrameStat): boolean {
  if (stat === 'strikes') return f.isStrike
  if (stat === 'spares') return f.isSpare
  return f.isStrike || f.isSpare
}

/** One game of a frame record: header (game + score, stat count) over a
 *  compact scorecard strip with the counted frames highlighted. */
function FrameGameBlock({ game, stat }: { game: RecordFrameGame; stat: FrameStat }) {
  const statCount = stat === 'strikes' ? game.strikes : stat === 'spares' ? game.spares : game.closed
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={cardStyles.gameBlockHead}>
        <Text style={cardStyles.gameBlockLabel}>{`Game ${game.gameNum} · ${game.score}`}</Text>
        <Text style={cardStyles.gameBlockTotal}>{statCount}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={frameStyles.strip}>
        {game.frames.map((f) => (
          <View key={f.frame} style={[frameStyles.frame, f.frame === 10 && frameStyles.frameTenth, frameCounts(f, stat) && frameStyles.frameHit]}>
            <View style={frameStyles.throwsRow}>
              {f.throws.map((t, i) => (
                <View key={i} style={[frameStyles.throwBox, t.split && frameStyles.throwSplit]}>
                  <Text style={[frameStyles.throwText, (t.display === 'X' || t.display === '/') && frameStyles.throwMark]}>
                    {t.display}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={frameStyles.cumulative}>{f.cumulative}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

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
  chevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
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
  rosterScore: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.text },
  weekRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  weekScores: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.text },
  weekAvg: { fontFamily: fonts.barlowCondensed, fontSize: 14, color: colors.accent, minWidth: 36, textAlign: 'right' },
  gameBlockHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  gameBlockLabel: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  gameBlockTotal: { fontFamily: fonts.barlowCondensed, fontSize: 13, color: colors.accent },
})

// Compact scorecard strip — a small read-only cut of the FrameStatsScreen
// scorecard (throw boxes + cumulative), with the record's frames highlighted.
const frameStyles = StyleSheet.create({
  strip: { flexDirection: 'row', paddingVertical: 2 },
  frame: {
    width: 36,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: radius.cardSm,
    marginRight: 5,
    overflow: 'hidden',
  },
  frameTenth: { width: 52 },
  frameHit: { borderColor: colors.accent },
  throwsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  throwBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  throwSplit: {
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: 8,
    margin: 1,
  },
  throwText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
  },
  throwMark: { color: colors.accent },
  cumulative: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: 3,
    backgroundColor: colors.surface2,
  },
})
