import { useMemo } from 'react'
import {
  View, Text, FlatList, ScrollView, RefreshControl, TouchableOpacity, StyleSheet,
} from 'react-native'
import { useRefresh } from '../hooks/useRefresh'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useDataStore } from '../stores/dataStore'
import { useUiStore } from '../stores/uiStore'
import { getChemistry, isChampion } from '../utils/data.js'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/LoadingView'
import ScreenHeader from '../components/ScreenHeader'
import ToggleGroup from '../components/ToggleGroup'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function ChemistryScreen() {
  const { stats, champions, loading, loadAll } = useDataStore()
  const { chemMode, chemExpanded, set } = useUiStore()
  const { refreshing, onRefresh } = useRefresh(loadAll)
  const navigation = useNavigation<Nav>()

  const groupSize = chemMode === 'pairs' ? 2 : 3

  const allGroups = useMemo(
    () => (stats ? getChemistry(stats, groupSize) : []),
    [stats, groupSize],
  )

  const visibleGroups = chemExpanded ? allGroups : allGroups.slice(0, 10)

  if (loading || !stats) return <LoadingView label="Loading chemistry" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Team Chemistry" onBack={() => navigation.navigate('MoreHome')} />

      <ToggleGroup
        options={[{ key: 'pairs', label: 'Pairs' }, { key: 'trios', label: 'Trios' }]}
        value={chemMode}
        onChange={(mode) => set({ chemMode: mode as 'pairs' | 'trios', chemExpanded: false })}
        style={{ marginHorizontal: 16, marginBottom: 12 }}
      />

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {allGroups.length === 0 ? (
          <Text style={styles.empty}>Not enough data yet.</Text>
        ) : (
          <>
            <FlatList
              data={visibleGroups}
              keyExtractor={(item: any) => item.names.join('|')}
              contentContainerStyle={styles.list}
              scrollEnabled={false}
              renderItem={({ item }: { item: any }) => (
                <View style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.names}>
                      {item.names.map((name: string, i: number) => (
                        `${i > 0 ? ' + ' : ''}${name}${isChampion(champions, name) ? ' 👑' : ''}`
                      )).join('')}
                    </Text>
                    <Text style={styles.games}>{item.wins}—{item.losses} · {item.weeks}wk</Text>
                  </View>
                  <Text style={styles.rate}>{(item.winRate * 100).toFixed(0)}%</Text>
                </View>
              )}
            />

            {allGroups.length > 10 ? (
              <TouchableOpacity
                style={styles.showMoreBtn}
                onPress={() => set({ chemExpanded: !chemExpanded })}
              >
                <Text style={styles.showMoreText}>
                  {chemExpanded ? 'Show top 10' : `Show all ${allGroups.length}`}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.cardSm,
    padding: 12,
    marginBottom: 6,
  },
  names: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
    marginBottom: 3,
  },
  games: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  rate: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.accent,
    minWidth: 52,
    textAlign: 'right',
  },

  showMoreBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  showMoreText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.5,
  },

  empty: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 48,
  },
})
