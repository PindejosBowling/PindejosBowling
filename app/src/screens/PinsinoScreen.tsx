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
import { useCallback } from 'react'
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
import { SHOW_AUCTION_HOUSE } from '../utils/featureFlags'
import { PinsinoStackParamList } from '../navigation/types'
import { formatPins } from '../utils/formatting'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

const TILE_GAP = 12
const TILE_WIDTH = (Dimensions.get('window').width - 32 - TILE_GAP * 2) / 3

// Subpage menu tiles (groundwork for more Pinsino subpages — add one line each)
const MENU_TILES: { icon: string; label: string; route: 'PinsinoLeaderboard' | 'Sportsbook' | 'LoanShark' | 'PvP' | 'MarketMoves' | 'BountyBoard' | 'AuctionHouse' }[] = [
  { icon: '🏟️', label: 'Sportsbook', route: 'Sportsbook' },
  { icon: '⚔️', label: 'PvP', route: 'PvP' },
  { icon: '🎯', label: 'Bounties', route: 'BountyBoard' },
  // Mock-backed while the auction DB layer is built — flag-gated independently.
  ...(SHOW_AUCTION_HOUSE ? [{ icon: '📣', label: 'Auction House', route: 'AuctionHouse' as const }] : []),
  { icon: '🦈', label: 'Loan Shark', route: 'LoanShark' },
  { icon: '👀', label: 'Market Moves', route: 'MarketMoves' },
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
  const { loading, balance, debt, openAction, netWorth, leaderboard, seasonNumber, seasonConcluded, reload } = usePinsinoData(playerId, pinsinoViewSeasonId)
  const { refreshing, onRefresh } = useRefresh(reload)

  // Selector options: 'live' (default) + each concluded season, newest first.
  const concludedSeasons = allSeasons.filter(s => !s.is_active)
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

  // Transitions stay art-only: the backdrop paints immediately and the
  // spinner appears only if loading drags past 5s.
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <PinsinoNoirBackdrop />
        <LoadingView label="Loading…" transparent delayed />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PinsinoNoirBackdrop />
      <AppHeader artworkToggle onHelp={() => navigation.navigate('PinsinoHelp')} />
      {!artworkReveal && (
      <ScrollView
        contentContainerStyle={styles.content}
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
          <View style={styles.finalBanner}>
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
          style={styles.balanceCard}
          onPress={() => {
            // The player detail respects the selected season too, so this drills
            // into the viewer's record for whichever season is being viewed.
            if (playerId) navigation.navigate('PlayerPinsino', { playerId, name: playerName ?? 'Me' })
          }}
          activeOpacity={0.7}
          disabled={!playerId}
        >
          <Text style={styles.balanceLabel}>{readOnly ? `SEASON ${seasonNumber} FINAL BALANCE` : 'YOUR BALANCE'}</Text>
          <Text style={styles.balanceValue}>{formatPins(balance)}</Text>
          <Text style={styles.balanceUnit}>PINS</Text>
          {(debt > 0 || openAction > 0) && (
            <View style={styles.netRow}>
              {openAction > 0 && (
                <>
                  <Text style={styles.openActionText}>OPEN {formatPins(openAction)}</Text>
                  <Text style={styles.netDivider}>·</Text>
                </>
              )}
              {debt > 0 && (
                <>
                  <Text style={styles.owedText}>OWED −{formatPins(debt)}</Text>
                  <Text style={styles.netDivider}>·</Text>
                </>
              )}
              <Text style={[styles.netText, netWorth < 0 && styles.netTextNeg]}>
                NET {formatPins(netWorth)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Top 3 leaderboard — always visible on the landing page */}
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => navigation.navigate('PinsinoLeaderboard')}
          activeOpacity={0.7}
        >
          <Text style={styles.sectionLabel}>TITANS OF PINDUSTRY</Text>
          <Text style={styles.sectionMore}>VIEW ALL ›</Text>
        </TouchableOpacity>
        <PinsinoLeaderboardTable
          leaderboard={leaderboard}
          playerId={playerId}
          mode="summary"
          limit={3}
          onRowPress={(id, name) => navigation.navigate('PlayerPinsino', { playerId: id, name })}
        />

        {/* Subpage menu */}
        <View style={styles.grid}>
          {MENU_TILES.map(tile => {
            // Pending-action badge for this tile (0 when nothing needs attention).
            // Suppressed entirely in read-only past-season mode — live pending
            // actions are irrelevant to a frozen archive view.
            const badge = readOnly ? 0 : countForRoute(counts, tile.route)
            return (
              <TouchableOpacity
                key={tile.route}
                style={styles.tile}
                onPress={() => navigation.navigate(tile.route)}
                activeOpacity={0.7}
              >
                <Text style={styles.tileIcon}>{tile.icon}</Text>
                <Text style={styles.tileLabel}>{tile.label}</Text>
                {badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
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
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
    marginBottom: 16,
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
    fontSize: 48,
    color: colors.accent,
    lineHeight: 52,
  },
  balanceUnit: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginTop: 2,
  },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
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
  netDivider: { color: colors.muted2, fontSize: 13 },
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
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
  },
  sectionMore: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    letterSpacing: 1,
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
  tileIcon: { fontSize: 40, marginBottom: 10 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
})
