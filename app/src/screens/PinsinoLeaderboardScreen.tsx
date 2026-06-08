import { ScrollView, StyleSheet, RefreshControl, View, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
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

        <View style={styles.rulesCard}>
          <Text style={styles.rulesTitle}>How It Works</Text>
          <Text style={styles.rulesBody}>
            Titans of Pindustry is the "game within the game" of the PBL — a season-long
            race to amass the biggest pin fortune by any means necessary.
          </Text>
          <Text style={styles.rulesBody}>
            Earn pins by bowling games in the PBL, winning bets at the Sportsbook, challenging rivals directly in PvP, and collecting Bounties issued by the Pinsino.
          </Text>
          <Text style={styles.rulesBody}>
            The Loan Shark is happy to provide his services too, for a price.
          </Text>
          <Text style={styles.rulesBody}>
            When a season ends, whoever sits atop this board is crowned this season's Titan and then the next season will start fresh.
          </Text>
        </View>

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
  rulesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 16,
  },
  rulesTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 16,
    color: colors.accent,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  rulesBody: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 10,
  },
})
