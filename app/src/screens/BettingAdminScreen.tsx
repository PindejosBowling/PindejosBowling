import { useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Switch,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import { useBettingAdminData } from '../hooks/useBettingAdminData'
import { useRefresh } from '../hooks/useRefresh'
import { betLines as betLinesDb } from '../utils/supabase/db'
import { useUiStore } from '../stores/uiStore'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function BettingAdminScreen() {
  const navigation = useNavigation<Nav>()
  const { showToast } = useUiStore()
  const { loading, lines, betCountByLine, reload } = useBettingAdminData()
  const { refreshing, onRefresh } = useRefresh(reload)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})

  // Group lines by game_number
  const linesByGame = useMemo(() => {
    const map: Record<number, any[]> = {}
    for (const line of lines) {
      if (!map[line.game_number]) map[line.game_number] = []
      map[line.game_number].push(line)
    }
    return map
  }, [lines])

  const sortedGameNumbers = useMemo(
    () => Object.keys(linesByGame).map(Number).sort(),
    [linesByGame]
  )

  async function toggleLine(lineId: string, newValue: boolean) {
    setToggling(prev => ({ ...prev, [lineId]: true }))
    try {
      const { error } = await betLinesDb.update(lineId, { is_open: newValue })
      if (error) showToast(error.message, 'error')
      else await reload()
    } catch {
      showToast('Failed to update line', 'error')
    } finally {
      setToggling(prev => ({ ...prev, [lineId]: false }))
    }
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Bet Lines" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {sortedGameNumbers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No lines for this week</Text>
            <Text style={styles.emptyHint}>Lines are created when teams are confirmed</Text>
          </View>
        ) : (
          sortedGameNumbers.map(gameNum => (
            <View key={gameNum}>
              <Text style={styles.gameLabel}>GAME {gameNum}</Text>
              <View style={styles.card}>
                {linesByGame[gameNum].map((line, idx) => {
                  const count = betCountByLine[line.id] ?? 0
                  const isLast = idx === linesByGame[gameNum].length - 1
                  return (
                    <View key={line.id} style={[styles.lineRow, !isLast && styles.lineRowBorder]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.playerName}>{line.players?.name ?? '—'}</Text>
                        <Text style={styles.lineDetail}>
                          LINE {Number(line.line).toFixed(1)}
                          {count > 0
                            ? `  ·  ${count} bet${count !== 1 ? 's' : ''}`
                            : '  ·  no bets'}
                          {line.result ? `  ·  ${line.result.toUpperCase()}` : ''}
                        </Text>
                      </View>
                      <Switch
                        value={line.is_open}
                        onValueChange={v => toggleLine(line.id, v)}
                        disabled={!!toggling[line.id] || !!line.result}
                        trackColor={{ false: colors.surface3, true: colors.accentDim }}
                        thumbColor={line.is_open ? colors.accent : colors.muted}
                      />
                    </View>
                  )
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.accent,
    marginTop: 16,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 4,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  lineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  playerName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 0.3,
  },
  lineDetail: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  emptyHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted2,
    textAlign: 'center',
  },
})
