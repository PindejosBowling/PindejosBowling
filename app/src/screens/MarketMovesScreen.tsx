import { useState, useCallback, useMemo } from 'react'
import { View, Text, TouchableOpacity, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import PillFilter from '../components/ui/PillFilter'
import MarketMoveCard from '../components/economy/MarketMoveCard'
import BetDetailModal from '../components/betting/BetDetailModal'
import PvpChallengeDetailModal from '../components/pvp/PvpChallengeDetailModal'
import { useMarketMovesData, FeedFilter, WeekInfoById } from '../hooks/useMarketMovesData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { PinsinoStackParamList } from '../navigation/types'
import { FeedEventView } from '../utils/activityFeedTemplates'
import { bets } from '../utils/supabase/db'
import { normalizeBet, BetView } from '../hooks/usePinsinoData'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

// Filter chips (design §16.2). The pill component is string-keyed; map the labels
// back to the hook's FeedFilter values.
const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'sportsbook', label: 'Sportsbook' },
  { key: 'loan_shark', label: 'Loan Shark' },
  { key: 'pvp', label: 'PvP' },
  { key: 'bounty_board', label: 'Bounties' },
  { key: 'auction_house', label: 'Auctions' },
]
const LABEL_BY_KEY = Object.fromEntries(FILTERS.map(f => [f.key, f.label]))

// Stable key for the bucket of events whose week was deleted (week_id → NULL).
const NO_WEEK_KEY = '__noweek__'

interface WeekGroup {
  key: string
  weekId: string | null
  weekNumber: number | null
  events: FeedEventView[]
}

// Group the feed (already published_at desc) into week containers. Events keep
// their desc order within a week; weeks sort most-recent → least; the orphan
// "no week" bucket (deleted weeks) sorts last. Pure + uncached — the screen
// wraps it in useMemo (project rule 5).
function groupEventsByWeek(events: FeedEventView[], weekInfoById: WeekInfoById): WeekGroup[] {
  const byKey = new Map<string, WeekGroup>()
  for (const e of events) {
    const key = e.weekId ?? NO_WEEK_KEY
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        weekId: e.weekId,
        weekNumber: e.weekId ? (weekInfoById[e.weekId]?.weekNumber ?? null) : null,
        events: [],
      }
      byKey.set(key, group)
    }
    group.events.push(e)
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.weekNumber == null) return 1
    if (b.weekNumber == null) return -1
    return b.weekNumber - a.weekNumber
  })
}

