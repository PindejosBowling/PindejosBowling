import { useState } from 'react'
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { MoreStackParamList } from '../navigation/types'
import AppHeader from '../components/AppHeader'
import AdminAddPlayerModal from '../components/AdminAddPlayerModal'
import AdminEndSeasonModal from '../components/AdminEndSeasonModal'
import AdminGenerateTeamsModal from '../components/AdminGenerateTeamsModal'

type Nav = NativeStackNavigationProp<MoreStackParamList>

const TILE_WIDTH = (Dimensions.get('window').width - 48) / 3

interface Tile {
  icon: string
  label: string
  onPress?: () => void
}

export default function MoreHomeScreen() {
  const navigation = useNavigation<Nav>()
  const { loadAll } = useDataStore()
  const [showAddPlayer, setShowAddPlayer] = useState(false)
  const { refreshing, onRefresh } = useRefresh(loadAll)
  const [showEndSeason, setShowEndSeason] = useState(false)
  const [showGenerateTeams, setShowGenerateTeams] = useState(false)

  const leagueToolsTiles: Tile[] = [
{ icon: '🏆', label: 'Records',      onPress: () => navigation.navigate('LeagueRecords') },
    { icon: '⚔️',  label: 'Head to Head', onPress: () => navigation.navigate('HeadToHead') },
    { icon: '🧪', label: 'Chemistry',    onPress: () => navigation.navigate('Chemistry') },
    { icon: '📅', label: 'Past Seasons', onPress: () => navigation.navigate('SeasonHistory') },
    { icon: '🗑️', label: 'Trash Board',  onPress: () => navigation.navigate('TrashBoard') },
  ]

  const adminTiles: Tile[] = [
    { icon: '🎲', label: 'Generate Teams', onPress: () => setShowGenerateTeams(true) },
    { icon: '➕', label: 'Add Player',     onPress: () => setShowAddPlayer(true) },
    { icon: '🥇', label: 'End Season',     onPress: () => setShowEndSeason(true) },
    { icon: '🏁', label: 'Playoffs',       onPress: () => navigation.navigate('Playoffs') },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
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
      </ScrollView>

      <AdminAddPlayerModal visible={showAddPlayer} onClose={() => setShowAddPlayer(false)} />
      <AdminEndSeasonModal visible={showEndSeason} onClose={() => setShowEndSeason(false)} />
      <AdminGenerateTeamsModal visible={showGenerateTeams} onClose={() => setShowGenerateTeams(false)} />
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
