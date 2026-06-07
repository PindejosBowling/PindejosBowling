import { useState, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import MarketMoveCard from '../components/MarketMoveCard'
import BetDetailModal from '../components/BetDetailModal'
import PvPChallengeDetailModal from '../components/PvPChallengeDetailModal'
import { useMarketMovesData, FeedFilter } from '../hooks/useMarketMovesData'
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
  { key: 'sportsbook', label: 'Sportsbook' },
  { key: 'loan_shark', label: 'Loan Shark' },
  { key: 'pvp', label: 'PvP' },
  { key: 'highlights', label: 'Highlights' },
]
const LABEL_BY_KEY = Object.fromEntries(FILTERS.map(f => [f.key, f.label]))

export default function MarketMovesScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const { loading, events, filter, setFilter, hasMore, loadMore, reload } = useMarketMovesData()
  const { refreshing, onRefresh } = useRefresh(reload)

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
        data={events}
        keyExtractor={e => e.id}
        style={styles.list}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <MarketMoveCard event={item} onPress={onPressFor(item)} />}
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
        <PvPChallengeDetailModal
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
