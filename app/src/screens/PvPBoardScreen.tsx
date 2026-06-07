import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors, fonts, radius } from '../theme'
import ScreenHeader from '../components/ScreenHeader'
import LoadingView from '../components/LoadingView'
import PillFilter from '../components/PillFilter'
import PvpChallengeRow from '../components/PvpChallengeRow'
import PvpAcceptModal from '../components/PvpAcceptModal'
import PvpCounterModal from '../components/PvpCounterModal'
import { usePvpData, PvpChallengeView } from '../hooks/usePvpData'
import { useRefresh } from '../hooks/useRefresh'
import { useAuthStore } from '../stores/authStore'
import { CONTRACT_TYPE_LABEL } from '../utils/pvp'
import { PinsinoStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<PinsinoStackParamList>

const FILTERS = ['All', 'line_duel', 'raw_score_duel']

export default function PvPBoardScreen() {
  const navigation = useNavigation<Nav>()
  const playerId = useAuthStore(s => s.playerId)

  const { loading, balance, openBoard, inbox, reload } = usePvpData(playerId)
  const { refreshing, onRefresh } = useRefresh(reload)

  const [filter, setFilter] = useState('All')
  const [acceptTarget, setAcceptTarget] = useState<PvpChallengeView | null>(null)
  const [counterTarget, setCounterTarget] = useState<PvpChallengeView | null>(null)

  const rows = useMemo(
    () => (filter === 'All' ? openBoard : openBoard.filter(c => c.contractType === filter)),
    [openBoard, filter],
  )

  // The viewer's own open-board posts (counterparty still null, still pending).
  // They're filtered out of `openBoard` because you can't accept your own, but the
  // board should still show them so you can confirm the post went live.
  const myOpen = useMemo(() => {
    const mine = inbox.sent.filter(c => c.counterpartyId == null && c.status === 'pending')
    return filter === 'All' ? mine : mine.filter(c => c.contractType === filter)
  }, [inbox.sent, filter])

  if (loading) return <LoadingView label="Loading…" />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Challenge Board" subtitle="Open contracts — first to accept locks it" onBack={() => navigation.goBack()} />

      <PillFilter
        items={FILTERS}
        value={filter}
        onChange={setFilter}
        renderLabel={item => (item === 'All' ? 'All' : CONTRACT_TYPE_LABEL[item] ?? item)}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      >
        <TouchableOpacity
          style={styles.postBtn}
          onPress={() => navigation.navigate('PvPCreate')}
          activeOpacity={0.7}
        >
          <Text style={styles.postBtnText}>+ Post Open Challenge</Text>
        </TouchableOpacity>

        {myOpen.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>YOUR OPEN POSTS ({myOpen.length})</Text>
            {myOpen.map(c => (
              <PvpChallengeRow
                key={c.id}
                challenge={c}
                viewerId={playerId}
                onPress={() => navigation.navigate('PvPChallengeDetail', { challengeId: c.id })}
                cta="Waiting for a taker · tap to manage"
              />
            ))}
            <Text style={styles.sectionLabel}>OPEN CHALLENGES</Text>
          </>
        )}

        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No open challenges right now.</Text>
          </View>
        ) : (
          rows.map(c => (
            <View key={c.id}>
              <PvpChallengeRow
                challenge={c}
                viewerId={playerId}
                onPress={() => navigation.navigate('PvPChallengeDetail', { challengeId: c.id })}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actBtn, styles.acceptBtn, balance < c.creatorStake && styles.actBtnDisabled]}
                  onPress={() => setAcceptTarget(c)}
                  disabled={balance < c.creatorStake}
                  activeOpacity={0.7}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actBtn, styles.counterBtn]} onPress={() => setCounterTarget(c)} activeOpacity={0.7}>
                  <Text style={styles.counterText}>Counter</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {acceptTarget && (
        <PvpAcceptModal
          challenge={acceptTarget}
          viewerId={playerId}
          onClose={() => setAcceptTarget(null)}
          onDone={reload}
        />
      )}
      {counterTarget && (
        <PvpCounterModal
          challenge={counterTarget}
          viewerId={playerId}
          balance={balance}
          onClose={() => setCounterTarget(null)}
          onDone={reload}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  postBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  postBtnText: { fontFamily: fonts.barlowCondensed, fontSize: 15, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },

  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    letterSpacing: 2,
    color: colors.muted,
    marginBottom: 10,
    marginTop: 6,
  },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: -2, marginBottom: 16 },
  actBtn: { flex: 1, borderRadius: radius.cardSm, paddingVertical: 11, alignItems: 'center' },
  actBtnDisabled: { opacity: 0.4 },
  acceptBtn: { backgroundColor: colors.accent },
  acceptText: { fontFamily: fonts.barlowCondensed, fontSize: 14, fontWeight: '700', color: colors.bg, letterSpacing: 0.5 },
  counterBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border2 },
  counterText: { fontFamily: fonts.barlowCondensed, fontSize: 14, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontFamily: fonts.barlow, fontSize: 14, color: colors.muted, textAlign: 'center' },
})
