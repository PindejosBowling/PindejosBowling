import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import AppHeader from '../components/league/AppHeader'
import PinsinoNoirBackdrop from '../components/pixelart/PinsinoNoirBackdrop'
import LoadingView from '../components/ui/LoadingView'
import PinsinoLeaderboardTable from '../components/betting/PinsinoLeaderboardTable'
import Dropdown from '../components/ui/Dropdown'
import MarketMovePreviewRow from '../components/economy/MarketMovePreviewRow'
import { usePinsinoData } from '../hooks/usePinsinoData'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import { useMarketMovesPreview } from '../hooks/useMarketMovesPreview'
import { useFeedEventPress } from '../hooks/useFeedEventPress'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useUiStore } from '../stores/uiStore'
import { countForRoute } from '../utils/notifications'
import { SHOW_AUCTION_HOUSE, SHOW_BOUNTIES, SHOW_MARKET_MOVES, SHOW_PINSINO_ART, SHOW_PVP } from '../utils/featureFlags'
import { EXPLAINERS, PinsinoFeatureKey } from '../data/pinsinoExplainers'
import { AUCTION_HOUSE_CLOSED_DEFAULT_MESSAGE } from '../utils/auction'
import { PinsinoStackParamList } from '../navigation/types'
import { formatPins } from '../utils/formatting'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

const TILE_GAP = 12
const TILE_WIDTH = (Dimensions.get('window').width - 32 - TILE_GAP * 2) / 3
// Tile fonts track the tile size (which tracks screen width). ~111pt is the
// tile width on a 390pt-wide baseline screen, where the base font sizes were
// designed.
const TILE_FONT_SCALE = TILE_WIDTH / 111

// Market Moves carousel page width. pagingEnabled snaps by the ScrollView's
// frame width, so each page must match it exactly: screen − content padding
// (16×2) − feed-box borders (1×2). Inner padding lives on the page, not the
// box, to keep the math flat.
const FEED_PAGE_WIDTH = Dimensions.get('window').width - 32 - 2

// Fit-to-one-screen floor: below this the landing page becomes unreadable, so
// scrolling is the graceful fallback on pathologically short viewports.
const MIN_FIT_SCALE = 0.6

// Subpage menu tiles (groundwork for more Pinsino subpages — add one line each).
// Each tile shows its feature's one-line hook from the explainer catalog, so
// the landing page doubles as a menu of what each game actually is.
const MENU_TILES: { key: PinsinoFeatureKey; icon: string; label: string; route: 'PinsinoLeaderboard' | 'Sportsbook' | 'LoanShark' | 'PvP' | 'MarketMoves' | 'BountyBoard' | 'AuctionHouse' }[] = [
  { key: 'sportsbook', icon: '🏟️', label: 'Sportsbook', route: 'Sportsbook' },
  // Mock-backed while the auction DB layer is built — flag-gated independently.
  ...(SHOW_AUCTION_HOUSE ? [{ key: 'auctionHouse' as const, icon: '📣', label: 'Auction House', route: 'AuctionHouse' as const }] : []),
  { key: 'loanShark', icon: '🦈', label: 'Loan Shark', route: 'LoanShark' },
  ...(SHOW_PVP ? [{ key: 'pvp' as const, icon: '⚔️', label: 'PvP', route: 'PvP' as const }] : []),
  ...(SHOW_BOUNTIES ? [{ key: 'bounties' as const, icon: '🎯', label: 'Bounties', route: 'BountyBoard' as const }] : []),
  ...(SHOW_MARKET_MOVES ? [{ key: 'marketMoves' as const, icon: '👀', label: 'Market Moves', route: 'MarketMoves' as const }] : []),
]

