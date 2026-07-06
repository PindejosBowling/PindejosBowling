import { useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { useChemistryData, computeChemistryFromSupabase } from '../hooks/useChemistryData'
import { MoreStackParamList } from '../navigation/types'
import LoadingView from '../components/ui/LoadingView'
import ScreenContainer from '../components/ui/ScreenContainer'
import ToggleGroup from '../components/ui/ToggleGroup'

type Nav = NativeStackNavigationProp<MoreStackParamList>

export default function ChemistryScreen() {
  const { loading, rawScores, rawSchedule, championNames, reload } = useChemistryData()
  const { chemMode, chemExpanded, set } = useUiStore()
  const navigation = useNavigation<Nav>()

  const groupSize = chemMode === 'pairs' ? 2 : 3

  const allGroups = useMemo(
    () => computeChemistryFromSupabase(rawScores, rawSchedule, groupSize as 2 | 3),
    [rawScores, rawSchedule, groupSize],
  )

  const visibleGroups = chemExpanded ? allGroups : allGroups.slice(0, 10)

  if (loading && rawScores.length === 0) return <LoadingView label="Loading chemistry" />

  return (
    <ScreenContainer
      title="Chemistry"
      onBack={() => navigation.navigate('MoreHome')}
      pinned={
        <ToggleGroup
          options={[{ key: 'pairs', label: 'Pairs' }, { key: 'trios', label: 'Trios' }]}
          value={chemMode}
          onChange={(mode) => set({ chemMode: mode as 'pairs' | 'trios', chemExpanded: false })}
          style={{ marginHorizontal: 16, marginBottom: 12 }}
        />
      }
      onRefresh={reload}
      // Rows/buttons carry their own 16px horizontal inset; the pre-migration
      // ScrollView had no content padding at all.
      contentStyle={{ paddingHorizontal: 0, paddingBottom: 0 }}
    >
        {allGroups.length === 0 ? (
          <Text style={styles.empty}>Not enough data yet.</Text>
        ) : (
          <>
            <FlatList
              data={visibleGroups}
              keyExtractor={(item) => item.names.join('|')}
              contentContainerStyle={styles.list}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.names}>
                      {item.names.map((name, i) => (
                        `${i > 0 ? ' + ' : ''}${name}${championNames.has(name) ? ' 👑' : ''}`
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
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
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
