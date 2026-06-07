import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import MarketMoveCard from '../components/MarketMoveCard'
import { useMarketMovesData, FeedFilter } from '../hooks/useMarketMovesData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { PinsinoStackParamList } from '../navigation/types'
import { FeedEventView } from '../utils/activityFeedTemplates'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

// Filter chips (design §16.2). The pill component is string-keyed; map the labels
// back to the hook's FeedFilter values.
const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sportsbook', label: 'Sportsbook' },
  { key: 'loan_shark', label: 'Loan Shark' },
  { key: 'highlights', label: 'Highlights' },
]
const LABEL_BY_KEY = Object.fromEntries(FILTERS.map(f => [f.key, f.label]))

export default function MarketMovesScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)
  const { loading, events, filter, setFilter, hasMore, loadMore, reload } = useMarketMovesData()
  const { refreshing, onRefresh } = useRefresh(reload)

  // Privacy-aware tap target (design §16.3). Returns undefined for a
  // non-tappable card so a viewer can never reach another player's private detail.
  function onPressFor(event: FeedEventView): (() => void) | undefined {
    // Sportsbook moves → the actor's betting record (public Sportsbook surface).
    if (event.sportsbookBetId && event.actorPlayerId) {
      const pid = event.actorPlayerId
      const name = event.actorName ?? 'Player'
      return () => navigation.navigate('PlayerPinsino', { playerId: pid, name })
    }
    // Loan moves → ONLY the borrower viewing their own row may deep-link to Loan
    // Shark; everyone else gets a non-tappable card (§16.3, §3.5).
    if (event.loanId) {
      if (playerId && event.actorPlayerId === playerId) {
        return () => navigation.navigate('LoanShark')
      }
      return undefined
    }
    // Weekly House result + system events: no detail in v1.
    return undefined
  }

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Market Moves" subtitle="The Pinsino Newswire" onBack={() => navigation.goBack()} />
      <PillFilter
        items={FILTERS.map(f => f.key)}
        value={filter}
        onChange={item => setFilter(item as FeedFilter)}
        renderLabel={item => LABEL_BY_KEY[item] ?? item}
      />
      <FlatList
        data={events}
        keyExtractor={e => e.id}
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
