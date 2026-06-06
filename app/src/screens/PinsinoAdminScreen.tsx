import { useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import ToggleGroup from '../components/ToggleGroup'
import LedgerRow from '../components/LedgerRow'
import { useRefresh } from '../hooks/useRefresh'
import { useHouseBettingData } from '../hooks/useHouseBettingData'
import { useAuthStore } from '../stores/authStore'
import { LedgerEntry } from '../hooks/usePlayerBettingDetailData'

type Nav = NativeStackNavigationProp<MoreStackParamList>
type HouseView = 'statement' | 'activity' | 'pnl'

const VIEW_OPTIONS: { key: HouseView; label: string }[] = [
  { key: 'statement', label: 'Statement' },
  { key: 'activity', label: 'Activity' },
  { key: 'pnl', label: 'Weekly P&L' },
]

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

export default function PinsinoAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const { loading, balance, ledger, summary, weekPnl, exposure, stats, seasonNumber, reload } = useHouseBettingData()
  const { refreshing, onRefresh } = useRefresh(reload)

  const [view, setView] = useState<HouseView>('statement')

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
        <ScreenHeader title="Pinsino Admin" onBack={() => navigation.goBack()} />
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
        <ScreenHeader
          title="Pinsino Admin"
          onBack={() => navigation.goBack()}
        />
        {seasonNumber != null && <Text style={styles.subtitle}>SEASON {seasonNumber} · THE HOUSE</Text>}

        {/* Pincome Statement card — the house's side of the ledger */}
        <View style={styles.summaryCard}>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <Text style={styles.summaryLabel}>STAKES TAKEN</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>{signed(summary.stakesTaken)}</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <Text style={styles.summaryLabel}>PAYOUTS</Text>
            <Text style={[styles.summaryValue, { color: colors.danger }]}>{signed(summary.payouts)}</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <Text style={styles.summaryLabel}>REFUNDS</Text>
            <Text style={[styles.summaryValue, { color: colors.danger }]}>{signed(summary.refunds)}</Text>
          </View>
          {summary.bonuses !== 0 && (
            <View style={[styles.summaryRow, styles.summaryRowBorder]}>
              <Text style={styles.summaryLabel}>BONUSES PAID</Text>
              <Text style={[styles.summaryValue, { color: colors.gold }]}>{signed(summary.bonuses)}</Text>
            </View>
          )}
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <Text style={styles.summaryLabel}>EXPOSURE (THIS WEEK)</Text>
            <Text style={[styles.summaryValue, { color: colors.muted }]}>−{exposure.toLocaleString()}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, styles.summaryLabelTotal]}>HOUSE BALANCE</Text>
            <Text style={[styles.summaryValue, styles.summaryValueTotal, { color: balance >= 0 ? colors.accent : colors.danger }]}>
              {balance.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* View toggle */}
        <View style={styles.viewToggle}>
          <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={setView} />
        </View>

        {/* ── Statement (house performance) ─────────────────── */}
        {view === 'statement' && (
          stats.settledCount > 0 || stats.bettors > 0 ? (
            <>
              {/* Record + hold headline */}
              <View style={styles.statGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{stats.houseWins}–{stats.houseLosses}–{stats.pushes}</Text>
                  <Text style={styles.statLabel}>W–L–P (HOUSE)</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, stats.holdPct != null && { color: stats.holdPct >= 0 ? colors.success : colors.danger }]}>
                    {stats.holdPct != null ? `${stats.holdPct.toFixed(1)}%` : '—'}
                  </Text>
                  <Text style={styles.statLabel}>HOLD</Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={[styles.ledgerRow, styles.ledgerRowBorder]}>
                  <Text style={styles.ledgerDescription}>BETS SETTLED</Text>
                  <Text style={styles.statRowValue}>{stats.settledCount.toLocaleString()}</Text>
                </View>
                <View style={[styles.ledgerRow, styles.ledgerRowBorder]}>
                  <Text style={styles.ledgerDescription}>DISTINCT BETTORS</Text>
                  <Text style={styles.statRowValue}>{stats.bettors.toLocaleString()}</Text>
                </View>
                <View style={styles.ledgerRow}>
                  <Text style={styles.ledgerDescription}>BIGGEST PAYOUT</Text>
                  <Text style={[styles.statRowValue, { color: colors.danger }]}>
                    {stats.biggestPayout > 0 ? `−${stats.biggestPayout.toLocaleString()}` : '—'}
                  </Text>
                </View>
              </View>

              <Text style={styles.note}>
                Hold is the House's net betting take as a share of stakes wagered —
                positive means the Pinsino is winning. Exposure above is what it would
                owe if every open bet this week hits.
              </Text>
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No bets settled yet this season</Text>
            </View>
          )
        )}

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

  viewToggle: { marginBottom: 20 },

  note: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginTop: 4,
  },

  statGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 26,
    color: colors.accent,
    lineHeight: 28,
  },
  statLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
    marginTop: 4,
  },
  statRowValue: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    marginLeft: 10,
  },

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