export default function MarketMovesScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const { loading, events, filter, setFilter, hasMore, loadMore, reload, weekInfoById, currentWeekId } = useMarketMovesData()
  const { refreshing, onRefresh } = useRefresh(reload)

  const groups = useMemo(() => groupEventsByWeek(events, weekInfoById), [events, weekInfoById])

  // Default-open the current active week; everything else collapsed. An override
  // map records explicit user toggles so we never need a seeding effect that
  // races the async week/event loads.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const defaultOpenKey = currentWeekId ?? groups[0]?.key
  const isExpanded = (key: string) => overrides[key] ?? (key === defaultOpenKey)
  const toggle = (key: string) =>
    setOverrides(prev => ({ ...prev, [key]: !(prev[key] ?? (key === defaultOpenKey)) }))

  // Refresh whenever the screen regains focus (opened or revisited) so events for
  // cancelled outcomes — which cascade-delete from the feed — drop off without a
  // manual pull. The hook's mount load covers first paint; focus reloads are silent.
  useFocusEffect(useCallback(() => { reload() }, [reload]))

  // The bet behind a tapped Sportsbook card → the shared Bet Details overlay.
  const [detailBet, setDetailBet] = useState<BetView | null>(null)
  // The challenge behind a tapped PvP card → the shared PvP detail overlay.
  const [detailChallengeId, setDetailChallengeId] = useState<string | null>(null)

  // Fetch the bet anchoring a Sportsbook card and open Bet Details. Stake/payout
  // are public in the Sportsbook view, so this surfaces the same breakdown.
  async function openBetDetail(betId: string) {
    const { data, error } = await bets.getById(betId)
    if (error || !data) {
      console.error('MarketMoves openBetDetail error:', error)
      return
    }
    setDetailBet(normalizeBet(data))
  }

  // Privacy-aware tap target (design §16.3). Returns undefined for a
  // non-tappable card so a viewer can never reach another player's private detail.
  function onPressFor(event: FeedEventView): (() => void) | undefined {
    // Sportsbook moves → the corresponding bet's Bet Details overlay.
    if (event.sportsbookBetId) {
      const betId = event.sportsbookBetId
      return () => openBetDetail(betId)
    }
    // Loan moves → ONLY the borrower viewing their own row may deep-link to Loan
    // Shark; everyone else gets a non-tappable card (§16.3, §3.5).
    if (event.loanId) {
      if (playerId && event.actorPlayerId === playerId) {
        return () => navigation.navigate('LoanShark')
      }
      return undefined
    }
    // PvP moves → the shared PvP challenge detail (contracts are public).
    if (event.pvpChallengeId) {
      const challengeId = event.pvpChallengeId
      return () => setDetailChallengeId(challengeId)
    }
    // Bounty moves → the public Bounty detail page.
    if (event.bountySourceId) {
      const bountyId = event.bountySourceId
      return () => navigation.navigate('BountyDetail', { bountyId })
    }
    // Auction moves → the public Auction detail page (a reversed auction's
    // feed rows cascade away, so a live id always resolves).
    if (event.auctionSourceId) {
      const auctionId = event.auctionSourceId
      return () => navigation.navigate('AuctionDetail', { auctionId })
    }
    // Weekly House result + system events: no detail in v1.
    return undefined
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Market Moves" subtitle="The Pinsino Newswire" onBack={() => navigation.goBack()} />
      <View style={styles.pillBar}>
        <PillFilter
          items={FILTERS.map(f => f.key)}
          value={filter}
          onChange={item => setFilter(item as FeedFilter)}
          renderLabel={item => LABEL_BY_KEY[item] ?? item}
        />
      </View>
      <FlatList
        data={groups}
        keyExtractor={g => g.key}
        style={styles.list}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => {
          const expanded = isExpanded(item.key)
          const title = item.weekNumber != null ? `Week ${item.weekNumber}` : 'Other Moves'
          return (
            <View style={styles.weekGroup}>
              <TouchableOpacity
                style={[styles.weekHeader, expanded && styles.weekHeaderExpanded]}
                onPress={() => toggle(item.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.weekTitle}>{title}</Text>
                <Text style={styles.weekCount}>{item.events.length}</Text>
                <Text style={[styles.chevron, expanded && styles.chevronUp]}>›</Text>
              </TouchableOpacity>
              {expanded && item.events.map(e => (
                <MarketMoveCard key={e.id} event={e} onPress={onPressFor(e)} />
              ))}
            </View>
          )
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasMore) loadMore() }}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No market moves yet. Check back once the action heats up.</Text>
          </View>
        }
        ListFooterComponent={
          hasMore ? <ActivityIndicator color={colors.muted} style={styles.footer} /> : null
        }
      />
      <BetDetailModal bet={detailBet} onClose={() => setDetailBet(null)} />
      {detailChallengeId && (
        <PvpChallengeDetailModal
          challengeId={detailChallengeId}
          onClose={() => setDetailChallengeId(null)}
          onChanged={reload}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Keep the pill row at its natural height — don't let the filled list squeeze it.
  pillBar: { flexShrink: 0 },
  // The list absorbs the remaining vertical space (and scrolls internally) so it
  // never competes with the header / pill row for height.
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 },
  footer: { paddingVertical: 16 },

  // Collapsible week container. The header is a distinct bar; expanded events
  // render beneath as the standard MarketMoveCards.
  weekGroup: { marginBottom: 16 },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.cardMd,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  weekHeaderExpanded: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 10,
  },
  weekTitle: {
    flex: 1,
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.3,
  },
  weekCount: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    marginRight: 10,
  },
  chevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 20,
    color: colors.muted,
    transform: [{ rotate: '90deg' }],
  },
  chevronUp: { transform: [{ rotate: '-90deg' }] },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyText: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
})
