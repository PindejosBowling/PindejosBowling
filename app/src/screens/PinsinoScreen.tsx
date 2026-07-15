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
import PillFilter from '../components/ui/PillFilter'
import { usePinsinoData } from '../hooks/usePinsinoData'
import { usePinsinoSeasonContext } from '../hooks/usePinsinoSeasonContext'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useUiStore } from '../stores/uiStore'
import { countForRoute } from '../utils/notifications'
import { SHOW_AUCTION_HOUSE, SHOW_PINSINO_ART } from '../utils/featureFlags'
import { EXPLAINERS, PinsinoFeatureKey } from '../data/pinsinoExplainers'
import { AUCTION_HOUSE_CLOSED_DEFAULT_MESSAGE } from '../utils/auction'
import { PinsinoStackParamList } from '../navigation/types'
import { formatPins } from '../utils/formatting'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

const TILE_GAP = 12
const TILE_WIDTH = (Dimensions.get('window').width - 32 - TILE_GAP * 2) / 3

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
  { key: 'pvp', icon: '⚔️', label: 'PvP', route: 'PvP' },
  { key: 'bounties', icon: '🎯', label: 'Bounties', route: 'BountyBoard' },
  { key: 'marketMoves', icon: '👀', label: 'Market Moves', route: 'MarketMoves' },
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
  const { seasons: allSeasons, readOnly } = usePinsinoSeasonContext()
  const { loading, balance, debt, openAction, netWorth, leaderboard, seasonNumber, seasonConcluded, auctionHouseClosed, auctionHouseClosedMessage, reload } = usePinsinoData(playerId, pinsinoViewSeasonId)
  const { refreshing, onRefresh } = useRefresh(reload)

  // Selector options: 'live' (default) + each concluded season, newest first.
  // Season 1 predates the Pinsino economy (no pin ledger / bets / outcomes to
  // review), so it's excluded entirely from the history selector.
  const concludedSeasons = allSeasons.filter(s => !s.is_active && s.number > 1)
  const seasonItems = ['live', ...concludedSeasons.map(s => String(s.number))]
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
  // leaderboard table, PillFilter) don't scale — each pass re-measures the
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
    return {
      content: { paddingBottom: s(16) },
      finalBanner: { paddingVertical: s(10), marginBottom: s(12) },
      balanceCard: { paddingVertical: s(14), marginBottom: s(16) },
      balanceLabel: { fontSize: s(12) },
      balanceValue: { fontSize: s(36), lineHeight: s(38) },
      balanceUnit: { fontSize: s(12) },
      grid: { rowGap: s(TILE_GAP) },
      tile: { height: s(TILE_WIDTH) },
      tileIcon: { fontSize: s(34), marginBottom: s(6) },
      tileLabel: { fontSize: s(13) },
      tileHook: { fontSize: s(10), marginTop: s(2) },
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
        {/* Season selector — governs the entire tab. 'Live' (default) shows the
            current season; picking a concluded season puts the whole Pinsino tab
            into read-only end-of-season review. Only shown once there's a prior
            season to review. */}
        {concludedSeasons.length > 0 && (
          <PillFilter
            items={seasonItems}
            value={selectorValue}
            onChange={onSelectSeason}
            renderLabel={item => (item === 'live' ? 'Live' : `Season ${item}`)}
          />
        )}

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
          <View style={styles.balanceLeft}>
            <Text style={[styles.balanceLabel, sc.balanceLabel]}>{readOnly ? `SEASON ${seasonNumber} FINAL BALANCE` : 'YOUR BALANCE'}</Text>
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
          </View>
          <View style={styles.balanceValueWrap}>
            <Text style={[styles.balanceValue, sc.balanceValue]}>{formatPins(balance)}</Text>
            <Text style={[styles.balanceUnit, sc.balanceUnit]}>PINS</Text>
          </View>
        </TouchableOpacity>

        {/* Top 3 leaderboard — always visible on the landing page */}
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
          limit={3}
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
                <Text style={[styles.tileLabel, sc.tileLabel, closed && styles.tileLabelClosed]}>{tile.label}</Text>
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
      </ScrollView>
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginTop: 4,
    marginBottom: 16,
  },
  balanceLeft: {
    flexShrink: 1,
    gap: 6,
  },
  balanceLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.muted,
  },
  balanceValueWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    flexShrink: 0,
  },
  balanceValue: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 36,
    color: colors.accent,
    lineHeight: 38,
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
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  tileHook: {
    fontFamily: fonts.barlow,
    fontSize: 10,
    color: colors.muted,
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
