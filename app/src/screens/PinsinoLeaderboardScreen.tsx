import { ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors } from '../theme'
import { PinsinoStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import PinsinoLeaderboardTable from '../components/PinsinoLeaderboardTable'
import { usePinsinoData } from '../hooks/usePinsinoData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'

type PinsinoNav = NativeStackNavigationProp<PinsinoStackParamList>

export default function PinsinoLeaderboardScreen() {
  const playerId = useAuthStore(s => s.playerId)
  const navigation = useNavigation<PinsinoNav>()

  const { loading, leaderboard, reload } = usePinsinoData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <ScreenHeader title="Titans of Pindustry" onBack={() => navigation.goBack()} />

        <PinsinoLeaderboardTable
          leaderboard={leaderboard}
          playerId={playerId}
          onRowPress={(id, name) => navigation.navigate('PlayerPinsino', { playerId: id, name })}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
})
