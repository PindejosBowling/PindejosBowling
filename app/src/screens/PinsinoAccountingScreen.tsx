import { useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import ToggleGroup from '../components/ui/ToggleGroup'
import LedgerRow from '../components/betting/LedgerRow'
import { useRefresh } from '../hooks/useRefresh'
import { useHousePinsinoData } from '../hooks/useHousePinsinoData'
import { useAuthStore } from '../stores/authStore'
import { LedgerEntry } from '../hooks/usePlayerPinsinoData'
import { signed } from '../utils/bets'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type AccountingView = 'activity' | 'pnl'

const VIEW_OPTIONS: { key: AccountingView; label: string }[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'pnl', label: 'Weekly P&L' },
]

export default function PinsinoAccountingScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const { loading, balance, ledger, summary, weekPnl, exposure, stats, seasonNumber, reload } = useHousePinsinoData()
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<AccountingView>('activity')
  const [statementExpanded, setStatementExpanded] = useState(false)

  // Activity: house ledger grouped by week (newest first), week-less rows
  // (season-open bonuses) bucketed separately.
  const bonusEntries = useMemo(() => ledger.filter(e => e.weekNumber === null), [ledger])

  const ledgerByWeek = useMemo(() => {
    const map: Record<number, LedgerEntry[]> = {}
    for (const e of ledger) {
      if (e.weekNumber === null) continue
      if (!map[e.weekNumber]) map[e.weekNumber] = []
      map[e.weekNumber].push(e)
    }
    return map
  }, [ledger])

  const ledgerWeekNumbers = useMemo(
    () => Object.keys(ledgerByWeek).map(Number).sort((a, b) => b - a),
    [ledgerByWeek],
  )

  if (loading) return <LoadingView label="Loading…" />

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Accounting" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Admins only</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title="Accounting" onBack={() => navigation.goBack()} />
        {seasonNumber != null && <Text style={styles.subtitle}>SEASON {seasonNumber} · THE HOUSE</Text>}

        {/* House card — the house's side of the ledger. Tap HOUSE BALANCE to
            collapse/expand the full breakdown (financials + betting record). */}
        <View style={styles.summaryCard}>
          {statementExpanded && (
            <>
              {/* ── Summary statistics ─────────────────────────── */}
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>W–L–P (HOUSE)</Text>
                <Text style={styles.summaryValue}>{stats.houseWins}–{stats.houseLosses}–{stats.pushes}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>BETS SETTLED</Text>
                <Text style={styles.summaryValue}>{stats.settledCount.toLocaleString()}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>BIGGEST PAYOUT</Text>
                <Text style={[styles.summaryValue, { color: colors.danger }]}>
                  {stats.biggestPayout > 0 ? `−${stats.biggestPayout.toLocaleString()}` : '—'}
                </Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>BIGGEST TAKE</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>
                  {stats.biggestTake > 0 ? `+${stats.biggestTake.toLocaleString()}` : '—'}
                </Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>HOLD</Text>
                <Text style={[styles.summaryValue, stats.holdPct != null && { color: stats.holdPct >= 0 ? colors.success : colors.danger }]}>
                  {stats.holdPct != null ? `${stats.holdPct.toFixed(1)}%` : '—'}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>EXPOSURE (THIS WEEK)</Text>
                <Text style={[styles.summaryValue, { color: colors.muted }]}>−{exposure.toLocaleString()}</Text>
              </View>

              {/* ── divider: stats above, ledger flows below ───── */}
              <View style={styles.sectionDivider} />

              {/* ── Ledger activity (feeds House Balance) ───────── */}
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>STAKES TAKEN</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>{signed(summary.stakesTaken)}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>PAYOUTS</Text>
                <Text style={[styles.summaryValue, { color: colors.danger }]}>{signed(summary.payouts)}</Text>
              </View>
              {summary.bonuses !== 0 && (
                <View style={[styles.summaryRow, styles.summaryRowBorder]}>
                  <Text style={styles.summaryLabel}>BONUSES PAID</Text>
                  <Text style={[styles.summaryValue, { color: colors.gold }]}>{signed(summary.bonuses)}</Text>
                </View>
              )}
            </>
          )}
          <TouchableOpacity
            style={styles.summaryRow}
            activeOpacity={0.7}
            onPress={() => setStatementExpanded(e => !e)}
          >
            <Text style={[styles.summaryLabel, styles.summaryLabelTotal]}>
              HOUSE BALANCE {statementExpanded ? '▴' : '▾'}
            </Text>
            <Text style={[styles.summaryValue, styles.summaryValueTotal, { color: balance >= 0 ? colors.accent : colors.danger }]}>
              {balance.toLocaleString()}
            </Text>
          </TouchableOpacity>
        </View>

        {statementExpanded && (
          <Text style={[styles.note, styles.statsNote]}>
            Hold is the House's net betting take as a share of stakes wagered —
            positive means the Pinsino is winning. Exposure above is what it would
            owe if every open bet this week hits.
          </Text>
        )}

        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

        {/* ── Activity (house ledger by week) ───────────────── */}
        {view === 'activity' && (
          ledger.length > 0 ? (
            <>
              {bonusEntries.length > 0 && (
                <View>
                  <Text style={styles.gameLabel}>BONUSES</Text>
                  <View style={styles.card}>
                    {bonusEntries.map((entry, idx) => (
                      <LedgerRow key={entry.id} entry={entry} perspective="house" isLast={idx === bonusEntries.length - 1} />
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
                        <LedgerRow key={entry.id} entry={entry} perspective="house" isLast={idx === entries.length - 1} />
                      ))}
                    </View>
                  </View>
                )
              })}
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No house activity yet</Text>
            </View>
          )
        )}

        {/* ── Weekly P&L ────────────────────────────────────── */}
        {view === 'pnl' && (
          weekPnl.length > 0 ? (
            <View style={styles.card}>
              {weekPnl.map((w, idx) => (
                <View key={w.weekNumber} style={[styles.ledgerRow, idx < weekPnl.length - 1 && styles.ledgerRowBorder]}>
                  <Text style={styles.ledgerDescription}>WEEK {w.weekNumber}</Text>
                  <Text style={[styles.ledgerAmount, { color: w.net >= 0 ? colors.success : colors.danger }]}>
                    {signed(w.net)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No weekly results yet</Text>
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

  subtitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.muted,
    marginTop: -8,
    marginBottom: 16,
  },

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
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionDivider: {
    height: 6,
    marginHorizontal: -18,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border2,
  },
  summaryLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  summaryLabelTotal: { color: colors.text, fontSize: 15 },
  summaryValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 20,
    color: colors.text,
  },
  summaryValueTotal: { fontSize: 26 },

  note: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginTop: 4,
  },
  statsNote: { marginTop: -16, marginBottom: 20 },

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
  ledgerRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  ledgerDescription: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.3,
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
