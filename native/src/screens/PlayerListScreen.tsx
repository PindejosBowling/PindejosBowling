import { useState, useMemo } from 'react'
import {
  View, Text, TextInput, FlatList, RefreshControl,
  TouchableOpacity, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { aggregateStandings, isChampion } from '../utils/data.js'
import { initials } from '../utils/helpers.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function PlayerListScreen() {
  const { stats, champions, loading, loadAll } = useDataStore()
  const navigation = useNavigation<Nav>()
  const [search, setSearch] = useState('')

  const allPlayers = useMemo(() => {
    if (!stats) return []
    return aggregateStandings(stats, 'all').map((p: any) => ({
      name: p.name,
      avg: p.avg,
      wins: p.wins,
      losses: p.losses,
    }))
  }, [stats])

  const filtered = useMemo(
    () => allPlayers.filter((p: any) =>
      p.name.toLowerCase().includes(search.toLowerCase())
    ),
    [allPlayers, search],
  )

  if (loading || !stats) return <LoadingView label="Loading players" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header row */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate('MoreHome')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Players</Text>
      </View>

      {/* Search */}
      <TextInput
        style={styles.search}
        placeholder="Search players…"
        placeholderTextColor={colors.muted2}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        autoCapitalize="none"
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.name}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}
        renderItem={({ item }) => {
          const champ = isChampion(champions, item.name)
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('PlayerDetail', { name: item.name })}
              activeOpacity={0.7}
            >
              <View style={[styles.avatar, champ && styles.avatarChamp]}>
                <Text style={[styles.avatarText, champ && styles.avatarTextChamp]}>
                  {initials(item.name)}
                </Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.playerName}>
                  {item.name}{champ ? ' 👑' : ''}
                </Text>
                <Text style={styles.subtext}>{item.wins}W {item.losses}L</Text>
              </View>
              <Text style={styles.avg}>
                {item.avg > 0 ? item.avg.toFixed(1) : '—'}
              </Text>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No players found.</Text>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { marginRight: 12, padding: 4 },
  backText: { fontSize: 20, color: colors.text },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    letterSpacing: 1,
  },

  search: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },

  list: { paddingHorizontal: 16, paddingBottom: 32 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.icon,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarChamp: { backgroundColor: colors.accentDim },
  avatarText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
  },
  avatarTextChamp: { color: colors.accent },
  info: { flex: 1 },
  playerName: {
    fontFamily: fonts.barlow,
    fontSize: 15,
    color: colors.text,
  },
  subtext: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  avg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.accent,
    minWidth: 44,
    textAlign: 'right',
  },
  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 32,
  },
})
