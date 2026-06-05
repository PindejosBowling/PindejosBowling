import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRoute, useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { RouteProp } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import { BettingStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import ToggleGroup from '../components/ToggleGroup'
import BetRow from '../components/BetRow'
import { useRefresh } from '../hooks/useRefresh'
import { usePlayerBettingDetailData, LedgerEntry } from '../hooks/usePlayerBettingDetailData'
import { BetView } from '../hooks/useBettingData'

type PlayerBettingDetailRoute = RouteProp<
  { PlayerBettingDetail: { playerId: string; name: string } },
  'PlayerBettingDetail'
>
type PlayerBettingDetailNav = NativeStackNavigationProp<BettingStackParamList>

type DetailView = 'activity' | 'open' | 'settled'

function resultBadge(status: string) {
  if (status === 'push') return { label: 'PUSH', color: colors.muted }
  if (status === 'won') return { label: 'WON', color: colors.success }
  if (status === 'lost') return { label: 'LOST', color: colors.danger }
  return null
}

function betReturnText(bet: BetView): string {
  if (bet.status === 'push' || bet.status === 'void') return `+${bet.stake}`
  if (bet.status === 'lost') return `-${bet.stake}`
  return `+${bet.potentialPayout}`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PlayerBettingDetailScreen() {
  const route = useRoute<PlayerBettingDetailRoute>()
  const navigation = useNavigation<PlayerBettingDetailNav>()
  const { playerId, name } = route.params

  const { loading, balance, ledger, openBets, settledBets, reload } = usePlayerBettingDetailData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<DetailView>('activity')
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => {
    // Initialize with most recent week expanded
    if (settledBets.length > 0) {
      const weeks = [...new Set(settledBets.map(b => b.weekNumber).filter(Boolean))] as number[]
      if (weeks.length > 0) {
        const maxWeek = Math.max(...weeks)
        return new Set([maxWeek])
      }
    }
    return new Set()
  })

  const VIEW_OPTIONS: { key: DetailView; label: string }[] = [
    { key: 'activity', label: 'Activity' },
    { key: 'open', label: 'Open Bets' },
    { key: 'settled', label: 'Settled Bets' },
  ]

  const bonusEntries = useMemo(
    () => ledger.filter(e => e.weekNumber === null),
    [ledger],
  )

  const ledgerByWeek = useMemo(() => {
    const map: Record<number, LedgerEntry[]> = {}
    for (const entry of ledger) {
      if (entry.weekNumber === null) continue
      if (!map[entry.weekNumber]) map[entry.weekNumber] = []
      map[entry.weekNumber].push(entry)
    }
    return map
  }, [ledger])

  const ledgerWeekNumbers = useMemo(
    () => Object.keys(ledgerByWeek).map(Number).sort((a, b) => b - a),
    [ledgerByWeek],
  )

  const openBetsByGame = useMemo(() => {
    const map: Record<number, BetView[]> = {}
    for (const bet of openBets) {
      const gameNum = bet.gameNumber ?? 0
      if (!map[gameNum]) map[gameNum] = []
      map[gameNum].push(bet)
    }
    return map
  }, [openBets])

  const openGameNumbers = useMemo(
    () => Object.keys(openBetsByGame).map(Number).sort((a, b) => a - b),
    [openBetsByGame],
  )

  const settledBetsByWeek = useMemo(() => {
    const map: Record<number, BetView[]> = {}
    for (const bet of settledBets) {
      const weekNum = bet.weekNumber ?? 0
      if (!map[weekNum]) map[weekNum] = []
      map[weekNum].push(bet)
    }
    return map
  }, [settledBets])

  const settledWeekNumbers = useMemo(
    () => Object.keys(settledBetsByWeek).map(Number).sort((a, b) => b - a),
    [settledBetsByWeek],
  )

  function toggleWeekExpanded(weekNum: number) {
    setExpandedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(weekNum)) {
        next.delete(weekNum)
      } else {
        next.add(weekNum)
      }
      return next
    })
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title={name} onBack={() => navigation.goBack()} />

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={styles.balanceValue}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceUnit}>PINS</Text>
        </View>

        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

        {/* ── Activity ────────────────────────────────────── */}
        {view === 'activity' && (
          ledger.length > 0 ? (
            <>
              {bonusEntries.length > 0 && (
                <View>
                  <Text style={styles.bonusSectionLabel}>BONUSES</Text>
                  <View style={styles.card}>
                    {bonusEntries.map((entry, idx) => {
                      const isLast = idx === bonusEntries.length - 1
                      const isPositive = entry.amount > 0
                      return (
                        <View key={entry.id} style={[styles.ledgerRow, !isLast && styles.ledgerRowBorder]}>
                          <View style={styles.ledgerInfo}>
                            <Text style={styles.ledgerDescription}>{entry.description}</Text>
                            <Text style={styles.ledgerDate}>{formatDate(entry.created_at)}</Text>
                          </View>
                          <Text style={[styles.ledgerAmount, { color: isPositive ? colors.success : colors.danger }]}>
                            {isPositive ? '+' : ''}{entry.amount}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                </View>
              )}
              {ledgerWeekNumbers.map(weekNum => {
                const entries = ledgerByWeek[weekNum]
                return (
                  <View key={weekNum}>
                    <Text style={styles.gameLabel}>WEEK {weekNum}</Text>
                    <View style={styles.card}>
                      {entries.map((entry, idx) => {
                        const isLast = idx === entries.length - 1
                        const isPositive = entry.amount > 0
                        return (
                          <View key={entry.id} style={[styles.ledgerRow, !isLast && styles.ledgerRowBorder]}>
                            <View style={styles.ledgerInfo}>
                              <Text style={styles.ledgerDescription}>{entry.description}</Text>
                              <Text style={styles.ledgerDate}>{formatDate(entry.created_at)}</Text>
                            </View>
                            <Text style={[styles.ledgerAmount, { color: isPositive ? colors.success : colors.danger }]}>
                              {isPositive ? '+' : ''}{entry.amount}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  </View>
                )
              })}
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No activity yet</Text>
            </View>
          )
        )}

        {/* ── Open Bets ────────────────────────────────────── */}
        {view === 'open' && (
          openGameNumbers.length > 0 ? (
            <>
              {openGameNumbers.map(gameNum => (
                <View key={gameNum}>
                  <Text style={styles.gameLabel}>GAME {gameNum}</Text>
                  <View style={styles.card}>
                    {openBetsByGame[gameNum].map((bet, idx) => {
                      const isLast = idx === openBetsByGame[gameNum].length - 1
                      return (
                        <BetRow
                          key={bet.id}
                          bet={bet}
                          isLast={isLast}
                          badge={null}
                          betReturnText={betReturnText(bet)}
                          isAdmin={false}
                        />
                      )
                    })}
                  </View>
                </View>
              ))}
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No open bets</Text>
            </View>
          )
        )}

        {/* ── Settled Bets ────────────────────────────────────── */}
        {view === 'settled' && (
          settledWeekNumbers.length > 0 ? (
            <>
              {settledWeekNumbers.map(weekNum => {
                const betsInWeek = settledBetsByWeek[weekNum]
                const isExpanded = expandedWeeks.has(weekNum)
                return (
                  <View key={weekNum}>
                    <TouchableOpacity
                      style={styles.weekHeader}
                      onPress={() => toggleWeekExpanded(weekNum)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.weekChevron}>{isExpanded ? '▾' : '▸'}</Text>
                      <Text style={styles.weekLabel}>WEEK {weekNum}</Text>
                      <View style={styles.weekCountBadge}>
                        <Text style={styles.weekCountText}>{betsInWeek.length}</Text>
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.card}>
                        {betsInWeek.map((bet, idx) => {
                          const badge = resultBadge(bet.status)
                          const isLast = idx === betsInWeek.length - 1
                          return (
                            <BetRow
                              key={bet.id}
                              bet={bet}
                              isLast={isLast}
                              badge={badge}
                              betReturnText={betReturnText(bet)}
                              isAdmin={false}
                            />
                          )
                        })}
                      </View>
                    )}
                  </View>
                )
              })}
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No settled bets this season</Text>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: 24,
    marginTop: 8,
    marginBottom: 24,
  },
  balanceLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 4,
  },
  balanceValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 56,
    color: colors.accent,
    lineHeight: 60,
  },
  balanceUnit: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginTop: 2,
  },

  viewToggle: { marginBottom: 20 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },

  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  ledgerRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  ledgerInfo: { flex: 1 },
  ledgerDescription: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
  },
  ledgerDate: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  ledgerAmount: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    letterSpacing: 0.5,
    marginLeft: 10,
  },

  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
    marginBottom: 6,
    marginTop: 4,
  },
  bonusSectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.gold,
    marginBottom: 6,
    marginTop: 4,
  },

  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: 6,
  },
  weekChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    width: 20,
    textAlign: 'center',
  },
  weekLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
    flex: 1,
  },
  weekCountBadge: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekCountText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.5,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.3,
  },
})
