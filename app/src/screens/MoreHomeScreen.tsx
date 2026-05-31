import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { MoreStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import AdminEndSeasonModal from '../components/AdminEndSeasonModal'
import AdminGenerateTeamsModal from '../components/AdminGenerateTeamsModal'
import LogoutModal from '../components/LogoutModal'
import { useAuthStore } from '../stores/authStore'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const TILE_WIDTH = (Dimensions.get('window').width - 48) / 3

interface Tile {
  icon: string
  label: string
  onPress?: () => void
}

export default function MoreHomeScreen() {
  const navigation = useNavigation<Nav>()
  const [showEndSeason, setShowEndSeason] = useState(false)
  const [showGenerateTeams, setShowGenerateTeams] = useState(false)
  const [showLogout, setShowLogout] = useState(false)
  const isAdmin = useAuthStore(s => s.role) === 'admin'

  const leagueToolsTiles: Tile[] = [
    { icon: '🏆', label: 'Records',      onPress: () => navigation.navigate('LeagueRecords') },
    { icon: '⚔️',  label: 'Head to Head', onPress: () => navigation.navigate('HeadToHead') },
    { icon: '🧪', label: 'Chemistry',    onPress: () => navigation.navigate('Chemistry') },
    { icon: '📅', label: 'Past Seasons', onPress: () => navigation.navigate('SeasonHistory') },
    { icon: '🗑️', label: 'Trash Board',  onPress: () => navigation.navigate('TrashBoard') },
    { icon: '🚪', label: 'Log Out',      onPress: () => setShowLogout(true) },
  ]

  const adminTiles: Tile[] = [
    { icon: '🎲', label: 'Generate Teams', onPress: () => setShowGenerateTeams(true) },
    { icon: '👥', label: 'Players',         onPress: () => navigation.navigate('PlayerManagement') },
    { icon: '🥇', label: 'End Season',     onPress: () => setShowEndSeason(true) },
    { icon: '🏁', label: 'Playoffs',       onPress: () => navigation.navigate('Playoffs') },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.tabTitle}>More</Text>

        <Text style={styles.sectionHeader}>LEAGUE TOOLS</Text>
        <View style={styles.grid}>
          {leagueToolsTiles.map((tile) => (
            <TouchableOpacity
              key={tile.label}
              style={styles.tile}
              onPress={tile.onPress}
              activeOpacity={0.7}
            >
              <Text style={styles.tileIcon}>{tile.icon}</Text>
              <Text style={styles.tileLabel}>{tile.label}</Text>
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
      </ScrollView>

      {isAdmin && (
        <>
          <AdminEndSeasonModal visible={showEndSeason} onClose={() => setShowEndSeason(false)} />
          <AdminGenerateTeamsModal visible={showGenerateTeams} onClose={() => setShowGenerateTeams(false)} />
        </>
      )}
      <LogoutModal visible={showLogout} onClose={() => setShowLogout(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },

  tabTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 28,
    color: colors.text,
    letterSpacing: 0.5,
    marginBottom: 20,
    marginTop: 4,
  },

  sectionHeader: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: 10,
  },

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
  tileDisabled: { opacity: 0.35 },
  tileIcon: { fontSize: 26, marginBottom: 6 },
  tileLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  tileLabelDisabled: { color: colors.muted },
})
