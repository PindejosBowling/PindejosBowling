import { useState, useCallback, useMemo } from 'react'
import { View, Text, TouchableOpacity, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { colors, fonts, radius } from '../theme'
import ScreenContainer from '../components/ui/ScreenContainer'
import MarketMovesTownBackdrop from '../components/pixelart/MarketMovesTownBackdrop'
import PillFilter from '../components/ui/PillFilter'
import MarketMoveCard from '../components/economy/MarketMoveCard'
import ReadOnlySeasonBanner from '../components/betting/ReadOnlySeasonBanner'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import FeatureExplainerSheet from '../components/pinsino/FeatureExplainerSheet'
import { EXPLAINERS } from '../data/pinsinoExplainers'
import { useMarketMovesData, FeedFilter, WeekInfoById } from '../hooks/useMarketMovesData'
import { useFeedEventPress } from '../hooks/useFeedEventPress'
import { useRefresh } from '../hooks/useRefresh'
import { useUiStore } from '../stores/uiStore'
import { FeedEventView } from '../utils/activityFeedTemplates'

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
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const { readOnly, viewSeasonNumber } = usePinsinoSeasonContext()
  const { loading, events, filter, setFilter, hasMore, loadMore, reload, weekInfoById, currentWeekId } = useMarketMovesData(pinsinoViewSeasonId)
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

  const [helpOpen, setHelpOpen] = useState(false)

  // Privacy-aware tap routing + the bet/PvP detail overlays it opens — shared
  // with the Pinsino hub's mini-feed (design §16.3).
  const { onPressFor, modals: feedDetailModals } = useFeedEventPress(reload)

  return (
    <ScreenContainer
      title="Market Moves"
      subtitle="The Pinsino Newswire"
      backdrop={<MarketMovesTownBackdrop />}
      loading={loading}
      scroll={false}
      onHelp={() => setHelpOpen(true)}
    >
      {readOnly && (
        <View style={styles.pillBar}>
          <ReadOnlySeasonBanner seasonNumber={viewSeasonNumber} />
        </View>
      )}
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
      {feedDetailModals}
      {helpOpen && (
        <FeatureExplainerSheet explainer={EXPLAINERS.marketMoves} onClose={() => setHelpOpen(false)} />
      )}
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
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
