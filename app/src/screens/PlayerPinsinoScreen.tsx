import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRoute, useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { RouteProp } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import { PinsinoStackParamList } from '../navigation/types'
import AppHeader from '../components/league/AppHeader'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import ToggleGroup from '../components/ui/ToggleGroup'
import BetRow from '../components/betting/BetRow'
import LedgerRow from '../components/betting/LedgerRow'
import { resultBadge, betReturnText } from '../utils/bets'
import { useRefresh } from '../hooks/useRefresh'
import { usePlayerPinsinoData, LedgerEntry } from '../hooks/usePlayerPinsinoData'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import { useUiStore } from '../stores/uiStore'
import { BetView } from '../hooks/usePinsinoData'
import EmptyCard from '../components/ui/EmptyCard'
import { formatPins, signed } from '../utils/formatting'

type PlayerPinsinoRoute = RouteProp<
  { PlayerPinsino: { playerId: string; name: string } },
  'PlayerPinsino'
>
type PlayerPinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

type DetailView = 'activity' | 'open' | 'settled'

export default function PlayerPinsinoScreen() {
  const route = useRoute<PlayerPinsinoRoute>()
  const navigation = useNavigation<PlayerPinsinoNav>()
  const { playerId, name } = route.params

  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const { readOnly, viewSeasonNumber } = usePinsinoSeasonContext()
  const { loading, balance, debt, netWorth, ledger, openBets, settledBets, reload } = usePlayerPinsinoData(playerId, pinsinoViewSeasonId)
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

  const summary = useMemo(() => {
    // Three economic buckets that partition every pin_ledger type:
    //   pincome — pins earned bowling + house bonuses (score_credit, bonus,
    //             rsvp_bonus)
    //   loans   — net cash the loan system moved through the balance
    //             (loan_issued proceeds, less repayments/garnishments/settlement)
    //   gaming  — net across everything else you wager on (bets, PvP, bounties,
    //             auctions, item effects). Taken as the remainder so the rows
    //             always reconcile to the spendable balance, even for ledger
    //             types added later.
    let pincome = 0
    let loans = 0
    for (const e of ledger) {
      if (e.type === 'score_credit' || e.type === 'bonus' || e.type === 'rsvp_bonus') pincome += e.amount
      else if (e.type.startsWith('loan_')) loans += e.amount
    }
    const gaming = balance - pincome - loans
    return { pincome, gaming, loans }
  }, [ledger, balance])

  const bonusEntries = useMemo(
    () => ledger.filter(e => e.type === 'bonus'),
    [ledger],
  )

  const ledgerByWeek = useMemo(() => {
    const map: Record<number, LedgerEntry[]> = {}
    for (const entry of ledger) {
      if (entry.type === 'bonus' || entry.weekNumber === null) continue
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

  if (loading) return <LoadingView label="Loading…" delayed />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title={name} onBack={() => navigation.goBack()} />

        {readOnly && <ReadOnlySeasonBanner seasonNumber={viewSeasonNumber} />}

        {/* Summary card */}
        <View style={styles.summaryCard}>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <View style={styles.summaryLabelCol}>
              <Text style={[styles.summaryLabel, styles.summaryLabelTotal]}>PINCOME</Text>
              <Text style={styles.summarySub}>Scores bowled & house bonuses</Text>
            </View>
            <Text style={[styles.summaryValue, { color: summary.pincome >= 0 ? colors.success : colors.danger }]}>
              {signed(summary.pincome)}
            </Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <View style={styles.summaryLabelCol}>
              <Text style={styles.summaryLabel}>GAMING</Text>
              <Text style={styles.summarySub}>Net from bets, PvP, bounties & auctions</Text>
            </View>
            <Text style={[styles.summaryValue, { color: summary.gaming >= 0 ? colors.success : colors.danger }]}>
              {signed(summary.gaming)}
            </Text>
          </View>
          {summary.loans !== 0 && (
            <View style={[styles.summaryRow, styles.summaryRowBorder]}>
              <View style={styles.summaryLabelCol}>
                <Text style={styles.summaryLabel}>LOAN PROCEEDS</Text>
                <Text style={styles.summarySub}>Pins borrowed, net of repayments</Text>
              </View>
              <Text style={[styles.summaryValue, { color: summary.loans >= 0 ? colors.success : colors.danger }]}>
                {signed(summary.loans)}
              </Text>
            </View>
          )}
          {/* When the player carries loan debt, PIN BALANCE is only a subtotal;
              the reconciling headline is NET WORTH = balance − outstanding debt. */}
          {debt !== 0 ? (
            <>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <View style={styles.summaryLabelCol}>
                  <Text style={[styles.summaryLabel, styles.summaryLabelTotal]}>PIN BALANCE</Text>
                  <Text style={styles.summarySub}>Pins available to spend</Text>
                </View>
                <Text style={styles.summaryValue}>{formatPins(balance)}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <View style={styles.summaryLabelCol}>
                  <Text style={styles.summaryLabel}>LOANS OUTSTANDING</Text>
                  <Text style={styles.summarySub}>Debt still owed to the Loan Shark</Text>
                </View>
                <Text style={[styles.summaryValue, { color: colors.danger }]}>
                  −{formatPins(debt)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <View style={styles.summaryLabelCol}>
                  <Text style={[styles.summaryLabel, styles.summaryLabelTotal]}>NET WORTH</Text>
                  <Text style={styles.summarySub}>Balance minus what you owe</Text>
                </View>
                <Text style={[styles.summaryValue, styles.summaryValueTotal]}>
                  {formatPins(netWorth)}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, styles.summaryLabelTotal]}>PIN BALANCE</Text>
              <Text style={[styles.summaryValue, styles.summaryValueTotal]}>
                {formatPins(balance)}
              </Text>
            </View>
          )}
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
                  <Text style={styles.gameLabel}>BONUSES</Text>
                  <View style={styles.card}>
                    {bonusEntries.map((entry, idx) => (
                      <LedgerRow
                        key={entry.id}
                        entry={entry}
                        perspective="player"
                        isLast={idx === bonusEntries.length - 1}
                      />
                    ))}
                  </View>
                </View>
              )}
              {ledgerWeekNumbers.map(weekNum => {
                const entries = ledgerByWeek[weekNum]
                return (
                  <View key={weekNum}>
                    <Text style={styles.gameLabel}>WEEK {weekNum}</Text>
                    <View style={styles.card}>
                      {entries.map((entry, idx) => (
                        <LedgerRow
                          key={entry.id}
                          entry={entry}
                          perspective="player"
                          isLast={idx === entries.length - 1}
                        />
                      ))}
                    </View>
                  </View>
                )
              })}
            </>
          ) : (
            <EmptyCard text="No activity yet" />
          )
        )}

        {/* ── Open Bets ────────────────────────────────────── */}
        {view === 'open' && (
          openGameNumbers.length > 0 ? (
            <>
              {openGameNumbers.map(gameNum => (
                <View key={gameNum}>
                  <Text style={styles.gameLabel}>GAME {gameNum}</Text>
                  {/* BetRow renders self-contained ticket cards — no wrapper card. */}
                  <View>
                    {openBetsByGame[gameNum].map(bet => (
                      <BetRow
                        key={bet.id}
                        bet={bet}
                        badge={null}
                        betReturnText={betReturnText(bet)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </>
          ) : (
            <EmptyCard text="No open bets" />
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
                      <View>
                        {betsInWeek.map(bet => (
                          <BetRow
                            key={bet.id}
                            bet={bet}
                            badge={resultBadge(bet.status)}
                            betReturnText={betReturnText(bet)}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                )
              })}
            </>
          ) : (
            <EmptyCard text="No settled bets this season" />
          )
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    marginTop: 8,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  summaryRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabelCol: {
    flex: 1,
    paddingRight: 12,
  },
  summaryLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  summarySub: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.muted,
    opacity: 0.7,
    marginTop: 2,
  },
  summaryLabelTotal: {
    color: colors.text,
    fontSize: 15,
  },
  summaryValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 20,
    color: colors.text,
  },
  summaryValueTotal: {
    fontSize: 26,
    color: colors.accent,
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

  gameLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
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
})
