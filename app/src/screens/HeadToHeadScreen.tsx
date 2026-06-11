import { useState, useMemo } from 'react'
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useH2HData, computeH2HFromSupabase } from '../hooks/useH2HData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/ui/LoadingView'
import PlayerPickerModal from '../components/ui/PlayerPickerModal'
import ScreenHeader from '../components/ui/ScreenHeader'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function HeadToHeadScreen() {
  const { loading, playerNames, rawScores, rawSchedule, reload } = useH2HData()
  const { h2hP1, h2hP2, set } = useUiStore()
  const { refreshing, onRefresh } = useRefresh(reload)
  const navigation = useNavigation<Nav>()
  const [pickerOpen, setPickerOpen] = useState<'p1' | 'p2' | null>(null)

  const h2hData = useMemo(
    () => (h2hP1 && h2hP2 && rawScores.length > 0
      ? computeH2HFromSupabase(h2hP1, h2hP2, rawScores, rawSchedule)
      : null),
    [h2hP1, h2hP2, rawScores, rawSchedule],
  )

  const teamLead = useMemo(() => {
    if (!h2hData) return null
    const { teamP1Wins, teamP2Wins } = h2hData
    return teamP1Wins > teamP2Wins ? 'p1' : teamP2Wins > teamP1Wins ? 'p2' : 'tie'
  }, [h2hData])

  const pinLead = useMemo(() => {
    if (!h2hData) return null
    const { pinP1Wins, pinP2Wins } = h2hData
    return pinP1Wins > pinP2Wins ? 'p1' : pinP2Wins > pinP1Wins ? 'p2' : 'tie'
  }, [h2hData])

  const reversedGames: any[] = useMemo(
    () => (h2hData ? [...h2hData.games].reverse() : []),
    [h2hData],
  )

  function teamDiff(g: any) {
    return g.t1Total - g.t2Total
  }

  function gameWinner(g: any) {
    const diff = teamDiff(g)
    if (diff === 0) return '—'
    return diff > 0 ? 'P1' : 'P2'
  }

  if (loading && rawScores.length === 0) return <LoadingView label="Loading head-to-head" />

  const noSelection = !h2hP1 || !h2hP2 || h2hP1 === h2hP2
  const p1Short = (h2hP1 || '').split(' ')[0]
  const p2Short = (h2hP2 || '').split(' ')[0]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Head to Head" onBack={() => navigation.navigate('MoreHome')} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {/* Player selectors */}
        <View style={styles.pickerRow}>
          <TouchableOpacity
            style={[styles.pickerBtn, h2hP1 ? styles.pickerBtnActive : null]}
            onPress={() => setPickerOpen('p1')}
            activeOpacity={0.7}
          >
            <Text style={[styles.pickerBtnText, h2hP1 ? styles.pickerBtnTextActive : null]} numberOfLines={1}>
              {h2hP1 || '— Bowler 1 —'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.vsText}>VS</Text>

          <TouchableOpacity
            style={[styles.pickerBtn, h2hP2 ? styles.pickerBtnActive : null]}
            onPress={() => setPickerOpen('p2')}
            activeOpacity={0.7}
          >
            <Text style={[styles.pickerBtnText, h2hP2 ? styles.pickerBtnTextActive : null]} numberOfLines={1}>
              {h2hP2 || '— Bowler 2 —'}
            </Text>
          </TouchableOpacity>
        </View>

        {noSelection ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⚔️</Text>
            <Text style={styles.emptyText}>Pick two different bowlers to compare.</Text>
          </View>
        ) : h2hData && h2hData.games.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>These two have never played head-to-head.</Text>
          </View>
        ) : h2hData ? (
          <>
            {/* Summary card */}
            <View style={styles.card}>
              <View style={styles.h2hHead}>
                <Text style={[styles.h2hName, teamLead === 'p1' && styles.h2hNameLead]}>
                  {h2hP1}
                </Text>
                <Text style={styles.h2hDivider}>vs</Text>
                <Text style={[styles.h2hName, styles.h2hNameRight, teamLead === 'p2' && styles.h2hNameLead]}>
                  {h2hP2}
                </Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>TEAM WINS</Text>
                <View style={styles.statLine}>
                  <Text style={[styles.statNum, teamLead === 'p1' && styles.statNumLead]}>
                    {h2hData.teamP1Wins}
                  </Text>
                  <Text style={styles.statDash}>—</Text>
                  <Text style={[styles.statNum, teamLead === 'p2' && styles.statNumLead]}>
                    {h2hData.teamP2Wins}
                  </Text>
                </View>
                {h2hData.teamTies > 0 && (
                  <Text style={styles.statSub}>
                    {h2hData.teamTies} tie{h2hData.teamTies > 1 ? 's' : ''}
                  </Text>
                )}
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>PIN TOTAL WINS</Text>
                <View style={styles.statLine}>
                  <Text style={[styles.statNum, pinLead === 'p1' && styles.statNumLead]}>
                    {h2hData.pinP1Wins}
                  </Text>
                  <Text style={styles.statDash}>—</Text>
                  <Text style={[styles.statNum, pinLead === 'p2' && styles.statNumLead]}>
                    {h2hData.pinP2Wins}
                  </Text>
                </View>
                {h2hData.pinTies > 0 && (
                  <Text style={styles.statSub}>
                    {h2hData.pinTies} tie{h2hData.pinTies > 1 ? 's' : ''}
                  </Text>
                )}
              </View>
            </View>

            {/* Game log */}
            <Text style={styles.sectionHeader}>EVERY MATCHUP</Text>
            <View style={styles.logCard}>
              <View style={styles.logRow}>
                <Text style={[styles.logCellWhen, styles.logHeaderText]}>WHEN</Text>
                <Text style={[styles.logCellScore, styles.logHeaderText]}>{p1Short} PINS</Text>
                <Text style={[styles.logCellScore, styles.logHeaderText]}>{p2Short} PINS</Text>
                <Text style={[styles.logCellSm, styles.logHeaderText]}>Δ</Text>
                <Text style={[styles.logCellSm, styles.logHeaderText]}>WIN</Text>
              </View>

              {reversedGames.map((g: any, i: number) => {
                const diff = teamDiff(g)
                return (
                  <View key={i} style={[styles.logRow, styles.logRowData]}>
                    <Text style={[styles.logCellWhen, styles.logWeekText]}>
                      S{g.season}W{g.week}.G{g.gameNum}
                    </Text>
                    <Text style={[styles.logCellScore, styles.logValueText, { color: g.p1Score > g.p2Score ? colors.accent : colors.text }]}>
                      {g.p1Score}
                    </Text>
                    <Text style={[styles.logCellScore, styles.logValueText, { color: g.p2Score > g.p1Score ? colors.accent : colors.text }]}>
                      {g.p2Score}
                    </Text>
                    <Text style={[styles.logCellSm, styles.logValueText, { color: diff >= 0 ? colors.success : colors.danger }]}>
                      {diff > 0 ? '+' : ''}{diff}
                    </Text>
                    <Text style={[styles.logCellSm, styles.logWinnerText]}>
                      {gameWinner(g)}
                    </Text>
                  </View>
                )
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      <PlayerPickerModal
        visible={pickerOpen === 'p1'}
        players={playerNames.filter((n) => n !== h2hP2)}
        title="Select Bowler 1"
        onSelect={(name) => { set({ h2hP1: name }); setPickerOpen(null) }}
        onClose={() => setPickerOpen(null)}
      />
      <PlayerPickerModal
        visible={pickerOpen === 'p2'}
        players={playerNames.filter((n) => n !== h2hP1)}
        title="Select Bowler 2"
        onSelect={(name) => { set({ h2hP2: name }); setPickerOpen(null) }}
        onClose={() => setPickerOpen(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },

  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  pickerBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  pickerBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  pickerBtnTextActive: { color: colors.accent },
  vsText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 1,
  },

  emptyState: { alignItems: 'center', marginTop: 48, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 20,
  },
  h2hHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  h2hName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 17,
    color: colors.muted,
    flex: 1,
  },
  h2hNameRight: { textAlign: 'right' },
  h2hNameLead: { color: colors.accent },
  h2hDivider: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted2,
    marginHorizontal: 10,
  },

  statRow: { marginBottom: 14 },
  statLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  statLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statNum: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 30,
    color: colors.text,
    minWidth: 28,
  },
  statNumLead: { color: colors.accent },
  statDash: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted2,
  },
  statSub: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 3,
  },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  logCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    overflow: 'hidden',
  },
  logRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  logRowData: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logCellWhen: { width: 72 },
  logCellScore: { flex: 1 },
  logCellSm: { width: 36, textAlign: 'right' },
  logHeaderText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
  },
  logValueText: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.text,
  },
  logWeekText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
  },
  logWinnerText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'right',
  },
})
