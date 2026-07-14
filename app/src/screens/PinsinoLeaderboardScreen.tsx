import { ScrollView, StyleSheet, RefreshControl, View, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { PinsinoStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ui/ScreenHeader'
import LoadingView from '../components/ui/LoadingView'
import PinsinoLeaderboardTable from '../components/betting/PinsinoLeaderboardTable'
import { usePinsinoData } from '../hooks/usePinsinoData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

export default function PinsinoLeaderboardScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const pinsinoViewSeasonId = useUiStore(s => s.pinsinoViewSeasonId)
  const navigation = useNavigation<PinsinoNav>()

  const { loading, leaderboard, seasonNumber, seasonConcluded, reload } = usePinsinoData(playerId, pinsinoViewSeasonId)
  const { refreshing, onRefresh } = useRefresh(reload)

  if (loading) return <LoadingView label="Loading…" delayed />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title="High Rollers" onBack={() => navigation.goBack()} />

        {/* Between seasons: this board is the frozen final standing until the
            next season starts. */}
        {seasonConcluded && (
          <View style={styles.finalBanner}>
            <Text style={styles.finalBannerText}>
              SEASON {seasonNumber} · FINAL STANDINGS
            </Text>
          </View>
        )}

        <PinsinoLeaderboardTable
          leaderboard={leaderboard}
          playerId={playerId}
          mode="detail"
          onRowPress={(id, name) => navigation.navigate('PlayerPinsino', { playerId: id, name })}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  finalBanner: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 12,
  },
  finalBannerText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 14,
    letterSpacing: 2,
    color: colors.accent,
  },
})
