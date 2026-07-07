import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import AppHeader from '../components/league/AppHeader'
import AdminEndSeasonModal from '../components/admin/AdminEndSeasonModal'
import { useAuthStore } from '../stores/authStore'
import { useIsPlayoffCaptain } from '../hooks/usePlayoffDraftData'
import { SHOW_PINSINO } from '../utils/featureFlags'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const TILE_GAP = 16
const TILE_WIDTH = (Dimensions.get('window').width - 32 - TILE_GAP * 2) / 3
const TILE_WIDTH_LG = (Dimensions.get('window').width - 32 - TILE_GAP) / 2

interface Tile {
  icon: string
  label: string
  onPress?: () => void
}

export default function MoreHomeScreen() {
  const navigation = useNavigation<Nav>()
  const [showEndSeason, setShowEndSeason] = useState(false)
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  const playerId = useAuthStore(s => s.playerId)
  // The Playoffs tile is restricted: admins always (in LEAGUE ADMIN below);
  // non-admin captains of the current draft get it among the league tools.
  const isPlayoffCaptain = useIsPlayoffCaptain(playerId)

  const leagueToolsTiles: Tile[] = [
    { icon: '🏆', label: 'Records',      onPress: () => navigation.navigate('LeagueRecords') },
    { icon: '⚔️',  label: 'Head to Head', onPress: () => navigation.navigate('HeadToHead') },
    { icon: '🧪', label: 'Chemistry',    onPress: () => navigation.navigate('Chemistry') },
    { icon: '📜', label: 'History',      onPress: () => navigation.navigate('History') },
    { icon: '🗑️', label: 'Trash Board',  onPress: () => navigation.navigate('TrashBoard') },
    { icon: '📝', label: 'Registration', onPress: () => navigation.navigate('Registration') },
    ...(!isAdmin && isPlayoffCaptain
      ? [{ icon: '🏁', label: 'Playoffs', onPress: () => navigation.navigate('Playoffs') }]
      : []),
  ]

  // Fit-to-screen sizing for the non-admin grid: measure the grid's available
  // height and split it across however many rows the tile count produces
  // (capped at square), so an extra tile — e.g. the captain's Playoffs tile —
  // shrinks the rows instead of pushing the page into a scroll.
  const [gridH, setGridH] = useState(0)
  const tileRows = Math.ceil(leagueToolsTiles.length / 2)
  const tileHeight =
    gridH > 0
      ? Math.min(TILE_WIDTH_LG, Math.floor((gridH - (tileRows - 1) * TILE_GAP) / tileRows))
      : TILE_WIDTH_LG

  // Profile Pictures lives inside the Registration Admin menu, not here.
  const adminTiles: Tile[] = [
    ...(SHOW_PINSINO
      ? [{ icon: '🏦', label: 'Pinsino Admin', onPress: () => navigation.navigate('PinsinoAdmin') }]
      : []),
    { icon: '🎳', label: 'Lanetalk Import', onPress: () => navigation.navigate('LanetalkImportAdmin') },
    { icon: '🗄️', label: 'Archives',       onPress: () => navigation.navigate('Archives') },
    { icon: '🏁', label: 'Playoffs',       onPress: () => navigation.navigate('Playoffs') },
    { icon: '🥇', label: 'End Season',     onPress: () => setShowEndSeason(true) },
    { icon: '📝', label: 'Registration',    onPress: () => navigation.navigate('RegistrationAdmin') },
  ]

  const body = (
    <>
      <Text style={styles.tabTitle}>More</Text>

      <Text style={styles.sectionHeader}>LEAGUE TOOLS</Text>
      <View
        style={[styles.grid, !isAdmin && styles.gridFill]}
        onLayout={isAdmin ? undefined : e => setGridH(e.nativeEvent.layout.height)}
      >
        {leagueToolsTiles.map((tile) => (
          <TouchableOpacity
            key={tile.label}
            style={[styles.tile, !isAdmin && [styles.tileLarge, { height: tileHeight }]]}
            onPress={tile.onPress}
            activeOpacity={0.7}
          >
            <Text style={[styles.tileIcon, !isAdmin && styles.tileIconLarge]}>{tile.icon}</Text>
            <Text style={[styles.tileLabel, !isAdmin && styles.tileLabelLarge]}>{tile.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isAdmin && (
        <>
          <Text style={styles.sectionHeader}>LEAGUE ADMIN</Text>
          <View style={styles.grid}>
            {adminTiles.map((tile) => (
              <TouchableOpacity
                key={tile.label}
                style={[styles.tile, !tile.onPress && styles.tileDisabled]}
                onPress={tile.onPress}
                activeOpacity={tile.onPress ? 0.7 : 1}
              >
                <Text style={styles.tileIcon}>{tile.icon}</Text>
                <Text style={[styles.tileLabel, !tile.onPress && styles.tileLabelDisabled]}>
                  {tile.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      {/* Non-admins get a fixed, fit-to-screen layout (the grid sizes itself to
          the space); admins keep the scrolling two-section list. */}
      {isAdmin ? (
        <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
      ) : (
        <View style={styles.contentFixed}>{body}</View>
      )}

      {isAdmin && showEndSeason && (
        <AdminEndSeasonModal onClose={() => setShowEndSeason(false)} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 },
  contentFixed: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },

  tabTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 28,
    color: colors.text,
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 0,
  },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 6,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
    marginBottom: 24,
  },
  gridFill: {
    flex: 1,
    alignContent: 'space-evenly',
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
  },
  tileLarge: {
    width: TILE_WIDTH_LG,
  },
  tileDisabled: { opacity: 0.35 },
  tileIcon: { fontSize: 40, marginBottom: 10 },
  tileIconLarge: { fontSize: 52, marginBottom: 12 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  tileLabelLarge: { fontSize: 16 },
  tileLabelDisabled: { color: colors.muted },
})
