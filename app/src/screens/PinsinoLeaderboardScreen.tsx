import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import { PinsinoStackParamList } from '../navigation/types'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
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

        {leaderboard.length > 0 ? (
          <View style={styles.sbCard}>
            <View style={styles.sbHeaderRow}>
              <Text style={[styles.sbHeaderCell, styles.sbRankCell]}>#</Text>
              <Text style={[styles.sbHeaderCell, styles.sbNameCell]}>Bowler</Text>
              <Text style={[styles.sbHeaderCell, styles.sbBalCell]}>Pins</Text>
              <Text style={[styles.sbHeaderCell, styles.sbProjCell]}>Upside</Text>
            </View>
            {leaderboard.map((p, index) => {
              const isMe = p.playerId === playerId
              return (
                <TouchableOpacity
                  key={p.playerId}
                  style={[styles.sbRow, index < leaderboard.length - 1 && styles.sbRowBorder]}
                  onPress={() => navigation.navigate('PlayerPinsino', { playerId: p.playerId, name: p.name })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.sbIconBox, index < 3 && styles.sbIconBoxTop]}>
                    <Text style={[styles.sbRankText, index < 3 && styles.sbRankTextTop]}>{index + 1}</Text>
                  </View>
                  <Text style={[styles.sbName, isMe && styles.sbNameMe]} numberOfLines={1}>
                    {p.name}
                    {p.movement === 'up' && <Text style={styles.moveUp}> ▲</Text>}
                    {p.movement === 'down' && <Text style={styles.moveDown}> ▼</Text>}
                  </Text>
                  <Text style={styles.sbBalance}>{p.balance.toLocaleString()}</Text>
                  <Text style={[styles.sbProjection, p.potential > p.balance && styles.sbProjectionLive]}>
                    {p.potential.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No pin balances yet</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  // Pin-balance scoreboard (mirrors StandingsScreen)
  sbCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  sbHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sbHeaderCell: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  sbRankCell: { width: 32 },
  sbNameCell: { flex: 1 },
  sbBalCell: { width: 56, textAlign: 'right' },
  sbProjCell: { width: 56, textAlign: 'right' },
  sbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sbRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  sbIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  sbIconBoxTop: { backgroundColor: colors.accentDim },
  sbRankText: { fontFamily: fonts.barlowCondensed, fontSize: 12, color: colors.muted },
  sbRankTextTop: { color: colors.accent },
  sbName: { flex: 1, fontFamily: fonts.barlow, fontSize: 15, color: colors.text },
  sbNameMe: { color: colors.accent },
  sbBalance: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.text,
  },
  sbProjection: {
    width: 56,
    textAlign: 'right',
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
  },
  sbProjectionLive: { color: colors.success },
  moveUp: { fontSize: 11, color: colors.success },
  moveDown: { fontSize: 11, color: colors.danger },

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
