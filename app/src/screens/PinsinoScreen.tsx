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
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import AppHeader from '../components/AppHeader'
import LoadingView from '../components/LoadingView'
import PinsinoLeaderboardTable from '../components/PinsinoLeaderboardTable'
import { usePinsinoData } from '../hooks/usePinsinoData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { PinsinoStackParamList } from '../navigation/types'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

const TILE_WIDTH = (Dimensions.get('window').width - 48) / 3

// Subpage menu tiles (groundwork for more Pinsino subpages — add one line each)
const MENU_TILES: { icon: string; label: string; route: 'PinsinoLeaderboard' | 'Sportsbook' | 'LoanShark' | 'PvP' }[] = [
  { icon: '🏟️', label: 'Sportsbook', route: 'Sportsbook' },
  { icon: '🦈', label: 'Loan Shark', route: 'LoanShark' },
  { icon: '⚔️', label: 'PvP', route: 'PvP' },
]

export default function PinsinoScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const playerName = useAuthStore(s => s.playerName)
  const navigation = useNavigation<PinsinoNav>()

  const { loading, balance, debt, netWorth, leaderboard, pvpReceivedCount, reload } = usePinsinoData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        {/* Balance card — tap to view your own betting record */}
        <TouchableOpacity
          style={styles.balanceCard}
          onPress={() => {
            if (playerId) navigation.navigate('PlayerPinsino', { playerId, name: playerName ?? 'Me' })
          }}
          activeOpacity={0.7}
          disabled={!playerId}
        >
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
          <Text style={styles.balanceValue}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceUnit}>PINS</Text>
          {debt > 0 && (
            <View style={styles.netRow}>
              <Text style={styles.owedText}>OWED −{debt.toLocaleString()}</Text>
              <Text style={styles.netDivider}>·</Text>
              <Text style={[styles.netText, netWorth < 0 && styles.netTextNeg]}>
                NET {netWorth.toLocaleString()}
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
          limit={3}
          onRowPress={(id, name) => navigation.navigate('PlayerPinsino', { playerId: id, name })}
        />

        {/* Subpage menu */}
        <View style={styles.grid}>
          {MENU_TILES.map(tile => {
            // Outstanding "Received" PvP contracts → notification badge on the PvP tile.
            const badge = tile.route === 'PvP' ? pvpReceivedCount : 0
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: 24,
    marginTop: 8,
    marginBottom: 24,
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
    fontSize: 56,
    color: colors.accent,
    lineHeight: 60,
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
    marginBottom: 10,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  tile: {
    width: TILE_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 84,
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
  tileIcon: { fontSize: 26, marginBottom: 6 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
})