export default function PinsinoScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const playerName = useAuthStore(s => s.playerName)
  const artworkReveal = useUiStore(s => s.artworkReveal)
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const setUi = useUiStore(s => s.set)
  const navigation = useNavigation<PinsinoNav>()

  // The shared "viewed season" context drives the selector + read-only gating
  // across the whole Pinsino tab.
  const { seasons: allSeasons, liveSeasonId, readOnly } = usePinsinoSeasonContext()
  const { loading, balance, debt, openAction, netWorth, leaderboard, seasonNumber, seasonConcluded, auctionHouseClosed, auctionHouseClosedMessage, reload } = usePinsinoData(playerId, pinsinoViewSeasonId)
  const { events: feedEvents, reload: reloadFeed } = useMarketMovesPreview(pinsinoViewSeasonId)
  // Which carousel page is showing — drives the scrollability dots.
  const [feedPage, setFeedPage] = useState(0)
  // Tapping a feed event opens the same detail it would on the Market Moves
  // screen (bet/PvP overlays, bounty/auction pages, own-loan deep link).
  const { onPressFor, modals: feedDetailModals } = useFeedEventPress(reloadFeed)
  const { refreshing, onRefresh } = useRefresh(async () => { await Promise.all([reload(), reloadFeed()]) })

  // Selector options: the live season (default) + each concluded season, newest
  // first. The live entry is labeled with its season number ("Season 3") for
  // consistency with the rest of the app; picking it clears back to live mode.
  // Season 1 predates the Pinsino economy (no pin ledger / bets / outcomes to
  // review), so it's excluded entirely from the history selector.
  const concludedSeasons = allSeasons.filter(s => !s.is_active && s.number > 1)
  // Between seasons liveSeasonId is null; seasonNumber then carries the
  // last-ended season being shown live-style.
  const liveSeasonNumber = allSeasons.find(s => s.id === liveSeasonId)?.number ?? seasonNumber
  // Uppercase to match the card's small-caps voice ("YOUR BALANCE IS" / "PINS").
  const seasonOptions = [
    { key: 'live', label: `SEASON ${liveSeasonNumber}` },
    ...concludedSeasons.map(s => ({ key: String(s.number), label: `SEASON ${s.number}` })),
  ]
  const selectorValue = pinsinoViewSeasonId == null
    ? 'live'
    : String(concludedSeasons.find(s => s.id === pinsinoViewSeasonId)?.number ?? 'live')
  const onSelectSeason = (item: string) => {
    if (item === 'live') { setUi({ pinsinoViewSeasonId: null }); return }
    const picked = concludedSeasons.find(s => String(s.number) === item)
    setUi({ pinsinoViewSeasonId: picked?.id ?? null })
  }

  // Pending-action counts for the tile badges. Refresh on focus so they reflect
  // actions taken inside the subpages (e.g. responding to a PvP contract).
  const counts = useNotificationStore(s => s.counts)
  useFocusEffect(
    useCallback(() => {
      useNotificationStore.getState().refresh()
    }, []),
  )

  // Fit-to-one-screen: measure the scroll viewport and the natural content
  // height, then ratchet a single scale factor down until the content fits.
  // The multiplicative update converges even though some children (the shared
  // leaderboard table, the season dropdown) don't scale — each pass re-measures the
  // real rendered height. Scale only ever decreases, so it's reset whenever
  // the set of stacked sections changes (banner/selector appearing).
  const [fitScale, setFitScale] = useState(1)
  const viewportH = useRef(0)
  const contentH = useRef(0)
  const maybeShrink = useCallback(() => {
    const vh = viewportH.current
    const ch = contentH.current
    if (vh > 0 && ch > vh + 2) {
      setFitScale(prev =>
        prev <= MIN_FIT_SCALE ? prev : Math.max(MIN_FIT_SCALE, prev * (vh / ch) * 0.98),
      )
    }
  }, [])
  const hasSelector = concludedSeasons.length > 0
  useEffect(() => {
    setFitScale(1)
  }, [seasonConcluded, hasSelector])

  const sc = useMemo(() => {
    const s = (n: number) => Math.round(n * fitScale)
    // Tile typography scales with both the screen size and the fit pass.
    const t = (n: number) => Math.round(n * fitScale * TILE_FONT_SCALE)
    return {
      content: { paddingBottom: s(16) },
      finalBanner: { paddingVertical: s(10), marginBottom: s(12) },
      balanceCard: { paddingVertical: s(8), marginBottom: s(16) },
      balanceValue: { fontSize: s(36) },
      balanceUnit: { fontSize: s(12) },
      grid: { rowGap: s(TILE_GAP), marginBottom: s(12) },
      feedBox: { height: s(80) },
      tile: { height: s(TILE_WIDTH) },
      tileIcon: { fontSize: t(34), marginBottom: s(6) },
      tileLabel: { fontSize: t(16) },
      tileHook: { fontSize: t(10), lineHeight: t(13), marginTop: s(2) },
    }
  }, [fitScale])

  // Transitions stay art-only: the backdrop paints immediately and the
  // spinner appears only if loading drags past 5s.
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {SHOW_PINSINO_ART && <PinsinoNoirBackdrop />}
        <LoadingView label="Loading…" transparent delayed />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {SHOW_PINSINO_ART && <PinsinoNoirBackdrop />}
      <AppHeader artworkToggle={SHOW_PINSINO_ART} onHelp={() => navigation.navigate('PinsinoHelp')} />
      {(!SHOW_PINSINO_ART || !artworkReveal) && (
      <ScrollView
        contentContainerStyle={[styles.content, sc.content]}
        onLayout={e => { viewportH.current = e.nativeEvent.layout.height; maybeShrink() }}
        onContentSizeChange={(_w, h) => { contentH.current = h; maybeShrink() }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Between seasons: the most-recently-ended season is frozen here as a
            final outcome until the next season starts. */}
        {seasonConcluded && (
          <View style={[styles.finalBanner, sc.finalBanner]}>
            <Text style={styles.finalBannerText}>
              SEASON {seasonNumber} · FINAL RESULTS
            </Text>
            <Text style={styles.finalBannerSub}>
              Betting is closed until next season begins.
            </Text>
          </View>
        )}

        {/* Balance card — tap to view your own betting record */}
        <TouchableOpacity
          style={[styles.balanceCard, sc.balanceCard]}
          onPress={() => {
            // The player detail respects the selected season too, so this drills
            // into the viewer's record for whichever season is being viewed.
            if (playerId) navigation.navigate('PlayerPinsino', { playerId, name: playerName ?? 'Me' })
          }}
          activeOpacity={0.7}
          disabled={!playerId}
        >
          {/* One row, middle-aligned: season pill · explanatory words ·
              emphasized value. The season selector governs the entire tab
              ('live' shows the current season; a concluded season flips the
              whole tab into read-only end-of-season review) and only appears
              once there's a prior season to review. It's a nested tap target,
              so opening it never navigates into PlayerPinsino. */}
          <View style={styles.balanceRow}>
            {concludedSeasons.length > 0 && (
              <Dropdown
                options={seasonOptions}
                value={selectorValue}
                onChange={onSelectSeason}
                style={styles.seasonDropdown}
                triggerTextStyle={styles.seasonDropdownText}
              />
            )}
            <View style={styles.balanceSentenceRow}>
              {/* The words auto-shrink if space runs out; the value never does. */}
              <Text
                style={[styles.balanceUnit, sc.balanceUnit, styles.balanceWords]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {readOnly ? 'FINAL BALANCE IS' : 'YOUR BALANCE IS'}
              </Text>
              <Text style={[styles.balanceValue, sc.balanceValue]}>{formatPins(balance)}</Text>
              <Text style={[styles.balanceUnit, sc.balanceUnit]}>PINS</Text>
            </View>
          </View>
          {(debt > 0 || openAction > 0) && (
            <View style={styles.netRow}>
              {openAction > 0 && (
                <Text style={styles.openActionText}>OPEN {formatPins(openAction)}</Text>
              )}
              {debt > 0 && (
                <Text style={styles.owedText}>OWED −{formatPins(debt)}</Text>
              )}
              <Text style={[styles.netText, netWorth < 0 && styles.netTextNeg]}>
                NET {formatPins(netWorth)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Top 5 leaderboard — always visible on the landing page */}
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => navigation.navigate('PinsinoLeaderboard')}
          activeOpacity={0.7}
        >
          <Text style={styles.sectionLabel}>HIGH ROLLERS</Text>
          <Text style={styles.sectionChevron}>›</Text>
        </TouchableOpacity>
        <PinsinoLeaderboardTable
          leaderboard={leaderboard}
          playerId={playerId}
          mode="summary"
          limit={5}
          onRowPress={(id, name) => navigation.navigate('PlayerPinsino', { playerId: id, name })}
        />

        {/* Subpage menu */}
        <View style={[styles.grid, sc.grid]}>
          {MENU_TILES.map(tile => {
            // Pending-action badge for this tile (0 when nothing needs attention).
            // Suppressed entirely in read-only past-season mode — live pending
            // actions are irrelevant to a frozen archive view.
            const badge = readOnly ? 0 : countForRoute(counts, tile.route)
            // Admin kill-switch: a closed Auction House paints a stylized status
            // over its tile and blocks entry (the tap no-ops). Live mode only.
            const closed = tile.route === 'AuctionHouse' && !readOnly && auctionHouseClosed
            return (
              <TouchableOpacity
                key={tile.route}
                style={[styles.tile, sc.tile]}
                onPress={() => { if (!closed) navigation.navigate(tile.route) }}
                activeOpacity={closed ? 1 : 0.7}
              >
                <Text style={[styles.tileIcon, sc.tileIcon, closed && styles.tileIconClosed]}>{tile.icon}</Text>
                {/* Always one line: longer labels ("Auction House") shrink to
                    fit the tile width instead of wrapping. Single-line
                    adjustsFontSizeToFit is deterministic (width-only), unlike
                    the multiline variant. */}
                <Text
                  style={[styles.tileLabel, sc.tileLabel, closed && styles.tileLabelClosed]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {tile.label}
                </Text>
                <Text
                  style={[styles.tileHook, sc.tileHook, closed && styles.tileLabelClosed]}
                  numberOfLines={2}
                >
                  {EXPLAINERS[tile.key].tileHook ?? EXPLAINERS[tile.key].hook}
                </Text>
                {badge > 0 && !closed && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                )}
                {closed && (
                  <View style={styles.closedOverlay}>
                    <Text style={styles.closedTag}>CLOSED</Text>
                    <Text style={styles.closedMsg} numberOfLines={3}>
                      {auctionHouseClosedMessage?.trim() || AUCTION_HOUSE_CLOSED_DEFAULT_MESSAGE}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Market Moves mini-feed — a one-event-tall carousel of the latest
            public events; swipe horizontally (paged) to move between them.
            Fixed (scaled) height so the fit-to-one-screen pass stays
            convergent. Tapping an event opens the same detail it would on the
            Market Moves screen (shared useFeedEventPress routing). */}
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => navigation.navigate('MarketMoves')}
          activeOpacity={0.7}
        >
          <Text style={styles.sectionLabel}>MARKET MOVES</Text>
          <Text style={styles.sectionChevron}>›</Text>
        </TouchableOpacity>
        <View style={[styles.feedBox, sc.feedBox]}>
          {feedEvents.length === 0 ? (
            <Text style={styles.feedEmpty}>No moves yet this season.</Text>
          ) : (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={e => {
                  const page = Math.round(e.nativeEvent.contentOffset.x / FEED_PAGE_WIDTH)
                  setFeedPage(Math.max(0, Math.min(page, feedEvents.length - 1)))
                }}
              >
                {feedEvents.map(e => (
                  <View key={e.id} style={styles.feedPage}>
                    <MarketMovePreviewRow event={e} onPress={onPressFor(e)} fontScale={fitScale} />
                  </View>
                ))}
              </ScrollView>
              {feedEvents.length > 1 && (
                <View style={styles.feedDots} pointerEvents="none">
                  {feedEvents.map((e, i) => (
                    <View key={e.id} style={[styles.feedDot, i === feedPage && styles.feedDotActive]} />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
      )}
      {feedDetailModals}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 16 },

  finalBanner: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  finalBannerText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 14,
    letterSpacing: 2,
    color: colors.accent,
  },
  finalBannerSub: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
    marginTop: 2,
  },

  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginTop: 4,
    marginBottom: 16,
    gap: 6,
  },
  // Pill · words · value on one middle-aligned line. alignItems 'center'
  // (not baseline) is what keeps the small text vertically centered against
  // the emphasized value.
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceSentenceRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  balanceWords: {
    flexShrink: 1,
  },
  // Compact trigger so the season pill reads as a small tag on the card edge —
  // fully-rounded, in the card's own chrome (border, surface2) rather than the
  // dropdown's default form-control look.
  seasonDropdown: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderColor: colors.border,
  },
  // Match the card's small-caps type (12pt condensed, wide tracking) so the
  // pill reads as part of the balance sentence, not a foreign control.
  seasonDropdownText: {
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  // No explicit lineHeight — the sentence's line box must hug the glyphs so
  // the whole line centers vertically in the card.
  balanceValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 36,
    color: colors.accent,
  },
  balanceUnit: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.muted,
  },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
  },
  openActionText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.accent,
  },
  owedText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.danger,
  },
  netText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 1,
    color: colors.text,
  },
  netTextNeg: { color: colors.danger },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.text,
  },
  sectionChevron: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 24,
    lineHeight: 24,
    color: colors.accent,
  },
  // Market Moves mini-feed — a one-event-tall paged carousel box under its
  // labeled section header, last on the page below the tile grid.
  feedBox: {
    height: 80,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  feedPage: {
    width: FEED_PAGE_WIDTH,
    paddingHorizontal: 12,
    // Keep the event line clear of the page dots along the bottom edge.
    paddingBottom: 8,
    justifyContent: 'center',
  },
  feedDots: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  feedDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  feedDotActive: {
    backgroundColor: colors.accent,
  },
  feedEmpty: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.muted,
    textAlign: 'center',
  },

  // Subpage menu tiles (mirrors MoreHomeScreen)
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'space-evenly',
    gap: TILE_GAP,
    marginBottom: 0,
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 12,
    color: colors.bg,
    lineHeight: 14,
  },
  tileIcon: { fontSize: 34, marginBottom: 6 },
  tileIconClosed: { opacity: 0.25 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  tileHook: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    color: colors.text,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 13,
  },
  tileLabelClosed: { opacity: 0.25 },

  // Stylized "closed" status painted over the Auction House tile when an admin
  // has closed the house. Sits above the dimmed icon/label; the tap is inert.
  closedOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: radius.cardMd,
    backgroundColor: 'rgba(10,10,12,0.82)',
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  closedTag: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 15,
    letterSpacing: 2,
    color: colors.danger,
  },
  closedMsg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.text,
    textAlign: 'center',
    marginTop: 4,
  },
})
