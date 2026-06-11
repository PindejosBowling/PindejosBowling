import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Dimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import { useRefresh } from '../hooks/useRefresh'
import { useHousePinsinoData } from '../hooks/useHousePinsinoData'
import { useAuthStore } from '../stores/authStore'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const TILE_WIDTH = (Dimensions.get('window').width - 48) / 3

// Subpage menu tiles (groundwork for more admin subpages — add one line each)
const MENU_TILES: { icon: string; label: string; route: 'PinsinoAccounting' | 'AdminSportsbook' | 'LoanSharkAdmin' | 'PvPAdmin' | 'MarketMovesAdmin' | 'BountyAdmin' }[] = [
  { icon: '📒', label: 'Accounting', route: 'PinsinoAccounting' },
  { icon: '👀', label: 'Market Moves', route: 'MarketMovesAdmin' },
  { icon: '🏟️', label: 'Sportsbook', route: 'AdminSportsbook' },
  { icon: '⚔️', label: 'PvP', route: 'PvPAdmin' },
  { icon: '🎯', label: 'Bounties', route: 'BountyAdmin' },
  { icon: '🦈', label: 'Loan Shark', route: 'LoanSharkAdmin' },
]

export default function PinsinoAdminScreen() {
  const navigation = useNavigation<Nav>()
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const { loading, reload } = useHousePinsinoData()
  const { refreshing, onRefresh } = useRefresh(reload)

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

        {/* Subpage menu */}
        <View style={styles.grid}>
          {MENU_TILES.map(tile => (
            <TouchableOpacity
              key={tile.route}
              style={styles.tile}
              onPress={() => navigation.navigate(tile.route)}
              activeOpacity={0.7}
            >
              <Text style={styles.tileIcon}>{tile.icon}</Text>
              <Text style={styles.tileLabel}>{tile.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

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
  },
  tileIcon: { fontSize: 26, marginBottom: 6 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
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
